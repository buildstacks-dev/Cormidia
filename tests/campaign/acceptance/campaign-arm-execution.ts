import type { CampaignLifecycle } from "./campaign-lifecycle.js";
import type { AxisReportRow } from "./campaign-report.js";
import { CampaignSpendRefusal } from "./campaign-spend.js";
import type { CampaignRepositoryRevalidator } from "../repository-revalidation.js";

export interface ScenarioArms {
  scenarioId: string;
  kind: "app" | "job";
  planArm?: () => Promise<AxisReportRow[]>;
  buildArm(): Promise<AxisReportRow[]>;
}

export async function executePlanArms(
  arms: readonly ScenarioArms[],
  lifecycles: Map<string, CampaignLifecycle>,
  rows: Map<string, AxisReportRow[]>,
  checkpoint: () => Promise<void>,
  revalidateAdmission: CampaignRepositoryRevalidator,
): Promise<boolean> {
  let spendStopped = false;
  for (const arm of arms.filter((candidate) => candidate.kind === "app")) {
    if (arm.planArm === undefined) throw new Error(`campaign refused: app scenario ${arm.scenarioId} has no plan arm`);
    try {
      await revalidateAdmission();
      rows.set(arm.scenarioId, await arm.planArm());
    } catch (error) {
      if (!(error instanceof CampaignSpendRefusal)) throw error;
      rows.set(arm.scenarioId, []);
      spendStopped = true;
    }
    lifecycles.get(arm.scenarioId)?.transition("plan-gated");
    await checkpoint();
    if (spendStopped) break;
  }
  for (const arm of arms.filter((candidate) => candidate.kind === "app")) {
    const lifecycle = lifecycles.get(arm.scenarioId);
    if (lifecycle?.state() === "plan-arm") lifecycle.transition("plan-gated");
  }
  return spendStopped;
}

export async function executeBuildArms(
  arms: readonly ScenarioArms[],
  lifecycles: Map<string, CampaignLifecycle>,
  rows: Map<string, AxisReportRow[]>,
  checkpoint: () => Promise<void>,
  revalidateAdmission: CampaignRepositoryRevalidator,
): Promise<boolean> {
  let spendStopped = false;
  for (const arm of arms) {
    const lifecycle = lifecycles.get(arm.scenarioId);
    lifecycle?.transition("build-arm");
    lifecycle?.noteBuildArmSpend();
    try {
      await revalidateAdmission();
      rows.set(arm.scenarioId, await arm.buildArm());
      lifecycle?.transition("graded");
    } catch (error) {
      if (!(error instanceof CampaignSpendRefusal)) throw error;
      lifecycle?.transition("incomplete");
      spendStopped = true;
    }
    await checkpoint();
    if (spendStopped) break;
  }
  for (const lifecycle of lifecycles.values()) {
    if (lifecycle.state() === "plan-gated") lifecycle.transition("incomplete");
  }
  return spendStopped;
}
