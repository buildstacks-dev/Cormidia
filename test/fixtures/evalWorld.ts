import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { buildAppRepoAt, buildOrgHomeAt, type AppRepoFixture, type OrgHomeFixture } from "./orgHome.js";
import { makeBareWithCloneAt, type BareCloneFixture } from "./gitRepo.js";
import { FakeClock } from "./fakeClock.js";

export interface EvalWorldOptions {
  campaignId?: string;
  operonExecutable?: string;
  expectedExecutableSha256?: string;
  forbiddenProductionPaths?: string[];
}

export interface EvalWorld {
  root: string;
  paths: {
    home: string;
    package: string;
    org: string;
    state: string;
    remotes: string;
    apps: { sparse: string; library: string; service: string };
    managed: string;
    verifier: string;
    artifacts: string;
    providerScratch: string;
    neutralCwd: string;
    executableEvidence: string;
  };
  org: OrgHomeFixture;
  apps: Record<"sparse" | "library" | "service", AppRepoFixture>;
  remote: BareCloneFixture;
  clock: FakeClock;
  env: NodeJS.ProcessEnv;
  executable: { path: string; realpath: string; sha256: string } | null;
  assertSeparated(paths?: string[]): void;
  assertNoHiddenMarker(marker: string, actorReadablePaths?: string[]): void;
  constructProvider(): never;
  run(args: string[], cwd?: string): string;
  cleanup(): void;
}

export function makeEvalWorld(options: EvalWorldOptions = {}): EvalWorld {
  const campaignId = options.campaignId ?? "self-test";
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(campaignId)) throw new Error("invalid_eval_campaign_id");
  const root = mkdtempSync(join(tmpdir(), `operon-eval-${campaignId}-`));
  const paths = {
    home: join(root, "home"), package: join(root, "package"), org: join(root, "org"), state: join(root, "state"),
    remotes: join(root, "remotes"),
    apps: { sparse: join(root, "apps", "sparse"), library: join(root, "apps", "library"), service: join(root, "apps", "service") },
    managed: join(root, "managed"), verifier: join(root, "verifier"), artifacts: join(root, "artifacts"),
    providerScratch: join(root, "provider-scratch"), neutralCwd: join(root, "neutral-cwd"),
    executableEvidence: join(root, "artifacts", "executable.json"),
  };
  for (const path of [paths.home, paths.package, paths.org, paths.state, paths.remotes, ...Object.values(paths.apps), paths.managed, paths.verifier, paths.artifacts, paths.providerScratch, paths.neutralCwd]) mkdirSync(path, { recursive: true });
  const org = buildOrgHomeAt(paths.org, { taste: true, state: true, approvals: true, runs: true });
  const apps = {
    sparse: buildAppRepoAt(paths.apps.sparse, { config: true }),
    library: buildAppRepoAt(paths.apps.library, { config: true }),
    service: buildAppRepoAt(paths.apps.service, { config: true }),
  };
  const remote = makeBareWithCloneAt(join(paths.remotes, "local"));
  const clock = new FakeClock("2026-07-12T00:00:00.000Z");
  const executable = inspectExecutable(options.operonExecutable, options.expectedExecutableSha256);
  if (executable) {
    const evidence = `${JSON.stringify(executable, null, 2)}\n`;
    writeFileSync(paths.executableEvidence, evidence, "utf8");
    writeFileSync(join(paths.package, "identity.json"), evidence, "utf8");
  }
  const env: NodeJS.ProcessEnv = {
    HOME: paths.home,
    OPERON_ORG_HOME: paths.org,
    OPERON_STATE_HOME: paths.state,
    CODEX_HOME: join(paths.providerScratch, "codex"),
    CLAUDE_CONFIG_DIR: join(paths.providerScratch, "claude"),
    PI_CODING_AGENT_DIR: join(paths.providerScratch, "pi"),
    PATH: process.env.PATH ?? "",
    OPERON_EVAL_ROOT: root,
    OPERON_EVAL_CAMPAIGN_ID: campaignId,
    OPERON_EVAL_PROVIDER_MODE: "tripwire",
  };
  const forbidden = options.forbiddenProductionPaths ?? [];
  const assertSeparated = (additional: string[] = []) => {
    for (const path of [...forbidden, ...additional]) {
      if (overlaps(root, path)) throw new Error(`production_path_leakage: ${basename(path) || "path"}`);
    }
    for (const [name, value] of Object.entries({ HOME: env.HOME, OPERON_ORG_HOME: env.OPERON_ORG_HOME, OPERON_STATE_HOME: env.OPERON_STATE_HOME, CODEX_HOME: env.CODEX_HOME, CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR, PI_CODING_AGENT_DIR: env.PI_CODING_AGENT_DIR })) {
      if (!value || !inside(root, value)) throw new Error(`production_path_leakage: ${name}`);
    }
  };
  assertSeparated();
  return {
    root, paths, org, apps, remote, clock, env, executable,
    assertSeparated,
    assertNoHiddenMarker: (marker, actorReadablePaths = [paths.org, paths.state, ...Object.values(paths.apps), paths.managed, paths.neutralCwd]) => {
      for (const path of actorReadablePaths) {
        if (!inside(root, path) || inside(paths.verifier, path)) throw new Error("invalid_actor_read_root");
        scanText(path, marker);
      }
    },
    constructProvider: () => { throw new Error("undeclared_provider_call"); },
    run: (args, cwd = paths.neutralCwd) => {
      if (!executable) throw new Error("eval_executable_not_configured");
      if (!inside(root, cwd)) throw new Error("production_path_leakage: subprocess cwd");
      return execFileSync(executable.path, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function inspectExecutable(path: string | undefined, expected: string | undefined): EvalWorld["executable"] {
  if (!path) return null;
  const realpath = realpathSync(path);
  const sha256 = createHash("sha256").update(readFileSync(realpath)).digest("hex");
  if (expected && sha256 !== expected) throw new Error("wrong_eval_executable");
  return { path: resolve(path), realpath, sha256 };
}
function inside(root: string, path: string): boolean { const rel = relative(resolve(root), resolve(path)); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)); }
function overlaps(a: string, b: string): boolean { return inside(a, b) || inside(b, a); }
function scanText(path: string, marker: string): void {
  const output = execFileSync("find", [path, "-type", "f", "-maxdepth", "12", "-print0"]);
  for (const name of output.toString().split("\0").filter(Boolean)) {
    const body = readFileSync(name);
    if (body.includes(Buffer.from(marker))) throw new Error(`hidden_answer_leakage: ${relative(path, name)}`);
  }
}
