import { join, resolve } from "node:path";
import {
  countUnmeasured,
  enforceBudgetOverlay,
  reconcileLedger,
  rollupLearningSpend,
} from "../org/budget.js";
import { loadApps } from "../org/apps.js";
import { loadLearningPolicy } from "../org/learning/policy.js";
import { loadRoles } from "../org/roles.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdBudget(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "budget");
  let appsPath: string | undefined;
  let reconcile = false;
  for (let i = 0; i < common.rest.length; i++) {
    const arg = common.rest[i]!;
    if (arg === "--apps") appsPath = needValue(common.rest, ++i, "--apps");
    else if (arg === "--reconcile") reconcile = true;
    else throw new Error(`budget: unknown argument "${arg}"`);
  }

  const homes = await resolveOperonHomes(common);
  const effectiveAppsPath = appsPath ? resolve(appsPath) : join(homes.orgHome, "apps.yaml");
  const apps = await loadApps(effectiveAppsPath);

  if (reconcile) {
    // Back-fill the ledger from runs/**/envelope.json — idempotent (run_id
    // keyed), so this is safe to run any time and repairs orgs whose loop
    // passes predate per-pass settlement.
    const rolesFile = await loadRoles(join(homes.orgHome, "roles.yaml"));
    const runtimeByRole = Object.fromEntries(
      rolesFile.roles.map((role) => [role.name, role.runtime]),
    );
    const outcome = await reconcileLedger(homes.stateHome, runtimeByRole);
    console.log(
      `reconcile: ${outcome.scanned} envelopes scanned — ${outcome.settled} settled ` +
        `(recovered $${outcome.recoveredUsd.toFixed(2)}), ${outcome.alreadySettled} already in the ledger, ` +
        `${outcome.noUsage} with no recorded usage` +
        (outcome.inFlight > 0 ? `, ${outcome.inFlight} in flight (left for their own settle)` : "") +
        (outcome.corrupt > 0 ? `, ${outcome.corrupt} unreadable` : ""),
    );
  }

  const rows = await enforceBudgetOverlay(homes.stateHome, apps);
  console.log("APP                  SPENT      BUDGET     STATUS");
  for (const row of rows) {
    console.log(
      `${row.app.padEnd(20)} ${money(row.spentUsd).padStart(10)} ${money(row.budgetUsd).padStart(10)} ${row.status.toUpperCase()}`,
    );
  }
  // Learning overlay (learning-loop M5, spec §13): replay/eval spend settles
  // into the same ledger; this is the rollup against the learning caps.
  const learning = await rollupLearningSpend(homes.stateHome);
  if (learning.monthUsd > 0 || learning.byCandidate.size > 0) {
    const policy = await loadLearningPolicy(homes.orgHome);
    const cap = policy.learning_budget.monthly_usd;
    const monthStatus =
      learning.monthUsd >= cap ? "EXCEEDED" : learning.monthUsd >= cap * 0.8 ? "WARNING" : "OK";
    console.log(
      `${"learning (overlay)".padEnd(20)} ${money(learning.monthUsd).padStart(10)} ${money(cap).padStart(10)} ${monthStatus}` +
        ` — ${learning.experimentsThisMonth}/${policy.learning_budget.max_experiments_per_month} experiments this month`,
    );
    for (const [candidate, spent] of [...learning.byCandidate.entries()].sort()) {
      const candidateCap = policy.learning_budget.per_candidate_replay_usd;
      const status = spent >= candidateCap ? "EXCEEDED" : spent >= candidateCap * 0.8 ? "WARNING" : "OK";
      console.log(
        `  ${candidate.padEnd(18)} ${money(spent).padStart(10)} ${money(candidateCap).padStart(10)} ${status}`,
      );
    }
  }

  const month = new Date().toISOString().slice(0, 7);
  const unmeasured = await countUnmeasured(homes.stateHome, month);
  if (unmeasured.size > 0) {
    const parts = [...unmeasured.entries()].map(([app, count]) => `${app}: ${count}`);
    console.log(
      `note: ${parts.join(", ")} interactive session(s) this month have unmeasured usage — ` +
        "their cost is unknown, not zero",
    );
  }
  console.log(
    "note: subscription-backed provider spend is an Operon-computed equivalent-cost estimate, " +
      "not a provider invoice",
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
