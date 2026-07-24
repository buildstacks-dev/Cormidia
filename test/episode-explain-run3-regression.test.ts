// ISSUE-025 — `operon episode explain` must never hard-fail.
//
// Every fixture under test/fixtures/episodes/run3/ is a verbatim copy of a
// real run-3 durable episode (~/.operon/Buildstacks/efficiency/episodes/), so
// these assertions run against the exact bytes that produced
// "step <id> has 0 matching route authorizations" and no other output.
//
// The fixtures are hermetic and offline: no provider, no network, no clock.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  efficiencyEpisodeDir,
  routeRecordPath,
  type RouteRecord,
} from "../src/loop/efficiency.js";
import { explainEpisode } from "../src/org/episode-planner/orchestrator.js";

const FIXTURE_DIR = join(import.meta.dirname, "fixtures", "episodes", "run3");

/** Captured episode → the efficiency-namespace id it is filed under. The id
 * is what hashes to the on-disk directory name, so a fixture copied under the
 * wrong id would silently look like a missing episode. */
const CAPTURED = {
  replanFree: { dir: "replan-free-ticket-9", id: "ticket:sonnet4-buildstack-dev:#9" },
  replanned: { dir: "replanned-ticket-2", id: "ticket:sonnet4-buildstack-dev:#2" },
  routeOnly: {
    dir: "route-only-lifecycle",
    id: "lifecycle:sonnet4-buildstack-dev:9b66e5d4560b23acb99f",
  },
  intentOnly: { dir: "intent-only-ticket-1", id: "ticket:sonnet4-buildstack-dev:#1" },
} as const;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Materialize captured episodes into a throwaway state home at the exact
 * hashed path the production reader derives from the episode id. */
function stateHomeWith(...episodes: { dir: string; id: string }[]): string {
  const root = mkdtempSync(join(tmpdir(), "operon-explain-run3-"));
  roots.push(root);
  for (const episode of episodes) {
    cpSync(join(FIXTURE_DIR, episode.dir), efficiencyEpisodeDir(root, episode.id), {
      recursive: true,
    });
  }
  return root;
}

describe("episode explain over captured run-3 evidence", () => {
  it("resolves a replanned episode's already-completed step from the version that authorized it", async () => {
    const root = stateHomeWith(CAPTURED.replanned);

    const explanation = await explainEpisode(root, CAPTURED.replanned.id);

    // The regression: plan-current points at v2, `contract` completed under
    // v1, and the route deliberately holds no v2 pass for it.
    expect(explanation.plan?.version).toBe(2);
    const contract = explanation.steps.find((step) => step.id === "contract");
    expect(contract).toMatchObject({
      kind: "provider_turn",
      status: "completed",
      authorizationStatus: "authorized_at_prior_plan_version",
      authorizedPlanVersion: 1,
      routeAuthorized: true,
      role: "builder",
      assignmentCandidateId: "configured",
      providerFamily: "openai",
    });
    expect(contract).toHaveProperty("authorizationDetail", expect.stringContaining("plan v1"));

    // Steps the revision did re-authorize stay plainly authorized.
    expect(explanation.steps.find((step) => step.id === "implement")).toMatchObject({
      authorizationStatus: "authorized",
      authorizedPlanVersion: 2,
      authorizationDetail: null,
    });

    // This case's subject is cross-plan-version step AUTHORIZATION, so what it
    // must guard is that nothing about authorization is unresolved, stale, or
    // unreadable. It no longer asserts an empty problem list: #174 made explain
    // report the episode's real state, and this captured episode genuinely is
    // still running with a failed `implement` step, so it now (correctly)
    // yields `episode_execution_incomplete` and `step_failed`.
    const AUTHORIZATION_PROBLEM_CODES = [
      "step_authorization_unresolved",
      "step_authorization_stale",
    ];
    expect(explanation.problems.filter((problem) =>
      AUTHORIZATION_PROBLEM_CODES.includes(problem.code) ||
      problem.code.endsWith("_unreadable"))).toEqual([]);
    // The problems that DO surface are exactly the execution-state pair #174
    // requires; anything else appearing here is a new regression.
    expect(explanation.problems.map((problem) => problem.code).sort()).toEqual([
      "episode_execution_incomplete",
      "step_failed",
    ]);
    // #174: `complete` is true only when every required step completed and no
    // revision is active. Neither holds for this captured episode.
    expect(explanation.complete).toBe(false);
  });

  it("explains a replan-free episode with every step authorized at the current version", async () => {
    const root = stateHomeWith(CAPTURED.replanFree);

    const explanation = await explainEpisode(root, CAPTURED.replanFree.id);

    expect(explanation.complete).toBe(true);
    expect(explanation.plan?.version).toBe(1);
    expect(explanation.journal?.status).toBe("completed");
    const providerSteps = explanation.steps.filter((step) => step.kind === "provider_turn");
    expect(providerSteps).toHaveLength(3);
    for (const step of providerSteps) {
      expect(step).toMatchObject({
        authorizationStatus: "authorized",
        authorizedPlanVersion: 1,
        authorizationDetail: null,
        status: "completed",
      });
    }
    expect(explanation.executionSteps.length).toBeGreaterThan(0);
  });

  it("still renders a route-only episode that never had an intent or a plan", async () => {
    const root = stateHomeWith(CAPTURED.routeOnly);

    const explanation = await explainEpisode(root, CAPTURED.routeOnly.id);

    expect(explanation.plan).toBeNull();
    expect(explanation.intent).toBeNull();
    expect(explanation.steps).toEqual([]);
    // What IS known is still rendered: the durable route and its steps.
    expect(explanation.route).toMatchObject({
      current_route: "deterministic",
      terminal: { status: "completed" },
    });
    expect(explanation.executionSteps).toEqual([
      expect.objectContaining({ kind: "mechanical", operation: "app verify", status: "completed" }),
    ]);
    expect(explanation.problems.map((problem) => problem.code).sort()).toEqual([
      "intent_missing",
      "plan_missing",
    ]);
    expect(explanation.complete).toBe(false);
  });

  it("renders an episode whose planning never produced an accepted plan", async () => {
    const root = stateHomeWith(CAPTURED.intentOnly);

    const explanation = await explainEpisode(root, CAPTURED.intentOnly.id);

    expect(explanation.intent).not.toBeNull();
    expect(explanation.intentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(explanation.plan).toBeNull();
    expect(explanation.route).toBeNull();
    expect(explanation.problems).toEqual([
      { code: "plan_missing", message: expect.any(String), stepId: null },
    ]);
    expect(explanation.complete).toBe(false);
    expect(explanation.executionSteps.length).toBeGreaterThan(0);
  });

  it("reports an unknown episode id instead of throwing, and names where it looked", async () => {
    const root = stateHomeWith(CAPTURED.replanFree);

    const explanation = await explainEpisode(root, "ticket:sonnet4-buildstack-dev:#999");

    expect(explanation.complete).toBe(false);
    expect(explanation.problems).toEqual([
      {
        code: "episode_evidence_missing",
        message: expect.stringContaining(
          efficiencyEpisodeDir(root, "ticket:sonnet4-buildstack-dev:#999"),
        ),
        stepId: null,
      },
    ]);
    expect(explanation.evidenceDir).toBe(
      efficiencyEpisodeDir(root, "ticket:sonnet4-buildstack-dev:#999"),
    );
  });

  it("never throws on any captured run-3 episode", async () => {
    const root = stateHomeWith(...Object.values(CAPTURED));

    for (const episode of Object.values(CAPTURED)) {
      await expect(explainEpisode(root, episode.id)).resolves.toMatchObject({
        episodeId: episode.id,
        schemaVersion: 2,
      });
    }
  });
});

/** Mutate the captured route in place. Each case starts from the real bytes
 * and changes exactly the one thing under test. */
function editRoute(root: string, episodeId: string, edit: (route: RouteRecord) => void): void {
  const path = routeRecordPath(root, episodeId);
  const route = JSON.parse(readFileSync(path, "utf8")) as RouteRecord;
  edit(route);
  writeFileSync(path, `${JSON.stringify(route, null, 2)}\n`, "utf8");
}

describe("episode explain authorization boundary (adversarial near-misses)", () => {
  const episodeId = CAPTURED.replanned.id;

  it("refuses to carry a prior-version pass forward when the revision changed the tuple", async () => {
    const root = stateHomeWith(CAPTURED.replanned);
    // Near-miss: same step id and role at v1, but a different model. This is a
    // revision that genuinely re-assigned an already-completed step, so the v1
    // authorization does NOT explain the v2 step and must not be reused.
    editRoute(root, episodeId, (route) => {
      for (const pass of route.authorized_passes) {
        if (pass.plan_step_id === "contract") pass.model = "gpt-5.6-sol-mini";
      }
    });

    const explanation = await explainEpisode(root, episodeId);

    const contract = explanation.steps.find((step) => step.id === "contract");
    expect(contract).toMatchObject({
      authorizationStatus: "unresolved",
      authorizedPlanVersion: null,
      routeAuthorized: false,
      assignmentCandidateId: null,
      providerFamily: null,
    });
    expect(contract).toHaveProperty(
      "authorizationDetail",
      expect.stringContaining("0 matching route authorizations for plan v2"),
    );
    expect(explanation.problems).toContainEqual({
      code: "step_authorization_unresolved",
      message: expect.stringContaining("0 matching route authorizations"),
      stepId: "contract",
    });
    expect(explanation.complete).toBe(false);
    // Degraded, but still a full explanation: the plan and every other step
    // are rendered rather than replaced by one error line.
    expect(explanation.plan?.version).toBe(2);
    expect(explanation.steps).toHaveLength(7);
    expect(explanation.steps.find((step) => step.id === "implement")).toMatchObject({
      authorizationStatus: "authorized",
    });
  });

  it("refuses to pick a winner when the current version has duplicate authorizations", async () => {
    const root = stateHomeWith(CAPTURED.replanned);
    editRoute(root, episodeId, (route) => {
      const implement = route.authorized_passes.find(
        (pass) => pass.plan_step_id === "implement" && pass.plan_version === 2,
      );
      if (implement === undefined) throw new Error("fixture drift: no v2 implement authorization");
      route.authorized_passes.push({ ...implement });
    });

    const explanation = await explainEpisode(root, episodeId);

    expect(explanation.steps.find((step) => step.id === "implement")).toMatchObject({
      authorizationStatus: "unresolved",
      routeAuthorized: false,
      authorizationDetail: "2 matching route authorizations for plan v2 (expected exactly one)",
    });
    expect(explanation.complete).toBe(false);
  });

  it("flags a carried-forward authorization for a step that has not completed", async () => {
    const root = stateHomeWith(CAPTURED.replanned);
    // Near-miss: `verify` is still pending under v2. Dropping its v2
    // authorization leaves only the identical v1 pass. That explains nothing —
    // an unrun turn needs a current authorization — so the carry-forward must
    // be reported as stale rather than quietly accepted.
    editRoute(root, episodeId, (route) => {
      route.authorized_passes = route.authorized_passes.filter(
        (pass) => !(pass.plan_step_id === "verify" && pass.plan_version === 2),
      );
    });

    const explanation = await explainEpisode(root, episodeId);

    const verify = explanation.steps.find((step) => step.id === "verify");
    expect(verify).toMatchObject({
      status: "pending",
      authorizationStatus: "authorized_at_prior_plan_version",
      authorizedPlanVersion: 1,
    });
    expect(verify).toHaveProperty(
      "authorizationDetail",
      expect.stringContaining("must re-authorize it before it can run"),
    );
    expect(explanation.problems).toContainEqual({
      code: "step_authorization_stale",
      message: expect.stringContaining("but the step is pending"),
      stepId: "verify",
    });
    expect(explanation.complete).toBe(false);
    // The already-completed carry-forward on the same route stays clean.
    expect(explanation.steps.find((step) => step.id === "contract")).toMatchObject({
      status: "completed",
      authorizationStatus: "authorized_at_prior_plan_version",
    });
    expect(explanation.problems.filter((problem) => problem.stepId === "contract")).toEqual([]);
  });

  it("never resolves an authorization filed at a later plan version", async () => {
    const root = stateHomeWith(CAPTURED.replanned);
    // Near-miss: the only `contract` authorization now claims v3, ahead of the
    // accepted plan. A forward-looking pass is not evidence for v2.
    editRoute(root, episodeId, (route) => {
      for (const pass of route.authorized_passes) {
        if (pass.plan_step_id === "contract") pass.plan_version = 3;
      }
    });

    const explanation = await explainEpisode(root, episodeId);

    expect(explanation.steps.find((step) => step.id === "contract")).toMatchObject({
      authorizationStatus: "unresolved",
      authorizedPlanVersion: null,
    });
    expect(explanation.complete).toBe(false);
  });

  it("annotates every provider step when the route record is unreadable", async () => {
    const root = stateHomeWith(CAPTURED.replanned);
    writeFileSync(routeRecordPath(root, episodeId), "{ not json", "utf8");

    const explanation = await explainEpisode(root, episodeId);

    expect(explanation.route).toBeNull();
    expect(explanation.problems.map((problem) => problem.code)).toContain("route_unreadable");
    expect(explanation.complete).toBe(false);
    // The plan and journal still explain the episode.
    expect(explanation.plan?.version).toBe(2);
    expect(explanation.journal?.status).toBe("running");
    for (const step of explanation.steps.filter((entry) => entry.kind === "provider_turn")) {
      expect(step).toMatchObject({ authorizationStatus: "route_missing", routeAuthorized: false });
    }
  });

  it("keeps explaining a plan whose declared intent hash does not match", async () => {
    const root = stateHomeWith(CAPTURED.replanned);
    const intentPath = join(efficiencyEpisodeDir(root, episodeId), "intent.json");
    const intent = JSON.parse(readFileSync(intentPath, "utf8")) as { goal: string };
    intent.goal = `${intent.goal} (tampered)`;
    writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`, "utf8");

    const explanation = await explainEpisode(root, episodeId);

    expect(explanation.problems.map((problem) => problem.code)).toContain("plan_intent_mismatch");
    expect(explanation.complete).toBe(false);
    expect(explanation.plan?.version).toBe(2);
    expect(explanation.steps).toHaveLength(7);
  });
});
