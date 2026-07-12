// Learning-loop Preflight conformance (issue #28; milestones → Preflight).
// Pins the two campaign-landed contracts the learning loop's evidence capture
// and M2 episode projector depend on:
//   1. Exactly-once settlement — the executor's own per-pass settle COMPOSED
//      with a later `operon budget --reconcile` sweep must never produce a
//      second ledger row for the same (app, runId). Learning metrics would
//      otherwise double-count exactly the builder/reviewer activity the loop
//      most needs to learn from.
//   2. Live-vs-stalled distinguishability — the executor heartbeat stamps
//      `last_seen_at` on the envelope WHILE the provider turn runs, and the
//      status reader exposes it, so a killed pass can be closed truthfully
//      instead of looking identical to a live one.
// The unit pieces (recordTurnOnce dedup, reconcile idempotency, envelope
// heartbeat patch) have their own tests; these pin the composed contracts.
// Uses FakeRuntime/FakeClock and temp org homes; fake timers cover ONLY
// setInterval/clearInterval so real fs I/O and vi.waitFor keep working.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executePipeline, type ExecutePipelineOptions } from "../../src/loop/pipeline.js";
import { getPipeline, loadPipelines } from "../../src/loop/pipelines.js";
import { readStatusRows } from "../../src/runtime/runlog/status.js";
import { reconcileLedger } from "../../src/org/budget.js";
import { FakeRuntime, type ScriptedTurn } from "../../src/runtime/testing/fakeRuntime.js";
import type { RoleConfig, Runtime, TurnResult } from "../../src/runtime/types.js";
import { FakeClock } from "../fixtures/fakeClock.js";
import { makeOrgHome } from "../fixtures/orgHome.js";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/pipelines", import.meta.url));
const PROMPTS_DIR = `${FIXTURE_DIR}/prompts`;

function role(name: string): RoleConfig {
  return {
    name,
    runtime: "claude",
    model: "base-model",
    effort: "medium",
    delegation: { allow: [] },
    triggers: [],
    outputs: [],
    maxTurnBudgetUsd: 5,
  };
}

const ROLES: Record<string, RoleConfig> = {
  planner: role("planner"),
  builder: role("builder"),
  reviewer: role("reviewer"),
};

function turnResult(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime: "claude", id: `session-${summary}` },
    usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.01, subagentTurns: 0, wallClockMs: 100 },
    escalations: [],
  };
}

function makeHarness(input: {
  turns?: ScriptedTurn[];
  runtime?: Runtime;
  tier?: "quick" | "standard";
  clock: FakeClock;
}) {
  const home = makeOrgHome({ runs: { apps: ["civic"] } });
  const fake = new FakeRuntime(input.turns ?? []);
  const options: ExecutePipelineOptions = {
    pipeline: undefined as unknown as ExecutePipelineOptions["pipeline"], // set by caller
    selection: { tier: input.tier ?? "standard" },
    roles: ROLES,
    runtimeFor: () => input.runtime ?? fake,
    briefFor: (pass) => `brief for ${pass.id}`,
    promptsDir: PROMPTS_DIR,
    context: { taste: ["org taste"], memoryExcerpts: [] },
    workdir: "/tmp/workdir",
    hooks: { gate: () => ({ allow: true }) },
    runlog: { root: home.root, app: "civic", ticket: "#42", traceId: "turn-1" },
    clock: () => input.clock.now(),
    telemetry: { orgDir: home.root, trigger: "manual" },
  };
  return { home, options, cleanup: () => home.cleanup() };
}

async function loadBuild() {
  const file = await loadPipelines(`${FIXTURE_DIR}/pipelines.yaml`, {
    roleNames: Object.keys(ROLES),
    promptsDir: PROMPTS_DIR,
  });
  return getPipeline(file, "build");
}

describe("learning-loop preflight conformance (issue #28)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a loop pass settles exactly once: executor settle + reconcile sweep never double-count", async () => {
    const clock = new FakeClock(new Date(Date.UTC(2026, 6, 5, 9, 30, 15)));
    const h = makeHarness({
      turns: [{ result: turnResult("contract out") }, { result: turnResult("implement out") }],
      clock,
    });
    h.options.pipeline = await loadBuild();
    try {
      const run = await executePipeline(h.options);
      expect(run.passes).toHaveLength(2);

      const ledgerPath = `${h.home.root}/telemetry/2026-07-05.jsonl`;
      const readRows = () =>
        readFileSync(ledgerPath, "utf8")
          .trimEnd()
          .split("\n")
          .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(readRows()).toHaveLength(2);

      // The reconcile sweep over the same state settles NOTHING new: every
      // executor-settled envelope lands in the alreadySettled bucket.
      const sweep = await reconcileLedger(h.home.root, {}, clock.now());
      expect(sweep).toMatchObject({ scanned: 2, settled: 0, alreadySettled: 2, corrupt: 0 });
      expect(readRows()).toHaveLength(2);

      // And the sweep stays idempotent on repeat.
      const second = await reconcileLedger(h.home.root, {}, clock.now());
      expect(second.settled).toBe(0);
      expect(readRows()).toHaveLength(2);
    } finally {
      h.cleanup();
    }
  });

  it("a hung pass is distinguishable from a live one: the heartbeat stamps last_seen_at mid-turn", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const clock = new FakeClock(new Date(Date.UTC(2026, 6, 5, 9, 30, 15)));
    let releaseTurn!: () => void;
    const hang = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    const hangingRuntime: Runtime = {
      kind: "claude",
      async runTurn(_request, hooks) {
        // This is a post-initialize session hang, not an adapter-start stall.
        // A provider event clears the short start deadline without stamping
        // last_seen_at; the heartbeat remains the evidence under test.
        hooks.onEvent?.({ type: "text", detail: "provider initialized" });
        await hang;
        return turnResult("finally done");
      },
    };
    const h = makeHarness({ runtime: hangingRuntime, tier: "quick", clock }); // quick skips contract → 1 pass
    h.options.pipeline = await loadBuild();
    try {
      const running = executePipeline(h.options);

      // The pass is live: envelope exists, status running, no heartbeat yet.
      const before = await vi.waitFor(async () => {
        const rows = await readStatusRows(h.home.root, { app: "civic" });
        expect(rows).toHaveLength(1);
        expect(rows[0]!.status).toBe("running");
        return rows[0]!;
      });
      expect(before.lastSeenAt).toBeUndefined();

      // 31s pass: the executor heartbeat fires and stamps the envelope with
      // the CURRENT clock — a reader can now tell live from stalled.
      clock.advance(31_000);
      vi.advanceTimersByTime(31_000);
      const stamped = await vi.waitFor(async () => {
        const rows = await readStatusRows(h.home.root, { app: "civic" });
        expect(rows[0]!.lastSeenAt).toBeDefined();
        return rows[0]!;
      });
      expect(stamped.status).toBe("running");
      expect(new Date(stamped.lastSeenAt!).getTime()).toBeGreaterThan(
        new Date(stamped.startedAt).getTime(),
      );

      // The turn returns; the pass finalizes terminal, not stuck running.
      releaseTurn();
      const run = await running;
      expect(run.passes).toHaveLength(1);
      const rows = await readStatusRows(h.home.root, { app: "civic" });
      expect(rows[0]!.status).toBe("completed");
    } finally {
      h.cleanup();
    }
  });
});
