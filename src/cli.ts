#!/usr/bin/env node
// Operon CLI. `loop` carries claude-loop's standalone UX forward as a
// subcommand (docs/PURPOSE.md → Repo shape).
//
// This file is a thin dispatch table over one module per subcommand
// (src/cli/roles.ts, src/cli/doctor.ts, ...). Adding a subcommand is a new
// file + one registry line here — never a growing shared switch (M0.1).

import { cmdRoles } from "./cli/roles.js";
import { cmdApps } from "./cli/apps.js";
import { cmdApp } from "./cli/app.js";
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
import { cmdTask } from "./cli/task.js";
import { cmdOrg } from "./cli/org.js";
import { cmdObserve } from "./cli/observe.js";
import { cmdReport } from "./cli/report.js";
import { cmdScheduler } from "./cli/scheduler.js";
import { cmdCapabilities, cmdContext, packageVersion } from "./cli/context-info.js";

const USAGE = `operon — org runtime for a team of AI agents

Usage:
  operon org init <local-path> --name <name> [--state-home <path>] [--authority delegated-operator|conservative|custom] [--authority-file <path>] [--authority-by <identity>]
                           create and select a separate, complete org home
  operon org show [--json] show the active org and state homes
  operon org use <local-path> [--state-home <path>]
                           select an existing complete org home
  operon org upgrade [--authority preserve|delegated-operator|conservative|custom] [--execute] [--json]
                           preview/apply an additive, archived org migration
  operon context [--json]  show resolved paths and registered apps
  operon capabilities [--json]
                           show the installed command/capability surface
  operon roles [path]      validate roles.yaml and print the org chart
  operon apps [path]       validate apps.yaml and print the app registry
  operon app reset <app> [--execute --confirm <app>] [--force] [--archive-root <path>]
                           archive and clean one app's Operon-managed state;
                           default is a non-mutating plan
  operon app verify <app> [--json]
                           prove refs, clone, authority, checks, locks,
                           approvals, and token-free runtime readiness
  operon app promote <app> --to live [--execute] [--json]
                           preview/apply verified transactional promotion
  operon pipelines [path]  validate pipelines.yaml and print the pass table
  operon bootstrap [path] [--scan-only] [--answers <file>|--answers-from <archive|app>] [--org-home <path>] [--state-home <path>] [--json]
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
  operon doctor [--json] [--config-only]
                           validate installation, active org, state, adapters,
                           and scheduler status
  operon scheduler <install|status|uninstall> [--backend launchd|systemd] [--json]
                           preview org-scoped scheduler lifecycle by default;
                           mutation requires --execute --confirm <exact-id>
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
  operon report [--app <app>] [--period 7d|30d|90d|1y|all] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--bucket auto|day|week|month] [--json] [--html <path>] [--open] [--summary-only]
                           ledger-first org/app usage and management report
  operon observe [--app <app>] [--parent-task <id>] [--ticket <number>] [--port <number>] [--open]
                           start the loopback-only, read-only Live + Reports UI
  operon task <begin|fallback|finish|show> ...
                           durable parent delegated-task ledger
  operon dispatch [--state-home <path>] [--dry-run]
                           run one autonomous scheduler tick
  operon prune-runs [root] [--retention-days N]
                           delete finalized run dirs past retention
  operon retro [--date YYYY-MM-DD] [--state-home <path>] [--apps <path>] [--roles <path>]
                           write a weekly evidence retro report
  operon learn <inspect|emit|show|report|fixture|review|publish|resolve|disable|rollback|provisional|experiment|canary> [...]
                           learning loop: capture window (inspect, emit,
                           show, report), eval fixtures (fixture), M4 governed
                           activation (review, publish, resolve, disable,
                           rollback, provisional), M5 offline evaluation
                           (experiment declare|run|list) and live canary
                           (canary start|status|promote|stop)
  operon loop --app <app> [--once|--follow] [--dry-run]
  operon loop --explain-context <episode-id>
  operon loop --resume-episode <episode-id>
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
  org: `Usage:\n  operon org init <local-path> --name <name> [--state-home <path>] [--authority delegated-operator|conservative|custom] [--authority-file <path>] [--authority-by <identity>] [--json]\n  operon org show [--json]\n  operon org use <local-path> [--state-home <path>] [--json]\n  operon org upgrade [--authority preserve|delegated-operator|conservative|custom] [--authority-file <path> --authority-by <identity>] [--archive-root <path>] [--execute] [--json]\n\nUpgrade defaults to a non-mutating schema diff. It adds missing packaged surfaces only, requires an explicit authority choice when AUTHORITY.md is absent, archives every changed prior byte with checksums, and runs post-upgrade doctor validation. Existing human-ratified surfaces are never overwritten.\n\nNew orgs get one versioned AUTHORITY.md. The default delegated-operator profile automates ordinary reversible work while publication/deployment, secrets, cloud/DNS/infrastructure, irreversible data loss, required human merge, and material product decisions remain human-gated. Custom requires both --authority-file and an attributable --authority-by identity.\n\nOrg home stores committed roles, apps, pipelines, prompts, taste, authority, and curated memory.\nState home stores local clones, worktrees, locks, approvals, telemetry, and run logs.`,
  roles: `Usage: operon roles [roles.yaml-path]${HOME_HELP}`,
  apps: `Usage: operon apps [apps.yaml-path]${HOME_HELP}`,
  app: `Usage:\n  operon app reset <app-name> [--dry-run] [--execute --confirm <app-name>] [--force] [--archive-root <path>] [--json]\n  operon app verify <app-name> [--json]\n  operon app promote <app-name> --to live [--dry-run|--execute] [--json]${HOME_HELP}\n\nReset defaults to a typed non-mutating plan. Execution preserves normalized non-secret answers and checksums before cleanup. --force bypasses only stale running envelopes (no heartbeat for 10 minutes); it never overrides active runs, journals, locks, or pending approvals. Verify is token-free and proves registry/config, remote/default ancestry, managed HEAD, authority, checks, approvals/locks, and static runtime readiness without constructing an adapter. Promote defaults to a non-mutating plan and resumes its journal safely after every transaction boundary.`,
  pipelines: `Usage: operon pipelines [pipelines.yaml-path]${HOME_HELP}`,
  bootstrap: `Usage: operon bootstrap [local-repo-path] [--scan-only] [--answers <answers.json>|--answers-from <archive|app>] [--org-home <path>] [--state-home <path>] [--json]\n\nThe positional value is a local directory, never a GitHub URL. The active org must already exist. Outside an interactive terminal, --answers or --answers-from is required and omission writes nothing. --answers-from verifies archived/stored normalized non-secret answers, creates the onboarding commit only in an Operon-managed clone, and leaves the human checkout branch, HEAD, index, modifications, and untracked files unchanged. Answers may include authority.mode=inherit|conservative|custom; custom requires restrictions and can only narrow the org charter.`,
  "new-app": `Usage: operon new-app <name-or-goal> --target-dir <local-path> --repo <owner/repo> [--goal <text>] [--name <app>] [--org-home <path>] [--dry-run]`,
  plan: `Usage:\n  operon plan <app-name> [--topic <text>] [--workdir <local-path>] [--dry-run] [--parent-task <id>]\n  operon plan <app-name> --auto --goal <text> [--stage bootstrap|growth|mature] [--no-publish] [--parent-task <id>] [--depth quick|standard|deep] [--risk low|medium|high] [--ambiguity low|medium|high] [--coupling low|medium|high] [--reversibility reversible|costly-to-reverse|irreversible] [--external-consequence none|internal|customer-public-production] [--expected-tickets 1-2|3-6|7+] [--sensitive-domains <csv>]\n  operon plan <app-name> --explain-route [structured route flags]${HOME_HELP}\n\n--auto applies planning-depth/v1 before constructing a runtime: quick runs one combined pass, standard runs visionary + one PM + decomposer, and deep runs competing PMs + arbitration + decomposition. --explain-route is a token-free structured decision read. Security, migration, release, destructive, high-risk, high-ambiguity, high-coupling, irreversible, externally consequential, and 7+ ticket work has a deep floor. The final plan is schema-validated and orchestrator-published; no agent-authored gh calls.`,
  loop: `Usage:\n  operon loop --app <app-name> [--once|--follow] [--dry-run] [--allow-network] [--repo-dir <local-path>] [--parent-task <id>]\n  operon loop --explain-context <episode-id>\n  operon loop --resume-episode <episode-id>${HOME_HELP}`,
  doctor: `Usage: operon doctor [--json] [--config-only]${HOME_HELP}`,
  scheduler: `Usage:\n  operon scheduler install [--backend launchd|systemd] [--cadence-minutes N] [--json]\n  operon scheduler install [--backend launchd|systemd] --execute --confirm <exact-org-or-scheduler-id> [--json]\n  operon scheduler status [--backend launchd|systemd] [--json]\n  operon scheduler uninstall [--backend launchd|systemd] [--json]\n  operon scheduler uninstall [--backend launchd|systemd] --execute --confirm <exact-org-or-scheduler-id> [--json]${HOME_HELP}\n\nInstall and uninstall preview without writes. Definitions use absolute executable, org, and state paths and are scoped to the exact org. systemd rendering is future-compatible but host execution remains unsupported until exercised.`,
  approvals: `Usage: operon approvals [list|review [--batch]|show <id>|revoke <grant-id>] [--state-home <path>] [--now <ISO-time>]${HOME_HELP}\n\nreview decisions: "a" approves single-use (default); "a ticket [path]" / "a app [path]" mint a rule+path-scoped multi-use grant (TTL 24h, 20 uses; never for self-merge/deploy/protocol/scorecard/approval-store rules); approving a ticketed item offers op:blocked -> op:ready re-arm. --batch groups same-rule/app items into one decision with per-item audit.`,
  budget: `Usage: operon budget [--apps <apps.yaml-path>] [--reconcile]${HOME_HELP}\n\n--reconcile terminalizes stale provider receipts, settles missing terminal provider steps, and back-fills legacy runs/**/envelope.json evidence. Current rows are idempotent by app+provider_turn_id; legacy rows fall back to app+run_id.`,
  status: `Usage: operon status [--app <app-name>] [--limit N]${HOME_HELP}`,
  analyze: `Usage: operon analyze [--app <app-name>]${HOME_HELP}`,
  telemetry: `Usage: operon telemetry [--app <app-name>] [--date YYYY-MM-DD] [--json] [--html <path>]${HOME_HELP}\n\nHistorical view over runs/**/envelope.json: per-ticket trace blocks, role/model/ticket cost totals, and still-running passes. --html writes a self-contained static report (Gantt + pass table + cost attribution).`,
  report: `Usage: operon report [--app <app-name>] [--period 7d|30d|90d|1y|all] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--bucket auto|day|week|month] [--json] [--html <path>] [--open] [--summary-only]${HOME_HELP}\n\nDeterministic, token-free, ledger-first management report. The default is the trailing 90 UTC calendar days. JSON and portable HTML are exhaustive unless --summary-only is explicit. --html writes only the selected target; report generation never reconciles or mutates Operon state.`,
  observe: `Usage: operon observe [--app <app-name>] [--parent-task <id>] [--ticket <number>] [--port <number>] [--open|--no-open]${HOME_HELP}\n\nStarts a foreground, loopback-only read-only observer serving Live at / and Reports at /reports. HTTP provides versioned snapshots, reports, exports, and deliberate local artifact access; SSE updates Live only. The per-process capability URL is printed once. The observer performs no provider turn, spends no tokens, exposes no workflow mutation endpoint, and stopping it never affects an Operon run.`,
  task: `Usage:\n  operon task begin --id <id> --prompt-file <path> [--app <app>] [--workdir <path>] [--harness codex|claude|pi] [--native-task-id <id>] [--required-stages planner,builder,reviewer]\n  operon task fallback --id <id> --reason <text> [--actor <name>] [--external-only]\n  operon task finish --id <id> --status completed|failed|cancelled|timed_out [--result <text>] [--ticket <ref>] [--trace <id>] [--branch <ref>] [--pr <ref>] [--review <ref>] [--deployment <ref>] [--implementation complete|incomplete|unknown] [--ci green|red|pending|unknown] [--operon-review approved|changes_requested|awaiting|bypassed|not_required|unknown] [--human-review approved|awaiting|not_required|unknown] [--pr-state open|merged|closed|abandoned|none|unknown] [--issue-closes-on-merge <ref>]\n  operon task show --id <id> [--json|--prompt]${HOME_HELP}\n\nBegin once from the exact outer harness prompt, export OPERON_PARENT_TASK_ID for child Operon commands, record every manual/external fallback, then finish at the delegated outcome boundary.`,
  dispatch: `Usage: operon dispatch [--dry-run] [--apps <path>] [--roles <path>]${HOME_HELP}`,
  "prune-runs": `Usage: operon prune-runs [state-home-path] [--retention-days N]${HOME_HELP}`,
  retro: `Usage: operon retro [--date YYYY-MM-DD] [--apps <path>] [--roles <path>]${HOME_HELP}`,
  learn: `Usage:\n  operon learn inspect <episode-id>     full episode record: turns, gates, outcome,\n                                        approvals, artifacts, replay capsule\n  operon learn emit [--episode <id>] [--app <name>] [--observation <text>]\n                    [--cause <text>] [--intervention <text>] [--artifact <ref>]...\n                    [--file <json>]  record a human observation (interactive in a terminal)\n  operon learn emit --late-outcome <kind> --ref <ref> --episode <id> [--note <text>]\n                    record an append-only late outcome against a closed episode\n  operon learn show <event|candidate|experiment|eval|intervention-id>\n                                        trace an id to its disposition\n  operon learn report [--json]          capture totals, episodes, experiments,\n                                        scheduled runs, compaction, reviews, activation\n  operon learn distill [--app <app>] [--dry-run]\n                    deterministic precheck; actionable live windows run the\n                    governed distiller pipeline and spend learning-budgeted tokens\n  operon learn fixture <episode-id> --set <scope>/<set> [--validate] --by <name>\n                    convert a closed episode's replay capsule into a sanitized\n                    eval fixture (draft until independently --validate'd)\n  operon learn review <candidate-id> --verdict approve|revise|reject|escalate\n                    --rationale <text> --by <name> [--destination <d>] [--tier <T>]\n                    [--scope <s>] [--rubric k=v,...] [--injection clean|suspicious|flagged]\n                    [--file <verdict.json>]  record a fail-closed reviewer verdict\n  operon learn publish <candidate-id> [--waiver <text>] [--repo <owner/repo>]\n                    route a reviewed candidate: routine destinations publish\n                    (deduped, rate-capped); activation/T2/T3 raise a\n                    content-bound approval, then publish on re-run\n  operon learn resolve --app <app> --role <role> [--task <text>]\n                    dry-run the governed-concept resolver for one turn\n  operon learn disable <concept-id>     deprecate an active concept immediately\n  operon learn rollback --root org|app [--app <name>]\n                    revert the latest bundle version cut\n  operon learn provisional --scope <s> --name <n> --description <d>\n                    --ttl-days N --by <name> (--body <text>|--file <md>)\n                    quarantine an UNVERIFIED provisional (urgent human lane)\n  operon learn experiment declare --candidate <id> --evals <scope>/<set>\n                    --hypothesis <text> [--app <name>] [--metric <m>] [--repetitions N]\n                    [--guardrail metric:rule[:pct]]...  declare arms before results\n  operon learn experiment run <experiment-id> [--by <name>] [--app <name>]\n                    [--repo-dir <path>]  the offline evaluation funnel: prechecks,\n                    targeted paired eval, full paired replay (spends model tokens)\n  operon learn experiment list          declarations, verdicts, ledger cost\n  operon learn canary start <intervention-id> [--app <name>]\n                    begin the tier-gated, episode-sticky live trial\n  operon learn canary status            assignments + outcomes by lineage +\n                                        promote-rule recommendation\n  operon learn canary promote --root org|app [--app <name>]   advance stable\n  operon learn canary stop --root org|app --reason <text>     roll the trial back${HOME_HELP}\n\nLearning loop M1-M6: capture, episodes, experiments, governed activation,\noffline evaluation, human-started canary, scheduled distillation, independent\nreview, and report-only compaction. Every activation is human-approved and\ncontent-bound; review fails closed; nothing self-activates; a T3 live canary\nis unrepresentable in policy.`,
  "run-role": `Usage: operon run-role <role-name> [--app <app-name>] [--turn <id>] [--template <path>] [--workdir <path>] [--dry-run] [--parent-task <id>]${HOME_HELP}`,
  context: `Usage: operon context [--json]${HOME_HELP}`,
  capabilities: "Usage: operon capabilities [--json]",
} as const;

const LEARN_HELP = HELP.learn.replace(
  "operon learn report [--json]          capture totals, episodes, experiments,\n" +
    "                                        scheduled runs, compaction, reviews, activation",
  "operon learn report [--efficiency-health] [--json] [--refresh]\n" +
    "                                        separate capture, governance, efficacy health;\n" +
    "                                        read-only unless --refresh projects",
);

const COMMANDS: Record<string, CliCommand> = {
  org: { run: (args) => cmdOrg(args), help: HELP.org },
  roles: { run: (args) => cmdRoles(args), help: HELP.roles },
  apps: { run: (args) => cmdApps(args), help: HELP.apps },
  app: { run: (args) => cmdApp(args), help: HELP.app },
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
  scheduler: { run: (args) => cmdScheduler(args), help: HELP.scheduler },
  "prune-runs": { run: (args) => cmdPruneRuns(args), help: HELP["prune-runs"] },
  learn: { run: (args) => cmdLearn(args), help: LEARN_HELP },
  retro: { run: (args) => cmdRetro(args), help: HELP.retro },
  loop: { run: (args) => cmdLoop(args), help: HELP.loop },
  "new-app": { run: (args) => cmdNewApp(args), help: HELP["new-app"] },
  "run-role": { run: (args) => cmdRunRole(args), help: HELP["run-role"] },
  status: { run: (args) => cmdStatus(args), help: HELP.status },
  telemetry: { run: (args) => cmdTelemetry(args), help: HELP.telemetry },
  report: { run: (args) => cmdReport(args), help: HELP.report },
  observe: { run: (args) => cmdObserve(args), help: HELP.observe },
  task: { run: (args) => cmdTask(args), help: HELP.task },
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
