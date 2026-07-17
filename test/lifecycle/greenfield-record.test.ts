// Regression: an app onboarded with `operon new-app` must be verifiable and
// promotable to `status: live` (finding L0-01). Before the fix, `operon app
// verify` crashed with a raw ENOENT because only the recovered-answer bootstrap
// path wrote the lifecycle record; `new-app` never did, and `verify` read the
// record unconditionally. `verify` now owns record synthesis/repair and returns
// a typed result for every miss. Zero network: a local bare repo stands in for
// the pushed GitHub remote.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { joinExistingOrg, loadApps } from "../../src/org/apps.js";
import { onboardingSourcePath } from "../../src/org/onboarding-answers.js";
import { initOrgHome } from "../../src/org/home.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "operon-greenfield-"));
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
      GIT_AUTHOR_NAME: "Greenfield Fixture",
      GIT_AUTHOR_EMAIL: "fixture@operon.invalid",
      GIT_COMMITTER_NAME: "Greenfield Fixture",
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
  await initOrgHome({ target: orgHome, name: "greenfield", stateHome, homeDir: join(root, "home") });
  return { orgHome, stateHome };
}

// Keep verification token-free and independent of which adapter packages happen
// to be installed in the test environment; L0-01 is about the lifecycle record,
// not runtime readiness.
const noRuntimeChecks: RuntimeReadinessInspector = async () => [];

/** Turn a `new-app` scaffold into the pushed state an operator reaches after
 * `git init && commit && gh repo create --push`, using a local bare origin. */
function pushScaffoldToLocalBare(root: string, targetDir: string): string {
  const bare = join(root, "origin.git");
  git(root, "init", "--bare", "--initial-branch=main", bare);
  // Make the app's own gate commands trivially pass without a dependency
  // install (the missing-node_modules cold-start is a separate finding).
  writeFileSync(
    join(targetDir, "package.json"),
    `${JSON.stringify(
      {
        name: "shipit",
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: { build: 'node -e ""', test: 'node -e ""', lint: 'node -e ""' },
      },
      null,
      2,
    )}\n`,
  );
  git(targetDir, "init", "--initial-branch=main");
  git(targetDir, "add", ".");
  git(targetDir, "commit", "-m", "Bootstrap greenfield app");
  git(targetDir, "remote", "add", "origin", bare);
  git(targetDir, "push", "-u", "origin", "main");
  return bare;
}

describe("greenfield lifecycle record (L0-01)", () => {
  it("new-app records an onboarding-source pointer, not a lifecycle record", async () => {
    const root = tempRoot();
    const { orgHome, stateHome } = await makeOrg(root);
    const targetDir = join(root, "app");

    await createNewApp({ appName: "greenapp", targetDir, repoSlug: "owner/greenapp", goal: "L0-01 pointer", orgHome, stateHome });

    expect(existsSync(onboardingSourcePath(stateHome, "greenapp"))).toBe(true);
    expect(existsSync(lifecycleRecordPath(stateHome, "greenapp"))).toBe(false);
  });

  it("verify returns a typed blocked result (never a raw ENOENT) when the scaffold is not pushed yet", async () => {
    const root = tempRoot();
    const { orgHome, stateHome } = await makeOrg(root);
    const targetDir = join(root, "app");
    await createNewApp({ appName: "greenapp", targetDir, repoSlug: "owner/greenapp", goal: "L0-01 typed", orgHome, stateHome });

    // Exactly the campaign's Issue 1 crash point: no record.json exists.
    const report = await verifyApp({ orgHome, stateHome, appName: "greenapp", runtimeReadiness: noRuntimeChecks });

    expect(report.kind).toBe("app-verification");
    expect(report.status).toBe("blocked");
    const check = report.checks.find((entry) => entry.id === "lifecycle-record");
    expect(check?.status).toBe("blocked");
    expect(check?.remediation).toMatch(/push/i);
    // An unsynthesizable app must not leave a partial record behind.
    expect(existsSync(lifecycleRecordPath(stateHome, "greenapp"))).toBe(false);
  });

  it("verify synthesizes the record and promote transitions to live with no manual apps.yaml edit", async () => {
    const root = tempRoot();
    const { orgHome, stateHome } = await makeOrg(root);
    const targetDir = join(root, "app");
    await createNewApp({ appName: "shipit", targetDir, repoSlug: "owner/shipit", goal: "L0-01 promote", orgHome, stateHome });

    pushScaffoldToLocalBare(root, targetDir);

    // A real `operon app verify` synthesizes the missing lifecycle record.
    expect(existsSync(lifecycleRecordPath(stateHome, "shipit"))).toBe(false);
    const verified = await verifyApp({ orgHome, stateHome, appName: "shipit", runtimeReadiness: noRuntimeChecks });
    expect(verified.status).toBe("ready");
    expect(verified.checks.every((check) => check.status === "pass")).toBe(true);
    expect(existsSync(lifecycleRecordPath(stateHome, "shipit"))).toBe(true);

    const before = await loadApps(join(orgHome, "apps.yaml"));
    expect(before.apps.find((app) => app.name === "shipit")?.status).toBe("onboarding");

    const result = await executeAppPromotion({
      orgHome,
      stateHome,
      appName: "shipit",
      to: "live",
      execute: true,
      runtimeReadiness: noRuntimeChecks,
    });
    expect(result.status).toBe("promoted");

    // The registry moved to live with no hand-edit of apps.yaml.
    const after = await loadApps(join(orgHome, "apps.yaml"));
    expect(after.apps.find((app) => app.name === "shipit")?.status).toBe("live");
  });

  it("verify returns a typed blocked result for a pre-existing app with no record and no onboarding pointer", async () => {
    const root = tempRoot();
    const { orgHome, stateHome } = await makeOrg(root);
    // A hand-registered app whose repo is not a resolvable GitHub slug: verify
    // must still report a typed result rather than crash. (A registered app
    // with a real slug would attempt a network clone here, so this offline case
    // deliberately uses a non-slug identity.)
    await joinExistingOrg(orgHome, { name: "orphan", repo: "orphan-no-remote", status: "onboarding" });

    const report = await verifyApp({ orgHome, stateHome, appName: "orphan", runtimeReadiness: noRuntimeChecks });
    expect(report.status).toBe("blocked");
    expect(report.checks.find((entry) => entry.id === "lifecycle-record")?.status).toBe("blocked");
  });
});
