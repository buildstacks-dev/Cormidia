// Traceability: CF-B30 · HB-128 · boundary-map.md B-30; contracts/B-30-jobs.md.

// CF-B30-JRN / CF-B30-DRIFT / CF-B30-NEST (L2) — the journal is the completion
// authority, and the two refusals that protect it.
//
// The expensive failures for a long-running job all live between state
// transitions: a resume that re-executes a paid step, a resume that skips one,
// and a resume against a graph the completed steps were never part of.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseJobConfig } from "../../../src/jobs/config.js";
import { JobJournalError } from "../../../src/jobs/journal.js";
import { JobRunError, runJob } from "../../../src/jobs/runner.js";
import { readTurnRecords } from "../../../src/runtime/telemetry.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { type JobWorkspace, makeJobWorkdir, operatorRole, ScriptedJobRuntime, tickingClock } from "./job-harness.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function scaffold(): Promise<{ state: TempStateHome; work: JobWorkspace }> {
  const state = await makeTempStateHome({ name: "cf-b30-jrn" });
  const work = await makeJobWorkdir();
  cleanups.push(state.cleanup, work.cleanup);
  return { state, work };
}

const THREE_STEP = `
job: chain
steps:
  - id: a
    objective: first
    outputs:
      - path: a.md
        check: non_empty
  - id: b
    dependsOn: [a]
    objective: second
    outputs:
      - path: b.md
        check: non_empty
  - id: c
    dependsOn: [b]
    objective: third
    outputs:
      - path: c.md
        check: non_empty
`;

describe("CF-B30-JRN (L2) the journal is the completion authority", () => {
  it("resumes after a mid-graph failure without re-executing completed steps", async () => {
    const { state, work } = await scaffold();
    const config = parseJobConfig(THREE_STEP, "job.yaml");
    const base = {
      config,
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      now: tickingClock(),
      env: {},
    };

    // Run 1: a succeeds, b fails its check. c must not run.
    const failing = new ScriptedJobRuntime([{ writes: { "a.md": "A" } }, { writes: { "b.md": "  " } }], work.workdir);
    const first = await runJob({ ...base, runtimeFor: () => failing });
    expect(first).toMatchObject({ status: "failed", stoppedAtStepId: "b", completedStepIds: ["a"] });
    expect(failing.recorded).toHaveLength(2);

    // A failed step is terminal for the job: re-running reports the same
    // failure and spends nothing, rather than silently retrying.
    const exhausted = new ScriptedJobRuntime([], work.workdir);
    const second = await runJob({ ...base, runtimeFor: () => exhausted });
    expect(second).toMatchObject({ status: "failed", stoppedAtStepId: "b", providerTurns: 0 });
    expect(exhausted.recorded).toHaveLength(0);
    expect(await readTurnRecords(state.stateHome)).toHaveLength(2);
  });

  it("negative control: completion is read from the journal, never inferred from an output file", async () => {
    const { state, work } = await scaffold();
    const config = parseJobConfig(THREE_STEP, "job.yaml");
    // Every declared output already exists on disk before the job ever runs.
    // A runner that trusted the filesystem would report the job complete
    // without spending a turn; the journal says otherwise.
    for (const path of ["a.md", "b.md", "c.md"]) {
      await writeFile(join(work.workdir, path), "pre-existing", "utf8");
    }
    const runtime = new ScriptedJobRuntime([{}, {}, {}], work.workdir);
    const result = await runJob({
      config,
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      runtimeFor: () => runtime,
      now: tickingClock(),
      env: {},
    });
    expect(result).toMatchObject({ status: "completed", providerTurns: 3 });
    expect(runtime.recorded).toHaveLength(3);
  });

  it("executes steps in dependency order, deterministically", async () => {
    const { state, work } = await scaffold();
    // Declared out of order, with a diamond: the frontier is id-sorted.
    const config = parseJobConfig(
      `
job: diamond
steps:
  - id: zeta
    dependsOn: [alpha]
    objective: left
  - id: omega
    dependsOn: [zeta, beta]
    objective: join
  - id: beta
    dependsOn: [alpha]
    objective: right
  - id: alpha
    objective: root
`,
      "job.yaml",
    );
    const runtime = new ScriptedJobRuntime([{}, {}, {}, {}], work.workdir);
    const result = await runJob({
      config,
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      runtimeFor: () => runtime,
      now: tickingClock(),
      env: {},
    });
    expect(result.status).toBe("completed");
    const journal = await readJournal(state, "diamond");
    const order = journal.events.filter((event) => event.status === "started").map((event) => event.step);
    expect(order).toEqual(["alpha", "beta", "zeta", "omega"]);
  });

  it("recovers an interrupted step once, settling the new turn distinctly, then refuses a second recovery", async () => {
    const { state, work } = await scaffold();
    const config = parseJobConfig("job: crashy\nsteps:\n  - id: only\n    objective: work\n", "job.yaml");
    const base = {
      config,
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      now: tickingClock(),
      env: {},
    };

    // Simulate process death after the `started` event was durably written.
    await runJob({ ...base, runtimeFor: () => new ScriptedJobRuntime([{ throws: "killed" }], work.workdir) }).catch(
      () => undefined,
    );
    await seedStartedOnly(state, "crashy", "only");

    // Recovery runs the step again rather than skipping it, and settles that
    // turn under its OWN identity. Reusing the interrupted attempt's identity
    // would be deduped by recordTurnOnce and undercount a genuinely new paid
    // turn — the dangerous direction for T-5.
    const recovered = await runJob({ ...base, runtimeFor: () => new ScriptedJobRuntime([{}], work.workdir) });
    expect(recovered.status).toBe("completed");
    const rows = await readTurnRecords(state.stateHome);
    expect(rows.map((row) => row.providerTurnId)).toContain("job:crashy:only:2");
    expect(new Set(rows.map((row) => row.providerTurnId)).size).toBe(rows.length);

    // A second interruption of the SAME step: the journal now carries two
    // start events for it, which is the bound.
    await seedStartedOnly(state, "crashy", "only", 3, { keepPriorStarts: true });
    const twice = await runJob({ ...base, runtimeFor: () => new ScriptedJobRuntime([], work.workdir) });
    expect(twice).toMatchObject({ status: "failed", reasonCode: "job_step_interrupted_twice", providerTurns: 0 });
  });
});

describe("CF-B30-DRIFT (L2) a changed config refuses rather than resuming", () => {
  it("negative control: editing a step objective between runs refuses and names the drift", async () => {
    const { state, work } = await scaffold();
    const base = {
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      now: tickingClock(),
      env: {},
    };
    const original = parseJobConfig(THREE_STEP, "job.yaml");
    const first = await runJob({
      ...base,
      config: original,
      runtimeFor: () => new ScriptedJobRuntime([{ writes: { "a.md": "A" } }, { writes: { "b.md": "" } }], work.workdir),
    });
    expect(first.completedStepIds).toEqual(["a"]);

    const edited = parseJobConfig(
      THREE_STEP.replace("objective: third", "objective: third, but different"),
      "job.yaml",
    );
    const exhausted = new ScriptedJobRuntime([], work.workdir);
    await expect(runJob({ ...base, config: edited, runtimeFor: () => exhausted })).rejects.toThrow(JobJournalError);
    await expect(runJob({ ...base, config: edited, runtimeFor: () => exhausted })).rejects.toThrow(
      /config changed since its last run/u,
    );
    // The refusal is total: no step executed and nothing settled beyond run 1.
    expect(exhausted.recorded).toHaveLength(0);
    expect(await readTurnRecords(state.stateHome)).toHaveLength(2);
  });

  it("reformatting the config or editing its description resumes normally", async () => {
    const { state, work } = await scaffold();
    const base = {
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      now: tickingClock(),
      env: {},
    };
    await runJob({
      ...base,
      config: parseJobConfig(THREE_STEP, "job.yaml"),
      runtimeFor: () => new ScriptedJobRuntime([{ writes: { "a.md": "A" } }, { writes: { "b.md": "" } }], work.workdir),
    });
    // Prose-only change: the hash covers the graph, not the description.
    const reworded = parseJobConfig(`${THREE_STEP}description: now with commentary\n`, "job.yaml");
    const result = await runJob({
      ...base,
      config: reworded,
      runtimeFor: () => new ScriptedJobRuntime([], work.workdir),
    });
    expect(result).toMatchObject({ status: "failed", stoppedAtStepId: "b", providerTurns: 0 });
  });

  it("negative control: a corrupt journal refuses instead of being treated as absent", async () => {
    const { state, work } = await scaffold();
    const config = parseJobConfig(THREE_STEP, "job.yaml");
    await writeFile(join(state.stateHome, "jobs", "chain", "journal.json"), "{not json", "utf8").catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(state.stateHome, "jobs", "chain"), { recursive: true });
      await writeFile(join(state.stateHome, "jobs", "chain", "journal.json"), "{not json", "utf8");
    });
    await expect(
      runJob({
        config,
        workdir: work.workdir,
        stateHome: state.stateHome,
        orgDir: state.stateHome,
        role: operatorRole(),
        runtimeFor: () => new ScriptedJobRuntime([], work.workdir),
        now: tickingClock(),
        env: {},
      }),
    ).rejects.toThrow(/not valid JSON/u);
  });
});

describe("CF-B30-NEST (L2) nested invocation is refused", () => {
  const config = () => parseJobConfig("job: nested\nsteps:\n  - id: only\n    objective: x\n", "job.yaml");

  it.each([["CORMIDIA_PARENT_TASK_ID"], ["CORMIDIA_CODEX_GATE_SOCKET"]])(
    "negative control: refuses when %s marks an in-flight Cormidia turn",
    async (marker) => {
      const { state, work } = await scaffold();
      const runtime = new ScriptedJobRuntime([], work.workdir);
      const promise = runJob({
        config: config(),
        workdir: work.workdir,
        stateHome: state.stateHome,
        orgDir: state.stateHome,
        role: operatorRole(),
        runtimeFor: () => runtime,
        now: tickingClock(),
        env: { [marker]: "set-by-the-outer-harness" },
      });
      await expect(promise).rejects.toThrow(JobRunError);
      await expect(promise).rejects.toThrow(/escape the surrounding episode's budget/u);
      // Refused before any journal was written or turn constructed.
      expect(runtime.recorded).toHaveLength(0);
      await expect(readFile(join(state.stateHome, "jobs", "nested", "journal.json"), "utf8")).rejects.toThrow();
    },
  );

  it("runs normally when the marker is present but empty", async () => {
    const { state, work } = await scaffold();
    const result = await runJob({
      config: config(),
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      runtimeFor: () => new ScriptedJobRuntime([{}], work.workdir),
      now: tickingClock(),
      env: { CORMIDIA_PARENT_TASK_ID: "   " },
    });
    expect(result.status).toBe("completed");
  });
});

interface JournalShape {
  events: Array<{ step: string; status: string; attempt: number; at: string }>;
}

async function readJournal(state: TempStateHome, job: string): Promise<JournalShape> {
  return JSON.parse(await readFile(join(state.stateHome, "jobs", job, "journal.json"), "utf8")) as JournalShape;
}

/** Rewrites the journal so `step`'s latest event is `started` — the durable
 * shape a process death leaves behind. */
async function seedStartedOnly(
  state: TempStateHome,
  job: string,
  step: string,
  attempt = 1,
  options: { keepPriorStarts?: boolean } = {},
): Promise<void> {
  const path = join(state.stateHome, "jobs", job, "journal.json");
  const journal = JSON.parse(await readFile(path, "utf8")) as JournalShape & Record<string, unknown>;
  // Drop the step's terminal event so its latest event is `started` again —
  // the durable shape a process death leaves behind. keepPriorStarts retains
  // earlier start events so the retry bound can be exercised.
  const prior = journal.events.filter((event) =>
    event.step !== step ? true : options.keepPriorStarts === true && event.status === "started",
  );
  journal.events = [...prior, { step, status: "started", attempt, at: "2026-08-07T09:30:00.000Z" }];
  await writeFile(path, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
}
