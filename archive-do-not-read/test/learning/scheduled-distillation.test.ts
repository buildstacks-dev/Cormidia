// M6 ordinary-turn integration: distiller and independent reviewer execute
// through runDispatchedTurn and a durable creator-scoped EpisodePlan, use
// native schemas, settle in the org ledger/learning overlay, append scorecards,
// and persist governed records.

import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdLearn } from "../../src/cli/learn.js";
import { rollupLearningSpend } from "../../src/org/budget.js";
import { writeJournalPatch } from "../../src/org/journal.js";
import { episodeIdFor } from "../../src/loop/efficiency.js";
import { readCurrentEpisodePlan } from "../../src/loop/episode-plan.js";
import { listCandidateArtifacts } from "../../src/org/learning/candidate-store.js";
import { appLearningRoot } from "../../src/org/learning/concepts.js";
import { listM6RunRecords, prepareDistillation } from "../../src/org/learning/distillation.js";
import { createLearningEventSink } from "../../src/org/learning/events.js";
import { defaultLearningPolicy } from "../../src/org/learning/policy.js";
import { readReviewerVerdict } from "../../src/org/learning/review.js";
import { loadRoles } from "../../src/org/roles.js";
import { readScorecards } from "../../src/org/scorecards.js";
import { runDispatchedTurn } from "../../src/org/turn-runner.js";
import { readTurnRecords } from "../../src/runtime/telemetry.js";
import type { Runtime, TurnRequest, TurnResult } from "../../src/runtime/types.js";
import { makeBareWithClone } from "../fixtures/gitRepo.js";
import { FakeClock } from "../fixtures/fakeClock.js";
import { makeOrgHome } from "../fixtures/orgHome.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const cleanups: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (cleanups.length > 0) cleanups.pop()!();
});

describe("M6 scheduled turns", () => {
  it("exposes operon learn distill --dry-run as a token-free deterministic precheck", async () => {
    const org = makeOrgHome();
    const state = makeOrgHome({ state: true });
    const git = makeBareWithClone();
    cleanups.push(org.cleanup, state.cleanup, git.cleanup);
    for (const entry of ["TASTE.md", "roles.yaml", "pipelines.yaml", "prompts", "taste"]) {
      cpSync(join(ROOT, entry), join(org.root, entry), { recursive: true });
    }
    writeFileSync(
      join(org.root, "apps.yaml"),
      [
        "schema_version: 1",
        "org: { name: m6-cli, max_concurrent_turns: 1 }",
        "defaults: { budget_usd_month: 1000 }",
        "apps:",
        "  alpha:",
        `    repo: ${JSON.stringify(git.clone.root)}`,
        "    status: live",
        "",
      ].join("\n"),
    );
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      logs.push(parts.join(" "));
    });
    expect(await cmdLearn([
      "distill",
      "--dry-run",
      "--org-home",
      org.root,
      "--state-home",
      state.root,
    ])).toBe(0);
    expect(JSON.parse(logs.join("\n"))).toMatchObject({
      status: "skipped",
      reason: "no_actionable_evidence",
    });
  });

  it("records an empty-window skip with zero provider calls and no telemetry spend", async () => {
    const org = makeOrgHome();
    const state = makeOrgHome({ state: true, approvals: true });
    const git = makeBareWithClone();
    cleanups.push(org.cleanup, state.cleanup, git.cleanup);
    for (const entry of ["TASTE.md", "roles.yaml", "pipelines.yaml", "prompts", "taste"]) {
      cpSync(join(ROOT, entry), join(org.root, entry), { recursive: true });
    }
    const app = {
      name: "alpha",
      repo: git.bare.root,
      status: "live" as const,
      budgetUsdMonth: 1000,
      cadence: {},
    };
    const appsFile = {
      org: { name: "m6-empty", maxConcurrentTurns: 1 },
      defaults: { budgetUsdMonth: 1000 },
      apps: [app],
    };
    const role = (await loadRoles(join(org.root, "roles.yaml"))).roles.find(
      (entry) => entry.name === "distiller",
    )!;
    const clock = new FakeClock("2026-07-13T06:00:00.000Z");
    await writeJournalPatch(state.root, "turn-empty", {
      role: role.name,
      app: app.name,
      phase: "assembling",
      attempt: 0,
      triggerKind: "schedule",
      trigger: "daily 06:00",
    }, clock.now());
    let calls = 0;
    const runtime: Runtime = {
      kind: "claude",
      async runTurn() {
        calls += 1;
        throw new Error("empty evidence must not reach a provider");
      },
    };
    expect((await runDispatchedTurn({
      role,
      app,
      appsFile,
      turnId: "turn-empty",
      orgRoot: org.root,
      runtimeHome: state.root,
      runtimeFor: (selected) => ({ ...runtime, kind: selected.runtime }),
      now: () => clock.now(),
    })).status).toBe("completed");
    expect(calls).toBe(0);
    expect(await readTurnRecords(state.root)).toEqual([]);
    expect(await listM6RunRecords(state.root)).toMatchObject([
      { status: "skipped", reason: "no_actionable_evidence", model_turns: 0 },
    ]);
  });

  it("fails malformed M6 output after its single planned provider turn without a hidden reformat", async () => {
    const org = makeOrgHome();
    const state = makeOrgHome({ state: true, approvals: true });
    const git = makeBareWithClone();
    cleanups.push(org.cleanup, state.cleanup, git.cleanup);
    for (const entry of ["TASTE.md", "roles.yaml", "pipelines.yaml", "prompts", "taste"]) {
      cpSync(join(ROOT, entry), join(org.root, entry), { recursive: true });
    }
    const app = {
      name: "alpha",
      repo: git.bare.root,
      status: "live" as const,
      budgetUsdMonth: 1000,
      cadence: {},
    };
    const appsFile = {
      org: { name: "m6-invalid", maxConcurrentTurns: 1 },
      defaults: { budgetUsdMonth: 1000 },
      apps: [app],
    };
    const clock = new FakeClock("2026-07-13T06:00:00.000Z");
    const sink = createLearningEventSink(state.root);
    for (const id of ["evt_invalid_1", "evt_invalid_2"]) {
      await sink.emit({
        event_id: id,
        episode_id: `ep_invalid_${id.slice(-1)}`,
        ts: "2026-07-12T12:00:00.000Z",
        app: "alpha",
        agent_role: "builder",
        type: "error",
        error_class: "review.missing_test_mapping",
        cause_hypothesis: "criteria were not mapped",
        emitter: "orchestrator",
        source_channel: "internal",
        trust: "trusted",
      });
    }
    const role = (await loadRoles(join(org.root, "roles.yaml"))).roles.find(
      (entry) => entry.name === "distiller",
    )!;
    await writeJournalPatch(state.root, "turn-invalid-distill", {
      role: role.name,
      app: app.name,
      phase: "assembling",
      attempt: 0,
      triggerKind: "schedule",
      trigger: "daily 06:00",
    }, clock.now());
    let calls = 0;
    const runtime: Runtime = {
      kind: "claude",
      async runTurn(req) {
        calls += 1;
        return result(req, "not a valid distillation verdict", 0.25);
      },
    };

    const outcome = await runDispatchedTurn({
      role,
      app,
      appsFile,
      turnId: "turn-invalid-distill",
      orgRoot: org.root,
      runtimeHome: state.root,
      runtimeFor: (selected) => ({ ...runtime, kind: selected.runtime }),
      now: () => clock.now(),
    });

    expect(outcome.status).toBe("failed");
    expect(calls).toBe(1);
    expect(await listM6RunRecords(state.root)).toMatchObject([{
      status: "failed",
      model_turns: 1,
    }]);
    const plan = await readCurrentEpisodePlan(
      state.root,
      episodeIdFor({ app: "alpha", traceId: "turn-invalid-distill" }),
    );
    expect(plan).toMatchObject({
      planningSource: "creator_scope",
      steps: [{
        kind: "provider_turn",
        id: "gp-learning-distill-distill",
        assignmentSource: "configured",
      }],
    });
  });

  it("settles distiller/reviewer telemetry and budget attribution, records scorecards, and persists structured review", async () => {
    const org = makeOrgHome();
    const state = makeOrgHome({ state: true, approvals: true });
    const git = makeBareWithClone();
    cleanups.push(org.cleanup, state.cleanup, git.cleanup);
    for (const entry of ["TASTE.md", "roles.yaml", "pipelines.yaml", "prompts", "taste"]) {
      cpSync(join(ROOT, entry), join(org.root, entry), { recursive: true });
    }

    const app = {
      name: "alpha",
      repo: git.bare.root,
      status: "live" as const,
      budgetUsdMonth: 1000,
      cadence: {},
    };
    const appsFile = {
      org: { name: "m6-test", maxConcurrentTurns: 2 },
      defaults: { budgetUsdMonth: 1000 },
      apps: [app],
    };
    const clock = new FakeClock("2026-07-13T06:00:00.000Z");
    const sink = createLearningEventSink(state.root);
    for (const id of ["evt_live_1", "evt_live_2"]) {
      await sink.emit({
        event_id: id,
        episode_id: `ep_alpha_ticket_${id.slice(-1)}`,
        ts: "2026-07-12T12:00:00.000Z",
        app: "alpha",
        agent_role: "builder",
        type: "error",
        error_class: "review.missing_test_mapping",
        cause_hypothesis: "criteria were not mapped",
        emitter: "orchestrator",
        source_channel: "internal",
        trust: "trusted",
      });
    }
    const preparation = await prepareDistillation({
      orgHome: org.root,
      stateHome: state.root,
      app: "alpha",
      appWorkdir: git.clone.root,
      appStages: { alpha: "live" },
      policy: defaultLearningPolicy(),
      now: clock.now(),
    });
    const fingerprint = preparation.clusters[0]!.fingerprint;
    const schemaCalls: Array<{ role: string; schema: boolean }> = [];
    const runtime: Runtime = {
      kind: "claude",
      async runTurn(req: TurnRequest): Promise<TurnResult> {
        schemaCalls.push({ role: req.role.name, schema: req.verdictSchema !== undefined });
        if (req.role.name === "distiller") {
          return result(
            req,
            JSON.stringify({
              candidates: [
                {
                  cluster_fingerprint: fingerprint,
                  destination: "ticket",
                  title: "Make test mapping deterministic",
                  proposed_scope: "apps/alpha",
                  proposed_tier: "T1",
                  claims_efficacy: false,
                  draft_summary: "Add a complete criterion-to-test map",
                  draft_body: "Implement and verify the mapping.",
                  acceptance: ["Every criterion names a test."],
                  topic_key: "review.missing_test_mapping",
                },
              ],
            }),
            1,
          );
        }
        const candidateId = /"candidate_id":\s*"([^"]+)"/.exec(req.task)?.[1];
        if (candidateId === undefined) throw new Error("review brief omitted candidate id");
        return result(
          req,
          JSON.stringify({
            reviews: [
              {
                candidate_id: candidateId,
                verdict: "approve",
                proposed_destination: "ticket",
                proposed_tier: "T1",
                proposed_scope: "apps/alpha",
                experiment_required: false,
                rubric: {
                  correctness: 5,
                  generality: 4,
                  scope_fit: 5,
                  destination_fit: 5,
                  provenance_trust: 5,
                  injection_screen: "clean",
                },
                conflicts_with: [],
                duplicates: [],
                eval_required: false,
                eval_present: false,
                rationale: "Trusted evidence supports the narrow ticket destination.",
              },
            ],
          }),
          2,
        );
      },
    };
    const roles = (await loadRoles(join(org.root, "roles.yaml"))).roles;
    const distiller = roles.find((role) => role.name === "distiller")!;
    const reviewer = roles.find((role) => role.name === "learning-reviewer")!;

    await writeJournalPatch(state.root, "turn-distill", {
      role: distiller.name,
      app: app.name,
      phase: "assembling",
      attempt: 0,
      triggerKind: "schedule",
      trigger: "daily 06:00",
    }, clock.now());
    expect((await runDispatchedTurn({
      role: distiller,
      app,
      appsFile,
      turnId: "turn-distill",
      orgRoot: org.root,
      runtimeHome: state.root,
      runtimeFor: (selected) => ({ ...runtime, kind: selected.runtime }),
      now: () => clock.now(),
    })).status).toBe("completed");

    // A retry after the provider/verdict became durable closes from the same
    // accepted plan and exact assignment; it must not run distillation again.
    expect((await runDispatchedTurn({
      role: distiller,
      app,
      appsFile,
      turnId: "turn-distill",
      orgRoot: org.root,
      runtimeHome: state.root,
      runtimeFor: (selected) => ({ ...runtime, kind: selected.runtime }),
      now: () => clock.now(),
    })).status).toBe("completed");
    expect(schemaCalls).toEqual([{ role: "distiller", schema: true }]);

    const managedRoot = appLearningRoot(join(state.root, "repos", "alpha"));
    const candidate = (await listCandidateArtifacts(managedRoot))[0]!;
    clock.set("2026-07-13T07:00:00.000Z");
    await writeJournalPatch(state.root, "turn-learning-review", {
      role: reviewer.name,
      app: app.name,
      phase: "assembling",
      attempt: 0,
      triggerKind: "schedule",
      trigger: "weekly mon 07:00",
    }, clock.now());
    expect((await runDispatchedTurn({
      role: reviewer,
      app,
      appsFile,
      turnId: "turn-learning-review",
      orgRoot: org.root,
      runtimeHome: state.root,
      runtimeFor: (selected) => ({ ...runtime, kind: selected.runtime }),
      now: () => clock.now(),
    })).status).toBe("completed");

    expect(schemaCalls).toEqual([
      { role: "distiller", schema: true },
      { role: "learning-reviewer", schema: true },
    ]);
    expect(await readReviewerVerdict(org.root, candidate.candidate_id)).toMatchObject({
      verdict: "approve",
      reviewed_by: expect.stringContaining("learning-reviewer:codex/"),
    });
    const telemetry = await readTurnRecords(state.root);
    expect(telemetry.map((row) => [row.role, row.learningActivity, row.costUsd])).toEqual([
      ["distiller", "distillation", 1],
      ["learning-reviewer", "review", 2],
    ]);
    expect((await rollupLearningSpend(state.root, clock.now())).monthUsd).toBe(3);
    expect(await readScorecards(state.root, "alpha", "distiller")).toHaveLength(1);
    expect(await readScorecards(state.root, "alpha", "learning-reviewer")).toHaveLength(1);
  });
});

function result(req: TurnRequest, summary: string, costUsd: number): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime: req.role.runtime, id: `session-${req.role.name}` },
    usage: {
      tokensIn: 100,
      tokensOut: 20,
      costUsd,
      subagentTurns: 0,
      wallClockMs: 50,
    },
    escalations: [],
  };
}
