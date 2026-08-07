import { join } from "node:path";
import { writeLoopFileAtomic } from "../../loop/durable.js";
import { withFileLock } from "../../runtime/file-lock.js";
import { planningAppDir } from "../planning-artifact-path.js";
import type { AcceptedAuthority, AuthorityRef, RoadmapDeliveryProjector } from "./authority-core.js";
import { currentValidationCatalogPointerPath } from "./authority-paths.js";
import { persistAuthority, projectAccepted, requireAuthority, sameAuthorityRef } from "./authority-store.js";
import type { ValidationCatalog } from "./validation-catalog.js";
import { assertValidationCatalogRevision } from "./validation-catalog-revision.js";
import { assertValidationCatalogShape } from "./validation-catalog-shape.js";
import { readCurrentAuthorityPointer } from "./validation-current-pointer.js";
import { RoadmapDeliveryError } from "./failure.js";
import { ROADMAP_MUTATION_LOCK } from "./roadmap-plan.js";

const VALIDATION_CATALOG_SCHEMA_VERSION = 1 as const;
const VALIDATION_MUTATION_LOCK = ROADMAP_MUTATION_LOCK;

interface CurrentValidationCatalogPointer {
  schemaVersion: typeof VALIDATION_CATALOG_SCHEMA_VERSION;
  app: string;
  ref: AuthorityRef;
  updatedAt: string;
}

export async function acceptValidationCatalog(input: {
  root: string;
  catalog: ValidationCatalog;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<ValidationCatalog>> {
  assertValidationCatalogShape(input.catalog);
  const accepted = await withFileLock(
    validationMutationLockPath(input.root, input.catalog.app),
    VALIDATION_MUTATION_LOCK,
    async () => {
      const current = await readCurrentValidationCatalog(input.root, input.catalog.app);
      assertValidationCatalogRevision(input.catalog, current);
      const persisted = await persistAuthority(
        input.root,
        input.catalog.app,
        "validation_catalog",
        input.catalog.catalogId,
        input.catalog.version,
        input.catalog,
      );
      const pointer: CurrentValidationCatalogPointer = {
        schemaVersion: VALIDATION_CATALOG_SCHEMA_VERSION,
        app: input.catalog.app,
        ref: persisted.ref,
        updatedAt: input.catalog.acceptedAt,
      };
      await writeLoopFileAtomic(
        currentValidationCatalogPointerPath(input.root, input.catalog.app),
        `${JSON.stringify(pointer, null, 2)}\n`,
      );
      return persisted;
    },
  );
  await projectAccepted(input.root, input.catalog.app, accepted, input.project);
  return accepted;
}

export async function readCurrentValidationCatalog(
  root: string,
  app: string,
): Promise<AcceptedAuthority<ValidationCatalog> | undefined> {
  const pointer = await readCurrentAuthorityPointer(
    currentValidationCatalogPointerPath(root, app),
    "validation_catalog",
    app,
  );
  if (pointer === undefined) return undefined;
  const catalog = await requireAuthority<ValidationCatalog>(
    root,
    app,
    pointer,
    "validation_catalog",
    "validation_catalog_missing",
  );
  assertValidationCatalogShape(catalog.value);
  return catalog;
}

export async function assertCurrentValidationCatalogRef(
  root: string,
  app: string,
  expected: AuthorityRef,
): Promise<void> {
  const current = await readCurrentValidationCatalog(root, app);
  if (current === undefined || !sameAuthorityRef(current.ref, expected)) {
    throw new RoadmapDeliveryError(
      "validation_catalog_stale",
      "validation lineage does not bind the current accepted harness catalog",
    );
  }
}

function validationMutationLockPath(root: string, app: string): string {
  return join(planningAppDir(root, app), "validation-mutation.lock");
}
