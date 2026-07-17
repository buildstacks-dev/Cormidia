// Regression: `operon app verify`'s app-check gates must install/setup the
// app's dependencies in the managed clone BEFORE running the test/lint checks
// (finding E2E-01 / W0-ADJ-05). A real npm scaffold's `npm test` is
// `npm run build && node --test …`, which needs `tsc` from devDependencies
// installed — so before the fix, `verify` ran the test command against a fresh
// clone with no `node_modules` and every real app failed the app-check gates,
// never reaching `ready`/`live`. `verifyApp` now runs the app's `setup_command`
// as a typed `app-check-setup` gate first, mirroring the build loop's
// provision-time setup gate (advanceProvisionSetup) one layer up.
//
// The setup command is also proof that W0-ADJ-04 is resolved on the verify
// path: `new-app` writes `setup_command` as a TOP-LEVEL key while the config
// carries exactly one app entry, and `loadGateCommands` used to read only the
// sole-app entry — so the setup command was dead config and never reached
// verify. It now reaches verify.
//
// Zero network: the setup command creates a marker file and the test command
// asserts the marker exists, so setup-runs-first is observable offline and
// deterministically; a local bare repo stands in for the pushed GitHub remote.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNewApp } from "../../src/org/new-app.js";
import {
  executeAppPromotion,
  lifecycleRecordPath,
  verifyApp,
  type RuntimeReadinessInspector,
} from "../../src/org/app-lifecycle.js";
import { loadApps } from "../../src/org/apps.js";
import { initOrgHome } from "../../src/org/home.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "operon-verify-setup-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_SYSTEM: devNull,
      GIT_AUTHOR_NAME: "Verify Setup Fixture",
      GIT_AUTHOR_EMAIL: "fixture@operon.invalid",
      GIT_COMMITTER_NAME: "Verify Setup Fixture",
      GIT_COMMITTER_EMAIL: "fixture@operon.invalid",
      GIT_TERMINAL_PROMPT: "0",
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function makeOrg(root: string): Promise<{ orgHome: string; stateHome: string }> {
  const orgHome = join(root, "org");
  const stateHome = join(root, "state");
  await initOrgHome({ target: orgHome, name: "verify-setup", stateHome, homeDir: join(root, "home") });
  return { orgHome, stateHome };
}

// Keep verification token-free and independent of which adapter packages happen
// to be installed in the test environment (W0-ADJ-06 is out of scope here).
const noRuntimeChecks: RuntimeReadinessInspector = async () => [];

const MARKER = ".operon-setup-marker";

/** Replace the gate-command block `new-app` appends to `.operon/config.yaml`
 * with test-controlled, offline commands. The values are written as double
 * quoted YAML scalars so a bare `false`/`true` cannot be misread as a YAML
 * boolean (which would drop the command silently). */
function rewriteGateCommands(
  targetDir: string,
  commands: { setup?: string; test: string; lint: string },
): void {
  const configPath = join(targetDir, ".operon", "config.yaml");
  const original = readFileSync(configPath, "utf8");
  const marker = "\n# Gate commands used by Operon's loop";
  const base = original.includes(marker) ? original.slice(0, original.indexOf(marker)) : original;
  const block = [
    base.replace(/\s+$/, ""),
    "",
    "# Gate commands (test-controlled).",
    ...(commands.setup !== undefined ? [`setup_command: ${JSON.stringify(commands.setup)}`] : []),
    `test_command: ${JSON.stringify(commands.test)}`,
    `lint_command: ${JSON.stringify(commands.lint)}`,
    "",
  ];
  writeFileSync(configPath, block.join("\n"), "utf8");
}

/** Turn a `new-app` scaffold into the pushed state an operator reaches after
 * `git init && commit && gh repo create --push`, using a local bare origin. */
function pushToLocalBare(root: string, targetDir: string): string {
  const bare = join(root, "origin.git");
  git(root, "init", "--bare", "--initial-branch=main", bare);
  git(targetDir, "init", "--initial-branch=main");
  git(targetDir, "add", ".");
  git(targetDir, "commit", "-m", "Bootstrap app");
  git(targetDir, "remote", "add", "origin", bare);
  git(targetDir, "push", "-u", "origin", "main");
  return bare;
}

describe("app verify setup gate (E2E-01 / W0-ADJ-05)", () => {
  it("runs setup before the app-check gates, so a setup-dependent test passes and the app is ready", async () => {
    const root = tempRoot();
    const { orgHome, stateHome } = await makeOrg(root);
    const targetDir = join(root, "app");
    await createNewApp({ appName: "setupapp", targetDir, repoSlug: "owner/setupapp", goal: "E2E-01 ready", orgHome, stateHome });

    // setup creates the marker; the test gate only passes if setup ran first.
    // With the bug (setup never runs), `test -f` exits 1 and verify is invalid.
    rewriteGateCommands(targetDir, {
      setup: `touch ${MARKER}`,
      test: `test -f ${MARKER}`,
      lint: "true",
    });
    pushToLocalBare(root, targetDir);

    // The lifecycle record is synthesized on this verify (L0-01 path exercised).
    expect(existsSync(lifecycleRecordPath(stateHome, "setupapp"))).toBe(false);
    const verified = await verifyApp({ orgHome, stateHome, appName: "setupapp", runtimeReadiness: noRuntimeChecks });

    expect(verified.status).toBe("ready");
    expect(verified.checks.every((check) => check.status === "pass")).toBe(true);
    const setupCheck = verified.checks.find((check) => check.id === "app-check-setup");
    expect(setupCheck?.status).toBe("pass");
    const testCheck = verified.checks.find((check) => check.id === "app-check-tests");
    expect(testCheck?.status).toBe("pass");
    expect(existsSync(lifecycleRecordPath(stateHome, "setupapp"))).toBe(true);

    // Full L0-01 acceptance: the app promotes to live with no apps.yaml edit.
    const result = await executeAppPromotion({
      orgHome,
      stateHome,
      appName: "setupapp",
      to: "live",
      execute: true,
      runtimeReadiness: noRuntimeChecks,
    });
    expect(result.status).toBe("promoted");
    const after = await loadApps(join(orgHome, "apps.yaml"));
    expect(after.apps.find((app) => app.name === "setupapp")?.status).toBe("live");
  });

  it("reports a typed app-check-setup failure with remediation (not a crash) and does not run the dependent checks", async () => {
    const root = tempRoot();
    const { orgHome, stateHome } = await makeOrg(root);
    const targetDir = join(root, "app");
    await createNewApp({ appName: "badsetup", targetDir, repoSlug: "owner/badsetup", goal: "E2E-01 fail", orgHome, stateHome });

    // setup fails; the test command would PASS if it ran — so seeing no
    // app-check-tests proves verify short-circuited instead of reporting a
    // misleading downstream failure.
    rewriteGateCommands(targetDir, { setup: "exit 1", test: "true", lint: "true" });
    pushToLocalBare(root, targetDir);

    const report = await verifyApp({ orgHome, stateHome, appName: "badsetup", runtimeReadiness: noRuntimeChecks });

    expect(report.kind).toBe("app-verification");
    expect(report.status).not.toBe("ready");
    const setupCheck = report.checks.find((check) => check.id === "app-check-setup");
    expect(setupCheck).toBeDefined();
    expect(setupCheck?.status).toBe("blocked");
    expect(setupCheck?.remediation).toMatch(/setup_command/);
    // The dependent gates never ran: no misleading app-check-tests/lint result.
    expect(report.checks.some((check) => check.id === "app-check-tests")).toBe(false);
    expect(report.checks.some((check) => check.id === "app-check-lint")).toBe(false);
  });

  it("leaves behavior unchanged when no setup command is configured", async () => {
    const root = tempRoot();
    const { orgHome, stateHome } = await makeOrg(root);
    const targetDir = join(root, "app");
    await createNewApp({ appName: "nosetup", targetDir, repoSlug: "owner/nosetup", goal: "E2E-01 nosetup", orgHome, stateHome });

    // No setup_command: the test/lint gates run directly, exactly as before.
    rewriteGateCommands(targetDir, { test: "true", lint: "true" });
    pushToLocalBare(root, targetDir);

    const verified = await verifyApp({ orgHome, stateHome, appName: "nosetup", runtimeReadiness: noRuntimeChecks });

    expect(verified.status).toBe("ready");
    expect(verified.checks.some((check) => check.id === "app-check-setup")).toBe(false);
    expect(verified.checks.find((check) => check.id === "app-check-tests")?.status).toBe("pass");
    expect(verified.checks.find((check) => check.id === "app-check-lint")?.status).toBe("pass");
  });
});
