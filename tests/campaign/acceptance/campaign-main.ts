// campaign/acceptance/campaign-main.ts — the composition, and the process entry.
//
// Everything else in this directory is a piece; this is where they become a
// campaign. The wiring order is B-27 §4's, not a convenience:
//
//   preflight → provision → plan arm → PLAN GATE → build arm → grade → report
//
// and the gate is enforced by `CampaignLifecycle` inside `runAcceptanceCampaign`
// rather than by the order of statements here, so a future edit that reorders
// this file still cannot reach the build arm without a durable resolution.
//
// The report is persisted after every arm, not once at the end: a campaign that
// spent hours and then lost its report to a crash has paid and kept nothing
// (CORMIDIA-INV-ACC-6).

import { join } from "node:path";
import { scenarioArmsFor } from "./campaign-arms.js";
import {
  preflightCampaign,
  readCampaignFile,
  renderDryRun,
  type AcceptanceCampaignFile,
  type PreflightSummary,
} from "./campaign-cli.js";
import { provisionCampaignScenarios } from "./campaign-provisioning.js";
import { reconcileCampaignScenarios } from "./campaign-reconciliation.js";
import { assertReportWellFormed, type AcceptanceCampaignReport } from "./campaign-report.js";
import type { CampaignRuntimeDeps } from "./campaign-runtime.js";
import type { ScenarioProvision } from "./provision.js";
import { persistReport } from "./report-store.js";
import { preflightAcceptanceCampaign, runAcceptanceCampaign } from "./runner.js";
import { SealedKeyRegistry } from "./sealed-key.js";

export type { CampaignRuntimeDeps } from "./campaign-runtime.js";

export interface CampaignRunOutcome {
  summary: PreflightSummary;
  stoppedAtGate: boolean;
  gateShortfalls: string[];
  reportPath: string;
}

async function settleSpend(report: AcceptanceCampaignReport, deps: CampaignRuntimeDeps): Promise<void> {
  report.spend = await deps.spendGuard.snapshot();
  if (report.spend.ceilingExhausted || report.spend.reservationRefusals.length > 0) {
    for (const scenario of report.scenarios) {
      scenario.completeness = "incomplete";
      scenario.completenessReasons = [
        ...new Set([
          ...scenario.completenessReasons,
          ...(report.spend.ceilingExhausted ? ["ceiling_exhausted"] : []),
          ...(report.spend.reservationRefusals.length > 0 ? ["spend_reservation_refused"] : []),
        ]),
      ].sort();
    }
  }
}

function applyReconciliation(
  report: AcceptanceCampaignReport,
  reconciliations: Awaited<ReturnType<typeof reconcileCampaignScenarios>>,
): void {
  for (const scenario of report.scenarios) {
    const result = reconciliations.get(scenario.scenarioId);
    scenario.supervisorReconciliationClosed = result?.closed === true;
    if (result?.closed === true) continue;
    scenario.completeness = "incomplete";
    scenario.completenessReasons = [
      ...new Set([
        ...scenario.completenessReasons,
        ...(result?.violations ?? []).map((violation) => `reconciliation:${violation.code}:${violation.subject}`),
      ]),
    ].sort();
    scenario.axes = scenario.axes.map((axis) => ({
      ...axis,
      score: "ungraded",
      justification: null,
      citations: [],
      ungradedReason: "reconciliation-open",
    }));
  }
  report.gaps = report.scenarios.flatMap((scenario) =>
    scenario.axes
      .filter((axis) => axis.score === "ungraded")
      .map((axis) => ({ scenarioId: scenario.scenarioId, axis: axis.axis, reason: axis.ungradedReason ?? "unknown" })),
  );
}

/** Provision, run, grade, persist. Spends real tokens — the caller must have
 *  already satisfied `assertSpendAuthorization`. */
export async function runCampaign(
  file: AcceptanceCampaignFile,
  deps: CampaignRuntimeDeps,
  installProof: Parameters<typeof runAcceptanceCampaign>[0]["installProof"],
): Promise<CampaignRunOutcome> {
  const summary = await preflightCampaign(file, deps.campaignRoot);
  // B-27 §1 world preflight is deliberately repeated here before the first
  // new-app/bootstrap/seed mutation. The runner repeats it at arm entry so a
  // long provisioning phase cannot make the proof stale silently.
  const admission = await preflightAcceptanceCampaign({
    config: file.campaign,
    repoRoot: deps.repoRoot,
    cormidia: deps.cormidia,
    commitPinAt: deps.commitPinAt,
    ...(installProof === undefined ? {} : { installProof }),
    turnCommands: deps.driver.recorded().map((invocation) => `${invocation.binary} ${invocation.argv.join(" ")}`),
  });
  const registry = new SealedKeyRegistry();
  const keys = file.campaign.scenarios.map((scenario) =>
    registry.seal({
      scenarioId: scenario.id,
      scenarioKind: scenario.kind,
      scenarioMarkdown: deps.scenarioMarkdown[scenario.id] ?? "",
    }),
  );

  await admission.revalidateAdmission();
  const provisions = await provisionCampaignScenarios(file, deps, admission.revalidateAdmission);
  const checkpoint = async (report: AcceptanceCampaignReport, status: "running" | "final"): Promise<void> => {
    await admission.revalidateAdmission();
    await settleSpend(report, deps);
    assertReportWellFormed(report);
    await persistReport({ root: deps.campaignRoot, configSha256: summary.configSha256, report, status });
  };

  const run = await runAcceptanceCampaign({
    config: file.campaign,
    repoRoot: deps.repoRoot,
    cormidia: deps.cormidia,
    commitPinAt: deps.commitPinAt,
    ...(installProof === undefined ? {} : { installProof }),
    scenarioMarkdown: deps.scenarioMarkdown,
    arms: file.campaign.scenarios.map((scenario) =>
      scenarioArmsFor(
        deps,
        file,
        scenario,
        provisions.get(scenario.id) as ScenarioProvision,
        keys,
        admission.revalidateAdmission,
      ),
    ),
    turnCommands: deps.driver.recorded().map((invocation) => `${invocation.binary} ${invocation.argv.join(" ")}`),
    onProgress: async (report) => checkpoint(report, "running"),
  });

  await admission.revalidateAdmission();
  applyReconciliation(
    run.report,
    await reconcileCampaignScenarios({
      config: file.campaign,
      driver: deps.driver,
      stateHome: deps.stateHome,
      provisions,
    }),
  );
  await checkpoint(run.report, "final");

  return {
    summary,
    stoppedAtGate: run.stoppedAtGate,
    gateShortfalls: run.gateShortfalls,
    reportPath: join(deps.campaignRoot, "acceptance", run.report.campaign_id, "report.json"),
  };
}

/** Process entry. `--dry-run` is the honest structural rehearsal: every
 *  config/authorization/identity preflight runs, nothing is provisioned, and
 *  no binary is spawned. `runCampaign` owns the runtime-only world proof. */
export async function main(argv: string[]): Promise<number> {
  const configIndex = argv.indexOf("--config");
  if (configIndex === -1 || argv[configIndex + 1] === undefined) {
    process.stderr.write(
      "usage: pnpm test:acceptance -- --config <absolute-path-to-campaign.yaml> [--dry-run]\n\n" +
        "An L-ACC campaign spends real tokens against real GitHub through the PACKAGED binaries.\n" +
        "It runs only under an exact human authorization naming its output-token and equivalent-USD\n" +
        "ceilings (risk-allocation.md §5a). Start with --dry-run.\n",
    );
    return 1;
  }
  const file = await readCampaignFile(argv[configIndex + 1] as string);
  const rootIndex = argv.indexOf("--campaign-root");
  const campaignRoot = rootIndex === -1 ? process.cwd() : (argv[rootIndex + 1] as string);

  const summary = await preflightCampaign(file, campaignRoot);
  if (argv.includes("--dry-run")) {
    process.stdout.write(`${renderDryRun(summary)}\n`);
    return 0;
  }
  process.stderr.write(
    `preflight passed for ${summary.campaignId}.\n\n` +
      "A live run additionally requires: the packaged install proof, the campaign org and its\n" +
      "disposable scenario repositories, and provider credentials. Wire them through `runCampaign`\n" +
      "from a session that holds them — this entry point deliberately will not invent them.\n",
  );
  return 2;
}
