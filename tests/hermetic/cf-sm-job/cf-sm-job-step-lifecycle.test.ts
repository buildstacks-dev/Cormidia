// CF-SM-JOB-L/I/R/C (L2) — the job step lifecycle
// `pending → running → completed | completed-unverified | failed | interrupted`,
// plus `checkpoint-parked → resumed`.
//
// The machine is not a separate object in the product: it is the journal's
// event sequence, read by `src/jobs/progress.ts`. So the cases here assert the
// journal AS a state machine, against the real runner. The one that matters
// most is `running → completed` while a declared check failed — that transition
// must be unreachable, because a job has no reviewer and the provider's own
// report is exactly what §3 of the jobs contract declines to trust.

import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { parseJobConfig } from "../../../src/jobs/config.js";
import { jobJournalPath, type JobJournal, type JobStepStatus } from "../../../src/jobs/journal.js";
import { runJob } from "../../../src/jobs/runner.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import {
  makeJobWorkdir,
  operatorRole,
  ScriptedJobRuntime,
  tickingClock,
  type JobWorkspace,
  type ScriptedJobTurn,
} from "../cf-b30/job-harness.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function scaffold(name: string): Promise<{ state: TempStateHome; work: JobWorkspace }> {
  const state = await makeTempStateHome({ name });
  const work = await makeJobWorkdir();
  cleanups.push(state.cleanup, work.cleanup);
  return { state, work };
}

async function statuses(state: TempStateHome, job: string): Promise<Array<[string, JobStepStatus]>> {
  const journal = JSON.parse(await readFile(jobJournalPath(state.stateHome, job), "utf8")) as JobJournal;
  return journal.events.map((event) => [event.step, event.status]);
}

const CHECKED = `
job: sm-checked
steps:
  - id: one
    objective: write the report
    outputs:
      - path: report.md
        check: non_empty
`;

const UNCHECKED = `
job: sm-unchecked
steps:
  - id: one
    objective: think about it
`;

const CHECKPOINTED = `
job: sm-checkpoint
steps:
  - id: draft
    objective: draft it
    outputs:
      - path: draft.md
        check: non_empty
  - id: approve
    dependsOn: [draft]
    checkpoint:
      prompt: does the draft look right?
  - id: publish
    objective: finish it
    dependsOn: [approve]
    outputs:
      - path: final.md
        check: non_empty
`;

async function run(
  state: TempStateHome,
  work: JobWorkspace,
  yaml: string,
  turns: ScriptedJobTurn[],
  extra: Partial<Parameters<typeof runJob>[0]> = {},
) {
  const config = parseJobConfig(yaml, "job.yaml");
  return runJob({
    config,
    workdir: work.workdir,
    stateHome: state.stateHome,
    orgDir: state.stateHome,
    role: operatorRole(),
    runtimeFor: () => new ScriptedJobRuntime(turns, work.workdir),
    now: tickingClock(),
    env: {},
    ...extra,
  });
}

describe("CF-SM-JOB-L legal transitions", () => {
  it("pending → running → completed when the declared check passes", async () => {
    const { state, work } = await scaffold("sm-job-ok");
    const outcome = await run(state, work, CHECKED, [{ writes: { "report.md": "content\n" } }]);
    expect(outcome.status).toBe("completed");
    expect(await statuses(state, "sm-checked")).toEqual([
      ["one", "started"],
      ["one", "completed"],
    ]);
  });

  it("pending → running → completed_unverified for a step declaring no outputs", async () => {
    const { state, work } = await scaffold("sm-job-unverified");
    await run(state, work, UNCHECKED, [{}]);
    expect(await statuses(state, "sm-unchecked")).toEqual([
      ["one", "started"],
      ["one", "completed_unverified"],
    ]);
  });

  it("checkpoint-parked → resumed without re-executing any completed step", async () => {
    const { state, work } = await scaffold("sm-job-checkpoint");
    const parked = await run(state, work, CHECKPOINTED, [{ writes: { "draft.md": "draft\n" } }]);
    expect(parked.status).toBe("awaiting_checkpoint");
    expect(await statuses(state, "sm-checkpoint")).toEqual([
      ["draft", "started"],
      ["draft", "completed"],
      ["approve", "awaiting_checkpoint"],
    ]);

    const resumed = await run(state, work, CHECKPOINTED, [{ writes: { "final.md": "final\n" } }], {
      checkpointDecided: async (stepId: string) => stepId === "approve",
    });
    expect(resumed.status).toBe("completed");
    // Exactly one NEW paid turn: `draft` was never re-executed.
    expect(resumed.providerTurns).toBe(1);
    expect((await statuses(state, "sm-checkpoint")).filter(([step]) => step === "draft")).toHaveLength(2);
  });
});

describe("CF-SM-JOB-I illegal transitions", () => {
  it("negative control: running → completed is unreachable when the declared check failed", async () => {
    const { state, work } = await scaffold("sm-job-lying");
    // The provider LIES: it reports `completed` and writes an empty file.
    const outcome = await run(state, work, CHECKED, [{ status: "completed", writes: { "report.md": "" } }]);
    expect(outcome.status).toBe("failed");
    const events = await statuses(state, "sm-checked");
    expect(events.map(([, status]) => status)).toEqual(["started", "failed"]);
    expect(events.some(([, status]) => status === "completed")).toBe(false);
  });

  it("negative control: a completed step is never re-executed on a second run", async () => {
    const { state, work } = await scaffold("sm-job-rerun");
    await run(state, work, CHECKED, [{ writes: { "report.md": "content\n" } }]);
    const second = await run(state, work, CHECKED, []);
    expect(second.status).toBe("completed");
    expect(second.providerTurns).toBe(0);
    expect(await statuses(state, "sm-checked")).toHaveLength(2);
  });

  it("negative control: a failed step stops the job and nothing downstream runs", async () => {
    const { state, work } = await scaffold("sm-job-stop");
    const yaml = `
job: sm-stop
steps:
  - id: first
    objective: write it
    outputs:
      - path: first.md
        check: non_empty
  - id: second
    objective: never runs
    dependsOn: [first]
`;
    const outcome = await run(state, work, yaml, [{ writes: { "first.md": "" } }]);
    expect(outcome.status).toBe("failed");
    expect((await statuses(state, "sm-stop")).some(([step]) => step === "second")).toBe(false);
  });
});

describe("CF-SM-JOB-R/C replay and crash points", () => {
  it("an interrupted step is an INTERMEDIATE, never terminal truth — retried once", async () => {
    const { state, work } = await scaffold("sm-job-interrupted");
    const config = parseJobConfig(CHECKED, "job.yaml");
    // Seed a journal whose latest event is `started`: the process died between
    // the durable start and the terminal event.
    await run(state, work, CHECKED, [{ throws: "provider died" }]).catch(() => undefined);
    const path = jobJournalPath(state.stateHome, config.job);
    const journal = JSON.parse(await readFile(path, "utf8")) as JobJournal;
    journal.events = journal.events.filter((event) => event.status === "started");
    await writeFile(path, JSON.stringify(journal, null, 2), "utf8");
    expect(await statuses(state, "sm-checked")).toEqual([["one", "started"]]);

    const recovered = await run(state, work, CHECKED, [{ writes: { "report.md": "recovered\n" } }]);
    expect(recovered.status).toBe("completed");
    const events = await statuses(state, "sm-checked");
    expect(events.filter(([, status]) => status === "started")).toHaveLength(2);
    expect(events.at(-1)).toEqual(["one", "completed"]);
  });

  it("negative control: a step interrupted twice stops with evidence rather than a third turn", async () => {
    const { state, work } = await scaffold("sm-job-twice");
    const config = parseJobConfig(CHECKED, "job.yaml");
    const path = jobJournalPath(state.stateHome, config.job);
    await run(state, work, CHECKED, [{ throws: "died once" }]).catch(() => undefined);
    const journal = JSON.parse(await readFile(path, "utf8")) as JobJournal;
    journal.events = [
      { step: "one", status: "started", attempt: 1, at: "2026-08-07T09:00:01.000Z" },
      { step: "one", status: "started", attempt: 2, at: "2026-08-07T09:00:02.000Z" },
    ];
    await writeFile(path, JSON.stringify(journal, null, 2), "utf8");

    const outcome = await run(state, work, CHECKED, []);
    expect(outcome.status).toBe("failed");
    expect(outcome.reasonCode).toBe("job_step_interrupted_twice");
  });

  it("replaying a completed job is idempotent — same terminal state, zero new turns", async () => {
    const { state, work } = await scaffold("sm-job-replay");
    await run(state, work, CHECKPOINTED, [{ writes: { "draft.md": "d\n" } }]);
    await run(state, work, CHECKPOINTED, [{ writes: { "final.md": "f\n" } }], {
      checkpointDecided: async (stepId: string) => stepId === "approve",
    });
    const before = await statuses(state, "sm-checkpoint");
    const replay = await run(state, work, CHECKPOINTED, []);
    expect(replay.status).toBe("completed");
    expect(replay.providerTurns).toBe(0);
    expect(await statuses(state, "sm-checkpoint")).toEqual(before);
  });
});
