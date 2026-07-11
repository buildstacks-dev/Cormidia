// ReplayCapsule assembly and completeness validation
// (docs/learning-loop/learning-loop-design.md §9.4; spec §7, §16
// CapsuleBuilder). V1 scope: BUILD episodes only — git gives a strong state
// snapshot, so the capsule is mostly free; Support/Marketing/SRE capsules
// need synthetic channels or disposable services and are V2.
//
// Assembly is deterministic software over durable sources: the projected
// EpisodeRecord, the run envelopes' pass-start `git_head` (captured while
// the episode ran, design §9.4 — never reconstructed from logs), the run's
// verbatim brief.md, and the app registry's repo slug. Model tokens are
// spent on replay EXECUTION (M5), never on capture.
//
// Trust boundary: `expected_outcome`, `grader`, and `validated_by` stay null
// here — converting a capsule into a trusted eval fixture is M3, and it
// requires independent validation before `validated_by` is set. Until then
// every capsule is at best partially replayable, and `missing` says exactly
// what stands between it and trusted replay. The fingerprint attached at
// assembly describes the system AT ASSEMBLY TIME; episodes replayed under a
// drifted configuration surface the drift through the fingerprint diff, not
// through a silent lie about what ran.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readEnvelope, type RunEnvelope } from "../../runtime/runlog/envelope.js";
import { runPaths } from "../../runtime/runlog/paths.js";
import { writeFileAtomic } from "../atomic.js";
import { readEpisodeRecord, type EpisodeRecord } from "./episode.js";

export type Replayability = "replayable" | "partially_replayable" | "non_replayable";

export interface ReplayCapsule {
  capsule_id: string;
  episode_ref: string;
  kind: "build_ticket";
  seed: { repo: string | null; commit: string | null; fixtures: string[] };
  input: { ticket_ref: string; brief_hash: string | null };
  fingerprint_ref: string | null;
  artifacts: string[];
  observed_outcome: {
    merged: boolean | null;
    review_cycles: number | null;
    cost_usd: number | null;
  } | null;
  /** Trusted grader target; null until an M3 validation pass sets it. */
  expected_outcome: null;
  grader: null;
  side_effect_policy: {
    network: "fixture_only";
    publishing: "forbidden";
    deployment: "sandbox_only";
  };
  replayability: Replayability;
  /** What stands between this capsule and trusted replay. */
  missing: string[];
  sanitized: false;
  validated_by: null;
}

export interface CapsuleBuilder {
  /** Deterministic assembly from durable sources; writes the capsule under
   *  `learning/capsules/`. Throws for non-build episodes (V1 scope). */
  assemble(episodeId: string): Promise<ReplayCapsule>;
  classify(capsule: Pick<ReplayCapsule, "seed" | "observed_outcome" | "missing">): Replayability;
}

export interface CapsuleBuilderOptions {
  stateHome: string;
  /** App name → GitHub slug (`owner/repo`), from the apps registry. */
  repoByApp?: Record<string, string>;
  /** Assembly-time fingerprint id (already stored); null-safe when absent. */
  fingerprintRef?: string;
}

export function capsulesDir(stateHome: string): string {
  return join(stateHome, "learning", "capsules");
}

export function capsulePath(stateHome: string, capsuleId: string): string {
  return join(capsulesDir(stateHome), `${capsuleId}.json`);
}

export function createCapsuleBuilder(options: CapsuleBuilderOptions): CapsuleBuilder {
  const { stateHome } = options;

  const classify: CapsuleBuilder["classify"] = (capsule) => {
    if (capsule.seed.repo === null || capsule.observed_outcome === null) {
      return "non_replayable";
    }
    return capsule.missing.length > 0 ? "partially_replayable" : "replayable";
  };

  return {
    classify,

    async assemble(episodeId: string): Promise<ReplayCapsule> {
      const record = await readEpisodeRecord(stateHome, episodeId);
      if (record.kind !== "build_ticket") {
        throw new Error(
          `learning: replay capsules cover build episodes only in V1 (design §9.4) — ` +
            `${episodeId} is ${record.kind}`,
        );
      }

      const missing: string[] = [];
      const repo = options.repoByApp?.[record.app] ?? null;
      if (repo === null) missing.push("seed_repo");

      const seedRun = await earliestBuildRun(stateHome, record);
      const commit = seedRun?.git_head ?? null;
      if (commit === null) missing.push("seed_commit");

      const briefHash = seedRun !== undefined ? await briefHashOf(stateHome, seedRun) : null;
      if (briefHash === null) missing.push("brief_hash");

      const fingerprintRef = options.fingerprintRef ?? null;
      if (fingerprintRef === null) missing.push("fingerprint");

      const observed =
        record.outcome !== undefined
          ? {
              merged: record.outcome.merged ?? null,
              review_cycles: record.outcome.review_cycles,
              cost_usd: record.outcome.cost_usd,
            }
          : null;
      if (observed === null) missing.push("closed_outcome");

      // Every M2 capsule lacks a validated grader target by construction.
      missing.push("trusted_expected_outcome");

      const capsule: ReplayCapsule = {
        capsule_id: `replay_${episodeId.replace(/^ep_/, "")}`,
        episode_ref: episodeId,
        kind: "build_ticket",
        seed: { repo, commit, fixtures: [] },
        input: { ticket_ref: ticketRefOf(record), brief_hash: briefHash },
        fingerprint_ref: fingerprintRef,
        artifacts: [...record.artifacts],
        observed_outcome: observed,
        expected_outcome: null,
        grader: null,
        side_effect_policy: {
          network: "fixture_only",
          publishing: "forbidden",
          deployment: "sandbox_only",
        },
        replayability: "non_replayable",
        missing,
        sanitized: false,
        validated_by: null,
      };
      capsule.replayability = classify(capsule);

      const path = capsulePath(stateHome, capsule.capsule_id);
      const next = JSON.stringify(capsule, null, 2) + "\n";
      if (!existsSync(path) || (await readFile(path, "utf8")) !== next) {
        await mkdir(capsulesDir(stateHome), { recursive: true });
        await writeFileAtomic(path, next);
      }
      return capsule;
    },
  };
}

export async function readCapsule(
  stateHome: string,
  capsuleId: string,
): Promise<ReplayCapsule | undefined> {
  const path = capsulePath(stateHome, capsuleId);
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8")) as ReplayCapsule;
}

// ---------------------------------------------------------------------------
// source readers
// ---------------------------------------------------------------------------

/** The episode's seed is the state the FIRST build pass started from. Run
 *  ids sort chronologically; pruned envelopes read as absent, never fatal —
 *  the capsule then lists what pruning cost it. */
async function earliestBuildRun(
  stateHome: string,
  record: EpisodeRecord,
): Promise<RunEnvelope | undefined> {
  const buildRunIds = record.turns
    .filter((turn) => turn.pipeline === "build")
    .flatMap((turn) => turn.run_ids)
    .sort();
  for (const runId of buildRunIds) {
    try {
      return await readEnvelope(stateHome, record.app, runId);
    } catch {
      continue; // pruned or torn — try the next build run
    }
  }
  return undefined;
}

async function briefHashOf(
  stateHome: string,
  envelope: RunEnvelope,
): Promise<string | null> {
  try {
    const brief = await readFile(runPaths(stateHome, envelope.app, envelope.run_id).brief);
    return `sha256:${createHash("sha256").update(brief).digest("hex")}`;
  } catch {
    return null;
  }
}

/** `alpha#7` → `github:#7`; non-numeric anchors keep their raw ref. */
function ticketRefOf(record: EpisodeRecord): string {
  const hash = record.source.ref.lastIndexOf("#");
  return hash >= 0 ? `github:${record.source.ref.slice(hash)}` : record.source.ref;
}
