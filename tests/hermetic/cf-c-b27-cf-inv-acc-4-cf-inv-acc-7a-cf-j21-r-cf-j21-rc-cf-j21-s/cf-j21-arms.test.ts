// Traceability: CF-J21-S · HB-130 · contracts/journey-acceptance.md J-21 success criterion.

// CF-J21-S (L2) — the plan, build and job arms.
//
// Real spawned binaries, real git, real ledger reads. The arm's contract is
// narrow: run the product and collect what it produced. The property worth
// guarding hardest is that the org's SELF-REPORT never lands in the evidence
// set — an arm that mixed them would hand O-1 the PR body claiming O-1 passed.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runBuildArm, runJobArm, runPlanArm, type ArmDeps } from "../../campaign/acceptance/arms.js";
import { createCliDriver } from "../../campaign/acceptance/cli-driver.js";
import { SELF_REPORT_KINDS } from "../../campaign/acceptance/grader-envelope.js";
import {
  makeCormidiaBinaryDouble,
  type ScriptedCliResponse,
} from "../../fixtures/acceptance/cormidia-binary-double.js";
import { makeTempGitRepo } from "../../fixtures/git-repo.js";
import { makeTempStateHome } from "../../fixtures/state-home.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function harness(
  responses: ScriptedCliResponse[],
): Promise<{ deps: ArmDeps; double: Awaited<ReturnType<typeof makeCormidiaBinaryDouble>> }> {
  const double = await makeCormidiaBinaryDouble(responses);
  const scenario = await makeTempGitRepo({ seedFiles: [{ path: "README.md", contents: "# scenario\n" }] });
  const state = await makeTempStateHome({ name: "arms" });
  cleanups.push(double.cleanup, scenario.cleanup, state.cleanup);
  // Plain temp dir — the driver only needs a realpath-able checkout root.
  const checkout = await mkdtemp(join(tmpdir(), "cormidia-checkout-"));
  cleanups.push(async () => {
    await rm(checkout, { recursive: true, force: true });
  });

  const baselineCommit = scenario.git(["rev-parse", "HEAD"]);
  // The org then does work, as a real run would.
  await scenario.commitFile("src/invoice.ts", "export const invoiceTotal = () => 0;\n", "add invoiceTotal");

  const driver = await createCliDriver({
    cormidiaPath: double.cormidiaPath,
    cormidiaJobPath: double.cormidiaJobPath,
    checkoutRoot: checkout,
  });
  return {
    double,
    deps: {
      driver,
      scenarioId: "S-ACC-1",
      appName: "acc-1-timetracker",
      worktree: scenario.dir,
      baselineCommit,
      stateHome: state.stateHome,
      ramble: "I want to log time against a client and get an invoice out of it.",
      revalidateAdmission: async () => {},
    },
  };
}

describe("CF-J21-S the plan arm", () => {
  it("runs `plan --auto` content-bound to the ramble, and collects B-29 evidence", async () => {
    const { deps, double } = await harness([{ whenArgvIncludes: "plan", stdout: '{"tickets":4}\n' }]);
    const sourcePath = join(deps.worktree, "brief.md");
    await writeFile(sourcePath, deps.ramble, "utf8");

    const output = await runPlanArm({ ...deps, rambleSourcePath: sourcePath });
    expect(output.arm).toBe("plan");
    expect(output.exitCode).toBe(0);

    const argv = (await double.invocations())[0]?.argv ?? [];
    expect(argv.slice(0, 3)).toEqual(["plan", "acc-1-timetracker", "--auto"]);
    expect(argv).toContain("--source");
    expect(argv).toContain(sourcePath);

    const refs = output.evidence.map((item) => item.ref).sort();
    expect(refs).toEqual(["commit-log", "diff", "ledger", "ramble-brief", "repo-state"]);
    expect(output.evidence.find((item) => item.ref === "ramble-brief")?.contents).toBe(deps.ramble);
  });

  it("the diff is measured from the provisioning baseline, so the seed is not the org's work", async () => {
    const { deps } = await harness([{ whenArgvIncludes: "plan", stdout: "{}\n" }]);
    const sourcePath = join(deps.worktree, "brief.md");
    await writeFile(sourcePath, deps.ramble, "utf8");
    const output = await runPlanArm({ ...deps, rambleSourcePath: sourcePath });

    const diff = output.evidence.find((item) => item.ref === "diff")?.contents ?? "";
    expect(diff).toContain("invoiceTotal");
    expect(diff).not.toContain("# scenario");
  });
});

describe("CF-J21-S the build arm is bounded", () => {
  it("loops until the ready frontier drains", async () => {
    const { deps, double } = await harness([{ whenArgvIncludes: "loop", stdout: "claimed 1 ticket\n" }]);
    const output = await runBuildArm({ ...deps, maxPasses: 3 });
    expect(output.invocations).toHaveLength(3);
    expect((await double.invocations()).every((entry) => entry.argv.includes("--once"))).toBe(true);
  });

  it("stops early when the loop reports nothing left to claim", async () => {
    const { deps } = await harness([{ whenArgvIncludes: "loop", stdout: "no ready tickets\n" }]);
    const output = await runBuildArm({ ...deps, maxPasses: 5 });
    expect(output.invocations).toHaveLength(1);
  });

  it("negative control: a failing pass stops the arm rather than burning the envelope", async () => {
    const { deps } = await harness([{ whenArgvIncludes: "loop", exitCode: 2, stderr: "budget paused\n" }]);
    const output = await runBuildArm({ ...deps, maxPasses: 10 });
    expect(output.invocations).toHaveLength(1);
    expect(output.exitCode).toBe(2);
  });

  it("negative control: repository drift after one build pass prevents the next effect", async () => {
    const { deps, double } = await harness([{ whenArgvIncludes: "loop", stdout: "claimed 1 ticket\n" }]);
    let checks = 0;
    await expect(
      runBuildArm({
        ...deps,
        maxPasses: 3,
        revalidateAdmission: async () => {
          checks += 1;
          if (checks > 1) throw new Error("campaign refused: repository changed after admission");
        },
      }),
    ).rejects.toThrow(/repository changed after admission/);
    expect(await double.invocations()).toHaveLength(1);
  });

  it("respects maxPasses as a hard bound — an unbounded loop escapes the campaign envelope", async () => {
    const { deps } = await harness([{ whenArgvIncludes: "loop", stdout: "claimed 1 ticket\n" }]);
    expect((await runBuildArm({ ...deps, maxPasses: 1 })).invocations).toHaveLength(1);
  });
});

describe("CF-J21-S the job arm and the self-report boundary", () => {
  it("drives cormidia-job with the scenario workdir", async () => {
    const { deps, double } = await harness([{ whenArgvIncludes: "run", stdout: "job completed\n" }]);
    const jobConfigPath = join(deps.worktree, "job.yaml");
    await writeFile(
      jobConfigPath,
      "job: acceptance-job\nsteps:\n  - id: research\n    objective: research\n    outputs: []\n",
      "utf8",
    );
    const output = await runJobArm({ ...deps, jobConfigPath });
    expect(output.arm).toBe("job");
    const entry = (await double.invocations())[0];
    expect(entry?.binary).toBe("cormidia-job");
    expect(entry?.argv).toContain("--workdir");
    expect(entry?.argv).toContain(deps.worktree);
  });

  it("negative control: the org's self-report is NEVER in the evidence set", async () => {
    const { deps } = await harness([{ whenArgvIncludes: "loop", stdout: "PR #4 opened: everything works\n" }]);
    const output = await runBuildArm({ ...deps, maxPasses: 1 });

    for (const item of output.evidence) {
      expect(SELF_REPORT_KINDS).not.toContain(item.kind);
    }
    // It is collected — O-5 needs it as its SUBJECT — just kept apart.
    expect(output.selfReport.map((item) => item.kind)).toEqual(["step-narration"]);
    expect(output.selfReport[0]?.contents).toContain("everything works");
    expect(output.evidence.map((item) => item.contents).join("\n")).not.toContain("everything works");
  });
});
