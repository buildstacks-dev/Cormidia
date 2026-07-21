import { join, resolve } from "node:path";
import {
  countUnmeasured,
  enforceBudgetOverlay,
  reconcileLedger,
  rollupLearningSpend,
} from "../org/budget.js";
import { loadApps } from "../org/apps.js";
import { defaultLearningPolicy, loadLearningPolicy } from "../org/learning/policy.js";
import { loadRoles } from "../org/roles.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdBudget(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "budget");
  let appsPath: string | undefined;
  let reconcile = false;
  let json = false;
  for (let i = 0; i < common.rest.length; i++) {
    const arg = common.rest[i]!;
    if (arg === "--apps") appsPath = needValue(common.rest, ++i, "--apps");
    else if (arg === "--reconcile") reconcile = true;
    else if (arg === "--json") json = true;
    else throw new Error(`budget: unknown argument "${arg}"`);
  }

  const homes = await resolveOperonHomes(common);
  const effectiveAppsPath = appsPath ? resolve(appsPath) : join(homes.orgHome, "apps.yaml");
  const apps = await loadApps(effectiveAppsPath);
  const now = new Date();
  let reconciliation: Awaited<ReturnType<typeof reconcileLedger>> | null = null;

  if (reconcile) {
    // Repair stale provider receipts, settle terminal provider steps, and
    // back-fill legacy envelopes. ProviderTurnId/app identity keeps this
    // idempotent; legacy rows fall back to runId/app.
    const rolesFile = await loadRoles(join(homes.orgHome, "roles.yaml"));
    const runtimeByRole = Object.fromEntries(
      rolesFile.roles.map((role) => [role.name, role.runtime]),
    );
    reconciliation = await reconcileLedger(homes.stateHome, runtimeByRole, now);
  }

  const rows = await enforceBudgetOverlay(homes.stateHome, apps, now);
  // Learning overlay (learning-loop M5, spec §13): replay/eval spend settles
  // into the same ledger; this is the rollup against the learning caps.
  const learning = await rollupLearningSpend(homes.stateHome, now);
  let learningPolicyWarning: string | null = null;
  let learningReport: {
    monthUsd: number;
    monthlyCapUsd: number;
    monthStatus: "OK" | "WARNING" | "EXCEEDED";
    experimentsThisMonth: number;
    maxExperimentsPerMonth: number;
    byCandidate: Array<{ candidate: string; spentUsd: number; capUsd: number; status: "OK" | "WARNING" | "EXCEEDED" }>;
  } | null = null;
  if (learning.monthUsd > 0 || learning.byCandidate.size > 0) {
    // A corrupt learning policy must not take down the org's core budget
    // view — degrade to the spec §13 defaults with a loud note.
    const policy = await loadLearningPolicy(homes.orgHome).catch((error: Error) => {
      learningPolicyWarning =
        `learning policy unreadable (${error.message}) — learning caps shown are the spec defaults`;
      return defaultLearningPolicy();
    });
    const cap = policy.learning_budget.monthly_usd;
    const monthStatus =
      learning.monthUsd >= cap ? "EXCEEDED" : learning.monthUsd >= cap * 0.8 ? "WARNING" : "OK";
    const byCandidate = [...learning.byCandidate.entries()].sort().map(([candidate, spent]) => {
      const candidateCap = policy.learning_budget.per_candidate_replay_usd;
      const status = spent >= candidateCap ? "EXCEEDED" : spent >= candidateCap * 0.8 ? "WARNING" : "OK";
      return { candidate, spentUsd: spent, capUsd: candidateCap, status } as const;
    });
    learningReport = {
      monthUsd: learning.monthUsd,
      monthlyCapUsd: cap,
      monthStatus,
      experimentsThisMonth: learning.experimentsThisMonth,
      maxExperimentsPerMonth: policy.learning_budget.max_experiments_per_month,
      byCandidate,
    };
  }

  const month = now.toISOString().slice(0, 7);
  const unmeasured = await countUnmeasured(homes.stateHome, month);
  const report = {
    schema_version: 1,
    kind: "budget",
    stateHome: homes.stateHome,
    appsPath: effectiveAppsPath,
    month,
    reconciliation,
    apps: rows,
    learning: learningReport,
    learningPolicyWarning,
    unmeasured: [...unmeasured.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([app, sessions]) => ({ app, sessions })),
    notes: [
      "subscription-backed provider spend is an Operon-computed equivalent-cost estimate, not a provider invoice",
    ],
  } as const;
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  if (report.reconciliation !== null) {
    const outcome = report.reconciliation;
    console.log(
      `reconcile: ${outcome.scanned} envelopes scanned — ${outcome.settled} settled ` +
        `(recovered $${outcome.recoveredUsd.toFixed(2)}), ${outcome.alreadySettled} already in the ledger, ` +
        `${outcome.noUsage} with no recorded usage` +
        (outcome.inFlight > 0 ? `, ${outcome.inFlight} in flight (left for their own settle)` : "") +
        (outcome.corrupt > 0 ? `, ${outcome.corrupt} unreadable` : ""),
    );
  }
  console.log("APP                  SPENT      BUDGET     STATUS");
  for (const row of report.apps) {
    console.log(
      `${row.app.padEnd(20)} ${money(row.spentUsd).padStart(10)} ${money(row.budgetUsd).padStart(10)} ${row.status.toUpperCase()}`,
    );
  }
  if (report.learningPolicyWarning !== null) console.error(`note: ${report.learningPolicyWarning}`);
  if (report.learning !== null) {
    console.log(
      `${"learning (overlay)".padEnd(20)} ${money(report.learning.monthUsd).padStart(10)} ` +
        `${money(report.learning.monthlyCapUsd).padStart(10)} ${report.learning.monthStatus}` +
        ` — ${report.learning.experimentsThisMonth}/${report.learning.maxExperimentsPerMonth} experiments this month`,
    );
    for (const candidate of report.learning.byCandidate) {
      console.log(
        `  ${candidate.candidate.padEnd(18)} ${money(candidate.spentUsd).padStart(10)} ` +
          `${money(candidate.capUsd).padStart(10)} ${candidate.status}`,
      );
    }
  }
  if (unmeasured.size > 0) {
    const parts = report.unmeasured.map(({ app, sessions }) => `${app}: ${sessions}`);
    console.log(
      `note: ${parts.join(", ")} interactive session(s) this month have unmeasured usage — ` +
        "their cost is unknown, not zero",
    );
  }
  console.log(
    `note: ${report.notes[0]}`,
  );
  return 0;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`budget: ${flag} requires a value`);
  return value;
}
