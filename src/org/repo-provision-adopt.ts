// Does the target repository exist, and may this provisioning adopt it? (#382)
//
// Split from the transaction because it is the reconciliation story in full,
// and because it is the one place a mistake creates a SECOND repository rather
// than failing.
//
// A create whose response was lost DID make the repository, so a blind retry
// would fail on the taken name — and a blind "create under a different name"
// would be far worse. The marker written into the repository description is the
// evidence that a previous run of THIS transaction made it; it is the
// `approval-delivery.ts` idempotency-marker pattern moved to the one GitHub
// object with no body to hide a marker in.
//
// Adoption is granted on evidence, never on optimism:
//   * `adopted_marker` — our own marker is in the description. Strongest.
//   * `adopted_empty`  — private and no commits. Safe: nothing to destroy, and
//                        the operator plainly meant this target.
//   * refused          — anything else. A private repository already carrying
//                        commits this provisioning did not create is never
//                        pushed into, and a non-private one is never adopted or
//                        made private (that is a separate human decision the
//                        gate classifies `repo-provisioning`).

import type { CreateRepositoryInput, GhRepositoryView } from "../loop/github.js";
import type { RepositoryProvisionTransaction } from "./repo-provision-journal.js";
import { repositoryProvisionMarker } from "./repo-provision.js";

export class ProvisionAdoptionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProvisionAdoptionError";
  }
}

/** The GitHub surface adoption needs: one read, one create. */
export interface ProvisionRepositoryOps {
  readRepository(): Promise<GhRepositoryView | undefined>;
  createRepository(input: CreateRepositoryInput): Promise<GhRepositoryView>;
}

/** Resolve the repository into existence and report HOW, or throw a typed
 *  refusal. Performs at most ONE create, ever. */
export async function resolveRepository(
  transaction: RepositoryProvisionTransaction,
  gh: ProvisionRepositoryOps,
  errorPrefix: string,
): Promise<RepositoryProvisionTransaction["repository_origin"]> {
  const marker = repositoryProvisionMarker(transaction.idempotency_key);
  const before = await gh.readRepository();
  if (before !== undefined) return adoptionFor(transaction, before, marker, errorPrefix);

  let created: GhRepositoryView;
  try {
    created = await gh.createRepository({
      visibility: "private",
      description: `${transaction.scope} bootstrap ${marker}`,
    } satisfies CreateRepositoryInput);
  } catch (error) {
    // The response may have been lost AFTER the repository was made. Read it
    // back: our own marker proves this transaction created it, so the run
    // converges instead of failing or duplicating.
    const reconciled = await safeRead(gh);
    if (reconciled !== undefined) return adoptionFor(transaction, reconciled, marker, errorPrefix);
    throw new ProvisionAdoptionError(
      "provision_create_failed",
      `${errorPrefix}: creating ${transaction.slug} failed and the repository does not exist — ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assertPrivate(created, transaction, errorPrefix);
  return "created";
}

function adoptionFor(
  transaction: RepositoryProvisionTransaction,
  view: GhRepositoryView,
  marker: string,
  errorPrefix: string,
): RepositoryProvisionTransaction["repository_origin"] {
  assertPrivate(view, transaction, errorPrefix);
  if (view.description.includes(marker)) return "adopted_marker";
  if (view.isEmpty) return "adopted_empty";
  throw new ProvisionAdoptionError(
    "provision_target_not_empty",
    `${errorPrefix}: ${transaction.slug} already exists, is private, and already has commits that this ` +
      "provisioning did not create — it is never overwritten. Inspect it and either choose a different " +
      "target or finish onboarding against it with `cormidia bootstrap`.",
  );
}

function assertPrivate(view: GhRepositoryView, transaction: RepositoryProvisionTransaction, errorPrefix: string): void {
  if (view.visibility === "PRIVATE") return;
  throw new ProvisionAdoptionError(
    "provision_visibility_mismatch",
    `${errorPrefix}: ${transaction.slug} is ${view.visibility}, not private — provisioning never changes an ` +
      "existing repository's visibility, and never pushes a bootstrap commit into a repository the world can read",
  );
}

async function safeRead(gh: ProvisionRepositoryOps): Promise<GhRepositoryView | undefined> {
  try {
    return await gh.readRepository();
  } catch {
    return undefined;
  }
}
