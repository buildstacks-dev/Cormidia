// Tests the top-level CLI dispatch table through the real src/cli.ts entrypoint.
// Covers help/unknown-command behavior and smoke checks for roles, apps,
// pipelines, bootstrap, new-app dry runs, doctor, and loop argument validation.
// Uses subprocesses and temp dirs with local repo files; no network, auth, real
// org state, or wall-clock dependence is expected.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initOrgHome } from "../src/org/home.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");
const TEST_ROOT = mkdtempSync(join(tmpdir(), "operon-installed-cli-"));
const NEUTRAL_CWD = join(TEST_ROOT, "neutral");
const ORG_HOME = join(TEST_ROOT, "org");
const STATE_HOME = join(TEST_ROOT, "state");
const USER_HOME = join(TEST_ROOT, "home");

beforeAll(async () => {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(NEUTRAL_CWD, { recursive: true }));
  await initOrgHome({ target: ORG_HOME, name: "cli-test", stateHome: STATE_HOME, homeDir: USER_HOME });
});

afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }));

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", TSX_LOADER, CLI_PATH, ...args],
      {
        cwd: NEUTRAL_CWD,
        env: {
          ...process.env,
          OPERON_ORG_HOME: ORG_HOME,
          OPERON_STATE_HOME: STATE_HOME,
          HOME: USER_HOME,
        },
      },
    );
    return { stdout, stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.code ?? 1 };
  }
}

describe("cli dispatch", () => {
  it("unknown command prints an error to stderr and exits 1", async () => {
    const { stdout, stderr, code } = await runCli(["bogus-command"]);
    expect(code).toBe(1);
    expect(stderr).toContain('unknown command "bogus-command"');
    // Diagnostics belong on stderr — the USAGE banner must not be dumped to stdout.
    expect(stdout).not.toContain("Usage:");
  });

  it("no command prints usage to stdout and exits 0", async () => {
    const { stdout, code } = await runCli([]);
    expect(stdout).toContain("Usage:");
    expect(code).toBe(0);
  });

  it("--help prints usage to stdout and exits 0", async () => {
    const { stdout, code } = await runCli(["--help"]);
    expect(stdout).toContain("Usage:");
    expect(code).toBe(0);
  });

  it("roles subcommand still validates roles.yaml", async () => {
    const { stdout, code } = await runCli(["roles"]);
    expect(code).toBe(0);
    expect(stdout).toContain("roles.yaml: OK");
  });

  it("apps subcommand validates the active org from a neutral cwd", async () => {
    const { stdout, code } = await runCli(["apps"]);
    expect(code).toBe(0);
    expect(stdout).toContain("apps.yaml: OK");
    expect(stdout).toMatch(/APP\s+REPO\s+STATUS\s+BUDGET/);
  });

  it("app reset help is available from the top-level dispatch table", async () => {
    const { stdout, code } = await runCli(["app", "--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("operon app reset <app-name>");
    expect(stdout).toContain("--execute --confirm <app-name>");
    expect(stdout).toContain("--force");
  });

  it("observe is discoverable as read-only and token-free", async () => {
    const help = await runCli(["observe", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("loopback-only read-only observer");
    expect(help.stdout).toContain("no workflow mutation endpoint");

    const capabilities = await runCli(["capabilities", "--json"]);
    expect(capabilities.code).toBe(0);
    const parsed = JSON.parse(capabilities.stdout) as { commands: Array<Record<string, unknown>> };
    expect(parsed.commands).toContainEqual(expect.objectContaining({
      command: "observe",
      writes: false,
      spendsTokens: false,
    }));
  });

  it("report is discoverable as a token-free ledger report", async () => {
    const help = await runCli(["report", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("trailing 90 UTC calendar days");
    expect(help.stdout).toContain("never reconciles or mutates Operon state");

    const capabilities = await runCli(["capabilities", "--json"]);
    const parsed = JSON.parse(capabilities.stdout) as { commands: Array<Record<string, unknown>> };
    expect(parsed.commands).toContainEqual(expect.objectContaining({ command: "report", writes: false, spendsTokens: false }));
  });

  it("pipelines subcommand validates the root pipelines.yaml", async () => {
    const { stdout, code } = await runCli(["pipelines"]);
    expect(code).toBe(0);
    expect(stdout).toContain("pipelines.yaml: OK");
  });

  it("bootstrap --scan-only reports without writing", async () => {
    const target = mkdtempSync(join(tmpdir(), "operon-cli-bootstrap-"));
    try {
      const { stdout, code } = await runCli(["bootstrap", "--scan-only", target]);
      expect(code).toBe(0);
      expect(stdout).toContain("bootstrap scan:");
      expect(stdout).toContain("would create:");
      expect(existsSync(join(target, ".operon"))).toBe(false);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("new-app --dry-run reports a greenfield scaffold without writing", async () => {
    const parent = mkdtempSync(join(tmpdir(), "operon-cli-new-app-parent-"));
    const target = join(parent, "marketplace");
    try {
      const { stdout, code } = await runCli([
        "new-app",
        "marketplace",
        "--target-dir",
        target,
        "--repo",
        "owner/marketplace",
        "--org-home",
        ORG_HOME,
        "--dry-run",
      ]);
      expect(code).toBe(0);
      expect(stdout).toContain("would create greenfield app: marketplace");
      expect(stdout).toContain(".operon/bootstrap/initial-issue.md");
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("doctor resolves the active org from a neutral cwd", async () => {
    const { stdout, code } = await runCli(["doctor", "--config-only"]);
    expect(code).toBe(0);
    expect(stdout).toContain("runtime adapters:");
    expect(stdout).toContain(ORG_HOME);
  });

  it("loop requires an app name", async () => {
    const { stderr, code } = await runCli(["loop"]);
    expect(code).toBe(1);
    expect(stderr).toContain("--app <app> is required");
  });

  it("dispatch --dry-run appends an invocation ledger row like loop does", async () => {
    const { stdout, code } = await runCli(["dispatch", "--dry-run"]);
    expect(code).toBe(0);
    expect(stdout).toContain("dispatch: spawned=");

    const day = new Date().toISOString().slice(0, 10);
    const ledger = join(STATE_HOME, "invocations", `${day}.jsonl`);
    expect(existsSync(ledger)).toBe(true);
    const rows = (await import("node:fs/promises").then(({ readFile }) => readFile(ledger, "utf8")))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const dispatchRows = rows.filter((row) => row["kind"] === "dispatch");
    expect(dispatchRows.length).toBeGreaterThan(0);
    expect(dispatchRows.at(-1)).toMatchObject({ kind: "dispatch", dryRun: true });
    expect(typeof dispatchRows.at(-1)?.["wallClockMs"]).toBe("number");
    expect(typeof dispatchRows.at(-1)?.["outcome"]).toBe("string");
  });
});
