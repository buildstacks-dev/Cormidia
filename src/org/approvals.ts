// File-backed approval queue and single-use grants (architecture.md §4).
// The runtime gate is synchronous, so grant lookup/consumption also has a
// synchronous path; operator-facing queue operations remain async.

import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ToolAction, TurnEvent } from "../runtime/types.js";
import {
  normalizeSemanticAction,
  ruleRequiresPerInstanceHumanDecision,
  type CriticalActionEvidence,
  type SemanticAction,
} from "../runtime/gate.js";
import { withFileLock, withFileLockSync } from "../runtime/file-lock.js";

export type ApprovalDecision = "approved" | "denied";
export type ApprovalStatus = "pending" | "expired" | ApprovalDecision;
/** The persisted execution schema retains `approved` for compatibility with
 * existing records and frozen delivery consumers. Decision authorization is
 * always read from ApprovalItem.status/decision; execution progress is read
 * only from ApprovalItem.execution, so the two facts never share a field. */
export type ApprovalExecutionState = "approved" | "executing" | "executed" | "failed" | "ambiguous";
export type ApprovalLifecycleState = "pending" | "denied" | ApprovalExecutionState;

export interface ApprovalDecider {
  /** Agent decisions are deliberately distinct audit facts. A caller cannot
   * smuggle an agent identity into a record that readers present as human. */
  kind: "human" | "agent";
  identity: string;
}

/** Who is responsible for turning an approved decision into the effect.
 *  `actor-retry` is the only one that depends on a provider turn re-attempting
 *  the action, and it is the one that stranded four run-3 approvals at
 *  `attempts: 0` (ISSUE-020): the sandbox answered the actor "rejected by
 *  user" while the grant sat granted, and nothing can make a finished turn
 *  retry. `orchestrator-command` is the durable answer for a recorded shell
 *  action — `cormidia dispatch` runs the exact recorded command from the durable
 *  record. It remains actor-claimable (see claimActorRetryGrantSync): a live
 *  actor that legitimately re-attempts still wins the race and the orchestrator
 *  then finds nothing to do. */
export type ApprovalExecutor = "durable-github" | "release" | "orchestrator-command" | "actor-retry";

export interface ApprovalExecution {
  state: ApprovalExecutionState;
  executor: ApprovalExecutor;
  idempotencyKey: string;
  attempts: number;
  actor?: string;
  attemptedAt?: string;
  finishedAt?: string;
  result?: string;
  remoteRef?: string;
  failureCause?: string;
  nextAction: "dispatch" | "actor_retry" | "reconcile" | "retry_with_disposition" | "none";
}

export interface ActorRetryGrantClaim {
  status: "claimed" | "blocked" | "not-actor-retry";
  item: ApprovalItem;
}

export interface ApprovalAction {
  tool: string;
  input: unknown;
  description?: string;
}

export interface ApprovalItem {
  id: string;
  app: string;
  role: string;
  turnId?: string;
  ticketRef?: string;
  rule: string;
  action: ApprovalAction;
  /** The working directory the action was raised from — the sandbox cwd of the
   * turn that asked. Recorded so a later orchestrator execution runs the exact
   * approved command in the exact context it was approved for, instead of
   * guessing a checkout. Absent on records raised before this field existed and
   * on call sites with no local checkout; the executor then falls back to the
   * app's orchestrator-owned managed clone and never to a guess. */
  workdir?: string;
  /** Structured audit evidence for the rule match. It contains only
   * effect-bearing fields, never comment/review/search/heredoc prose. */
  classification?: CriticalActionEvidence;
  justification?: string;
  raisedAt: string;
  status: ApprovalStatus;
  decidedAt?: string;
  decision?: ApprovalDecision;
  reason?: string;
  decidedBy?: ApprovalDecider;
  expiredAt?: string;
  expiryReason?: string;
  grantId?: string;
  /** Decision and execution are separate facts. `status: approved` never
   * means the side effect ran; this lifecycle advances only on acknowledged
   * execution or an explicit ambiguous/failed disposition. */
  execution?: ApprovalExecution;
}

/** Human-chosen widened grant scope (docs/approvals/design.md A1).
 *  Absent scope = the ratified default: single-use, action-hashed. */
export interface GrantScope {
  kind: "ticket" | "app";
  /** The rule this grant covers — a scoped grant never crosses rules. */
  rule: string;
  /** Ticket the scope binds to (kind "ticket"). */
  ticketRef?: string;
  /** When present, the action text must contain this substring (path
   *  scoping, e.g. ".npmrc" or "src/"). */
  pathContains?: string;
}

export interface ApprovalGrant {
  grantId: string;
  approvalId: string;
  app: string;
  role: string;
  actionHash: string;
  expiresAt: string;
  uses: number;
  createdAt: string;
  consumedAt?: string;
  /** SHA-256 of the RAW approved command string, recorded at decision time on
   *  a single-use grant for a shell action. `actionHash` binds the SEMANTIC
   *  identity, which is computed over `unwrapCommand(...)` and therefore
   *  deliberately ignores a `sudo `/`command `/`env VAR=val ` prefix — two
   *  different literals can share one identity. That is right for
   *  classification and wrong for execution: an orchestrator that runs the
   *  literal with its own credentials must run exactly the bytes the human
   *  read. A post-decision edit of the decided record that prepends
   *  `env INJECTED=pwned ` keeps the identity and so kept its grant; this hash
   *  lives in a separately written file and does not. Absent on scoped grants
   *  (they intentionally cover many commands) and on grants minted before this
   *  field, which fall back to a stricter literal check — see
   *  `commandBindingProblem` in approval-command.ts. */
  commandSha256?: string;
  /** A1: present on multi-use rule+path-scoped grants. */
  scope?: GrantScope;
  /** Set by `cormidia approvals revoke` — a revoked grant never matches. */
  revokedAt?: string;
  /** The action-identity format this grant was minted under (see
   *  ACTION_IDENTITY_VERSION). `findMatchingGrantSync` refuses any grant whose
   *  version is not current, so a format bump cancels every in-flight grant:
   *  agents re-raise and the miss path yields a fresh approval item. Absent on
   *  pre-2026-07-17 (v1, payload-blind) grants — they never match again. */
  identityVersion?: number;
}

/** A1 scope semantics: `pathContains` is a repo-local path bound, not a bare
 *  substring. An occurrence matches only when the path TOKEN containing it is
 *  repo-relative: the token may be nested (`config/credentials.json`,
 *  `./secrets.json`) but is rejected when it is rooted at `/`, `~`, or an
 *  env indirection (`$HOME/...`), contains a parent escape (`..`), or is a
 *  URL. Without this, a grant the human scoped to a repo file (`.npmrc`)
 *  would silently authorize its user-global variant (`~/.npmrc`) — the exact
 *  boundary Stage 6 calibration keeps critical (found by the 2026-07-11
 *  approver rehearsal). */
export function pathBoundaryMatch(actionText: string, pathContains: string): boolean {
  const text = actionText.toLowerCase();
  const needle = pathContains.toLowerCase();
  if (needle.length === 0) return false;
  const isTokenBoundary = (ch: string) => /[\s"'=([{,]/.test(ch);
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    let tokenStart = i;
    while (tokenStart > 0 && !isTokenBoundary(text[tokenStart - 1]!)) tokenStart--;
    const prefix = text.slice(tokenStart, i);
    const escapesRepo =
      prefix.startsWith("/") ||
      prefix.startsWith("~") ||
      prefix.startsWith("$") ||
      prefix.includes("://") ||
      prefix.includes("..");
    if (!escapesRepo) return true;
  }
  return false;
}

/** Canonical definition moved to src/runtime/gate.ts (Stage 1 of the
 *  consequence-classification plan) so the disposition mapping derives from
 *  the same list this store enforces; re-exported here so every existing
 *  import site keeps working unchanged. */
export { NEVER_SCOPEABLE_RULES } from "../runtime/gate.js";

/**
 * Rules whose approved shell action the ORCHESTRATOR may execute itself.
 *
 * Approving an action and authorizing the orchestrator to enact it are two
 * different grants. A human tapping "approve" on `gh pr merge --admin` is
 * saying "this agent may do this"; it is not saying "the orchestrator should
 * merge on my behalf with its own credentials, outside any sandbox". The
 * difference matters most exactly where the effect lands on the org's own
 * control plane — `self-merge-or-approve` is the review boundary,
 * `protocol-self-edit` is roles/pipelines/prompts, `approval-store-tamper` and
 * `scorecard-tamper` are the gate's own roots of trust, and `learning-publish`
 * is one content-bound publish transaction. `NEVER_SCOPEABLE_RULES` and the
 * self-merge rule already treat those as boundaries an agent must never enact;
 * mechanically enacting them from dispatch would walk around that from the
 * other side.
 *
 * So this list is closed and outward-effect only: a publication, a network
 * call, or a delete the human read in `cormidia approvals show`. Anything not
 * listed — including a rule added later — stays with the executor it had, and
 * the human retains `cormidia approvals disposition`. `production-deploy` is
 * absent because it has its own A4 release executor, and `secrets-or-auth`
 * because running a credential-bearing command under the orchestrator's
 * ambient environment is a materially different act from the agent running it
 * in its sandbox.
 */
export const ORCHESTRATOR_EXECUTABLE_RULES: readonly string[] = [
  // §5.3 split (#296): the classes that replaced external-publishing keep its
  // executor capability — the same publications the human read in `cormidia
  // approvals show`, behind the same fresh human approval.
  "repo-collaboration",
  "repo-collaboration-foreign",
  "package-publish",
  "release-artifact",
  "outbound-message",
  "outbound-network",
  // §5.1 split (#296): the five classes that replaced
  // destructive-or-irreversible keep its executor capability — the same
  // outward-effect deletes/rewrites the human read in `cormidia approvals
  // show`, behind the same fresh human approval.
  "destructive-remote-data",
  "history-rewrite-owned",
  "history-rewrite-foreign",
  "destructive-local",
  "gh-api-unrecognized",
];

export function isOrchestratorExecutableRule(rule: string): boolean {
  return ORCHESTRATOR_EXECUTABLE_RULES.includes(rule);
}

const DEFAULT_SCOPED_MAX_USES = 20;

export type ApprovalLogEvent =
  | { type: "raised"; id: string; at: string; app: string; role: string; rule: string }
  | {
      type: "decided";
      id: string;
      at: string;
      decision: ApprovalDecision;
      reason?: string;
      decidedBy?: ApprovalDecider;
      grantId?: string;
      grant?: ApprovalGrant;
    }
  | { type: "expired"; id: string; at: string; reason: string }
  | { type: "grant-minted"; id: string; grantId: string; at: string }
  | { type: "grant-consumed"; id: string; grantId: string; at: string }
  | { type: "grant-revoked"; id: string; grantId: string; at: string }
  | {
      type: "execution-transition";
      id: string;
      at: string;
      from: ApprovalExecutionState;
      to: ApprovalExecutionState;
      actor: string;
      cause?: string;
      remoteRef?: string;
    }
  | {
      type: "executor-rehomed";
      id: string;
      at: string;
      from: ApprovalExecutor;
      to: ApprovalExecutor;
      reason: string;
    }
  | { type: "deduplicated"; id: string; at: string; actionHash: string; priorStatus: "pending" | "denied" }
  /** reconcile() removed a surviving pending copy of an already-decided item —
   *  the pending-ghost intermediate a crash between moveToDecided's rename and
   *  its rm(pending) leaves (B-09a §3). The decided record always wins; this
   *  row is the durable evidence the repair ran. */
  | { type: "pending-ghost-repaired"; id: string; at: string };

export interface RaiseApprovalInput {
  app: string;
  role: string;
  rule: string;
  action: ToolAction;
  turnId?: string;
  ticketRef?: string;
  /** Sandbox cwd of the raising turn (see ApprovalItem.workdir). */
  workdir?: string;
  justification?: string;
  classification?: CriticalActionEvidence;
  now?: Date;
}

export interface DecideApprovalInput {
  decision: ApprovalDecision;
  reason?: string;
  decidedBy?: ApprovalDecider;
  now?: Date;
  ttlMs?: number;
  /** A1: the human widens the grant at decision time. Rejected for
   *  NEVER_SCOPEABLE_RULES. */
  scope?: { kind: "ticket" | "app"; pathContains?: string };
  /** Use-count cap for a scoped grant (default 20; ignored without scope). */
  maxUses?: number;
}

export interface ApprovalStoreOptions {
  idSource?: (now: Date) => string;
  policy?: ApprovalPolicyConfig;
  /** Deterministic kill points for crash-recovery detectors. Production never
   * supplies this hook. */
  decisionFault?: (boundary: "after_grant" | "after_decision_log" | "after_item_move") => void | Promise<void>;
}

export interface ApprovalPolicyConfig {
  /** Grant authority lifetime after an approval decision. */
  grantTtlMs?: number;
  /** Undecided item lifetime. Omission deliberately inherits grantTtlMs. */
  pendingTtlMs?: number;
}

export interface ApprovalPolicy {
  grantTtlMs: number;
  pendingTtlMs: number;
}

const APPROVAL_POLICY_DEFAULTS = Object.freeze({
  grantTtlMs: 24 * 60 * 60 * 1000,
});

/** Resolve one policy for grants and pending items. Pending TTL follows the
 * configured grant TTL unless explicitly narrowed/widened, so the v2.15
 * default is expressed at the policy seam rather than duplicated in expiry
 * code as a second source constant. */
export function resolveApprovalPolicy(config: ApprovalPolicyConfig = {}): ApprovalPolicy {
  const grantTtlMs = config.grantTtlMs ?? APPROVAL_POLICY_DEFAULTS.grantTtlMs;
  const pendingTtlMs = config.pendingTtlMs ?? grantTtlMs;
  for (const [name, value] of Object.entries({ grantTtlMs, pendingTtlMs })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`approval policy ${name} must be a positive finite number`);
    }
  }
  return { grantTtlMs, pendingTtlMs };
}

/** CLI identity convention. Agent identities are explicitly namespaced;
 * unqualified identities remain human for compatibility with the existing
 * operator-facing `--by <identity>` house pattern. The durable `kind` field,
 * not display text, is what authorization checks consume. */
export function approvalDeciderFromIdentity(identity: string): ApprovalDecider {
  const normalized = identity.trim();
  if (normalized.length === 0) throw new Error("approval deciding identity must be non-empty");
  const agent = /^agent[:/](.+)$/i.exec(normalized);
  return {
    kind: agent === null ? "human" : "agent",
    identity: normalized,
  };
}

export class ApprovalDecisionConflictError extends Error {
  readonly code = "approval_already_decided";

  constructor(
    readonly approvalId: string,
    message: string,
  ) {
    super(message);
    this.name = "ApprovalDecisionConflictError";
  }
}

const EXECUTION_LOCK_STALE_MS = 30_000;
const DECISION_LOCK_STALE_MS = 30_000;

export class ApprovalStore {
  readonly root: string;
  private readonly idSource: (now: Date) => string;
  private readonly policy: ApprovalPolicy;
  private readonly decisionFault?: ApprovalStoreOptions["decisionFault"];

  constructor(root: string, options: ApprovalStoreOptions = {}) {
    this.root = root;
    this.idSource = options.idSource ?? defaultId;
    this.policy = resolveApprovalPolicy(options.policy);
    this.decisionFault = options.decisionFault;
  }

  async raise(input: RaiseApprovalInput): Promise<ApprovalItem> {
    const now = input.now ?? new Date();
    await this.ensureDirs();
    const existing = this.findPendingEquivalentSync(input);
    if (existing !== undefined) {
      await appendJsonLine(this.logPath(), {
        type: "deduplicated",
        id: existing.id,
        at: now.toISOString(),
        actionHash: actionHash(input.action),
        priorStatus: "pending",
      } satisfies ApprovalLogEvent);
      return existing;
    }
    const item = this.itemFromInput(input, now);
    await writeJson(this.pendingPath(item.id), item);
    await appendJsonLine(this.logPath(), raisedEvent(item));
    return item;
  }

  raiseSync(input: RaiseApprovalInput): ApprovalItem {
    const now = input.now ?? new Date();
    this.ensureDirsSync();
    const existing = this.findPendingEquivalentSync(input);
    if (existing !== undefined) {
      appendJsonLineSync(this.logPath(), {
        type: "deduplicated",
        id: existing.id,
        at: now.toISOString(),
        actionHash: actionHash(input.action),
        priorStatus: "pending",
      } satisfies ApprovalLogEvent);
      return existing;
    }
    const item = this.itemFromInput(input, now);
    writeJsonSync(this.pendingPath(item.id), item);
    appendJsonLineSync(this.logPath(), raisedEvent(item));
    return item;
  }

  async listPending(): Promise<ApprovalItem[]> {
    await this.ensureDirs();
    const ids = await listJsonIds(this.pendingDir());
    const items = await Promise.all(ids.map((id) => readJson<ApprovalItem>(this.pendingPath(id))));
    return items.sort((a, b) => a.raisedAt.localeCompare(b.raisedAt));
  }

  async listDecided(): Promise<ApprovalItem[]> {
    await this.ensureDirs();
    return this.readDecided();
  }

  /** Actor work in these states must be reconciled before another provider
   * turn for the same app/role starts. This is the token-free circuit breaker
   * that prevents repeated expensive turns while an approved effect remains
   * unacknowledged. */
  async listActorRetryStalls(input: { app: string; role: string }): Promise<ApprovalItem[]> {
    return (await this.listDecided()).filter(
      (item) =>
        item.app === input.app &&
        item.role === input.role &&
        isActorClaimable(item.execution?.executor) &&
        item.execution !== undefined &&
        actorRetryNeedsReconciliation(item.execution),
    );
  }

  /** Diagnostic read that does not materialize an empty approvals tree. */
  async listDecidedReadOnly(): Promise<ApprovalItem[]> {
    if (!existsSync(this.decidedDir())) return [];
    return this.readDecided();
  }

  private async readDecided(): Promise<ApprovalItem[]> {
    const ids = await listJsonIds(this.decidedDir());
    const items = await Promise.all(ids.map((id) => readJson<ApprovalItem>(this.decidedPath(id))));
    return items.sort((a, b) => (a.decidedAt ?? a.raisedAt).localeCompare(b.decidedAt ?? b.raisedAt));
  }

  async show(id: string): Promise<{ item: ApprovalItem; grant?: ApprovalGrant }> {
    await this.ensureDirs();
    const item = await this.readItem(id);
    const grant =
      item.grantId !== undefined && existsSync(this.grantPath(item.grantId))
        ? await readJson<ApprovalGrant>(this.grantPath(item.grantId))
        : undefined;
    return { item, ...(grant !== undefined ? { grant } : {}) };
  }

  async decide(id: string, input: DecideApprovalInput): Promise<ApprovalItem> {
    const now = input.now ?? new Date();
    await this.ensureDirs();
    const decidedBy = input.decidedBy ?? { kind: "human", identity: "human/operator" };
    const reason = decisionReason(input, decidedBy);

    return this.withDecisionLock(id, async () => {
      const log = await this.readLog();
      await this.reconcileDecisionLocked(id, log, now);

      // B-09b §3/§4: the complete transition is serialized by the shared
      // O_EXCL file-lock primitive. Re-checking after acquisition makes the
      // durable decided record the commit point for every competing caller.
      if (existsSync(this.decidedPath(id))) {
        throw await this.decisionConflict(id);
      }
      if (!existsSync(this.pendingPath(id))) {
        throw new Error(`approval ${id} not found: no pending or decided record`);
      }

      const pending = await readJson<ApprovalItem>(this.pendingPath(id));
      if (pending.status !== "pending") throw new Error(`approval ${id} is not pending`);
      if (this.pendingItemExpired(pending, now)) {
        await this.expirePendingLocked(pending, now);
        throw new ApprovalDecisionConflictError(
          id,
          `approval ${id} expired at ${now.toISOString()} before the decision could be recorded`,
        );
      }
      // Routed through the disposition tiers (#296 Stage 2): `human-only` and
      // `un-grantable` alike admit no agent decider and no widened grant —
      // un-grantable is the stricter class (no standing coverage of any kind),
      // and both collapse to the same two refusals at this seam.
      if (decidedBy.kind === "agent" && ruleRequiresPerInstanceHumanDecision(pending.rule)) {
        throw new Error(
          `approvals: rule "${pending.rule}" requires a human decision; ` +
            `${decidedBy.identity} is an agent identity`,
        );
      }
      if (input.scope !== undefined && ruleRequiresPerInstanceHumanDecision(pending.rule)) {
        throw new Error(
          `approvals: rule "${pending.rule}" is never scopeable (docs/approvals/design.md A1) — ` +
            `decide it single-use`,
        );
      }

      const decided: ApprovalItem = {
        ...pending,
        status: input.decision,
        decision: input.decision,
        decidedAt: now.toISOString(),
        decidedBy,
        reason,
        ...(input.decision === "approved" ? { execution: initialExecution(pending) } : {}),
      };
      const grant =
        input.decision === "approved"
          ? mintGrant(decided, now, input.ttlMs ?? this.policy.grantTtlMs, input.scope, input.maxUses)
          : undefined;
      if (grant !== undefined) decided.grantId = grant.grantId;

      // Materialize the grant before the decision event. Its deterministic
      // grant-<approval> identity makes an after-grant interruption
      // recognizable; reconcileDecisionLocked removes an unauthoritative
      // orphan or completes a logged decision without minting a second grant.
      if (grant !== undefined) {
        await writeJsonAtomic(this.grantPath(grant.grantId), grant);
        await this.decisionFault?.("after_grant");
      }
      await appendJsonLine(this.logPath(), {
        type: "decided",
        id,
        at: now.toISOString(),
        decision: input.decision,
        reason,
        decidedBy,
        ...(grant !== undefined ? { grantId: grant.grantId, grant } : {}),
      } satisfies ApprovalLogEvent);
      await this.decisionFault?.("after_decision_log");
      await this.moveToDecided(decided);
      await this.decisionFault?.("after_item_move");
      if (grant !== undefined) {
        await appendJsonLine(this.logPath(), {
          type: "grant-minted",
          id,
          grantId: grant.grantId,
          at: now.toISOString(),
        } satisfies ApprovalLogEvent);
      }
      return decided;
    });
  }

  async reconcile(now: Date = new Date()): Promise<ApprovalItem[]> {
    await this.ensureDirs();
    const log = await this.readLog();
    const ids = new Set<string>([
      ...log.filter((event) => event.type === "decided").map((event) => event.id),
      ...(await listJsonIds(this.pendingDir())),
      ...(await listJsonIds(this.decidedDir())),
    ]);
    for (const id of ids) {
      await this.withDecisionLock(id, () => this.reconcileDecisionLocked(id, log, now));
    }
    const expired = await this.expirePending(now);
    await this.reconcileLegacyActorRetryStates();
    await this.reconcileUnreachableActorRetryHoming(now);
    return expired;
  }

  /** Move every due undecided item into the durable audit view. The returned
   * items are only those transitioned by this call; callers use them to
   * release the associated suspended claim without coupling this store to the
   * loop layer. */
  async expirePending(now: Date = new Date()): Promise<ApprovalItem[]> {
    await this.ensureDirs();
    const log = await this.readLog();
    const expired: ApprovalItem[] = [];
    for (const id of await listJsonIds(this.pendingDir())) {
      const item = await this.withDecisionLock(id, async () => {
        await this.reconcileDecisionLocked(id, log, now);
        if (!existsSync(this.pendingPath(id))) return undefined;
        const pending = await readJson<ApprovalItem>(this.pendingPath(id));
        return this.pendingItemExpired(pending, now) ? this.expirePendingLocked(pending, now) : undefined;
      });
      if (item !== undefined) expired.push(item);
    }
    return expired;
  }

  /** Expire one known approval at the observation seam (ticket episode). */
  async expirePendingItem(id: string, now: Date = new Date()): Promise<ApprovalItem | undefined> {
    await this.ensureDirs();
    return this.withDecisionLock(id, async () => {
      await this.reconcileDecisionLocked(id, await this.readLog(), now);
      if (!existsSync(this.pendingPath(id))) {
        if (!existsSync(this.decidedPath(id))) return undefined;
        const decided = await readJson<ApprovalItem>(this.decidedPath(id));
        return decided.status === "expired" ? decided : undefined;
      }
      const pending = await readJson<ApprovalItem>(this.pendingPath(id));
      return this.pendingItemExpired(pending, now) ? this.expirePendingLocked(pending, now) : undefined;
    });
  }

  private pendingItemExpired(item: ApprovalItem, now: Date): boolean {
    const raisedAt = new Date(item.raisedAt).getTime();
    if (!Number.isFinite(raisedAt)) {
      throw new Error(`approval ${item.id} has an invalid raisedAt timestamp`);
    }
    return now.getTime() >= raisedAt + this.policy.pendingTtlMs;
  }

  private async expirePendingLocked(pending: ApprovalItem, now: Date): Promise<ApprovalItem> {
    const reason =
      `undecided approval exceeded its configured ${this.policy.pendingTtlMs}ms pending TTL; ` +
      `the raising turn is blocked and its claim may be released`;
    const expired: ApprovalItem = {
      ...pending,
      status: "expired",
      expiredAt: now.toISOString(),
      expiryReason: reason,
    };
    await this.moveToDecided(expired);
    await appendJsonLine(this.logPath(), {
      type: "expired",
      id: expired.id,
      at: expired.expiredAt!,
      reason,
    } satisfies ApprovalLogEvent);
    return expired;
  }

  /** Complete only a previously logged decision and clean recognizable
   * intermediates. This method always runs under decision-locks/<id>.lock. */
  private async reconcileDecisionLocked(id: string, log: readonly ApprovalLogEvent[], now: Date): Promise<void> {
    const decisionEvents = log.filter(
      (event): event is Extract<ApprovalLogEvent, { type: "decided" }> => event.type === "decided" && event.id === id,
    );
    if (decisionEvents.length > 1) {
      throw new Error(
        `approval ${id} has ${decisionEvents.length} durable decision events; ` +
          `refusing to guess which authority is valid`,
      );
    }
    const event = decisionEvents[0];
    const deterministicGrantPath = this.grantPath(`grant-${id}`);

    if (event === undefined) {
      // A crash after grant materialization but before the append-only
      // decision event produced no authority. The deterministic orphan is
      // unusable already; remove it before a fresh approve/deny can proceed.
      if (!existsSync(this.decidedPath(id)) && existsSync(deterministicGrantPath)) {
        await rm(deterministicGrantPath, { force: true });
      }
    } else {
      if (event.grant !== undefined && !existsSync(this.grantPath(event.grant.grantId))) {
        await writeJsonAtomic(this.grantPath(event.grant.grantId), event.grant);
      }
      if (!existsSync(this.decidedPath(id)) && existsSync(this.pendingPath(id))) {
        const pending = await readJson<ApprovalItem>(this.pendingPath(id));
        const recovered: ApprovalItem = {
          ...pending,
          status: event.decision,
          decision: event.decision,
          decidedAt: event.at,
          ...(event.reason !== undefined ? { reason: event.reason } : {}),
          ...(event.decidedBy !== undefined ? { decidedBy: event.decidedBy } : {}),
          ...(event.decision === "approved" ? { execution: initialExecution(pending) } : {}),
          ...(event.grantId !== undefined ? { grantId: event.grantId } : {}),
        };
        await this.moveToDecided(recovered);
      }
      if (
        event.grantId !== undefined &&
        !log.some((candidate) => candidate.type === "grant-minted" && candidate.grantId === event.grantId)
      ) {
        await appendJsonLine(this.logPath(), {
          type: "grant-minted",
          id,
          grantId: event.grantId,
          at: event.at,
        } satisfies ApprovalLogEvent);
      }
    }

    if (!existsSync(this.decidedPath(id))) return;
    const decided = await readJson<ApprovalItem>(this.decidedPath(id));
    if (existsSync(this.pendingPath(id))) {
      await rm(this.pendingPath(id), { force: true });
      if (!log.some((candidate) => candidate.type === "pending-ghost-repaired" && candidate.id === id)) {
        await appendJsonLine(this.logPath(), {
          type: "pending-ghost-repaired",
          id,
          at: now.toISOString(),
        } satisfies ApprovalLogEvent);
      }
    }
    if (decided.status === "expired" && !log.some((candidate) => candidate.type === "expired" && candidate.id === id)) {
      await appendJsonLine(this.logPath(), {
        type: "expired",
        id,
        at: decided.expiredAt ?? now.toISOString(),
        reason: decided.expiryReason ?? "undecided approval expired",
      } satisfies ApprovalLogEvent);
    }
  }

  private async decisionConflict(id: string): Promise<ApprovalDecisionConflictError> {
    const original = await readJson<ApprovalItem>(this.decidedPath(id));
    return new ApprovalDecisionConflictError(
      id,
      `approval ${id} is already decided (${original.decision ?? original.status} at ` +
        `${original.decidedAt ?? original.expiredAt ?? original.raisedAt}); the original result stands` +
        (original.grantId !== undefined ? ` (grant ${original.grantId})` : ""),
    );
  }

  /** Re-home an approved-but-unexecuted shell action from `actor-retry` to
   * `orchestrator-command` (ISSUE-020).
   *
   * `actor-retry` requires the provider turn that raised the op to ask again.
   * Run 3 showed that is not a mechanism anyone can rely on: the sandbox
   * answered the actor "rejected by user" while the grant sat granted, and a
   * finished turn cannot be re-run at all — the grant is born unconsumable and
   * the operator's only remaining move is to mark an approved op failed. The
   * repair is durable, not cosmetic: the record now names an executor that
   * exists.
   *
   * Deliberately narrow. Only a decided, still-`approved` record whose action
   * is a recorded shell command moves; nothing in flight or terminal changes
   * owner, no other executor is touched, and the action, its identity, and its
   * grant are untouched — so the human's decision still authorizes exactly what
   * they approved. A live actor can still claim it (isActorClaimable), so
   * re-homing never takes an op away from a turn that can genuinely run it. */
  private async reconcileUnreachableActorRetryHoming(now: Date): Promise<void> {
    for (const candidate of await this.readDecided()) {
      if (
        candidate.decision !== "approved" ||
        candidate.execution?.executor !== "actor-retry" ||
        candidate.execution.state !== "approved" ||
        approvedCommand(candidate.action) === undefined ||
        // An approval is not an authorization for the orchestrator to enact
        // the org's own control-plane boundaries on the human's behalf.
        !isOrchestratorExecutableRule(candidate.rule)
      ) {
        continue;
      }
      await this.withExecutionLock(candidate.id, async () => {
        const item = readJsonSync<ApprovalItem>(this.decidedPath(candidate.id));
        if (item.execution?.executor !== "actor-retry" || item.execution.state !== "approved") return;
        const reason =
          "actor-retry cannot be reached for an approved shell action; the orchestrator executes " +
          "the recorded command on the next dispatch";
        const next: ApprovalItem = {
          ...item,
          execution: { ...item.execution, executor: "orchestrator-command", nextAction: "dispatch" },
        };
        await writeJsonAtomic(this.decidedPath(item.id), next);
        await appendJsonLine(this.logPath(), {
          type: "executor-rehomed",
          id: item.id,
          at: now.toISOString(),
          from: "actor-retry",
          to: "orchestrator-command",
          reason,
        } satisfies ApprovalLogEvent);
      });
    }
  }

  findMatchingGrantSync(input: {
    app: string;
    role: string;
    actionHash: string;
    /** Rule + action text + ticket enable A1 scoped-grant matching; omitted,
     *  only exact action-hash grants match (the ratified default). The caller
     *  MUST pass only the action's parsed target paths and redirections as
     *  `actionText`, never the raw input JSON — a `pathContains` bound tested
     *  against agent free text (a Write `content`, a shell `# comment`) widens
     *  the grant to anything that merely names the scoped path (A-005). See
     *  `grantScopeText` in gate-compose.ts. */
    rule?: string;
    actionText?: string;
    ticketRef?: string;
    now?: Date;
  }): ApprovalGrant | undefined {
    this.ensureDirsSync();
    const now = input.now ?? new Date();
    for (const file of readdirSync(this.grantsDir())) {
      if (!file.endsWith(".json")) continue;
      const grant = readJsonSync<ApprovalGrant>(join(this.grantsDir(), file));
      if (
        // A grant minted under a superseded identity format never matches
        // (A-002 migration): a version bump cancels every in-flight grant so a
        // human decision made against the old, payload-blind identity cannot
        // authorize an action under the new content-bound one. This gate
        // covers scoped grants too, which do not otherwise consult actionHash.
        grant.identityVersion !== ACTION_IDENTITY_VERSION ||
        grant.app !== input.app ||
        grant.role !== input.role ||
        grant.uses <= 0 ||
        grant.revokedAt !== undefined ||
        new Date(grant.expiresAt).getTime() <= now.getTime()
      ) {
        continue;
      }
      // B-09a §3: a grant whose owning decision has no durable decided record
      // is a crash orphan — recognizable evidence, never usable authorization
      // (INV-003: an executed critical op must have a prior persisted
      // decision). decide() writes the grant before the item moves to
      // decided/, so a mid-decide crash leaves exactly this shape; reconcile
      // completes the decision, and until then the grant must not match. A
      // decided-but-not-approved owner (denied, or repaired by the
      // pending-ghost rule) never matches either.
      {
        const ownerPath = this.decidedPath(grant.approvalId);
        if (!existsSync(ownerPath)) continue;
        const owner = readJsonSync<ApprovalItem>(ownerPath);
        if (owner.decision !== "approved") continue;
      }
      if (grant.scope === undefined) {
        if (grant.actionHash === input.actionHash) return grant;
        continue;
      }
      // A standing (multi-use) grant whose rule's tier is human-only or
      // un-grantable never matches, whatever is on disk (#296 Stage 2):
      // decide() refuses to MINT such a grant, and this guard refuses to
      // HONOR one minted before a tightening or forged past the decision
      // path. Single-use exact-action grants above are untouched — a fresh
      // per-instance human approval remains the one covering path.
      if (ruleRequiresPerInstanceHumanDecision(grant.scope.rule)) continue;
      // Scoped grant: same rule, same ticket when ticket-scoped, and the
      // path (when set) present in the action text at a repo-local boundary.
      if (input.rule === undefined || grant.scope.rule !== input.rule) continue;
      if (grant.scope.kind === "ticket" && grant.scope.ticketRef !== input.ticketRef) continue;
      if (
        grant.scope.pathContains !== undefined &&
        !pathBoundaryMatch(input.actionText ?? "", grant.scope.pathContains)
      ) {
        continue;
      }
      return grant;
    }
    return undefined;
  }

  /** A1: immediate revocation. A revoked grant never matches again; the log
   *  records the act. Revoking an unused grant also terminalizes its approved
   *  execution record. A consumed single-use grant cannot be retroactively
   *  revoked: its outcome must be reconciled explicitly instead. */
  revokeGrantSync(grantId: string, now: Date = new Date()): ApprovalGrant {
    this.ensureDirsSync();
    const path = this.grantPath(grantId);
    const initial = readJsonSync<ApprovalGrant>(path);
    return this.withExecutionLockSync(initial.approvalId, () => {
      const grant = readJsonSync<ApprovalGrant>(path);
      if (grant.revokedAt !== undefined) return grant;
      const item = readJsonSync<ApprovalItem>(this.decidedPath(grant.approvalId));
      if (grant.scope === undefined && grant.consumedAt !== undefined) {
        throw new Error(
          `approval grant ${grantId} was already consumed; reconcile approval ${grant.approvalId} with ` +
            `\`cormidia approvals disposition ${grant.approvalId} (--executed|--failed) ` +
            `--reason <text> --confirm ${grant.approvalId}\``,
        );
      }

      // `consumedAt` is the current grant-use marker. Once a multi-use grant
      // is revoked, the append-only grant-consumed rows retain its prior uses;
      // the grant file carries only the current revoked state, never the
      // consumed+revoked contradiction from ISSUE-011.
      const { consumedAt: _consumedAt, ...grantBase } = grant;
      const next: ApprovalGrant = {
        ...grantBase,
        uses: 0,
        revokedAt: now.toISOString(),
      };
      writeJsonAtomicSync(path, next);
      appendJsonLineSync(this.logPath(), {
        type: "grant-revoked",
        id: next.approvalId,
        grantId: next.grantId,
        at: now.toISOString(),
      } satisfies ApprovalLogEvent);

      if (grant.scope === undefined && item.execution?.state === "approved") {
        const terminal: ApprovalItem = {
          ...item,
          execution: {
            ...item.execution,
            state: "failed",
            actor: "human/operator",
            finishedAt: now.toISOString(),
            result: "approval grant revoked before execution",
            failureCause: "grant_revoked",
            nextAction: "none",
          },
        };
        writeJsonAtomicSync(this.decidedPath(item.id), terminal);
        this.appendExecutionTransitionSync(item, terminal, "human/operator", now);
      }
      return next;
    });
  }

  consumeGrantSync(grantId: string, now: Date = new Date()): ApprovalGrant {
    this.ensureDirsSync();
    const path = this.grantPath(grantId);
    const grant = readJsonSync<ApprovalGrant>(path);
    if (grant.revokedAt !== undefined) throw new Error(`approval grant ${grantId} is revoked`);
    if (new Date(grant.expiresAt).getTime() <= now.getTime()) {
      throw new Error(`approval grant ${grantId} is expired`);
    }
    if (grant.uses <= 0) throw new Error(`approval grant ${grantId} has no remaining uses`);
    const next: ApprovalGrant = {
      ...grant,
      uses: grant.uses - 1,
      consumedAt: now.toISOString(),
    };
    writeJsonSync(path, next);
    appendJsonLineSync(this.logPath(), {
      type: "grant-consumed",
      id: next.approvalId,
      grantId: next.grantId,
      at: now.toISOString(),
    } satisfies ApprovalLogEvent);
    return next;
  }

  /** Synchronous because every Runtime GateFn is synchronous. The approval
   * item advances to `executing` BEFORE the single-use grant is consumed, so
   * a crash can strand only a visible/reconcilable attempt — never a consumed
   * grant whose durable execution still claims TRY 0. The per-item O_EXCL lock
   * is shared with async delivery transitions through the same lock path. */
  claimActorRetryGrantSync(grantId: string, actor: string, now: Date = new Date()): ActorRetryGrantClaim {
    this.ensureDirsSync();
    const initialGrant = readJsonSync<ApprovalGrant>(this.grantPath(grantId));
    return this.withExecutionLockSync(initialGrant.approvalId, () => {
      const grant = readJsonSync<ApprovalGrant>(this.grantPath(grantId));
      const item = readJsonSync<ApprovalItem>(this.decidedPath(grant.approvalId));
      const execution = item.execution;
      if (execution === undefined || !isActorClaimable(execution.executor)) {
        return { status: "not-actor-retry", item };
      }
      if (execution.state !== "approved") {
        return { status: "blocked", item };
      }
      if (grant.revokedAt !== undefined || grant.uses <= 0 || new Date(grant.expiresAt).getTime() <= now.getTime()) {
        return { status: "blocked", item };
      }

      const {
        finishedAt: _finishedAt,
        result: _result,
        remoteRef: _remoteRef,
        failureCause: _failureCause,
        ...executionBase
      } = execution;
      const claimed: ApprovalItem = {
        ...item,
        execution: {
          ...executionBase,
          state: "executing",
          attempts: execution.attempts + 1,
          actor,
          attemptedAt: now.toISOString(),
          nextAction: "reconcile",
        },
      };
      writeJsonAtomicSync(this.decidedPath(item.id), claimed);
      this.appendExecutionTransitionSync(item, claimed, actor, now);
      this.consumeGrantSync(grantId, now);
      return { status: "claimed", item: claimed };
    });
  }

  /** Terminalize every actor-retry claim made by one provider turn. Only an
   * exact action identity carrying an explicit adapter outcome acknowledges
   * success/failure. Pre-execution/no-outcome events are ambiguous by design;
   * provider prose is never execution evidence. */
  async settleActorRetryExecutions(input: {
    actor: string;
    events: readonly TurnEvent[];
    now?: Date;
  }): Promise<ApprovalItem[]> {
    const now = input.now ?? new Date();
    const items = (await this.listDecided()).filter(
      (item) =>
        isActorClaimable(item.execution?.executor) &&
        item.execution?.state === "executing" &&
        item.execution.actor === input.actor,
    );
    const settled: ApprovalItem[] = [];
    for (const item of items) {
      const outcomes = explicitOutcomesFor(item.action, input.events);
      const explicit =
        outcomes.length > 0 && outcomes.every((value) => value === outcomes[0]) ? outcomes[0] : undefined;
      settled.push(
        await this.finishExecution({
          id: item.id,
          state: explicit === true ? "executed" : explicit === false ? "failed" : "ambiguous",
          actor: input.actor,
          result:
            explicit === true
              ? "provider reported exact tool execution success"
              : explicit === false
                ? "provider reported exact tool execution failure"
                : "provider returned no unambiguous outcome for the exact approved action",
          ...(explicit === false
            ? { failureCause: "actor_tool_failed" }
            : explicit === undefined
              ? { failureCause: "actor_outcome_unacknowledged" }
              : {}),
          now,
        }),
      );
    }
    return settled;
  }

  /** Claim an approved action for a sanctioned later executor. The decided
   * item is the source of truth and the per-item lock prevents two dispatch
   * processes from starting the same action. A pre-existing `executing`
   * state is never retried by this method. */
  async beginExecution(id: string, actor: string, now: Date = new Date()): Promise<ApprovalItem | undefined> {
    return this.withExecutionLock(id, async () => {
      const item = await this.readItem(id);
      if (item.execution?.state !== "approved") return undefined;
      const {
        finishedAt: _finishedAt,
        result: _result,
        remoteRef: _remoteRef,
        failureCause: _failureCause,
        ...executionBase
      } = item.execution;
      const next: ApprovalItem = {
        ...item,
        execution: {
          ...executionBase,
          state: "executing",
          attempts: item.execution.attempts + 1,
          actor,
          attemptedAt: now.toISOString(),
          nextAction: "reconcile",
        },
      };
      await writeJsonAtomic(this.decidedPath(id), next);
      await this.appendExecutionTransition(item, next, actor, now);
      return next;
    });
  }

  /** Terminalize one executing action. `ambiguous` is deliberately terminal
   * for automation: dispatch may reconcile it read-only, but never blindly
   * retries the remote mutation. */
  async finishExecution(input: {
    id: string;
    state: "executed" | "failed" | "ambiguous";
    actor: string;
    result: string;
    now?: Date;
    remoteRef?: string;
    failureCause?: string;
  }): Promise<ApprovalItem> {
    const now = input.now ?? new Date();
    return this.withExecutionLock(input.id, async () => {
      const item = await this.readItem(input.id);
      const execution = item.execution;
      const reconcilesAmbiguous = execution?.state === "ambiguous" && input.state !== "ambiguous";
      if (execution?.state !== "executing" && !reconcilesAmbiguous) {
        throw new Error(`approval ${input.id} execution is ${item.execution?.state ?? "untracked"}, not executing`);
      }
      const next: ApprovalItem = {
        ...item,
        execution: {
          ...execution,
          state: input.state,
          actor: input.actor,
          finishedAt: now.toISOString(),
          result: input.result,
          ...(input.remoteRef !== undefined ? { remoteRef: input.remoteRef } : {}),
          ...(input.failureCause !== undefined ? { failureCause: input.failureCause } : {}),
          nextAction:
            input.state === "executed" ? "none" : input.state === "ambiguous" ? "reconcile" : "retry_with_disposition",
        },
      };
      await writeJsonAtomic(this.decidedPath(input.id), next);
      await this.appendExecutionTransition(item, next, input.actor, now);
      return next;
    });
  }

  /** Human disposition for an ambiguous/failed action. `retry` is explicit,
   * content-bound re-arming; it restores one use only on the still-live grant.
   * Expired/revoked grants require a fresh approval instead. Exact confirmed
   * `executed`/`failed` dispositions may also terminalize a legacy `approved`
   * or crash-stuck `executing` actor record; `retry` remains forbidden from
   * those states because an in-flight remote effect cannot be retried safely. */
  async dispositionExecution(input: {
    id: string;
    disposition: "executed" | "failed" | "retry";
    reason: string;
    actor: string;
    now?: Date;
  }): Promise<ApprovalItem> {
    const now = input.now ?? new Date();
    if (input.reason.trim() === "") throw new Error("approval execution disposition requires a reason");
    return this.withExecutionLock(input.id, async () => {
      const item = await this.readItem(input.id);
      const current = item.execution;
      const terminalDisposition = input.disposition === "executed" || input.disposition === "failed";
      const supported =
        current !== undefined &&
        (["ambiguous", "failed"].includes(current.state) ||
          (terminalDisposition && ["approved", "executing"].includes(current.state)));
      if (!supported || current === undefined) {
        throw new Error(
          `approval ${input.id} execution cannot accept ${input.disposition} from ` +
            `${current?.state ?? "untracked"}`,
        );
      }
      let state: ApprovalExecutionState = input.disposition === "retry" ? "approved" : input.disposition;
      let nextAction: ApprovalExecution["nextAction"] = "none";
      if (input.disposition === "retry") {
        state = "approved";
        nextAction = current.executor === "actor-retry" ? "actor_retry" : "dispatch";
        if (item.grantId === undefined) throw new Error(`approval ${input.id} has no grant to re-arm`);
        const grant = readJsonSync<ApprovalGrant>(this.grantPath(item.grantId));
        if (grant.revokedAt !== undefined || new Date(grant.expiresAt).getTime() <= now.getTime()) {
          throw new Error(`approval ${input.id} grant is expired or revoked; raise a fresh approval`);
        }
        writeJsonSync(this.grantPath(item.grantId), { ...grant, uses: 1, consumedAt: undefined });
      } else if (item.grantId !== undefined) {
        const grant = readJsonSync<ApprovalGrant>(this.grantPath(item.grantId));
        if (
          grant.scope === undefined &&
          grant.uses > 0 &&
          grant.consumedAt === undefined &&
          grant.revokedAt === undefined
        ) {
          writeJsonAtomicSync(this.grantPath(item.grantId), {
            ...grant,
            uses: 0,
            revokedAt: now.toISOString(),
          });
          appendJsonLineSync(this.logPath(), {
            type: "grant-revoked",
            id: item.id,
            grantId: grant.grantId,
            at: now.toISOString(),
          } satisfies ApprovalLogEvent);
        }
      }
      const grant =
        item.grantId === undefined || !existsSync(this.grantPath(item.grantId))
          ? undefined
          : readJsonSync<ApprovalGrant>(this.grantPath(item.grantId));
      const attempts =
        current.state === "approved" && grant?.consumedAt !== undefined
          ? Math.max(1, current.attempts)
          : current.attempts;
      const attemptedAt = current.attemptedAt ?? grant?.consumedAt;
      const { failureCause: _failureCause, remoteRef: _remoteRef, ...executionBase } = current;
      const next: ApprovalItem = {
        ...item,
        execution: {
          ...executionBase,
          state,
          attempts,
          actor: input.actor,
          ...(attemptedAt !== undefined ? { attemptedAt } : {}),
          finishedAt: now.toISOString(),
          result: input.reason,
          ...(input.disposition === "failed"
            ? { failureCause: "human_disposition" }
            : input.disposition === "retry" && current.failureCause !== undefined
              ? { failureCause: current.failureCause }
              : {}),
          ...(input.disposition === "executed" && current.remoteRef !== undefined
            ? { remoteRef: current.remoteRef }
            : {}),
          nextAction,
        },
      };
      await writeJsonAtomic(this.decidedPath(input.id), next);
      await this.appendExecutionTransition(item, next, input.actor, now);
      return next;
    });
  }

  async readLog(): Promise<ApprovalLogEvent[]> {
    await this.ensureDirs();
    return readJsonLines<ApprovalLogEvent>(this.logPath());
  }

  async hasOpenItemFor(input: { app: string; role: string; actionHash: string }): Promise<boolean> {
    const pending = await this.listPending();
    return pending.some(
      (item) => item.app === input.app && item.role === input.role && actionHash(item.action) === input.actionHash,
    );
  }

  /** Find the durable record for one exact action across the decision
   * boundary. Callers use this before re-raising event-derived deliveries so
   * a retry cannot manufacture a second approval or remote side effect. */
  async findEquivalent(input: {
    app: string;
    role: string;
    rule: string;
    action: ToolAction;
    ticketRef?: string;
  }): Promise<ApprovalItem | undefined> {
    const hash = actionHash(input.action);
    const matches = (item: ApprovalItem) =>
      item.app === input.app &&
      item.role === input.role &&
      item.rule === input.rule &&
      item.ticketRef === input.ticketRef &&
      actionHash(item.action) === hash;
    return (await this.listPending()).find(matches) ?? (await this.listDecided()).find(matches);
  }

  findDeniedEquivalentSync(input: RaiseApprovalInput): ApprovalItem | undefined {
    this.ensureDirsSync();
    const hash = actionHash(input.action);
    return readdirSync(this.decidedDir())
      .filter((file) => file.endsWith(".json"))
      .map((file) => readJsonSync<ApprovalItem>(join(this.decidedDir(), file)))
      .find(
        (item) =>
          item.status === "denied" &&
          item.app === input.app &&
          item.role === input.role &&
          item.rule === input.rule &&
          item.ticketRef === input.ticketRef &&
          actionHash(item.action) === hash,
      );
  }

  findStalledActorRetryEquivalentSync(input: RaiseApprovalInput): ApprovalItem | undefined {
    this.ensureDirsSync();
    const hash = actionHash(input.action);
    return readdirSync(this.decidedDir())
      .filter((file) => file.endsWith(".json"))
      .map((file) => readJsonSync<ApprovalItem>(join(this.decidedDir(), file)))
      .find(
        (item) =>
          item.app === input.app &&
          item.role === input.role &&
          item.rule === input.rule &&
          item.ticketRef === input.ticketRef &&
          actionHash(item.action) === hash &&
          isActorClaimable(item.execution?.executor) &&
          item.execution !== undefined &&
          actorRetryNeedsReconciliation(item.execution),
      );
  }

  recordDeniedRecurrenceSync(item: ApprovalItem, action: ToolAction, now: Date): void {
    this.ensureDirsSync();
    appendJsonLineSync(this.logPath(), {
      type: "deduplicated",
      id: item.id,
      at: now.toISOString(),
      actionHash: actionHash(action),
      priorStatus: "denied",
    } satisfies ApprovalLogEvent);
  }

  private findPendingEquivalentSync(input: RaiseApprovalInput): ApprovalItem | undefined {
    const hash = actionHash(input.action);
    return readdirSync(this.pendingDir())
      .filter((file) => file.endsWith(".json"))
      .map((file) => readJsonSync<ApprovalItem>(join(this.pendingDir(), file)))
      .find(
        (item) =>
          item.app === input.app &&
          item.role === input.role &&
          item.rule === input.rule &&
          item.ticketRef === input.ticketRef &&
          actionHash(item.action) === hash,
      );
  }

  private itemFromInput(input: RaiseApprovalInput, now: Date): ApprovalItem {
    const item: ApprovalItem = {
      id: this.idSource(now),
      app: input.app,
      role: input.role,
      rule: input.rule,
      action: normalizeAction(input.action),
      raisedAt: now.toISOString(),
      status: "pending",
    };
    if (input.classification !== undefined) item.classification = input.classification;
    if (input.turnId !== undefined) item.turnId = input.turnId;
    if (input.ticketRef !== undefined) item.ticketRef = input.ticketRef;
    if (input.workdir !== undefined) item.workdir = input.workdir;
    if (input.justification !== undefined) item.justification = input.justification;
    return item;
  }

  private async readItem(id: string): Promise<ApprovalItem> {
    if (existsSync(this.pendingPath(id))) return readJson<ApprovalItem>(this.pendingPath(id));
    if (existsSync(this.decidedPath(id))) return readJson<ApprovalItem>(this.decidedPath(id));
    throw new Error(`approval ${id} not found`);
  }

  /** Repair the pre-ISSUE-011 state where composeGate consumed a grant but
   * never began its actor execution. The consumed timestamp becomes durable
   * attempt evidence and the outcome is ambiguous (never guessed from prose).
   * A later revoke remains current grant state; the prior consume is retained
   * in log.jsonl and on execution.attemptedAt, not as contradictory live grant
   * fields. */
  private async reconcileLegacyActorRetryStates(): Promise<void> {
    const candidates = await this.readDecided();
    for (const candidate of candidates) {
      if (
        !isActorClaimable(candidate.execution?.executor) ||
        candidate.execution?.state !== "approved" ||
        candidate.grantId === undefined ||
        !existsSync(this.grantPath(candidate.grantId))
      ) {
        continue;
      }
      await this.withExecutionLock(candidate.id, async () => {
        const item = readJsonSync<ApprovalItem>(this.decidedPath(candidate.id));
        if (!isActorClaimable(item.execution?.executor) || item.execution?.state !== "approved") {
          return;
        }
        if (item.grantId === undefined || !existsSync(this.grantPath(item.grantId))) return;
        const grant = readJsonSync<ApprovalGrant>(this.grantPath(item.grantId));
        const consumedAt = grant.scope === undefined ? grant.consumedAt : undefined;
        if (consumedAt === undefined && grant.revokedAt === undefined) return;

        if (grant.consumedAt !== undefined && grant.revokedAt !== undefined) {
          const { consumedAt: _consumedAt, ...normalized } = grant;
          await writeJsonAtomic(this.grantPath(grant.grantId), normalized);
        }

        const attempted = consumedAt !== undefined;
        const actor = attempted ? "actor-retry/legacy" : "human/operator";
        const finishedAt = grant.revokedAt ?? consumedAt ?? grant.createdAt;
        const next: ApprovalItem = {
          ...item,
          execution: {
            ...item.execution,
            state: attempted ? "ambiguous" : "failed",
            attempts: attempted ? Math.max(1, item.execution.attempts) : item.execution.attempts,
            actor,
            ...(consumedAt !== undefined ? { attemptedAt: consumedAt } : {}),
            finishedAt,
            result: attempted
              ? "legacy actor retry consumed its grant without an acknowledged outcome"
              : "approval grant was revoked before actor execution",
            failureCause: attempted ? "legacy_actor_outcome_unacknowledged" : "grant_revoked",
            nextAction: attempted ? "reconcile" : "none",
          },
        };
        await writeJsonAtomic(this.decidedPath(item.id), next);
        await this.appendExecutionTransition(item, next, actor, new Date(finishedAt));
      });
    }
  }

  private async moveToDecided(item: ApprovalItem): Promise<void> {
    await writeJsonAtomic(this.decidedPath(item.id), item);
    await rm(this.pendingPath(item.id), { force: true });
  }

  private async ensureDirs(): Promise<void> {
    await mkdir(this.pendingDir(), { recursive: true });
    await mkdir(this.decidedDir(), { recursive: true });
    await mkdir(this.grantsDir(), { recursive: true });
    if (!existsSync(this.logPath())) await writeFile(this.logPath(), "", "utf8");
  }

  private ensureDirsSync(): void {
    mkdirSync(this.pendingDir(), { recursive: true });
    mkdirSync(this.decidedDir(), { recursive: true });
    mkdirSync(this.grantsDir(), { recursive: true });
    if (!existsSync(this.logPath())) writeFileSync(this.logPath(), "", "utf8");
  }

  private approvalsDir(): string {
    return join(this.root, "approvals");
  }

  private pendingDir(): string {
    return join(this.approvalsDir(), "pending");
  }

  private decidedDir(): string {
    return join(this.approvalsDir(), "decided");
  }

  private grantsDir(): string {
    return join(this.approvalsDir(), "grants");
  }

  private pendingPath(id: string): string {
    return join(this.pendingDir(), `${id}.json`);
  }

  private decidedPath(id: string): string {
    return join(this.decidedDir(), `${id}.json`);
  }

  private grantPath(id: string): string {
    return join(this.grantsDir(), `${id}.json`);
  }

  private logPath(): string {
    return join(this.approvalsDir(), "log.jsonl");
  }

  private executionLockPath(id: string): string {
    return join(this.approvalsDir(), "execution-locks", `${id}.lock`);
  }

  private decisionLockPath(id: string): string {
    return join(this.approvalsDir(), "decision-locks", `${id}.lock`);
  }

  private async withDecisionLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    return withFileLock(
      this.decisionLockPath(id),
      { staleMs: DECISION_LOCK_STALE_MS, maxWaitMs: DECISION_LOCK_STALE_MS + 5_000 },
      fn,
    );
  }

  private async withExecutionLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    return withFileLock(
      this.executionLockPath(id),
      { staleMs: EXECUTION_LOCK_STALE_MS, maxWaitMs: EXECUTION_LOCK_STALE_MS + 5_000 },
      fn,
    );
  }

  private withExecutionLockSync<T>(id: string, fn: () => T): T {
    return withFileLockSync(this.executionLockPath(id), { staleMs: EXECUTION_LOCK_STALE_MS }, fn);
  }

  private async appendExecutionTransition(
    before: ApprovalItem,
    after: ApprovalItem,
    actor: string,
    now: Date,
  ): Promise<void> {
    const from = before.execution?.state;
    const to = after.execution?.state;
    if (from === undefined || to === undefined || from === to) return;
    await appendJsonLine(this.logPath(), {
      type: "execution-transition",
      id: after.id,
      at: now.toISOString(),
      from,
      to,
      actor,
      ...(after.execution?.failureCause !== undefined ? { cause: after.execution.failureCause } : {}),
      ...(after.execution?.remoteRef !== undefined ? { remoteRef: after.execution.remoteRef } : {}),
    } satisfies ApprovalLogEvent);
  }

  private appendExecutionTransitionSync(before: ApprovalItem, after: ApprovalItem, actor: string, now: Date): void {
    const from = before.execution?.state;
    const to = after.execution?.state;
    if (from === undefined || to === undefined || from === to) return;
    appendJsonLineSync(this.logPath(), {
      type: "execution-transition",
      id: after.id,
      at: now.toISOString(),
      from,
      to,
      actor,
      ...(after.execution?.failureCause !== undefined ? { cause: after.execution.failureCause } : {}),
      ...(after.execution?.remoteRef !== undefined ? { remoteRef: after.execution.remoteRef } : {}),
    } satisfies ApprovalLogEvent);
  }
}

export function normalizeAction(action: ToolAction | ApprovalAction): ApprovalAction {
  const normalized: ApprovalAction = {
    tool: action.tool.toLowerCase(),
    input: sortJson(action.input),
  };
  if (action.description !== undefined) normalized.description = action.description;
  return normalized;
}

function decisionReason(input: DecideApprovalInput, decidedBy: ApprovalDecider): string {
  if (decidedBy.identity.trim().length === 0) {
    throw new Error("approval decision requires a non-empty deciding identity");
  }
  const supplied = input.reason?.trim();
  if (input.decision === "denied" && (supplied ?? "").length === 0) {
    throw new Error("approval denial requires a non-empty reason");
  }
  if (input.reason !== undefined && (supplied ?? "").length === 0) {
    throw new Error("approval decision requires a non-empty reason");
  }
  if (supplied !== undefined && /^[ads]$/i.test(supplied)) {
    throw new Error(`approval decision reason "${supplied}" is a bare decision token; provide an actual justification`);
  }
  return supplied ?? `approved by ${decidedBy.identity}`;
}

export function approvalLifecycleState(item: ApprovalItem): ApprovalLifecycleState {
  if (item.status === "pending") return "pending";
  // Existing delivery projections have no expired vocabulary and must treat
  // it as a terminal non-authorization. Audit surfaces read item.status and
  // retain the distinct CF-SM-APPR `expired` state.
  if (item.status === "expired") return "denied";
  if (item.status === "denied") return "denied";
  return item.execution?.state ?? "approved";
}

function initialExecution(item: ApprovalItem): ApprovalExecution {
  const executor =
    item.rule === "production-deploy"
      ? ("release" as const)
      : item.action.tool === "cormidia.github.issue.create" || item.action.tool === "cormidia.github.issue.comment"
        ? ("durable-github" as const)
        : approvedCommand(item.action) !== undefined && isOrchestratorExecutableRule(item.rule)
          ? ("orchestrator-command" as const)
          : ("actor-retry" as const);
  return {
    state: "approved",
    executor,
    idempotencyKey: `approval:${item.id}:${actionHash(item.action)}`,
    attempts: 0,
    nextAction: executor === "actor-retry" ? "actor_retry" : "dispatch",
  };
}

/** Tool names whose action IS a shell command string. Kept exact and closed:
 *  an approval authorizes one recorded action, so the executor must recognize
 *  the action shape it can reproduce byte-for-byte and refuse everything
 *  else. */
const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "shell", "sh", "zsh", "terminal", "exec", "exec_command"]);

/** The exact command an approved shell action authorizes, or undefined when
 *  the action is not one. This is the ONLY thing an `orchestrator-command`
 *  execution may run: no rewriting, no re-quoting, no substitution — the same
 *  string the human read in `cormidia approvals show`. */
export function approvedCommand(action: ApprovalAction | ToolAction): string | undefined {
  if (!SHELL_TOOLS.has(action.tool.trim().toLowerCase())) return undefined;
  const input = action.input;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  const command =
    typeof record["command"] === "string"
      ? record["command"]
      : typeof record["cmd"] === "string"
        ? record["cmd"]
        : undefined;
  return command === undefined || command.trim() === "" ? undefined : command;
}

/** SHA-256 over the raw command bytes. Deliberately NOT `actionHash`: this is
 *  the EXECUTION identity (what will actually run), not the AUTHORIZATION
 *  identity (what the rules and grants reason about). Keeping them separate is
 *  the point — the semantic projection folds away wrapper prefixes so a
 *  classifier cannot be dodged by adding one, and that same folding must never
 *  let a later edit change what the orchestrator runs. */
export function commandIdentityHash(command: string): string {
  return createHash("sha256").update(command, "utf8").digest("hex");
}

/** Executors a provider turn may still claim through the gate. An
 *  `orchestrator-command` approval authorizes the agent's own recorded
 *  command, so a live actor re-attempting it is exactly the approved effect
 *  and must not be denied — it simply beats the orchestrator to the single-use
 *  grant. `durable-github` and `release` stay orchestrator-only: those carry
 *  typed content-bound deliveries and the A4 release episode, which an agent
 *  must never enact itself. */
function isActorClaimable(executor: ApprovalExecutor | undefined): boolean {
  return executor === "actor-retry" || executor === "orchestrator-command";
}

/** Action-identity format version. The identity `actionHash` computes is the
 *  authorization key: a grant authorizes exactly the actions whose identity it
 *  covers. Bumping this constant invalidates every persisted grant — new hashes
 *  no longer equal the old stored ones, and `findMatchingGrantSync` refuses any
 *  grant whose `identityVersion` is not current (covering scoped grants, which
 *  match by rule/path rather than hash). v1 (pre-2026-07-17) was the
 *  payload-blind projection reused verbatim from CLASSIFICATION, so a human who
 *  approved Write X authorized Write Y on the same (tool, path) pair (A-002).
 *  v2 binds the payload. v3 replaces raw shell/prose scope text with parsed,
 *  effect-bearing targets and redirections. v4 cancels in-flight grants at the
 *  §5.1 consequence-split landing (#296, owner decision 5: "in-flight grants
 *  cancel at landing" — the A-002 precedent): classification semantics for the
 *  destructive family changed, so authority minted under the old semantics
 *  stops matching and agents simply re-raise. v5 repeats that cancellation at
 *  the §5.2 secrets split landing, v6 at the §5.4 outbound refinement, and
 *  v7 at the §5.3 publishing split. Each migration is intentional and
 *  abrupt: the instant it lands, in-flight grants stop matching, agents
 *  re-raise, and the miss path yields a fresh approval item — never a crash. */
export const ACTION_IDENTITY_VERSION = 7;

/** Input keys `normalizeSemanticAction` (src/runtime/gate.ts) already folds
 *  into the semantic identity. Everything ELSE in the input is agent-authored
 *  PAYLOAD — a Write `content`, an Edit `old_string`/`new_string`, an
 *  apply_patch `unified_diff`, a structured `body` — which the authorization
 *  identity must bind: `payloadIdentity` below treats every key listed here as
 *  "already bound by `semantic`" and excludes it from the residual it hashes.
 *
 *  Keep this EXACTLY in sync with the keys `normalizeSemanticAction` reads.
 *  The dangerous direction is OVER-listing: a key present here that
 *  `normalizeSemanticAction` does NOT actually consume is excluded from the
 *  residual (assumed already in `semantic`) while also being absent from
 *  `semantic` itself (never read there) — bound in NEITHER projection, so two
 *  actions differing only in that key hash identically. That is a live A-002
 *  regression: a human's grant for one silently covers the other.
 *  Under-listing a key `normalizeSemanticAction` DOES consume is harmless: the
 *  key lands in `semantic` (the real binding) and, because it's missing from
 *  this set, ALSO in the residual — a double-count, not a collision. The
 *  behavioral regression test in test/approval-semantics.test.ts
 *  ("SEMANTIC_INPUT_KEYS binds every denylisted key") fails the instant a
 *  listed key stops being consumed here. */
export const SEMANTIC_INPUT_KEYS: ReadonlySet<string> = new Set([
  "command",
  "cmd",
  "path",
  "file_path",
  "target",
  "destination",
  "resolved_path",
  "real_path",
  "effect",
]);

/** The agent-authored payload the CLASSIFICATION projection deliberately
 *  discards (gate.ts:25-27 — "docs that mention `kubectl apply` are not a
 *  deploy") but the AUTHORIZATION identity must bind. Returns a canonical value
 *  over every input field the semantic projection does not consume, or null
 *  when there is none — the analogue of publisher.ts `final_diff_hash`
 *  (sha256Ref over the exact bytes): a changed payload is a different
 *  authorization, so it re-raises instead of riding a stale grant. A bash
 *  `command` is the semantic identity itself, so a shell action carries no
 *  residual payload and its identity is unchanged. */
function payloadIdentity(action: ToolAction | ApprovalAction, semantic: SemanticAction): unknown {
  const input = action.input;
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) {
    // A primitive/array input is either the command (already in `semantic`) or
    // opaque payload; bind it only when the projection did not consume it.
    return semantic.command === null ? input : null;
  }
  const residual: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!SEMANTIC_INPUT_KEYS.has(key)) residual[key] = value;
  }
  return Object.keys(residual).length === 0 ? null : residual;
}

/** The authorization identity of an action: the payload-free semantic
 *  projection PLUS the agent-authored payload PLUS the format version. This is
 *  deliberately NOT the classification projection — `classify()` stays
 *  payload-blind (gate.ts) so prose about a deploy is not a deploy, while a
 *  human's approval binds the exact bytes they saw (A-002). */
export function actionHash(action: ToolAction | ApprovalAction): string {
  const semantic = normalizeSemanticAction(action);
  return createHash("sha256")
    .update(
      stableStringify({
        v: ACTION_IDENTITY_VERSION,
        semantic,
        payload: payloadIdentity(action, semantic),
      }),
    )
    .digest("hex");
}

export interface ApprovalMetrics {
  decided: number;
  approved: number;
  denied: number;
  precision: number | null;
  recurrence: number;
  meanDecisionMs: number | null;
}

export function computeApprovalMetrics(
  items: readonly ApprovalItem[],
  log: readonly ApprovalLogEvent[] = [],
  isGenuine?: (item: ApprovalItem) => boolean,
): ApprovalMetrics {
  const decided = items.filter((item) => item.decidedAt !== undefined);
  const approved = decided.filter((item) => item.decision === "approved").length;
  const denied = decided.filter((item) => item.decision === "denied").length;
  const times = decided.map((item) =>
    Math.max(0, new Date(item.decidedAt!).getTime() - new Date(item.raisedAt).getTime()),
  );
  return {
    decided: decided.length,
    approved,
    denied,
    precision:
      items.length === 0 || isGenuine === undefined
        ? null
        : items.filter((item) => isGenuine(item)).length / items.length,
    recurrence: log.filter((event) => event.type === "deduplicated" && event.priorStatus === "denied").length,
    meanDecisionMs: times.length === 0 ? null : times.reduce((sum, value) => sum + value, 0) / times.length,
  };
}

function mintGrant(
  item: ApprovalItem,
  now: Date,
  ttlMs: number,
  scope?: { kind: "ticket" | "app"; pathContains?: string },
  maxUses?: number,
): ApprovalGrant {
  // Only an exact single-use grant can carry a literal binding: a scoped grant
  // exists precisely to cover more than one command.
  const literal = scope === undefined ? approvedCommand(item.action) : undefined;
  return {
    grantId: `grant-${item.id}`,
    approvalId: item.id,
    app: item.app,
    role: item.role,
    actionHash: actionHash(item.action),
    ...(literal !== undefined ? { commandSha256: commandIdentityHash(literal) } : {}),
    identityVersion: ACTION_IDENTITY_VERSION,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    uses: scope !== undefined ? (maxUses ?? DEFAULT_SCOPED_MAX_USES) : 1,
    createdAt: now.toISOString(),
    ...(scope !== undefined
      ? {
          scope: {
            kind: scope.kind,
            rule: item.rule,
            ...(scope.kind === "ticket" && item.ticketRef !== undefined ? { ticketRef: item.ticketRef } : {}),
            ...(scope.pathContains !== undefined ? { pathContains: scope.pathContains } : {}),
          },
        }
      : {}),
  };
}

function raisedEvent(item: ApprovalItem): ApprovalLogEvent {
  return {
    type: "raised",
    id: item.id,
    at: item.raisedAt,
    app: item.app,
    role: item.role,
    rule: item.rule,
  };
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortJson(v)]),
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function defaultId(now: Date): string {
  const compact = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const rand4 = randomBytes(3).toString("base64url").slice(0, 4).toLowerCase();
  return `${compact}-${rand4}`;
}

async function listJsonIds(dir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  return (await readdir(dir))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort();
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function readJsonSync<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** tmp+rename write so a reader (or a crash mid-write) never sees a truncated
 *  grant file. */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

function writeJsonSync(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonAtomicSync(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

function appendJsonLineSync(path: string, value: unknown): void {
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function readJsonLines<T>(path: string): Promise<T[]> {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

function explicitOutcomesFor(action: ApprovalAction, events: readonly TurnEvent[]): boolean[] {
  const expected = actionHash(action);
  const outcomes: boolean[] = [];
  for (const event of events) {
    if (
      event.type !== "tool_use" ||
      event.name === undefined ||
      event.args === undefined ||
      event.success === undefined
    ) {
      continue;
    }
    if (actionHash({ tool: event.name, input: event.args }) === expected) {
      outcomes.push(event.success);
    }
  }
  return outcomes;
}

function actorRetryNeedsReconciliation(execution: ApprovalExecution): boolean {
  return (
    execution.state === "executing" ||
    execution.state === "ambiguous" ||
    (execution.state === "failed" && execution.nextAction !== "none")
  );
}
