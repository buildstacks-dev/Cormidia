import { describe, expect, it, vi } from "vitest";
import type { AcceptedTicketEpisodePlan } from "../src/loop/driver.js";
import {
  episodeIntentHash,
  type ApprovalStep,
  type CreatorScopeProvenance,
  type EpisodeIntent,
  type EpisodePlan,
} from "../src/loop/episode-plan.js";
import type { EpisodeStepExecutionContext } from "../src/loop/episode-plan-executor.js";
import type { LoopItem } from "../src/loop/types.js";
import { ApprovalStore } from "../src/org/approvals.js";
import {
  createExistingTicketApprovalHandler,
  ticketApprovalActionRef,
} from "../src/org/ticket-episode-approval.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

const NOW = new Date("2026-07-19T23:30:00.000Z");
const EXECUTION: EpisodeStepExecutionContext = {
  episodeId: "ticket:fixture:#7",
  planVersion: 1,
  planHash: "a".repeat(64),
  stepId: "approve-deploy",
  stepHash: "b".repeat(64),
  attempt: 1,
  executionId: "ticket:fixture:#7:v1:approve-deploy:a1",
  resume: false,
};

describe("ticket EpisodePlan durable approval observer", () => {
  it("returns pending without raising, deciding, or consuming authority", async () => {
    const fixture = makeOrgHome();
    try {
      const { store, approval } = await raiseApproval(fixture.root, "pending-approval");
      const actionRef = ticketApprovalActionRef(approval);
      const handler = createExistingTicketApprovalHandler({
        store,
        app: "fixture",
        roleNames: ["builder", "reviewer"],
      });

      await expect(handler(
        approvalStep(actionRef),
        EXECUTION,
        ticketItem(),
        acceptedPlan(actionRef),
      )).resolves.toMatchObject({
        status: "pending",
        reasonCode: "ticket_episode_approval_pending",
      });
      expect((await store.listPending()).map((item) => item.id)).toEqual(["pending-approval"]);
      expect(await store.listDecided()).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it("returns denied from the exact durable item and preserves the human reason", async () => {
    const fixture = makeOrgHome();
    try {
      const { store, approval } = await raiseApproval(fixture.root, "denied-approval");
      await store.decide(approval.id, {
        decision: "denied",
        reason: "use the staged rollout instead",
        now: NOW,
      });
      const actionRef = ticketApprovalActionRef(approval);
      const handler = createExistingTicketApprovalHandler({
        store,
        app: "fixture",
        roleNames: ["builder"],
      });

      await expect(handler(
        approvalStep(actionRef),
        EXECUTION,
        ticketItem(),
        acceptedPlan(actionRef),
      )).resolves.toEqual({
        status: "denied",
        reasonCode: "ticket_episode_approval_denied",
        summary: "approval denied-approval was denied: use the staged rollout instead",
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("completes only the exact approved reference without consuming its action grant", async () => {
    const fixture = makeOrgHome();
    try {
      const { store, approval } = await raiseApproval(fixture.root, "approved-approval");
      const decided = await store.decide(approval.id, { decision: "approved", now: NOW });
      const actionRef = ticketApprovalActionRef(approval);
      const before = await store.show(decided.id);
      const handler = createExistingTicketApprovalHandler({
        store,
        app: "fixture",
        roleNames: ["builder"],
      });

      await expect(handler(
        approvalStep(actionRef),
        EXECUTION,
        ticketItem(),
        acceptedPlan(actionRef),
      )).resolves.toMatchObject({
        status: "completed",
        artifact: {
          approvalId: "approved-approval",
          app: "fixture",
          role: "builder",
          ticketRef: "#7",
          actionAuthority: "role-scoped-action-gate",
        },
      });
      const after = await store.show(decided.id);
      expect(after.grant).toEqual(before.grant);
      expect(after.grant?.uses).toBe(1);
    } finally {
      fixture.cleanup();
    }
  });

  it("fails before store lookup when creator provenance does not carry the exact reference", async () => {
    const fixture = makeOrgHome();
    try {
      const { store, approval } = await raiseApproval(fixture.root, "unproven-approval");
      const actionRef = ticketApprovalActionRef(approval);
      const show = vi.spyOn(store, "show");
      const handler = createExistingTicketApprovalHandler({
        store,
        app: "fixture",
        roleNames: ["builder"],
      });

      await expect(handler(
        approvalStep(actionRef),
        EXECUTION,
        ticketItem(),
        acceptedPlan("approval:different:action-sha256:" + "0".repeat(64)),
      )).resolves.toMatchObject({
        status: "failed",
        reasonCode: "error_ticket_episode_approval_provenance_invalid",
      });
      expect(show).not.toHaveBeenCalled();
      expect(await store.listPending()).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a real approval from a different ticket without changing it", async () => {
    const fixture = makeOrgHome();
    try {
      const { store, approval } = await raiseApproval(fixture.root, "other-ticket-approval");
      const actionRef = ticketApprovalActionRef(approval);
      const handler = createExistingTicketApprovalHandler({
        store,
        app: "fixture",
        roleNames: ["builder"],
      });

      await expect(handler(
        approvalStep(actionRef),
        EXECUTION,
        ticketItem("#8"),
        acceptedPlan(actionRef),
      )).resolves.toMatchObject({
        status: "failed",
        reasonCode: "error_ticket_episode_approval_binding_mismatch",
      });
      expect((await store.listPending()).map((item) => item.id)).toEqual(["other-ticket-approval"]);
    } finally {
      fixture.cleanup();
    }
  });
});

async function raiseApproval(root: string, id: string) {
  const store = new ApprovalStore(root, { idSource: () => id });
  const approval = await store.raise({
    app: "fixture",
    role: "builder",
    turnId: "turn-7",
    ticketRef: "#7",
    rule: "production-deploy",
    action: {
      tool: "bash",
      input: { command: "kubectl apply -f deploy/fixture.yaml" },
    },
    justification: "deploy the exact reviewed artifact",
    now: NOW,
  });
  return { store, approval };
}

function approvalStep(actionRef: string): ApprovalStep {
  return {
    kind: "approval",
    id: "approve-deploy",
    objective: "Observe the existing decision for the exact deploy action",
    dependsOn: [],
    inputRefs: [{ ref: actionRef, required: true }],
    expectedOutputs: [{ id: "approval", kind: "approval", required: true }],
    approvalKind: "critical-operation",
    actionRef,
  };
}

function acceptedPlan(actionRef: string): AcceptedTicketEpisodePlan {
  const provenance: CreatorScopeProvenance = {
    source: "human",
    creatorId: "operator@example.test",
    createdAt: NOW.toISOString(),
    evidenceRefs: [actionRef],
  };
  const step = approvalStep(actionRef);
  const intent: EpisodeIntent = {
    episodeId: EXECUTION.episodeId,
    app: "fixture",
    assignmentMode: "fixed",
    trigger: { kind: "github_issue", sourceRef: "fixture/repo#7" },
    goal: "Execute only the already-approved ticket action",
    lifecycle: "existing-ticket",
    appStage: "live",
    repositoryFacts: {},
    requestedConstraints: {},
    hardBudget: {
      maxProviderTurns: 0,
      maxEquivalentCostUsd: 0,
      maxMechanicalOverheadUsd: 0,
      maxHumanDecisions: 1,
    },
    availableRoles: [],
    allowedAssignments: [],
    requiredSafetyFacts: [{ kind: "critical_operation", evidenceRefs: [actionRef] }],
    creatorScope: {
      planningDisposition: "execution_ready",
      provenance,
      objective: "Execute only the already-approved ticket action",
      inScope: ["the exact content-bound approval"],
      outOfScope: ["raising or widening authority"],
      acceptanceCriteria: ["the existing decision is observed without consuming its grant"],
      expectedArtifacts: [{ id: "approval", kind: "approval", required: true }],
      declaredConstraints: { approvalRef: actionRef },
      safetyFacts: [{ kind: "critical_operation", evidenceRefs: [actionRef] }],
      steps: [step],
    },
  };
  const plan: EpisodePlan = {
    schemaVersion: 1,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: intent.goal,
    workflowClass: "approved-ticket-action",
    planningSource: "creator_scope",
    creatorProvenance: provenance,
    steps: [step],
    estimatedBudget: {
      providerTurns: 0,
      providerTurnBudgetUsd: 0,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: 0,
    },
    derivedSafetyRoute: {
      label: "deep",
      reasons: ["critical operation"],
      gateStepIds: [],
      approvalStepIds: [step.id],
    },
    createdAt: NOW.toISOString(),
  };
  return { intent, plan };
}

function ticketItem(ticketRef = "#7"): LoopItem {
  return {
    issueNumber: Number(ticketRef.slice(1)),
    ticketRef,
    title: "Deploy the reviewed fixture",
    body: "- [ ] deploy the reviewed fixture",
    targetRepo: "fixture/repo",
    labels: ["op:building"],
    phase: "building",
    tier: "deep",
    cycles: 0,
    remediationAttempts: 0,
    gateResults: [],
    findings: [],
  };
}
