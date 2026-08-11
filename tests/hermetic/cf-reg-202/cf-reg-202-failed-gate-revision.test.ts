// Traceability: CF-REG-202 · HB-139 · case-catalog.md §10.3.

// CF-REG-202 — an accepted revision triggered by a reviewer's findings is
// executable: its repaired review step settles from the evidence that already
// exists, and the revision reaches its `fix` step.
//
// Defect source: cormidia/Cormidia#202 ("accepted v2 replan unreachable on
// the failed_gate path"), found by the august-org live run 2026-08-01.
//
// The mechanism, established from the run's own durable artifacts:
//   * `review-verify` failed at v1 with `ticket_review_findings`;
//   * the EpisodePlanner authored a valid v2 — `fix` → `gates-and-pr-2` →
//     `review-verify-2` — and it was ACCEPTED and persisted;
//   * `fix` dependsOn `review-verify`, and `review-verify` was neither
//     completed nor completable, because the adopted-revision halt withholds
//     the exact step whose failure authorized the revision;
//   * so the only ready step was the withheld one, forever. `episode explain`
//     showed `execution: running` and `route: terminal interrupted` at once,
//     the ticket parked at `op:returned`, and `loop rearm` refused it as
//     terminal. One reviewer finding cost a whole ticket and $18.28.
//
// #175 fixed the mirror-image case for BUILD steps (a blocked transport whose
// content-bound verdict said `done` is reconciled forward rather than
// withheld). Its acceptance criteria never covered the review half, so the
// review half stayed broken — the same "fixed one path, left the sibling"
// pattern that produced #203. The fix therefore replaces the two would-be
// siblings with one shared rule, `reconcilablePriorEvidence`.
//
// Traceability: INV-003 (approval/effect never re-performed — a reconciled
// review must not re-publish its verdict) · INV-014 (considered work never
// vanishes) · journey J-04 · C-OP-LOOP §3/§4. Registered in
// validation-design/case-catalog.md §10.
//
// LAYER: 1 for the rule, 2 for the durable readers and the GitHub side-effect
// assertion. No provider, no network: every input is the durable state the
// live run actually left on disk, and every assertion runs product code.

import { afterEach, describe, expect, it } from "vitest";
import { selectReadyEpisodeSteps } from "../../../src/loop/episode-plan.js";
import { ticketProviderOperation } from "../../../src/loop/ticket-episode-plan.js";
import {
  applyProviderOutcome,
  completableProviderEvidence,
  reconcilablePriorEvidence,
  type ProviderEvidence,
  type TicketProviderExecutionInput,
} from "../../../src/org/ticket-episode-runtime.js";
import { DEFAULT_LOOP_POLICY } from "../../../src/loop/driver.js";
import { GhCliOps } from "../../../src/loop/github.js";
import type { LoopItem } from "../../../src/loop/types.js";
import { installGithubDouble } from "../../fixtures/github-double/install.js";
import {
  BUILD_DONE_VERDICT,
  BUILD_IMPLEMENT_STEP,
  makeReg202Home,
  REG202_APP,
  REG202_COMPLETED_AT_ADOPTION,
  REG202_PLAN_V1,
  REG202_PLAN_V2,
  reg202EvidenceInput,
  REVIEW_FINDINGS_VERDICT,
  REVIEW_VERIFY_STEP,
  type Reg202Home,
} from "./support.js";

const REVIEW_DEFINITION = ticketProviderOperation("review/verify")!;
const BUILD_DEFINITION = ticketProviderOperation("build/implement")!;

const OP_LABELS = [
  { name: "op:ready", color: "1d76db", description: "ready" },
  { name: "op:building", color: "fbca04", description: "building" },
  { name: "op:in-review", color: "0e8a16", description: "review" },
  { name: "op:returned", color: "b60205", description: "returned" },
];

describe("CF-REG-202 — a failed_gate revision is executable (#202, sibling of #175)", () => {
  let homes: Reg202Home[] = [];
  let disposers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const home of homes.splice(0)) await home.cleanup();
    for (const dispose of disposers.splice(0)) await dispose();
  });

  async function home(): Promise<Reg202Home> {
    const created = await makeReg202Home();
    homes.push(created);
    return created;
  }

  // ---------------------------------------------------------------- -A ----

  it("-A the deadlock: with the repaired step withheld, the accepted revision has nothing else to run", () => {
    // Product code, on the live plan shape and the live completed set.
    const ready = selectReadyEpisodeSteps(REG202_PLAN_V2, REG202_COMPLETED_AT_ADOPTION);

    // Exactly one step is ready, and it is the one the halt withholds. That is
    // the whole defect in one assertion: withhold it and the revision is dead,
    // no matter how coherent the plan reads in `episode explain`.
    expect(ready.map((step) => step.id)).toEqual(["review-verify"]);

    // And the repair suffix really is gated behind it, so "skip the step" is
    // not an option either — it has to be settled.
    expect(REG202_PLAN_V2.steps.find((step) => step.id === "fix")?.dependsOn).toEqual(["review-verify"]);
    const withReviewSettled = selectReadyEpisodeSteps(REG202_PLAN_V2, [
      ...REG202_COMPLETED_AT_ADOPTION,
      "review-verify",
    ]);
    expect(withReviewSettled.map((step) => step.id)).toEqual(["fix"]);
  });

  // ---------------------------------------------------------------- -B ----

  it("-B a repaired review step is settled from the prior version's findings evidence, not withheld", async () => {
    const state = await home();
    await state.writePlan(REG202_PLAN_V1);
    await state.writePlan(REG202_PLAN_V2);
    await state.writeAcceptedRevision({
      affectedStepIds: ["review-verify"],
      fromPlanVersion: 1,
      revisionVersion: 2,
    });
    await state.writeProviderEvidence({
      step: REVIEW_VERIFY_STEP,
      planVersion: 1,
      status: "completed", // the review turn itself succeeded; its verdict did not pass
      output: REVIEW_FINDINGS_VERDICT,
    });

    const evidence = await completableProviderEvidence(
      reg202EvidenceInput(state.root, REG202_PLAN_V2, REVIEW_VERIFY_STEP),
      REVIEW_DEFINITION,
    );

    expect(evidence).toBeDefined();
    expect(evidence?.reconciledFromPlanVersion).toBe(1);
    expect(evidence?.output).toBe(REVIEW_FINDINGS_VERDICT);
  });

  it("-B build parity: #175's blocked-transport-with-done-verdict case still reconciles", async () => {
    const state = await home();
    await state.writePlan(REG202_PLAN_V1);
    await state.writePlan(REG202_PLAN_V2);
    await state.writeAcceptedRevision({
      affectedStepIds: ["build-implement"],
      fromPlanVersion: 1,
      revisionVersion: 2,
    });
    await state.writeProviderEvidence({
      step: BUILD_IMPLEMENT_STEP,
      planVersion: 1,
      status: "blocked",
      output: BUILD_DONE_VERDICT,
    });

    const evidence = await completableProviderEvidence(
      reg202EvidenceInput(state.root, REG202_PLAN_V2, BUILD_IMPLEMENT_STEP),
      BUILD_DEFINITION,
    );
    expect(evidence?.reconciledFromPlanVersion).toBe(1);
  });

  it("-B negative control: with no accepted revision naming the step, nothing is reconciled", async () => {
    const state = await home();
    await state.writePlan(REG202_PLAN_V1);
    await state.writePlan(REG202_PLAN_V2);
    // The revision names a DIFFERENT step, so this review has no repair
    // authority behind it and must spend a real turn.
    await state.writeAcceptedRevision({
      affectedStepIds: ["build-implement"],
      fromPlanVersion: 1,
      revisionVersion: 2,
    });
    await state.writeProviderEvidence({
      step: REVIEW_VERIFY_STEP,
      planVersion: 1,
      status: "completed",
      output: REVIEW_FINDINGS_VERDICT,
    });

    expect(
      await completableProviderEvidence(
        reg202EvidenceInput(state.root, REG202_PLAN_V2, REVIEW_VERIFY_STEP),
        REVIEW_DEFINITION,
      ),
    ).toBeUndefined();
  });

  it("-B negative control: a merely PENDING revision does not settle the step", async () => {
    const state = await home();
    await state.writePlan(REG202_PLAN_V1);
    await state.writePlan(REG202_PLAN_V2);
    await state.writeAcceptedRevision({
      affectedStepIds: ["review-verify"],
      fromPlanVersion: 1,
      revisionVersion: 2,
      status: "pending",
    });
    await state.writeProviderEvidence({
      step: REVIEW_VERIFY_STEP,
      planVersion: 1,
      status: "completed",
      output: REVIEW_FINDINGS_VERDICT,
    });

    expect(
      await completableProviderEvidence(
        reg202EvidenceInput(state.root, REG202_PLAN_V2, REVIEW_VERIFY_STEP),
        REVIEW_DEFINITION,
      ),
    ).toBeUndefined();
  });

  it("-B negative control: unparseable stored evidence is not evidence", async () => {
    const state = await home();
    await state.writePlan(REG202_PLAN_V1);
    await state.writePlan(REG202_PLAN_V2);
    await state.writeAcceptedRevision({
      affectedStepIds: ["review-verify"],
      fromPlanVersion: 1,
      revisionVersion: 2,
    });
    await state.writeProviderEvidence({
      step: REVIEW_VERIFY_STEP,
      planVersion: 1,
      status: "completed",
      output: "not a verdict at all",
    });

    expect(
      await completableProviderEvidence(
        reg202EvidenceInput(state.root, REG202_PLAN_V2, REVIEW_VERIFY_STEP),
        REVIEW_DEFINITION,
      ),
    ).toBeUndefined();
  });

  // ------------------------------------------------------- the rule ------

  describe("the shared rule (reconcilablePriorEvidence) — one decision, both halves", () => {
    const base = {
      planVersion: 2,
      repairedFromPlanVersion: 1,
      stepPreserved: true,
    } as const;

    it("settles a review whose prior transport completed with findings", () => {
      expect(
        reconcilablePriorEvidence({
          ...base,
          priorRecordStatus: "completed",
          priorVerdict: { kind: "review", findings: 1 },
        }),
      ).toBe(1);
    });

    it("settles a build whose prior transport blocked but whose verdict said done", () => {
      expect(
        reconcilablePriorEvidence({
          ...base,
          priorRecordStatus: "blocked",
          priorVerdict: { kind: "build", status: "done" },
        }),
      ).toBe(1);
    });

    it("negative control: every near miss refuses", () => {
      const refusals: Array<[string, Parameters<typeof reconcilablePriorEvidence>[0]]> = [
        [
          "a v1 plan has no prior to reconcile",
          {
            ...base,
            planVersion: 1,
            priorRecordStatus: "completed",
            priorVerdict: { kind: "review", findings: 1 },
          },
        ],
        [
          "no accepted revision named the step",
          {
            ...base,
            repairedFromPlanVersion: undefined,
            priorRecordStatus: "completed",
            priorVerdict: { kind: "review", findings: 1 },
          },
        ],
        [
          "the revision changed the step, so that evidence is not this step's",
          {
            ...base,
            stepPreserved: false,
            priorRecordStatus: "completed",
            priorVerdict: { kind: "review", findings: 1 },
          },
        ],
        [
          "no prior verdict at all",
          {
            ...base,
            priorRecordStatus: "completed",
            priorVerdict: undefined,
          },
        ],
        [
          "a review with NO findings would not have failed — nothing to repair",
          {
            ...base,
            priorRecordStatus: "completed",
            priorVerdict: { kind: "review", findings: 0 },
          },
        ],
        [
          "a review whose transport did not complete",
          {
            ...base,
            priorRecordStatus: "failed",
            priorVerdict: { kind: "review", findings: 1 },
          },
        ],
        [
          "a build whose verdict was not done",
          {
            ...base,
            priorRecordStatus: "blocked",
            priorVerdict: { kind: "build", status: "blocked" },
          },
        ],
        [
          "a build whose transport completed (its own version's record governs)",
          {
            ...base,
            priorRecordStatus: "completed",
            priorVerdict: { kind: "build", status: "done" },
          },
        ],
      ];
      for (const [why, facts] of refusals) {
        expect(reconcilablePriorEvidence(facts), why).toBeUndefined();
      }
    });
  });

  // ---------------------------------------------------------------- -C ----

  it("-C a reconciled review re-performs nothing: no second comment, no second review, ticket resumed", async () => {
    const handle = await installGithubDouble({ defaultBranch: "trunk", labels: OP_LABELS });
    disposers.push(() => handle.dispose());
    const gh = new GhCliOps(handle.repo, handle.exec);

    const issue = await gh.createIssue({
      title: "Reconciled review must not re-publish",
      body: "## Goal\nprove the reconciled path is side-effect free\n",
      labels: ["op:returned"], // where v1's findings left the ticket
    });
    handle.seedBranch("op/1-delivery");
    const pr = await gh.createPR({
      title: "op/1 delivery",
      body: `Closes #${issue.number}`,
      head: "op/1-delivery",
      base: "trunk",
    });

    const item: LoopItem = {
      issueNumber: issue.number,
      ticketRef: `#${issue.number}`,
      title: issue.title,
      body: issue.body,
      targetRepo: handle.repo,
      labels: ["op:returned"],
      phase: "returned",
      tier: "deep",
      cycles: 1,
      remediationAttempts: 0,
      gateResults: [],
      findings: [],
      prNumber: pr.number,
      branch: "op/1-delivery",
    };

    const evidence: ProviderEvidence = {
      record: { run_id: "run-v1", execution_step_id: "review-verify-v1" } as ProviderEvidence["record"],
      output: REVIEW_FINDINGS_VERDICT,
      reconciledFromPlanVersion: 1,
    };
    const input = {
      options: {
        root: (await home()).root,
        orgRoot: "/nonexistent-org-root",
        app: { name: REG202_APP, repo: handle.repo },
        roles: [],
        gh,
        policy: DEFAULT_LOOP_POLICY,
        commands: {},
        hooks: { gate: () => ({ allow: true as const }) },
        runtimeForAssignment: () => {
          throw new Error("a reconciled step must never construct a runtime");
        },
        plannerContext: { taste: [], memoryExcerpts: [] },
        remainingBudgetUsd: 100,
      },
      plan: REG202_PLAN_V2,
      step: REVIEW_VERIFY_STEP,
      item,
      context: {
        episodeId: REG202_PLAN_V2.episodeId,
        planVersion: 2,
        planHash: "e".repeat(64),
        stepId: REVIEW_VERIFY_STEP.id,
        stepHash: "f".repeat(64),
        attempt: 1,
        executionId: "exec-v2-review-verify",
        resume: false,
      },
      input: {} as TicketProviderExecutionInput["input"],
    } as unknown as TicketProviderExecutionInput;

    const before = handle.callLog().length;
    const applied = await applyProviderOutcome(input, REVIEW_DEFINITION, evidence, JSON.parse(REVIEW_FINDINGS_VERDICT));

    // The step completes — no typed failure, so the revision advances to `fix`.
    expect(applied.failure).toBeUndefined();
    // The findings travel forward: `fix` exists to answer them.
    expect(applied.item.findings).toHaveLength(1);
    expect(applied.item.findings[0]?.category).toBe("security");
    // The ticket is back in the loop's hands rather than parked.
    expect(applied.item.phase).toBe("building");
    expect((await gh.readIssue(issue.number)).labels).toEqual(["op:building"]);

    // And nothing was published a second time (INV-003: never re-perform).
    const newCalls = handle.callLog().slice(before);
    expect(newCalls.some((entry) => entry.op === "issue.comment")).toBe(false);
    expect(newCalls.some((entry) => entry.op === "pr.review")).toBe(false);
    expect(handle.readState().prs[String(pr.number)]?.reviews ?? []).toHaveLength(0);
  });
});
