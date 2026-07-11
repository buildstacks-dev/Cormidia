#!/usr/bin/env node
// Operon CLI. `loop` carries claude-loop's standalone UX forward as a
// subcommand (docs/PURPOSE.md → Repo shape).
//
// This file is a thin dispatch table over one module per subcommand
// (src/cli/roles.ts, src/cli/doctor.ts, ...). Adding a subcommand is a new
// file + one registry line here — never a growing shared switch (M0.1).

import { cmdRoles } from "./cli/roles.js";
import { cmdApps } from "./cli/apps.js";
import { cmdApprovals } from "./cli/approvals.js";
import { cmdAnalyze } from "./cli/analyze.js";
import { cmdBootstrap } from "./cli/bootstrap.js";
import { cmdBudget } from "./cli/budget.js";
import { cmdDispatch } from "./cli/dispatch.js";
import { cmdDoctorArgs } from "./cli/doctor.js";
import { cmdLearn } from "./cli/learn.js";
import { cmdLoop } from "./cli/loop.js";
import { cmdNewApp } from "./cli/new-app.js";
import { cmdPlan } from "./cli/plan.js";
import { cmdPipelines } from "./cli/pipelines.js";
import { cmdPruneRuns } from "./cli/prune-runs.js";
import { cmdRetro } from "./cli/retro.js";
import { cmdRunRole } from "./cli/run-role.js";
import { cmdStatus } from "./cli/status.js";
import { cmdTelemetry } from "./cli/telemetry.js";
import { cmdOrg } from "./cli/org.js";
import { cmdCapabilities, cmdContext, packageVersion } from "./cli/context-info.js";

const USAGE = `operon — org runtime for a team of AI agents

Usage:
  operon org init <local-path> --name <name> [--state-home <path>]
                           create and select a separate, complete org home
  operon org show [--json] show the active org and state homes
  operon org use <local-path> [--state-home <path>]
                           select an existing complete org home
  operon context [--json]  show resolved paths and registered apps
  operon capabilities [--json]
                           show the installed command/capability surface
  operon roles [path]      validate roles.yaml and print the org chart
  operon apps [path]       validate apps.yaml and print the app registry
  operon pipelines [path]  validate pipelines.yaml and print the pass table
  operon bootstrap [path] [--scan-only] [--answers <file>] [--org-home <path>] [--state-home <path>]
                           scan a target repo, walk the alignment
                           questionnaire (interactive, or --answers
                           answers.json), and emit the .operon/ tree
                           (--scan-only: report only)
  operon new-app <name-or-goal> --target-dir <path> --repo <owner/repo>
                           [--goal <string>] [--name <app>]
                           scaffold a new product repo, emit starter product
                           docs/tickets, bootstrap .operon/, and register it
  operon plan <app> [--topic <string>] [--dry-run] [--workdir <path>]
                           open a Planner co-planning session for an
                           onboarded app
  operon doctor [--json]   validate installation, active org, state, adapters,
                           and scheduler status
  operon approvals [review|show <id>] [--state-home <path>]
                           inspect or decide the critical-op approval queue
  operon budget [--state-home <path>] [--apps <path>]
                           summarize monthly app spend and budget pauses
  operon status [--state-home <path>] [--app <app>] [--limit N]
                           show recent L1/L2 run status
  operon analyze [--state-home <path>] [--app <app>]
                           report L1/L2 anomaly flags and recommendations
  operon telemetry [--app <app>] [--date YYYY-MM-DD] [--json] [--html <path>]
                           historical pass/trace/cost view over run records
  operon dispatch [--state-home <path>] [--dry-run]
                           run one autonomous scheduler tick
  operon prune-runs [root] [--retention-days N]
                           delete finalized run dirs past retention
  operon retro [--date YYYY-MM-DD] [--state-home <path>] [--apps <path>] [--roles <path>]
                           write a weekly evidence retro report
  operon learn <inspect|emit|show|report|review|publish|resolve|disable|rollback|provisional|experiment|canary> [...]
                           learning loop: capture window (inspect, emit,
                           show, report), M4 governed activation (review,
                           publish, resolve, disable, rollback, provisional),
                           M5 offline evaluation (experiment declare|run|list)
                           and live canary (canary start|status|promote|stop)
  operon loop --app <app> [--once|--follow] [--dry-run]
                           run the build loop over ready tickets
  operon run-role <role> [--app <app>] [--turn <id>] [--template <path>] [--dry-run]
                           one role turn as a one-pass pipeline (--dry-run
                           prints the assembled brief, token-free)
`;

interface CliCommand {
  run(args: string[]): number | Promise<number>;
  help: string;
}

const HOME_HELP = `\n\nLocation flags:\n  --org-home <path>    committed org configuration; defaults to the active pointer\n  --state-home <path>  local high-churn runtime state; defaults to ~/.operon/<org>`;

const HELP = {
  org: `Usage:\n  operon org init <local-path> --name <name> [--state-home <path>] [--json]\n  operon org show [--json]\n  operon org use <local-path> [--state-home <path>] [--json]\n\nOrg home stores committed roles, apps, pipelines, prompts, taste, and curated memory.\nState home stores local clones, worktrees, locks, approvals, telemetry, and run logs.`,
  roles: `Usage: operon roles [roles.yaml-path]${HOME_HELP}`,
  apps: `Usage: operon apps [apps.yaml-path]${HOME_HELP}`,
  pipelines: `Usage: operon pipelines [pipelines.yaml-path]${HOME_HELP}`,
  bootstrap: `Usage: operon bootstrap [local-repo-path] [--scan-only] [--answers <answers.json>] [--org-home <path>] [--state-home <path>]\n\nThe positional value is a local directory, never a GitHub URL. The active org must already exist. Outside an interactive terminal, --answers is required and omission writes nothing.`,
  "new-app": `Usage: operon new-app <name-or-goal> --target-dir <local-path> --repo <owner/repo> [--goal <text>] [--name <app>] [--org-home <path>] [--dry-run]`,
  plan: `Usage:\n  operon plan <app-name> [--topic <text>] [--workdir <local-path>] [--dry-run]\n  operon plan <app-name> --auto --goal <text> [--stage bootstrap|growth|mature] [--no-publish]${HOME_HELP}\n\n--auto runs one non-interactive Planner turn on the configured runtime and publishes a schema-validated 1-3-ticket bootstrap plan through the orchestrator (canonical labels guaranteed; no agent-authored gh calls). Exits 1 when no durable plan was produced.`,
  loop: `Usage: operon loop --app <app-name> [--once|--follow] [--dry-run] [--allow-network] [--repo-dir <local-path>]${HOME_HELP}`,
  doctor: `Usage: operon doctor [--json]${HOME_HELP}`,
  approvals: `Usage: operon approvals [list|review [--batch]|show <id>|revoke <grant-id>] [--state-home <path>] [--now <ISO-time>]${HOME_HELP}\n\nreview decisions: "a" approves single-use (default); "a ticket [path]" / "a app [path]" mint a rule+path-scoped multi-use grant (TTL 24h, 20 uses; never for self-merge/deploy/protocol/scorecard/approval-store rules); approving a ticketed item offers op:blocked -> op:ready re-arm. --batch groups same-rule/app items into one decision with per-item audit.`,
  budget: `Usage: operon budget [--apps <apps.yaml-path>] [--reconcile]${HOME_HELP}\n\n--reconcile back-fills the org ledger from runs/**/envelope.json (idempotent, keyed on app+run_id) so historical loop passes reach budget, retro, and scorecards. Caveat: dispatched turns recorded before per-pass settlement wrote aggregate turn rows without run ids; reconciling such a ledger can count that older window twice.`,
  status: `Usage: operon status [--app <app-name>] [--limit N]${HOME_HELP}`,
  analyze: `Usage: operon analyze [--app <app-name>]${HOME_HELP}`,
  telemetry: `Usage: operon telemetry [--app <app-name>] [--date YYYY-MM-DD] [--json] [--html <path>]${HOME_HELP}\n\nHistorical view over runs/**/envelope.json: per-ticket trace blocks, role/model/ticket cost totals, and still-running passes. --html writes a self-contained static report (Gantt + pass table + cost attribution).`,
  dispatch: `Usage: operon dispatch [--dry-run] [--apps <path>] [--roles <path>]${HOME_HELP}`,
  "prune-runs": `Usage: operon prune-runs [state-home-path] [--retention-days N]${HOME_HELP}`,
  retro: `Usage: operon retro [--date YYYY-MM-DD] [--apps <path>] [--roles <path>]${HOME_HELP}`,
  learn: `Usage:\n  operon learn inspect <episode-id>     full episode record: turns, gates, outcome,\n                                        approvals, artifacts, replay capsule\n  operon learn emit [--episode <id>] [--app <name>] [--observation <text>]\n                    [--cause <text>] [--intervention <text>] [--artifact <ref>]...\n                    [--file <json>]  record a human observation (interactive in a terminal)\n  operon learn emit --late-outcome <kind> --ref <ref> --episode <id> [--note <text>]\n                    record an append-only late outcome against a closed episode\n  operon learn show <event|candidate|experiment|eval|intervention-id>\n                                        trace an id to its disposition\n  operon learn report [--json]          capture totals, episodes, experiments,\n                                        reviews, activation + SLA sections\n  operon learn review <candidate-id> --verdict approve|revise|reject|escalate\n                    --rationale <text> --by <name> [--destination <d>] [--tier <T>]\n                    [--scope <s>] [--rubric k=v,...] [--injection clean|suspicious|flagged]\n                    [--file <verdict.json>]  record a fail-closed reviewer verdict\n  operon learn publish <candidate-id> [--waiver <text>] [--repo <owner/repo>]\n                    route a reviewed candidate: routine destinations publish\n                    (deduped, rate-capped); activation/T2/T3 raise a\n                    content-bound approval, then publish on re-run\n  operon learn resolve --app <app> --role <role> [--task <text>]\n                    dry-run the governed-concept resolver for one turn\n  operon learn disable <concept-id>     deprecate an active concept immediately\n  operon learn rollback --root org|app [--app <name>]\n                    revert the latest bundle version cut\n  operon learn provisional --scope <s> --name <n> --description <d>\n                    --ttl-days N --by <name> (--body <text>|--file <md>)\n                    quarantine an UNVERIFIED provisional (urgent human lane)\n  operon learn experiment declare --candidate <id> --evals <scope>/<set>\n                    --hypothesis <text> [--app <name>] [--metric <m>] [--repetitions N]\n                    [--guardrail metric:rule[:pct]]...  declare arms before results\n  operon learn experiment run <experiment-id> [--by <name>] [--app <name>]\n                    [--repo-dir <path>]  the offline evaluation funnel: prechecks,\n                    targeted paired eval, full paired replay (spends model tokens)\n  operon learn experiment list          declarations, verdicts, ledger cost\n  operon learn canary start <intervention-id> [--app <name>]\n                    begin the tier-gated, episode-sticky live trial\n  operon learn canary status            assignments + outcomes by lineage +\n                                        promote-rule recommendation\n  operon learn canary promote --root org|app [--app <name>]   advance stable\n  operon learn canary stop --root org|app --reason <text>     roll the trial back${HOME_HELP}\n\nLearning loop M1-M5: capture, episodes, experiments, manual governed\nactivation, offline evaluation, and the human-started canary — every\nactivation is human-approved and content-bound; review fails closed;\nnothing self-activates; a T3 live canary is unrepresentable in policy.`,
  "run-role": `Usage: operon run-role <role-name> [--app <app-name>] [--turn <id>] [--template <path>] [--workdir <path>] [--dry-run]${HOME_HELP}`,
  context: `Usage: operon context [--json]${HOME_HELP}`,
  capabilities: "Usage: operon capabilities [--json]",
} as const;

const COMMANDS: Record<string, CliCommand> = {
  org: { run: (args) => cmdOrg(args), help: HELP.org },
  roles: { run: (args) => cmdRoles(args), help: HELP.roles },
  apps: { run: (args) => cmdApps(args), help: HELP.apps },
  approvals: { run: (args) => cmdApprovals(args), help: HELP.approvals },
  analyze: { run: (args) => cmdAnalyze(args), help: HELP.analyze },
  bootstrap: { run: (args) => cmdBootstrap(args), help: HELP.bootstrap },
  budget: { run: (args) => cmdBudget(args), help: HELP.budget },
  capabilities: { run: (args) => cmdCapabilities(args), help: HELP.capabilities },
  context: { run: (args) => cmdContext(args), help: HELP.context },
  dispatch: { run: (args) => cmdDispatch(args), help: HELP.dispatch },
  plan: { run: (args) => cmdPlan(args), help: HELP.plan },
  pipelines: { run: (args) => cmdPipelines(args), help: HELP.pipelines },
  doctor: { run: (args) => cmdDoctorArgs(args), help: HELP.doctor },
  "prune-runs": { run: (args) => cmdPruneRuns(args), help: HELP["prune-runs"] },
  learn: { run: (args) => cmdLearn(args), help: HELP.learn },
  retro: { run: (args) => cmdRetro(args), help: HELP.retro },
  loop: { run: (args) => cmdLoop(args), help: HELP.loop },
  "new-app": { run: (args) => cmdNewApp(args), help: HELP["new-app"] },
  "run-role": { run: (args) => cmdRunRole(args), help: HELP["run-role"] },
  status: { run: (args) => cmdStatus(args), help: HELP.status },
  telemetry: { run: (args) => cmdTelemetry(args), help: HELP.telemetry },
};

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === undefined || cmd === "--help" || cmd === "-h") {
      console.log(USAGE);
      return 0;
    }
    if (cmd === "--version" || cmd === "-v") {
      console.log(await packageVersion());
      return 0;
    }
    const command = COMMANDS[cmd];
    if (!command) {
      console.error(`operon: unknown command "${cmd}"`);
      console.error("Run operon --help to see the available commands.");
      return 1;
    }
    if (rest.includes("--help") || rest.includes("-h")) {
      console.log(command.help);
      return 0;
    }
    return await command.run(rest);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

process.exitCode = await main();
