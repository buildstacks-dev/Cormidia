// Traceability: CF-REVIEW-PROVIDER · HB-133 · case-catalog.md §10.2 leg (e); docs/jobs/design.md §3 (non-inherited guarantees, M18); contracts/journey-acceptance.md J-23.

// CF-REVIEW-PROVIDER (L2) — scope guard, jobs leg: no Reviewer is imposed on
// cormidia-job (M18).
//
// docs/jobs/design.md §3 names independent review as a guarantee jobs do NOT
// inherit: deterministic declared-output checks are the substitute for a
// reviewer (src/jobs/checks.ts). HB-133 pins Builder/Reviewer provider-family
// disjointness onto the autonomous code-delivery route; this leg proves the
// pin's scope — a job graph runs to completion with a single role, a single
// provider family, and no reviewer anywhere, and the disjointness refusal
// never fires on it. If the pin ever leaked into runJob (an imposed Reviewer
// or a review-identity refusal), this walk would stop.

import { describe, expect, it } from "vitest";
import { afterEach } from "vitest";
import { parseJobConfig } from "../../../src/jobs/config.js";
import { runJob } from "../../../src/jobs/runner.js";
import { makeTempStateHome } from "../../fixtures/state-home.js";
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

const SINGLE_FAMILY_JOB = `
job: review-provider-scope
steps:
  - id: report
    objective: write the summary report
    outputs:
      - path: outputs/report.md
        check: non_empty
`;

describe("CF-REVIEW-PROVIDER — jobs are outside the review-identity pin (L2, HB-133 leg e)", () => {
  it("a single-role, single-family job completes with exactly its declared steps and no imposed Reviewer", async () => {
    const state = await makeTempStateHome({ name: "cf-review-provider-jobs" });
    const work: JobWorkspace = await makeJobWorkdir();
    cleanups.push(state.cleanup, work.cleanup);

    // The operator role is claude/anthropic — the SAME family HB-133's seeded
    // collapse uses. A review-identity check reaching this route would refuse;
    // the non-inherited-guarantee list says it must not exist here at all.
    const runtime = new ScriptedJobRuntime([{ writes: { "outputs/report.md": "summary" } }], work.workdir);
    const result = await runJob({
      config: parseJobConfig(SINGLE_FAMILY_JOB, "job.yaml"),
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      runtimeFor: () => runtime,
      now: tickingClock(),
      env: {},
    });

    expect(result.status).toBe("completed");
    expect(result.providerTurns).toBe(1);
    // Exactly the declared graph ran: one step, no injected review step.
    expect(result.completedStepIds).toEqual(["report"]);
    expect(result.stepStates.map((step) => step.step)).toEqual(["report"]);
    expect(runtime.recorded).toHaveLength(1);
    expect(runtime.recorded[0]?.harness).toBe("claude");
  });
});
