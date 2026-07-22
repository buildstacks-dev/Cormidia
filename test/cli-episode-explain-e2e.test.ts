// ISSUE-025 end-to-end: `operon episode explain` over real captured run-3
// evidence, through the real dispatch table, in a subprocess.
//
// This is the level the finding was written at, so it is the level the exit
// code and the JSON contract have to be proven at. The subprocess gets only an
// explicit temporary state home; no active org, provider, network, or host
// runtime state is consulted, and no provider token is spent.

import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { efficiencyEpisodeDir } from "../src/loop/efficiency.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_PATH = join(REPO_ROOT, "src", "cli.ts");
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");
const FIXTURE_DIR = join(REPO_ROOT, "test", "fixtures", "episodes", "run3");

const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), "operon-episode-explain-e2e-"));
const ORG_HOME = join(FIXTURE_ROOT, "org");
const STATE_HOME = join(FIXTURE_ROOT, "state");
const USER_HOME = join(FIXTURE_ROOT, "user-home");
const NEUTRAL_CWD = join(FIXTURE_ROOT, "neutral");

const REPLANNED = "ticket:sonnet4-buildstack-dev:#2";
const ROUTE_ONLY = "lifecycle:sonnet4-buildstack-dev:9b66e5d4560b23acb99f";

beforeAll(() => {
  for (const dir of [ORG_HOME, STATE_HOME, USER_HOME, NEUTRAL_CWD]) {
    mkdirSync(dir, { recursive: true });
  }
  for (const file of ["TASTE.md", "roles.yaml", "apps.yaml", "pipelines.yaml"]) {
    cpSync(join(REPO_ROOT, file), join(ORG_HOME, file));
  }
  cpSync(join(REPO_ROOT, "prompts"), join(ORG_HOME, "prompts"), { recursive: true });
  cpSync(
    join(FIXTURE_DIR, "replanned-ticket-2"),
    efficiencyEpisodeDir(STATE_HOME, REPLANNED),
    { recursive: true },
  );
  cpSync(
    join(FIXTURE_DIR, "route-only-lifecycle"),
    efficiencyEpisodeDir(STATE_HOME, ROUTE_ONLY),
    { recursive: true },
  );
});

afterAll(() => rmSync(FIXTURE_ROOT, { recursive: true, force: true }));

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: USER_HOME };
  delete env.OPERON_ORG_HOME;
  delete env.OPERON_STATE_HOME;
  delete env.OPERON_HOME;
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", TSX_LOADER, CLI_PATH, ...args],
      { cwd: NEUTRAL_CWD, env },
    );
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failed.stdout ?? "", stderr: failed.stderr ?? "", code: failed.code ?? 1 };
  }
}

const homes = ["--org-home", ORG_HOME, "--state-home", STATE_HOME];

describe("operon episode explain end to end", () => {
  it("explains the exact replanned episode that produced ISSUE-025 and exits zero", async () => {
    const result = await runCli(["episode", "explain", REPLANNED, ...homes]);

    expect(result.code, result.stderr).toBe(0);
    // The reported symptom, verbatim, must be gone.
    expect(result.stdout).not.toContain("has 0 matching route authorizations");
    expect(result.stdout).toContain("plan: v2 episode_planner");
    expect(result.stdout).toContain("safety route:");
    expect(result.stdout).toContain("contract: completed provider builder codex/gpt-5.6-sol/high");
    expect(result.stdout).toContain("assignment authorized_at_prior_plan_version");
    expect(result.stdout).toContain("implement: ");
    expect(result.stdout).toContain("verify: ");
    expect(result.stdout).toContain(efficiencyEpisodeDir(STATE_HOME, REPLANNED));
  });

  it("emits one parseable JSON document for the same episode", async () => {
    const result = await runCli(["episode", "explain", REPLANNED, ...homes, "--json"]);

    expect(result.code, result.stderr).toBe(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      schemaVersion: 2,
      episodeId: REPLANNED,
      complete: true,
      problems: [],
    });
    expect(parsed["steps"]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "contract",
        authorizationStatus: "authorized_at_prior_plan_version",
        authorizedPlanVersion: 1,
      }),
    ]));
  });

  it("renders a degraded route-only episode and exits non-zero", async () => {
    const text = await runCli(["episode", "explain", ROUTE_ONLY, ...homes]);

    expect(text.code).toBe(1);
    expect(text.stdout).toContain(`episode: ${ROUTE_ONLY}`);
    expect(text.stdout).toContain("plan: none (no accepted durable EpisodePlan)");
    expect(text.stdout).toContain("route: deterministic terminal completed");
    expect(text.stdout).toContain("durable execution steps (1):");
    expect(text.stdout).toContain("app verify");
    expect(text.stdout).toContain("incomplete explanation (2 unresolved):");

    const json = await runCli(["episode", "explain", ROUTE_ONLY, ...homes, "--json"]);
    expect(json.code).toBe(1);
    const parsed = JSON.parse(json.stdout) as { complete: boolean; problems: { code: string }[] };
    expect(parsed.complete).toBe(false);
    expect(parsed.problems.map((problem) => problem.code).sort())
      .toEqual(["intent_missing", "plan_missing"]);
  });

  it("reports an unknown episode id as JSON rather than an unhandled throw", async () => {
    const result = await runCli([
      "episode",
      "explain",
      "ticket:sonnet4-buildstack-dev:#404",
      ...homes,
      "--json",
    ]);

    expect(result.code).toBe(1);
    const parsed = JSON.parse(result.stdout) as { problems: { code: string }[] };
    expect(parsed.problems).toEqual([
      expect.objectContaining({ code: "episode_evidence_missing" }),
    ]);
  });

  it("keeps the ISSUE-001 no-active-org JSON failure contract", async () => {
    const result = await runCli(["episode", "explain", REPLANNED, "--json"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema_version: 1,
      ok: false,
      error: { code: "no_active_org", remediation: expect.any(String) },
    });
  });

  it("documents --json in help and capability discovery", async () => {
    const help = await runCli(["episode", "--help"]);
    expect(help.code, help.stderr).toBe(0);
    expect(help.stdout).toContain("--json");

    const capabilities = await runCli(["capabilities", "--json"]);
    expect(capabilities.code, capabilities.stderr).toBe(0);
    const parsed = JSON.parse(capabilities.stdout) as {
      commands: Array<{ command: string; supportsJson: boolean }>;
    };
    expect(parsed.commands.find((entry) => entry.command === "episode explain")?.supportsJson)
      .toBe(true);
  });
});
