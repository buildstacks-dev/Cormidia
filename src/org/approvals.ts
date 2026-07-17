// File-backed approval queue and single-use grants (architecture.md §4).
// The runtime gate is synchronous, so grant lookup/consumption also has a
// synchronous path; operator-facing queue operations remain async.

import { createHash, randomBytes } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
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
import type { ToolAction } from "../runtime/types.js";
import { normalizeSemanticAction, type SemanticAction } from "../runtime/gate.js";

export type ApprovalDecision = "approved" | "denied";
export type ApprovalStatus = "pending" | ApprovalDecision;

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
  justification?: string;
  raisedAt: string;
  status: ApprovalStatus;
  decidedAt?: string;
  decision?: ApprovalDecision;
  reason?: string;
  grantId?: string;
}

/** Human-chosen widened grant scope (approval-and-release-amendment A1).
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
  /** A1: present on multi-use rule+path-scoped grants. */
  scope?: GrantScope;
  /** Set by `operon approvals revoke` — a revoked grant never matches. */
  revokedAt?: string;
  /** The action-identity format this grant was minted under (see
   *  ACTION_IDENTITY_VERSION). `findMatchingGrantSync` refuses any grant whose
   *  version is not current, so a format bump cancels every in-flight grant:
   *  agents re-raise and the miss path yields a fresh approval item. Absent on
   *  pre-2026-07-17 (v1, payload-blind) grants — they never match again. */
  identityVersion?: number;
}

/** Rules the human may never widen beyond single-use (amendment A1): the
 *  review boundary, production deploys, the org's own protocol surfaces, and
 *  the gate's root of trust. */
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

export const NEVER_SCOPEABLE_RULES: readonly string[] = [
  "self-merge-or-approve",
  "production-deploy",
  "protocol-self-edit",
  "scorecard-tamper",
  "approval-store-tamper",
  // One human decision authorizes ONE content-hashed publish transaction
  // (learning-loop design §6.1/§11.1) — a multi-use scoped grant would turn
  // that into a standing authorization the binding contract forbids.
  "learning-publish",
];

const DEFAULT_SCOPED_MAX_USES = 20;

export type ApprovalLogEvent =
  | { type: "raised"; id: string; at: string; app: string; role: string; rule: string }
  | {
      type: "decided";
      id: string;
      at: string;
      decision: ApprovalDecision;
      reason?: string;
      grantId?: string;
      grant?: ApprovalGrant;
    }
  | { type: "grant-minted"; id: string; grantId: string; at: string }
  | { type: "grant-consumed"; id: string; grantId: string; at: string }
  | { type: "grant-revoked"; id: string; grantId: string; at: string }
  | { type: "deduplicated"; id: string; at: string; actionHash: string; priorStatus: "pending" | "denied" };

export interface RaiseApprovalInput {
  app: string;
  role: string;
  rule: string;
  action: ToolAction;
  turnId?: string;
  ticketRef?: string;
  justification?: string;
  now?: Date;
}

export interface DecideApprovalInput {
  decision: ApprovalDecision;
  reason?: string;
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
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export class ApprovalStore {
  readonly root: string;
  private readonly idSource: (now: Date) => string;

  constructor(root: string, options: ApprovalStoreOptions = {}) {
    this.root = root;
    this.idSource = options.idSource ?? defaultId;
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
    if (input.decision === "denied" && (input.reason ?? "").trim().length === 0) {
      throw new Error("approval denial requires a non-empty reason");
    }

    const pending = await readJson<ApprovalItem>(this.pendingPath(id));
    if (pending.status !== "pending") {
      throw new Error(`approval ${id} is not pending`);
    }

    const decided: ApprovalItem = {
      ...pending,
      status: input.decision,
      decision: input.decision,
      decidedAt: now.toISOString(),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    };

    if (input.scope !== undefined && NEVER_SCOPEABLE_RULES.includes(pending.rule)) {
      throw new Error(
        `approvals: rule "${pending.rule}" is never scopeable (approval-and-release-amendment A1) — ` +
          `decide it single-use`,
      );
    }
    const grant =
      input.decision === "approved"
        ? mintGrant(decided, now, input.ttlMs ?? DEFAULT_TTL_MS, input.scope, input.maxUses)
        : undefined;
    if (grant !== undefined) decided.grantId = grant.grantId;

    // Materialize the grant on disk BEFORE the decided log records the
    // approval. findMatchingGrantSync only reads grants/*.json, so if the
    // process died after the decided-log append but before the grant landed,
    // the approved action would have no consumable grant and the very next
    // gated turn would re-escalate a decision the human already made. Writing
    // the grant first (atomically) closes that window; the log still carries
    // the embedded grant so reconcile() can rebuild it if the file is lost.
    if (grant !== undefined) {
      await writeJsonAtomic(this.grantPath(grant.grantId), grant);
    }
    await appendJsonLine(this.logPath(), {
      type: "decided",
      id,
      at: now.toISOString(),
      decision: input.decision,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(grant !== undefined ? { grantId: grant.grantId, grant } : {}),
    } satisfies ApprovalLogEvent);
    await this.moveToDecided(decided);
    if (grant !== undefined) {
      await appendJsonLine(this.logPath(), {
        type: "grant-minted",
        id,
        grantId: grant.grantId,
        at: now.toISOString(),
      } satisfies ApprovalLogEvent);
    }
    return decided;
  }

  async reconcile(): Promise<void> {
    await this.ensureDirs();
    const log = await this.readLog();
    const decisions = log.filter((e): e is Extract<ApprovalLogEvent, { type: "decided" }> => {
      return e.type === "decided";
    });
    for (const event of decisions) {
      const decidedExists = existsSync(this.decidedPath(event.id));
      if (!decidedExists && existsSync(this.pendingPath(event.id))) {
        const pending = await readJson<ApprovalItem>(this.pendingPath(event.id));
        const decided: ApprovalItem = {
          ...pending,
          status: event.decision,
          decision: event.decision,
          decidedAt: event.at,
          ...(event.reason !== undefined ? { reason: event.reason } : {}),
          ...(event.grantId !== undefined ? { grantId: event.grantId } : {}),
        };
        await this.moveToDecided(decided);
      }
      if (event.grant !== undefined && !existsSync(this.grantPath(event.grant.grantId))) {
        await writeJson(this.grantPath(event.grant.grantId), event.grant);
      }
      if (
        event.grantId !== undefined &&
        !log.some((e) => e.type === "grant-minted" && e.grantId === event.grantId)
      ) {
        await appendJsonLine(this.logPath(), {
          type: "grant-minted",
          id: event.id,
          grantId: event.grantId,
          at: event.at,
        } satisfies ApprovalLogEvent);
      }
    }
  }

  findMatchingGrantSync(input: {
    app: string;
    role: string;
    actionHash: string;
    /** Rule + action text + ticket enable A1 scoped-grant matching; omitted,
     *  only exact action-hash grants match (the ratified default). The caller
     *  MUST pass the action's NORMALIZED target paths (+ command) as
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
      if (grant.scope === undefined) {
        if (grant.actionHash === input.actionHash) return grant;
        continue;
      }
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
   *  records the act. */
  revokeGrantSync(grantId: string, now: Date = new Date()): ApprovalGrant {
    this.ensureDirsSync();
    const path = this.grantPath(grantId);
    const grant = readJsonSync<ApprovalGrant>(path);
    const next: ApprovalGrant = { ...grant, uses: 0, revokedAt: now.toISOString() };
    writeJsonSync(path, next);
    appendJsonLineSync(this.logPath(), {
      type: "grant-revoked",
      id: next.approvalId,
      grantId: next.grantId,
      at: now.toISOString(),
    } satisfies ApprovalLogEvent);
    return next;
  }

  consumeGrantSync(grantId: string, now: Date = new Date()): ApprovalGrant {
    this.ensureDirsSync();
    const path = this.grantPath(grantId);
    const grant = readJsonSync<ApprovalGrant>(path);
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

  async readLog(): Promise<ApprovalLogEvent[]> {
    await this.ensureDirs();
    return readJsonLines<ApprovalLogEvent>(this.logPath());
  }

  async hasOpenItemFor(input: { app: string; role: string; actionHash: string }): Promise<boolean> {
    const pending = await this.listPending();
    return pending.some(
      (item) =>
        item.app === input.app &&
        item.role === input.role &&
        actionHash(item.action) === input.actionHash,
    );
  }

  findDeniedEquivalentSync(input: RaiseApprovalInput): ApprovalItem | undefined {
    this.ensureDirsSync();
    const hash = actionHash(input.action);
    return readdirSync(this.decidedDir())
      .filter((file) => file.endsWith(".json"))
      .map((file) => readJsonSync<ApprovalItem>(join(this.decidedDir(), file)))
      .find((item) =>
        item.status === "denied" &&
        item.app === input.app &&
        item.role === input.role &&
        item.rule === input.rule &&
        item.ticketRef === input.ticketRef &&
        actionHash(item.action) === hash,
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
      .find((item) =>
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
    if (input.turnId !== undefined) item.turnId = input.turnId;
    if (input.ticketRef !== undefined) item.ticketRef = input.ticketRef;
    if (input.justification !== undefined) item.justification = input.justification;
    return item;
  }

  private async readItem(id: string): Promise<ApprovalItem> {
    if (existsSync(this.pendingPath(id))) return readJson<ApprovalItem>(this.pendingPath(id));
    if (existsSync(this.decidedPath(id))) return readJson<ApprovalItem>(this.decidedPath(id));
    throw new Error(`approval ${id} not found`);
  }

  private async moveToDecided(item: ApprovalItem): Promise<void> {
    const temp = join(this.decidedDir(), `${item.id}.json.tmp`);
    await writeJson(temp, item);
    await rename(temp, this.decidedPath(item.id));
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
}

export function normalizeAction(action: ToolAction | ApprovalAction): ApprovalAction {
  const normalized: ApprovalAction = {
    tool: action.tool.toLowerCase(),
    input: sortJson(action.input),
  };
  if (action.description !== undefined) normalized.description = action.description;
  return normalized;
}

/** Action-identity format version. The identity `actionHash` computes is the
 *  authorization key: a grant authorizes exactly the actions whose identity it
 *  covers. Bumping this constant invalidates every persisted grant — new hashes
 *  no longer equal the old stored ones, and `findMatchingGrantSync` refuses any
 *  grant whose `identityVersion` is not current (covering scoped grants, which
 *  match by rule/path rather than hash). v1 (pre-2026-07-17) was the
 *  payload-blind projection reused verbatim from CLASSIFICATION, so a human who
 *  approved Write X authorized Write Y on the same (tool, path) pair (A-002).
 *  v2 binds the payload. The migration is intentional and abrupt: the instant
 *  the fix lands, in-flight grants stop matching, agents re-raise, and the miss
 *  path yields a fresh approval item — never a crash. */
export const ACTION_IDENTITY_VERSION = 2;

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
  return {
    grantId: `grant-${item.id}`,
    approvalId: item.id,
    app: item.app,
    role: item.role,
    actionHash: actionHash(item.action),
    identityVersion: ACTION_IDENTITY_VERSION,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    uses: scope !== undefined ? maxUses ?? DEFAULT_SCOPED_MAX_USES : 1,
    createdAt: now.toISOString(),
    ...(scope !== undefined
      ? {
          scope: {
            kind: scope.kind,
            rule: item.rule,
            ...(scope.kind === "ticket" && item.ticketRef !== undefined
              ? { ticketRef: item.ticketRef }
              : {}),
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
  const compact = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
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
