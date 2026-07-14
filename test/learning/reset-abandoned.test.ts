import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startRun } from "../../src/runtime/runlog/envelope.js";
import { previewCaptureEvents } from "../../src/org/learning/capture.js";
import {
  createEpisodeProjector,
  episodePath,
  markAppEpisodesResetAbandoned,
  readEpisodeRecord,
  type EpisodeRecord,
} from "../../src/org/learning/episode.js";
import { readLearningEvents } from "../../src/org/learning/events.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";

describe("F-SET-04 reset and unprojected-run truth", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("closes every affected open episode as reset_abandoned and remains closed after reprojection", async () => {
    home = makeOrgHome();
    const record: EpisodeRecord = {
      schema_version: 1,
      episode_id: "ticket:app:#7",
      kind: "build_ticket",
      app: "app",
      source: { kind: "ticket", ref: "#7" },
      stage: "onboarding",
      risk_tier: null,
      opened: "2026-07-14T00:00:00.000Z",
      status: "open",
      fingerprint_ref: null,
      bundle_lineage: "stable",
      turns: [{ turn_id: "t1", role: "builder", pipeline: "build", pass: "implement", run_ids: ["20260714-000000-build-implement"], status: "completed" }],
      gates: [{ gate: "tests", status: "pass", run_id: "20260714-000000-build-implement" }],
      approvals: [],
      artifacts: ["commit:abc"],
      side_effects: [],
      late_outcomes: [],
      human_observations: [],
    };
    await mkdir(join(home.root, "learning", "episodes"), { recursive: true });
    await writeFile(episodePath(home.root, record.episode_id), `${JSON.stringify(record, null, 2)}\n`, "utf8");

    expect(await markAppEpisodesResetAbandoned(home.root, "app", new Date("2026-07-14T01:00:00Z"))).toEqual([record.episode_id]);
    expect(await markAppEpisodesResetAbandoned(home.root, "app", new Date("2026-07-14T01:00:01Z"))).toEqual([]);
    expect(await readEpisodeRecord(home.root, record.episode_id)).toMatchObject({
      status: "closed",
      outcome: { completed: false, release_disposition: "reset_abandoned", terminal_reason: "reset_abandoned" },
    });
    expect((await readLearningEvents(home.root)).filter((event) => event.event_id.startsWith("evt_reset_abandoned_"))).toHaveLength(1);

    await createEpisodeProjector({ stateHome: home.root, clock: () => new Date("2026-07-15T00:00:00Z") }).project();
    expect((await readEpisodeRecord(home.root, record.episode_id)).outcome?.terminal_reason).toBe("reset_abandoned");
  });

  it("names every pending run id and its exact recovery reason", async () => {
    home = makeOrgHome();
    const running = "20260714-000000-build-implement";
    const torn = "20260714-000001-build-contract";
    await startRun(home.root, {
      runId: running,
      traceId: "trace-running",
      app: "app",
      pipeline: "build",
      pass: "implement",
      role: "builder",
      runtime: "codex",
      model: "fixture",
      effort: "low",
      workdir: home.root,
    }, new Date("2026-07-14T00:00:00Z"));
    await mkdir(join(home.root, "runs", "app", torn), { recursive: true });
    const result = await previewCaptureEvents({ stateHome: home.root });
    expect(result.runsPending).toBe(2);
    expect(result.pendingRuns).toEqual([
      { app: "app", runId: running, reason: "stale_finalization" },
      { app: "app", runId: torn, reason: "unreadable_envelope" },
    ]);
  });
});
// Phase 4 terminal-finalization contract: H-CAP-03.
