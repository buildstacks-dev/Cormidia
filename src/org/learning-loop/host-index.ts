// Host bookkeeping beside the kernel store: which kernel candidates, plans,
// and interventions each agent-emitted candidate artifact produced. The
// kernel is the source of truth for every governed fact; this index is a
// rebuildable lookup (artifact id → kernel ids) the CLI and reports use to
// trace `cand_…` → kernel candidate → plan → intervention without scanning
// the store. Lives under `<state home>/learning-loop/host/candidates/`.

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import type { CandidateDestination } from "./host/candidate.js";
import type { LoopTier } from "../memory.js";

/** The reviewed routing of an artifact — destination, tier, scope — as the
 *  reviewer's verdict governs it (spec §15). */
export interface CandidateRouting {
  readonly destination: CandidateDestination;
  readonly tier: LoopTier;
  readonly scope: string;
}

export interface HostCandidateEntry {
  readonly id: string;
  readonly routing: CandidateRouting;
  readonly content_digest: string;
  readonly proposed_at: string;
  readonly plan_id?: string;
  readonly intervention_id?: string;
  /** Human-facing refs the publish produced (paths, `#issue`). */
  readonly refs?: readonly string[];
}

export interface HostCandidateIndex {
  readonly schema_version: 1;
  readonly artifact_id: string;
  readonly entries: readonly HostCandidateEntry[];
}

const TIERS = ["T0", "T1", "T2", "T3"] as const;
const DESTINATIONS = [
  "okf_concept",
  "skill_draft",
  "protocol_proposal",
  "eval_or_gate_proposal",
  "ticket",
  "reject",
] as const;

function fail(path: string, message: string): never {
  throw new Error(`learning-loop: ${path}: ${message}`);
}

function text(spec: object, key: string, path: string): string {
  const value: unknown = Reflect.get(spec, key);
  if (typeof value !== "string" || value.length === 0) fail(path, `${key} must be a non-empty string`);
  return value;
}

function optionalText(spec: object, key: string, path: string): string | undefined {
  const value: unknown = Reflect.get(spec, key);
  if (value === undefined || value === null) return undefined;
  return text(spec, key, path);
}

function routing(value: unknown, path: string): CandidateRouting {
  if (value === null || typeof value !== "object") fail(path, "routing must be an object");
  const destination = text(value, "destination", path);
  const tier = text(value, "tier", path);
  const matchedDestination = DESTINATIONS.find((entry) => entry === destination);
  const matchedTier = TIERS.find((entry) => entry === tier);
  if (matchedDestination === undefined) fail(path, `unknown destination "${destination}"`);
  if (matchedTier === undefined) fail(path, `unknown tier "${tier}"`);
  return { destination: matchedDestination, tier: matchedTier, scope: text(value, "scope", path) };
}

function parseIndex(raw: string, path: string): HostCandidateIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(path, "not JSON");
  }
  if (parsed === null || typeof parsed !== "object") fail(path, "must be an object");
  if (Reflect.get(parsed, "schema_version") !== 1) fail(path, "schema_version must be 1");
  const entriesRaw: unknown = Reflect.get(parsed, "entries");
  if (!Array.isArray(entriesRaw)) fail(path, "entries must be an array");
  const entries = entriesRaw.map((entry: unknown, index): HostCandidateEntry => {
    const entryPath = `${path}#entries[${index}]`;
    if (entry === null || typeof entry !== "object") fail(entryPath, "must be an object");
    const planId = optionalText(entry, "plan_id", entryPath);
    const interventionId = optionalText(entry, "intervention_id", entryPath);
    const refsRaw: unknown = Reflect.get(entry, "refs");
    const refs = Array.isArray(refsRaw) ? refsRaw.filter((ref): ref is string => typeof ref === "string") : undefined;
    return {
      id: text(entry, "id", entryPath),
      routing: routing(Reflect.get(entry, "routing"), entryPath),
      content_digest: text(entry, "content_digest", entryPath),
      proposed_at: text(entry, "proposed_at", entryPath),
      ...(planId !== undefined ? { plan_id: planId } : {}),
      ...(interventionId !== undefined ? { intervention_id: interventionId } : {}),
      ...(refs !== undefined ? { refs } : {}),
    };
  });
  return { schema_version: 1, artifact_id: text(parsed, "artifact_id", path), entries };
}

function indexDir(stateDir: string): string {
  return join(stateDir, "host", "candidates");
}

function indexPath(stateDir: string, artifactId: string): string {
  return join(indexDir(stateDir), `${artifactId}.json`);
}

export async function readHostCandidateIndex(
  stateDir: string,
  artifactId: string,
): Promise<HostCandidateIndex | undefined> {
  const path = indexPath(stateDir, artifactId);
  if (!existsSync(path)) return undefined;
  return parseIndex(await readFile(path, "utf8"), path);
}

async function writeIndex(stateDir: string, index: HostCandidateIndex): Promise<void> {
  await mkdir(indexDir(stateDir), { recursive: true });
  await writeFileAtomic(indexPath(stateDir, index.artifact_id), `${JSON.stringify(index, null, 2)}\n`);
}

export async function appendHostCandidateEntry(
  stateDir: string,
  artifactId: string,
  entry: HostCandidateEntry,
): Promise<HostCandidateIndex> {
  const existing = (await readHostCandidateIndex(stateDir, artifactId)) ?? {
    schema_version: 1 as const,
    artifact_id: artifactId,
    entries: [],
  };
  if (existing.entries.some((known) => known.id === entry.id)) return existing;
  const next: HostCandidateIndex = { ...existing, entries: [...existing.entries, entry] };
  await writeIndex(stateDir, next);
  return next;
}

export async function updateHostCandidateEntry(
  stateDir: string,
  artifactId: string,
  id: string,
  patch: Pick<HostCandidateEntry, "plan_id" | "intervention_id" | "refs">,
): Promise<HostCandidateIndex | undefined> {
  const existing = await readHostCandidateIndex(stateDir, artifactId);
  if (existing === undefined) return undefined;
  const next: HostCandidateIndex = {
    ...existing,
    entries: existing.entries.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            ...(patch.plan_id !== undefined ? { plan_id: patch.plan_id } : {}),
            ...(patch.intervention_id !== undefined ? { intervention_id: patch.intervention_id } : {}),
            ...(patch.refs !== undefined ? { refs: patch.refs } : {}),
          }
        : entry,
    ),
  };
  await writeIndex(stateDir, next);
  return next;
}

/** Every index, sorted by artifact id. */
export async function listHostCandidateIndexes(stateDir: string): Promise<HostCandidateIndex[]> {
  const dir = indexDir(stateDir);
  if (!existsSync(dir)) return [];
  const out: HostCandidateIndex[] = [];
  for (const name of (await readdir(dir)).filter((entry) => entry.endsWith(".json")).sort()) {
    const path = join(dir, name);
    out.push(parseIndex(await readFile(path, "utf8"), path));
  }
  return out;
}

/** The artifact id a kernel candidate id derives from (`cand_x` or `cand_x~abcd1234`). */
export function artifactIdOf(kernelCandidateId: string): string {
  const tilde = kernelCandidateId.indexOf("~");
  return tilde === -1 ? kernelCandidateId : kernelCandidateId.slice(0, tilde);
}
