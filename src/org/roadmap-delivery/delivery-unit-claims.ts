import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  durableClaimSettlementId,
  DurableClaimStore,
  type DurableClaimDisposition,
  type DurableClaimRecord,
  type DurableClaimToken,
} from "../../runtime/durable-claim.js";
import type { AuthorityRef, RoadmapDeliveryProjection, RoadmapDeliveryProjector } from "./authority-core.js";
import { assertValidationWaiversCurrent } from "./validation-waivers.js";
import { loadDeliveryJoin } from "./delivery-join.js";
import { transitionExecutionUnitJournal } from "./execution-journal.js";
import { RoadmapDeliveryError } from "./failure.js";
import { assertRoutingEligible } from "./roadmap-invariants.js";
import type { RoutingSnapshotEntry } from "./roadmap-model.js";

const CLAIM_NAMESPACE = "planning/delivery-unit-claims";

export interface DeliveryUnitClaimPayload {
  app: string;
  unitId: string;
  issueNumbers: number[];
  membershipHash: string;
  roadmapRef: AuthorityRef;
  readinessRef: AuthorityRef;
  validationRef: AuthorityRef;
  validationContractHash: string;
  batchRef: AuthorityRef;
  episodeBindingRef: AuthorityRef;
}

export interface DeliveryUnitClaim {
  disposition: DurableClaimDisposition;
  record: DurableClaimRecord<DeliveryUnitClaimPayload>;
  token?: DurableClaimToken;
}

/** One content-bound claim owns every member. No per-ticket partial claim exists here. */
export async function claimDeliveryUnit(input: {
  root: string;
  app: string;
  episodeBindingRef: AuthorityRef;
  /** Builder-owned current-fact read. The claim boundary invokes this after
   * loading durable authority; a caller cannot pass a stale routing snapshot
   * through as if it were a fresh re-read. */
  readCurrentRouting: (issueNumbers: readonly number[]) => Promise<RoutingSnapshotEntry[]>;
  now: Date;
  project?: RoadmapDeliveryProjector;
}): Promise<DeliveryUnitClaim> {
  const joined = await loadDeliveryJoin(input.root, input.app, input.episodeBindingRef);
  assertValidationWaiversCurrent(joined.validation.value, input.now);
  let currentRouting: RoutingSnapshotEntry[];
  try {
    currentRouting = await input.readCurrentRouting([...joined.unit.issueNumbers]);
  } catch (error) {
    throw new RoadmapDeliveryError(
      "routing_ineligible",
      `Builder could not reread current delivery-unit labels: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assertRoutingEligible(joined.unit, currentRouting);
  const payload: DeliveryUnitClaimPayload = {
    app: input.app,
    unitId: joined.unit.unitId,
    issueNumbers: [...joined.unit.issueNumbers],
    membershipHash: joined.binding.value.membershipHash,
    roadmapRef: joined.roadmap.ref,
    readinessRef: joined.readiness.ref,
    validationRef: joined.validation.ref,
    validationContractHash: joined.validation.ref.sha256,
    batchRef: joined.batch.ref,
    episodeBindingRef: joined.binding.ref,
  };
  const identity = deliveryClaimIdentity(payload);
  const store = deliveryClaimStore(input.root);
  const claimed = await store.claim({ identity, payload, maxAttempts: 1, now: input.now });
  if (claimed.disposition === "claimed" || claimed.disposition === "recovered_claim") {
    await transitionExecutionUnitJournal({
      root: input.root,
      app: input.app,
      batchRef: joined.batch.ref,
      unitId: joined.unit.unitId,
      expectedStates: ["planning", "claimed"],
      nextState: "claimed",
      episodeBindingRef: joined.binding.ref,
      claimSettlementId: claimed.record.settlement_id,
      now: input.now,
    });
    await projectClaim(input.root, input.app, claimed.record.settlement_id, "delivery_unit_claimed", input.project);
  }
  return claimed;
}

export async function commitDeliveryUnitClaim(input: {
  root: string;
  app: string;
  claim: DeliveryUnitClaim;
  runId: string;
  now: Date;
  project?: RoadmapDeliveryProjector;
}): Promise<DurableClaimRecord<DeliveryUnitClaimPayload>> {
  if (input.claim.token === undefined) {
    throw new RoadmapDeliveryError("already_claimed", "claim attempt does not own the unit");
  }
  const joined = await loadDeliveryJoin(input.root, input.app, input.claim.record.payload.episodeBindingRef);
  assertValidationWaiversCurrent(joined.validation.value, input.now);
  const record = await deliveryClaimStore(input.root).commit({
    settlementId: input.claim.record.settlement_id,
    attempt: input.claim.record.attempt,
    token: input.claim.token,
    runId: input.runId,
    now: input.now,
  });
  await transitionExecutionUnitJournal({
    root: input.root,
    app: input.app,
    batchRef: joined.batch.ref,
    unitId: joined.unit.unitId,
    expectedStates: ["claimed"],
    nextState: "claimed",
    episodeBindingRef: joined.binding.ref,
    claimSettlementId: record.settlement_id,
    now: input.now,
  });
  await projectClaim(input.root, input.app, record.settlement_id, "delivery_unit_claim_committed", input.project);
  return record;
}

export function deliveryClaimRecordPath(root: string, identity: string): string {
  const settlementId = durableClaimSettlementId(identity);
  return join(resolve(root), CLAIM_NAMESPACE, "records", `${settlementId}.json`);
}

export async function readDeliveryUnitClaim(
  root: string,
  settlementId: string,
): Promise<DurableClaimRecord<DeliveryUnitClaimPayload> | undefined> {
  return deliveryClaimStore(root).read(settlementId);
}

export function deliveryClaimIdentity(payload: DeliveryUnitClaimPayload): string {
  return [
    "roadmap-delivery-unit/v1",
    payload.app,
    payload.unitId,
    payload.membershipHash,
    payload.roadmapRef.sha256,
    payload.readinessRef.sha256,
    payload.validationRef.sha256,
    payload.validationContractHash,
    payload.batchRef.sha256,
    payload.episodeBindingRef.sha256,
  ].join("\0");
}

export function deliveryClaimStore(root: string): DurableClaimStore<DeliveryUnitClaimPayload> {
  return new DurableClaimStore<DeliveryUnitClaimPayload>({ root, namespace: CLAIM_NAMESPACE });
}

export async function projectClaim(
  root: string,
  app: string,
  settlementId: string,
  kind: Extract<
    RoadmapDeliveryProjection["kind"],
    "delivery_unit_claimed" | "delivery_unit_claim_committed" | "delivery_unit_settled"
  >,
  project?: RoadmapDeliveryProjector,
): Promise<void> {
  if (project === undefined) return;
  const path = claimRecordPath(root, settlementId);
  if (!existsSync(path)) {
    throw new RoadmapDeliveryError("authority_corrupt", `claim projection preceded persistence: ${path}`);
  }
  await project({ kind, app, path, settlementId });
}

function claimRecordPath(root: string, settlementId: string): string {
  return join(resolve(root), CLAIM_NAMESPACE, "records", `${settlementId}.json`);
}
