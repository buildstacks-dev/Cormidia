// Objective grants — authority with a lifetime longer than one commit
// (#296 Stage 3; proposal §6–§7 preserved at 929c8247:docs/approvals/consequence-classification-proposal.md).
//
// An ObjectiveGrant is a durable, HUMAN-CREATED-ONLY authority object bound to
// an objective rather than a candidate hash: when the candidate commit moves,
// the evidence tied to the old commit expires but the objective's authority
// does not (docs/DEVELOPMENT.md). It is inert until a human creates one —
// with no grant on disk, the gate behaves byte-identically to before this
// module existed, and `findCoveringGrantSync` materializes nothing.
//
// Tier boundaries (enforced at CREATION, and again fail-closed at use so a
// forged file cannot smuggle authority past the creation path):
//   - `grantable`-tier classes may be covered by the ordinary path;
//   - `human-only`-tier classes may be covered ONLY through the §4.1 ceremony
//     (explicit per-class naming with a bounded scope, optional precondition,
//     and TTL/use caps strictly shorter than the ordinary defaults, reached
//     through a distinct CLI verb);
//   - `un-grantable`-tier classes are rejected at creation, always — no grant
//     of any kind can ever cover the machinery of consent.
//
// Spend (§7): one cumulative append-only ledger per grant in the org state
// home. Debits land BEFORE execution under a file lock; crossing the ceiling
// refuses the debit and raises ONE `objective-budget-exceeded` item (reusing
// the turn-budget-exceeded shape, converging on a stable key). Ceiling
// exhaustion is never a pass: an exhausted grant covers nothing, so gated
// actions escalate normally. The ceiling default is CONFIGURED, never
// hardcoded — `objective_budget_usd` resolves through apps.yaml exactly like
// `budget_usd_month`, with no special case for Cormidia as its own customer.

import { randomBytes } from "node:crypto";
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
import { withFileLock } from "../runtime/file-lock.js";
import { RULE_DISPOSITION_TIERS, dispositionTierForRule } from "../runtime/gate.js";
import { ApprovalStore, approvalDeciderFromIdentity, type ApprovalItem } from "./approvals.js";
import { OBJECTIVE_BUDGET_RULE } from "./budget.js";
import { definedProps } from "../runtime/optional-properties.js";

/** Tiers an objective grant may name in bulk. `human-only` is deliberately
 *  absent — human-only classes are covered only per-class through the §4.1
 *  ceremony — and `un-grantable` can never appear anywhere. */
type ObjectiveGrantTier = "routine" | "budgeted" | "grantable";

const OBJECTIVE_GRANT_TIERS: readonly ObjectiveGrantTier[] = ["routine", "budgeted", "grantable"];

/** §4.1 ceremony entry: one explicitly named human-only class with a bounded
 *  scope and an optional precondition, recorded verbatim for the audit. */
interface ObjectiveCriticalClass {
  rule: string;
  /** Bounded scope for this class (package name, version pattern, repo, host,
   *  target). "Publish cormidia@0.1.x" is a decision; "publish anything" is a
   *  blank cheque — empty scope is rejected. */
  scope: string;
  precondition?: string;
}

export interface ObjectiveGrant {
  grantId: string;
  objective: string;
  /** Org app the grant covers — the matching key, same as every A1 grant. */
  app: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  /** Hard cumulative bound, raisable only by a human editing the grant. */
  spendCeilingUsd: number;
  tiers: ObjectiveGrantTier[];
  /** Grantable-tier classes covered by the ordinary path. */
  classes: string[];
  /** Human-only classes covered through the §4.1 ceremony. */
  criticalClasses: ObjectiveCriticalClass[];
  /** Declared external scope (e.g. "cormidia/Cormidia"); consumed by the
   *  target-repo verification the §5 splits add. Recorded, validated
   *  non-empty, never widened by an agent. */
  repoNamespace: string;
  /** Invariant, not a setting: creation rejects anything but `false`. */
  outwardEffects: false;
  usesRemaining: number;
  revokedAt?: string;
}

/** Objective-grant defaults are independently 24h / 20 uses, not A1's 48h approval-grant TTL.
 *  The §4.1 ceremony requires BOTH strictly shorter than these. */
export const OBJECTIVE_GRANT_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const OBJECTIVE_GRANT_DEFAULT_USE_CAP = 20;
const OBJECTIVE_CRITICAL_DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const OBJECTIVE_CRITICAL_DEFAULT_USE_CAP = 10;

export interface CreateObjectiveGrantInput {
  app: string;
  objective: string;
  /** Identity of the creating human. Agent-namespaced identities
   *  (`agent:`/`agent/`) are rejected — objective grants are written only by
   *  the human-facing CLI path, same constraint as A1 grants. */
  createdBy: string;
  repoNamespace: string;
  spendCeilingUsd: number;
  tiers?: ObjectiveGrantTier[];
  classes?: string[];
  criticalClasses?: ObjectiveCriticalClass[];
  ttlMs?: number;
  useCap?: number;
  outwardEffects?: boolean;
  now?: Date;
}

type ObjectiveGrantLogEvent =
  | {
      type: "objective-grant-created";
      grantId: string;
      at: string;
      app: string;
      objective: string;
      createdBy: string;
      classes: string[];
      criticalClasses: ObjectiveCriticalClass[];
      spendCeilingUsd: number;
      expiresAt: string;
      usesRemaining: number;
    }
  | {
      /** Per-use audit row (§4.1): the owner can always reconstruct what
       *  their grant actually authorized. */
      type: "objective-grant-used";
      grantId: string;
      at: string;
      rule: string;
      actionHash: string;
      usesRemaining: number;
    }
  | { type: "objective-grant-revoked"; grantId: string; at: string }
  | {
      /** A grantless budgeted-tier action proceeded at the composed gate
       *  (#296 §5.1+; ratified "free until it isn't"). The row IS the signal:
       *  runaway budgeted loops show up here, never as silence. The debit
       *  quantum and hard bound for the grantless case are F-PT-024. */
      type: "budgeted-action";
      at: string;
      app: string;
      rule: string;
      actionHash: string;
    }
  | { type: "objective-spend-debited"; grantId: string; at: string; usd: number; totalUsd: number; note?: string }
  | {
      type: "objective-spend-refused";
      grantId: string;
      at: string;
      usd: number;
      totalUsd: number;
      ceilingUsd: number;
      escalationId?: string;
    };

interface LedgerRow {
  at: string;
  usd: number;
  note?: string;
}

interface ObjectiveDebitResult {
  ok: boolean;
  /** Cumulative spend after (ok) or without (refused) this debit. */
  totalUsd: number;
  ceilingUsd: number;
  /** Present when the refusal raised (or converged on) the one escalation. */
  escalation?: ApprovalItem;
}

/** Stable identity of one grant's ceiling escalation: re-raising converges on
 *  the existing item instead of minting a second (turn-budget pattern). */
export function objectiveBudgetEscalationKey(grantId: string): string {
  return `objective-budget:${grantId}`;
}

export class ObjectiveGrantStore {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  createSync(input: CreateObjectiveGrantInput): ObjectiveGrant {
    const now = input.now ?? new Date();
    const decider = approvalDeciderFromIdentity(input.createdBy);
    if (decider.kind !== "human") {
      throw new Error(
        `objective grants are created only by a human-facing CLI path; ` + `"${input.createdBy}" is an agent identity`,
      );
    }
    if (input.app.trim().length === 0) throw new Error("objective grant requires an app");
    if (input.objective.trim().length === 0) throw new Error("objective grant requires a non-empty objective");
    if (input.repoNamespace.trim().length === 0) {
      throw new Error("objective grant requires a repoNamespace (e.g. owner/repo)");
    }
    if (input.outwardEffects === true) {
      throw new Error("objective grant outwardEffects is an invariant, not a setting: it is always false");
    }
    if (!Number.isFinite(input.spendCeilingUsd) || input.spendCeilingUsd <= 0) {
      throw new Error("objective grant spendCeilingUsd must be a positive finite number");
    }

    const tiers = input.tiers ?? [...OBJECTIVE_GRANT_TIERS];
    for (const tier of tiers) {
      if (!OBJECTIVE_GRANT_TIERS.includes(tier)) {
        throw new Error(
          `objective grant tiers may never include "${tier}" — ` +
            `human-only coverage is per-class §4.1 ceremony, and un-grantable can never be covered`,
        );
      }
    }

    const classes = input.classes ?? [];
    const criticalClasses = input.criticalClasses ?? [];
    if (classes.length === 0 && criticalClasses.length === 0) {
      throw new Error("objective grant must name at least one class");
    }

    for (const rule of classes) {
      if (rule.includes("*") || rule.trim().length === 0) {
        throw new Error("objective grant classes are named explicitly — never a wildcard");
      }
      if (!(rule in RULE_DISPOSITION_TIERS)) {
        throw new Error(`objective grant class "${rule}" is not a known rule`);
      }
      const tier = dispositionTierForRule(rule);
      if (tier === "un-grantable") {
        throw new Error(
          `objective grant may never cover "${rule}": its tier is un-grantable — ` +
            `the machinery of consent cannot be delegated (proposal §4.2)`,
        );
      }
      if (tier === "human-only") {
        throw new Error(
          `objective grant class "${rule}" is human-only: cover it through the §4.1 ` +
            `ceremony path (grant-critical), never the ordinary class list`,
        );
      }
      // A grantable-tier class requires the grantable tier named; a
      // budgeted-tier class (#296 §5.1+) requires the budgeted tier named —
      // the tiers list is what the owner read they were granting.
      if (!tiers.includes(tier === "budgeted" ? "budgeted" : "grantable")) {
        throw new Error(
          `objective grant class "${rule}" requires the "${tier === "budgeted" ? "budgeted" : "grantable"}" tier to be named`,
        );
      }
    }

    for (const critical of criticalClasses) {
      if (critical.rule.includes("*") || critical.rule.trim().length === 0) {
        throw new Error("§4.1 classes are named explicitly, one class per entry — never a wildcard");
      }
      if (!(critical.rule in RULE_DISPOSITION_TIERS)) {
        throw new Error(`objective grant critical class "${critical.rule}" is not a known rule`);
      }
      const tier = dispositionTierForRule(critical.rule);
      if (tier === "un-grantable") {
        throw new Error(
          `objective grant may never cover "${critical.rule}": its tier is un-grantable — ` +
            `rejected at creation, not filtered at use (proposal §4.2)`,
        );
      }
      if (tier !== "human-only") {
        throw new Error(
          `objective grant critical class "${critical.rule}" is ${tier}, not human-only — ` +
            `name it in the ordinary class list instead`,
        );
      }
      if (critical.scope.trim().length === 0) {
        throw new Error(
          `§4.1 requires a bounded scope for "${critical.rule}" — ` + `"publish anything" is a blank cheque`,
        );
      }
    }

    const ceremony = criticalClasses.length > 0;
    const ttlMs = input.ttlMs ?? (ceremony ? OBJECTIVE_CRITICAL_DEFAULT_TTL_MS : OBJECTIVE_GRANT_DEFAULT_TTL_MS);
    const useCap = input.useCap ?? (ceremony ? OBJECTIVE_CRITICAL_DEFAULT_USE_CAP : OBJECTIVE_GRANT_DEFAULT_USE_CAP);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("objective grant ttlMs must be positive");
    if (!Number.isInteger(useCap) || useCap <= 0) throw new Error("objective grant useCap must be a positive integer");
    if (ceremony && ttlMs >= OBJECTIVE_GRANT_DEFAULT_TTL_MS) {
      throw new Error(
        "§4.1 requires a TTL strictly shorter than the ordinary objective-grant default (24h) — stakes scale the blast radius of a mistake",
      );
    }
    if (ceremony && useCap >= OBJECTIVE_GRANT_DEFAULT_USE_CAP) {
      throw new Error("§4.1 requires a use cap strictly shorter than the ordinary objective-grant default (20 uses)");
    }

    const grant: ObjectiveGrant = {
      grantId: objectiveGrantId(now),
      objective: input.objective.trim(),
      app: input.app,
      createdBy: decider.identity,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      spendCeilingUsd: input.spendCeilingUsd,
      tiers,
      classes,
      criticalClasses,
      repoNamespace: input.repoNamespace.trim(),
      outwardEffects: false,
      usesRemaining: useCap,
    };
    this.ensureDirSync();
    writeJsonAtomicSync(this.grantPath(grant.grantId), grant);
    this.appendLogSync({
      type: "objective-grant-created",
      grantId: grant.grantId,
      at: grant.createdAt,
      app: grant.app,
      objective: grant.objective,
      createdBy: grant.createdBy,
      classes: grant.classes,
      criticalClasses: grant.criticalClasses,
      spendCeilingUsd: grant.spendCeilingUsd,
      expiresAt: grant.expiresAt,
      usesRemaining: grant.usesRemaining,
    });
    return grant;
  }

  listSync(): ObjectiveGrant[] {
    if (!existsSync(this.dir())) return [];
    return readdirSync(this.dir())
      .filter((file) => file.endsWith(".json"))
      .map((file) => readJsonSync<ObjectiveGrant>(join(this.dir(), file)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  readSync(grantId: string): ObjectiveGrant {
    return readJsonSync<ObjectiveGrant>(this.grantPath(grantId));
  }

  /** Immediate revocation: a revoked grant never covers again. */
  revokeSync(grantId: string, now: Date = new Date()): ObjectiveGrant {
    const grant = this.readSync(grantId);
    if (grant.revokedAt !== undefined) return grant;
    const next: ObjectiveGrant = { ...grant, usesRemaining: 0, revokedAt: now.toISOString() };
    writeJsonAtomicSync(this.grantPath(grantId), next);
    this.appendLogSync({ type: "objective-grant-revoked", grantId, at: next.revokedAt! });
    return next;
  }

  /** The one covering-grant question the gate asks. Fail closed on every
   *  axis: revoked, expired, use-exhausted, and ceiling-exhausted grants
   *  cover nothing, and a rule's PRESENT tier is re-checked so a forged file
   *  naming an un-grantable class (or a class whose tier later tightened)
   *  never confers authority. Reads only; materializes nothing — with no
   *  grant on disk this is a single existsSync miss. */
  findCoveringGrantSync(input: { app: string; rule: string; now?: Date }): ObjectiveGrant | undefined {
    if (!existsSync(this.dir())) return undefined;
    const now = input.now ?? new Date();
    const tier = dispositionTierForRule(input.rule);
    if (tier === "un-grantable") return undefined;
    for (const grant of this.listSync()) {
      if (grant.app !== input.app) continue;
      if (grant.revokedAt !== undefined) continue;
      if (grant.usesRemaining <= 0) continue;
      if (grant.outwardEffects !== false) continue;
      if (new Date(grant.expiresAt).getTime() <= now.getTime()) continue;
      if (this.ledgerTotalSync(grant.grantId) >= grant.spendCeilingUsd) continue;
      const ordinary =
        (tier === "grantable" || tier === "budgeted") &&
        grant.tiers.includes(tier) &&
        grant.classes.includes(input.rule);
      const ceremony = tier === "human-only" && grant.criticalClasses.some((critical) => critical.rule === input.rule);
      if (ordinary || ceremony) return grant;
    }
    return undefined;
  }

  /** Decrement a use and append the per-use audit row (§4.1). */
  consumeUseSync(grantId: string, use: { rule: string; actionHash: string }, now: Date = new Date()): ObjectiveGrant {
    const grant = this.readSync(grantId);
    if (grant.revokedAt !== undefined) throw new Error(`objective grant ${grantId} is revoked`);
    if (grant.usesRemaining <= 0) throw new Error(`objective grant ${grantId} has no remaining uses`);
    const next: ObjectiveGrant = { ...grant, usesRemaining: grant.usesRemaining - 1 };
    writeJsonAtomicSync(this.grantPath(grantId), next);
    this.appendLogSync({
      type: "objective-grant-used",
      grantId,
      at: now.toISOString(),
      rule: use.rule,
      actionHash: use.actionHash,
      usesRemaining: next.usesRemaining,
    });
    return next;
  }

  /** Per-action audit row for a GRANTLESS budgeted-tier proceed (#296 §5.1+):
   *  the ratified budgeted semantics are "free until it isn't" — the action
   *  proceeds, and this row makes it visible. When a covering objective grant
   *  exists the gate uses consumeUseSync instead, so exactly one of the two
   *  rows exists per action. The grantless debit quantum/bound is F-PT-024. */
  recordBudgetedActionSync(use: { app: string; rule: string; actionHash: string }, now: Date = new Date()): void {
    this.appendLogSync({
      type: "budgeted-action",
      at: now.toISOString(),
      app: use.app,
      rule: use.rule,
      actionHash: use.actionHash,
    });
  }

  /** Cumulative spend recorded against the grant's ledger. */
  ledgerTotalSync(grantId: string): number {
    const path = this.ledgerPath(grantId);
    if (!existsSync(path)) return 0;
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as LedgerRow)
      .reduce((sum, row) => sum + row.usd, 0);
  }

  /** Debit BEFORE execution, atomically: the read-sum-append sequence runs
   *  under a per-grant file lock so concurrent turns serialize. A debit that
   *  would cross the ceiling appends nothing, reports refused (ceiling
   *  exhaustion is incomplete, never green), and raises the ONE
   *  `objective-budget-exceeded` item for this grant — re-raising converges
   *  on the stable key instead of minting a second. */
  async debit(input: { grantId: string; usd: number; note?: string; now?: Date }): Promise<ObjectiveDebitResult> {
    if (!Number.isFinite(input.usd) || input.usd < 0) {
      throw new Error("objective debit usd must be a non-negative finite number");
    }
    const now = input.now ?? new Date();
    return withFileLock(this.ledgerLockPath(input.grantId), { staleMs: 30_000, maxWaitMs: 35_000 }, async () => {
      const grant = this.readSync(input.grantId);
      if (grant.revokedAt !== undefined) {
        throw new Error(`objective grant ${input.grantId} is revoked`);
      }
      const total = this.ledgerTotalSync(input.grantId);
      if (total + input.usd > grant.spendCeilingUsd) {
        const escalation = await this.raiseCeilingEscalation(grant, total, input.usd, now);
        this.appendLogSync({
          type: "objective-spend-refused",
          grantId: input.grantId,
          at: now.toISOString(),
          usd: input.usd,
          totalUsd: total,
          ceilingUsd: grant.spendCeilingUsd,
          ...(escalation !== undefined ? { escalationId: escalation.id } : {}),
        });
        return {
          ok: false,
          totalUsd: total,
          ceilingUsd: grant.spendCeilingUsd,
          ...definedProps({ escalation }),
        };
      }
      const row: LedgerRow = {
        at: now.toISOString(),
        usd: input.usd,
        ...definedProps({ note: input.note }),
      };
      this.ensureDirSync();
      appendFileSync(this.ledgerPath(input.grantId), `${JSON.stringify(row)}\n`, "utf8");
      const next = total + input.usd;
      this.appendLogSync({
        type: "objective-spend-debited",
        grantId: input.grantId,
        at: row.at,
        usd: input.usd,
        totalUsd: next,
        ...definedProps({ note: input.note }),
      });
      return { ok: true, totalUsd: next, ceilingUsd: grant.spendCeilingUsd };
    });
  }

  readLogSync(): ObjectiveGrantLogEvent[] {
    const path = this.logPath();
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ObjectiveGrantLogEvent);
  }

  /** Raise (or find) the one queue item for this grant's ceiling — the
   *  turn-budget-exceeded shape, bound to the grant instead of a parked turn. */
  private async raiseCeilingEscalation(
    grant: ObjectiveGrant,
    totalUsd: number,
    attemptedUsd: number,
    now: Date,
  ): Promise<ApprovalItem> {
    const store = new ApprovalStore(this.root);
    const key = objectiveBudgetEscalationKey(grant.grantId);
    const existing = [...(await store.listPending()), ...(await store.listDecided())].find(
      (item) => item.rule === OBJECTIVE_BUDGET_RULE && item.justification === key,
    );
    if (existing !== undefined) return existing;
    return store.raise({
      app: grant.app,
      role: "orchestrator",
      rule: OBJECTIVE_BUDGET_RULE,
      action: {
        tool: "budget",
        description:
          `Objective grant ${grant.grantId} (${grant.objective}) reached its ` +
          `$${grant.spendCeilingUsd} ceiling; the ceiling is raisable only by a human editing the grant`,
        input: {
          kind: "objective-budget-grant",
          grantId: grant.grantId,
          objective: grant.objective,
          app: grant.app,
          spendToDateUsd: totalUsd,
          attemptedUsd,
          ceilingUsd: grant.spendCeilingUsd,
        },
      },
      justification: key,
      now,
    });
  }

  private dir(): string {
    return join(this.root, "approvals", "objective-grants");
  }

  private grantPath(grantId: string): string {
    return join(this.dir(), `${grantId}.json`);
  }

  private ledgerPath(grantId: string): string {
    return join(this.dir(), `${grantId}.ledger.jsonl`);
  }

  private ledgerLockPath(grantId: string): string {
    return join(this.dir(), `${grantId}.ledger.lock`);
  }

  private logPath(): string {
    return join(this.dir(), "log.jsonl");
  }

  private ensureDirSync(): void {
    mkdirSync(this.dir(), { recursive: true });
  }

  private appendLogSync(event: ObjectiveGrantLogEvent): void {
    this.ensureDirSync();
    appendFileSync(this.logPath(), `${JSON.stringify(event)}\n`, "utf8");
  }
}

function objectiveGrantId(now: Date): string {
  const compact = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `og-${compact}-${randomBytes(3).toString("base64url").slice(0, 4).toLowerCase()}`;
}

function readJsonSync<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
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
