// Tests the top-level CLI dispatch table through the real src/cli.ts entrypoint.
// Covers help/unknown-command behavior and smoke checks for roles, apps,
// pipelines, bootstrap, new-app dry runs, doctor, and loop argument validation.
// Uses subprocesses and temp dirs with local repo files; no network, auth, real
// org state, or wall-clock dependence is expected.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

async function runCliFrom(
  args: string[],
  cwd: string,
  homeDir: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: homeDir };
  delete env.OPERON_ORG_HOME;
  delete env.OPERON_STATE_HOME;
  delete env.OPERON_HOME;
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", TSX_LOADER, CLI_PATH, ...args],
      { cwd, env },
    );
    return { stdout, stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.code ?? 1 };
  }
}

function invocationRows(stateHome = STATE_HOME): Array<Record<string, unknown>> {
  const day = new Date().toISOString().slice(0, 10);
  const ledger = join(stateHome, "invocations", `${day}.jsonl`);
  if (!existsSync(ledger)) return [];
  return readFileSync(ledger, "utf8").trim().split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("cli dispatch", () => {
  it.each([
    { label: "context", args: ["context", "--json"] },
    { label: "org show", args: ["org", "show", "--json"] },
  ])("$label keeps the JSON contract when no org is active", async ({ args }) => {
    const home = mkdtempSync(join(tmpdir(), "operon-cli-no-active-org-"));
    try {
      const { stdout, stderr, code } = await runCliFrom(args, NEUTRAL_CWD, home);
      expect(code).toBe(1);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        schema_version: 1,
        ok: false,
        error: {
          code: "no_active_org",
          message: "no active org home",
          remediation:
            "Run `operon org init <path> --name <name>` or set OPERON_ORG_HOME to a complete org home.",
        },
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps the existing human diagnostic when no org is active", async () => {
    const home = mkdtempSync(join(tmpdir(), "operon-cli-no-active-org-human-"));
    try {
      const { stdout, stderr, code } = await runCliFrom(["context"], NEUTRAL_CWD, home);
      expect(code).toBe(1);
      expect(stdout).toBe("");
      expect(stderr.trim()).toBe(
        "operon: no active org home — create one with `operon org init <path> --name <name>` " +
          "or select one with OPERON_ORG_HOME",
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("normalizes other thrown JSON-mode failures at the shared boundary", async () => {
    const { stdout, stderr, code } = await runCli(["context", "--json", "--not-a-context-flag"]);
    expect(code).toBe(1);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      schema_version: 1,
      ok: false,
      error: {
        code: "command_failed",
        message: 'context: unknown argument "--not-a-context-flag"',
        remediation: "Run `operon context --help` and correct the invocation or configuration.",
      },
    });
  });

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
    const before = invocationRows().length;
    const { stdout, code } = await runCli(["--help"]);
    expect(stdout).toContain("Usage:");
    expect(code).toBe(0);
    expect(invocationRows()).toHaveLength(before);
  });

  it("command help follows the explicit no-audit policy", async () => {
    const before = invocationRows().length;
    const result = await runCli(["roles", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Audit note:");
    expect(invocationRows()).toHaveLength(before);
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
    expect(stdout).toMatch(/APP\s+REPO\s+STATUS\s+ASSIGNMENT\s+BUDGET/);
  });

  it("app reset help is available from the top-level dispatch table", async () => {
    const { stdout, code } = await runCli(["app", "--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("operon app reset <app-name>");
    expect(stdout).toContain("--execute --confirm <app-name>");
    expect(stdout).toContain("--force");
  });

  it("org init supports the current-directory idiom", async () => {
    const root = mkdtempSync(join(tmpdir(), "operon-cli-dot-init-"));
    const current = join(root, "current");
    const home = join(root, "home");
    try {
      await import("node:fs/promises").then(({ mkdir }) =>
        Promise.all([mkdir(current), mkdir(home)]),
      );
      const { stdout, stderr, code } = await runCliFrom(
        ["org", "init", ".", "--name", "dot-org"],
        current,
        home,
      );
      expect(code, stderr).toBe(0);
      expect(stdout).toContain("Org created and selected: dot-org");
      expect(existsSync(join(current, "roles.yaml"))).toBe(true);
      expect(existsSync(join(home, ".operon", "dot-org"))).toBe(true);
      expect(existsSync(join(home, ".operon", "config"))).toBe(true);
      const initRows = invocationRows(join(home, ".operon", "dot-org"));
      expect(initRows).toHaveLength(1);
      expect(initRows).toContainEqual(
        expect.objectContaining({
          schema_version: 2,
          kind: "cli",
          command: "org",
          subcommand: "init",
          org: "dot-org",
          outcome: "org-created-and-selected",
          exitCode: 0,
          provenance: { authorityProfile: "delegated-operator" },
        }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
      auditWrites: true,
      writesMeaning: "domain_or_workflow",
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

  it("scheduler lifecycle is discoverable as preview-first and token-free", async () => {
    const help = await runCli(["scheduler", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("operon scheduler install");
    expect(help.stdout).toContain("--execute --confirm <exact-org-or-scheduler-id>");
    expect(help.stdout).toContain("preview without scheduler/manager writes");

    const capabilities = await runCli(["capabilities", "--json"]);
    const parsed = JSON.parse(capabilities.stdout) as { commands: Array<Record<string, unknown>> };
    expect(parsed.commands).toContainEqual(expect.objectContaining({ command: "scheduler", writes: true, spendsTokens: false }));
  });

  it("run-role help exposes the bounded parity and managed-workdir contract", async () => {
    const help = await runCli(["run-role", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain(
      "--app <app-name> --turn <invocation-id> --template <path>",
    );
    expect(help.stdout).toContain("it is not a GitHub ticket number and does not bind a ticket");
    expect(help.stdout).toContain("--workdir is not supported");
    expect(help.stdout).toContain("zero provider/runtime turns and no workflow-state writes beyond the command audit row");
    expect(help.stdout).not.toContain("[--workdir <path>]");
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
      expect(stdout).toContain("template: typescript-node");
      expect(stdout).toContain("quality gates: configured");
      expect(stdout).toContain("package.json");
      expect(stdout).toContain(".operon/bootstrap/initial-issue.md");
      expect(existsSync(target)).toBe(false);
      expect(invocationRows()).toContainEqual(expect.objectContaining({
        kind: "cli",
        command: "new-app",
        app: "marketplace",
        dryRun: true,
        outcome: "new-app-preview-ready",
        provenance: { template: "typescript-node" },
      }));
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("new-app help documents explicit templates and the bare fail-closed boundary", async () => {
    const { stdout, code } = await runCli(["new-app", "--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("--template typescript-node|bare");
    expect(stdout).toContain("typescript-node is the backward-compatible default");
    expect(stdout).toContain("free-form goal text never selects one");
    expect(stdout).toContain("fail closed");
    expect(stdout).toContain("Run only its generated stack-and-gates establishment issue through the loop first");
    expect(stdout).toContain("verify and preview promotion only after that issue merges");
    expect(stdout).toContain("--json");
  });

  it("new-app bare JSON dry-run reports exact stack-neutral effects without writing", async () => {
    const parent = mkdtempSync(join(tmpdir(), "operon-cli-new-app-bare-parent-"));
    const target = join(parent, "bare-product");
    try {
      const { stdout, stderr, code } = await runCli([
        "new-app",
        "bare-product",
        "--target-dir",
        target,
        "--repo",
        "owner/bare-product",
        "--goal",
        "Build an Astro site without inferring its stack.",
        "--template",
        "bare",
        "--org-home",
        ORG_HOME,
        "--dry-run",
        "--json",
      ]);
      expect(code, stderr).toBe(0);
      const result = JSON.parse(stdout) as {
        template: string;
        dryRun: boolean;
        created: string[];
        updated: string[];
        stateCreated: string[];
        qualityGates: Record<string, unknown>;
      };
      expect(result).toMatchObject({
        template: "bare",
        dryRun: true,
        qualityGates: {
          status: "pending",
          setupCommand: null,
          testCommand: null,
          lintCommand: null,
        },
      });
      expect(result.qualityGates["detail"]).toContain(
        "Run only the generated stack-and-gates establishment issue through the loop first",
      );
      expect(result.created).toContain("docs/ARCHITECTURE.md");
      expect(result.created).toContain(".operon/bootstrap/initial-issue.md");
      expect(result.created).not.toContain("package.json");
      expect(result.created).not.toContain("src/domain.ts");
      expect(result.updated).toContain(`${ORG_HOME}/apps.yaml`);
      expect(result.stateCreated).toEqual([
        join(STATE_HOME, "lifecycle", "apps", "bare-product", "answers.json"),
        join(STATE_HOME, "lifecycle", "apps", "bare-product", "onboarding-source.json"),
      ]);
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("new-app rejects unknown templates before resolving homes or writing", async () => {
    const target = join(tmpdir(), "operon-cli-new-app-invalid-template");
    const { stderr, code } = await runCli([
      "new-app",
      "invalid-template",
      "--target-dir",
      target,
      "--repo",
      "owner/invalid-template",
      "--template",
      "astro",
      "--dry-run",
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain("--template must be one of typescript-node|bare");
    expect(existsSync(target)).toBe(false);
    expect(invocationRows()).toContainEqual(expect.objectContaining({
      kind: "cli",
      command: "new-app",
      app: "invalid-template",
      dryRun: true,
      exitCode: 1,
    }));
  });

  it("journals read commands, parser failures, and secret-redacted argv exactly once", async () => {
    const before = invocationRows().length;
    expect((await runCli(["roles"])).code).toBe(0);
    const failed = await runCli([
      "context",
      "--api-key",
      "sk-12345678901234567890",
    ]);
    expect(failed.code).toBe(1);

    const added = invocationRows().slice(before);
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject({
      schema_version: 2,
      kind: "cli",
      command: "roles",
      outcome: "completed",
      exitCode: 0,
    });
    expect(added[1]).toMatchObject({
      schema_version: 2,
      kind: "cli",
      command: "context",
      exitCode: 1,
      argv: ["context", "--api-key", "[REDACTED:argv-value]"],
    });
    expect(new Set(added.map((row) => row["invocationId"])).size).toBe(2);
    expect(JSON.stringify(added)).not.toContain("sk-12345678901234567890");
  });

  it("does not create an explicit org-init state target before plan validation", async () => {
    const root = mkdtempSync(join(tmpdir(), "operon-cli-invalid-init-audit-"));
    const state = join(root, "arbitrary-state");
    const target = join(root, "org");
    try {
      const result = await runCliFrom(
        ["org", "init", target, "--name", "!!!", "--state-home", state, "--dry-run"],
        NEUTRAL_CWD,
        join(root, "home"),
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("--name must contain a letter or number");
      expect(existsSync(state)).toBe(false);
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("org-init dry-run validates before binding and writes only its documented audit exception", async () => {
    const root = mkdtempSync(join(tmpdir(), "operon-cli-init-preview-audit-"));
    const state = join(root, "state");
    const target = join(root, "org");
    const home = join(root, "home");
    try {
      const result = await runCliFrom(
        ["org", "init", target, "--name", "preview-org", "--state-home", state, "--dry-run"],
        NEUTRAL_CWD,
        home,
      );
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain("A dispatched CLI writes only its invocation audit row");
      expect(existsSync(target)).toBe(false);
      expect(existsSync(join(home, ".operon", "config"))).toBe(false);
      expect(invocationRows(state)).toContainEqual(expect.objectContaining({
        command: "org",
        subcommand: "init",
        dryRun: true,
        outcome: "org-init-preview-ready",
        provenance: { authorityProfile: "delegated-operator" },
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a command with no explicit or valid active state home cannot fabricate an audit destination", async () => {
    const root = mkdtempSync(join(tmpdir(), "operon-cli-no-audit-home-"));
    try {
      const result = await runCliFrom(["context"], NEUTRAL_CWD, root);
      expect(result.code).toBe(1);
      expect(existsSync(join(root, ".operon"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not attribute an explicit standalone state home to the active org pointer", async () => {
    const root = mkdtempSync(join(tmpdir(), "operon-cli-standalone-audit-"));
    const state = join(root, "state");
    try {
      const result = await runCliFrom(
        ["roles", join(process.cwd(), "roles.yaml"), "--state-home", state],
        NEUTRAL_CWD,
        USER_HOME,
      );
      expect(result.code, result.stderr).toBe(0);
      const [row] = invocationRows(state);
      expect(row).toMatchObject({ command: "roles", exitCode: 0 });
      expect(row).not.toHaveProperty("org");
    } finally {
      rmSync(root, { recursive: true, force: true });
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

  it("dispatch --dry-run appends one command-level invocation row", async () => {
    const before = invocationRows().length;
    const { stdout, code } = await runCli(["dispatch", "--dry-run"]);
    expect(code).toBe(0);
    expect(stdout).toContain("dispatch: spawned=");

    const added = invocationRows().slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ kind: "cli", command: "dispatch", dryRun: true });
    expect(typeof added[0]?.["wallClockMs"]).toBe("number");
    expect(typeof added[0]?.["outcome"]).toBe("string");
  });
});
