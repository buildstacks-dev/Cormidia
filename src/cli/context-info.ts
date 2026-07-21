import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ORG_HOME_DEFINITION,
  PACKAGE_ROOT,
  resolveOperonHomes,
  STATE_HOME_DEFINITION,
} from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";
import { authorityEvidence, resolveAuthority } from "../org/authority.js";

export async function cmdContext(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "context");
  const json = consumeJsonOnly(common.rest, "context");
  const homes = await resolveOperonHomes(common);
  const authority = await resolveAuthority({ orgHome: homes.orgHome });
  const data = {
    version: await packageVersion(),
    packageRoot: homes.packageRoot,
    org: homes.appsFile.org.name,
    orgHome: homes.orgHome,
    orgHomeMeaning: ORG_HOME_DEFINITION,
    stateHome: homes.stateHome,
    stateHomeMeaning: STATE_HOME_DEFINITION,
    pointerPath: homes.pointerPath,
    appsPath: join(homes.orgHome, "apps.yaml"),
    rolesPath: join(homes.orgHome, "roles.yaml"),
    pipelinesPath: join(homes.orgHome, "pipelines.yaml"),
    promptsPath: join(homes.orgHome, "prompts"),
    authority: authorityEvidence(authority),
    apps: homes.appsFile.apps.map((app) => ({ name: app.name, repo: app.repo, status: app.status })),
  };
  if (json) console.log(JSON.stringify(data, null, 2));
  else {
    console.log(`Operon ${data.version}`);
    console.log(`Package:    ${data.packageRoot}`);
    console.log(`Org home:   ${data.orgHome} — ${ORG_HOME_DEFINITION}.`);
    console.log(`State home: ${data.stateHome} — ${STATE_HOME_DEFINITION}.`);
    console.log(`Authority:  ${data.authority.version} (sha256:${data.authority.sha256})`);
    console.log(`Apps:       ${data.apps.length}`);
  }
  return 0;
}

const CAPABILITIES = [
  { command: "org init", writes: true, spendsTokens: false, summary: "preview with --dry-run or safely create/populate and select an org home" },
  { command: "org show", writes: false, spendsTokens: false, summary: "show resolved package, org, and state homes" },
  { command: "org use", writes: true, spendsTokens: false, summary: "select an existing complete org home" },
  { command: "org list", writes: false, spendsTokens: false, summary: "enumerate every discoverable org home, state home, footprint, app count, and last activity" },
  { command: "org archive", writes: true, spendsTokens: false, summary: "preview or archive-then-remove one org's local state after explicit confirmation; never touches the org home or GitHub" },
  { command: "org upgrade", writes: true, spendsTokens: false, summary: "preview/apply an additive archived org migration with post-upgrade doctor" },
  { command: "roles", writes: false, spendsTokens: false, summary: "validate and list the active org's roles" },
  { command: "roles set", writes: true, spendsTokens: false, summary: "preview a role's harness/model/effort/turn-budget change; --execute is journaled and requires an attributable --by identity" },
  { command: "apps", writes: false, spendsTokens: false, summary: "validate and list registered apps" },
  { command: "app reset", writes: true, spendsTokens: false, summary: "archive and remove one app's Operon-managed state and tracked GitHub work after explicit confirmation" },
  { command: "app verify", writes: true, spendsTokens: false, summary: "verify and converge lifecycle readiness without constructing a provider runtime" },
  { command: "app promote", writes: true, spendsTokens: false, summary: "preview/apply journaled verified promotion to live" },
  { command: "pipelines", writes: false, spendsTokens: false, summary: "validate and list pass pipelines" },
  { command: "bootstrap", writes: true, spendsTokens: false, summary: "onboard an existing local app repo" },
  { command: "new-app", writes: true, spendsTokens: false, summary: "create and onboard a greenfield app repo" },
  { command: "plan", writes: true, spendsTokens: true, summary: "run plan-aware work with --auto or an explicit --creator-scope/--execution-ready bypass; --dry-run is token-free and reports the stage ticket budget" },
  { command: "plan ratify-ticket-budget", writes: true, spendsTokens: false, summary: "record an attributable human decision to admit one preserved oversized decomposition and publish it token-free; preview by default, exact --confirm to execute" },
  { command: "loop", writes: true, spendsTokens: true, summary: "advance ready GitHub tickets; --dry-run is token-free" },
  { command: "dispatch", writes: true, spendsTokens: true, summary: "run one scheduler tick; --dry-run is token-free" },
  { command: "episode explain", writes: false, spendsTokens: false, summary: "explain a durable EpisodePlan, execution status, and each exact harness/model/effort assignment; degrades and exits non-zero rather than suppressing the report" },
  { command: "scheduler", writes: true, spendsTokens: false, summary: "preview/install/status/uninstall the exact org-scoped host scheduler; status is read-only" },
  { command: "run-role", writes: true, spendsTokens: true, summary: "run one role turn; --dry-run is token-free; network is denied unless --allow-network" },
  { command: "approvals", writes: true, spendsTokens: false, summary: "inspect or decide durable critical-operation requests" },
  { command: "budget", writes: false, spendsTokens: false, summary: "summarize monthly spend and budget pauses" },
  { command: "status", writes: false, spendsTokens: false, summary: "show recent run status" },
  { command: "analyze", writes: false, spendsTokens: false, summary: "report run anomaly signals" },
  { command: "telemetry", writes: false, spendsTokens: false, summary: "historical pass/trace/cost view over run records" },
  { command: "report", writes: false, spendsTokens: false, summary: "ledger-first org/app usage report; --html writes only the user-selected export" },
  { command: "narrative", writes: true, spendsTokens: false, summary: "render the human-level causal timeline (one markdown story per episode + per-app INDEX.md); writes only under the state home's narrative/; --episode prints without writing" },
  { command: "observe", writes: false, spendsTokens: false, summary: "loopback-only read-only Live and Reports UI over durable Operon and GitHub state" },
  { command: "task", writes: true, spendsTokens: false, summary: "record the broader delegated task, fallback, and terminal outcome" },
  { command: "retro", writes: true, spendsTokens: false, summary: "write an evidence-based org retro" },
  { command: "learn", writes: true, spendsTokens: true, summary: "learning loop: inspect/show/report and `distill --dry-run` are token-free; experiment run and actionable `distill` windows spend learning-budgeted tokens; governed activation remains human-operated" },
  { command: "prune-runs", writes: true, spendsTokens: false, summary: "delete finalized run data beyond retention" },
  { command: "doctor", writes: false, spendsTokens: false, summary: "validate installation, active org configuration, and managed-clone working trees" },
  { command: "context", writes: false, spendsTokens: false, summary: "show resolved paths, authority provenance, and registered apps" },
] as const;

/** A command is marked true when at least one documented invocation accepts
 * `--json`; compound commands may still have interactive text-only forms. */
const JSON_COMMANDS = new Set<string>([
  "org init", "org show", "org use", "org list", "org archive", "org upgrade",
  "roles", "roles set", "apps", "app reset", "app verify", "app promote", "pipelines",
  "bootstrap", "new-app", "plan", "plan ratify-ticket-budget",
  "episode explain", "scheduler",
  "approvals", "budget", "status", "analyze", "telemetry", "report",
  "narrative", "task", "learn", "doctor", "context",
]);

export async function cmdCapabilities(args: string[]): Promise<number> {
  const json = consumeJsonOnly(args, "capabilities");
  const commands = CAPABILITIES.map((row) => ({
    ...row,
    supportsJson: JSON_COMMANDS.has(row.command),
    auditWrites: true as const,
    writesMeaning: "domain_or_workflow" as const,
  }));
  const data = { version: await packageVersion(), commands };
  if (json) console.log(JSON.stringify(data, null, 2));
  else {
    console.log(`Operon ${data.version} capabilities:`);
    for (const row of data.commands) {
      const risk = row.spendsTokens ? "live/token-spending" : row.writes ? "local write" : "read-only";
      const output = row.supportsJson ? "json" : "text-only";
      console.log(`  ${row.command.padEnd(12)} ${risk.padEnd(20)} ${output.padEnd(10)} ${row.summary}`);
    }
  }
  return 0;
}

export async function packageVersion(): Promise<string> {
  const raw = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version?: unknown };
  return typeof raw.version === "string" ? raw.version : "unknown";
}

function consumeJsonOnly(args: string[], command: string): boolean {
  let json = false;
  for (const arg of args) {
    if (arg === "--json") json = true;
    else throw new Error(`${command}: unknown argument "${arg}"`);
  }
  return json;
}
