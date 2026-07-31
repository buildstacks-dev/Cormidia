import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { executeAppReset, planAppReset } from "../../src/org/app-reset.js";
import {
  bootstrapFromRecoveredAnswers,
  executeAppPromotion,
  planAppPromotion,
  verifyApp,
} from "../../src/org/app-lifecycle.js";
import { joinExistingOrg, loadApps } from "../../src/org/apps.js";
import { initOrgHome } from "../../src/org/home.js";
import { readAnswersFromResetArchive, storeOnboardingAnswers } from "../../src/org/onboarding-answers.js";
import { executeOrgUpgrade, planOrgUpgrade } from "../../src/org/org-upgrade.js";
import { readEfficiencyEvidence } from "../../src/loop/efficiency.js";
import { makeBareWithCloneAt } from "../fixtures/gitRepo.js";
import { FakeGhOps } from "../support/fakeGhOps.js";
import { READY_RUNTIME_PROBE } from "./helpers.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const ANSWERS = {
  product: "A sparse deterministic lifecycle fixture.",
  good: "Every lifecycle transition is mechanical and reversible.",
  roles: ["planner"],
  budgetUsdMonth: 100,
  authority: { mode: "inherit" },
};

describe("C-LIFE-01 LIFE-LEGACY-001 production lifecycle plane", () => {
  it("runs reset/refusal/recovery/upgrade/non-default bootstrap/verify/promote with zero providers and a safe rerun", async () => {
    const activeStartedAt = Date.now();
    const root = mkdtempSync(join(tmpdir(), "operon-life-production-")); roots.push(root);
    const orgHome = join(root, "org");
    const stateHome = join(root, "state");
    const archiveRoot = join(root, "archives");
    const appGit = makeBareWithCloneAt(join(root, "git"));
    appGit.clone.commit("chore: executable lifecycle fixture", {
      "package.json": `${JSON.stringify({
        name: "sparse",
        private: true,
        scripts: { test: "node -e \"process.exit(0)\"", lint: "node -e \"process.exit(0)\"" },
      }, null, 2)}\n`,
    });
    appGit.clone.git("push", "origin", "main");
    appGit.clone.git("checkout", "-b", "human/topic");
    appGit.clone.commit("docs: human topic", { "human.md": "human branch\n" });
    writeFileSync(join(appGit.clone.root, "untracked.txt"), "human untracked\n");

    await initOrgHome({ target: orgHome, name: "legacy-eval", stateHome, homeDir: join(root, "home") });
    await joinExistingOrg(orgHome, { name: "sparse", repo: "local/sparse", status: "onboarding", cadence: { planner: [] } });
    await joinExistingOrg(orgHome, { name: "second", repo: "local/second", status: "live", cadence: {} });
    await storeOnboardingAnswers(stateHome, "sparse", (await import("../../src/org/bootstrap.js")).parseAnswers(ANSWERS, ["planner", "builder", "reviewer", "sre", "support", "marketing", "distiller", "learning-reviewer"]));
    seedLegacyOrg(orgHome);
    write(stateHome, "runs/sparse/stale/envelope.json", stableEnvelope("running"));
    write(stateHome, "approvals/pending/eval-only.json", `${JSON.stringify({ id: "eval-only", app: "sparse" })}\n`);
    const gh = new FakeGhOps({ repo: "local/sparse" });
    const resetInput = async (force = false) => ({
      orgHome,
      stateHome,
      appsFile: await loadApps(join(orgHome, "apps.yaml")),
      appName: "sparse",
      gh,
      archiveRoot,
      now: new Date("2026-07-14T00:00:00.000Z"),
      ...(force ? { force: true } : {}),
    });

    const refused = await planAppReset(await resetInput());
    expect(refused.blockers.map((blocker) => blocker.code)).toEqual(["stale_run", "pending_approval"]);
    expect(refused.blockers.find((blocker) => blocker.code === "stale_run")?.forceEligible).toBe(true);
    unlinkSync(join(stateHome, "approvals", "pending", "eval-only.json"));
    write(stateHome, "approvals/decided/eval-only.json", `${JSON.stringify({ id: "eval-only", app: "sparse", decision: "deny" })}\n`);
    write(stateHome, "runs/sparse/stale/envelope.json", stableEnvelope("cancelled"));

    const executableReset = await planAppReset(await resetInput());
    expect(executableReset.blockers).toEqual([]);
    const reset = await executeAppReset(await resetInput(), executableReset);
    expect((await loadApps(join(orgHome, "apps.yaml"))).apps.map((app) => app.name)).toEqual(["second"]);
    expect(existsSync(join(stateHome, "runs", "sparse"))).toBe(false);
    const recovered = await readAnswersFromResetArchive(reset.archivePath);
    expect(recovered).toMatchObject({ product: ANSWERS.product, roles: ["planner"] });

    const upgradeInput = { orgHome, stateHome, archiveRoot: join(root, "upgrade-archives"), authorityChoice: "delegated-operator" as const };
    const legacyBeforePlan = readFileSync(join(orgHome, "apps.yaml"), "utf8");
    const upgradePlan = await planOrgUpgrade(upgradeInput);
    expect(readFileSync(join(orgHome, "apps.yaml"), "utf8")).toBe(legacyBeforePlan);
    expect(upgradePlan.changes.map((change) => change.path)).toEqual(["apps.yaml", "AUTHORITY.md"]);
    const upgrade = await executeOrgUpgrade(upgradeInput, upgradePlan);
    expect(upgrade.doctor.status).toBe("pass");

    const sourceBefore = sourceSnapshot(appGit.clone.root);
    const bootstrap = await bootstrapFromRecoveredAnswers(appGit.clone.root, recovered, { orgHome, stateHome, appName: "sparse" });
    expect(sourceSnapshot(appGit.clone.root)).toEqual(sourceBefore);
    expect(bootstrap.defaultBranch).toBe("main");
    const bootstrapRerun = await bootstrapFromRecoveredAnswers(appGit.clone.root, recovered, { orgHome, stateHome, appName: "sparse" });
    expect(bootstrapRerun.onboardingCommit).toBe(bootstrap.onboardingCommit);
    expect(sourceSnapshot(appGit.clone.root)).toEqual(sourceBefore);

    const unreachable = await verifyApp({ orgHome, stateHome, appName: "sparse", readinessProbe: READY_RUNTIME_PROBE });
    expect(unreachable.status).toBe("blocked");
    expect(unreachable.checks.find((check) => check.id === "onboarding-reachable")?.status).toBe("blocked");
    expect(unreachable.provider).toEqual({ factories: 0, processes: 0, turns: 0, settlements: 0 });

    execGit(bootstrap.managedClone, "push", "origin", "HEAD:main");
    const ready = await verifyApp({ orgHome, stateHome, appName: "sparse", readinessProbe: READY_RUNTIME_PROBE });
    expect(ready).toMatchObject({ status: "ready", evidence_state: "runtime-ready", registry_status: "onboarding" });
    expect(ready.managed_head).toBe(ready.remote_head);

    const registryBeforePromotionPlan = readFileSync(join(orgHome, "apps.yaml"), "utf8");
    const remoteBeforePromotionPlan = appGit.bare.git("rev-parse", "main");
    const promotionPlan = await planAppPromotion({ orgHome, stateHome, appName: "sparse", to: "live", readinessProbe: READY_RUNTIME_PROBE });
    expect(readFileSync(join(orgHome, "apps.yaml"), "utf8")).toBe(registryBeforePromotionPlan);
    expect(appGit.bare.git("rev-parse", "main")).toBe(remoteBeforePromotionPlan);
    expect(promotionPlan).toMatchObject({ executable: true, idempotent: false, from: "onboarding", to: "live" });
    const promotion = await executeAppPromotion({ orgHome, stateHome, appName: "sparse", to: "live", readinessProbe: READY_RUNTIME_PROBE }, promotionPlan);
    expect(promotion).toMatchObject({ status: "promoted", verification: { status: "ready", registry_status: "live", evidence_state: "live" } });
    const rerunPlan = await planAppPromotion({ orgHome, stateHome, appName: "sparse", to: "live", readinessProbe: READY_RUNTIME_PROBE });
    const rerun = await executeAppPromotion({ orgHome, stateHome, appName: "sparse", to: "live", readinessProbe: READY_RUNTIME_PROBE }, rerunPlan);
    expect(rerun.status).toBe("already_live");
    expect(sourceSnapshot(appGit.clone.root)).toEqual(sourceBefore);
    expect((await loadApps(join(orgHome, "apps.yaml"))).apps.find((app) => app.name === "second")?.status).toBe("live");

    const evidence = await readEfficiencyEvidence(stateHome);
    const lifecycleEpisodes = evidence.filter((episode) => episode.route?.episode_id.startsWith("lifecycle:") === true);
    const lifecycleSteps = lifecycleEpisodes.flatMap((episode) => episode.steps).filter((step) => step.kind === "mechanical");
    expect(lifecycleSteps.length).toBeGreaterThanOrEqual(5);
    expect(lifecycleSteps.every((step) => step.provider_turn_id === null && step.usage === null)).toBe(true);
    expect(lifecycleEpisodes.every((episode) => episode.route?.terminal !== null && episode.steps.length === 1 && episode.pending_started.length === 0 && episode.corrupt_files.length === 0)).toBe(true);
    expect(existsSync(join(stateHome, "telemetry"))).toBe(false);
    expect(readFileSync(join(process.cwd(), "src", "org", "app-lifecycle.ts"), "utf8")).not.toMatch(/createRuntime|RuntimeFactory|runtimeFactory/);
    expect(Date.now() - activeStartedAt).toBeLessThanOrEqual(5 * 60_000);
  }, 60_000);
});

function seedLegacyOrg(orgHome: string): void {
  unlinkSync(join(orgHome, "AUTHORITY.md"));
  const path = join(orgHome, "apps.yaml");
  const raw = parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  delete raw["schema_version"];
  writeFileSync(path, stringify(raw), "utf8");
}

function stableEnvelope(status: string): string {
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
  const path = join(root, rel); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content, "utf8");
}

function sourceSnapshot(root: string): Record<string, string> {
  const status = execGit(root, "status", "--porcelain=v2", "--untracked-files=all", false);
  return {
    branch: execGit(root, "branch", "--show-current"),
    head: execGit(root, "rev-parse", "HEAD"),
    status,
    patch: createHash("sha256").update(execGit(root, "diff", "--binary", "HEAD", false)).digest("hex"),
  };
}

function execGit(root: string, ...argsAndMaybeTrim: Array<string | boolean>): string {
  const trim = typeof argsAndMaybeTrim.at(-1) === "boolean" ? argsAndMaybeTrim.pop() as boolean : true;
  const args = argsAndMaybeTrim as string[];
  const output = execFileSync("git", args, {
    cwd: root,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
  });
  return trim ? output.trim() : output;
}
