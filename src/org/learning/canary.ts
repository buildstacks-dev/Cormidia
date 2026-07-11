// Episode-sticky live canary (M5; design §8.4, §6.1; spec §13 tier table).
//
// Assignment is a deterministic function of `episode_id` — never
// Math.random, never turnId — so Builder, Reviewer, fix, and gate turns in
// one episode all see the same bundle lineage. The first governed resolve
// writes an assignment record; every later resolve in the episode honors it
// (stickiness survives fraction changes and manifest churn). New episodes
// stop entering the canary once the window elapses (bounded exposure);
// already-assigned episodes stay sticky until the human promotes or stops
// the trial.
//
// Starting a canary is a human act, tier-gated fail-closed: a tier without
// an explicit canary policy has no canary path, and T3 is structurally
// forbidden at policy load (policy.ts) — this module never needs a T3
// special case because a policy granting one cannot exist.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import { findCandidateArtifact } from "./candidate-store.js";
import {
  appLearningRoot,
  orgLearningRoot,
  promoteCanaryOnManifest,
  readManifest,
  startCanaryOnManifest,
  stopCanaryOnManifest,
  type CanaryCloseResult,
  type LearningManifest,
  type LearningRoot,
  type ManifestCanaryMeta,
} from "./concepts.js";
import { sanitizeIdSegment } from "./events.js";
import { readEvalResult } from "./eval-result.js";
import { readExperimentRecord } from "./experiment.js";
import { listInFlightOkfJournals } from "./publisher.js";
import {
  readInterventionRecord,
  writeInterventionRecord,
  type InterventionRecord,
} from "./intervention.js";
import type { LearningPolicy, TierCanaryPolicy } from "./policy.js";

export type BundleLineage = "stable" | "canary";
export type CanaryRootKind = "org" | "app";

// ---------------------------------------------------------------------------
// deterministic assignment
// ---------------------------------------------------------------------------

/** Uniform [0, 1) bucket from the episode id (design §8.4). 52 bits of the
 *  sha256 keep the double exact. */
export function canaryBucket(episodeId: string): number {
  const digest = createHash("sha256").update(episodeId, "utf8").digest("hex");
  return Number.parseInt(digest.slice(0, 13), 16) / 2 ** 52;
}

// ---------------------------------------------------------------------------
// assignment records (state home) — the sticky pin
// ---------------------------------------------------------------------------

export interface CanaryRootAssignment {
  /** The canary version the assignment was made against. A later trial on
   *  the same root never inherits an old trial's assignment. */
  version: string;
  lineage: BundleLineage;
}

export interface CanaryAssignmentRecord {
  episode_id: string;
  app: string;
  /** Turn whose resolve made the assignment — auditability, not identity. */
  turn_id: string;
  assigned_at: string;
  bucket: number;
  roots: Partial<Record<CanaryRootKind, CanaryRootAssignment>>;
  /** Roots whose manifest was unreadable at pin time: their entry could not
   *  be decided, so the first later resolve that CAN read the manifest
   *  decides and merges it in — a missing entry here means pre-trial stable
   *  forever, an undecided one stays open. */
  undecided?: CanaryRootKind[];
  /** `canary` when any root assigned canary — the episode-level label the
   *  EpisodeRecord and reports fold. */
  lineage: BundleLineage;
}

export function canaryAssignmentsDir(stateHome: string): string {
  return join(stateHome, "learning", "canary", "assignments");
}

export function canaryAssignmentPath(stateHome: string, episodeId: string): string {
  return join(canaryAssignmentsDir(stateHome), `${sanitizeIdSegment(episodeId)}.json`);
}

export async function readCanaryAssignment(
  stateHome: string,
  episodeId: string,
): Promise<CanaryAssignmentRecord | undefined> {
  const path = canaryAssignmentPath(stateHome, episodeId);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(await readFile(path, "utf8")) as CanaryAssignmentRecord;
  } catch (error) {
    throw new Error(
      `learning: ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** First write wins: assignment is made once per episode; a concurrent or
 *  repeated resolve returns the existing record untouched. */
export async function writeCanaryAssignmentOnce(
  stateHome: string,
  record: CanaryAssignmentRecord,
): Promise<CanaryAssignmentRecord> {
  const existing = await readCanaryAssignment(stateHome, record.episode_id);
  if (existing !== undefined) return existing;
  const path = canaryAssignmentPath(stateHome, record.episode_id);
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, JSON.stringify(record, null, 2) + "\n");
  return record;
}

/** Settle one previously-undecided root on an existing record: writes the
 *  root's entry (or just clears the undecided marker for a stable no-trial
 *  decision with no entry) exactly once — a root that already has an entry
 *  is never rewritten. */
export async function settleCanaryAssignmentRoot(
  stateHome: string,
  episodeId: string,
  kind: CanaryRootKind,
  assignment: CanaryRootAssignment | undefined,
): Promise<CanaryAssignmentRecord | undefined> {
  const existing = await readCanaryAssignment(stateHome, episodeId);
  if (existing === undefined) return undefined;
  if (existing.roots[kind] !== undefined || !(existing.undecided ?? []).includes(kind)) {
    return existing;
  }
  const undecided = (existing.undecided ?? []).filter((entry) => entry !== kind);
  const next: CanaryAssignmentRecord = {
    ...existing,
    roots: { ...existing.roots, ...(assignment !== undefined ? { [kind]: assignment } : {}) },
    ...(undecided.length > 0 ? { undecided } : {}),
    lineage:
      assignment?.lineage === "canary" ? "canary" : existing.lineage,
  };
  if (undecided.length === 0) delete (next as { undecided?: CanaryRootKind[] }).undecided;
  await writeFileAtomic(
    canaryAssignmentPath(stateHome, episodeId),
    JSON.stringify(next, null, 2) + "\n",
  );
  return next;
}

/** Every assignment record, sorted by file name. One torn record degrades
 *  with a loud stderr line (skip-warn) — status and reports must not die on
 *  a single crashed write. */
export async function listCanaryAssignments(
  stateHome: string,
): Promise<CanaryAssignmentRecord[]> {
  const dir = canaryAssignmentsDir(stateHome);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  const records: CanaryAssignmentRecord[] = [];
  for (const name of files) {
    try {
      records.push(JSON.parse(await readFile(join(dir, name), "utf8")) as CanaryAssignmentRecord);
    } catch (error) {
      process.stderr.write(
        `learning: skipping ${join(dir, name)} — ` +
          `${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// per-root lineage decision (the resolver's half)
// ---------------------------------------------------------------------------

export interface RootLineageDecision {
  lineage: BundleLineage;
  /** The version the resolve record reports for this root. */
  version: string;
  /** Concept ids the stable lineage excludes (the trial's concepts);
   *  empty for the canary lineage or when no trial is running. */
  excluded: string[];
  /** Set when this resolve should record a fresh assignment for the root —
   *  only while a trial is active and its window is open. */
  assignment?: CanaryRootAssignment;
}

/** Decide one root's lineage for one episode. `existing` is the sticky
 *  assignment (first resolve wins); without one, an open-window trial
 *  assigns by bucket and an elapsed window assigns stable. */
export function decideRootLineage(input: {
  manifest: LearningManifest | null;
  existing?: CanaryRootAssignment | undefined;
  bucket: number;
  now: Date;
}): RootLineageDecision {
  const manifest = input.manifest;
  if (manifest === null) return { lineage: "stable", version: "unversioned", excluded: [] };
  const meta = manifest.canary_meta;
  if (meta === null || manifest.canary === null) {
    // No trial running — a stale sticky record (stopped/promoted trial)
    // falls back to stable, which now IS the decided content.
    return { lineage: "stable", version: manifest.stable, excluded: [] };
  }
  if (input.existing !== undefined) {
    if (input.existing.version === meta.version && input.existing.lineage === "canary") {
      return { lineage: "canary", version: meta.version, excluded: [] };
    }
    // Assigned stable under this trial, or assigned under a previous trial:
    // this episode is not part of the running trial's population.
    return { lineage: "stable", version: manifest.stable, excluded: [...meta.concepts] };
  }
  const windowMs = meta.window_hours * 60 * 60 * 1000;
  const windowOpen = input.now.getTime() < new Date(meta.started_at).getTime() + windowMs;
  if (!windowOpen) {
    // Bounded exposure: the window admits no new episodes; no assignment
    // record either — the episode never entered the trial population.
    return { lineage: "stable", version: manifest.stable, excluded: [...meta.concepts] };
  }
  const lineage: BundleLineage = input.bucket < meta.fraction ? "canary" : "stable";
  if (lineage === "canary") {
    return {
      lineage,
      version: meta.version,
      excluded: [],
      assignment: { version: meta.version, lineage },
    };
  }
  return {
    lineage,
    version: manifest.stable,
    excluded: [...meta.concepts],
    assignment: { version: meta.version, lineage },
  };
}

// ---------------------------------------------------------------------------
// human lifecycle: start / promote / stop (design §6.1 — canary starts and
// promotions are human acts; the CLI is the gate)
// ---------------------------------------------------------------------------

export interface StartCanaryOptions {
  orgHome: string;
  /** Required when the intervention published into an app root. */
  appWorkdir?: string;
  interventionId: string;
  policy: LearningPolicy;
  /** When given, an in-flight okf publish journal targeting the same root
   *  refuses the start: its resume would land ungoverned content
   *  mid-window. */
  stateHome?: string;
  now?: Date;
}

export interface StartedCanary {
  root: CanaryRootKind;
  version: string;
  meta: ManifestCanaryMeta;
  canaryPolicy: TierCanaryPolicy;
}

export async function startCanary(options: StartCanaryOptions): Promise<StartedCanary> {
  const now = options.now ?? new Date();
  const intervention = await readInterventionRecord(options.orgHome, options.interventionId);
  if (intervention.destination !== "okf_concept" || intervention.publish?.kind !== "bundle_version") {
    throw new Error(
      `learning: ${options.interventionId} is a ${intervention.destination} publish — ` +
        `only bundle-version activations (okf_concept) take a live canary`,
    );
  }
  if (intervention.status !== "active") {
    throw new Error(
      `learning: ${options.interventionId} is "${intervention.status}" — only an active ` +
        `intervention can start a canary`,
    );
  }
  const { rootKind, version } = parseBundleRef(intervention.publish.ref, options.interventionId);
  const root = resolveRoot(rootKind, options);

  // Tier gating, fail closed. The candidate carries the reviewed tier; a
  // pruned candidate leaves the tier unknowable — refuse rather than guess.
  const found = await findCandidateArtifact(
    rootKind === "app" ? [orgLearningRoot(options.orgHome), root] : [root],
    intervention.candidate_ref,
  );
  if (found === undefined) {
    throw new Error(
      `learning: candidate ${intervention.candidate_ref} for ${options.interventionId} is not ` +
        `readable — its tier decides canary policy and cannot be assumed`,
    );
  }
  const tier = found.candidate.proposed_tier;
  const tierPolicy = options.policy.tiers[tier];
  if (tierPolicy.live_canary === "forbidden") {
    throw new Error(
      `learning: tier ${tier} forbids live canary exposure (policy §13; design §6) — ` +
        `allowed trials: ${tierPolicy.allowed_trials.join(", ") || "none"}`,
    );
  }
  if (tierPolicy.canary === null) {
    throw new Error(
      `learning: tier ${tier} declares no canary policy — a tier without one has no ` +
        `canary path (fail closed)`,
    );
  }
  if (tierPolicy.canary.requires_replay_pass) {
    await requireReplayPass(options.orgHome, intervention, tier);
  }
  if (options.stateHome !== undefined) {
    const inFlight = await listInFlightOkfJournals(options.stateHome, rootKind);
    if (inFlight.length > 0) {
      throw new Error(
        `learning: publish journal(s) ${inFlight.join(", ")} are mid-transaction on the ` +
          `${rootKind} root — finish (re-run publish) or resolve them before starting a trial; ` +
          `a resume mid-window would land ungoverned content in both arms`,
      );
    }
  }

  const manifest = await startCanaryOnManifest(root, {
    version,
    windowHours: tierPolicy.canary.window_hours,
    fraction: tierPolicy.canary.fraction,
    tier,
    interventionRef: intervention.intervention_id,
    now,
  });
  return {
    root: rootKind,
    version,
    meta: manifest.canary_meta!,
    canaryPolicy: tierPolicy.canary,
  };
}

export interface CloseCanaryOptions {
  orgHome: string;
  appWorkdir?: string;
  root: CanaryRootKind;
  now?: Date;
}

export async function promoteCanary(options: CloseCanaryOptions): Promise<CanaryCloseResult> {
  const root = resolveRoot(options.root, options);
  return promoteCanaryOnManifest(root, options.now !== undefined ? { now: options.now } : {});
}

/** Stop = the trial failed or is abandoned: deprecate its concepts, cut the
 *  stop version, and mark the intervention rolled back. */
export async function stopCanary(
  options: CloseCanaryOptions & { reason: string },
): Promise<CanaryCloseResult> {
  const root = resolveRoot(options.root, options);
  const result = await stopCanaryOnManifest(
    root,
    options.now !== undefined ? { now: options.now } : {},
  );
  const now = options.now ?? new Date();
  try {
    const intervention = await readInterventionRecord(
      options.orgHome,
      result.meta.intervention_ref,
    );
    const next: InterventionRecord = {
      ...intervention,
      status: "rolled_back",
      rollback: { rolled_back_at: now.toISOString(), reason: options.reason },
    };
    await writeInterventionRecord(options.orgHome, next);
  } catch (error) {
    // The manifest is already safe (concepts deprecated, trial cleared);
    // a missing/corrupt intervention record must not resurrect it.
    process.stderr.write(
      `learning: canary stopped but intervention ${result.meta.intervention_ref} was not ` +
        `updated: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function resolveRoot(
  kind: CanaryRootKind,
  options: { orgHome: string; appWorkdir?: string },
): LearningRoot {
  if (kind === "org") return orgLearningRoot(options.orgHome);
  if (options.appWorkdir === undefined) {
    throw new Error("learning: an app-root canary needs the app checkout (--app)");
  }
  return appLearningRoot(options.appWorkdir);
}

function parseBundleRef(
  ref: string,
  interventionId: string,
): { rootKind: CanaryRootKind; version: string } {
  const match = /^(org|app)@(.+)$/.exec(ref);
  if (match === null || match[2] === "unversioned") {
    throw new Error(
      `learning: ${interventionId} publish ref "${ref}" is not a versioned bundle ref`,
    );
  }
  return { rootKind: match[1] as CanaryRootKind, version: match[2]! };
}

async function requireReplayPass(
  orgHome: string,
  intervention: InterventionRecord,
  tier: string,
): Promise<void> {
  const refuse = (detail: string): never => {
    throw new Error(
      `learning: tier ${tier} requires a passed replay before live canary ` +
        `(policy §13 requires_replay_pass): ${detail}`,
    );
  };
  if (intervention.experiment_ref === null) {
    refuse(`${intervention.intervention_id} has no experiment`);
  }
  const experiment = await readExperimentRecord(orgHome, intervention.experiment_ref!);
  if (experiment.status !== "decided" || experiment.result === null) {
    refuse(`${experiment.experiment_id} is ${experiment.status}, not decided`);
  }
  const result = await readEvalResult(orgHome, experiment.result!);
  if (result.layer !== "replay" || result.verdict !== "improved") {
    refuse(
      `${result.eval_id} is a ${result.layer}-layer "${result.verdict}" — ` +
        `an improved replay verdict is the gate`,
    );
  }
}

/** Read a root's manifest without requiring the root to exist. */
export async function readRootManifest(
  kind: CanaryRootKind,
  options: { orgHome: string; appWorkdir?: string },
): Promise<LearningManifest | null> {
  if (kind === "app" && options.appWorkdir === undefined) return null;
  return readManifest(resolveRoot(kind, options));
}
