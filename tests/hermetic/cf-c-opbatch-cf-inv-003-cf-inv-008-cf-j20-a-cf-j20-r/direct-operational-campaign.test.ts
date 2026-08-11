// Traceability: CF-J20-R · HB-104; CF-J20-A · HB-104; CF-INV-003 · HB-011; CF-INV-008 · HB-032; CF-C-OPBATCH · HB-104 · contracts/journey-acceptance.md J-20; invariants.md INV-003/008; contracts/OP-batch.md direct-effects clauses.

// HB-106 — complete direct operational campaign units. C-OP-BATCH §1/§3a/§5,
// J-20-A, CORMIDIA-INV-003/004/008/016, and B-22.

import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { RoleConfig } from "../../../src/runtime/types.js";
import type { AppEntry } from "../../../src/org/apps.js";
import { ApprovalStore } from "../../../src/org/approvals.js";
import {
  acceptDirectOperationalCampaign,
  assertCampaignEffectIsolation,
  campaignAuthorityPath,
  campaignContentDraftPath,
  createCampaignContentDraft,
  createCampaignInteractionUnit,
  createDirectOperationalCampaignAuthority,
  prepareCampaignEffectApprovals,
  readCampaignEffectLedger,
  scheduleCampaignFollowUps,
  type CampaignDestination,
  type DirectOperationalCampaignInput,
} from "../../../src/org/direct-operational-campaign.js";
import { acceptDirectExecutionUnit } from "../../../src/org/roadmap-delivery/direct-execution-authority.js";
import { admitExecutionBatch } from "../../../src/org/roadmap-delivery/execution-batch-admission.js";
import { normalizeDirectExecutionUnitEpisode } from "../../../src/org/roadmap-delivery/direct-episode-normalization.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const AT = "2026-08-04T09:00:00.000Z";
const EFFECT_AT = new Date("2026-08-04T09:05:00.000Z");
const APP: AppEntry = {
  name: "campaign-app",
  repo: "fixture/campaign",
  status: "live",
  budgetUsdMonth: 100,
  objectiveBudgetUsd: 1000,
  cadence: {},
  execution: { assignmentMode: "fixed", allowedAssignments: {} },
};
const ROLES: RoleConfig[] = [role("planner", "claude", "planner-model"), role("marketing", "codex", "marketing-model")];
const homes: TempStateHome[] = [];

afterEach(async () => Promise.all(homes.splice(0).map((home) => home.cleanup())));

describe("HB-106 — direct operational campaign", () => {
  it("normalizes one coherent content turn plus seven exact approval steps", async () => {
    const home = await stateHome();
    const accepted = await acceptDirectOperationalCampaign({
      root: home.stateHome,
      campaign: campaign(),
    });
    expect(accepted.campaign.value.destinations.map((entry) => entry.channel)).toEqual([
      "reddit",
      "reddit",
      "reddit",
      "reddit",
      "reddit",
      "linkedin",
      "twitter",
    ]);
    expect(accepted.direct.value.steps).toHaveLength(9);
    expect(accepted.direct.value.steps?.filter((step) => step.kind === "provider_turn")).toHaveLength(1);
    expect(accepted.direct.value.steps?.filter((step) => step.kind === "approval")).toHaveLength(7);
    expect(existsSync(campaignAuthorityPath(home.stateHome, APP.name, "launch-campaign"))).toBe(true);

    const batch = await admitExecutionBatch({
      root: home.stateHome,
      app: APP.name,
      batchId: "campaign-batch",
      directUnitRefs: [accepted.direct.ref],
      routing: [],
      admittedAt: AT,
    });
    const normalized = await normalizeDirectExecutionUnitEpisode({
      root: home.stateHome,
      app: APP,
      roles: ROLES,
      batchRef: batch.ref,
      unitId: "launch-campaign",
      facts: facts(1, 7),
      providerOperations: ["marketing/campaign-content-plan"],
      workflowTemplates: undefined,
      now: () => new Date(AT),
    });
    expect(normalized.prepared).toMatchObject({ planningTurnSkipped: true, plannerAttempts: 0 });
    expect(normalized.plan.steps).toHaveLength(9);
    expect(normalized.plan.steps.filter((step) => step.kind === "provider_turn")).toHaveLength(1);
    expect(normalized.plan.steps.filter((step) => step.kind === "approval")).toHaveLength(7);
  });

  it("recovers partial approval preparation and keeps grants, acknowledgements, evidence, and follow-ups per destination", async () => {
    const home = await stateHome();
    let approvalSequence = 0;
    const store = new ApprovalStore(home.stateHome, {
      idSource: () => `approval-${String(++approvalSequence).padStart(2, "0")}`,
    });
    const accepted = await acceptDirectOperationalCampaign({
      root: home.stateHome,
      campaign: campaign(),
    });
    const draft = createCampaignContentDraft({
      campaign: accepted.campaign,
      contentTurnRef: "turn:marketing:campaign-content-plan",
      payloads: Object.fromEntries(
        DESTINATIONS.map((destination) => [
          destination.destinationId,
          `Exact ${destination.channel} payload for ${destination.target}`,
        ]),
      ),
      createdAt: AT,
    });

    await expect(
      prepareCampaignEffectApprovals({
        root: home.stateHome,
        campaign: accepted.campaign,
        draft,
        store,
        now: EFFECT_AT,
        fault: (_boundary, completed) => {
          if (completed === 3) throw new Error("SIMULATED CRASH after third exact approval");
        },
      }),
    ).rejects.toThrow(/SIMULATED CRASH/);
    expect(await store.listPending()).toHaveLength(3);

    const links = await prepareCampaignEffectApprovals({
      root: home.stateHome,
      campaign: accepted.campaign,
      draft,
      store,
      now: EFFECT_AT,
    });
    expect(links.effects).toHaveLength(7);
    expect(existsSync(campaignContentDraftPath(home.stateHome, APP.name, "launch-campaign"))).toBe(true);
    expect(new Set(links.effects.map((effect) => effect.approvalId)).size).toBe(7);
    expect(await store.listPending()).toHaveLength(7);
    expect(
      await prepareCampaignEffectApprovals({
        root: home.stateHome,
        campaign: accepted.campaign,
        draft,
        store,
        now: new Date(EFFECT_AT.getTime() + 60_000),
      }),
    ).toEqual(links);
    const changedDraft = createCampaignContentDraft({
      campaign: accepted.campaign,
      contentTurnRef: draft.contentTurnRef,
      payloads: Object.fromEntries(
        DESTINATIONS.map((destination) => [
          destination.destinationId,
          destination.destinationId === "reddit-one"
            ? "changed after immutable preparation"
            : `Exact ${destination.channel} payload for ${destination.target}`,
        ]),
      ),
      createdAt: draft.createdAt,
    });
    await expect(
      prepareCampaignEffectApprovals({
        root: home.stateHome,
        campaign: accepted.campaign,
        draft: changedDraft,
        store,
        now: EFFECT_AT,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "campaign_authority_conflict" }));

    const pending = await readCampaignEffectLedger({
      root: home.stateHome,
      campaign: accepted.campaign,
      store,
    });
    expect(pending.effects.map((effect) => effect.acknowledgement)).toEqual(
      Array.from({ length: 7 }, () => "pending_approval"),
    );
    expect(pending.effects.every((effect) => effect.followUpOutcome === "blocked_on_effect")).toBe(true);

    // Local fixture-only lifecycle evidence: no connector or external executor
    // is invoked. Each synthetic terminal record still needs its own human
    // grant and exact remote evidence identity.
    for (const [index, link] of links.effects.entries()) {
      const decided = await store.decide(link.approvalId, {
        decision: "approved",
        decidedBy: { kind: "human", identity: "fixture-owner" },
        now: EFFECT_AT,
      });
      expect(decided.grantId).toBeDefined();
      await store.beginExecution(link.approvalId, `fixture-executor:${link.effectId}`, EFFECT_AT);
      await store.finishExecution({
        id: link.approvalId,
        state: "executed",
        actor: `fixture-executor:${link.effectId}`,
        result: "synthetic exact-effect acknowledgement; no connector invoked",
        remoteRef: `fixture:campaign-effect:${index}`,
        now: EFFECT_AT,
      });
    }
    const acknowledged = await readCampaignEffectLedger({
      root: home.stateHome,
      campaign: accepted.campaign,
      store,
    });
    expect(acknowledged.effects.every((effect) => effect.acknowledgement === "acknowledged")).toBe(true);
    expect(new Set(acknowledged.effects.map((effect) => effect.grantId)).size).toBe(7);
    expect(new Set(acknowledged.effects.flatMap((effect) => effect.evidenceRefs)).size).toBe(28);
    expect(acknowledged.effects.every((effect) => effect.followUpOutcome === "ready_to_schedule")).toBe(true);

    const observeAtByDestination = Object.fromEntries(
      DESTINATIONS.map((destination, index) => [
        destination.destinationId,
        new Date(Date.parse(AT) + (index + 1) * 86_400_000).toISOString(),
      ]),
    );
    const schedule = await scheduleCampaignFollowUps({
      root: home.stateHome,
      campaign: accepted.campaign,
      ledger: acknowledged,
      observeAtByDestination,
      createdAt: AT,
    });
    expect(schedule.destinations).toHaveLength(7);
    expect(
      await scheduleCampaignFollowUps({
        root: home.stateHome,
        campaign: accepted.campaign,
        ledger: acknowledged,
        observeAtByDestination,
        createdAt: new Date(Date.parse(AT) + 60_000).toISOString(),
      }),
    ).toEqual(schedule);
    const scheduledLedger = await readCampaignEffectLedger({
      root: home.stateHome,
      campaign: accepted.campaign,
      store,
    });
    expect(scheduledLedger.effects.every((effect) => effect.followUpOutcome === "scheduled")).toBe(true);

    // Seeded broadened-grant negative control: sharing one approval id across
    // two destinations must turn this detector red.
    const broadened = structuredClone(links.effects);
    broadened[1]!.approvalId = broadened[0]!.approvalId;
    expect(() => assertCampaignEffectIsolation(accepted.campaign, broadened)).toThrowError(
      expect.objectContaining({ code: "campaign_effect_broadened" }),
    );
  });

  it("turns an unknown interaction into a new authority and new EpisodePlan", async () => {
    const home = await stateHome();
    const accepted = await acceptDirectOperationalCampaign({
      root: home.stateHome,
      campaign: campaign(),
    });
    const interactionAuthority = createCampaignInteractionUnit({
      campaign: accepted.campaign,
      destinationId: "reddit-one",
      interactionRef: "reddit:comment:new-123",
      unitId: "interaction-new-123",
      provenance: {
        source: "agent",
        creatorId: "marketing-observer",
        createdAt: AT,
        evidenceRefs: ["reddit:comment:new-123"],
      },
      admittedBudget: budget(1, 0),
      createdAt: AT,
    });
    const interaction = await acceptDirectExecutionUnit({
      root: home.stateHome,
      authority: interactionAuthority,
    });
    expect(interaction.ref.sha256).not.toBe(accepted.direct.ref.sha256);

    const batch = await admitExecutionBatch({
      root: home.stateHome,
      app: APP.name,
      batchId: "interaction-batch",
      directUnitRefs: [interaction.ref],
      routing: [],
      admittedAt: AT,
    });
    const normalized = await normalizeDirectExecutionUnitEpisode({
      root: home.stateHome,
      app: APP,
      roles: ROLES,
      batchRef: batch.ref,
      unitId: "interaction-new-123",
      facts: facts(1, 0),
      providerOperations: ["marketing/campaign-interaction-response"],
      workflowTemplates: undefined,
      now: () => new Date(AT),
    });
    expect(normalized.plan.episodeId).not.toContain(accepted.campaign.ref.sha256.slice(0, 32));
    expect(normalized.plan.steps).toHaveLength(1);
    expect(normalized.plan.steps[0]).toMatchObject({
      kind: "provider_turn",
      operation: "marketing/campaign-interaction-response",
    });
  });

  it("does not treat an executed state without remote effect evidence as acknowledged", async () => {
    const home = await stateHome();
    const accepted = await acceptDirectOperationalCampaign({
      root: home.stateHome,
      campaign: campaign(),
    });
    const draft = createCampaignContentDraft({
      campaign: accepted.campaign,
      contentTurnRef: "turn:marketing:missing-remote-control",
      payloads: Object.fromEntries(
        DESTINATIONS.map((destination) => [
          destination.destinationId,
          `Exact ${destination.channel} payload for ${destination.target}`,
        ]),
      ),
      createdAt: AT,
    });
    let sequence = 0;
    const uniqueStore = new ApprovalStore(home.stateHome, {
      idSource: () => `approval-no-remote-${++sequence}`,
    });
    const links = await prepareCampaignEffectApprovals({
      root: home.stateHome,
      campaign: accepted.campaign,
      draft,
      store: uniqueStore,
      now: EFFECT_AT,
    });
    const first = links.effects[0]!;
    await uniqueStore.decide(first.approvalId, {
      decision: "approved",
      decidedBy: { kind: "human", identity: "fixture-owner" },
      now: EFFECT_AT,
    });
    await uniqueStore.beginExecution(first.approvalId, "fixture-executor:no-remote", EFFECT_AT);
    await uniqueStore.finishExecution({
      id: first.approvalId,
      state: "executed",
      actor: "fixture-executor:no-remote",
      result: "synthetic state without remote evidence; no connector invoked",
      now: EFFECT_AT,
    });
    const ledger = await readCampaignEffectLedger({
      root: home.stateHome,
      campaign: accepted.campaign,
      store: uniqueStore,
    });
    expect(ledger.effects[0]).toMatchObject({
      acknowledgement: "ambiguous",
      followUpOutcome: "blocked_on_effect",
    });
    expect(ledger.effects[0]!.evidenceRefs.some((ref) => ref.startsWith("execution:"))).toBe(true);
  });

  it("refuses a prose-complete campaign whose destination cardinality is wrong", () => {
    const invalid = campaign();
    invalid.destinations = invalid.destinations.slice(0, 6);
    expect(() => createDirectOperationalCampaignAuthority(invalid)).toThrowError(
      expect.objectContaining({ code: "campaign_shape_invalid" }),
    );
  });
});

const DESTINATIONS: CampaignDestination[] = [
  { destinationId: "reddit-one", channel: "reddit", target: "r/one", purpose: "community one" },
  { destinationId: "reddit-two", channel: "reddit", target: "r/two", purpose: "community two" },
  { destinationId: "reddit-three", channel: "reddit", target: "r/three", purpose: "community three" },
  { destinationId: "reddit-four", channel: "reddit", target: "r/four", purpose: "community four" },
  { destinationId: "reddit-five", channel: "reddit", target: "r/five", purpose: "community five" },
  { destinationId: "linkedin-main", channel: "linkedin", target: "company/main", purpose: "company audience" },
  { destinationId: "twitter-main", channel: "twitter", target: "@campaign", purpose: "short-form audience" },
];

function campaign(): DirectOperationalCampaignInput {
  return {
    unitId: "launch-campaign",
    app: APP.name,
    objective: "Draft and govern the accepted launch campaign.",
    campaignBriefRef: "brief:launch-v1",
    destinations: structuredClone(DESTINATIONS),
    provenance: {
      source: "human",
      creatorId: "fixture-owner",
      createdAt: AT,
      evidenceRefs: ["brief:launch-v1"],
    },
    dedupeKey: ["launch", "campaign", "v1"].join("-"),
    admittedBudget: budget(1, 7),
    createdAt: AT,
  };
}

function role(name: string, runtime: RoleConfig["runtime"], model: string): RoleConfig {
  return {
    name,
    runtime,
    model,
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: [name],
    maxTurnBudgetUsd: 10,
  };
}

function budget(providerTurns: number, humanDecisions: number) {
  return {
    maxProviderTurns: providerTurns,
    maxEquivalentCostUsd: 5,
    maxMechanicalOverheadUsd: 0,
    maxActiveTimeMs: 60_000,
    maxHumanDecisions: humanDecisions,
  };
}

function facts(providerTurns: number, humanDecisions: number) {
  return {
    trigger: { kind: "direct_campaign", sourceRef: "fixture" },
    goal: "Execute one bounded direct campaign unit.",
    lifecycle: "live" as const,
    appStage: "growth" as const,
    repositoryFacts: { repo: APP.repo },
    requestedConstraints: { externalEffects: "per_destination_approval" },
    hardBudget: {
      maxProviderTurns: providerTurns,
      maxEquivalentCostUsd: 5,
      maxMechanicalOverheadUsd: 0,
      maxActiveTimeMs: 60_000,
      maxHumanDecisions: humanDecisions,
    },
    requiredSafetyFacts: [],
  };
}

async function stateHome(): Promise<TempStateHome> {
  const home = await makeTempStateHome({ name: "hb106" });
  homes.push(home);
  return home;
}
