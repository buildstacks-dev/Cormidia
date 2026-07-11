// ExperimentRunner (learning-loop M5; design §9.5, spec §16). Covers
// milestone Done-means #1 — a paired replay on a seeded weakness produces
// `improved` for a genuinely fixing candidate and `regressed`/`inconclusive`
// for a sham one — and the runner half of #4 (replay spend halts at the
// caps), plus the funnel order (targeted before full), early stopping, the
// deterministic prechecks, and post-verdict intervention lineage. The
// executor is scripted; replay execution itself is proven in replay.test.ts.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { orgLearningRoot } from "../../src/org/learning/concepts.js";
import { evalSetDir } from "../../src/org/learning/eval-fixture.js";
import type { EvalFixture } from "../../src/org/learning/eval-fixture.js";
import { declareExperiment, readExperimentRecord } from "../../src/org/learning/experiment.js";
import { readEvalResult } from "../../src/org/learning/eval-result.js";
import {
  readInterventionRecord,
  writeInterventionRecord,
} from "../../src/org/learning/intervention.js";
import { defaultLearningPolicy } from "../../src/org/learning/policy.js";
import type {
  ReplayAttempt,
  ReplayAttemptRequest,
  ReplayExecutor,
} from "../../src/org/learning/replay.js";
import { runExperiment, type LearningSpendSnapshot } from "../../src/org/learning/runner.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";
import { makeExperiment, makeIntervention } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

const SET = "roles/builder/standard-tickets";
const NOW = (): Date => new Date("2026-07-11T12:00:00Z");

function tempOrg(): OrgHomeFixture {
  const fixture = makeOrgHome();
  cleanups.push(fixture.cleanup);
  return fixture;
}

function fixtureRecord(overrides: Partial<EvalFixture> = {}): EvalFixture {
  return {
    schema_version: 1,
    fixture_id: `evals/${SET}/replay_alpha_ticket_0007`,
    eval_set: SET,
    capsule_ref: "replay_alpha_ticket_0007",
    episode_ref: "ep_alpha_ticket_0007",
    kind: "build_ticket",
    seed: { repo: "owner/alpha", commit: "a1b2c3d", fixtures: [] },
    input: {
      ticket_ref: "github:#7",
      brief_hash: `sha256:${"ef".repeat(32)}`,
      brief: "## Ticket\n\nImplement the CSV export (#7).",
    },
    fingerprint_ref: "sys_0123456789ab",
    artifacts: [],
    observed_outcome: { merged: true, review_cycles: 2, cost_usd: 12.41 },
    expected_outcome: { merged: true, review_cycles: 2, cost_usd: 12.41 },
    grader: { kind: "deterministic", ref: "builtin:build-outcome@1" },
    side_effect_policy: {
      network: "fixture_only",
      publishing: "forbidden",
      deployment: "sandbox_only",
    },
    sanitized: true,
    drafted_by: "human-operator",
    drafted_at: "2026-07-11T09:00:00.000Z",
    validated_by: "second-actor",
    validated_at: "2026-07-11T09:30:00.000Z",
    ...overrides,
  };
}

function writeFixture(orgHome: string, fixture: EvalFixture): void {
  const dir = evalSetDir(orgHome, fixture.eval_set);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${fixture.capsule_ref}.json`),
    JSON.stringify(fixture, null, 2) + "\n",
  );
}

async function declared(
  orgHome: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const record = makeExperiment({
    experiment_id: "exp_runner_01",
    primary_metric: {
      name: "held_in_pass",
      expected_direction: "increase",
      min_useful_improvement_pct: 0,
    },
    guardrails: [{ metric: "merged", rule: "must_not_decrease" }],
    trials: {
      layer: "replay",
      repetitions: 2,
      early_stop: { on_held_in_failure: true, on_guardrail_trip: true },
    },
    ...overrides,
  });
  await declareExperiment(record, { orgHome });
  return record["experiment_id"] as string;
}

/** Script one metrics-map per (arm, mode). Cost per attempt is fixed so the
 *  budget tests can arithmetic on it. */
function scriptedExecutor(
  metricsFor: (request: ReplayAttemptRequest) => Record<string, number>,
  costPerAttempt = 1,
): ReplayExecutor & { requests: ReplayAttemptRequest[] } {
  const requests: ReplayAttemptRequest[] = [];
  return {
    requests,
    async attempt(request: ReplayAttemptRequest): Promise<ReplayAttempt> {
      requests.push(request);
      const metrics = { ...metricsFor(request), cost_usd: costPerAttempt };
      return {
        arm: request.arm,
        pair: request.pair,
        mode: request.mode,
        metrics,
        heldInPass: (metrics["held_in_pass"] ?? 0) === 1,
        costUsd: costPerAttempt,
        runIds: [`run-${request.pair}-${request.arm}`],
        detail: "scripted",
      };
    },
  };
}

function spend(overrides: Partial<LearningSpendSnapshot> = {}): LearningSpendSnapshot {
  return {
    monthUsd: 0,
    candidateUsd: 0,
    experimentsThisMonth: 0,
    experimentCounted: false,
    ...overrides,
  };
}

function baseOptions(orgHome: string, executor: ReplayExecutor) {
  return {
    orgHome,
    policy: defaultLearningPolicy(),
    executor,
    decidedBy: "human-operator",
    spend: spend(),
    clock: NOW,
  };
}

// ---------------------------------------------------------------------------
// Done-means #1: genuine fix → improved; sham → regressed/inconclusive
// ---------------------------------------------------------------------------

describe("paired replay verdicts (Done #1)", () => {
  it("a genuinely fixing candidate decides `improved`", async () => {
    const org = tempOrg();
    writeFixture(org.root, fixtureRecord());
    const id = await declared(org.root);
    // Seeded weakness: control fails the held-in case; treatment fixes it
    // without regressing the merge guardrail.
    const executor = scriptedExecutor(({ arm, mode }) =>
      mode === "targeted"
        ? { held_in_pass: arm === "treatment" ? 1 : 0 }
        : arm === "treatment"
          ? { held_in_pass: 1, merged: 1, review_cycles: 1 }
          : { held_in_pass: 0, merged: 1, review_cycles: 3 },
    );

    const outcome = await runExperiment(id, baseOptions(org.root, executor));
    expect(outcome.result.verdict).toBe("improved");
    expect(outcome.halted).toBeNull();
    expect(outcome.experiment.status).toBe("decided");
    expect(outcome.experiment.result).toBe(outcome.result.eval_id);
    // Funnel order: targeted pair 0 first (control then treatment), then the
    // full pairs.
    expect(executor.requests.slice(0, 2).map((r) => [r.pair, r.mode, r.arm])).toEqual([
      [0, "targeted", "control"],
      [0, "targeted", "treatment"],
    ]);
    expect(executor.requests).toHaveLength(6); // 1 targeted + 2 full pairs
    // The verdict is durable through the M3 substrate.
    const persisted = await readEvalResult(org.root, outcome.result.eval_id);
    expect(persisted.verdict).toBe("improved");
    expect((await readExperimentRecord(org.root, id)).status).toBe("decided");
  });

  it("a sham candidate that fails the held-in eval halts at the targeted stage — never `improved`", async () => {
    const org = tempOrg();
    writeFixture(org.root, fixtureRecord());
    const id = await declared(org.root);
    const executor = scriptedExecutor(() => ({ held_in_pass: 0 }));

    const outcome = await runExperiment(id, baseOptions(org.root, executor));
    expect(outcome.halted).toMatch(/targeted held-in eval failed/);
    expect(executor.requests).toHaveLength(2); // full replay never ran
    expect(["regressed", "inconclusive", "not_evaluatable"]).toContain(outcome.result.verdict);
    expect(outcome.result.verdict).not.toBe("improved");
  });

  it("a sham candidate that trips a guardrail mid-replay early-stops and decides `regressed`", async () => {
    const org = tempOrg();
    writeFixture(org.root, fixtureRecord());
    const id = await declared(org.root, { experiment_id: "exp_runner_02" });
    // Held-in passes (so the funnel reaches full pairs) but the treatment
    // stops merging: the merged guardrail trips on pair 1.
    const executor = scriptedExecutor(({ arm, mode }) =>
      mode === "targeted"
        ? { held_in_pass: 1 }
        : arm === "treatment"
          ? { held_in_pass: 1, merged: 0, review_cycles: 1 }
          : { held_in_pass: 1, merged: 1, review_cycles: 2 },
    );

    const outcome = await runExperiment(id, baseOptions(org.root, executor));
    expect(outcome.result.verdict).toBe("regressed");
    expect(outcome.halted).toMatch(/guardrail tripped on pair 1/);
    expect(executor.requests).toHaveLength(4); // targeted + one full pair only
  });
});

// ---------------------------------------------------------------------------
// budget caps (Done #4, runner half)
// ---------------------------------------------------------------------------

describe("learning budget caps", () => {
  it("halts between pairs at the per-candidate replay cap; completed pairs still decide", async () => {
    const org = tempOrg();
    writeFixture(org.root, fixtureRecord());
    const id = await declared(org.root, { experiment_id: "exp_runner_03" });
    const executor = scriptedExecutor(
      ({ arm }) => ({
        held_in_pass: arm === "treatment" ? 1 : 0,
        merged: 1,
        review_cycles: arm === "treatment" ? 1 : 3,
      }),
      10, // $10/attempt: targeted pair = $20, first full pair = $40 total
    );

    const outcome = await runExperiment(id, {
      ...baseOptions(org.root, executor),
      // $75 cap with $40 already attributed: the targeted pair (+$20) fits,
      // pair 1 (+$20 → $80 local+prior) crosses — pair 2 must not start.
      spend: spend({ candidateUsd: 40 }),
    });
    expect(outcome.halted).toMatch(/per-candidate replay cap.*after 1 of 2 full pairs/);
    expect(executor.requests).toHaveLength(4);
    expect(outcome.result.verdict).toBe("improved"); // the pair that ran was decisive
  });

  it("refuses to start when the monthly budget or per-candidate cap is already spent", async () => {
    const org = tempOrg();
    writeFixture(org.root, fixtureRecord());
    const id = await declared(org.root, { experiment_id: "exp_runner_04" });
    const executor = scriptedExecutor(() => ({ held_in_pass: 1 }));

    await expect(
      runExperiment(id, { ...baseOptions(org.root, executor), spend: spend({ monthUsd: 200 }) }),
    ).rejects.toThrow(/monthly learning budget exhausted/);
    await expect(
      runExperiment(id, { ...baseOptions(org.root, executor), spend: spend({ candidateUsd: 75 }) }),
    ).rejects.toThrow(/per-candidate replay cap/);
    await expect(
      runExperiment(id, {
        ...baseOptions(org.root, executor),
        spend: spend({ experimentsThisMonth: 4 }),
      }),
    ).rejects.toThrow(/experiments already ran this month/);
    // A resumed experiment is not a new one against the monthly count.
    const resumed = await runExperiment(id, {
      ...baseOptions(org.root, executor),
      spend: spend({ experimentsThisMonth: 4, experimentCounted: true }),
    });
    expect(resumed.experiment.status).toBe("decided");
    expect(executor.requests.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// deterministic prechecks
// ---------------------------------------------------------------------------

describe("prechecks", () => {
  it("refuses over-cap repetitions, drifted fingerprints, wrong layers, and re-runs", async () => {
    const org = tempOrg();
    writeFixture(org.root, fixtureRecord());
    const executor = scriptedExecutor(() => ({ held_in_pass: 1 }));

    const overCap = await declared(org.root, {
      experiment_id: "exp_runner_05",
      trials: {
        layer: "replay",
        repetitions: 6,
        early_stop: { on_held_in_failure: true, on_guardrail_trip: true },
      },
    });
    await expect(runExperiment(overCap, baseOptions(org.root, executor))).rejects.toThrow(
      /policy caps experiments at 5/,
    );

    const drifted = await declared(org.root, { experiment_id: "exp_runner_06" });
    await expect(
      runExperiment(drifted, {
        ...baseOptions(org.root, executor),
        currentFingerprintId: "sys_driftedsystem",
      }),
    ).rejects.toThrow(/system has drifted/);

    const canaryLayer = await declared(org.root, {
      experiment_id: "exp_runner_07",
      trials: {
        layer: "canary",
        repetitions: 1,
        early_stop: { on_held_in_failure: true, on_guardrail_trip: true },
      },
    });
    await expect(runExperiment(canaryLayer, baseOptions(org.root, executor))).rejects.toThrow(
      /canary trials run live/,
    );

    const done = await declared(org.root, { experiment_id: "exp_runner_08" });
    await runExperiment(done, baseOptions(org.root, executor));
    await expect(runExperiment(done, baseOptions(org.root, executor))).rejects.toThrow(
      /already decided/,
    );
  });

  it("refuses when the eval set has no trusted fixtures — unvalidated drafts never spend tokens", async () => {
    const org = tempOrg();
    writeFixture(org.root, fixtureRecord({ validated_by: null, validated_at: null }));
    const id = await declared(org.root, { experiment_id: "exp_runner_09" });
    const executor = scriptedExecutor(() => ({ held_in_pass: 1 }));
    await expect(runExperiment(id, baseOptions(org.root, executor))).rejects.toThrow(
      /no trusted fixtures/,
    );
    expect(executor.requests).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// intervention lineage after the verdict
// ---------------------------------------------------------------------------

describe("post-verdict intervention lineage", () => {
  it("an improved verdict on an activated candidate upgrades the claim to validated", async () => {
    const org = tempOrg();
    writeFixture(org.root, fixtureRecord());
    const id = await declared(org.root, { experiment_id: "exp_runner_10" });
    await writeInterventionRecord(
      org.root,
      makeIntervention({
        intervention_id: "int_20260711_01JGHI",
        destination: "okf_concept",
        publish: {
          kind: "bundle_version",
          ref: "org@2026.07.11-1",
          commit: null,
          published_at: "2026-07-11T08:00:00.000Z",
        },
        activation: { activated_at: "2026-07-11T08:00:00.000Z", claim: "authorized" },
        affected_episodes: { query: "bundle_versions.org >= 2026.07.11-1" },
        status: "active",
      }),
    );
    const executor = scriptedExecutor(({ arm }) => ({
      held_in_pass: arm === "treatment" ? 1 : 0,
      merged: 1,
      review_cycles: arm === "treatment" ? 1 : 3,
    }));

    const outcome = await runExperiment(id, baseOptions(org.root, executor));
    expect(outcome.result.verdict).toBe("improved");
    const intervention = await readInterventionRecord(org.root, "int_20260711_01JGHI");
    expect(intervention.experiment_ref).toBe(id);
    expect(intervention.outcome_ref).toBe(outcome.result.eval_id);
    expect(intervention.activation?.claim).toBe("validated");
  });
});
