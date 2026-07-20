// B-LIVE-04 / B-LIVE-05: the two verify blockers that kept an onboarded app
// from reaching `live` (completes L-001), found by live validation.
//
// B-LIVE-04 — verify's runtime check must AGREE with `operon doctor`. The old
// `staticRuntimeReadiness` did `require.resolve(<adapter package>)`; codex ships
// bin-only (no resolvable main/exports under pnpm) so that THROWS "Cannot find
// module '@openai/codex'" and verify reported `runtime-codex: fail` → app
// `invalid` → could not reach live, even though `operon doctor` reported the
// same codex adapter ready via the non-billable `probeRuntimeReadiness`. Verify
// now runs that same probe (injectable seam), so a bin-only-but-ready codex
// passes while a genuinely-unavailable runtime still fails.
//
// B-LIVE-05 — an operator capping an app's budget in the org registry
// (apps.yaml: budget_usd_month 50) while the app-owned .operon/config.yaml keeps
// the bootstrap default (1000) is a normal, safe divergence: budget enforcement
// is registry-authoritative (rollupBudgets/enforceBudgetOverlay read the
// registry apps.yaml, never the managed clone's config). `comparableApp` no
// longer compares budget, so that divergence stops false-failing registry-config
// — while every identity/state/behavior field is still required to agree.

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import {
  bootstrapFromRecoveredAnswers,
  verifyApp,
  type RecoveredBootstrapResult,
} from "../../src/org/app-lifecycle.js";
import type {
  RuntimeReadinessProbe,
  RuntimeReadinessStatus,
} from "../../src/runtime/readiness.js";
import {
  LIFECYCLE_ANSWERS,
  READY_RUNTIME_PROBE,
  git,
  makeLifecycleTestWorld,
  type LifecycleTestWorld,
} from "./helpers.js";

const require = createRequire(import.meta.url);

const worlds: LifecycleTestWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.cleanup(); });

// planner=claude, builder=codex (roles.yaml): a codex-backed role is exactly the
// bin-only runtime whose package cannot be require.resolve'd.
const CODEX_ANSWERS = {
  ...LIFECYCLE_ANSWERS,
  product: "A lifecycle fixture whose builder role runs on codex.",
  roles: ["planner", "builder"],
};

function probeReturning(
  status: RuntimeReadinessStatus,
  errorCode?: string,
): RuntimeReadinessProbe {
  return async (request) => ({
    runtime: request.runtime,
    models: [...new Set(request.models)].sort(),
    status,
    detail: `fake ${request.runtime} probe reported ${status}`,
    durationMs: 4,
    billable: false,
    ...(errorCode !== undefined ? { errorCode } : {}),
  });
}

async function reachable(
  world: LifecycleTestWorld,
  answers: typeof LIFECYCLE_ANSWERS,
): Promise<RecoveredBootstrapResult> {
  const result = await bootstrapFromRecoveredAnswers(world.git.clone.root, answers, {
    orgHome: world.orgHome,
    stateHome: world.stateHome,
    appName: "sparse",
  });
  git(result.managedClone, "push", "origin", "HEAD:main");
  return result;
}

function check(report: Awaited<ReturnType<typeof verifyApp>>, id: string) {
  return report.checks.find((c) => c.id === id);
}

describe("B-LIVE-04 verify runtime readiness agrees with doctor", () => {
  it("root cause: the codex adapter package is bin-only and cannot be require.resolve'd", () => {
    // This is the exact throw the old module-resolution probe hit. If this ever
    // stops throwing the regression below is no longer guarding the real bug.
    expect(() => require.resolve("@openai/codex")).toThrow(/Cannot find module '@openai\/codex'/);
  });

  it("passes a bin-only-but-ready codex when the non-billable probe reports ready", async () => {
    const world = await makeLifecycleTestWorld(); worlds.push(world);
    await reachable(world, CODEX_ANSWERS);

    const report = await verifyApp({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      readinessProbe: probeReturning("ready"),
    });

    // The codex role must produce a `runtime-codex` check (proving codex is
    // actually exercised) and it must PASS off the probe, not module resolution.
    const codex = check(report, "runtime-codex");
    expect(codex?.status).toBe("pass");
    expect(check(report, "runtime-claude")?.status).toBe("pass");
    expect(report.status).toBe("ready");
    expect(report.evidence_state).toBe("runtime-ready");
  });

  it("still fails a genuinely unavailable runtime — the readiness bar is unchanged", async () => {
    const world = await makeLifecycleTestWorld(); worlds.push(world);
    await reachable(world, CODEX_ANSWERS);

    const report = await verifyApp({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      // codex reports unauthenticated: the probe result, not require.resolve,
      // drives the verdict, so a real broken adapter still fails.
      readinessProbe: async (request) =>
        request.runtime === "codex"
          ? {
              runtime: request.runtime,
              models: request.models,
              status: "unauthenticated",
              detail: "Codex App Server initialized, but account/read reported no authenticated account",
              durationMs: 4,
              billable: false,
              errorCode: "error_adapter_unauthenticated",
            }
          : {
              runtime: request.runtime,
              models: request.models,
              status: "ready",
              detail: "ready",
              durationMs: 1,
              billable: false,
            },
    });

    const codex = check(report, "runtime-codex");
    expect(codex?.status).toBe("fail");
    expect(codex?.detail).toContain("unauthenticated");
    expect(codex?.detail).toContain("error_adapter_unauthenticated");
    expect(report.status).toBe("invalid");
  });

  it("config-only never claims readiness (blocked, not pass) and does not run a probe", async () => {
    const world = await makeLifecycleTestWorld(); worlds.push(world);
    await reachable(world, CODEX_ANSWERS);

    let probed = false;
    const report = await verifyApp({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      configOnly: true,
      readinessProbe: async (request) => {
        probed = true;
        return {
          runtime: request.runtime,
          models: request.models,
          status: "ready",
          detail: "should not be called",
          durationMs: 0,
          billable: false,
        };
      },
    });

    expect(probed).toBe(false);
    const codex = check(report, "runtime-codex");
    expect(codex?.status).toBe("blocked");
    expect(codex?.status).not.toBe("pass");
    // configuration validity is not runtime readiness — the app is not `ready`.
    expect(report.status).not.toBe("ready");
  });
});

describe("B-LIVE-05 registry-authoritative budget divergence does not fail verify", () => {
  it("passes registry-config when only the budget differs (registry cap 50 vs config default)", async () => {
    const world = await makeLifecycleTestWorld(); worlds.push(world);
    await reachable(world, LIFECYCLE_ANSWERS);

    // Operator caps the app in the ORG REGISTRY (apps.yaml) — the config the
    // budget guard actually enforces against — while the app-owned config keeps
    // its bootstrap default. Every other field is identical.
    capRegistryBudget(world.orgHome, "sparse", 50);

    const report = await verifyApp({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      readinessProbe: READY_RUNTIME_PROBE,
    });

    expect(check(report, "registry-config")?.status).toBe("pass");
    expect(report.status).toBe("ready");
  });

  it("still fails registry-config when a security-relevant field (status) diverges — tamper detection intact", async () => {
    const world = await makeLifecycleTestWorld(); worlds.push(world);
    await reachable(world, LIFECYCLE_ANSWERS);

    // Registry says `paused`; the app-owned config still says `onboarding`.
    // This identity/state divergence must still be caught by registry-config.
    tamperRegistryStatus(world.orgHome, "sparse", "paused");

    const report = await verifyApp({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      readinessProbe: READY_RUNTIME_PROBE,
    });

    const registryConfig = check(report, "registry-config");
    expect(registryConfig?.status).toBe("fail");
    expect(registryConfig?.detail).toContain("registry and app config differ");
    expect(report.status).toBe("invalid");
  });
});

describe("assignment execution config is behavior-relevant mirror state", () => {
  it("treats legacy omission and explicit fixed mode as the same effective policy", async () => {
    const world = await makeLifecycleTestWorld(); worlds.push(world);
    await reachable(world, LIFECYCLE_ANSWERS);

    // New app config explicitly records fixed mode; a legacy registry entry
    // may omit it. Both normalize to the same effective assignment policy.
    editRegistryApp(world.orgHome, "sparse", (spec) => { delete spec["execution"]; });

    const report = await verifyApp({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      readinessProbe: READY_RUNTIME_PROBE,
    });

    expect(check(report, "registry-config")?.status).toBe("pass");
    expect(report.status).toBe("ready");
  });

  it("fails verification when registry and app assignment policies differ", async () => {
    const world = await makeLifecycleTestWorld(); worlds.push(world);
    await reachable(world, LIFECYCLE_ANSWERS);

    editRegistryApp(world.orgHome, "sparse", (spec) => {
      spec["execution"] = {
        assignment_mode: "adaptive",
        allowed_assignments: { builder: ["configured"] },
      };
    });

    const report = await verifyApp({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      readinessProbe: READY_RUNTIME_PROBE,
    });

    const registryConfig = check(report, "registry-config");
    expect(registryConfig?.status).toBe("fail");
    expect(registryConfig?.detail).toContain("registry and app config differ");
    expect(report.status).toBe("invalid");
  });
});

function capRegistryBudget(orgHome: string, app: string, budget: number): void {
  editRegistryApp(orgHome, app, (spec) => { spec["budget_usd_month"] = budget; });
}

function tamperRegistryStatus(orgHome: string, app: string, status: string): void {
  editRegistryApp(orgHome, app, (spec) => { spec["status"] = status; });
}

function editRegistryApp(orgHome: string, app: string, mutate: (spec: Record<string, unknown>) => void): void {
  const path = join(orgHome, "apps.yaml");
  const raw = parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const apps = raw["apps"] as Record<string, Record<string, unknown>>;
  mutate(apps[app]!);
  writeFileSync(path, stringify(raw), "utf8");
}
