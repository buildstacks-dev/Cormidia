import type { TurnResult } from "../../../src/runtime/types.js";

const STATUSES = new Set(["completed", "blocked_on_gate", "failed", "cancelled", "timed_out"]);
const RUNTIMES = new Set(["claude", "codex", "pi"]);
const USAGE_QUALITIES = new Set(["complete", "partial", "estimated", "unavailable", "none"]);

/**
 * Harness-side evidence validator. It checks the normalized runtime envelope;
 * it is not a substitute for adapter conformance or a live provider probe.
 */
export function assertTurnResultContract(value: unknown): asserts value is TurnResult {
  const result = mapping(value, "turn result");
  exactKeys(
    result,
    ["status", "summary", "artifacts", "session", "usage", "escalations", "errorCode"],
    "turn result",
    ["errorCode"],
  );
  member(result.status, STATUSES, "turn result.status");
  text(result.summary, "turn result.summary");
  const session = mapping(result.session, "turn result.session");
  exactKeys(session, ["runtime", "id"], "turn result.session");
  member(session.runtime, RUNTIMES, "turn result.session.runtime");
  text(session.id, "turn result.session.id");

  const usage = mapping(result.usage, "turn result.usage");
  exactKeys(
    usage,
    [
      "tokensIn",
      "tokensInUncached",
      "cacheCreationTokens",
      "cacheReadTokens",
      "tokensOut",
      "costUsd",
      "costEstimated",
      "subagentTurns",
      "wallClockMs",
      "quality",
    ],
    "turn result.usage",
    [
      "tokensInUncached",
      "cacheCreationTokens",
      "cacheReadTokens",
      "costEstimated",
      "quality",
    ],
  );
  for (const key of [
    "tokensIn",
    "tokensOut",
    "subagentTurns",
    "wallClockMs",
  ] as const) {
    nonNegativeInteger(usage[key], `turn result.usage.${key}`);
  }
  nonNegativeFinite(usage.costUsd, "turn result.usage.costUsd");
  for (const key of ["tokensInUncached", "cacheCreationTokens", "cacheReadTokens"] as const) {
    if (usage[key] !== undefined) nonNegativeInteger(usage[key], `turn result.usage.${key}`);
  }
  if (usage.costEstimated !== undefined && typeof usage.costEstimated !== "boolean") {
    throw new Error("turn result.usage.costEstimated must be a boolean");
  }
  if (usage.quality !== undefined) member(usage.quality, USAGE_QUALITIES, "turn result.usage.quality");

  const artifacts = list(result.artifacts, "turn result.artifacts");
  for (const [index, artifactValue] of artifacts.entries()) {
    const artifact = mapping(artifactValue, `turn result.artifacts[${index}]`);
    exactKeys(artifact, ["kind", "ref", "summary"], `turn result.artifacts[${index}]`);
    text(artifact.kind, `turn result.artifacts[${index}].kind`);
    text(artifact.ref, `turn result.artifacts[${index}].ref`);
    text(artifact.summary, `turn result.artifacts[${index}].summary`);
  }

  const escalations = list(result.escalations, "turn result.escalations");
  for (const [index, escalationValue] of escalations.entries()) {
    const escalation = mapping(escalationValue, `turn result.escalations[${index}]`);
    exactKeys(escalation, ["action", "reason"], `turn result.escalations[${index}]`);
    mapping(escalation.action, `turn result.escalations[${index}].action`);
    text(escalation.reason, `turn result.escalations[${index}].reason`);
  }
  if (result.errorCode !== undefined) text(result.errorCode, "turn result.errorCode");
  if (result.status === "completed") {
    if (
      usage.quality === undefined ||
      usage.quality === "partial" ||
      usage.quality === "unavailable" ||
      usage.quality === "none"
    ) {
      throw new Error("completed turn result must not claim success with missing usage");
    }
    if (result.errorCode !== undefined) {
      throw new Error("completed turn result must not contain an errorCode");
    }
  }
}

function mapping(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
  return value;
}

function text(value: unknown, label: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be non-empty text`);
}

function member(value: unknown, allowed: Set<string>, label: string): void {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`${label} is not recognized`);
  }
}

function nonNegativeFinite(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
}

function nonNegativeInteger(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
  optional: readonly string[] = [],
): void {
  const permitted = new Set(expected);
  const optionalSet = new Set(optional);
  const unknown = Object.keys(value).filter((key) => !permitted.has(key));
  const missing = expected.filter((key) => !optionalSet.has(key) && !(key in value));
  if (unknown.length > 0) throw new Error(`${label} has unknown key(s): ${unknown.join(", ")}`);
  if (missing.length > 0) throw new Error(`${label} is missing key(s): ${missing.join(", ")}`);
}
