import { join } from "node:path";
import { writeLoopFileAtomic } from "../../loop/durable.js";
import { stableHash } from "../../loop/episode-plan.js";
import { withFileLock } from "../../runtime/file-lock.js";
import { planningAppDir } from "../planning-artifact-path.js";
import {
  assertId,
  type AcceptedAuthority,
  type AuthorityRef,
  type RoadmapDeliveryProjector,
} from "./authority-core.js";
import { currentValidationContractPointerPath } from "./authority-paths.js";
import { persistAuthority, projectAccepted, requireAuthority, sameAuthorityRef } from "./authority-store.js";
import type { ValidationCatalog } from "./validation-catalog.js";
import { readCurrentValidationCatalog } from "./validation-catalog-authority.js";
import { assertValidationCatalogShape } from "./validation-catalog-shape.js";
import { VALIDATION_CONTRACT_SCHEMA_VERSION, type ValidationContract } from "./validation-contract.js";
import {
  assertValidationContractPolicy,
  assertValidationContractRevision,
  canonicalizeValidationContract,
} from "./validation-contract-policy.js";
import { assertValidationContractBaseShape } from "./validation-contract-shape.js";
import { readCurrentAuthorityPointer } from "./validation-current-pointer.js";
import { RoadmapDeliveryError } from "./failure.js";
import {
  ensureValidationProposalLifecycle,
  readValidationContractLifecycle,
  transitionPersistedValidationLifecycle,
  transitionValidationLifecycle,
} from "./validation-lifecycle.js";
import { assertRoadmapPlan, requireUnit, unitMembershipHash } from "./roadmap-invariants.js";
import type { RoadmapPlan } from "./roadmap-model.js";
import { ROADMAP_MUTATION_LOCK, readCurrentRoadmapPlan } from "./roadmap-plan.js";
import { assertValidationWaiverAuthorities } from "./validation-waivers.js";

const VALIDATION_MUTATION_LOCK = ROADMAP_MUTATION_LOCK;

interface CurrentValidationContractPointer {
  schemaVersion: typeof VALIDATION_CONTRACT_SCHEMA_VERSION;
  app: string;
  unitId: string;
  ref: AuthorityRef;
  updatedAt: string;
}

export async function acceptValidationContract(input: {
  root: string;
  contract: ValidationContract;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<ValidationContract>> {
  assertValidationContractBaseShape(input.contract);
  const accepted = await withFileLock(
    validationMutationLockPath(input.root, input.contract.app),
    VALIDATION_MUTATION_LOCK,
    async () => {
      const roadmap = await requireAuthority<RoadmapPlan>(
        input.root,
        input.contract.app,
        input.contract.roadmapRef,
        "roadmap_plan",
        "roadmap_missing",
      );
      assertRoadmapPlan(roadmap.value);
      const currentRoadmap = await readCurrentRoadmapPlan(input.root, input.contract.app);
      if (currentRoadmap === undefined || !sameAuthorityRef(currentRoadmap.ref, roadmap.ref)) {
        throw new RoadmapDeliveryError(
          "frontier_stale",
          "validation contract does not bind the current accepted RoadmapPlan",
        );
      }
      const catalog = await requireAuthority<ValidationCatalog>(
        input.root,
        input.contract.app,
        input.contract.catalogRef,
        "validation_catalog",
        "validation_catalog_missing",
      );
      assertValidationCatalogShape(catalog.value);
      const currentCatalog = await readCurrentValidationCatalog(input.root, input.contract.app);
      if (currentCatalog === undefined || !sameAuthorityRef(currentCatalog.ref, catalog.ref)) {
        throw new RoadmapDeliveryError(
          "validation_catalog_stale",
          "validation contract does not bind the current accepted harness catalog",
        );
      }
      const unit = requireUnit(roadmap.value, input.contract.unitId);
      if (unitMembershipHash(unit.issueNumbers) !== input.contract.unitMembershipHash) {
        throw new RoadmapDeliveryError(
          "validation_contract_invalid",
          `contract ${input.contract.contractId} does not bind the accepted membership of ${unit.unitId}`,
        );
      }
      const canonical = canonicalizeValidationContract(input.contract, catalog.value);
      assertValidationContractPolicy(canonical, catalog.value);
      await assertValidationWaiverAuthorities(input.root, canonical);
      const expectedRef: AuthorityRef = {
        kind: "validation_contract",
        id: canonical.contractId,
        version: canonical.version,
        sha256: stableHash(canonical),
      };
      const current = await readCurrentValidationContract(input.root, input.contract.app, input.contract.unitId);
      assertValidationContractRevision(canonical, current);
      // Only semantically admissible canonical proposals enter the durable
      // lifecycle. A malformed attempt must not poison this id/version and
      // prevent a corrected retry.
      await ensureValidationProposalLifecycle(input.root, canonical);
      const lifecycle = await readValidationContractLifecycle(
        input.root,
        canonical.app,
        canonical.unitId,
        canonical.contractId,
        canonical.version,
      );
      if (lifecycle === undefined) {
        throw new RoadmapDeliveryError("authority_corrupt", "validation lifecycle proposal is missing");
      }
      if (lifecycle.state === "proposed") {
        await transitionValidationLifecycle(input.root, canonical, "validated", canonical.acceptedAt, null);
      } else if (lifecycle.state === "accepted") {
        if (lifecycle.acceptedRef === null || !sameAuthorityRef(lifecycle.acceptedRef, expectedRef)) {
          throw new RoadmapDeliveryError("authority_conflict", "accepted validation lifecycle differs from proposal");
        }
      } else if (lifecycle.state !== "validated") {
        throw new RoadmapDeliveryError(
          "validation_contract_stale",
          `cannot accept validation contract from ${lifecycle.state} lifecycle state`,
        );
      }
      const persisted = await persistAuthority(
        input.root,
        canonical.app,
        "validation_contract",
        canonical.contractId,
        canonical.version,
        canonical,
      );
      if (lifecycle.state !== "accepted") {
        await transitionValidationLifecycle(input.root, canonical, "accepted", canonical.acceptedAt, persisted.ref);
      }
      const pointer: CurrentValidationContractPointer = {
        schemaVersion: VALIDATION_CONTRACT_SCHEMA_VERSION,
        app: canonical.app,
        unitId: canonical.unitId,
        ref: persisted.ref,
        updatedAt: canonical.acceptedAt,
      };
      await writeLoopFileAtomic(
        currentValidationContractPointerPath(input.root, canonical.app, canonical.unitId),
        `${JSON.stringify(pointer, null, 2)}\n`,
      );
      if (canonical.predecessor !== null) {
        const predecessor = await requireAuthority<ValidationContract>(
          input.root,
          canonical.app,
          canonical.predecessor,
          "validation_contract",
          "validation_contract_stale",
        );
        await transitionPersistedValidationLifecycle(
          input.root,
          predecessor.value,
          "superseded",
          canonical.acceptedAt,
          persisted.ref,
        );
      }
      return persisted;
    },
  );
  await projectAccepted(input.root, input.contract.app, accepted, input.project);
  return accepted;
}

export async function readCurrentValidationContract(
  root: string,
  app: string,
  unitId: string,
): Promise<AcceptedAuthority<ValidationContract> | undefined> {
  assertId(unitId, "validation unit id");
  const pointer = await readCurrentAuthorityPointer(
    currentValidationContractPointerPath(root, app, unitId),
    "validation_contract",
    app,
    unitId,
  );
  if (pointer === undefined) return undefined;
  const contract = await requireAuthority<ValidationContract>(
    root,
    app,
    pointer,
    "validation_contract",
    "validation_contract_missing",
  );
  assertValidationContractBaseShape(contract.value);
  return contract;
}

function validationMutationLockPath(root: string, app: string): string {
  return join(planningAppDir(root, app), "validation-mutation.lock");
}
