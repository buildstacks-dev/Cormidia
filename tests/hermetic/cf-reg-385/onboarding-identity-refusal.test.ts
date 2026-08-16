// Traceability: CF-REG-385 · HB-139 · case-catalog.md §10.3, defect #385
// (owning structure J-02 success/refusal · INV-008 · INV-015 · B-01;
// contracts/journey-acceptance.md J-02).

// CF-REG-385 (L2) — the composed onboarding path over real temp org/state homes:
// preview and execution refuse the same unresolved target before the first
// app/org/state mutation, every outward-action surface refuses a legacy
// contaminated registration, and reset stays available as the named recovery.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdApp } from "../../../src/cli/app.js";
import { verifyApp } from "../../../src/org/app-lifecycle.js";
import { joinExistingOrg, loadApps, normalizeAppExecution } from "../../../src/org/apps.js";
import { registerAppWithExistingOrg } from "../../../src/org/bootstrap.js";
import { loadRoles } from "../../../src/org/roles.js";
import { NewAppBlockedError } from "../../../src/org/new-app-blocked.js";
import { createNewApp } from "../../../src/org/new-app.js";
import { runAutoPlan } from "../../../src/org/plan-auto.js";
import { runDispatchedTurn } from "../../../src/org/turn-runner.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

const APP = "atlas";
const GOAL = "deliver one observable atlas milestone";
// The exact value the production E2E run registered: the owner was replaced,
// the repository component was not.
const CONTAMINATED = "buildstacks-dev/YOUR_APP_REPOSITORY";
const CONCRETE = "buildstacks-dev/buildstacks-web";

const homes: TempOrgHome[] = [];

afterEach(async () => {
  for (const home of homes.splice(0).reverse()) await home.cleanup();
  vi.restoreAllMocks();
});

async function org(name: string): Promise<TempOrgHome> {
  const home = await makeTempOrgHome({ name });
  homes.push(home);
  return home;
}

async function registeredApps(home: TempOrgHome): Promise<string[]> {
  return (await loadApps(join(home.orgHome, "apps.yaml"))).apps.map((app) => app.name);
}

async function seedContaminatedRegistration(home: TempOrgHome, repo: string): Promise<void> {
  // A legacy record written before this guard existed. Registration itself is
  // deliberately still possible: the defect is that outward ACTIONS accepted it.
  await joinExistingOrg(home.orgHome, {
    name: APP,
    repo,
    status: "live",
    cadence: {},
    execution: normalizeAppExecution(undefined),
  });
}

describe("CF-REG-385 — new-app refuses an unresolved target identically in preview and execution", () => {
  it.each([true, false])("dry-run=%s returns a typed blocked result and writes nothing", async (dryRun) => {
    const home = await org(`cf-reg-385-${dryRun ? "preview" : "execute"}`);
    const target = join(home.root, APP);

    const error = await createNewApp({
      appName: APP,
      targetDir: target,
      repoSlug: CONTAMINATED,
      goal: GOAL,
      template: "bare",
      orgHome: home.orgHome,
      stateHome: home.stateHome,
      dryRun,
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(NewAppBlockedError);
    if (!(error instanceof NewAppBlockedError)) return;
    const refusal = error.refusal;
    expect(refusal.kind).toBe("new-app-refusal");
    expect(refusal.dry_run).toBe(dryRun);
    // The exact refused target is exposed prominently, not buried.
    expect(refusal.repository).toBe(CONTAMINATED);
    expect(refusal.blockers).toHaveLength(1);
    expect(refusal.blockers[0]?.code).toBe("repository-identity:placeholder-repository");
    expect(refusal.blockers[0]?.remediation).toContain("nothing was");

    // No app, org, or state domain artifact exists.
    expect(existsSync(target)).toBe(false);
    expect(await registeredApps(home)).toEqual([]);
    expect(existsSync(join(home.stateHome, "onboarding"))).toBe(false);
  });

  it("positive control: the concrete slug scaffolds, registers, and reaches the guide", async () => {
    const home = await org("cf-reg-385-concrete");
    const target = join(home.root, APP);
    const result = await createNewApp({
      appName: APP,
      targetDir: target,
      repoSlug: CONCRETE,
      goal: GOAL,
      template: "bare",
      orgHome: home.orgHome,
      stateHome: home.stateHome,
    });
    expect(result.repoSlug).toBe(CONCRETE);
    expect(await registeredApps(home)).toEqual([APP]);
    const guide = await readFile(join(target, ".cormidia/bootstrap/next-commands.md"), "utf8");
    expect(guide).toContain(`gh repo create '${CONCRETE}'`);
    expect(guide).not.toContain("YOUR_APP_REPOSITORY");
  });
});

describe("CF-REG-385 — existing-app bootstrap never registers an actionable OWNER/<app>", () => {
  it("marks the no-remote fallback non-actionable and names the supported correction", async () => {
    const home = await org("cf-reg-385-bootstrap");
    const checkout = join(home.root, "checkout");
    await mkdir(checkout, { recursive: true });
    await writeFile(join(checkout, "README.md"), "# checkout\n", "utf8");

    const registered = await registerAppWithExistingOrg(checkout, { appName: APP, orgHome: home.orgHome });
    expect(registered.appName).toBe(APP);
    const entry = (await loadApps(join(home.orgHome, "apps.yaml"))).apps.find((app) => app.name === APP);
    expect(entry?.repo).toBe(`OWNER/${APP}`);

    // Registered, but every outward path refuses it before touching the network.
    const verification = await verifyApp({
      appName: APP,
      orgHome: home.orgHome,
      stateHome: home.stateHome,
      githubFactory: () => {
        throw new Error("CF-REG-385: verify reached GitHub with a placeholder identity");
      },
    });
    expect(verification.status).toBe("invalid");
    const identityCheck = verification.checks.find((check) => check.id === "repository-identity");
    expect(identityCheck?.status).toBe("fail");
    expect(identityCheck?.remediation).toContain(`cormidia app reset ${APP}`);
    expect(identityCheck?.remediation).toContain("Editing apps.yaml");
  });

  it("refuses a SCANNED origin that is itself a placeholder instead of registering it", async () => {
    // Subprocess output crossing a trust boundary. A repo whose configured
    // origin is a sentinel must not become a registration — the absent-remote
    // fallback is the only path allowed to record a non-actionable identity.
    const home = await org("cf-reg-385-scan");
    const checkout = join(home.root, "scanned");
    await mkdir(checkout, { recursive: true });
    await writeFile(join(checkout, "README.md"), "# scanned\n", "utf8");
    const git = (...args: string[]) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" });
    git("init", "--quiet");
    git("remote", "add", "origin", "https://github.com/OWNER/atlas.git");

    await expect(registerAppWithExistingOrg(checkout, { appName: APP, orgHome: home.orgHome })).rejects.toThrow(
      /bootstrap register: owner "OWNER" is an unresolved placeholder/,
    );
    expect(await registeredApps(home)).toEqual([]);

    // Positive control: the same scan path registers a concrete origin.
    git("remote", "set-url", "origin", `https://github.com/${CONCRETE}.git`);
    await registerAppWithExistingOrg(checkout, { appName: APP, orgHome: home.orgHome });
    const entry = (await loadApps(join(home.orgHome, "apps.yaml"))).apps.find((app) => app.name === APP);
    expect(entry?.repo).toBe(CONCRETE);
  });
});

describe("CF-REG-385 — a legacy contaminated record fails closed at every outward surface", () => {
  it("refuses verify, planning, and dispatched turns before any GitHub call", async () => {
    const home = await org("cf-reg-385-legacy");
    await seedContaminatedRegistration(home, CONTAMINATED);
    const appsFile = await loadApps(join(home.orgHome, "apps.yaml"));
    const app = appsFile.apps.find((entry) => entry.name === APP);
    expect(app).toBeDefined();
    if (app === undefined) return;

    const verification = await verifyApp({
      appName: APP,
      orgHome: home.orgHome,
      stateHome: home.stateHome,
      githubFactory: () => {
        throw new Error("CF-REG-385: verify reached GitHub with a placeholder identity");
      },
    });
    expect(verification.status).toBe("invalid");
    expect(verification.checks.find((check) => check.id === "repository-identity")?.detail).toContain(
      "YOUR_APP_REPOSITORY",
    );

    await expect(
      runAutoPlan({
        orgHome: home.orgHome,
        stateHome: home.stateHome,
        app,
        appsFile,
        goal: GOAL,
      }),
    ).rejects.toThrow(/plan: app atlas is registered with a non-actionable repository identity/);

    const roles = await loadRoles(join(home.orgHome, "roles.yaml"));
    const planner = roles.roles.find((role) => role.name === "planner");
    expect(planner).toBeDefined();
    if (planner === undefined) return;
    await expect(
      runDispatchedTurn({
        role: planner,
        app,
        appsFile,
        turnId: "cf-reg-385-turn",
        runtimeHome: home.stateHome,
      }),
    ).rejects.toThrow(/turn: app atlas is registered with a non-actionable repository identity/);
    // The refusal precedes the turn lock, so nothing durable was claimed.
    expect(existsSync(join(home.stateHome, "state", "turns", "cf-reg-385-turn.json"))).toBe(false);

    // Negative control: a sibling app registered with a concrete identity gets
    // past the identity guard and fails later on missing lifecycle evidence,
    // proving the detector keys on the placeholder rather than on onboarding.
    await joinExistingOrg(home.orgHome, {
      name: "sibling",
      repo: CONCRETE,
      status: "live",
      cadence: {},
      execution: normalizeAppExecution(undefined),
    });
    const sibling = await verifyApp({
      appName: "sibling",
      orgHome: home.orgHome,
      stateHome: home.stateHome,
      // Offline: record synthesis would clone the (real) concrete remote.
      synchronize: false,
    });
    expect(sibling.checks.some((check) => check.id === "repository-identity")).toBe(false);
  });
});

describe("CF-REG-385 — typed recovery without hand-editing any generated or ratified file", () => {
  it("resets a placeholder-registered app and re-onboards it against the real repository", async () => {
    const home = await org("cf-reg-385-recovery");
    const target = join(home.root, APP);
    await seedContaminatedRegistration(home, CONTAMINATED);
    const appsYamlBefore = await readFile(join(home.orgHome, "apps.yaml"), "utf8");
    expect(appsYamlBefore).toContain(CONTAMINATED);

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const code = await cmdApp(
      [
        "reset",
        APP,
        "--execute",
        "--confirm",
        APP,
        "--json",
        "--org-home",
        home.orgHome,
        "--state-home",
        home.stateHome,
      ],
      {
        ghFactory: () => {
          throw new Error("CF-REG-385: reset built a GitHub surface from a placeholder identity");
        },
      },
    );
    log.mockRestore();
    expect(code).toBe(0);
    expect(await registeredApps(home)).toEqual([]);

    // Re-onboarding is the correction; no operator edited apps.yaml, the app
    // config, or the generated guide.
    const result = await createNewApp({
      appName: APP,
      targetDir: target,
      repoSlug: CONCRETE,
      goal: GOAL,
      template: "bare",
      orgHome: home.orgHome,
      stateHome: home.stateHome,
    });
    expect(result.repoSlug).toBe(CONCRETE);
    const appsYamlAfter = await readFile(join(home.orgHome, "apps.yaml"), "utf8");
    expect(appsYamlAfter).toContain(CONCRETE);
    expect(appsYamlAfter).not.toContain("YOUR_APP_REPOSITORY");
    const config = await readFile(join(target, ".cormidia/config.yaml"), "utf8");
    expect(config).toContain(CONCRETE);
    expect(config).not.toContain("YOUR_APP_REPOSITORY");
  });
});

describe("CF-REG-385 — the manual E2E runbook proves its identities mechanically", () => {
  const runbook = join(process.cwd(), "docs", "org", "manual-e2e-runbook.md");

  it("exists, fails closed on an unset identity, and plants no substitutable sentinel", async () => {
    const text = await readFile(runbook, "utf8");
    // Fail-closed shell: an unset or empty identity aborts the whole runbook
    // rather than composing a slug from a sentinel.
    expect(text).toContain("set -euo pipefail");
    for (const required of ["E2E_GITHUB_OWNER", "E2E_APP_REPOSITORY", "E2E_APP_NAME", "E2E_APP_DIR", "E2E_APP_GOAL"]) {
      expect(text).toMatch(new RegExp(`: "\\$\\{${required}:\\?`));
    }
    // The preflight's proof is Cormidia's own centralized rule, run token-free,
    // not prose telling the operator to choose real values.
    // The proving step is Cormidia's own centralized rule, invoked token-free,
    // whose refusal this suite already exercises directly.
    expect(text).toMatch(/cormidia new-app[\s\S]*--repo "\$E2E_APP_REPO"[\s\S]*--dry-run --json/);
    expect(text).not.toMatch(/YOUR_APP_REPOSITORY|YOUR_GITHUB_OWNER/);
    expect(text).not.toMatch(/^\s*export\s+E2E_(GITHUB_OWNER|APP_REPOSITORY)=/m);
  });

  it("negative control: a runbook that assigned a sentinel would fail this detector", () => {
    const planted = [
      'export E2E_GITHUB_OWNER="YOUR_GITHUB_OWNER_OR_ORG"',
      'export E2E_APP_REPOSITORY="YOUR_APP_REPOSITORY"',
    ].join("\n");
    expect(planted).toMatch(/YOUR_APP_REPOSITORY|YOUR_GITHUB_OWNER/);
    expect(planted).toMatch(/^\s*export\s+E2E_(GITHUB_OWNER|APP_REPOSITORY)=/m);
  });
});
