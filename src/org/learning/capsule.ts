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

type Replayability = "replayable" | "partially_replayable" | "non_replayable";

export interface ReplayCapsule {
  capsule_id: string;
  episode_ref: string;
  kind: "build_ticket";
  seed: { repo: string | null; commit: string | null; fixtures: string[] };
  /** `brief` is the verbatim first-build-pass brief (M5 spec delta): replay
   *  recreates the original inputs, and the hash alone cannot reconstruct
   *  them once `runs/` prunes. Capsules live in the state home, so the
   *  verbatim text is L3-adjacent; the fixture conversion sanitizes it. */
  input: { ticket_ref: string; brief_hash: string | null; brief: string | null };
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

interface CapsuleBuilder {
  /** Deterministic assembly from durable sources; writes the capsule under
   *  `learning/capsules/`. Throws for non-build episodes (V1 scope). */
  assemble(episodeId: string): Promise<ReplayCapsule>;
  classify(capsule: Pick<ReplayCapsule, "seed" | "observed_outcome" | "missing">): Replayability;
}

interface CapsuleBuilderOptions {
  stateHome: string;
  /** App name → GitHub slug (`owner/repo`), from the apps registry. */
  repoByApp?: Record<string, string>;
  /** Assembly-time fingerprint id (already stored); null-safe when absent. */
  fingerprintRef?: string;
}

function capsulesDir(stateHome: string): string {
  return join(stateHome, "learning", "capsules");
}

/** The one place the capsule-id scheme lives (`ep_x` → `replay_x`) — the
 *  builder and the `learn fixture` CLI both derive through this, so the
 *  scheme cannot fork across the module boundary. */
export function capsuleIdFor(episodeId: string): string {
  return `replay_${episodeId.replace(/^ep_/, "")}`;
}

function capsulePath(stateHome: string, capsuleId: string): string {
  return join(capsulesDir(stateHome), `${capsuleId}.json`);
}

export function createCapsuleBuilder(options: CapsuleBuilderOptions): CapsuleBuilder {
  const { stateHome } = options;

  const classify: CapsuleBuilder["classify"] = (capsule) => {
    // No repo, no seed commit, or no closed outcome: replay cannot even
    // reconstruct the starting state or grade the result — non-replayable,
    // not merely degraded. Anything else missing (a trusted grader target,
    // a fingerprint) degrades to partial.
    if (capsule.seed.repo === null || capsule.seed.commit === null || capsule.observed_outcome === null) {
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

      const brief = seedRun !== undefined ? await briefOf(stateHome, seedRun) : null;
      if (brief === null) missing.push("brief_hash");

      // Assembly-time provenance is sticky: the FIRST assembly stamps the
      // fingerprint; later re-assemblies (an operator inspecting under a
      // drifted config) must not overwrite it — drift surfaces through a
      // fingerprint diff, never by rewriting what the capsule recorded.
      const existing = await readCapsule(stateHome, capsuleIdFor(episodeId));
      const fingerprintRef = existing?.fingerprint_ref ?? options.fingerprintRef ?? null;
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
        capsule_id: capsuleIdFor(episodeId),
        episode_ref: episodeId,
        kind: "build_ticket",
        seed: { repo, commit, fixtures: [] },
        input: {
          ticket_ref: ticketRefOf(record),
          brief_hash: brief?.hash ?? null,
          brief: brief?.text ?? null,
        },
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

export async function readCapsule(stateHome: string, capsuleId: string): Promise<ReplayCapsule | undefined> {
  const path = capsulePath(stateHome, capsuleId);
  if (!existsSync(path)) return undefined;
  const capsule = JSON.parse(await readFile(path, "utf8")) as ReplayCapsule;
  // Pre-M5 capsules predate input.brief — absent normalizes to null (a
  // re-assembly backfills it while the run's brief.md survives).
  capsule.input.brief ??= null;
  return capsule;
}

// ---------------------------------------------------------------------------
// source readers
// ---------------------------------------------------------------------------

/** The episode's seed is the state the FIRST build pass started from — and
 *  ONLY that pass: a later pass's git_head is mid-episode state, and
 *  publishing it as the seed would be exactly the divergent replay the seed
 *  field exists to prevent. A pruned/torn first envelope therefore reads as
 *  no seed at all (the capsule lists what pruning cost it), never as a
 *  silent substitute. Run ids sort chronologically. */
async function earliestBuildRun(stateHome: string, record: EpisodeRecord): Promise<RunEnvelope | undefined> {
  const firstBuildRunId = record.turns
    .filter((turn) => turn.pipeline === "build")
    .flatMap((turn) => turn.run_ids)
    .sort()[0];
  if (firstBuildRunId === undefined) return undefined;
  try {
    return await readEnvelope(stateHome, record.app, firstBuildRunId);
  } catch {
    return undefined; // pruned or torn — the seed is gone, not approximate
  }
}

async function briefOf(stateHome: string, envelope: RunEnvelope): Promise<{ text: string; hash: string } | null> {
  try {
    const brief = await readFile(runPaths(stateHome, envelope.app, envelope.run_id).brief);
    return {
      text: brief.toString("utf8"),
      hash: `sha256:${createHash("sha256").update(brief).digest("hex")}`,
    };
  } catch {
    return null;
  }
}

/** `alpha#7` → `github:#7`; non-numeric anchors keep their raw ref — a
 *  github:-shaped ref must actually resolve to an issue number. */
function ticketRefOf(record: EpisodeRecord): string {
  const hash = record.source.ref.lastIndexOf("#");
  if (hash >= 0 && /^\d+$/.test(record.source.ref.slice(hash + 1))) {
    return `github:${record.source.ref.slice(hash)}`;
  }
  return record.source.ref;
}
