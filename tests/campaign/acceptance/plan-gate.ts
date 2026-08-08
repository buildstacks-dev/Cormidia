// campaign/acceptance/plan-gate.ts — who may resolve the plan gate, and on what
// (CORMIDIA-INV-ACC-4; acceptance/rubric.md §6; F-PT-030, resolved 2026-08-07).
//
// What F-PT-030 changed: a campaign config's declared `plan_gate` policy MAY
// resolve the gate unattended, so a campaign runs end to end. What it did not
// change is everything else — the ratified rubric §6 criteria still decide, the
// resolution is still recorded durably before any build-arm spend, and a config
// with no declared policy still refuses at preflight (that refusal lives in
// `campaign-config.ts`; silence is not consent).
//
// The criteria are read straight off rubric §6: "every scenario's plan reached
// at least `attempted` on P-1 and P-5". Note the scope — EVERY scenario. One
// scenario below the bar stops the build arm for the campaign, not just for
// itself. That is the stricter reading of the ratified text, and the rubric is
// tighten-only.
//
// `ungraded` is not `attempted`. An axis nobody could measure has not cleared a
// bar; treating it as if it had is the INV-ACC-5 coercion wearing a different
// hat.

import type { PlanGatePolicy } from "./campaign-config.js";
import type { PlanGateResolution } from "./campaign-lifecycle.js";
import type { AxisScoreValue } from "./verdict-algebra.js";

/** The two axes rubric §6 names. Not configurable — a runner constant here
 *  would be a threshold by another name. */
export const PLAN_GATE_AXES = ["P-1", "P-5"] as const;

/** `attempted` is score 1 (rubric §5: absent · attempted · adequate · strong). */
const ATTEMPTED = 1;

export interface ScenarioPlanScores {
  scenarioId: string;
  scores: Record<string, AxisScoreValue>;
}

export interface PlanGateOutcome {
  /** Per scenario, exactly what will be recorded before any build-arm spend. */
  resolutions: PlanGateResolution[];
  decision: "continue" | "stop";
  /** Scenario/axis pairs that failed rubric §6, named for the report. */
  shortfalls: string[];
  /** `true` when a human still has to decide. */
  awaitingHuman: boolean;
}

function meetsRubricSix(scores: Record<string, AxisScoreValue>): string[] {
  return PLAN_GATE_AXES.filter((axis) => {
    const score = scores[axis];
    return typeof score !== "number" || score < ATTEMPTED;
  });
}

/**
 * Evaluate rubric §6 over the whole scenario set and produce the resolution
 * records. A `human` policy computes the same criteria and reports
 * `awaitingHuman` — the human authorizes continuation, the rubric still decides
 * eligibility, and a human cannot wave through a scenario the criteria failed.
 */
export function resolvePlanGate(
  policy: PlanGatePolicy,
  scenarios: readonly ScenarioPlanScores[],
  humanDecision?: "continue" | "stop",
): PlanGateOutcome {
  const shortfalls: string[] = [];
  for (const scenario of scenarios) {
    for (const axis of meetsRubricSix(scenario.scores)) {
      shortfalls.push(`${scenario.scenarioId}/${axis}`);
    }
  }
  const criteriaMet = shortfalls.length === 0;

  let decision: "continue" | "stop";
  let awaitingHuman = false;
  let reason: string;
  if (!criteriaMet) {
    decision = "stop";
    reason =
      `rubric §6 not met: ${shortfalls.join(", ")} did not reach \`attempted\`. ` +
      `A campaign that stops here is a successful campaign — it spent a fraction of the envelope and produced ` +
      `the most actionable finding available.`;
  } else if (policy.kind === "auto-continue") {
    decision = "continue";
    reason = `rubric §6 met on every scenario; continuation authorized by the declared ${policy.kind} policy (${policy.criteria})`;
  } else if (humanDecision === undefined) {
    decision = "stop";
    awaitingHuman = true;
    reason = "rubric §6 met; the declared policy is `human` and no human decision has been recorded yet";
  } else {
    decision = humanDecision;
    reason = `rubric §6 met; the human authorized \`${humanDecision}\``;
  }

  return {
    decision,
    shortfalls,
    awaitingHuman,
    resolutions: scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      resolvedBy: policy.kind === "auto-continue" ? "declared-policy" : "human",
      decision,
      // The scores the resolution ACTED ON, recorded rather than re-derived —
      // a resolution whose inputs are not durable cannot be audited later.
      scores: Object.fromEntries(
        Object.entries(scenario.scores).map(([axis, score]) => [axis, score] as const),
      ) as Record<string, number | "ungraded">,
      reason,
    })),
  };
}
