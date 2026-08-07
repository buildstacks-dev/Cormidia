// Direct operational campaign authority (HB-106).
//
// Campaign planning may share one Marketing provider turn, but effect
// authority never shares: every destination has its own content-bound approval,
// execution acknowledgement, evidence projection, and follow-up disposition.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeLoopFileOnce } from "../loop/durable.js";
import { stableHash, type CreatorScopeProvenance, type ProposedEpisodeStep } from "../loop/episode-plan.js";
import type { ApprovalItem } from "./approvals.js";
import { ApprovalStore } from "./approvals.js";
import { ROADMAP_DELIVERY_SCHEMA_VERSION, type AcceptedAuthority } from "./roadmap-delivery/authority-core.js";
import {
  acceptDirectExecutionUnit,
  type DirectExecutionUnitAuthority,
} from "./roadmap-delivery/direct-execution-authority.js";
import type { ExecutionUnitBudget } from "./roadmap-delivery/execution-model.js";

const DIRECT_OPERATIONAL_CAMPAIGN_SCHEMA_VERSION = 1 as const;
const DIRECT_CAMPAIGN_CONTENT_OPERATION = "marketing/campaign-content-plan" as const;

type CampaignChannel = "reddit" | "linkedin" | "twitter";
type CampaignFailureCode =
  | "campaign_shape_invalid"
  | "campaign_content_invalid"
  | "campaign_effect_broadened"
  | "campaign_authority_conflict"
  | "campaign_authority_corrupt"
  | "campaign_effect_not_acknowledged";

class DirectCampaignError extends Error {
  constructor(
    readonly code: CampaignFailureCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "DirectCampaignError";
  }
}

export interface CampaignDestination {
  destinationId: string;
  channel: CampaignChannel;
  target: string;
  purpose: string;
}

export interface DirectOperationalCampaignInput {
  unitId: string;
  app: string;
  objective: string;
  campaignBriefRef: string;
  destinations: CampaignDestination[];
  provenance: CreatorScopeProvenance;
  dedupeKey: string;
  admittedBudget: ExecutionUnitBudget;
  createdAt: string;
}

interface CampaignAuthorityRef {
  kind: "direct_operational_campaign";
  id: string;
  version: 1;
  sha256: string;
}

interface DirectOperationalCampaignAuthority {
  schemaVersion: typeof DIRECT_OPERATIONAL_CAMPAIGN_SCHEMA_VERSION;
  kind: "direct_operational_campaign";
  unitId: string;
  app: string;
  objective: string;
  campaignBriefRef: string;
  directAuthorityRef: AcceptedAuthority<DirectExecutionUnitAuthority>["ref"];
  /** Stable destination order is the content-turn output and approval order. */
  destinations: Array<
    CampaignDestination & {
      payloadOutputId: string;
      approvalStepId: string;
      effectId: string;
    }
  >;
  contentPlanning: {
    maxProviderTurns: 1;
    role: "marketing";
    operation: typeof DIRECT_CAMPAIGN_CONTENT_OPERATION;
  };
  effectContract: {
    approvalRule: "external-publishing";
    approvalCardinality: "one_exact_grant_per_destination";
    acknowledgementCardinality: "one_exact_outcome_per_destination";
    evidenceCardinality: "one_evidence_set_per_destination";
    followUpCardinality: "one_outcome_per_destination";
    unknownInteractionPolicy: "new_execution_unit_and_episode_plan";
  };
  validationContract: {
    requiredChecks: string[];
    evidenceRequirements: string[];
  };
  createdAt: string;
}

interface AcceptedCampaignAuthority {
  ref: CampaignAuthorityRef;
  value: DirectOperationalCampaignAuthority;
}

interface CampaignContentDraft {
  schemaVersion: typeof DIRECT_OPERATIONAL_CAMPAIGN_SCHEMA_VERSION;
  campaignRef: CampaignAuthorityRef;
  contentTurnRef: string;
  destinations: Array<{
    destinationId: string;
    payload: string;
    payloadSha256: string;
  }>;
  createdAt: string;
}

interface CampaignEffectLink {
  destinationId: string;
  effectId: string;
  approvalId: string;
  actionSha256: string;
  payloadSha256: string;
}

interface CampaignEffectLinks {
  schemaVersion: typeof DIRECT_OPERATIONAL_CAMPAIGN_SCHEMA_VERSION;
  campaignRef: CampaignAuthorityRef;
  contentDraftSha256: string;
  effects: CampaignEffectLink[];
  createdAt: string;
}

type CampaignAcknowledgement =
  | "pending_approval"
  | "denied"
  | "expired"
  | "approved_not_executed"
  | "executing"
  | "acknowledged"
  | "failed"
  | "ambiguous";

interface CampaignEffectOutcome {
  destinationId: string;
  effectId: string;
  approvalId: string;
  grantId: string | null;
  acknowledgement: CampaignAcknowledgement;
  evidenceRefs: string[];
  followUpOutcome: "blocked_on_effect" | "ready_to_schedule" | "scheduled";
}

interface CampaignEffectLedger {
  schemaVersion: typeof DIRECT_OPERATIONAL_CAMPAIGN_SCHEMA_VERSION;
  campaignRef: CampaignAuthorityRef;
  effects: CampaignEffectOutcome[];
}

interface CampaignFollowUpSchedule {
  schemaVersion: typeof DIRECT_OPERATIONAL_CAMPAIGN_SCHEMA_VERSION;
  campaignRef: CampaignAuthorityRef;
  destinations: Array<{
    destinationId: string;
    effectId: string;
    approvalId: string;
    effectEvidenceRef: string;
    observeAt: string;
    outcome: "scheduled";
  }>;
  createdAt: string;
}

export function createDirectOperationalCampaignAuthority(
  input: DirectOperationalCampaignInput,
): DirectExecutionUnitAuthority {
  assertCampaignInput(input);
  const destinations = normalizedDestinations(input.destinations);
  const outputs = destinations.map((destination) => ({
    id: destination.payloadOutputId,
    kind: `campaign-payload/${destination.channel}`,
    required: true,
  }));
  const approvalStepIds = destinations.map((destination) => destination.approvalStepId);
  const steps: ProposedEpisodeStep[] = [
    {
      id: "campaign-content-plan",
      kind: "provider_turn",
      operation: DIRECT_CAMPAIGN_CONTENT_OPERATION,
      role: "marketing",
      objective:
        "Draft one coherent campaign while returning a distinct exact payload for every authorized destination.",
      requiredCapabilities: [],
      dependsOn: [],
      inputRefs: [{ ref: input.campaignBriefRef, required: true }],
      expectedOutputs: outputs,
      maxTurnBudgetUsd: input.admittedBudget.maxEquivalentCostUsd,
      selectionReason: "Marketing owns the single bounded multi-destination content-planning turn.",
    },
    ...destinations.map(
      (destination): ProposedEpisodeStep => ({
        id: destination.approvalStepId,
        kind: "approval",
        approvalKind: "external-publication",
        actionRef: `plan-output:${destination.payloadOutputId}`,
        objective: `Authorize only the exact ${destination.channel} payload for ${destination.target}.`,
        dependsOn: ["campaign-content-plan"],
        inputRefs: [{ ref: `plan-output:${destination.payloadOutputId}`, required: true }],
        expectedOutputs: [],
      }),
    ),
    {
      id: "campaign-effect-authority-ready",
      kind: "mechanical_gate",
      gate: "campaign/effect-authority-complete",
      objective: "Verify that all seven content-bound approval boundaries remain distinct.",
      dependsOn: approvalStepIds,
      inputRefs: destinations.map((destination) => ({
        ref: `plan-output:${destination.payloadOutputId}`,
        required: true,
      })),
      expectedOutputs: [
        {
          id: "campaign-effect-contract",
          kind: "campaign-effect-contract",
          required: true,
        },
      ],
    },
  ];
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    kind: "direct_operation",
    unitId: input.unitId,
    app: input.app,
    objective: input.objective,
    inScope: [
      "one coherent campaign content-planning turn",
      ...destinations.map((destination) => `content-bound ${destination.channel} effect for ${destination.target}`),
      "per-destination effect evidence and follow-up scheduling",
    ],
    outOfScope: [
      "aggregate or reusable publication grants",
      "publication without an exact executor acknowledgement",
      "treating a future reply or interaction as part of this unit",
    ],
    acceptanceCriteria: [
      "all seven destination payloads are drafted by one bounded Marketing turn",
      "each destination has its own exact approval, acknowledgement, evidence, and follow-up outcome",
      "unknown future interactions enter a new direct execution unit and EpisodePlan",
    ],
    expectedArtifacts: [
      {
        id: "campaign-effect-contract",
        kind: "campaign-effect-contract",
        required: true,
      },
    ],
    declaredConstraints: {
      campaignShape: "five_reddit_one_linkedin_one_twitter",
      campaignBriefRef: input.campaignBriefRef,
      destinationCount: destinations.length,
      effectApproval: "per_destination_content_bound",
      effectAcknowledgement: "per_destination_exact",
      evidence: "per_destination",
      followUp: "per_destination",
      unknownInteraction: "new_execution_unit_and_episode_plan",
    },
    safetyFacts: [
      {
        kind: "external_publication",
        evidenceRefs: [...new Set([input.campaignBriefRef, ...input.provenance.evidenceRefs])].sort(),
      },
    ],
    steps,
    provenance: structuredClone(input.provenance),
    dedupeKey: input.dedupeKey,
    admittedBudget: structuredClone(input.admittedBudget),
    createdAt: input.createdAt,
  };
}

export async function acceptDirectOperationalCampaign(input: {
  root: string;
  campaign: DirectOperationalCampaignInput;
}): Promise<{
  direct: AcceptedAuthority<DirectExecutionUnitAuthority>;
  campaign: AcceptedCampaignAuthority;
}> {
  const directValue = createDirectOperationalCampaignAuthority(input.campaign);
  const direct = await acceptDirectExecutionUnit({ root: input.root, authority: directValue });
  const value: DirectOperationalCampaignAuthority = {
    schemaVersion: DIRECT_OPERATIONAL_CAMPAIGN_SCHEMA_VERSION,
    kind: "direct_operational_campaign",
    unitId: input.campaign.unitId,
    app: input.campaign.app,
    objective: input.campaign.objective,
    campaignBriefRef: input.campaign.campaignBriefRef,
    directAuthorityRef: direct.ref,
    destinations: normalizedDestinations(input.campaign.destinations),
    contentPlanning: {
      maxProviderTurns: 1,
      role: "marketing",
      operation: DIRECT_CAMPAIGN_CONTENT_OPERATION,
    },
    effectContract: {
      approvalRule: "external-publishing",
      approvalCardinality: "one_exact_grant_per_destination",
      acknowledgementCardinality: "one_exact_outcome_per_destination",
      evidenceCardinality: "one_evidence_set_per_destination",
      followUpCardinality: "one_outcome_per_destination",
      unknownInteractionPolicy: "new_execution_unit_and_episode_plan",
    },
    validationContract: {
      requiredChecks: [
        "accepted-campaign-shape",
        "exact-destination-payload-hash",
        "per-destination-approval-identity",
        "per-destination-execution-acknowledgement",
        "per-destination-follow-up-outcome",
      ],
      evidenceRequirements: [
        "direct execution authority reference",
        "content turn reference and draft hash",
        "approval and grant identities",
        "executor terminal state and remote reference when acknowledged",
        "follow-up schedule or explicit blocked outcome",
      ],
    },
    createdAt: input.campaign.createdAt,
  };
  const ref: CampaignAuthorityRef = {
    kind: "direct_operational_campaign",
    id: value.unitId,
    version: 1,
    sha256: stableHash(value),
  };
  const accepted = { ref, value } satisfies AcceptedCampaignAuthority;
  const path = campaignAuthorityPath(input.root, value.app, value.unitId);
  const created = await writeLoopFileOnce(path, renderJson(accepted));
  if (!created) {
    const existing = await readAcceptedCampaign(path);
    if (stableHash(existing) !== stableHash(accepted)) {
      throw new DirectCampaignError(
        "campaign_authority_conflict",
        `campaign ${value.unitId} already has different accepted authority`,
      );
    }
    return { direct, campaign: existing };
  }
  return { direct, campaign: accepted };
}

export function createCampaignContentDraft(input: {
  campaign: AcceptedCampaignAuthority;
  contentTurnRef: string;
  payloads: Readonly<Record<string, string>>;
  createdAt: string;
}): CampaignContentDraft {
  assertNonEmpty(input.contentTurnRef, "content turn reference", "campaign_content_invalid");
  assertDateTime(input.createdAt, "content draft createdAt", "campaign_content_invalid");
  const expected = input.campaign.value.destinations.map((destination) => destination.destinationId);
  const supplied = Object.keys(input.payloads).sort();
  if (stableHash([...expected].sort()) !== stableHash(supplied)) {
    throw new DirectCampaignError(
      "campaign_content_invalid",
      "campaign draft must contain exactly one payload for every accepted destination",
    );
  }
  return {
    schemaVersion: DIRECT_OPERATIONAL_CAMPAIGN_SCHEMA_VERSION,
    campaignRef: structuredClone(input.campaign.ref),
    contentTurnRef: input.contentTurnRef,
    destinations: input.campaign.value.destinations.map((destination) => {
      const payload = input.payloads[destination.destinationId]!;
      assertNonEmpty(payload, `${destination.destinationId} payload`, "campaign_content_invalid");
      return {
        destinationId: destination.destinationId,
        payload,
        payloadSha256: stableHash(payload),
      };
    }),
    createdAt: input.createdAt,
  };
}

/** Persist seven exact approval requests. A crash after any individual raise
 * is safe: ApprovalStore deduplicates the content-bound action and replay
 * completes the missing links without widening an earlier decision. */
export async function prepareCampaignEffectApprovals(input: {
  root: string;
  campaign: AcceptedCampaignAuthority;
  draft: CampaignContentDraft;
  store?: ApprovalStore;
  now?: Date;
  fault?: (boundary: "after_approval_raise", completed: number) => void;
}): Promise<CampaignEffectLinks> {
  assertCampaignDraft(input.campaign, input.draft);
  await persistCampaignContentDraft(input.root, input.campaign, input.draft);
  const path = campaignEffectLinksPath(input.root, input.campaign.value.app, input.campaign.value.unitId);
  if (existsSync(path)) {
    const existing = await readJson<CampaignEffectLinks>(path);
    assertCampaignEffectIsolation(input.campaign, existing.effects);
    if (
      stableHash(existing.campaignRef) !== stableHash(input.campaign.ref) ||
      existing.contentDraftSha256 !== stableHash(input.draft)
    ) {
      throw new DirectCampaignError(
        "campaign_authority_conflict",
        "campaign approval links belong to different accepted content",
      );
    }
    return existing;
  }
  const store = input.store ?? new ApprovalStore(input.root);
  const effects: CampaignEffectLink[] = [];
  for (const destination of input.campaign.value.destinations) {
    const content = input.draft.destinations.find(
      (candidate) => candidate.destinationId === destination.destinationId,
    )!;
    const action = campaignPublishAction(input.campaign, destination, content);
    const item = await store.raise({
      app: input.campaign.value.app,
      role: "marketing",
      rule: "external-publishing",
      action,
      ticketRef: `direct-unit:${input.campaign.value.unitId}`,
      justification:
        `Publish only campaign ${input.campaign.value.unitId} destination ` +
        `${destination.destinationId}; all sibling destinations require separate decisions.`,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    effects.push({
      destinationId: destination.destinationId,
      effectId: destination.effectId,
      approvalId: item.id,
      actionSha256: stableHash(action),
      payloadSha256: content.payloadSha256,
    });
    input.fault?.("after_approval_raise", effects.length);
  }
  assertCampaignEffectIsolation(input.campaign, effects);
  const links: CampaignEffectLinks = {
    schemaVersion: DIRECT_OPERATIONAL_CAMPAIGN_SCHEMA_VERSION,
    campaignRef: structuredClone(input.campaign.ref),
    contentDraftSha256: stableHash(input.draft),
    effects,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  const created = await writeLoopFileOnce(path, renderJson(links));
  if (!created) {
    const existing = await readJson<CampaignEffectLinks>(path);
    if (
      stableHash(existing.campaignRef) !== stableHash(links.campaignRef) ||
      existing.contentDraftSha256 !== links.contentDraftSha256 ||
      stableHash(existing.effects) !== stableHash(links.effects)
    ) {
      throw new DirectCampaignError(
        "campaign_authority_conflict",
        "campaign approval links differ from their immutable accepted draft",
      );
    }
    return existing;
  }
  return links;
}

export function assertCampaignEffectIsolation(
  campaign: AcceptedCampaignAuthority,
  effects: readonly CampaignEffectLink[],
): void {
  const expected = campaign.value.destinations;
  if (effects.length !== expected.length) {
    throw new DirectCampaignError(
      "campaign_effect_broadened",
      "campaign effect links must retain one entry per destination",
    );
  }
  const approvals = new Set<string>();
  const effectIds = new Set<string>();
  for (let index = 0; index < expected.length; index++) {
    const destination = expected[index]!;
    const effect = effects[index]!;
    if (
      effect.destinationId !== destination.destinationId ||
      effect.effectId !== destination.effectId ||
      approvals.has(effect.approvalId) ||
      effectIds.has(effect.effectId) ||
      !isHash(effect.actionSha256) ||
      !isHash(effect.payloadSha256)
    ) {
      throw new DirectCampaignError(
        "campaign_effect_broadened",
        "a destination lost its exact effect, approval, action, or payload identity",
      );
    }
    approvals.add(effect.approvalId);
    effectIds.add(effect.effectId);
  }
}

export async function readCampaignEffectLedger(input: {
  root: string;
  campaign: AcceptedCampaignAuthority;
  store?: ApprovalStore;
}): Promise<CampaignEffectLedger> {
  const links = await readJson<CampaignEffectLinks>(
    campaignEffectLinksPath(input.root, input.campaign.value.app, input.campaign.value.unitId),
  );
  assertCampaignEffectIsolation(input.campaign, links.effects);
  const draft = await readJson<CampaignContentDraft>(
    campaignContentDraftPath(input.root, input.campaign.value.app, input.campaign.value.unitId),
  );
  assertCampaignDraft(input.campaign, draft);
  if (links.contentDraftSha256 !== stableHash(draft)) {
    throw new DirectCampaignError(
      "campaign_authority_corrupt",
      "campaign effect links lose their immutable content draft",
    );
  }
  const schedule = await readCampaignFollowUpSchedule(
    input.root,
    input.campaign.value.app,
    input.campaign.value.unitId,
  );
  if (stableHash(links.campaignRef) !== stableHash(input.campaign.ref)) {
    throw new DirectCampaignError(
      "campaign_authority_corrupt",
      "campaign effect links lose their accepted campaign reference",
    );
  }
  if (schedule !== undefined) {
    assertCampaignFollowUpSchedule(input.campaign, links, schedule);
  }
  const scheduled = new Set(schedule?.destinations.map((entry) => entry.destinationId) ?? []);
  const store = input.store ?? new ApprovalStore(input.root);
  const effects: CampaignEffectOutcome[] = [];
  for (const link of links.effects) {
    const snapshot = await store.show(link.approvalId);
    const destination = input.campaign.value.destinations.find(
      (candidate) => candidate.destinationId === link.destinationId,
    )!;
    const content = draft.destinations.find((candidate) => candidate.destinationId === link.destinationId)!;
    const expectedAction = campaignPublishAction(input.campaign, destination, content);
    if (
      snapshot.item.id !== link.approvalId ||
      snapshot.item.app !== input.campaign.value.app ||
      snapshot.item.role !== "marketing" ||
      snapshot.item.rule !== "external-publishing" ||
      snapshot.item.ticketRef !== `direct-unit:${input.campaign.value.unitId}` ||
      link.payloadSha256 !== content.payloadSha256 ||
      link.actionSha256 !== stableHash(expectedAction) ||
      stableHash(snapshot.item.action) !== link.actionSha256
    ) {
      throw new DirectCampaignError(
        "campaign_authority_corrupt",
        `approval ${link.approvalId} no longer matches its exact campaign effect`,
      );
    }
    effects.push(projectCampaignEffectOutcome(link, snapshot.item, scheduled.has(link.destinationId)));
  }
  return {
    schemaVersion: DIRECT_OPERATIONAL_CAMPAIGN_SCHEMA_VERSION,
    campaignRef: structuredClone(input.campaign.ref),
    effects,
  };
}

function projectCampaignEffectOutcome(
  link: CampaignEffectLink,
  item: ApprovalItem,
  followUpScheduled = false,
): CampaignEffectOutcome {
  const executionState = item.execution?.state;
  const acknowledgement: CampaignAcknowledgement =
    item.status === "pending"
      ? "pending_approval"
      : item.status === "expired"
        ? "expired"
        : item.status !== "approved"
          ? "denied"
          : executionState === "executed" &&
              item.execution?.remoteRef !== undefined &&
              item.execution.remoteRef.trim().length > 0
            ? "acknowledged"
            : executionState === "executed"
              ? "ambiguous"
              : executionState === "executing"
                ? "executing"
                : executionState === "failed"
                  ? "failed"
                  : executionState === "ambiguous"
                    ? "ambiguous"
                    : "approved_not_executed";
  const evidenceRefs = [
    `approval:${item.id}`,
    ...(item.grantId === undefined ? [] : [`grant:${item.grantId}`]),
    ...(item.execution?.result === undefined
      ? []
      : [`execution:${item.id}:${item.execution.state}:${stableHash(item.execution.result)}`]),
    ...(item.execution?.remoteRef === undefined ? [] : [item.execution.remoteRef]),
  ];
  return {
    destinationId: link.destinationId,
    effectId: link.effectId,
    approvalId: link.approvalId,
    grantId: item.grantId ?? null,
    acknowledgement,
    evidenceRefs,
    followUpOutcome: followUpScheduled
      ? "scheduled"
      : acknowledgement === "acknowledged"
        ? "ready_to_schedule"
        : "blocked_on_effect",
  };
}

/** Persist observation intent only. This does not install a scheduler or call
 * a connector. Every effect must already have an exact executor
 * acknowledgement and evidence reference. */
export async function scheduleCampaignFollowUps(input: {
  root: string;
  campaign: AcceptedCampaignAuthority;
  ledger: CampaignEffectLedger;
  observeAtByDestination: Readonly<Record<string, string>>;
  createdAt: string;
}): Promise<CampaignFollowUpSchedule> {
  assertDateTime(input.createdAt, "follow-up schedule createdAt", "campaign_effect_not_acknowledged");
  const durableLedger = await readCampaignEffectLedger({
    root: input.root,
    campaign: input.campaign,
  });
  if (
    stableHash(input.ledger.campaignRef) !== stableHash(input.campaign.ref) ||
    input.ledger.effects.length !== input.campaign.value.destinations.length ||
    stableHash(input.ledger.effects.map(effectAuthorityProjection)) !==
      stableHash(durableLedger.effects.map(effectAuthorityProjection))
  ) {
    throw new DirectCampaignError(
      "campaign_effect_not_acknowledged",
      "follow-up schedule does not cover the accepted destination set",
    );
  }
  const path = campaignFollowUpPath(input.root, input.campaign.value.app, input.campaign.value.unitId);
  const destinations = input.campaign.value.destinations.map((destination) => {
    const effect = durableLedger.effects.find((candidate) => candidate.destinationId === destination.destinationId);
    const observeAt = input.observeAtByDestination[destination.destinationId];
    if (
      effect?.effectId !== destination.effectId ||
      effect.acknowledgement !== "acknowledged" ||
      effect.evidenceRefs.length === 0 ||
      observeAt === undefined
    ) {
      throw new DirectCampaignError(
        "campaign_effect_not_acknowledged",
        `destination ${destination.destinationId} lacks acknowledged effect evidence or follow-up time`,
      );
    }
    assertDateTime(observeAt, `${destination.destinationId} observeAt`, "campaign_effect_not_acknowledged");
    return {
      destinationId: destination.destinationId,
      effectId: destination.effectId,
      approvalId: effect.approvalId,
      effectEvidenceRef: effect.evidenceRefs.at(-1)!,
      observeAt,
      outcome: "scheduled" as const,
    };
  });
  const schedule: CampaignFollowUpSchedule = {
    schemaVersion: DIRECT_OPERATIONAL_CAMPAIGN_SCHEMA_VERSION,
    campaignRef: structuredClone(input.campaign.ref),
    destinations,
    createdAt: input.createdAt,
  };
  const created = await writeLoopFileOnce(path, renderJson(schedule));
  if (!created) {
    const existing = await readJson<CampaignFollowUpSchedule>(path);
    if (
      stableHash(existing.campaignRef) !== stableHash(schedule.campaignRef) ||
      stableHash(existing.destinations) !== stableHash(schedule.destinations)
    ) {
      throw new DirectCampaignError(
        "campaign_authority_conflict",
        "campaign follow-up schedule conflicts with its immutable predecessor",
      );
    }
    return existing;
  }
  return schedule;
}

/** An observed reply/interaction has new facts and authority. It never mutates
 * the completed campaign or inherits a sibling destination grant. */
export function createCampaignInteractionUnit(input: {
  campaign: AcceptedCampaignAuthority;
  destinationId: string;
  interactionRef: string;
  unitId: string;
  provenance: CreatorScopeProvenance;
  admittedBudget: ExecutionUnitBudget;
  createdAt: string;
}): DirectExecutionUnitAuthority {
  const destination = input.campaign.value.destinations.find(
    (candidate) => candidate.destinationId === input.destinationId,
  );
  if (destination === undefined) {
    throw new DirectCampaignError("campaign_shape_invalid", "interaction destination is not in the campaign");
  }
  assertNonEmpty(input.interactionRef, "interaction reference", "campaign_shape_invalid");
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    kind: "direct_operation",
    unitId: input.unitId,
    app: input.campaign.value.app,
    objective: `Assess and draft a bounded response to ${input.interactionRef}.`,
    inScope: [`interaction ${input.interactionRef}`, `destination ${destination.destinationId}`],
    outOfScope: ["automatic response publication", "reuse of the original campaign effect grant"],
    acceptanceCriteria: ["response draft is evidence-bound to the observed interaction"],
    expectedArtifacts: [{ id: "interaction-response-draft", kind: "campaign-follow-up", required: true }],
    declaredConstraints: {
      predecessorCampaign: input.campaign.ref.sha256,
      predecessorDestination: destination.destinationId,
      interactionRef: input.interactionRef,
      externalEffects: false,
    },
    safetyFacts: [],
    steps: [
      {
        id: "draft-interaction-response",
        kind: "provider_turn",
        operation: "marketing/campaign-interaction-response",
        role: "marketing",
        objective: "Draft a response; do not publish it.",
        requiredCapabilities: [],
        dependsOn: [],
        inputRefs: [
          { ref: input.interactionRef, required: true },
          { ref: `campaign:${input.campaign.ref.sha256}`, required: true },
        ],
        expectedOutputs: [{ id: "interaction-response-draft", kind: "campaign-follow-up", required: true }],
        maxTurnBudgetUsd: input.admittedBudget.maxEquivalentCostUsd,
        selectionReason: "A new interaction is new direct work with its own EpisodePlan.",
      },
    ],
    provenance: structuredClone(input.provenance),
    dedupeKey: `campaign-interaction:${stableHash({
      campaign: input.campaign.ref.sha256,
      destination: destination.destinationId,
      interaction: input.interactionRef,
    })}`,
    admittedBudget: structuredClone(input.admittedBudget),
    createdAt: input.createdAt,
  };
}

export function campaignAuthorityPath(root: string, app: string, unitId: string): string {
  return join(campaignDir(root, app, unitId), "authority.json");
}

function campaignEffectLinksPath(root: string, app: string, unitId: string): string {
  return join(campaignDir(root, app, unitId), "effect-links.json");
}

export function campaignContentDraftPath(root: string, app: string, unitId: string): string {
  return join(campaignDir(root, app, unitId), "content-draft.json");
}

function campaignFollowUpPath(root: string, app: string, unitId: string): string {
  return join(campaignDir(root, app, unitId), "follow-up.json");
}

function campaignDir(root: string, app: string, unitId: string): string {
  return join(
    root,
    "planning",
    "apps",
    stableHash(app).slice(0, 32),
    "direct-campaigns",
    stableHash(unitId).slice(0, 32),
  );
}

function normalizedDestinations(
  destinations: readonly CampaignDestination[],
): DirectOperationalCampaignAuthority["destinations"] {
  return destinations.map((destination) => ({
    ...structuredClone(destination),
    payloadOutputId: `payload-${destination.destinationId}`,
    approvalStepId: `approve-${destination.destinationId}`,
    effectId: `effect-${destination.destinationId}`,
  }));
}

function campaignPublishAction(
  campaign: AcceptedCampaignAuthority,
  destination: DirectOperationalCampaignAuthority["destinations"][number],
  content: CampaignContentDraft["destinations"][number],
) {
  return {
    tool: "campaign.publish",
    input: {
      schemaVersion: DIRECT_OPERATIONAL_CAMPAIGN_SCHEMA_VERSION,
      campaignAuthoritySha256: campaign.ref.sha256,
      directAuthoritySha256: campaign.value.directAuthorityRef.sha256,
      destinationId: destination.destinationId,
      channel: destination.channel,
      target: destination.target,
      payload: content.payload,
      payloadSha256: content.payloadSha256,
      idempotencyKey: `${campaign.ref.sha256}:${destination.effectId}:${content.payloadSha256}`,
    },
    description: `Publish exact ${destination.channel} campaign payload to ${destination.target}`,
  };
}

function assertCampaignInput(input: DirectOperationalCampaignInput): void {
  for (const [label, value] of [
    ["unit id", input.unitId],
    ["app", input.app],
    ["objective", input.objective],
    ["campaign brief reference", input.campaignBriefRef],
    ["dedupe key", input.dedupeKey],
  ] as const)
    assertNonEmpty(value, label, "campaign_shape_invalid");
  assertDateTime(input.createdAt, "campaign createdAt", "campaign_shape_invalid");
  const counts = new Map<CampaignChannel, number>([
    ["reddit", 0],
    ["linkedin", 0],
    ["twitter", 0],
  ]);
  const ids = new Set<string>();
  const targets = new Set<string>();
  for (const destination of input.destinations) {
    if (!/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/.test(destination.destinationId)) {
      throw new DirectCampaignError("campaign_shape_invalid", "destination ids must be machine-readable step ids");
    }
    assertNonEmpty(destination.target, "destination target", "campaign_shape_invalid");
    assertNonEmpty(destination.purpose, "destination purpose", "campaign_shape_invalid");
    const exactTarget = `${destination.channel}\0${destination.target}`;
    if (ids.has(destination.destinationId) || targets.has(exactTarget)) {
      throw new DirectCampaignError("campaign_shape_invalid", "campaign destinations must be unique");
    }
    ids.add(destination.destinationId);
    targets.add(exactTarget);
    counts.set(destination.channel, (counts.get(destination.channel) ?? 0) + 1);
  }
  if (
    input.destinations.length !== 7 ||
    counts.get("reddit") !== 5 ||
    counts.get("linkedin") !== 1 ||
    counts.get("twitter") !== 1
  ) {
    throw new DirectCampaignError(
      "campaign_shape_invalid",
      "accepted campaign shape is exactly five Reddit, one LinkedIn, and one Twitter destination",
    );
  }
  if (
    input.admittedBudget.maxProviderTurns < 1 ||
    input.admittedBudget.maxHumanDecisions < 7 ||
    input.admittedBudget.maxEquivalentCostUsd <= 0
  ) {
    throw new DirectCampaignError(
      "campaign_shape_invalid",
      "campaign budget must admit one content turn and seven independent human decisions",
    );
  }
}

function assertCampaignDraft(campaign: AcceptedCampaignAuthority, draft: CampaignContentDraft): void {
  if (
    stableHash(draft.campaignRef) !== stableHash(campaign.ref) ||
    draft.schemaVersion !== DIRECT_OPERATIONAL_CAMPAIGN_SCHEMA_VERSION ||
    draft.destinations.length !== campaign.value.destinations.length ||
    typeof draft.contentTurnRef !== "string" ||
    draft.contentTurnRef.trim().length === 0 ||
    typeof draft.createdAt !== "string" ||
    Number.isNaN(Date.parse(draft.createdAt))
  ) {
    throw new DirectCampaignError("campaign_content_invalid", "content draft loses campaign authority");
  }
  const seen = new Set<string>();
  for (const destination of campaign.value.destinations) {
    const content = draft.destinations.find((candidate) => candidate.destinationId === destination.destinationId);
    if (
      content === undefined ||
      seen.has(content.destinationId) ||
      content.payload.trim().length === 0 ||
      content.payloadSha256 !== stableHash(content.payload)
    ) {
      throw new DirectCampaignError(
        "campaign_content_invalid",
        `destination ${destination.destinationId} lacks exact content evidence`,
      );
    }
    seen.add(content.destinationId);
  }
}

function effectAuthorityProjection(effect: CampaignEffectOutcome): Omit<CampaignEffectOutcome, "followUpOutcome"> {
  const { followUpOutcome: _followUpOutcome, ...authority } = effect;
  return authority;
}

async function readAcceptedCampaign(path: string): Promise<AcceptedCampaignAuthority> {
  const accepted = await readJson<AcceptedCampaignAuthority>(path);
  if (
    accepted.ref.kind !== "direct_operational_campaign" ||
    accepted.ref.version !== 1 ||
    accepted.ref.sha256 !== stableHash(accepted.value) ||
    accepted.value.kind !== "direct_operational_campaign" ||
    accepted.ref.id !== accepted.value.unitId
  ) {
    throw new DirectCampaignError("campaign_authority_corrupt", "campaign authority hash or identity is invalid");
  }
  return accepted;
}

async function readCampaignFollowUpSchedule(
  root: string,
  app: string,
  unitId: string,
): Promise<CampaignFollowUpSchedule | undefined> {
  const path = campaignFollowUpPath(root, app, unitId);
  return existsSync(path) ? readJson<CampaignFollowUpSchedule>(path) : undefined;
}

async function persistCampaignContentDraft(
  root: string,
  campaign: AcceptedCampaignAuthority,
  draft: CampaignContentDraft,
): Promise<void> {
  const path = campaignContentDraftPath(root, campaign.value.app, campaign.value.unitId);
  const created = await writeLoopFileOnce(path, renderJson(draft));
  if (!created) {
    const existing = await readJson<CampaignContentDraft>(path);
    assertCampaignDraft(campaign, existing);
    if (stableHash(existing) !== stableHash(draft)) {
      throw new DirectCampaignError(
        "campaign_authority_conflict",
        "campaign content draft conflicts with its immutable predecessor",
      );
    }
  }
}

function assertCampaignFollowUpSchedule(
  campaign: AcceptedCampaignAuthority,
  links: CampaignEffectLinks,
  schedule: CampaignFollowUpSchedule,
): void {
  if (
    schedule.schemaVersion !== DIRECT_OPERATIONAL_CAMPAIGN_SCHEMA_VERSION ||
    stableHash(schedule.campaignRef) !== stableHash(campaign.ref) ||
    schedule.destinations.length !== links.effects.length ||
    Number.isNaN(Date.parse(schedule.createdAt))
  ) {
    throw new DirectCampaignError(
      "campaign_authority_corrupt",
      "campaign follow-up schedule loses its accepted authority",
    );
  }
  for (const [index, link] of links.effects.entries()) {
    const entry = schedule.destinations[index];
    if (
      entry === undefined ||
      entry.destinationId !== link.destinationId ||
      entry.effectId !== link.effectId ||
      entry.approvalId !== link.approvalId ||
      entry.effectEvidenceRef.trim().length === 0 ||
      Number.isNaN(Date.parse(entry.observeAt)) ||
      entry.outcome !== "scheduled"
    ) {
      throw new DirectCampaignError(
        "campaign_authority_corrupt",
        "campaign follow-up schedule broadens or loses a destination outcome",
      );
    }
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function renderJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assertNonEmpty(value: string, label: string, code: CampaignFailureCode): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DirectCampaignError(code, `${label} must be non-empty`);
  }
}

function assertDateTime(value: string, label: string, code: CampaignFailureCode): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new DirectCampaignError(code, `${label} must be an ISO date-time`);
  }
}

function isHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}
