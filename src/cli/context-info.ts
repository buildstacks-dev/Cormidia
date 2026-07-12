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
  { command: "org init", writes: true, spendsTokens: false, summary: "create and select an org home with a versioned authority charter" },
  { command: "org show", writes: false, spendsTokens: false, summary: "show resolved package, org, and state homes" },
  { command: "org use", writes: true, spendsTokens: false, summary: "select an existing complete org home" },
  { command: "roles", writes: false, spendsTokens: false, summary: "validate and list the active org's roles" },
  { command: "apps", writes: false, spendsTokens: false, summary: "validate and list registered apps" },
  { command: "app reset", writes: true, spendsTokens: false, summary: "archive and remove one app's Operon-managed state and tracked GitHub work after explicit confirmation" },
  { command: "pipelines", writes: false, spendsTokens: false, summary: "validate and list pass pipelines" },
  { command: "bootstrap", writes: true, spendsTokens: false, summary: "onboard an existing local app repo" },
  { command: "new-app", writes: true, spendsTokens: false, summary: "create and onboard a greenfield app repo" },
  { command: "plan", writes: true, spendsTokens: true, summary: "run a Planner co-planning session; --dry-run is token-free" },
  { command: "loop", writes: true, spendsTokens: true, summary: "advance ready GitHub tickets; --dry-run is token-free" },
  { command: "dispatch", writes: true, spendsTokens: true, summary: "run one scheduler tick; --dry-run is token-free" },
  { command: "run-role", writes: true, spendsTokens: true, summary: "run one role turn; --dry-run is token-free" },
  { command: "approvals", writes: true, spendsTokens: false, summary: "inspect or decide durable critical-operation requests" },
  { command: "budget", writes: false, spendsTokens: false, summary: "summarize monthly spend and budget pauses" },
  { command: "status", writes: false, spendsTokens: false, summary: "show recent run status" },
  { command: "analyze", writes: false, spendsTokens: false, summary: "report run anomaly signals" },
  { command: "telemetry", writes: false, spendsTokens: false, summary: "historical pass/trace/cost view over run records" },
  { command: "task", writes: true, spendsTokens: false, summary: "record the broader delegated task, fallback, and terminal outcome" },
  { command: "retro", writes: true, spendsTokens: false, summary: "write an evidence-based org retro" },
  { command: "learn", writes: true, spendsTokens: true, summary: "learning loop: inspect/show/report are read-only; emit/review/publish/resolve/canary are the human operator's governed-activation window; only `learn experiment run` spends tokens (paired replay)" },
  { command: "prune-runs", writes: true, spendsTokens: false, summary: "delete finalized run data beyond retention" },
  { command: "doctor", writes: false, spendsTokens: false, summary: "validate installation and active org configuration" },
  { command: "context", writes: false, spendsTokens: false, summary: "show resolved paths, authority provenance, and registered apps" },
] as const;

export async function cmdCapabilities(args: string[]): Promise<number> {
  const json = consumeJsonOnly(args, "capabilities");
  const data = { version: await packageVersion(), commands: CAPABILITIES };
  if (json) console.log(JSON.stringify(data, null, 2));
  else {
    console.log(`Operon ${data.version} capabilities:`);
    for (const row of data.commands) {
      const risk = row.spendsTokens ? "live/token-spending" : row.writes ? "local write" : "read-only";
      console.log(`  ${row.command.padEnd(12)} ${risk.padEnd(20)} ${row.summary}`);
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
