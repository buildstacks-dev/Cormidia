// CF-J07-A — budget/status/report/observe agree on the durable PAUSED truth.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdBudget } from "../../../src/cli/budget.js";
import { cmdStatus } from "../../../src/cli/status.js";
import { enforceBudgetOverlay } from "../../../src/org/budget.js";
import { indexLocalSources } from "../../../src/observe/file-index.js";
import { projectObserveSnapshot } from "../../../src/observe/project.js";
import { buildReport } from "../../../src/report/project.js";
import { renderReportTerminal } from "../../../src/report/render-terminal.js";
import type { TempOrgHome } from "../../fixtures/org-home.js";
import { APP, makeBudgetOrg, seedSpend, type BudgetOrg } from "./support.js";

async function capture(run: () => Promise<number>): Promise<{ code: number; stdout: string }> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    lines.push(parts.map(String).join(" "));
  });
  try {
    return { code: await run(), stdout: lines.join("\n") };
  } finally {
    spy.mockRestore();
  }
}

function homeFlags(org: TempOrgHome): string[] {
  return ["--org-home", org.orgHome, "--state-home", org.stateHome];
}

describe("CF-J07-A — all operator surfaces render the same budget pause", () => {
  let rig: BudgetOrg | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    await rig?.org.cleanup();
    rig = undefined;
  });

  it("projects exceeded + PAUSED in budget, status, report, and observe from one ledger/overlay", async () => {
    rig = await makeBudgetOrg();
    const now = new Date();
    await seedSpend(rig.org.stateHome, { costUsd: 120, at: now.toISOString(), providerTurnId: "ptid-j07-a" });
    await enforceBudgetOverlay(rig.org.stateHome, rig.appsFile, now);

    const budgetJson = await capture(() => cmdBudget([...homeFlags(rig!.org), "--json"]));
    const budget = JSON.parse(budgetJson.stdout) as { apps: Array<{ app: string; status: string; paused: boolean }> };
    expect(budget.apps.find((row) => row.app === APP)).toMatchObject({ status: "exceeded", paused: true });
    const budgetText = await capture(() => cmdBudget(homeFlags(rig!.org)));
    expect(budgetText.stdout).toMatch(/EXCEEDED PAUSED/);

    const statusJson = await capture(() => cmdStatus([...homeFlags(rig!.org), "--json"]));
    const status = JSON.parse(statusJson.stdout) as { budget: Array<{ app: string; status: string; paused: boolean }> };
    expect(status.budget.find((row) => row.app === APP)).toMatchObject({ status: "exceeded", paused: true });
    const statusText = await capture(() => cmdStatus(homeFlags(rig!.org)));
    expect(statusText.stdout).toMatch(/BUDGET ADMISSION[\s\S]*EXCEEDED[\s\S]*admission=PAUSED/);

    const report = await buildReport({
      orgName: rig.appsFile.org.name,
      stateHome: rig.org.stateHome,
      appsFile: rig.appsFile,
      query: { app: APP, period: "all" },
      now,
    });
    expect(report.apps[0]).toMatchObject({ budget_status: "exceeded", budget_paused: true });
    expect(renderReportTerminal(report)).toMatch(/exceeded, PAUSED/);

    const local = await indexLocalSources({
      orgName: rig.appsFile.org.name,
      stateHome: rig.org.stateHome,
      appsFile: rig.appsFile,
      filters: {},
      now,
    });
    const observe = projectObserveSnapshot({ ...local, cursor: "0", github: [] });
    expect(observe.apps[0]).toMatchObject({ budget_status: "exceeded", budget_paused: true });
    expect(observe.apps[0]?.cost.known_cost_usd).toBe(120);
  });

  it("negative control: a forged active surface disagrees with the durable pause detector", async () => {
    rig = await makeBudgetOrg();
    const now = new Date();
    await seedSpend(rig.org.stateHome, { costUsd: 120, at: now.toISOString() });
    await enforceBudgetOverlay(rig.org.stateHome, rig.appsFile, now);
    const durable = projectObserveSnapshot({
      ...(await indexLocalSources({ orgName: rig.appsFile.org.name, stateHome: rig.org.stateHome, appsFile: rig.appsFile, filters: {}, now })),
      cursor: "0",
      github: [],
    }).apps[0]!;
    const assertPause = (paused: boolean): void => {
      if (paused !== durable.budget_paused) throw new Error("cross-surface pause drift");
    };
    expect(() => assertPause(false)).toThrow(/pause drift/);
  });
});
