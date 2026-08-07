import { stableHash } from "../../loop/episode-plan.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  assertAuthorityRef,
  type AcceptedAuthority,
  type AuthorityRef,
} from "./authority-core.js";
import { RoadmapDeliveryError } from "./failure.js";
import {
  assertExecutionUnitBudget,
  normalizeExecutionUnitBudget,
  type ExecutionBatch,
  type ExecutionUnit,
  type ExecutionUnitBudget,
} from "./execution-model.js";
import { requireDateTime } from "./validation-values.js";

const HASH = /^[a-f0-9]{64}$/;

export type ExecutionUnitJournalState =
  | "admitted"
  | "planning"
  | "claimed"
  | "running"
  | "reviewing"
  | "approved"
  | "returned"
  | "failed"
  | "completed";

export interface ExecutionUnitJournal {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  app: string;
  batchRef: AuthorityRef;
  unitId: string;
  unitIdentityHash: string;
  state: ExecutionUnitJournalState;
  budget: ExecutionUnitBudget;
  usage: {
    providerTurns: number;
    equivalentCostUsd: number;
    mechanicalOverheadUsd: number;
    activeTimeMs: number;
    humanDecisions: number;
  };
  episodeBindingRef: AuthorityRef | null;
  claimSettlementId: string | null;
  evidenceRefs: AuthorityRef[];
  candidateHead: string | null;
  pullRequestNumber: number | null;
  outcome: "completed" | "returned" | "failed" | null;
  updatedAt: string;
}

export interface ExecutionBatchDisposition {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  app: string;
  batchRef: AuthorityRef;
  units: Array<{
    unitId: string;
    outcome: "completed" | "returned" | "failed";
    journalHash: string;
  }>;
  completedAt: string;
}

function executionUnitIdentityHash(unit: ExecutionUnit): string {
  return unit.kind === "direct_operation"
    ? stableHash({ kind: unit.kind, dedupeKey: unit.dedupeKey })
    : stableHash({ kind: "roadmap_code", membershipHash: unit.membershipHash });
}

export function initialExecutionUnitJournal(
  batch: AcceptedAuthority<ExecutionBatch>,
  unit: ExecutionUnit,
): ExecutionUnitJournal {
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    app: batch.value.app,
    batchRef: batch.ref,
    unitId: unit.unitId,
    unitIdentityHash: executionUnitIdentityHash(unit),
    state: "admitted",
    budget: normalizeExecutionUnitBudget(unit.budget),
    usage: {
      providerTurns: 0,
      equivalentCostUsd: 0,
      mechanicalOverheadUsd: 0,
      activeTimeMs: 0,
      humanDecisions: 0,
    },
    episodeBindingRef: null,
    claimSettlementId: null,
    evidenceRefs: [],
    candidateHead: null,
    pullRequestNumber: null,
    outcome: null,
    updatedAt: batch.value.admittedAt,
  };
}

export function addExecutionUnitUsage(
  current: ExecutionUnitJournal["usage"],
  delta: Partial<ExecutionUnitJournal["usage"]>,
): ExecutionUnitJournal["usage"] {
  const next = {
    providerTurns: current.providerTurns + (delta.providerTurns ?? 0),
    equivalentCostUsd: current.equivalentCostUsd + (delta.equivalentCostUsd ?? 0),
    mechanicalOverheadUsd: current.mechanicalOverheadUsd + (delta.mechanicalOverheadUsd ?? 0),
    activeTimeMs: current.activeTimeMs + (delta.activeTimeMs ?? 0),
    humanDecisions: current.humanDecisions + (delta.humanDecisions ?? 0),
  };
  if (Object.values(next).some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RoadmapDeliveryError("unit_journal_conflict", "unit usage delta is invalid");
  }
  return next;
}

export function assertUsageWithinBudget(usage: ExecutionUnitJournal["usage"], budget: ExecutionUnitBudget): void {
  if (
    usage.providerTurns > budget.maxProviderTurns ||
    usage.equivalentCostUsd > budget.maxEquivalentCostUsd ||
    usage.mechanicalOverheadUsd > budget.maxMechanicalOverheadUsd ||
    usage.activeTimeMs > budget.maxActiveTimeMs ||
    usage.humanDecisions > budget.maxHumanDecisions
  ) {
    throw new RoadmapDeliveryError("unit_budget_exhausted", "unit usage exceeds its own admitted budget");
  }
}

export function assertExecutionUnitJournal(journal: ExecutionUnitJournal): void {
  if (
    journal.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION ||
    journal.app.trim().length === 0 ||
    !HASH.test(journal.unitIdentityHash) ||
    ![
      "admitted",
      "planning",
      "claimed",
      "running",
      "reviewing",
      "approved",
      "returned",
      "failed",
      "completed",
    ].includes(journal.state)
  ) {
    throw new RoadmapDeliveryError("unit_journal_conflict", "execution-unit journal is invalid");
  }
  assertAuthorityRef(journal.batchRef, "execution_batch");
  assertExecutionUnitBudget(journal.budget);
  assertUsageWithinBudget(journal.usage, journal.budget);
  requireDateTime(journal.updatedAt, "execution-unit journal updatedAt");
  if (isTerminalJournalState(journal.state) !== (journal.outcome !== null)) {
    throw new RoadmapDeliveryError("unit_journal_conflict", "terminal journal outcome is partial");
  }
}

export function isTerminalJournalState(state: ExecutionUnitJournalState): boolean {
  return state === "completed" || state === "returned" || state === "failed";
}
