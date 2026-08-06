// Read-only operator projection for roadmap/validation/delivery/batch state.
// Durable artifacts remain authoritative; labels and cache telemetry are
// explicitly presentation-only evidence.

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readEpisodePlanVersion, stableHash } from "../loop/episode-plan.js";
import { toErrorMessage as message } from "../runtime/error-message.js";
import {
  recoverExecutionAffinityTurn,
  type CacheMeasurement,
  type ExecutionAffinityRecord,
} from "./execution-affinity.js";
import { planningAppDir, planningAuthorityPath } from "./planning-artifact-path.js";
import {
  readBacklogSnapshotAuthority,
  readCurrentRoadmapPlan,
  readCurrentValidationContract,
  readExecutionBatch,
  readExecutionUnitJournal,
  type AcceptedAuthority,
  type AuthorityRef,
  type BacklogSnapshot,
  type ExecutionBatch,
  type ExecutionBatchDisposition,
  type ExecutionUnit,
} from "./roadmap-delivery.js";

const ROADMAP_EXPLANATION_SCHEMA_VERSION = 1 as const;

type PlanningSourceStatus = "healthy" | "degraded" | "unavailable";
export type UnitRecoveryState =
  | "not_started"
  | "in_progress"
  | "rerun_without_session"
  | "consider_exact_session_reuse"
  | "no_cross_unit_reuse"
  | "terminal_completed"
  | "terminal_returned"
  | "terminal_failed"
  | "unavailable";

interface PlanningAuthorityRefView {
  kind: AuthorityRef["kind"];
  id: string;
  version: number;
  sha256: string;
  durable_ref: string;
}

interface RoadmapUnitExplanationV1 {
  unit_id: string;
  kind: "roadmap_code" | "direct_operation";
  artifact_authority: {
    roadmap_plan: PlanningAuthorityRefView | null;
    validation_contract: PlanningAuthorityRefView | null;
    delivery_readiness: PlanningAuthorityRefView | null;
    direct_operation: PlanningAuthorityRefView | null;
    execution_batch: PlanningAuthorityRefView | null;
  };
  label_projection: { labels: string[]; authoritative: false };
  routing_exclusion: {
    excluded: boolean | null;
    reasons: string[];
    authority_basis: "backlog_snapshot" | "direct_operation" | "unavailable";
  };
  fast_path: {
    provider_planning_turn_skipped: boolean | null;
    reason: "complete_structured_creator_scope" | "episode_planner_required" | "episode_plan_unavailable";
    workflow_bypassed: false | null;
  };
  cache_evidence: {
    measurement: CacheMeasurement;
    cache_read_tokens: number | null;
    cache_creation_tokens: number | null;
    evidence_basis: "provider_cache_split" | "cache_split_unavailable";
    authority: "cost_affinity_only";
    unknown_is_zero: false;
  };
  recovery: { state: UnitRecoveryState; reason: string };
  batch: {
    batch_id: string;
    complete: boolean;
    every_unit_success: boolean | null;
    unit_state: string;
    unit_outcome: "completed" | "returned" | "failed" | null;
  } | null;
}

interface RoadmapBatchExplanationV1 {
  batch_id: string;
  authority: PlanningAuthorityRefView;
  complete: boolean;
  every_unit_success: boolean | null;
  unit_outcomes: Array<{ unit_id: string; state: string; outcome: "completed" | "returned" | "failed" | null }>;
}

interface RoadmapAppExplanationV1 {
  app: string;
  source: { status: PlanningSourceStatus; detail: string; affected_claims: string[] };
  roadmap_plan: PlanningAuthorityRefView | null;
  validation_contracts: Array<{ unit_id: string; authority: PlanningAuthorityRefView }>;
  delivery_units: RoadmapUnitExplanationV1[];
  batches: RoadmapBatchExplanationV1[];
}

export interface RoadmapExplanationV1 {
  schema_version: typeof ROADMAP_EXPLANATION_SCHEMA_VERSION;
  apps: RoadmapAppExplanationV1[];
}

interface IndexedBatch {
  accepted: AcceptedAuthority<ExecutionBatch>;
  disposition: ExecutionBatchDisposition | undefined;
}

export async function readRoadmapExplanation(
  stateHome: string,
  apps: readonly string[],
): Promise<RoadmapExplanationV1> {
  const unique = [...new Set(apps)].sort();
  return {
    schema_version: ROADMAP_EXPLANATION_SCHEMA_VERSION,
    apps: await Promise.all(unique.map((app) => readAppExplanation(stateHome, app))),
  };
}

async function readAppExplanation(stateHome: string, app: string): Promise<RoadmapAppExplanationV1> {
  const appDir = planningAppDir(stateHome, app);
  if (!existsSync(appDir)) {
    return {
      app,
      source: {
        status: "unavailable",
        detail: "No durable planning state is available for this app.",
        affected_claims: [
          "RoadmapPlan",
          "validation contract",
          "delivery unit",
          "batch",
          "fast-path reason",
          "cache evidence",
          "routing exclusion",
          "recovery state",
        ],
      },
      roadmap_plan: null,
      validation_contracts: [],
      delivery_units: [],
      batches: [],
    };
  }

  const errors: string[] = [];
  let roadmap: Awaited<ReturnType<typeof readCurrentRoadmapPlan>>;
  let backlog: AcceptedAuthority<BacklogSnapshot> | undefined;
  try {
    roadmap = await readCurrentRoadmapPlan(stateHome, app);
    if (roadmap !== undefined)
      backlog = await readBacklogSnapshotAuthority(stateHome, app, roadmap.value.backlogSnapshotRef);
  } catch (error) {
    errors.push(`RoadmapPlan: ${message(error)}`);
  }
  const batches = await indexBatches(stateHome, app, errors);
  if (
    roadmap === undefined &&
    (batches.length === 0 ||
      batches.some((batch) => batch.accepted.value.units.some((unit) => unit.kind !== "direct_operation")))
  ) {
    errors.push("RoadmapPlan: no current authoritative plan is readable");
  }
  const affinity = await indexAffinity(stateHome, app, errors);
  const unitIds = new Set<string>([
    ...(roadmap?.value.deliveryUnits.map((unit) => unit.unitId) ?? []),
    ...batches.flatMap((batch) => batch.accepted.value.units.map((unit) => unit.unitId)),
  ]);
  const units: RoadmapUnitExplanationV1[] = [];
  const validationContracts: RoadmapAppExplanationV1["validation_contracts"] = [];
  for (const unitId of [...unitIds].sort()) {
    try {
      const batch = batches.find((entry) => entry.accepted.value.units.some((unit) => unit.unitId === unitId));
      const batchUnit = batch?.accepted.value.units.find((unit) => unit.unitId === unitId);
      const validation = await readCurrentValidationContract(stateHome, app, unitId);
      if (validation !== undefined) validationContracts.push({ unit_id: unitId, authority: refView(validation.ref) });
      units.push(
        await explainUnit(stateHome, app, unitId, roadmap, backlog, batch, batchUnit, validation?.ref, affinity),
      );
    } catch (error) {
      errors.push(`delivery unit ${unitId}: ${message(error)}`);
    }
  }
  const source: RoadmapAppExplanationV1["source"] =
    errors.length === 0
      ? { status: "healthy", detail: "Durable planning artifacts are readable.", affected_claims: [] }
      : { status: "degraded", detail: errors.join("; "), affected_claims: affectedClaims(errors) };
  return {
    app,
    source,
    roadmap_plan: roadmap === undefined ? null : refView(roadmap.ref),
    validation_contracts: validationContracts.sort((left, right) => left.unit_id.localeCompare(right.unit_id)),
    delivery_units: units,
    batches: await Promise.all(batches.map((batch) => explainBatch(stateHome, app, batch))),
  };
}

async function explainUnit(
  stateHome: string,
  app: string,
  unitId: string,
  roadmap: Awaited<ReturnType<typeof readCurrentRoadmapPlan>>,
  backlog: AcceptedAuthority<BacklogSnapshot> | undefined,
  batch: IndexedBatch | undefined,
  batchUnit: ExecutionUnit | undefined,
  validationRef: AuthorityRef | undefined,
  affinity: ExecutionAffinityRecord[],
): Promise<RoadmapUnitExplanationV1> {
  const kind = batchUnit?.kind === "direct_operation" ? "direct_operation" : "roadmap_code";
  const codeUnit = batchUnit !== undefined && batchUnit.kind !== "direct_operation" ? batchUnit : undefined;
  const directUnit = batchUnit?.kind === "direct_operation" ? batchUnit : undefined;
  const journal =
    batch === undefined ? undefined : await readExecutionUnitJournal(stateHome, app, batch.accepted.ref.id, unitId);
  const unitAffinity = affinity
    .filter((record) => record.unitId === unitId)
    .sort((left, right) => affinityInstant(right).localeCompare(affinityInstant(left)))[0];
  const batchComplete = batch?.disposition !== undefined;
  const everyUnitSuccess =
    batch?.disposition === undefined ? null : batch.disposition.units.every((unit) => unit.outcome === "completed");
  const labels =
    roadmap === undefined || backlog === undefined
      ? []
      : [
          ...new Set(
            roadmap.value.deliveryUnits
              .find((unit) => unit.unitId === unitId)
              ?.issueNumbers.flatMap(
                (issueNumber) =>
                  backlog.value.issues.find((issue) => issue.issueNumber === issueNumber)?.observedLabels ?? [],
              ) ?? [],
          ),
        ].sort();
  const issueFacts =
    roadmap === undefined || backlog === undefined
      ? undefined
      : roadmap.value.deliveryUnits
          .find((unit) => unit.unitId === unitId)
          ?.issueNumbers.map((issueNumber) => backlog.value.issues.find((issue) => issue.issueNumber === issueNumber))
          .filter((issue): issue is NonNullable<typeof issue> => issue !== undefined);
  const routingReasons =
    issueFacts?.flatMap((issue) => [
      ...(issue.routing === "human_only" ? [`issue #${issue.issueNumber}:human_only`] : []),
      ...issue.observedLabels
        .filter((label) => label === "routing:human-only" || label === "manual-review")
        .map((label) => `issue #${issue.issueNumber}:label_projection:${label}`),
    ]) ?? [];
  const fastPath = await explainFastPath(stateHome, app, journal?.episodeBindingRef ?? null);
  const cache = unitAffinity?.cache;
  return {
    unit_id: unitId,
    kind,
    artifact_authority: {
      roadmap_plan: roadmap === undefined || kind === "direct_operation" ? null : refView(roadmap.ref),
      validation_contract: validationRef === undefined ? null : refView(validationRef),
      delivery_readiness: codeUnit === undefined ? null : refView(codeUnit.readinessRef),
      direct_operation: directUnit === undefined ? null : refView(directUnit.authorityRef),
      execution_batch: batch === undefined ? null : refView(batch.accepted.ref),
    },
    label_projection: { labels, authoritative: false },
    routing_exclusion:
      kind === "direct_operation"
        ? { excluded: false, reasons: ["complete direct-operation authority"], authority_basis: "direct_operation" }
        : issueFacts === undefined
          ? { excluded: null, reasons: ["backlog routing source unavailable"], authority_basis: "unavailable" }
          : { excluded: routingReasons.length > 0, reasons: routingReasons, authority_basis: "backlog_snapshot" },
    fast_path: fastPath,
    cache_evidence: {
      measurement: cache?.measurement ?? "unknown",
      cache_read_tokens: cache?.cacheReadTokens ?? null,
      cache_creation_tokens: cache?.cacheCreationTokens ?? null,
      evidence_basis: cache?.evidenceBasis ?? "cache_split_unavailable",
      authority: "cost_affinity_only",
      unknown_is_zero: false,
    },
    recovery: explainRecovery(journal?.state, journal?.outcome, unitAffinity),
    batch:
      batch === undefined || journal === undefined
        ? null
        : {
            batch_id: batch.accepted.ref.id,
            complete: batchComplete,
            every_unit_success: everyUnitSuccess,
            unit_state: journal.state,
            unit_outcome: journal.outcome,
          },
  };
}

async function explainBatch(stateHome: string, app: string, batch: IndexedBatch): Promise<RoadmapBatchExplanationV1> {
  const units = await Promise.all(
    batch.accepted.value.units.map(async (unit) => {
      const journal = await readExecutionUnitJournal(stateHome, app, batch.accepted.ref.id, unit.unitId);
      return { unit_id: unit.unitId, state: journal?.state ?? "unavailable", outcome: journal?.outcome ?? null };
    }),
  );
  return {
    batch_id: batch.accepted.ref.id,
    authority: refView(batch.accepted.ref),
    complete: batch.disposition !== undefined,
    every_unit_success:
      batch.disposition === undefined ? null : batch.disposition.units.every((unit) => unit.outcome === "completed"),
    unit_outcomes: units,
  };
}

async function explainFastPath(
  stateHome: string,
  app: string,
  bindingRef: AuthorityRef | null,
): Promise<RoadmapUnitExplanationV1["fast_path"]> {
  if (bindingRef === null)
    return { provider_planning_turn_skipped: null, reason: "episode_plan_unavailable", workflow_bypassed: null };
  const path = authorityFile(stateHome, app, bindingRef);
  const accepted = JSON.parse(await readFile(path, "utf8")) as AcceptedAuthority<{
    episodeId: string;
    episodePlanVersion: number;
  }>;
  const plan = await readEpisodePlanVersion(stateHome, accepted.value.episodeId, accepted.value.episodePlanVersion);
  if (plan === undefined)
    return { provider_planning_turn_skipped: null, reason: "episode_plan_unavailable", workflow_bypassed: null };
  return plan.planningSource === "creator_scope"
    ? { provider_planning_turn_skipped: true, reason: "complete_structured_creator_scope", workflow_bypassed: false }
    : { provider_planning_turn_skipped: false, reason: "episode_planner_required", workflow_bypassed: false };
}

function explainRecovery(
  journalState: string | undefined,
  outcome: "completed" | "returned" | "failed" | null | undefined,
  affinity: ExecutionAffinityRecord | undefined,
): RoadmapUnitExplanationV1["recovery"] {
  if (outcome === "completed") return { state: "terminal_completed", reason: "the unit journal is durably completed" };
  if (outcome === "returned") return { state: "terminal_returned", reason: "the unit journal is durably returned" };
  if (outcome === "failed") return { state: "terminal_failed", reason: "the unit journal is durably failed" };
  if (affinity !== undefined) {
    const recovery = recoverExecutionAffinityTurn(affinity);
    if (recovery.action === "rerun_without_session") return { state: "rerun_without_session", reason: recovery.reason };
    if (recovery.action === "no_cross_unit_reuse") return { state: "no_cross_unit_reuse", reason: recovery.reason };
    return {
      state: "consider_exact_session_reuse",
      reason: "settled compatible evidence may be considered; cache telemetry is not authority",
    };
  }
  if (journalState === undefined) return { state: "unavailable", reason: "no unit journal is readable" };
  if (journalState === "admitted") return { state: "not_started", reason: "unit is admitted and has not started" };
  return { state: "in_progress", reason: `unit journal state is ${journalState}` };
}

async function indexBatches(stateHome: string, app: string, errors: string[]): Promise<IndexedBatch[]> {
  const root = join(planningAppDir(stateHome, app), "execution_batchs");
  if (!existsSync(root)) return [];
  const out: IndexedBatch[] = [];
  for (const batchId of (await readdir(root)).sort()) {
    try {
      const files = (await readdir(join(root, batchId))).filter((name) => /^v\d+\.json$/.test(name)).sort(versionSort);
      const raw = JSON.parse(
        await readFile(join(root, batchId, files.at(-1)!), "utf8"),
      ) as AcceptedAuthority<ExecutionBatch>;
      const accepted = await readExecutionBatch(stateHome, app, raw.ref);
      let disposition: ExecutionBatchDisposition | undefined;
      try {
        disposition = await readBatchDisposition(stateHome, app, accepted);
      } catch (error) {
        errors.push(`batch ${batchId} disposition: ${message(error)}`);
      }
      out.push({ accepted, disposition });
    } catch (error) {
      errors.push(`batch ${batchId}: ${message(error)}`);
    }
  }
  return out.sort((left, right) => left.accepted.ref.id.localeCompare(right.accepted.ref.id));
}

async function readBatchDisposition(
  stateHome: string,
  app: string,
  batch: AcceptedAuthority<ExecutionBatch>,
): Promise<ExecutionBatchDisposition | undefined> {
  const path = join(planningAppDir(stateHome, app), "execution-batch-dispositions", `${batch.ref.id}.json`);
  if (!existsSync(path)) return undefined;
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!record(value) || !exactKeys(value, ["schemaVersion", "app", "batchRef", "units", "completedAt"])) {
    throw new Error("disposition schema is invalid");
  }
  if (
    value["schemaVersion"] !== 1 ||
    value["app"] !== app ||
    stableHash(value["batchRef"]) !== stableHash(batch.ref) ||
    typeof value["completedAt"] !== "string" ||
    !Number.isFinite(Date.parse(value["completedAt"])) ||
    !Array.isArray(value["units"])
  ) {
    throw new Error("disposition authority or completion instant is invalid");
  }
  const rows = value["units"];
  const expectedIds = batch.value.units.map((unit) => unit.unitId).sort();
  const observedIds = rows
    .flatMap((row) => (record(row) && typeof row["unitId"] === "string" ? [row["unitId"]] : []))
    .sort();
  if (JSON.stringify(observedIds) !== JSON.stringify(expectedIds)) {
    throw new Error("disposition is not total over the admitted units");
  }
  for (const row of rows) {
    if (
      !record(row) ||
      !exactKeys(row, ["unitId", "outcome", "journalHash"]) ||
      typeof row["unitId"] !== "string" ||
      !["completed", "returned", "failed"].includes(String(row["outcome"])) ||
      typeof row["journalHash"] !== "string"
    ) {
      throw new Error("disposition unit row is invalid");
    }
    const journal = await readExecutionUnitJournal(stateHome, app, batch.ref.id, row["unitId"]);
    if (journal === undefined || journal.outcome !== row["outcome"] || stableHash(journal) !== row["journalHash"]) {
      throw new Error(`disposition unit ${row["unitId"]} does not match its authoritative journal`);
    }
  }
  return value as unknown as ExecutionBatchDisposition;
}

async function indexAffinity(stateHome: string, app: string, errors: string[]): Promise<ExecutionAffinityRecord[]> {
  const root = join(resolve(stateHome), "planning", "execution-affinity");
  if (!existsSync(root)) return [];
  const out: ExecutionAffinityRecord[] = [];
  for (const entry of (await readdir(root)).sort()) {
    const path = join(root, entry, "record.json");
    if (!existsSync(path)) continue;
    try {
      const record = JSON.parse(await readFile(path, "utf8")) as ExecutionAffinityRecord;
      recoverExecutionAffinityTurn(record); // validates the complete durable shape
      if (record.manifest.compatibility.app === app) out.push(record);
    } catch (error) {
      errors.push(`cache/recovery record ${entry}: ${message(error)}`);
    }
  }
  return out;
}

function authorityFile(stateHome: string, app: string, ref: AuthorityRef): string {
  return planningAuthorityPath(stateHome, app, ref.kind, ref.id, ref.version);
}

function refView(ref: AuthorityRef): PlanningAuthorityRefView {
  return { ...ref, durable_ref: `${ref.kind}:${ref.id}@v${ref.version}#${ref.sha256}` };
}

function affinityInstant(record: ExecutionAffinityRecord): string {
  return record.settledAt ?? record.preparedAt;
}

function affectedClaims(errors: string[]): string[] {
  const claims = new Set<string>();
  for (const error of errors) {
    if (error.includes("RoadmapPlan")) claims.add("RoadmapPlan");
    if (error.includes("validation") || error.includes("delivery unit")) claims.add("validation contract");
    if (error.includes("delivery unit") || error.includes("batch")) claims.add("delivery unit");
    if (error.includes("batch")) claims.add("batch completion");
    if (error.includes("cache/recovery")) {
      claims.add("cache evidence");
      claims.add("recovery state");
    }
  }
  return [...claims].sort();
}

function versionSort(left: string, right: string): number {
  return Number.parseInt(left.slice(1), 10) - Number.parseInt(right.slice(1), 10);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
