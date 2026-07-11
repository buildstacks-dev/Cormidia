// Tests the ReplayCapsule builder in src/org/learning/capsule.ts: assembly
// from a projected build episode (seed commit from the first build pass's
// git_head, brief hash from the verbatim brief.md), replayability
// classification with an explicit missing list, the V1 build-only boundary,
// and honest degradation when sources were never captured or were pruned.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  capsulePath,
  createCapsuleBuilder,
  readCapsule,
} from "../../src/org/learning/capsule.js";
import { createEpisodeProjector } from "../../src/org/learning/episode.js";
import type { RunEnvelope } from "../../src/runtime/runlog/envelope.js";
import { runPaths } from "../../src/runtime/runlog/paths.js";
import { FakeClock } from "../fixtures/fakeClock.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";

const EPISODE = "ep_alpha_ticket_0007";
const SEED = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

function envelope(runId: string, overrides: Partial<RunEnvelope> = {}): RunEnvelope {
  return {
    schema_version: 1,
    run_id: runId,
    trace_id: "t-build-1",
    app: "alpha",
    ticket: "#7",
    pipeline: "build",
    pass: "implement",
    role: "builder",
    status: "completed",
    started_at: "2026-07-11T10:00:00.000Z",
    finished_at: "2026-07-11T10:05:00.000Z",
    refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
    ...overrides,
  };
}

function mergedTicketHome(seedOnFirstRun = true): OrgHomeFixture {
  const home = makeOrgHome({
    runs: {
      records: {
        alpha: {
          "20260711-100000-build-contract": {
            envelope: envelope("20260711-100000-build-contract", {
              pass: "contract",
              ...(seedOnFirstRun ? { git_head: SEED } : {}),
            }),
            events: [],
          },
          "20260711-100600-build-implement": {
            envelope: envelope("20260711-100600-build-implement", {
              trace_id: "t-build-2",
              started_at: "2026-07-11T10:06:00.000Z",
              finished_at: "2026-07-11T10:11:00.000Z",
            }),
            events: [],
          },
        },
      },
    },
  });
  writeFileSync(
    runPaths(home.root, "alpha", "20260711-100000-build-contract").brief,
    "# Brief\nDeliver ticket #7\n",
  );
  mkdirSync(join(home.root, "tickets", "alpha"), { recursive: true });
  writeFileSync(
    join(home.root, "tickets", "alpha", "7.json"),
    JSON.stringify({ claims: 1, outcomes: ["claim 1: ended merged (PR #12)"] }, null, 2) + "\n",
  );
  return home;
}

async function projectHome(root: string): Promise<void> {
  const clock = new FakeClock("2026-07-11T11:00:00.000Z");
  await createEpisodeProjector({ stateHome: root, clock: () => clock.now() }).project();
}

describe("createCapsuleBuilder", () => {
  it("assembles a build capsule that classifies itself and lists what is missing", async () => {
    const home = mergedTicketHome();
    try {
      await projectHome(home.root);
      const builder = createCapsuleBuilder({
        stateHome: home.root,
        repoByApp: { alpha: "owner/alpha" },
        fingerprintRef: "sys_0123456789ab",
      });
      const capsule = await builder.assemble(EPISODE);

      expect(capsule).toMatchObject({
        capsule_id: "replay_alpha_ticket_0007",
        episode_ref: EPISODE,
        kind: "build_ticket",
        seed: { repo: "owner/alpha", commit: SEED, fixtures: [] },
        input: { ticket_ref: "github:#7" },
        fingerprint_ref: "sys_0123456789ab",
        artifacts: ["pull-request-12"],
        observed_outcome: { merged: true, review_cycles: 0 },
        expected_outcome: null,
        grader: null,
        sanitized: false,
        validated_by: null,
      });
      expect(capsule.input.brief_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      // Complete capture, but no validated grader target yet — the one gap
      // every M2 capsule has by construction.
      expect(capsule.missing).toEqual(["trusted_expected_outcome"]);
      expect(capsule.replayability).toBe("partially_replayable");

      expect(await readCapsule(home.root, capsule.capsule_id)).toEqual(capsule);
      expect(capsulePath(home.root, capsule.capsule_id)).toContain("learning/capsules/");
    } finally {
      home.cleanup();
    }
  });

  it("degrades honestly when the seed was never captured (pre-M2b runs)", async () => {
    const home = mergedTicketHome(false);
    try {
      await projectHome(home.root);
      const builder = createCapsuleBuilder({
        stateHome: home.root,
        repoByApp: { alpha: "owner/alpha" },
      });
      const capsule = await builder.assemble(EPISODE);
      expect(capsule.seed.commit).toBeNull();
      expect(capsule.missing).toEqual([
        "seed_commit",
        "fingerprint",
        "trusted_expected_outcome",
      ]);
      // Without the seed commit replay cannot reconstruct the starting
      // state at all — that is non-replayable, not merely degraded.
      expect(capsule.replayability).toBe("non_replayable");
    } finally {
      home.cleanup();
    }
  });

  it("never substitutes a later pass's seed when the first build run was pruned", async () => {
    const home = mergedTicketHome();
    try {
      // Give the LATER build pass a git_head too, then prune the first run:
      // its mid-episode commit must not become the seed.
      const laterPath = runPaths(home.root, "alpha", "20260711-100600-build-implement").envelope;
      const later = JSON.parse(readFileSync(laterPath, "utf8")) as RunEnvelope;
      writeFileSync(
        laterPath,
        JSON.stringify({ ...later, git_head: "f".repeat(40) }, null, 2) + "\n",
      );
      await projectHome(home.root);
      rmSync(join(home.root, "runs", "alpha", "20260711-100000-build-contract"), {
        recursive: true,
      });

      const capsule = await createCapsuleBuilder({
        stateHome: home.root,
        repoByApp: { alpha: "owner/alpha" },
        fingerprintRef: "sys_0123456789ab",
      }).assemble(EPISODE);
      expect(capsule.seed.commit).toBeNull();
      expect(capsule.missing).toContain("seed_commit");
      expect(capsule.replayability).toBe("non_replayable");
    } finally {
      home.cleanup();
    }
  });

  it("classifies non_replayable when the repo is unknown or the episode is still open", async () => {
    const home = mergedTicketHome();
    try {
      // Reopen: replace the merge evidence with an in-flight claim.
      writeFileSync(
        join(home.root, "tickets", "alpha", "7.json"),
        JSON.stringify({ claims: 1, outcomes: ["claim 1: ended ready"] }, null, 2) + "\n",
      );
      await projectHome(home.root);
      const builder = createCapsuleBuilder({ stateHome: home.root });
      const capsule = await builder.assemble(EPISODE);
      expect(capsule.observed_outcome).toBeNull();
      expect(capsule.missing).toContain("seed_repo");
      expect(capsule.missing).toContain("closed_outcome");
      expect(capsule.replayability).toBe("non_replayable");
    } finally {
      home.cleanup();
    }
  });

  it("keeps the first assembly's fingerprint — provenance survives a drifted re-assembly", async () => {
    const home = mergedTicketHome();
    try {
      await projectHome(home.root);
      const first = await createCapsuleBuilder({
        stateHome: home.root,
        repoByApp: { alpha: "owner/alpha" },
        fingerprintRef: "sys_original0001",
      }).assemble(EPISODE);
      expect(first.fingerprint_ref).toBe("sys_original0001");

      const reassembled = await createCapsuleBuilder({
        stateHome: home.root,
        repoByApp: { alpha: "owner/alpha" },
        fingerprintRef: "sys_drifted00002",
      }).assemble(EPISODE);
      expect(reassembled.fingerprint_ref).toBe("sys_original0001");
      expect((await readCapsule(home.root, first.capsule_id))?.fingerprint_ref).toBe(
        "sys_original0001",
      );
    } finally {
      home.cleanup();
    }
  });

  it("refuses non-build episodes — V1 scope is build only", async () => {
    const noTicket = envelope("20260711-050000-support-triage", {
      trace_id: "turn-alpha-9",
      pipeline: "support",
      pass: "triage",
      role: "support",
    });
    delete (noTicket as Partial<RunEnvelope>).ticket;
    const home = makeOrgHome({
      runs: {
        records: { alpha: { "20260711-050000-support-triage": { envelope: noTicket, events: [] } } },
      },
    });
    try {
      await projectHome(home.root);
      const builder = createCapsuleBuilder({ stateHome: home.root });
      await expect(builder.assemble(`ep_alpha_turn_turn-alpha-9`)).rejects.toThrow(
        /build episodes only/,
      );
    } finally {
      home.cleanup();
    }
  });
});
