import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdApp } from "../../src/cli/app.js";
import { cmdBootstrap } from "../../src/cli/bootstrap.js";
import { cmdOrg } from "../../src/cli/org.js";
import { CANONICAL_LABELS } from "../../src/loop/plan-tickets.js";
import { joinExistingOrg } from "../../src/org/apps.js";
import { parseAnswers } from "../../src/org/bootstrap.js";
import { storeOnboardingAnswers } from "../../src/org/onboarding-answers.js";
import { FakeGhOps } from "../support/fakeGhOps.js";
import {
  LIFECYCLE_ANSWERS,
  READY_RUNTIME_PROBE,
  git,
  makeLegacy,
  makeLifecycleTestWorld,
  sourceSnapshot,
  type LifecycleTestWorld,
} from "./helpers.js";

const worlds: LifecycleTestWorld[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const world of worlds.splice(0)) world.cleanup();
});

describe("token-free lifecycle public CLI", () => {
  it("runs the legacy/reset/recovery/upgrade/verify/promote replay through stable JSON commands", async () => {
    const startedAt = Date.now();
    const world = await makeLifecycleTestWorld(); worlds.push(world);
    const allRoles = ["planner", "builder", "reviewer", "sre", "support", "marketing", "distiller", "learning-reviewer"];
    await joinExistingOrg(world.orgHome, { name: "sparse", repo: "local/sparse", status: "onboarding", cadence: {} });
    await storeOnboardingAnswers(world.stateHome, "sparse", parseAnswers(LIFECYCLE_ANSWERS, allRoles));
    write(world.stateHome, "runs/sparse/stale/envelope.json", envelope("running"));
    write(world.stateHome, "approvals/pending/eval-only.json", `${JSON.stringify({ id: "eval-only", app: "sparse" })}\n`);
    const gh = new FakeGhOps({ repo: "local/sparse" });
    for (const label of CANONICAL_LABELS) await gh.ensureLabel(label);
    const homeFlags = ["--org-home", world.orgHome, "--state-home", world.stateHome];

    const refusal = await captureJson(() => cmdApp(["reset", "sparse", ...homeFlags, "--json"], { ghFactory: () => gh }));
    expect(refusal.code).toBe(0);
    expect((refusal.json as { blockers: Array<{ code: string; remediation: string }> }).blockers.map((item) => item.code)).toEqual(["stale_run", "pending_approval"]);
    expect((refusal.json as { blockers: Array<{ remediation: string }> }).blockers.every((item) => item.remediation.length > 0)).toBe(true);

    unlinkSync(join(world.stateHome, "approvals", "pending", "eval-only.json"));
    write(world.stateHome, "approvals/decided/eval-only.json", `${JSON.stringify({ id: "eval-only", app: "sparse", decision: "deny" })}\n`);
    write(world.stateHome, "runs/sparse/stale/envelope.json", envelope("cancelled"));

    const resetPlanA = await captureJson(() => cmdApp(["reset", "sparse", ...homeFlags, "--json"], { ghFactory: () => gh }));
    const resetPlanB = await captureJson(() => cmdApp(["reset", "sparse", ...homeFlags, "--json"], { ghFactory: () => gh }));
    expect(resetPlanA.text).toBe(resetPlanB.text);
    const reset = await captureJson(() => cmdApp(["reset", "sparse", ...homeFlags, "--execute", "--confirm", "sparse", "--json"], { ghFactory: () => gh }));
    expect((reset.json as { archive_path: string }).archive_path).toContain("sparse-reset-");

    makeLegacy(world);
    const refusedUpgrade = await captureJson(() => cmdOrg(["upgrade", "--org-home", world.orgHome, "--state-home", world.stateHome, "--archive-root", join(world.root, "upgrade-archives"), "--authority", "preserve", "--json"]));
    expect(refusedUpgrade.code).toBe(2);
    expect(refusedUpgrade.json).toMatchObject({ executable: false, blockers: [{ code: "authority_choice_required" }] });
    const upgradeArgs = ["upgrade", "--org-home", world.orgHome, "--state-home", world.stateHome, "--archive-root", join(world.root, "upgrade-archives"), "--authority", "delegated-operator", "--json"];
    const upgradePlanA = await captureJson(() => cmdOrg(upgradeArgs));
    const upgradePlanB = await captureJson(() => cmdOrg(upgradeArgs));
    expect(upgradePlanA.text).toBe(upgradePlanB.text);
    expect((upgradePlanA.json as { executable: boolean }).executable).toBe(true);
    expect((await captureJson(() => cmdOrg([...upgradeArgs, "--execute"]))).code).toBe(0);

    const sourceBefore = sourceSnapshot(world.git.clone.root);
    const bootstrap = await captureJson(() => cmdBootstrap([
      world.git.clone.root,
      "--answers-from", "sparse",
      "--org-home", world.orgHome,
      "--state-home", world.stateHome,
      "--json",
    ]));
    const bootstrapJson = bootstrap.json as { immutable_source: boolean; managed_clone: string; onboarding_commit: string; provider: ProviderZeros };
    expect(bootstrapJson).toMatchObject({ immutable_source: true, provider: ZERO_PROVIDER });
    expect(sourceSnapshot(world.git.clone.root)).toEqual(sourceBefore);
    expect((await captureJson(() => cmdBootstrap([
      world.git.clone.root,
      "--answers-from", "sparse",
      "--org-home", world.orgHome,
      "--state-home", world.stateHome,
      "--json",
    ]))).json).toMatchObject({ onboarding_commit: bootstrapJson.onboarding_commit });

    // Inject a deterministic non-billable readiness probe so the CLI never
    // contacts a real adapter and its JSON stays byte-stable. In production the
    // seam is unset and verify runs the real `probeRuntimeReadiness` that
    // `operon doctor` uses (B-LIVE-04).
    const cliOptions = { readinessProbe: READY_RUNTIME_PROBE, ghFactory: () => gh };
    const unreachable = await captureJson(() => cmdApp(["verify", "sparse", ...homeFlags, "--json"], cliOptions));
    expect(unreachable.code).toBe(2);
    expect((unreachable.json as { status: string; provider: ProviderZeros })).toMatchObject({ status: "blocked", provider: ZERO_PROVIDER });
    git(bootstrapJson.managed_clone, "push", "origin", "HEAD:main");
    const verified = await captureJson(() => cmdApp(["verify", "sparse", ...homeFlags, "--json"], cliOptions));
    expect(verified.code).toBe(0);
    expect(verified.json).toMatchObject({ status: "ready", evidence_state: "runtime-ready", provider: ZERO_PROVIDER });

    const promoteArgs = ["promote", "sparse", ...homeFlags, "--to", "live", "--json"];
    const promotePlanA = await captureJson(() => cmdApp(promoteArgs, cliOptions));
    const promotePlanB = await captureJson(() => cmdApp(promoteArgs, cliOptions));
    expect(promotePlanA.text).toBe(promotePlanB.text);
    expect((promotePlanA.json as { executable: boolean }).executable).toBe(true);
    const promoted = await captureJson(() => cmdApp([...promoteArgs, "--execute"], cliOptions));
    expect(promoted.json).toMatchObject({ status: "promoted", verification: { status: "ready", registry_status: "live", provider: ZERO_PROVIDER } });
    const rerun = await captureJson(() => cmdApp([...promoteArgs, "--execute"], cliOptions));
    expect(rerun.json).toMatchObject({ status: "already_live" });
    expect(sourceSnapshot(world.git.clone.root)).toEqual(sourceBefore);
    expect(Date.now() - startedAt).toBeLessThanOrEqual(5 * 60_000);
  }, 60_000);
});

interface ProviderZeros { factories: 0; processes: 0; turns: 0; settlements: 0 }
const ZERO_PROVIDER: ProviderZeros = { factories: 0, processes: 0, turns: 0, settlements: 0 };

async function captureJson(run: () => Promise<number>): Promise<{ code: number; text: string; json: unknown }> {
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => lines.push(args.map(String).join(" ")));
  try {
    const code = await run();
    const text = lines.join("\n");
    return { code, text, json: JSON.parse(text) as unknown };
  } finally {
    log.mockRestore();
  }
}

function envelope(status: string): string {
  return `${JSON.stringify({
    schema_version: 1,
    run_id: "stale",
    trace_id: "stale",
    app: "sparse",
    pipeline: "build",
    pass: "implement",
    role: "builder",
    status,
    started_at: "2026-07-01T00:00:00.000Z",
    last_seen_at: "2026-07-01T00:00:00.000Z",
    refs: { events: "events.jsonl", brief: "brief.md", output: "output.md", session_log: "session.log" },
  }, null, 2)}\n`;
}

function write(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}
