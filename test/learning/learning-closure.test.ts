// Phase 4 sandbox gate: H-CLU-02, H-GOV-01, H-EVAL-03, H-RPT-01.
// Deterministic fixtures only; no runtime construction, network, or provider.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCandidateArtifact } from "../../src/org/learning/candidate-store.js";
import { writeCanaryAssignmentOnce } from "../../src/org/learning/canary.js";
import { orgLearningRoot } from "../../src/org/learning/concepts.js";
import {
  learningEfficiencyHealthPath,
  projectLearningEfficiencyHealth,
} from "../../src/org/learning/efficiency-health.js";
import { createLearningEventSink, type LearningEvent } from "../../src/org/learning/events.js";
import { computeEvalResult, decideExperiment } from "../../src/org/learning/eval-result.js";
import { episodePath, type EpisodeRecord } from "../../src/org/learning/episode.js";
import { declareExperiment } from "../../src/org/learning/experiment.js";
import { writeInterventionRecord } from "../../src/org/learning/intervention.js";
import { defaultLearningPolicy } from "../../src/org/learning/policy.js";
import { writeReviewerVerdict } from "../../src/org/learning/review.js";
import type { CaptureProjectionResult } from "../../src/org/learning/capture.js";
import { makeOrgHome } from "../fixtures/orgHome.js";
import { makeCandidate, makeExperiment, makeIntervention, makeReviewerVerdict } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length > 0) cleanups.pop()!(); });

function event(id: string): LearningEvent {
  return {
    event_id: id,
    episode_id: `ep_alpha_${id}`,
    run_id: `run_${id}`,
    ts: "2026-07-12T00:00:00.000Z",
    app: "alpha",
    agent_role: "builder",
    type: "error",
    error_class: "environment.retry_cluster",
    cause_hypothesis: "multiple verifier-classified environment recovery attempts occurred",
    emitter: "orchestrator",
    source_channel: "efficiency_projection",
    trust: "trusted",
    payload: {
      classification_version: "efficiency-evidence/v1",
      evidence_kind: "provider",
      source_identity: `alpha:${id}`,
    },
  };
}

function capture(): CaptureProjectionResult {
  return {
    mode: "refreshed",
    refreshRequired: false,
    runsProjected: 2,
    runsAlreadyProjected: 0,
    runsPending: 0,
    pendingRuns: [],
    eligibleFinalizedRuns: 2,
    projectedExactlyOnce: 2,
    duplicateProjections: 0,
    ineligibleRuns: [],
    // Both runs yielded evidence, so there is nothing to report as a gap
    // (#141). A zero-yield run with a failure signal would degrade capture.
    runsWithoutEvents: 0,
    runsWithoutEfficiencyEvidence: 0,
    evidenceGaps: [],
    blockedRuns: [],
    eventsEmitted: 2,
    eventsDeduped: 0,
    runsRepaired: 0,
    eventFilesRecovered: 0,
    receiptsNeedingUpgrade: 0,
    warnings: [],
  };
}

describe("Phase 4 token-free learning closure sandbox", () => {
  it("explains actionable and awaiting-review dispositions, then independent review deduplicates idempotently", async () => {
    const org = makeOrgHome();
    const state = makeOrgHome({ state: true });
    cleanups.push(org.cleanup, state.cleanup);
    const sink = createLearningEventSink(state.root);
    await sink.emit(event("evt_env_1"));
    await sink.emit(event("evt_env_2"));
    const root = orgLearningRoot(org.root);
    const before = await projectLearningEfficiencyHealth({
      orgHome: org.root,
      stateHome: state.root,
      capture: capture(),
      policy: defaultLearningPolicy(),
      roots: [root],
    });
    expect(before.governance.candidate_dispositions.actionable).toBe(1);
    expect(before.efficacy.status).toBe("invalid_measurement"); // event volume is not efficacy

    const candidate = makeCandidate({
      candidate_id: "cand_20260712_phase4",
      destination: "ticket",
      proposed_scope: "apps/alpha",
      claims_efficacy: false,
      error_class: "environment.retry_cluster",
      cause_hypothesis: "multiple verifier-classified environment recovery attempts occurred",
      episode_ids: ["ep_alpha_evt_env_1", "ep_alpha_evt_env_2"],
      event_ids: ["evt_env_1", "evt_env_2"],
      evidence_refs: ["learning:event:evt_env_1", "learning:event:evt_env_2"],
      draft: { generated_by: "distiller", source_app: "alpha", source_role: "builder" },
    });
    await writeCandidateArtifact(root, candidate);
    const pending = await projectLearningEfficiencyHealth({
      orgHome: org.root,
      stateHome: state.root,
      capture: capture(),
      policy: defaultLearningPolicy(),
      roots: [root],
    });
    expect(pending.governance.candidate_dispositions.awaiting_review).toBe(1);
    expect(pending.governance.pending_independent_review).toEqual(["cand_20260712_phase4"]);

    await writeReviewerVerdict(org.root, makeReviewerVerdict({
      candidate_id: "cand_20260712_phase4",
      reviewed_by: "learning-reviewer",
      proposed_destination: "ticket",
      proposed_scope: "apps/alpha",
    }));
    const reviewed = await projectLearningEfficiencyHealth({
      orgHome: org.root,
      stateHome: state.root,
      capture: capture(),
      policy: defaultLearningPolicy(),
      roots: [root],
      persist: true,
    });
    expect(reviewed.governance.candidate_dispositions.deduplicated).toBe(1);
    expect(reviewed.governance.lineage_gaps).toEqual([]);
    const first = readFileSync(learningEfficiencyHealthPath(state.root), "utf8");
    await projectLearningEfficiencyHealth({
      orgHome: org.root,
      stateHome: state.root,
      capture: capture(),
      policy: defaultLearningPolicy(),
      roots: [root],
      persist: true,
    });
    expect(readFileSync(learningEfficiencyHealthPath(state.root), "utf8")).toBe(first);
  });

  it("is read-only without explicit refresh and creates no telemetry/provider evidence", async () => {
    const org = makeOrgHome();
    const state = makeOrgHome({ state: true });
    cleanups.push(org.cleanup, state.cleanup);
    const sink = createLearningEventSink(state.root);
    await sink.emit(event("evt_readonly_1"));
    await sink.emit(event("evt_readonly_2"));
    const before = tree(state.root);
    await projectLearningEfficiencyHealth({
      orgHome: org.root,
      stateHome: state.root,
      capture: capture(),
      policy: defaultLearningPolicy(),
      roots: [orgLearningRoot(org.root)],
    });
    expect(tree(state.root)).toEqual(before);
    expect(existsSync(learningEfficiencyHealthPath(state.root))).toBe(false);
    expect(existsSync(join(state.root, "telemetry"))).toBe(false);
  });

  it("reports efficacy only from comparable post-activation control/treatment episodes", async () => {
    const org = makeOrgHome();
    const state = makeOrgHome({ state: true });
    cleanups.push(org.cleanup, state.cleanup);
    const sink = createLearningEventSink(state.root);
    await sink.emit(event("evt_close_1"));
    await sink.emit(event("evt_close_2"));

    const candidateId = "cand_20260712_closed";
    const experimentId = "exp_closed_health_01";
    const evalId = "eval_closed_health_01";
    const candidate = makeCandidate({
      candidate_id: candidateId,
      claims_efficacy: true,
      experiment_ref: experimentId,
      event_ids: ["evt_close_1", "evt_close_2"],
      episode_ids: ["ep_alpha_evt_close_1", "ep_alpha_evt_close_2"],
      evidence_refs: ["learning:event:evt_close_1", "learning:event:evt_close_2"],
      draft: { generated_by: "distiller", source_app: "alpha", source_role: "builder" },
    });
    await writeCandidateArtifact(orgLearningRoot(org.root), candidate);
    await writeReviewerVerdict(org.root, makeReviewerVerdict({
      candidate_id: candidateId,
      reviewed_by: "learning-reviewer",
      experiment_required: true,
      eval_required: true,
      eval_present: true,
    }));

    const declaration = await declareExperiment(makeExperiment({
      experiment_id: experimentId,
      candidate_ref: candidateId,
      primary_metric: { name: "average_review_cycles", expected_direction: "decrease", min_useful_improvement_pct: 20 },
      guardrails: [
        { metric: "merge_success_rate", rule: "must_not_decrease" },
        { metric: "average_cost_usd", rule: "max_increase_pct", pct: 10 },
      ],
      efficacy_protocol: {
        ...(makeExperiment()["efficacy_protocol"] as object),
        baseline: { metric: "average_review_cycles", value: 3, source_ref: "fixture:phase4-control" },
      },
    }), { orgHome: org.root });
    const result = computeEvalResult({
      experiment: declaration.record,
      trials: [
        { pair: 1, control: { average_review_cycles: 3, merge_success_rate: 1, average_cost_usd: 1 }, treatment: { average_review_cycles: 1, merge_success_rate: 1, average_cost_usd: 1 } },
        { pair: 2, control: { average_review_cycles: 3, merge_success_rate: 1, average_cost_usd: 1 }, treatment: { average_review_cycles: 1, merge_success_rate: 1, average_cost_usd: 1 } },
      ],
      graderRef: "fixture:phase4-hidden",
      costUsd: 0,
      decidedBy: "deterministic-verifier",
      decidedAt: "2026-07-12T00:30:00.000Z",
      evalId,
    });
    await decideExperiment(org.root, result);
    await writeInterventionRecord(org.root, makeIntervention({
      intervention_id: "int_20260712_closed",
      candidate_ref: candidateId,
      destination: "okf_concept",
      approval_ref: "approval-phase4-content-hash",
      publish: { kind: "bundle_version", ref: "org@phase4-canary", commit: "fixture", published_at: "2026-07-12T00:45:00.000Z" },
      activation: { activated_at: "2026-07-12T01:00:00.000Z", claim: "validated" },
      affected_episodes: { query: "canary_version=org@phase4-canary" },
      experiment_ref: experimentId,
      outcome_ref: evalId,
      status: "active",
    }));

    for (const [index, lineage] of (["stable", "stable", "canary", "canary"] as const).entries()) {
      const episodeId = `ep_alpha_post_${index}`;
      writeEpisode(state.root, episodeId, lineage, lineage === "stable" ? 3 : 1);
      await writeCanaryAssignmentOnce(state.root, {
        episode_id: episodeId,
        app: "alpha",
        turn_id: `turn-${index}`,
        assigned_at: "2026-07-12T01:30:00.000Z",
        bucket: index / 10,
        roots: { org: { version: "org@phase4-canary", lineage } },
        lineage,
      });
    }
    const health = await projectLearningEfficiencyHealth({
      orgHome: org.root,
      stateHome: state.root,
      capture: capture(),
      policy: defaultLearningPolicy(),
      roots: [orgLearningRoot(org.root)],
    });
    expect(health.efficacy).toMatchObject({
      status: "healthy",
      valid_control_treatment_comparisons: 2,
      comparable_post_activation_coverage: 2,
      guardrail_failures: [],
    });
    expect(health.efficacy.recommendations).toMatchObject([
      { experiment_ref: experimentId, recommendation: "retain" },
    ]);

    for (const index of [2, 3]) writeEpisode(state.root, `ep_alpha_post_${index}`, "canary", 4);
    const regressed = await projectLearningEfficiencyHealth({
      orgHome: org.root,
      stateHome: state.root,
      capture: capture(),
      policy: defaultLearningPolicy(),
      roots: [orgLearningRoot(org.root)],
    });
    expect(regressed.efficacy.status).toBe("degraded");
    expect(regressed.efficacy.recommendations[0]).toMatchObject({ recommendation: "roll_back" });
  });
});

function writeEpisode(
  stateHome: string,
  episodeId: string,
  lineage: "stable" | "canary",
  reviewCycles: number,
): void {
  const record: EpisodeRecord = {
    schema_version: 1,
    episode_id: episodeId,
    kind: "build_ticket",
    app: "alpha",
    source: { kind: "github_issue", ref: `alpha#${episodeId}` },
    stage: "live",
    risk_tier: "standard",
    opened: "2026-07-12T01:30:00.000Z",
    closed: "2026-07-12T02:00:00.000Z",
    status: "closed",
    fingerprint_ref: lineage === "stable" ? "sys_control00001" : "sys_treatment001",
    bundle_lineage: lineage,
    turns: [],
    gates: [],
    approvals: [],
    artifacts: [],
    side_effects: [],
    outcome: {
      completed: true,
      merged: true,
      release_disposition: "merged",
      review_cycles: reviewCycles,
      gate_failures: 0,
      human_interventions: 0,
      cost_usd: 1,
      cost_estimated: false,
      unsettled_runs: [],
      terminal_reason: "completed",
    },
    late_outcomes: [],
    human_observations: [],
  };
  const path = episodePath(stateHome, episodeId);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
}

function tree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const stat = lstatSync(path);
      out.push(path.slice(root.length));
      if (stat.isDirectory()) walk(path);
      else out.push(readFileSync(path).toString("base64"));
    }
  };
  walk(root);
  return out;
}
