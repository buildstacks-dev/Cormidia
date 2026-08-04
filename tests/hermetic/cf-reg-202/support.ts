// CF-REG-202 rig — the durable state one ticket episode leaves behind when a
// reviewer returns findings and a revision is accepted.
//
// Everything here is written in the product's own durable shapes, at the
// product's own paths, taken from the august-org run of 2026-08-01 that found
// #202 (episode `ticket:august-buildstack1:#1`, plan v1 → v2). The fixture
// fabricates state, never behavior: every assertion in the suite runs real
// product readers over it.

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  efficiencyEpisodeDir,
  executionStepPath,
  type ExecutionStepRecord,
} from "../../../src/loop/efficiency.js";
import {
  episodePlanVersionPath,
  type EpisodePlan,
  type ProviderTurnStep,
} from "../../../src/loop/episode-plan.js";
import {
  episodeReplanJournalPath,
  type EpisodeReplanJournal,
  type EpisodeReplanRecord,
} from "../../../src/loop/episode-replan.js";
import { runPaths } from "../../../src/runtime/runlog/paths.js";

export const REG202_APP = "reg202-app";
export const REG202_EPISODE = "ticket:reg202-app:#1";
export const REG202_INTENT_HASH = "a".repeat(64);

/** The reviewer's verdict from the run: a real `security/major` finding on the
 *  ignore rules, which is exactly the outcome the cross-provider pairing exists
 *  to produce — and the outcome that used to terminate the ticket. */
export const REVIEW_FINDINGS_VERDICT = JSON.stringify({
  verdict: "findings",
  findings: [
    {
      category: "security",
      severity: "major",
      location: ".gitignore:1-5",
      description:
        "This PR replaced the secret-protecting ignore rules (`.env`, `.env.*`, " +
        "`!.env.example`) with build-artifact ignores only, so `.env` and " +
        "`.env.local` are no longer git-ignored — `git check-ignore -v .env " +
        ".env.local` returns exit 1 (no matching rule).",
      action:
        "Restore the secret ignores alongside the new build-artifact entries.",
    },
  ],
  review: {
    rationale: "Acceptance criteria are met, but the ignore-rule regression is actionable.",
    evidence: [
      {
        claim: "the secret ignore rules were dropped",
        evidence: "git check-ignore -v .env .env.local returns exit 1",
      },
    ],
    notReviewed: [],
  },
});

export const REVIEW_CLEAN_VERDICT = JSON.stringify({
  verdict: "approve",
  findings: [],
  review: {
    rationale: "Every acceptance criterion is independently verified.",
    evidence: [{ claim: "tests pass", evidence: "pnpm test 7/7" }],
    notReviewed: [],
  },
});

export const BUILD_DONE_VERDICT = JSON.stringify({
  status: "done",
  blockedEntry: null,
  resolutions: null,
});

export const BUILD_BLOCKED_VERDICT = JSON.stringify({
  status: "blocked",
  blockedEntry: { reason: "the acceptance criterion cannot be proven mechanically" },
  resolutions: null,
});

function providerStep(overrides: Partial<ProviderTurnStep> & Pick<ProviderTurnStep, "id" | "operation" | "role">): ProviderTurnStep {
  return {
    kind: "provider_turn",
    objective: `perform ${overrides.operation}`,
    dependsOn: [],
    inputRefs: [],
    expectedOutputs: [],
    requiredCapabilities: [],
    maxTurnBudgetUsd: 50,
    selectionReason: "fixture-configured assignment",
    assignment: { harness: "claude", model: "claude-opus-4-8", effort: "xhigh" },
    assignmentSource: "configured",
    ...overrides,
  } as ProviderTurnStep;
}

export const REVIEW_VERIFY_STEP = providerStep({
  id: "review-verify",
  operation: "review/verify",
  role: "reviewer",
  dependsOn: ["gates-and-pr"],
  expectedOutputs: [{ id: "review-verdict", kind: "review-verdict", required: true }],
});

export const BUILD_IMPLEMENT_STEP = providerStep({
  id: "build-implement",
  operation: "build/implement",
  role: "builder",
  dependsOn: ["build-contract"],
  assignment: { harness: "codex", model: "gpt-5.6-sol", effort: "high" },
  expectedOutputs: [{ id: "implementation", kind: "implementation", required: true }],
});

export const FIX_STEP = providerStep({
  id: "fix",
  operation: "fix/fix",
  role: "builder",
  // The live revision's shape, verbatim: the repair depends on the very step
  // whose failure authorized it. That edge is what made the withheld step a
  // deadlock rather than a skipped turn.
  dependsOn: ["review-verify"],
  assignment: { harness: "codex", model: "gpt-5.6-sol", effort: "high" },
  expectedOutputs: [{ id: "fix-implementation", kind: "implementation", required: true }],
});

function mechanicalStep(id: string, dependsOn: string[]): EpisodePlan["steps"][number] {
  return {
    kind: "mechanical_gate",
    id,
    objective: `run ${id}`,
    dependsOn,
    inputRefs: [],
    expectedOutputs: [],
    gate: id,
  } as EpisodePlan["steps"][number];
}

export function reg202Plan(version: number, steps: EpisodePlan["steps"]): EpisodePlan {
  return {
    schemaVersion: 1,
    episodeId: REG202_EPISODE,
    version,
    intentHash: REG202_INTENT_HASH,
    summary: `fixture plan v${version}`,
    workflowClass: "ticket-build-review-ship",
    planningSource: "episode_planner",
    estimatedBudget: {
      providerTurns: steps.filter((step) => step.kind === "provider_turn").length,
      providerTurnBudgetUsd: 250,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: 250,
    },
    derivedSafetyRoute: { label: "deep", reasons: ["fixture"], gateStepIds: [], approvalStepIds: [] },
    createdAt: "2026-08-01T08:00:00.000Z",
    steps,
  } as EpisodePlan;
}

/** v1: the plan that ran. `review-verify` is its last step and it failed. */
export const REG202_PLAN_V1 = reg202Plan(1, [
  mechanicalStep("provision", []),
  providerStep({ id: "build-contract", operation: "build/contract", role: "builder", dependsOn: ["provision"] }),
  BUILD_IMPLEMENT_STEP,
  mechanicalStep("gates-and-pr", ["build-implement"]),
  REVIEW_VERIFY_STEP,
  mechanicalStep("review-authorization", ["review-verify"]),
  mechanicalStep("ship", ["review-authorization"]),
]);

/** v2: the accepted revision, in the shape the live EpisodePlanner produced —
 *  completed work preserved, the failed review preserved, and the repair
 *  suffix (fix → re-gate → re-review) appended behind it. */
export const REG202_PLAN_V2 = reg202Plan(2, [
  mechanicalStep("provision", []),
  providerStep({ id: "build-contract", operation: "build/contract", role: "builder", dependsOn: ["provision"] }),
  BUILD_IMPLEMENT_STEP,
  mechanicalStep("gates-and-pr", ["build-implement"]),
  REVIEW_VERIFY_STEP,
  FIX_STEP,
  mechanicalStep("gates-and-pr-2", ["fix"]),
  providerStep({
    id: "review-verify-2",
    operation: "review/verify",
    role: "reviewer",
    dependsOn: ["gates-and-pr-2"],
    expectedOutputs: [{ id: "review-verdict", kind: "review-verdict", required: true }],
  }),
  mechanicalStep("review-authorization", ["review-verify-2"]),
  mechanicalStep("ship", ["review-authorization"]),
]);

/** The durable completed set at the moment v2 was adopted (the execution
 *  journal's `step_completed` events, from the live run). */
export const REG202_COMPLETED_AT_ADOPTION = [
  "provision",
  "build-contract",
  "build-implement",
  "gates-and-pr",
];

export interface Reg202Home {
  root: string;
  cleanup(): Promise<void>;
  writePlan(plan: EpisodePlan): Promise<void>;
  writeAcceptedRevision(input: {
    affectedStepIds: string[];
    fromPlanVersion: number;
    revisionVersion: number;
    status?: EpisodeReplanRecord["status"];
  }): Promise<void>;
  /** A terminal provider execution record plus its recoverable `output.md`. */
  writeProviderEvidence(input: {
    step: ProviderTurnStep;
    planVersion: number;
    status: ExecutionStepRecord["status"];
    output: string;
  }): Promise<string>;
}

export async function makeReg202Home(): Promise<Reg202Home> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-reg202-state-"));
  await mkdir(efficiencyEpisodeDir(root, REG202_EPISODE), { recursive: true });

  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),

    async writePlan(plan) {
      const path = episodePlanVersionPath(root, REG202_EPISODE, plan.version);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    },

    async writeAcceptedRevision({ affectedStepIds, fromPlanVersion, revisionVersion, status = "accepted" }) {
      const record: EpisodeReplanRecord = {
        trigger: {
          id: `execution-${revisionVersion}`,
          kind: "failed_gate",
          planVersion: fromPlanVersion,
          detectedAt: "2026-08-01T08:36:52.566Z",
          summary: "review/verify produced 1 finding(s); a plan revision is required",
          evidenceRefs: [`plan-execution:${REG202_EPISODE}:v${fromPlanVersion}`],
          affectedStepIds,
        },
        triggerSha256: "b".repeat(64),
        status,
        requestedAt: "2026-08-01T08:36:52.566Z",
        resolvedAt: "2026-08-01T08:41:05.960Z",
        revisionVersion: status === "accepted" ? revisionVersion : null,
        reason: null,
      };
      const journal: EpisodeReplanJournal = {
        schemaVersion: 1,
        episodeId: REG202_EPISODE,
        maxRevisions: 2,
        records: [record],
        createdAt: "2026-08-01T08:36:52.566Z",
        updatedAt: "2026-08-01T08:41:05.960Z",
      };
      const path = episodeReplanJournalPath(root, REG202_EPISODE);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
    },

    async writeProviderEvidence({ step, planVersion, status, output }) {
      const runId = `20260801-081826-episode-plan-dag-${step.id}-v${planVersion}`;
      const executionStepId = `${step.id}-v${planVersion}`;
      const record: ExecutionStepRecord = {
        schema_version: 1,
        execution_step_id: executionStepId,
        episode_id: REG202_EPISODE,
        app: REG202_APP,
        run_id: runId,
        kind: "provider",
        provider_turn_id: `turn-${executionStepId}`,
        operation: `episode-plan-dag/${step.id}`,
        role: step.role,
        runtime: step.assignment.harness,
        model: step.assignment.model,
        effort: step.assignment.effort,
        assignment_source: step.assignmentSource,
        plan_version: planVersion,
        plan_step_id: step.id,
        started_at: "2026-08-01T08:20:00.000Z",
        finished_at: "2026-08-01T08:36:52.000Z",
        status,
        error_code: null,
        reason: output,
        next_step: null,
        context_manifest_ref: null,
        input_fingerprint: "c".repeat(64),
        work_fingerprint_before: "d".repeat(64),
        work_fingerprint_after: "d".repeat(64),
        artifact_fingerprint: null,
        productive: true,
        repeated_from_step_id: null,
        tool_call_count: 0,
        usage: null,
      } as ExecutionStepRecord;
      const recordPath = executionStepPath(root, REG202_EPISODE, executionStepId);
      await mkdir(dirname(recordPath), { recursive: true });
      await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

      const outputPath = runPaths(root, REG202_APP, runId).output;
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, output, "utf8");
      return runId;
    },
  };
}

/** The narrow evidence-input the durable readers take. */
export function reg202EvidenceInput(root: string, plan: EpisodePlan, step: ProviderTurnStep) {
  return { options: { root, app: { name: REG202_APP } }, plan, step };
}
