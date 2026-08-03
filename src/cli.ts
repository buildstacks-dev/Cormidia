#!/usr/bin/env node
// Cormidia CLI. `loop` carries claude-loop's standalone UX forward as a
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
import { cmdBootstrapPublish } from "./cli/bootstrap-publish.js";
import { cmdBudget } from "./cli/budget.js";
import { cmdDispatch } from "./cli/dispatch.js";
import { cmdEpisode } from "./cli/episode.js";
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
import { cmdNarrative } from "./cli/narrative.js";
import { cmdScheduler } from "./cli/scheduler.js";
import { cmdCapabilities, cmdContext, packageVersion } from "./cli/context-info.js";
import { jsonCliFailure, runJsonCliCommand } from "./cli/json-failure.js";
import {
  reportCliInvocation,
  reportCliInvocationFailure,
  runAuditedCliInvocation,
} from "./cli/invocation-audit.js";

const USAGE = `cormidia — org runtime for a team of AI agents

Usage:
  cormidia org init <local-path> --name <name> [--state-home <path>] [--authority delegated-operator|conservative|custom] [--authority-file <path>] [--authority-by <identity>] [--dry-run] [--json]
                           preview or create and select a complete org home
  cormidia org show [--json] show the active org and state homes
  cormidia org use <local-path> [--state-home <path>]
                           select an existing complete org home
  cormidia org list [--json] enumerate every discoverable org, its state home,
                           footprint, app count, and last activity
  cormidia org archive <org> [--archive-root <path>] [--execute --confirm <org>] [--json]
                           preview or archive-then-retire one org's local state;
                           never touches the org home or any GitHub repository
  cormidia org upgrade [--authority preserve|delegated-operator|conservative|custom] [--execute] [--json]
                           preview/apply an additive, archived org migration
  cormidia context [--json]  show resolved paths and registered apps
  cormidia capabilities [--json]
                           show the installed command/capability surface
  cormidia roles [path] [--json]
                           validate roles.yaml and print the org chart with effective turn budgets
  cormidia roles set <role> [--runtime claude|codex|pi] [--model <id>] [--effort low|medium|high|xhigh|max] [--turn-budget <usd>] [--reason <text>] [--by <identity>] [--execute] [--json]
                           preview a role assignment change; execution requires
                           an attributable identity and is journaled
  cormidia apps [path] [--json]
                           validate apps.yaml and print the app registry
  cormidia app reset <app> [--execute --confirm <app>] [--force] [--archive-root <path>]
                           archive and clean one app's Cormidia-managed state;
                           default is a non-mutating plan
  cormidia app verify <app> [--json]
                           prove refs, canonical GitHub labels, clone,
                           authority, checks, locks, approvals, and token-free
                           runtime readiness
  cormidia app promote <app> --to live [--execute] [--json]
                           preview/apply verified transactional promotion
  cormidia pipelines [path] [--json]
                           validate pipelines.yaml and print the pass table
  cormidia bootstrap [path] [--scan-only] [--answers <file>|--answers-from <archive|app>] [--org-home <path>] [--state-home <path>] [--json]
                           scan a target repo, walk the alignment
                           questionnaire (interactive, or --answers
                           answers.json), and emit the .cormidia/ tree
                           (--scan-only: report only)
  cormidia bootstrap publish <app> [--app-dir <path>] [--execute] [--json]
                           open coordinated DRAFT pull requests for the
                           bootstrap-owned app and org changes (preview by
                           default; never merges)
  cormidia new-app <name-or-goal> --target-dir <path> --repo <owner/repo>
                           [--goal <string>] [--name <app>]
                           [--template typescript-node|bare] [--dry-run] [--json]
                           scaffold a new product repo, emit starter product
                           docs/tickets, bootstrap .cormidia/, and register it
  cormidia plan <app> --dry-run [--topic <string>] [--workdir <path>]
                           preview Planner context and a current disposable
                           worktree without constructing a provider
  cormidia plan <app> --auto --goal <text> [--source <file-or-dir>]...
                           run content-bound automated planning
  cormidia plan <app> --creator-scope <scope.json|scope.yaml> --execution-ready
                           validate explicit creator scope, skip the dedicated
                           EpisodePlanner, and execute its governed plan
  cormidia plan ratify-ticket-budget --app <app> --decomposition <id> --actor <identity>
                           --reason <text> --from-budget N --to-budget N
                           [--no-publish] [--json] [--execute --confirm <app>@<id>]
                           record an attributable human decision to admit ONE
                           preserved oversized decomposition, then publish it
                           token-free (preview by default)
  cormidia doctor [--json] [--config-only]
                           validate installation, active org, state, adapters,
                           managed-clone working trees, and scheduler status
  cormidia scheduler <install|status|uninstall> [--backend launchd|systemd] [--json]
                           preview org-scoped scheduler lifecycle by default;
                           mutation requires --execute --confirm <exact-id>
  cormidia approvals [review|show <id>] [--state-home <path>] [--json]
                           inspect or decide the critical-op approval queue
  cormidia budget [--state-home <path>] [--apps <path>] [--json]
                           summarize monthly app spend and budget pauses
  cormidia status [--state-home <path>] [--app <app>] [--limit N] [--json]
                           show recent L1/L2 run status
  cormidia analyze [--state-home <path>] [--app <app>] [--json]
                           report L1/L2 anomaly flags and recommendations
  cormidia telemetry [--app <app>] [--date YYYY-MM-DD] [--json] [--html <path>]
                           historical pass/trace/cost view over run records
  cormidia report [--app <app>] [--period 7d|30d|90d|1y|all] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--bucket auto|day|week|month] [--json] [--html <path>] [--open] [--summary-only]
                           ledger-first org/app usage and management report
  cormidia narrative [--app <app>] [--episode <id>] [--json]
                           human-level causal timeline: one markdown story
                           per episode + per-app INDEX.md (token-free)
  cormidia observe [--app <app>] [--parent-task <id>] [--ticket <number>] [--port <number>] [--open]
                           start the loopback-only, read-only Live + Reports UI
  cormidia task <begin|fallback|finish|show> ...
                           durable parent delegated-task ledger
  cormidia dispatch [--state-home <path>] [--dry-run]
                           run one autonomous scheduler tick
  cormidia episode explain <episode-id> [--json]
                           explain a durable EpisodePlan and every exact turn
                           assignment without constructing a runtime
  cormidia prune-runs [root] [--retention-days N | --sweep]
                           delete finalized run dirs past retention; --sweep
                           runs the full state-home retention sweep
  cormidia retro [--date YYYY-MM-DD] [--state-home <path>] [--apps <path>] [--roles <path>]
                           write a weekly evidence retro report
  cormidia learn <inspect|emit|show|report|fixture|review|publish|resolve|disable|rollback|provisional|experiment|canary> [...]
                           learning loop: capture window (inspect, emit,
                           show, report), eval fixtures (fixture), M4 governed
                           activation (review, publish, resolve, disable,
                           rollback, provisional), M5 offline evaluation
                           (experiment declare|run|list) and live canary
                           (canary start|status|promote|stop)
  cormidia loop --app <app> [--once|--follow] [--dry-run]
  cormidia loop --explain-context <episode-id>
  cormidia loop --resume-episode <episode-id>
  cormidia loop rearm --app <app> --ticket <number> --reason <text> --actor <identity> --from-allowance N --to-allowance N [--execute --confirm <app#number>]
                           run the build loop over ready tickets
  cormidia run-role <role> --app <app> --turn <invocation-id> --template <path> [--assignment <candidate-id>@<effort>] [--allow-network] [--dry-run]
                           one role turn as a one-pass pipeline (--dry-run
                           validates the same scope and assignment, token-free)
`;

interface CliCommand {
  run(args: string[]): number | Promise<number>;
  help: string;
}

const HOME_HELP = `\n\nLocation flags:\n  --org-home <path>    committed org configuration; defaults to the active pointer\n  --state-home <path>  local high-churn runtime state; defaults to ~/.cormidia/<org>\n\nAudit note: every dispatched command whose state home can be resolved writes exactly one terminal row under invocations/. Preview/read-only/no-write claims exclude this observability record. Help, version, no-command usage, and commands with no resolvable state home are not journaled. A command that removes the state home it is journaling to redirects its terminal row to a ledger outside that tree rather than skipping it or writing it back into the removed path.`;

const HELP = {
  org: `Usage:\n  cormidia org init <local-path> --name <name> [--state-home <path>] [--authority delegated-operator|conservative|custom] [--authority-file <path>] [--authority-by <identity>] [--dry-run] [--json]\n  cormidia org show [--json]\n  cormidia org use <local-path> [--state-home <path>] [--json]\n  cormidia org list [--json]\n  cormidia org archive <org> [--archive-root <path>] [--dry-run|--execute --confirm <org>] [--json]\n  cormidia org upgrade [--authority preserve|delegated-operator|conservative|custom] [--authority-file <path> --authority-by <identity>] [--archive-root <path>] [--execute] [--json]\n\nInit executes by default for compatibility. --dry-run is a token-free, zero-domain-write preflight showing resolved homes, every generated destination, authority summary, and the complete packaged role chart; after the target is validated it writes only the command audit record described below. Collisions return a blocked plan. Existing real directories may be populated without changing unrelated entries, but no generated path is overwritten.\n\nUpgrade defaults to a non-mutating schema diff. It adds missing packaged surfaces only, requires an explicit authority choice when AUTHORITY.md is absent, archives every changed prior byte with checksums, and runs post-upgrade doctor validation. Existing human-ratified surfaces are never overwritten.\n\nNew orgs get one versioned AUTHORITY.md. The default delegated-operator profile automates ordinary reversible work while publication/deployment, secrets, cloud/DNS/infrastructure, irreversible data loss, required human merge, and material product decisions remain human-gated. Custom requires both --authority-file and an attributable --authority-by identity.\n\nList enumerates every org discoverable from the active-pointer directory with its state home, footprint, app count, and last activity. It is read-only. An org whose state home has no recorded org home is reported as an orphan; doctor reports the same condition.\n\nArchive retires ONE org's local state. It previews by default and mutation requires --execute plus an exact --confirm <org>. It writes one verified archive outside the state home covering that state home plus a snapshot of the ratified org configuration, re-reads every archived byte against the source, and only then removes the state home; a verification failure removes nothing. It clears the active pointer when the archived org was active. It never touches the org home (usually a git repository and often a human checkout) or any GitHub repository, branch, or ticket, and reports both as left intact. It refuses while a role lock is held, a critical-operation approval is undecided, or a lifecycle transaction is interrupted.\n\nArchive is the one cross-org command: it retires any discoverable org, active or not, and records the retirement under provenance.archivedOrg in the invoking org's invocation ledger — or, when the org it retires IS the invoking one, in <archive-root>/retirement-ledger, which outlives the removed state home. After --execute returns, the archived state home does not exist and no later command re-creates it. Archiving the same org twice from the same paths writes a numbered sibling archive rather than failing; no earlier archive is ever written into or replaced.\n\nOrg home stores committed roles, apps, pipelines, prompts, taste, authority, and curated memory.\nState home stores local clones, worktrees, locks, approvals, telemetry, and run logs.${HOME_HELP}`,
  roles: `Usage:\n  cormidia roles [roles.yaml-path] [--json]\n  cormidia roles set <role> [--runtime claude|codex|pi] [--model <id>] [--effort low|medium|high|xhigh|max] [--turn-budget <usd>] [--reason <text>] [--by <identity>] [--execute] [--json]${HOME_HELP}\n\nroles.yaml is a human-ratified surface and set does not bypass that. It previews by default, writing nothing and printing the exact before/after diff plus the adapter facts the resulting harness/model/effort tuple was validated against. It also states whether the resulting model id was proven against that harness's own token-free model roster, or names why the harness publishes none; a harness that does publish one (currently pi only) refuses an id it will not serve before anything is written. A harness that does not cannot be checked from a config edit at all, so setting a model or runtime on one warns on stdout and on stderr that the id is UNVERIFIED, records that in lifecycle/role-assignments.jsonl alongside the change, and points at cormidia doctor as what actually proves it. --execute additionally requires an attributable --by <identity> and a --reason; without them the command still validates and emits the proposal an agent hands to its operator, so an agent cannot quietly re-tier a role onto a more expensive model. Execution splices only the named scalars into the existing bytes rather than re-emitting the document, so comments (including multi-line trailing comment blocks), blank lines, key order, indentation, and flow sequences are all byte-identical outside the edited lines. It proves the rewritten file reads back as the planned assignment before replacing the ratified one, and appends the identity, reason, prior value, and both content hashes to lifecycle/role-assignments.jsonl.`,
  apps: `Usage: cormidia apps [apps.yaml-path] [--json]${HOME_HELP}`,
  app: `Usage:\n  cormidia app reset <app-name> [--dry-run] [--execute --confirm <app-name>] [--force] [--archive-root <path>] [--json]\n  cormidia app verify <app-name> [--json]\n  cormidia app promote <app-name> --to live [--dry-run|--execute] [--json]${HOME_HELP}\n\nReset defaults to a typed non-mutating plan. Execution preserves normalized non-secret answers and checksums before cleanup. --force bypasses only stale running envelopes (no heartbeat for 10 minutes); it never overrides active runs, journals, locks, or pending approvals. Verify is token-free and proves registry/config, remote/default ancestry, canonical GitHub labels (not applicable for local/file remotes), managed HEAD, authority, checks, approvals/locks, and static runtime readiness without constructing an adapter. Promote defaults to a non-mutating plan and resumes its journal safely after every transaction boundary.`,
  pipelines: `Usage: cormidia pipelines [pipelines.yaml-path] [--json]${HOME_HELP}`,
  bootstrap: `Usage:\n  cormidia bootstrap [local-repo-path] [--scan-only] [--answers <answers.json>|--answers-from <archive|app>] [--org-home <path>] [--state-home <path>] [--json]\n  cormidia bootstrap publish <app> [--app-dir <local-path>] [--app-only] [--dry-run|--execute] [--org-home <path>] [--state-home <path>] [--json]\n\npublish stages ONLY bootstrap-owned paths in the app repo and the org home, commits them on op/bootstrap-<app> cut from each remote's resolved default branch, pushes, and opens DRAFT pull requests. It previews by default and requires --execute to mutate; it refuses when unrelated staged changes, a merge/rebase in progress, a detached HEAD, or unresolved conflicts make the publication scope ambiguous. It never merges, never marks a pull request ready, and retries are idempotent (existing branch and pull request are reused).\n\nThe positional value is a local directory, never a GitHub URL. The active org must already exist. Outside an interactive terminal, --answers or --answers-from is required and omission writes no bootstrap artifacts (the command audit row still records the refusal). --answers-from verifies archived/stored normalized non-secret answers, creates the onboarding commit only in a Cormidia-managed clone, and leaves the human checkout branch, HEAD, index, modifications, and untracked files unchanged. Answers may include authority.mode=inherit|conservative|custom; custom requires restrictions and can only narrow the org charter.${HOME_HELP}`,
  "new-app": `Usage: cormidia new-app <name-or-goal> --target-dir <local-path> --repo <owner/repo> [--goal <text>] [--name <app>] [--template typescript-node|bare] [--org-home <path>] [--support-channel <id>] [--marketing-channel <id>] [--dry-run] [--json]

Templates are selected explicitly; free-form goal text never selects one. typescript-node is the backward-compatible default and emits the existing npm + strict TypeScript web scaffold with configured setup/test/lint commands. bare emits stack-neutral product docs and Cormidia artifacts only: no runtime, package manager, source skeleton, or executable gate command is assumed. Its required test/lint gates stay explicitly pending and fail closed. Run only its generated stack-and-gates establishment issue through the loop first; verify and preview promotion only after that issue merges with meaningful stack-specific commands. --dry-run writes no app/org artifacts; it writes only the command audit record described below. Text and JSON output report the selected template, exact created/updated/state paths, and quality-gate state.${HOME_HELP}`,
  plan: `Usage:\n  cormidia plan <app-name> --dry-run [--topic <text>] [--workdir <local-path>] [--parent-task <id>]\n  cormidia plan <app-name> --auto --goal <text> [--source <file-or-dir>]... [--optional-source <file-or-dir>]... [--stage bootstrap|growth|mature] [--dry-run] [--no-publish] [--json] [--parent-task <id>] [--work-lifecycle existing-ticket|bounded-goal|milestone|strategy] [--depth quick|standard|deep] [--risk low|medium|high] [--ambiguity low|medium|high] [--coupling low|medium|high] [--reversibility reversible|costly-to-reverse|irreversible] [--external-consequence none|internal|customer-public-production] [--expected-tickets 1-2|3-6|7+] [--sensitive-domains <csv>]\n  cormidia plan <app-name> --creator-scope <scope.json|scope.yaml> --execution-ready [--source <file-or-dir>]... [--stage bootstrap|growth|mature] [--workdir <local-path>] [--dry-run] [--no-publish] [--json]\n  cormidia plan <app-name> --explain-route [structured route flags]\n  cormidia plan ratify-ticket-budget --app <app-name> --decomposition <id> --actor <identity> --reason <text> --from-budget N --to-budget N [--no-publish] [--json] [--execute --confirm <app>@<id>]${HOME_HELP}\n\nEvery stage caps how many tickets ONE plan may publish (bootstrap 3, growth 5, mature 7). The cap and whether a requested --expected-tickets band can fit it are reported by the token-free --dry-run and --explain-route previews, before anything is spent. When a decomposition is refused for that cap ALONE, it is preserved verbatim under the state home's planning/<app>/refused-decompositions/ so ratification resumes from it instead of buying a different plan.\n\nratify-ticket-budget is the human-gated verb the refusal names. It previews by default and binds the app, the exact preserved decomposition, the actor, the reason, the current stage budget, and the accepted ticket count in a durable record beside the app config-ratification journal. --to-budget must equal that decomposition's own ticket count, non-interactive execution requires exact --confirm <app>@<decomposition-id>, and executing publishes exactly the preserved tickets with no provider turn. A ratification applies to that one decomposition digest only: it is never a standing budget override, and it is never a substitute for --stage, which asserts repository maturity and must stay honest.\n\nThe manual --dry-run form fetches and resolves the app remote's default branch, assembles Planner context in a disposable worktree, prints the preview, and cleans it up without constructing a provider. The former native interactive Claude child is disabled because it could not preserve durable EpisodePlan, exact assignment, gate, envelope, and settlement evidence; use --auto --goal or explicit creator scope for live planning. A workdir with no reachable origin stops with an actionable error instead of silently previewing a stale local branch.\n\n--auto builds a bounded EpisodeIntent and normally invokes the fixed-boot EpisodePlanner to design the smallest sufficient product-planning DAG. --stage is authoritative when supplied. When omitted, Cormidia infers product maturity from bounded local repository evidence, never the app's onboarding/live/paused lifecycle: at most five reachable commits with no reachable tags is bootstrap; at least fifty commits plus three tags is mature; the broad middle is growth. The greenfield seed strengthens only a low-history bootstrap result and cannot pin a growing repository. Missing local evidence is an explicit conservative bootstrap fallback. Preview and live inspect the same already-local checkout before live clone synchronization, and text/JSON report the source, reason, commit/tag counts, and whether the value was explicit or inferred. Fixed assignment mode resolves each planned provider turn from role configuration; adaptive mode requires the planner to choose an exact approved harness/model/effort tuple. --creator-scope accepts one strict CreatorEpisodeScope in JSON or YAML; it must be paired with --execution-ready, and the file must itself declare planningDisposition: execution_ready. The authoritative scope objective supplies --goal when omitted. If the scope is incomplete, disposition-mismatched, structurally invalid, or selects an unapproved assignment, the command fails before provider construction instead of inferring readiness or falling back to EpisodePlanner. A valid scope preserves creator provenance, normalizes through the same EpisodePlan validator and durable store, and then executes only its declared governed planning steps; --dry-run validates and previews this path with zero runtime calls.\n\nNeither apparent simplicity nor a quick/standard/deep label can bypass EpisodePlanner. Structured depth and risk flags are requested constraints and safety/reporting facts, not workflow selectors. Repeatable --source inputs are required and fail closed before Runtime construction; --optional-source inputs remain manifest-visible when truncated or excluded. File and bounded-directory bytes are content-hashed, secret/binary/symlink checked, recorded in each pass input manifest, and published to tickets only as refs and hashes. --explain-route and planning --dry-run forms are token-free intent/candidate/safety previews: they do not invoke a provider or claim to show an exact provider-authored plan. --no-publish executes planning but suppresses GitHub publication. Every produced plan is schema-validated once into the projection shared by console/JSON, no-publish, and GitHub publication; no agent-authored gh calls.`,
  loop: `Usage:\n  cormidia loop --app <app-name> [--once|--follow] [--dry-run] [--allow-network] [--repo-dir <local-path>] [--parent-task <id>]\n  cormidia loop --explain-context <episode-id>\n  cormidia loop --resume-episode <episode-id>\n  cormidia loop rearm --app <app-name> --ticket <number> --reason <text> --actor <identity> --from-allowance N --to-allowance N [--execute --confirm <app#number>]${HOME_HELP}\n\nrearm previews by default. It binds the app, ticket, actor, reason, prior durable allowance, new allowance, and parked label in a crash-recoverable record. It refuses a terminal episode before making changes; create a new ticket for further work. Non-interactive execution requires every field plus exact --confirm; changing only the GitHub label does not raise the durable allowance.`,
  doctor: `Usage: cormidia doctor [--json] [--config-only]${HOME_HELP}\n\nEvery check is read-only. The managed-clone check reads each registered app's org-managed working tree under <state-home>/repos/ with local git only: no fetch, no index refresh, no cleanup. Uncommitted work is reported as a WARN naming the branch and the changed paths — never removed, and never a FAIL. A turn stopped at its per-turn budget cap can leave real work there, and the next managed turn would otherwise inherit it silently.`,
  scheduler: `Usage:\n  cormidia scheduler install [--backend launchd|systemd] [--cadence-minutes N] [--json]\n  cormidia scheduler install [--backend launchd|systemd] --execute --confirm <exact-org-or-scheduler-id> [--json]\n  cormidia scheduler status [--backend launchd|systemd] [--json]\n  cormidia scheduler uninstall [--backend launchd|systemd] [--json]\n  cormidia scheduler uninstall [--backend launchd|systemd] --execute --confirm <exact-org-or-scheduler-id> [--json]${HOME_HELP}\n\nInstall and uninstall preview without scheduler/manager writes; the command audit row is still recorded. Definitions use absolute executable, org, and state paths and are scoped to the exact org. systemd rendering is future-compatible but host execution remains unsupported until exercised.`,
  approvals: `Usage: cormidia approvals [list|review [--batch]|show <id>|status|revoke <grant-id>|disposition <id> (--executed|--failed|--retry) --reason <text> --confirm <id>] [--state-home <path>] [--now <ISO-time>] [--json]${HOME_HELP}\n\n--json is available for list, show, status, revoke, and disposition; interactive review remains text-only. The default list shows both pending decisions and approved executions that still need acknowledgement. review decisions: "a" approves single-use (default); "a ticket [path]" / "a app [path]" mint a rule+path-scoped multi-use grant (TTL 24h, 20 uses; never for self-merge/deploy/external-publication/protocol/scorecard/approval-store rules). Approved and denied ticketed decisions durably prepare the exact content-bound continuation and repair op:blocked -> op:ready for the next loop tick. --batch groups same-rule/app items into one decision with per-item audit. A failed or ambiguous durable action requires an exact, reasoned disposition before retry.`,
  budget: `Usage: cormidia budget [--apps <apps.yaml-path>] [--reconcile] [--json]${HOME_HELP}\n\n--reconcile terminalizes stale provider receipts, settles missing terminal provider steps, and back-fills legacy runs/**/envelope.json evidence. Current rows are idempotent by app+provider_turn_id; legacy rows fall back to app+run_id.`,
  status: `Usage: cormidia status [--app <app-name>] [--limit N] [--json]${HOME_HELP}`,
  analyze: `Usage: cormidia analyze [--app <app-name>] [--json]${HOME_HELP}`,
  telemetry: `Usage: cormidia telemetry [--app <app-name>] [--date YYYY-MM-DD] [--json] [--html <path>]${HOME_HELP}\n\nHistorical view over runs/**/envelope.json: per-ticket trace blocks, role/model/ticket cost totals, and still-running passes. --html writes a self-contained static report (Gantt + pass table + cost attribution).`,
  report: `Usage: cormidia report [--app <app-name>] [--period 7d|30d|90d|1y|all] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--bucket auto|day|week|month] [--json] [--html <path>] [--open] [--summary-only]${HOME_HELP}\n\nDeterministic, token-free, ledger-first management report. The default is the trailing 90 UTC calendar days. JSON and portable HTML are exhaustive unless --summary-only is explicit. --html writes only the selected target; report generation never reconciles or mutates Cormidia state.`,
  narrative: `Usage: cormidia narrative [--app <app-name>] [--episode <episode-id>] [--json]${HOME_HELP}\n\nDeterministic, token-free human-level causal timeline (docs/narrative/design.md). Folds durable run/journal/ledger/publication records into one markdown story per episode plus a per-app INDEX.md under the state home's narrative/ subtree. Quotes are captured at render time and survive retention sweeps of their sources; re-renders merge, never lose. Domain writes stay under narrative/; --episode writes no narrative artifact and only records the command audit row.`,
  observe: `Usage: cormidia observe [--app <app-name>] [--parent-task <id>] [--ticket <number>] [--port <number>] [--open|--no-open]${HOME_HELP}\n\nStarts a foreground, loopback-only read-only observer serving Live at / and Reports at /reports. HTTP provides versioned snapshots, reports, exports, and deliberate local artifact access; SSE updates Live only. The per-process capability URL is printed once. The observer performs no provider turn, spends no tokens, exposes no workflow mutation endpoint, and stopping it never affects a Cormidia run.`,
  task: `Usage:\n  cormidia task begin --id <id> --prompt-file <path> [--app <app>] [--workdir <path>] [--harness codex|claude|pi] [--native-task-id <id>] [--required-stages planner,builder,reviewer]\n  cormidia task fallback --id <id> --reason <text> [--actor <name>] [--external-only]\n  cormidia task finish --id <id> --status completed|failed|cancelled|timed_out [--result <text>] [--ticket <ref>] [--trace <id>] [--branch <ref>] [--pr <ref>] [--review <ref>] [--deployment <ref>] [--implementation complete|incomplete|unknown] [--ci green|red|pending|unknown] [--cormidia-review approved|changes_requested|awaiting|bypassed|not_required|unknown] [--human-review approved|awaiting|not_required|unknown] [--pr-state open|merged|closed|abandoned|none|unknown] [--issue-closes-on-merge <ref>]\n  cormidia task show --id <id> [--json|--prompt]${HOME_HELP}\n\nBegin once from the exact outer harness prompt, export CORMIDIA_PARENT_TASK_ID for child Cormidia commands, record every manual/external fallback, then finish at the delegated outcome boundary.`,
  dispatch: `Usage: cormidia dispatch [--dry-run] [--apps <path>] [--roles <path>]${HOME_HELP}`,
  episode: `Usage: cormidia episode explain <episode-id> [--json]${HOME_HELP}\n\nRead-only explanation of the durable intent, accepted plan, derived route, execution journal, and exact harness/model/effort assignment and selection rationale for every provider step. This command constructs no runtime and writes only the command audit row.\n\nThe explainer never hard-fails. It prints the exact evidence directory it read, renders every artifact that exists, and annotates anything it could not resolve instead of suppressing the report: an episode with only a route record still explains its route and durable execution steps. A provider step that already completed under an earlier plan version reports assignment authorized_at_prior_plan_version, because a plan revision deliberately does not re-authorize an already-paid turn. Exit is non-zero whenever the explanation is incomplete, and --json emits the same explanation, including its problems[] list, as one document.`,
  "prune-runs": `Usage: cormidia prune-runs [state-home-path] [--retention-days N | --sweep]${HOME_HELP}\n\n--sweep runs the org-wide state retention sweep (docs/scheduler/design.md → State retention) across runs/, telemetry/, efficiency/episodes/, invocations/, tasks/, learning/events/, and scheduler/evidence/ with the documented fail-safe windows — the same sweep the scheduler's dispatch tick runs once per UTC day. The ledger sweep never deletes rows still inside the reconciliation window.`,
  retro: `Usage: cormidia retro [--date YYYY-MM-DD] [--apps <path>] [--roles <path>]${HOME_HELP}`,
  learn: `Usage:\n  cormidia learn inspect <episode-id>     full episode record: turns, gates, outcome,\n                                        approvals, artifacts, replay capsule\n  cormidia learn emit [--episode <id>] [--app <name>] [--observation <text>]\n                    [--cause <text>] [--intervention <text>] [--artifact <ref>]...\n                    [--file <json>]  record a human observation (interactive in a terminal)\n  cormidia learn emit --late-outcome <kind> --ref <ref> --episode <id> [--note <text>]\n                    record an append-only late outcome against a closed episode\n  cormidia learn show <event|candidate|experiment|eval|intervention-id>\n                                        trace an id to its disposition\n  cormidia learn report [--json]          capture totals, episodes, experiments,\n                                        scheduled runs, compaction, reviews, activation\n  cormidia learn distill [--app <app>] [--dry-run]\n                    deterministic precheck; actionable live windows run the\n                    governed distiller pipeline and spend learning-budgeted tokens\n  cormidia learn fixture <episode-id> --set <scope>/<set> [--validate] --by <name>\n                    convert a closed episode's replay capsule into a sanitized\n                    eval fixture (draft until independently --validate'd)\n  cormidia learn review <candidate-id> --verdict approve|revise|reject|escalate\n                    --rationale <text> --by <name> [--destination <d>] [--tier <T>]\n                    [--scope <s>] [--rubric k=v,...] [--injection clean|suspicious|flagged]\n                    [--file <verdict.json>]  record a fail-closed reviewer verdict\n  cormidia learn publish <candidate-id> [--waiver <text>] [--repo <owner/repo>]\n                    route a reviewed candidate: routine destinations publish\n                    (deduped, rate-capped); activation/T2/T3 raise a\n                    content-bound approval, then publish on re-run\n  cormidia learn resolve --app <app> --role <role> [--task <text>]\n                    dry-run the governed-concept resolver for one turn\n  cormidia learn disable <concept-id>     deprecate an active concept immediately\n  cormidia learn rollback --root org|app [--app <name>]\n                    revert the latest bundle version cut\n  cormidia learn provisional --scope <s> --name <n> --description <d>\n                    --ttl-days N --by <name> (--body <text>|--file <md>)\n                    quarantine an UNVERIFIED provisional (urgent human lane)\n  cormidia learn experiment declare --candidate <id> --evals <scope>/<set>\n                    --hypothesis <text> [--app <name>] [--metric <m>] [--repetitions N]\n                    [--guardrail metric:rule[:pct]]...  declare arms before results\n  cormidia learn experiment run <experiment-id> [--by <name>] [--app <name>]\n                    [--repo-dir <path>]  the offline evaluation funnel: prechecks,\n                    targeted paired eval, full paired replay (spends model tokens)\n  cormidia learn experiment list          declarations, verdicts, ledger cost\n  cormidia learn canary start <intervention-id> [--app <name>]\n                    begin the tier-gated, episode-sticky live trial\n  cormidia learn canary status            assignments + outcomes by lineage +\n                                        promote-rule recommendation\n  cormidia learn canary promote --root org|app [--app <name>]   advance stable\n  cormidia learn canary stop --root org|app --reason <text>     roll the trial back${HOME_HELP}\n\nLearning loop M1-M6: capture, episodes, experiments, governed activation,\noffline evaluation, human-started canary, scheduled distillation, independent\nreview, and report-only compaction. Every activation is human-approved and\ncontent-bound; review fails closed; nothing self-activates; a T3 live canary\nis unrepresentable in policy.`,
  "run-role": `Usage: cormidia run-role <role-name> --app <app-name> --turn <invocation-id> --template <path> [--assignment <candidate-id>@<effort>] [--allow-network] [--dry-run] [--parent-task <id>]${HOME_HELP}\n\nA fresh standalone manual turn requires the app, an invocation identity, and a non-empty bounded template in both preview and live modes. --turn is trace/session identity only: it is not a GitHub ticket number and does not bind a ticket. A durable resume may reuse its already-persisted creator scope without rereading a mutable template; scheduled/event dispatch routes use their governed pipeline scope and reject standalone template or assignment overrides.\n\nFixed assignment mode resolves the role's configured atomic tuple and rejects --assignment. Adaptive mode requires one exact approved --assignment <candidate-id>@<effort> in both preview and live modes; no tuple member is inferred or substituted. Network access is denied by default; --allow-network is recorded in the creator scope. --workdir is not supported: preview reads a discovered registered checkout, while live execution synchronizes the org-managed app clone and isolates an explicit standalone turn in its durable per-turn worktree. Dry-run follows the same read-only template, assignment, app, role, journal, and creator-scope validation, then reports zero provider/runtime turns and no workflow-state writes beyond the command audit row. It does not prove provider authentication/readiness, live budget or approval outcomes, managed-clone synchronization, or external state that can change after preview.`,
  context: `Usage: cormidia context [--json]${HOME_HELP}`,
  capabilities: "Usage: cormidia capabilities [--json]",
} as const;

const LEARN_HELP = HELP.learn.replace(
  "cormidia learn report [--json]          capture totals, episodes, experiments,\n" +
    "                                        scheduled runs, compaction, reviews, activation",
  "cormidia learn report [--efficiency-health] [--json] [--refresh]\n" +
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
  // `publish` is a subcommand rather than a flag: it is a different operation
  // with outward-facing effects, and `cormidia bootstrap --publish` would read
  // as a modifier on a scan/emit run (#61).
  bootstrap: {
    run: (args) =>
      args[0] === "publish" ? cmdBootstrapPublish(args.slice(1)) : cmdBootstrap(args),
    help: HELP.bootstrap,
  },
  budget: { run: (args) => cmdBudget(args), help: HELP.budget },
  capabilities: { run: (args) => cmdCapabilities(args), help: HELP.capabilities },
  context: { run: (args) => cmdContext(args), help: HELP.context },
  dispatch: { run: (args) => cmdDispatch(args), help: HELP.dispatch },
  episode: { run: (args) => cmdEpisode(args), help: HELP.episode },
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
  narrative: { run: (args) => cmdNarrative(args), help: HELP.narrative },
  observe: { run: (args) => cmdObserve(args), help: HELP.observe },
  task: { run: (args) => cmdTask(args), help: HELP.task },
};

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const [cmd, ...rest] = argv;
  // Help/version/no-command do not dispatch a command and may not have an org
  // state home. Their explicit no-audit policy is documented with the ledger.
  if (cmd === undefined || cmd === "--help" || cmd === "-h") {
    console.log(USAGE);
    return 0;
  }
  if (cmd === "--version" || cmd === "-v") {
    console.log(await packageVersion());
    return 0;
  }
  const command = COMMANDS[cmd];
  if (command !== undefined && (rest.includes("--help") || rest.includes("-h"))) {
    console.log(command.help);
    return 0;
  }

  try {
    return await runAuditedCliInvocation(argv, async () => {
      try {
        if (!command) {
          const message = `cormidia: unknown command "${cmd}"`;
          reportCliInvocation({ outcome: `failed: ${message}` });
          console.error(message);
          console.error("Run cormidia --help to see the available commands.");
          return 1;
        }
        return rest.includes("--json")
          ? await runJsonCliCommand(cmd, () => command.run(rest))
          : await command.run(rest);
      } catch (error) {
        reportCliInvocationFailure(error);
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
      }
    });
  } catch (e) {
    // Audit setup itself failed before command dispatch, so no mutation ran.
    if (rest.includes("--json")) console.log(JSON.stringify(jsonCliFailure(e, cmd), null, 2));
    else console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

process.exitCode = await main();
