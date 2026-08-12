// Traceability: CF-J22-R · HB-145; CF-J22-A · HB-145; CF-C-OPJOB · HB-145 · contracts/journey-acceptance.md J-22; contracts/B-30-job-config-journal.md; docs/jobs/design.md §§4–8.

import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { JobConfigError, parseJobConfig } from "../../../src/jobs/config.js";
import { jobJournalPath } from "../../../src/jobs/journal.js";
import { parseJobJournal } from "../../../src/jobs/journal-parse.js";
import { runJob } from "../../../src/jobs/runner.js";
import { formatJobStepStates } from "../../../src/jobs/status.js";
import { indexLocalSources } from "../../../src/observe/file-index.js";
import { projectObserveSnapshot } from "../../../src/observe/project.js";
import type { Runtime, ToolAction, TurnHooks, TurnRequest, TurnResult } from "../../../src/runtime/types.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import {
  makeJobWorkdir,
  operatorRole,
  ScriptedJobRuntime,
  tickingClock,
  type JobWorkspace,
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

function refusal(yaml: string): JobConfigError {
  let constructed = 0;
  try {
    const config = parseJobConfig(yaml, "job.yaml");
    // This is the construction seam a malformed config must never reach.
    const runtimeFor = (): ScriptedJobRuntime => {
      constructed += 1;
      return new ScriptedJobRuntime([], process.cwd());
    };
    runtimeFor();
    throw new Error(`invalid config loaded as ${config.job}`);
  } catch (error) {
    expect(constructed).toBe(0);
    if (error instanceof JobConfigError) return error;
    throw error;
  }
}

describe("CF-J22-R (L1) complete pre-runtime refusal enumeration", () => {
  it.each([
    {
      case: "dependency cycle",
      code: "job_dependency_cycle",
      yaml: "job: cycle\nsteps:\n  - id: a\n    dependsOn: [b]\n    objective: a\n  - id: b\n    dependsOn: [a]\n    objective: b\n",
    },
    {
      case: "unknown step id",
      code: "job_dependency_unknown",
      yaml: "job: unknown\nsteps:\n  - id: a\n    dependsOn: [missing]\n    objective: a\n",
    },
    {
      case: "duplicate step id",
      code: "job_step_id_duplicate",
      yaml: "job: duplicate\nsteps:\n  - id: same\n    objective: a\n  - id: same\n    objective: b\n",
    },
    {
      case: "both objective and checkpoint",
      code: "job_step_kind_ambiguous",
      yaml: "job: both\nsteps:\n  - id: a\n    objective: a\n    checkpoint: { prompt: pause }\n",
    },
    {
      case: "neither objective nor checkpoint",
      code: "job_step_kind_ambiguous",
      yaml: "job: neither\nsteps:\n  - id: a\n    dependsOn: []\n",
    },
    {
      case: "role-widening assignment tuple",
      code: "job_assignment_invalid",
      yaml: "job: widening\nsteps:\n  - id: a\n    objective: a\n    assignment:\n      harness: claude\n      model: claude-opus-4-8\n      effort: high\n      delegation: { allow: [builder] }\n",
    },
  ])("refuses $case before constructing a runtime", ({ code, yaml }) => {
    expect(refusal(yaml).code).toBe(code);
  });

  it("refuses an unserved assignment tuple before constructing a runtime", async () => {
    const { state, work } = await scaffold("hb-145-unapproved-assignment");
    let constructions = 0;
    const promise = runJob({
      config: parseJobConfig(
        "job: unapproved\nsteps:\n  - id: a\n    objective: a\n    assignment: { harness: muse, model: seeded/unserved, effort: high }\n",
        "job.yaml",
      ),
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      runtimeFor: () => {
        constructions += 1;
        return new ScriptedJobRuntime([], work.workdir);
      },
      modelCatalogReader: async (runtime) => ({
        runtime,
        available: true,
        source: "seeded approved roster",
        models: ["muse-spark-1.2"],
      }),
      env: {},
    });

    await expect(promise).rejects.toMatchObject({ code: "job_assignment_invalid" });
    expect(constructions).toBe(0);
    await expect(readFile(jobJournalPath(state.stateHome, "unapproved"), "utf8")).rejects.toThrow();
  });

  it("a failed declared check is durable and no downstream runtime turn occurs", async () => {
    const { state, work } = await scaffold("hb-145-check-stop");
    const runtime = new ScriptedJobRuntime([{ writes: { "first.md": "   " } }], work.workdir);
    const result = await runJob({
      config: parseJobConfig(
        "job: check-stop\nsteps:\n  - id: first\n    objective: first\n    outputs:\n      - path: first.md\n        check: non_empty\n  - id: second\n    dependsOn: [first]\n    objective: second\n",
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

    expect(result).toMatchObject({ status: "failed", stoppedAtStepId: "first", providerTurns: 1 });
    expect(runtime.recorded).toHaveLength(1);
    const path = jobJournalPath(state.stateHome, "check-stop");
    const journal = parseJobJournal(JSON.parse(await readFile(path, "utf8")), path);
    expect(journal.events.at(-1)).toMatchObject({ step: "first", status: "failed" });
    expect(journal.events.some((event) => event.step === "second")).toBe(false);
  });
});

const CRITICAL_ACTION: ToolAction = {
  tool: "bash",
  input: { command: "npm publish --access public" },
  description: "publish a package",
};

class GatedOperationRuntime implements Runtime {
  readonly kind = "claude" as const;
  effects = 0;

  async runTurn(_request: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    const decision = hooks.gate(CRITICAL_ACTION);
    if (decision.allow) this.effects += 1;
    return {
      status: decision.allow ? "completed" : "blocked_on_gate",
      summary: decision.allow ? "published" : decision.reason,
      artifacts: [],
      session: { runtime: "claude", id: "hb-145-gate" },
      usage: {
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0,
        subagentTurns: 0,
        wallClockMs: 1,
        quality: "complete",
      },
      escalations: decision.allow || !decision.escalate ? [] : [{ action: CRITICAL_ACTION, reason: decision.reason }],
    };
  }
}

async function runGatedOperation(
  state: TempStateHome,
  work: JobWorkspace,
  runtime: GatedOperationRuntime,
  gate?: TurnHooks["gate"],
) {
  return runJob({
    config: parseJobConfig("job: gated\nsteps:\n  - id: publish\n    objective: publish\n", "job.yaml"),
    workdir: work.workdir,
    stateHome: state.stateHome,
    orgDir: state.stateHome,
    role: operatorRole(),
    runtimeFor: () => runtime,
    now: tickingClock(),
    env: {},
    ...(gate === undefined ? {} : { gate }),
  });
}

describe("CF-C-OPJOB (L2) critical-operation gate contract", () => {
  it("raises a job-owned approval item and does not perform the critical operation", async () => {
    const { state, work } = await scaffold("hb-145-gated-op");
    const runtime = new GatedOperationRuntime();
    const result = await runGatedOperation(state, work, runtime);

    expect(result).toMatchObject({ status: "failed", stoppedAtStepId: "publish", providerTurns: 1 });
    expect(runtime.effects).toBe(0);
    const pending = await new ApprovalStore(state.stateHome).listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ app: "adhoc", role: "operator", rule: "package-publish" });
    expect(pending[0]?.turnId).toMatch(/^job:gated:publish:1$/u);
  });

  it("negative control: a seeded allow-all gate bypass performs the forbidden effect", async () => {
    const { state, work } = await scaffold("hb-145-gate-bypass");
    const runtime = new GatedOperationRuntime();
    const detector = async (): Promise<void> => {
      const result = await runGatedOperation(state, work, runtime, () => ({ allow: true }));
      if (result.status === "completed" || runtime.effects !== 0) {
        throw new Error("seeded gate bypass turned the critical-operation detector red");
      }
    };

    await expect(detector()).rejects.toThrow(/detector red/u);
    expect(await new ApprovalStore(state.stateHome).listPending()).toEqual([]);
  });
});

describe("CF-J22-A (L2) CLI and observe agree on durable job state", () => {
  it("renders checked completion and completed (unverified) distinctly on both surfaces", async () => {
    const { state, work } = await scaffold("hb-145-surface-agreement");
    const result = await runJob({
      config: parseJobConfig(
        "job: surfaces\nsteps:\n  - id: checked\n    objective: checked\n    outputs:\n      - path: checked.md\n        check: non_empty\n  - id: unchecked\n    dependsOn: [checked]\n    objective: unchecked\n",
        "job.yaml",
      ),
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      runtimeFor: () => new ScriptedJobRuntime([{ writes: { "checked.md": "checked" } }, {}], work.workdir),
      now: tickingClock(),
      env: {},
    });
    const cliLines = formatJobStepStates(result.stepStates);

    const local = await indexLocalSources({
      orgName: "hb-145",
      stateHome: state.stateHome,
      appsFile: {
        org: { name: "hb-145", maxConcurrentTurns: 1 },
        defaults: { budgetUsdMonth: 10, objectiveBudgetUsd: 10 },
        apps: [],
      },
      filters: {},
      now: new Date("2026-08-07T10:00:00.000Z"),
    });
    const observe = projectObserveSnapshot({ ...local, cursor: "0", github: [] });
    const observed = observe.jobs[0];

    expect(cliLines).toEqual(["checked: completed", "unchecked: completed (unverified)"]);
    expect(observed?.steps).toEqual(result.stepStates);
    expect(formatJobStepStates(observed?.steps ?? [])).toEqual(cliLines);
    expect(observed?.steps.map((step) => step.display_status)).not.toEqual(["completed", "completed"]);
  });
});
