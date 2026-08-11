// Traceability: CF-J02-S · HB-042; CF-J02-R · HB-042; CF-J02-I · HB-042; CF-J02-RC · HB-042 · contracts/journey-acceptance.md J-02.

// HB-042 — J-02 onboarding/evidence-ladder lifecycle over real temporary git
// remotes, managed clones, org/state homes, and durable promotion journals.

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bootstrapFromRecoveredAnswers,
  executeAppPromotion,
  planAppPromotion,
  verifyApp,
  type RuntimeReadinessInspector,
} from "../../../src/org/app-lifecycle.js";
import { loadApps } from "../../../src/org/apps.js";
import {
  initWorldOrg,
  makeInitWorld,
  type InitWorld,
} from "../cf-j01-a-cf-j01-i-cf-j01-r-cf-j01-rc-cf-j01-s/support.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";

interface OnboardingWorld {
  lifecycle: InitWorld;
  source: TempGitRepo;
  appName: string;
  cleanup(): Promise<void>;
}

const worlds: OnboardingWorld[] = [];

afterEach(async () => {
  for (const world of worlds.splice(0).reverse()) await world.cleanup();
});

const runtimeReady: RuntimeReadinessInspector = async (runtimes) =>
  runtimes.map(({ runtime, models }) => ({
    id: `runtime-${runtime}`,
    status: "pass" as const,
    detail: `fixture non-billable readiness for ${models.join(", ")}`,
  }));

async function makeWorld(name: string): Promise<OnboardingWorld> {
  const lifecycle = await makeInitWorld();
  await initWorldOrg(lifecycle, `${name}-org`);
  const source = await makeTempGitRepo({
    defaultBranch: "trunk",
    seedFiles: [
      { path: "README.md", contents: `# ${name}\n`, message: "fixture: readme" },
      {
        path: "package.json",
        contents:
          JSON.stringify(
            {
              name,
              version: "1.0.0",
              private: true,
              scripts: {
                test: 'node -e "process.exit(0)"',
                lint: 'node -e "process.exit(0)"',
              },
            },
            null,
            2,
          ) + "\n",
        message: "fixture: package contract",
      },
      {
        path: "package-lock.json",
        contents:
          JSON.stringify(
            {
              name,
              version: "1.0.0",
              lockfileVersion: 3,
              requires: true,
              packages: { "": { name, version: "1.0.0" } },
            },
            null,
            2,
          ) + "\n",
        message: "fixture: lock dependencies",
      },
    ],
  });
  await source.addFileRemote();
  const world: OnboardingWorld = {
    lifecycle,
    source,
    appName: name,
    cleanup: async () => {
      await source.cleanup();
      await lifecycle.cleanup();
    },
  };
  worlds.push(world);
  return world;
}

function answers(name: string): Record<string, unknown> {
  return {
    product: `${name} is a lifecycle fixture product.`,
    good: "Every evidence rung is earned before promotion.",
    roles: ["planner"],
  };
}

function bootstrapOptions(world: OnboardingWorld) {
  return {
    orgHome: world.lifecycle.target,
    stateHome: world.lifecycle.stateHome,
    appName: world.appName,
  };
}

function pushOnboarding(managedClone: string, branch: string): void {
  execFileSync("git", ["push", "--quiet", "origin", `HEAD:${branch}`], {
    cwd: managedClone,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  });
}

describe("CF-J02-S/R — onboarding earns only registered until verification", () => {
  it("bootstraps from immutable recovered answers and reruns idempotently", async () => {
    const world = await makeWorld("onboarding-stable");
    const sourceHead = world.source.head();
    const sourceStatus = world.source.git(["status", "--porcelain=v1", "--untracked-files=all"]);

    const first = await bootstrapFromRecoveredAnswers(
      world.source.dir,
      answers(world.appName),
      bootstrapOptions(world),
    );
    expect(first.immutableSource).toBe(true);
    expect(first.defaultBranch).toBe("trunk");
    expect(world.source.head()).toBe(sourceHead);
    expect(world.source.git(["status", "--porcelain=v1", "--untracked-files=all"])).toBe(sourceStatus);
    expect((await loadApps(join(world.lifecycle.target, "apps.yaml"))).apps).toContainEqual(
      expect.objectContaining({ name: world.appName, status: "onboarding" }),
    );

    const registered = await verifyApp({
      ...bootstrapOptions(world),
      synchronize: false,
      writeReadiness: false,
      recordEvidence: false,
      runtimeReadiness: runtimeReady,
    });
    expect(registered.evidence_state).toBe("registered");
    expect(registered.status).toBe("blocked");
    expect(registered.provider).toEqual({ factories: 0, processes: 0, turns: 0, settlements: 0 });

    const second = await bootstrapFromRecoveredAnswers(
      world.source.dir,
      answers(world.appName),
      bootstrapOptions(world),
    );
    expect(second.onboardingCommit).toBe(first.onboardingCommit);
    expect(second.managedClone).toBe(first.managedClone);
    expect(
      (await loadApps(join(world.lifecycle.target, "apps.yaml"))).apps.filter((entry) => entry.name === world.appName),
    ).toHaveLength(1);
  });

  it("refuses incomplete non-interactive answers before creating lifecycle state", async () => {
    const world = await makeWorld("onboarding-refusal");
    await expect(
      bootstrapFromRecoveredAnswers(world.source.dir, { product: "missing required answers" }, bootstrapOptions(world)),
    ).rejects.toThrow(/good.*required|roles must be a non-empty list/);
    expect(
      (await loadApps(join(world.lifecycle.target, "apps.yaml"))).apps.some((entry) => entry.name === world.appName),
    ).toBe(false);
  });
});

describe("CF-J02-I/RC — lifecycle interruption and convergence", () => {
  it("rolls back a bootstrap interrupted after registry write and converges on rerun", async () => {
    const world = await makeWorld("onboarding-recovery");
    await expect(
      bootstrapFromRecoveredAnswers(world.source.dir, answers(world.appName), {
        ...bootstrapOptions(world),
        fault: (point) => {
          if (point === "after_registry_write") throw new Error("fixture bootstrap crash");
        },
      }),
    ).rejects.toThrow(/fixture bootstrap crash/);
    expect(
      (await loadApps(join(world.lifecycle.target, "apps.yaml"))).apps.some((entry) => entry.name === world.appName),
    ).toBe(false);

    const recovered = await bootstrapFromRecoveredAnswers(
      world.source.dir,
      answers(world.appName),
      bootstrapOptions(world),
    );
    expect(recovered.onboardingCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(
      (await loadApps(join(world.lifecycle.target, "apps.yaml"))).apps.filter((entry) => entry.name === world.appName),
    ).toHaveLength(1);
  });

  it("resumes promotion after the push boundary and becomes idempotently live", async () => {
    const world = await makeWorld("promotion-recovery");
    const bootstrapped = await bootstrapFromRecoveredAnswers(
      world.source.dir,
      answers(world.appName),
      bootstrapOptions(world),
    );
    pushOnboarding(bootstrapped.managedClone, bootstrapped.defaultBranch);

    const common = {
      ...bootstrapOptions(world),
      to: "live" as const,
      runtimeReadiness: runtimeReady,
    };
    const readiness = await verifyApp(common);
    expect(readiness).toMatchObject({
      status: "ready",
      evidence_state: "runtime-ready",
      registry_status: "onboarding",
    });
    const preview = await planAppPromotion(common);
    expect(preview).toMatchObject({ executable: true, idempotent: false, from: "onboarding", to: "live" });

    await expect(
      executeAppPromotion(
        {
          ...common,
          fault: (point) => {
            if (point === "after_push") throw new Error("fixture promotion crash after push");
          },
        },
        preview,
      ),
    ).rejects.toThrow(/fixture promotion crash after push/);
    const journalPath = join(world.lifecycle.stateHome, "lifecycle", "apps", world.appName, "promotion.json");
    expect(JSON.parse(await readFile(journalPath, "utf8"))).toMatchObject({ phase: "config_committed" });

    const resumedPlan = await planAppPromotion(common);
    expect(resumedPlan.changes).toContain("resume the durable promotion transaction");
    const promoted = await executeAppPromotion(common, resumedPlan);
    expect(promoted).toMatchObject({
      status: "promoted",
      verification: { status: "ready", evidence_state: "live", registry_status: "live" },
    });
    expect(JSON.parse(await readFile(journalPath, "utf8"))).toMatchObject({ phase: "complete" });

    const idempotent = await planAppPromotion(common);
    expect(idempotent).toMatchObject({ executable: true, idempotent: true, changes: [] });
    expect((await executeAppPromotion(common, idempotent)).status).toBe("already_live");
  }, 30_000);
});
