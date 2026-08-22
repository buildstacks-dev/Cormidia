// The versioned read side for projected episode records consumed as kernel
// evidence. `src/org/learning-loop/host/episode.ts` writes `learning/episodes/*.json`
// and reads them back through a bare cast (the blind-cast seam class of
// #407); evidence crossing into the kernel must instead be parsed from
// `unknown` (AGENTS.md: parse, don't cast), so this module validates exactly
// the fields the projection uses, refuses any other schema version, and
// carries the raw outcome along as a JSON value for the outcome observation.

import { toJsonValue } from "@cormidia/learning-loop";
import type { JsonValue } from "@cormidia/learning-loop";

export interface EpisodeGateEvidence {
  readonly gate: string;
  readonly status: "pass" | "fail" | "skip";
  readonly run_id: string;
  readonly detail?: string;
}

export interface EpisodeLateOutcomeEvidence {
  readonly kind: string;
  readonly ref: string;
  readonly recorded: string;
  readonly note?: string;
}

export interface EpisodeOutcomeEvidence {
  readonly completed: boolean;
  readonly cost_usd: number;
  readonly review_cycles: number;
  readonly gate_failures: number;
  readonly human_interventions: number;
  readonly terminal_reason?: string;
  /** The whole outcome mapping, for the outcome observation's data. */
  readonly raw: JsonValue;
}

export interface EpisodeEvidenceRecord {
  readonly episode_id: string;
  readonly kind: string;
  readonly app: string;
  readonly opened: string;
  readonly closed?: string;
  readonly status: "open" | "closed";
  readonly gates: readonly EpisodeGateEvidence[];
  readonly late_outcomes: readonly EpisodeLateOutcomeEvidence[];
  readonly outcome?: EpisodeOutcomeEvidence;
}

function fail(source: string, message: string): never {
  throw new Error(`learning-loop: ${source}: ${message}`);
}

function mapping(value: unknown, source: string, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(source, `${label} must be a mapping`);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[key] = Reflect.get(value, key);
  return out;
}

function text(spec: Record<string, unknown>, key: string, source: string): string {
  const value = spec[key];
  if (typeof value !== "string" || value.length === 0) fail(source, `${key} must be a non-empty string`);
  return value;
}

function optionalText(spec: Record<string, unknown>, key: string, source: string): string | undefined {
  if (spec[key] === undefined || spec[key] === null) return undefined;
  return text(spec, key, source);
}

function finite(spec: Record<string, unknown>, key: string, source: string): number {
  const value = spec[key];
  if (typeof value !== "number" || !Number.isFinite(value)) fail(source, `${key} must be a finite number`);
  return value;
}

function list(spec: Record<string, unknown>, key: string, source: string): unknown[] {
  const value = spec[key];
  if (!Array.isArray(value)) fail(source, `${key} must be an array`);
  return value;
}

function gate(value: unknown, source: string): EpisodeGateEvidence {
  const spec = mapping(value, source, "gate entry");
  const status = spec["status"];
  if (status !== "pass" && status !== "fail" && status !== "skip")
    fail(source, "gate status must be pass, fail, or skip");
  const detail = optionalText(spec, "detail", source);
  return {
    gate: text(spec, "gate", source),
    status,
    run_id: text(spec, "run_id", source),
    ...(detail !== undefined ? { detail } : {}),
  };
}

function lateOutcome(value: unknown, source: string): EpisodeLateOutcomeEvidence {
  const spec = mapping(value, source, "late outcome");
  const note = optionalText(spec, "note", source);
  return {
    kind: text(spec, "kind", source),
    ref: text(spec, "ref", source),
    recorded: text(spec, "recorded", source),
    ...(note !== undefined ? { note } : {}),
  };
}

function outcome(value: unknown, source: string): EpisodeOutcomeEvidence {
  const spec = mapping(value, source, "outcome");
  if (typeof spec["completed"] !== "boolean") fail(source, "outcome.completed must be a boolean");
  const terminal = optionalText(spec, "terminal_reason", source);
  return {
    completed: spec["completed"] === true,
    cost_usd: finite(spec, "cost_usd", source),
    review_cycles: finite(spec, "review_cycles", source),
    gate_failures: finite(spec, "gate_failures", source),
    human_interventions: finite(spec, "human_interventions", source),
    ...(terminal !== undefined ? { terminal_reason: terminal } : {}),
    raw: toJsonValue(spec),
  };
}

/** Parse one projected episode record from unknown JSON; `source` names the file. */
export function parseEpisodeEvidenceRecord(value: unknown, source: string): EpisodeEvidenceRecord {
  const spec = mapping(value, source, "episode record");
  if (spec["schema_version"] !== 1) fail(source, "schema_version must be 1");
  const status = spec["status"];
  if (status !== "open" && status !== "closed") fail(source, "status must be open or closed");
  const closed = optionalText(spec, "closed", source);
  const rawOutcome = spec["outcome"];
  return {
    episode_id: text(spec, "episode_id", source),
    kind: text(spec, "kind", source),
    app: text(spec, "app", source),
    opened: text(spec, "opened", source),
    ...(closed !== undefined ? { closed } : {}),
    status,
    gates: list(spec, "gates", source).map((entry) => gate(entry, source)),
    late_outcomes: list(spec, "late_outcomes", source).map((entry) => lateOutcome(entry, source)),
    ...(rawOutcome !== undefined && rawOutcome !== null ? { outcome: outcome(rawOutcome, source) } : {}),
  };
}
