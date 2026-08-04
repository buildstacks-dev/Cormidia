// HB-072/HB-073 — fail-closed admission gate. The build agent may provide the
// scaffold and parser, but only a hash-bound human-authored + human-reviewed
// threat model can admit abuse cases or release-gating reactivation.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { parse } from "yaml";

export const THREAT_SURFACES = ["TM-01", "TM-02", "TM-03", "TM-04", "TM-05", "TM-06", "TM-07", "TM-08", "TM-09", "TM-10"] as const;

export interface RatifiedThreatModelGate {
  status_path: string;
  artifact_path: string;
  artifact_sha256: string;
  author: string;
  reviewer: string;
  abuse_case_ids: string[];
}

export async function requireHumanThreatModel(statusPath: string): Promise<RatifiedThreatModelGate> {
  const absoluteStatus = resolve(statusPath);
  const root = object(parse(await readFile(absoluteStatus, "utf8")), "threat-model status");
  exact(root, ["schema_version", "status", "human_authored", "human_reviewed", "artifact", "artifact_sha256", "author", "authored_at", "reviewer", "reviewed_at", "covered_surfaces", "abuse_case_ids", "release_gating_acknowledged", "note"]);
  if (root["schema_version"] !== 1) throw new Error("threat-model gate: unsupported schema_version");
  if (root["status"] !== "human_authored_reviewed" || root["human_authored"] !== true || root["human_reviewed"] !== true) {
    throw new Error("threat-model gate BLOCKED: HB-072 requires a human-authored and human-reviewed threat model");
  }
  if (root["release_gating_acknowledged"] !== true) throw new Error("threat-model gate BLOCKED: release-gating condition was not acknowledged");
  const author = required(root["author"], "author"); const reviewer = required(root["reviewer"], "reviewer");
  instant(root["authored_at"], "authored_at"); instant(root["reviewed_at"], "reviewed_at");
  const surfaces = uniqueStrings(root["covered_surfaces"], "covered_surfaces").sort();
  if (JSON.stringify(surfaces) !== JSON.stringify([...THREAT_SURFACES])) throw new Error("threat-model gate BLOCKED: all ten ratified surfaces must be covered");
  const abuseCaseIds = uniqueStrings(root["abuse_case_ids"], "abuse_case_ids");
  if (abuseCaseIds.length === 0 || abuseCaseIds.some((id) => !/^CF-OPS-ABUSE-[A-Z0-9_-]+$/.test(id))) throw new Error("threat-model gate BLOCKED: human-authored abuse case IDs are required");
  const artifactValue = required(root["artifact"], "artifact");
  const artifactPath = isAbsolute(artifactValue) ? resolve(artifactValue) : resolve(dirname(absoluteStatus), artifactValue);
  const expected = required(root["artifact_sha256"], "artifact_sha256");
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("threat-model gate BLOCKED: artifact_sha256 is invalid");
  const actual = createHash("sha256").update(await readFile(artifactPath)).digest("hex");
  if (actual !== expected) throw new Error("threat-model gate BLOCKED: artifact digest does not match reviewed bytes");
  return { status_path: absoluteStatus, artifact_path: artifactPath, artifact_sha256: actual, author, reviewer, abuse_case_ids: abuseCaseIds };
}

function object(value: unknown, name: string): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: string[]): void { const allowed = new Set(keys); const extra = Object.keys(value).filter((key) => !allowed.has(key)); if (extra.length > 0) throw new Error(`threat-model gate: unknown field(s): ${extra.join(", ")}`); }
function required(value: unknown, name: string): string { if (typeof value !== "string" || value.trim() === "") throw new Error(`threat-model gate: ${name} is required`); return value; }
function instant(value: unknown, name: string): string { const out = required(value, name); if (!Number.isFinite(Date.parse(out))) throw new Error(`threat-model gate: ${name} must be an instant`); return out; }
function uniqueStrings(value: unknown, name: string): string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item === "") || new Set(value).size !== value.length) throw new Error(`threat-model gate: ${name} must be a unique string array`); return value as string[]; }
