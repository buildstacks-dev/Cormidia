// Execution context/session/cache affinity evidence (HB-107).
//
// This module is advisory except for session safety. Hard routing, membership,
// validation, Reviewer independence, and effect authority are deliberately not
// inputs to cache advice and cannot be changed by its outputs.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeLoopFileAtomic, writeLoopFileOnce } from "../loop/durable.js";
import { stableHash } from "../loop/episode-plan.js";
import { turnAssignmentsEqual, validateTurnAssignment } from "../runtime/assignment.js";
import { withFileLock } from "../runtime/file-lock.js";
import type { SessionHandle, TurnAssignment, TurnUsage } from "../runtime/types.js";

export const EXECUTION_AFFINITY_SCHEMA_VERSION = 1 as const;

export type ExecutionAffinityFailureCode =
  | "affinity_manifest_invalid"
  | "affinity_record_conflict"
  | "affinity_record_corrupt"
  | "affinity_session_mismatch"
  | "affinity_settlement_mismatch";

export class ExecutionAffinityError extends Error {
  constructor(readonly code: ExecutionAffinityFailureCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "ExecutionAffinityError";
  }
}

export type ExecutionContextComponentKind =
  | "authority"
  | "validation"
  | "shared_context"
  | "unit_delta";

export interface ExecutionContextComponentInput {
  id: string;
  kind: ExecutionContextComponentKind;
  sourceRef: string;
  sha256: string;
}

export interface ExecutionContextComponent extends ExecutionContextComponentInput {
  position: number;
}

export interface ExecutionCompatibilityIdentity {
  app: string;
  role: string;
  assignment: TurnAssignment;
  operation: string;
}

export interface ExecutionContextAffinityManifest {
  schemaVersion: typeof EXECUTION_AFFINITY_SCHEMA_VERSION;
  unitId: string;
  compatibility: ExecutionCompatibilityIdentity;
  immutablePrefix: ExecutionContextComponent[];
  immutablePrefixSha256: string;
  unitDelta: ExecutionContextComponent[];
  unitDeltaSha256: string;
  requiredAuthorityRefs: string[];
  manifestSha256: string;
}

export type CacheMeasurement = "hit" | "miss" | "unknown";

export interface ExecutionCacheTelemetry {
  measurement: CacheMeasurement;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  uncachedInputTokens: number | null;
  totalInputTokens: number | null;
  equivalentCostUsd: number | null;
  usageQuality: TurnUsage["quality"] | null;
  evidenceBasis: "provider_cache_split" | "cache_split_unavailable";
}

export interface ExecutionAffinityRecord {
  schemaVersion: typeof EXECUTION_AFFINITY_SCHEMA_VERSION;
  recordId: string;
  batchId: string;
  unitId: string;
  episodeId: string;
  planVersion: number;
  stepId: string;
  manifest: ExecutionContextAffinityManifest;
  state: "prepared" | "settled";
  preparedAt: string;
  providerTurnId: string | null;
  settlementId: string | null;
  providerOutcome: "completed" | "failed" | "suspended" | null;
  session: SessionHandle | null;
  cache: ExecutionCacheTelemetry;
  settledAt: string | null;
}

export interface SessionReuseCandidate {
  recordId: string;
  compatibility: ExecutionCompatibilityIdentity;
  immutablePrefixSha256: string;
  session: SessionHandle;
  cache: ExecutionCacheTelemetry;
}

export type SessionReuseRefusalReason =
  | "candidate_unsettled"
  | "app_mismatch"
  | "role_mismatch"
  | "assignment_mismatch"
  | "operation_mismatch"
  | "immutable_prefix_mismatch"
  | "session_runtime_mismatch";

export type SessionReuseDecision =
  | { reuse: true; session: SessionHandle; candidateRecordId: string }
  | { reuse: false; reason: SessionReuseRefusalReason };

export function createExecutionContextAffinityManifest(input: {
  unitId: string;
  compatibility: ExecutionCompatibilityIdentity;
  immutablePrefix: readonly ExecutionContextComponentInput[];
  unitDelta: readonly ExecutionContextComponentInput[];
  requiredAuthorityRefs: readonly string[];
}): ExecutionContextAffinityManifest {
  assertNonEmpty(input.unitId, "unit id", "affinity_manifest_invalid");
  assertCompatibility(input.compatibility);
  const immutablePrefix = normalizeComponents(input.immutablePrefix, "immutable prefix");
  const unitDelta = normalizeComponents(input.unitDelta, "unit delta");
  if (immutablePrefix.length === 0 || unitDelta.length === 0) {
    throw new ExecutionAffinityError(
      "affinity_manifest_invalid",
      "immutable prefix and unit delta must both be explicit and non-empty",
    );
  }
  const prefixIds = new Set(immutablePrefix.map((component) => component.id));
  if (unitDelta.some((component) => prefixIds.has(component.id))) {
    throw new ExecutionAffinityError(
      "affinity_manifest_invalid",
      "immutable prefix and unit delta component ids must be globally unique",
    );
  }
  const requiredAuthorityRefs = [...input.requiredAuthorityRefs];
  if (
    requiredAuthorityRefs.length === 0 ||
    new Set(requiredAuthorityRefs).size !== requiredAuthorityRefs.length ||
    requiredAuthorityRefs.some((ref) => ref.trim().length === 0)
  ) {
    throw new ExecutionAffinityError(
      "affinity_manifest_invalid",
      "required authority references must be a non-empty unique ordered set",
    );
  }
  const authoritySources = new Set(
    [...immutablePrefix, ...unitDelta]
      .filter((component) => component.kind === "authority" || component.kind === "validation")
      .map((component) => component.sourceRef),
  );
  if (requiredAuthorityRefs.some((ref) => !authoritySources.has(ref))) {
    throw new ExecutionAffinityError(
      "affinity_manifest_invalid",
      "required authority cannot be evicted from the immutable prefix or unit delta",
    );
  }
  const immutablePrefixSha256 = stableHash(immutablePrefix);
  const unitDeltaSha256 = stableHash(unitDelta);
  const manifestCore = {
    schemaVersion: EXECUTION_AFFINITY_SCHEMA_VERSION,
    unitId: input.unitId,
    compatibility: cloneCompatibility(input.compatibility),
    immutablePrefix,
    immutablePrefixSha256,
    unitDelta,
    unitDeltaSha256,
    requiredAuthorityRefs,
  };
  return {
    ...manifestCore,
    manifestSha256: stableHash(manifestCore),
  };
}

export function cacheTelemetryFromUsage(
  usage: TurnUsage | undefined,
): ExecutionCacheTelemetry {
  const reportedCacheRead = usage?.cacheReadTokens;
  const trustworthySplit =
    usage !== undefined &&
    usage.quality !== "unavailable" &&
    usage.quality !== "none" &&
    Number.isFinite(reportedCacheRead) &&
    reportedCacheRead! >= 0;
  return {
    measurement: !trustworthySplit
      ? "unknown"
      : reportedCacheRead! > 0
        ? "hit"
        : "miss",
    cacheReadTokens: nonNegativeMetric(reportedCacheRead),
    cacheCreationTokens: nonNegativeMetric(usage?.cacheCreationTokens),
    uncachedInputTokens: nonNegativeMetric(usage?.tokensInUncached),
    totalInputTokens: nonNegativeMetric(usage?.tokensIn),
    equivalentCostUsd: nonNegativeMetric(usage?.costUsd),
    usageQuality: usage?.quality ?? null,
    evidenceBasis: trustworthySplit ? "provider_cache_split" : "cache_split_unavailable",
  };
}

export async function prepareExecutionAffinityTurn(input: {
  root: string;
  recordId: string;
  batchId: string;
  episodeId: string;
  planVersion: number;
  stepId: string;
  manifest: ExecutionContextAffinityManifest;
  preparedAt: string;
  fault?: (boundary: "after_prepare_persist") => void;
}): Promise<ExecutionAffinityRecord> {
  assertRecordIdentity(input);
  assertManifest(input.manifest);
  const record: ExecutionAffinityRecord = {
    schemaVersion: EXECUTION_AFFINITY_SCHEMA_VERSION,
    recordId: input.recordId,
    batchId: input.batchId,
    unitId: input.manifest.unitId,
    episodeId: input.episodeId,
    planVersion: input.planVersion,
    stepId: input.stepId,
    manifest: structuredClone(input.manifest),
    state: "prepared",
    preparedAt: requireDateTime(input.preparedAt, "preparedAt"),
    providerTurnId: null,
    settlementId: null,
    providerOutcome: null,
    session: null,
    cache: cacheTelemetryFromUsage(undefined),
    settledAt: null,
  };
  const path = executionAffinityRecordPath(input.root, input.recordId);
  const created = await writeLoopFileOnce(path, renderJson(record));
  const durable = created ? record : await readExecutionAffinityRecord(input.root, input.recordId);
  if (durable === undefined || !samePreparedAuthority(durable, record)) {
    throw new ExecutionAffinityError(
      "affinity_record_conflict",
      `affinity record ${input.recordId} has different immutable preparation authority`,
    );
  }
  input.fault?.("after_prepare_persist");
  return durable;
}

export async function settleExecutionAffinityTurn(input: {
  root: string;
  recordId: string;
  providerTurnId: string;
  settlementId: string;
  providerOutcome: "completed" | "failed" | "suspended";
  session: SessionHandle;
  usage?: TurnUsage;
  settledAt: string;
  fault?: (boundary: "after_settlement_persist") => void;
}): Promise<ExecutionAffinityRecord> {
  for (const [label, value] of [
    ["record id", input.recordId],
    ["provider turn id", input.providerTurnId],
    ["settlement id", input.settlementId],
    ["session id", input.session.id],
  ] as const) assertNonEmpty(value, label, "affinity_settlement_mismatch");
  if (!["completed", "failed", "suspended"].includes(input.providerOutcome)) {
    throw new ExecutionAffinityError(
      "affinity_settlement_mismatch",
      "provider outcome is outside the closed affinity vocabulary",
    );
  }
  const path = executionAffinityRecordPath(input.root, input.recordId);
  const settled = await withFileLock(
    `${path}.lock`,
    { staleMs: 30_000, maxWaitMs: 60_000 },
    async () => {
      const current = await readExecutionAffinityRecord(input.root, input.recordId);
      if (current === undefined) {
        throw new ExecutionAffinityError("affinity_settlement_mismatch", "affinity preparation is missing");
      }
      if (current.state === "settled") {
        if (
          current.providerTurnId !== input.providerTurnId ||
          current.settlementId !== input.settlementId ||
          current.providerOutcome !== input.providerOutcome ||
          stableHash(current.session) !== stableHash(input.session) ||
          stableHash(current.cache) !== stableHash(cacheTelemetryFromUsage(input.usage))
        ) {
          throw new ExecutionAffinityError(
            "affinity_settlement_mismatch",
            "terminal affinity settlement is immutable and content-bound",
          );
        }
        return current;
      }
      if (input.session.runtime !== current.manifest.compatibility.assignment.harness) {
        throw new ExecutionAffinityError(
          "affinity_session_mismatch",
          "provider session runtime differs from the accepted turn assignment",
        );
      }
      const next: ExecutionAffinityRecord = {
        ...current,
        state: "settled",
        providerTurnId: input.providerTurnId,
        settlementId: input.settlementId,
        providerOutcome: input.providerOutcome,
        session: structuredClone(input.session),
        cache: cacheTelemetryFromUsage(input.usage),
        settledAt: requireDateTime(input.settledAt, "settledAt"),
      };
      await writeLoopFileAtomic(path, renderJson(next));
      return next;
    },
  );
  input.fault?.("after_settlement_persist");
  return settled;
}

export async function readExecutionAffinityRecord(
  root: string,
  recordId: string,
): Promise<ExecutionAffinityRecord | undefined> {
  const path = executionAffinityRecordPath(root, recordId);
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(await readFile(path, "utf8")) as ExecutionAffinityRecord;
  assertRecord(value);
  if (value.recordId !== recordId) {
    throw new ExecutionAffinityError(
      "affinity_record_corrupt",
      "execution affinity record path and embedded identity disagree",
    );
  }
  return value;
}

/** Restart policy for a single turn record. A prepared record contains no
 * terminal provider evidence, so its absent session is never guessed or
 * resumed. A settled record may be considered only by exact compatibility. */
export function recoverExecutionAffinityTurn(record: ExecutionAffinityRecord):
  | { action: "rerun_without_session"; reason: "candidate_unsettled" }
  | { action: "no_cross_unit_reuse"; reason: "provider_not_completed" }
  | { action: "consider_exact_reuse"; candidate: SessionReuseCandidate } {
  assertRecord(record);
  if (record.state !== "settled" || record.session === null) {
    return { action: "rerun_without_session", reason: "candidate_unsettled" };
  }
  if (record.providerOutcome !== "completed") {
    return { action: "no_cross_unit_reuse", reason: "provider_not_completed" };
  }
  return {
    action: "consider_exact_reuse",
    candidate: {
      recordId: record.recordId,
      compatibility: cloneCompatibility(record.manifest.compatibility),
      immutablePrefixSha256: record.manifest.immutablePrefixSha256,
      session: structuredClone(record.session),
      cache: structuredClone(record.cache),
    },
  };
}

/** Cache measurements are intentionally absent from this decision. Exact
 * app/role/assignment/operation/prefix compatibility is the complete reuse
 * predicate. In particular, Reviewer can never receive Builder state. */
export function decideSessionReuse(input: {
  candidate: SessionReuseCandidate | null;
  requested: ExecutionCompatibilityIdentity;
  immutablePrefixSha256: string;
}): SessionReuseDecision {
  assertCompatibility(input.requested);
  if (input.candidate === null) return { reuse: false, reason: "candidate_unsettled" };
  const candidate = input.candidate;
  assertCompatibility(candidate.compatibility);
  assertNonEmpty(candidate.recordId, "candidate record id", "affinity_record_corrupt");
  assertNonEmpty(candidate.session.id, "candidate session id", "affinity_record_corrupt");
  assertCacheTelemetry(candidate.cache);
  if (!isHash(candidate.immutablePrefixSha256) || !isHash(input.immutablePrefixSha256)) {
    throw new ExecutionAffinityError(
      "affinity_record_corrupt",
      "session reuse requires valid immutable-prefix hashes",
    );
  }
  if (candidate.compatibility.app !== input.requested.app) {
    return { reuse: false, reason: "app_mismatch" };
  }
  if (candidate.compatibility.role !== input.requested.role) {
    return { reuse: false, reason: "role_mismatch" };
  }
  if (!turnAssignmentsEqual(candidate.compatibility.assignment, input.requested.assignment)) {
    return { reuse: false, reason: "assignment_mismatch" };
  }
  if (candidate.compatibility.operation !== input.requested.operation) {
    return { reuse: false, reason: "operation_mismatch" };
  }
  if (candidate.immutablePrefixSha256 !== input.immutablePrefixSha256) {
    return { reuse: false, reason: "immutable_prefix_mismatch" };
  }
  if (candidate.session.runtime !== input.requested.assignment.harness) {
    return { reuse: false, reason: "session_runtime_mismatch" };
  }
  return {
    reuse: true,
    session: structuredClone(candidate.session),
    candidateRecordId: candidate.recordId,
  };
}

/** The only policy interpretation exposed for cache telemetry. Callers may
 * surface this as future cost/affinity advice; it is not an admission, routing,
 * correctness, validation, membership, review, or effect-authority result. */
export function cacheAffinityAdvice(cache: ExecutionCacheTelemetry): {
  kind: "cost_affinity_only";
  advice: "observed_prefix_reuse" | "observed_prefix_miss" | "no_cache_claim";
  correctnessAuthority: false;
} {
  return {
    kind: "cost_affinity_only",
    advice: cache.measurement === "hit"
      ? "observed_prefix_reuse"
      : cache.measurement === "miss"
        ? "observed_prefix_miss"
        : "no_cache_claim",
    correctnessAuthority: false,
  };
}

export function executionAffinityRecordPath(root: string, recordId: string): string {
  return join(
    root,
    "planning",
    "execution-affinity",
    stableHash(recordId).slice(0, 40),
    "record.json",
  );
}

function normalizeComponents(
  values: readonly ExecutionContextComponentInput[],
  label: string,
): ExecutionContextComponent[] {
  const ids = new Set<string>();
  return values.map((value, position) => {
    assertNonEmpty(value.id, `${label} component id`, "affinity_manifest_invalid");
    assertNonEmpty(value.sourceRef, `${label} source reference`, "affinity_manifest_invalid");
    if (ids.has(value.id) || !isHash(value.sha256)) {
      throw new ExecutionAffinityError(
        "affinity_manifest_invalid",
        `${label} contains a duplicate id or invalid content hash`,
      );
    }
    ids.add(value.id);
    return { ...structuredClone(value), position };
  });
}

function assertCompatibility(value: ExecutionCompatibilityIdentity): void {
  assertNonEmpty(value.app, "compatibility app", "affinity_manifest_invalid");
  assertNonEmpty(value.role, "compatibility role", "affinity_manifest_invalid");
  assertNonEmpty(value.operation, "compatibility operation", "affinity_manifest_invalid");
  validateTurnAssignment(value.assignment, "execution-affinity assignment");
}

function assertManifest(value: ExecutionContextAffinityManifest): void {
  const core = {
    schemaVersion: value.schemaVersion,
    unitId: value.unitId,
    compatibility: value.compatibility,
    immutablePrefix: value.immutablePrefix,
    immutablePrefixSha256: value.immutablePrefixSha256,
    unitDelta: value.unitDelta,
    unitDeltaSha256: value.unitDeltaSha256,
    requiredAuthorityRefs: value.requiredAuthorityRefs,
  };
  if (
    value.schemaVersion !== EXECUTION_AFFINITY_SCHEMA_VERSION ||
    value.immutablePrefixSha256 !== stableHash(value.immutablePrefix) ||
    value.unitDeltaSha256 !== stableHash(value.unitDelta) ||
    value.manifestSha256 !== stableHash(core)
  ) {
    throw new ExecutionAffinityError("affinity_record_corrupt", "context affinity manifest hash is invalid");
  }
  try {
    const reconstructed = createExecutionContextAffinityManifest({
      unitId: value.unitId,
      compatibility: value.compatibility,
      immutablePrefix: value.immutablePrefix.map(({ position: _position, ...component }) => component),
      unitDelta: value.unitDelta.map(({ position: _position, ...component }) => component),
      requiredAuthorityRefs: value.requiredAuthorityRefs,
    });
    if (stableHash(reconstructed) !== stableHash(value)) {
      throw new Error("manifest normalization differs");
    }
  } catch (error) {
    if (error instanceof ExecutionAffinityError && error.code === "affinity_record_corrupt") throw error;
    throw new ExecutionAffinityError(
      "affinity_record_corrupt",
      `context affinity manifest structure is invalid: ${(error as Error).message}`,
    );
  }
}

function assertRecord(value: ExecutionAffinityRecord): void {
  assertManifest(value.manifest);
  if (
    value.schemaVersion !== EXECUTION_AFFINITY_SCHEMA_VERSION ||
    !nonEmpty(value.recordId) ||
    !nonEmpty(value.batchId) ||
    !nonEmpty(value.episodeId) ||
    !nonEmpty(value.stepId) ||
    value.unitId !== value.manifest.unitId ||
    !Number.isInteger(value.planVersion) ||
    value.planVersion <= 0 ||
    !validDateTime(value.preparedAt) ||
    !["prepared", "settled"].includes(value.state) ||
    (value.state === "prepared" && (
      value.providerTurnId !== null ||
      value.settlementId !== null ||
      value.providerOutcome !== null ||
      value.session !== null ||
      value.settledAt !== null
    )) ||
    (value.state === "settled" && (
      !nonEmpty(value.providerTurnId) ||
      !nonEmpty(value.settlementId) ||
      !["completed", "failed", "suspended"].includes(value.providerOutcome ?? "") ||
      value.session === null ||
      !validDateTime(value.settledAt)
    ))
  ) {
    throw new ExecutionAffinityError("affinity_record_corrupt", "execution affinity record is malformed");
  }
  if (
    value.session !== null &&
    (!nonEmpty(value.session.id) ||
      value.session.runtime !== value.manifest.compatibility.assignment.harness)
  ) {
    throw new ExecutionAffinityError("affinity_record_corrupt", "record session runtime loses assignment identity");
  }
  assertCacheTelemetry(value.cache);
  if (
    value.state === "prepared" &&
    stableHash(value.cache) !== stableHash(cacheTelemetryFromUsage(undefined))
  ) {
    throw new ExecutionAffinityError(
      "affinity_record_corrupt",
      "prepared affinity record cannot claim provider cache evidence",
    );
  }
}

function assertRecordIdentity(input: {
  recordId: string;
  batchId: string;
  episodeId: string;
  planVersion: number;
  stepId: string;
  preparedAt: string;
}): void {
  for (const [label, value] of [
    ["record id", input.recordId],
    ["batch id", input.batchId],
    ["episode id", input.episodeId],
    ["step id", input.stepId],
  ] as const) assertNonEmpty(value, label, "affinity_manifest_invalid");
  if (!Number.isInteger(input.planVersion) || input.planVersion <= 0) {
    throw new ExecutionAffinityError("affinity_manifest_invalid", "plan version must be positive");
  }
  requireDateTime(input.preparedAt, "preparedAt");
}

function samePreparedAuthority(
  left: ExecutionAffinityRecord,
  right: ExecutionAffinityRecord,
): boolean {
  return stableHash({
    recordId: left.recordId,
    batchId: left.batchId,
    unitId: left.unitId,
    episodeId: left.episodeId,
    planVersion: left.planVersion,
    stepId: left.stepId,
    manifest: left.manifest,
  }) === stableHash({
    recordId: right.recordId,
    batchId: right.batchId,
    unitId: right.unitId,
    episodeId: right.episodeId,
    planVersion: right.planVersion,
    stepId: right.stepId,
    manifest: right.manifest,
  });
}

function cloneCompatibility(value: ExecutionCompatibilityIdentity): ExecutionCompatibilityIdentity {
  return {
    app: value.app,
    role: value.role,
    assignment: structuredClone(value.assignment),
    operation: value.operation,
  };
}

function requireDateTime(value: string, label: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new ExecutionAffinityError("affinity_manifest_invalid", `${label} must be an ISO date-time`);
  }
  return value;
}

function assertNonEmpty(
  value: string,
  label: string,
  code: ExecutionAffinityFailureCode,
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ExecutionAffinityError(code, `${label} must be non-empty`);
  }
}

function isHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function nonNegativeMetric(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validDateTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function assertCacheTelemetry(value: ExecutionCacheTelemetry): void {
  const metrics = [
    value.cacheReadTokens,
    value.cacheCreationTokens,
    value.uncachedInputTokens,
    value.totalInputTokens,
    value.equivalentCostUsd,
  ];
  const quality = value.usageQuality;
  const validQuality = quality === null || (quality !== undefined &&
    ["complete", "partial", "estimated", "unavailable", "none"].includes(quality));
  const validMetrics = metrics.every((metric) =>
    metric === null || (Number.isFinite(metric) && metric >= 0));
  const splitConsistent = value.evidenceBasis === "cache_split_unavailable"
    ? value.measurement === "unknown"
    : value.evidenceBasis === "provider_cache_split" &&
      value.cacheReadTokens !== null &&
      value.measurement === (value.cacheReadTokens > 0 ? "hit" : "miss");
  if (!validQuality || !validMetrics || !splitConsistent) {
    throw new ExecutionAffinityError(
      "affinity_record_corrupt",
      "cache telemetry is malformed or claims unsupported evidence",
    );
  }
}

function renderJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
