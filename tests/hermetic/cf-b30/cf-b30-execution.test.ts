// Traceability: CF-B30 · HB-128 · boundary-map.md B-30; contracts/B-30-jobs.md.

// CF-B30-CHK / CF-B30-HND / CF-B30-SET (L2) — job step execution composition.
//
// These are the three properties that make a job trustworthy without a reviewer:
// declared checks decide completion rather than the provider's self-report,
// dependency outputs actually reach the downstream brief, and every paid turn
// settles exactly one ledger row.

import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseJobConfig } from "../../../src/jobs/config.js";
import { runJob } from "../../../src/jobs/runner.js";
import { readTurnRecords, recordTurnOnce } from "../../../src/runtime/telemetry.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import {
  type JobWorkspace,
  makeJobWorkdir,
  operatorRole,
  ScriptedJobRuntime,
  type ScriptedJobTurn,
  tickingClock,
} from "./job-harness.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function scaffold(): Promise<{ state: TempStateHome; work: JobWorkspace }> {
  const state = await makeTempStateHome({ name: "cf-b30" });
  const work = await makeJobWorkdir();
  cleanups.push(state.cleanup, work.cleanup);
  return { state, work };
}

interface RunOptions {
  yaml: string;
  turns: ScriptedJobTurn[];
  state: TempStateHome;
  work: JobWorkspace;
}

async function run(options: RunOptions): ReturnType<typeof runJob> {
  const config = parseJobConfig(options.yaml, "job.yaml");
  const runtime = new ScriptedJobRuntime(options.turns, options.work.workdir);
  return runJob({
    config,
    workdir: options.work.workdir,
    stateHome: options.state.stateHome,
    orgDir: options.state.stateHome,
    role: operatorRole(),
    runtimeFor: () => runtime,
    now: tickingClock(),
    env: {},
  });
}

const TWO_STEP = `
job: handoff
steps:
  - id: frame
    objective: produce the framing
    outputs:
      - path: outputs/framing.md
        check: non_empty
  - id: synthesize
    dependsOn: [frame]
    objective: synthesize from the framing
    outputs:
      - path: outputs/brief.md
        check: non_empty
`;

describe("CF-B30-CHK (L2) declared checks decide completion", () => {
  it("completes a step whose declared output passes its check", async () => {
    const { state, work } = await scaffold();
    const result = await run({
      yaml: `
job: single
steps:
  - id: only
    objective: write the file
    outputs:
      - path: out.md
        check: non_empty
`,
      turns: [{ writes: { "out.md": "real content" } }],
      state,
      work,
    });
    expect(result).toMatchObject({ status: "completed", completedStepIds: ["only"], providerTurns: 1 });
  });

  it("negative control: a provider reporting completed FAILS the step when its output is empty", async () => {
    const { state, work } = await scaffold();
    const result = await run({
      yaml: `
job: lying
steps:
  - id: only
    objective: write the file
    outputs:
      - path: out.md
        check: non_empty
`,
      // The lying fake: it claims success and writes only whitespace.
      turns: [{ writes: { "out.md": "   \n\t\n" }, summary: "all done, looks great" }],
      state,
      work,
    });
    expect(result.status).toBe("failed");
    expect(result.reasonCode).toBe("job_output_check_failed");
    expect(result.summary).toContain("only whitespace");
    expect(result.completedStepIds).toEqual([]);
  });

  it("negative control: a provider reporting completed FAILS the step when its output is absent", async () => {
    const { state, work } = await scaffold();
    const result = await run({
      yaml: `
job: missing
steps:
  - id: only
    objective: write the file
    outputs:
      - path: out.md
`,
      turns: [{ summary: "wrote it, promise" }],
      state,
      work,
    });
    expect(result.reasonCode).toBe("job_output_check_failed");
    expect(result.summary).toContain("does not exist");
  });

  it("negative control: malformed JSON fails a json check", async () => {
    const { state, work } = await scaffold();
    const result = await run({
      yaml: `
job: badjson
steps:
  - id: only
    objective: emit json
    outputs:
      - path: out.json
        check: json
`,
      turns: [{ writes: { "out.json": "Here is your JSON: {oops" } }],
      state,
      work,
    });
    expect(result.reasonCode).toBe("job_output_check_failed");
    expect(result.summary).toContain("not valid JSON");
  });

  it("records completed_unverified — not bare completed — for a step declaring no outputs", async () => {
    const { state, work } = await scaffold();
    const result = await run({
      yaml: "job: unverified\nsteps:\n  - id: only\n    objective: think out loud\n",
      turns: [{}],
      state,
      work,
    });
    expect(result.status).toBe("completed");
    const journal = JSON.parse(await readFile(join(state.stateHome, "jobs", "unverified", "journal.json"), "utf8")) as {
      events: Array<{ status: string }>;
    };
    expect(journal.events.map((event) => event.status)).toEqual(["started", "completed_unverified"]);
  });

  it("stops the job at a failed step and never runs downstream steps", async () => {
    const { state, work } = await scaffold();
    const result = await run({
      yaml: TWO_STEP,
      // Only one turn is scripted; a second call would throw over-called, which
      // is exactly the assertion — the downstream step must not execute.
      turns: [{ writes: { "outputs/framing.md": "" } }],
      state,
      work,
    });
    expect(result).toMatchObject({ status: "failed", stoppedAtStepId: "frame", providerTurns: 1 });
  });
});

describe("CF-B30-HND (L2) dependency outputs reach the downstream brief", () => {
  it("splices a dependency's declared output verbatim into the next step's prompt", async () => {
    const { state, work } = await scaffold();
    const framing = "## Framing\n\nQ1: what changed?\nQ2: what did it cost?";
    const runtime = new ScriptedJobRuntime(
      [{ writes: { "outputs/framing.md": framing } }, { writes: { "outputs/brief.md": "the brief" } }],
      work.workdir,
    );
    const result = await runJob({
      config: parseJobConfig(TWO_STEP, "job.yaml"),
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      runtimeFor: () => runtime,
      now: tickingClock(),
      env: {},
    });

    expect(result.status).toBe("completed");
    const [first, second] = runtime.recorded;
    // The root step sees no prior output; the dependent step sees it verbatim.
    expect(first?.task).toContain("this step is a root of the job graph");
    expect(second?.task).toContain(framing);
    expect(second?.task).toContain("### frame — `outputs/framing.md`");
    expect(second?.task).toContain("synthesize from the framing");
  });

  it("tells the step which files it must write and how each is checked", async () => {
    const { state, work } = await scaffold();
    const runtime = new ScriptedJobRuntime([{ writes: { "out.json": "{}" } }], work.workdir);
    await runJob({
      config: parseJobConfig(
        `
job: declared
steps:
  - id: only
    objective: emit
    outputs:
      - path: out.json
        check: json
`,
        "job.yaml",
      ),
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      runtimeFor: () => runtime,
      now: tickingClock(),
      env: {},
    });
    expect(runtime.recorded[0]?.task).toContain("`out.json` — check: must exist and parse as JSON");
  });

  it("routes each step to its own declared harness, and defaults to the role tuple", async () => {
    const { state, work } = await scaffold();
    const byHarness = new Map<string, ScriptedJobRuntime>();
    const config = parseJobConfig(
      `
job: mixed
steps:
  - id: a
    objective: first
    assignment: { harness: codex, model: gpt-5.6-sol, effort: high }
  - id: b
    dependsOn: [a]
    objective: second
`,
      "job.yaml",
    );
    const result = await runJob({
      config,
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      runtimeFor: (harness) => {
        const existing = byHarness.get(harness);
        if (existing !== undefined) return existing;
        const created = new ScriptedJobRuntime([{}], work.workdir, harness);
        byHarness.set(harness, created);
        return created;
      },
      now: tickingClock(),
      env: {},
    });
    expect(result.status).toBe("completed");
    expect(byHarness.get("codex")?.recorded[0]).toMatchObject({ model: "gpt-5.6-sol", effort: "high" });
    // Step b declared nothing, so it runs the operator role's configured tuple.
    expect(byHarness.get("claude")?.recorded[0]).toMatchObject({ model: "claude-opus-4-8", effort: "high" });
  });

  it("refuses rather than prompting the model with a hole where an input should be", async () => {
    const { state, work } = await scaffold();
    // A checkpoint between the producer and the consumer lets the test park the
    // job, delete the completed step's artifact, and resume — which is the real
    // failure mode B-23 lists: a completed step's declared output removed after
    // completion, while the journal still says it succeeded.
    const config = parseJobConfig(
      `
job: hole
steps:
  - id: frame
    objective: produce the framing
    outputs:
      - path: outputs/framing.md
        check: non_empty
  - id: pause
    dependsOn: [frame]
    checkpoint:
      prompt: review before synthesis
  - id: synthesize
    dependsOn: [frame, pause]
    objective: synthesize from the framing
`,
      "job.yaml",
    );
    const runtime = new ScriptedJobRuntime([{ writes: { "outputs/framing.md": "content" } }, {}], work.workdir);
    const base = {
      config,
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      runtimeFor: () => runtime,
      now: tickingClock(),
      env: {},
    };

    const parked = await runJob(base);
    expect(parked).toMatchObject({ status: "awaiting_checkpoint", completedStepIds: ["frame"], providerTurns: 1 });

    await rm(join(work.workdir, "outputs", "framing.md"));
    await expect(runJob({ ...base, checkpointDecided: async () => true })).rejects.toThrow(/cannot be read/u);
  });
});

describe("CF-B30-SET (L2) exactly-once settlement", () => {
  it("settles one ledger row per provider turn, attributed to the job", async () => {
    const { state, work } = await scaffold();
    await run({
      yaml: TWO_STEP,
      turns: [
        { writes: { "outputs/framing.md": "a" }, costUsd: 0.5 },
        { writes: { "outputs/brief.md": "b" }, costUsd: 1.25 },
      ],
      state,
      work,
    });
    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.providerTurnId)).toEqual(["job:handoff:frame:1", "job:handoff:synthesize:1"]);
    expect(rows.every((row) => row.role === "operator")).toBe(true);
    // Unscoped job: spend is attributed to the adhoc slot, not to an app.
    expect(rows.every((row) => row.app === "adhoc")).toBe(true);
    expect(rows.reduce((total, row) => total + row.costUsd, 0)).toBeCloseTo(1.75);
  });

  it("settles a FAILED turn too — a failed step's spend is never invisible", async () => {
    const { state, work } = await scaffold();
    const result = await run({
      yaml: "job: burned\nsteps:\n  - id: only\n    objective: try\n",
      turns: [{ status: "failed", summary: "provider gave up", costUsd: 0.75, errorCode: "error_provider" }],
      state,
      work,
    });
    expect(result.status).toBe("failed");
    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "failed", costUsd: 0.75 });
  });

  it("settles a step whose declared check fails — the turn was still paid for", async () => {
    const { state, work } = await scaffold();
    await run({
      yaml: "job: unchecked\nsteps:\n  - id: only\n    objective: x\n    outputs:\n      - path: out.md\n",
      turns: [{ costUsd: 0.4 }],
      state,
      work,
    });
    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.costUsd).toBe(0.4);
  });

  it("negative control: a SEEDED double-settle under the same identity is deduped, not double-charged", async () => {
    const { state, work } = await scaffold();
    await run({
      yaml: "job: doubled\nsteps:\n  - id: only\n    objective: x\n",
      turns: [{ costUsd: 0.6 }],
      state,
      work,
    });
    const settled = await readTurnRecords(state.stateHome);
    expect(settled).toHaveLength(1);
    const original = settled[0];
    if (original === undefined) throw new Error("the first settlement did not happen");

    // Replay the EXACT ledger row the step already settled — the shape a retry
    // loop or a crash-resume produces if it forgets the turn was already paid
    // for. `recordTurnOnce` must return false and leave the ledger alone;
    // otherwise the org's budget view silently OVERSTATES spend and a ceiling
    // trips early on money nobody spent.
    const accepted = await recordTurnOnce(state.stateHome, original);
    expect(accepted).toBe(false);
    const after = await readTurnRecords(state.stateHome);
    expect(after).toHaveLength(1);
    expect(after.reduce((total, row) => total + row.costUsd, 0)).toBeCloseTo(0.6);
  });

  it("negative control: resuming a completed job re-settles nothing", async () => {
    const { state, work } = await scaffold();
    const config = parseJobConfig(TWO_STEP, "job.yaml");
    const base = {
      config,
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      now: tickingClock(),
      env: {},
    };
    // One instance for the whole run: runtimeFor is consulted per step, so a
    // fresh instance per call would restart the script.
    const first = new ScriptedJobRuntime(
      [{ writes: { "outputs/framing.md": "a" } }, { writes: { "outputs/brief.md": "b" } }],
      work.workdir,
    );
    const firstResult = await runJob({ ...base, runtimeFor: () => first });
    expect(firstResult.status).toBe("completed");
    expect(await readTurnRecords(state.stateHome)).toHaveLength(2);

    // Re-run with a runtime scripted for ZERO turns: any provider call throws.
    const exhausted = new ScriptedJobRuntime([], work.workdir);
    const second = await runJob({ ...base, runtimeFor: () => exhausted });
    expect(second).toMatchObject({ status: "completed", providerTurns: 0 });
    expect(await readTurnRecords(state.stateHome)).toHaveLength(2);
  });
});
