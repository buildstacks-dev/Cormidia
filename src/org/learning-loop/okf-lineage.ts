// OKF concept ↔ kernel intervention lineage, derived — never stored twice —
// from the facts both sides already hold: a kernel intervention cites its
// journaled receipts (`receipt-<idempotencyKey>`), and the OKF destination
// keyed its manifest cut by that same idempotency key (`approval_ref`, B-32
// §4). So "which intervention activated concept X on this root" is a join
// of the kernel record against the root's manifest history, and a concept no
// kernel intervention cut is a forked-engine (legacy) activation.

import { readManifest, type LearningRoot } from "../learning/concepts.js";
import { operatorEvidence } from "./authority-evidence.js";
import { listKernelInterventions, type KernelInterventionView } from "./interventions.js";
import type { CormidiaLearningLoop } from "./loop.js";
import { messageOf } from "./publish-render.js";
import { destinationIdForRouting } from "./publish-route.js";

const RECEIPT_PREFIX = "receipt-";

/** The idempotency keys an intervention's receipts were journaled under. */
export function idempotencyKeysOf(view: KernelInterventionView): string[] {
  return view.receiptIds.filter((id) => id.startsWith(RECEIPT_PREFIX)).map((id) => id.slice(RECEIPT_PREFIX.length));
}

export interface OkfActivation {
  readonly intervention: KernelInterventionView;
  readonly root: LearningRoot;
  readonly version: string;
  readonly conceptIds: readonly string[];
}

/** Every kernel OKF activation on the given roots, joined to its manifest cut. */
export async function listOkfActivations(
  learning: CormidiaLearningLoop,
  roots: readonly LearningRoot[],
): Promise<OkfActivation[]> {
  const manifests = await Promise.all(roots.map(async (root) => ({ root, manifest: await readManifest(root) })));
  const activations: OkfActivation[] = [];
  for (const intervention of await listKernelInterventions(learning)) {
    if (intervention.routing?.destination !== "okf_concept") continue;
    const keys = new Set(idempotencyKeysOf(intervention));
    for (const { root, manifest } of manifests) {
      for (const entry of manifest?.history ?? []) {
        if (entry.approval_ref !== null && keys.has(entry.approval_ref)) {
          activations.push({ intervention, root, version: entry.version, conceptIds: entry.concepts });
        }
      }
    }
  }
  return activations;
}

/** The kernel activation that cut a concept into a root, if the kernel did. */
export async function findOkfActivationForConcept(
  learning: CormidiaLearningLoop,
  roots: readonly LearningRoot[],
  conceptId: string,
): Promise<OkfActivation | undefined> {
  const activations = await listOkfActivations(learning, roots);
  return activations.find((activation) => activation.conceptIds.includes(conceptId));
}

/** The kernel activation behind an intervention id, on whichever root holds its cut. */
export async function findOkfActivationForIntervention(
  learning: CormidiaLearningLoop,
  roots: readonly LearningRoot[],
  interventionId: string,
): Promise<OkfActivation | undefined> {
  const activations = await listOkfActivations(learning, roots);
  return activations.find((activation) => activation.intervention.id === interventionId);
}

/** Reverse a kernel activation through a kernel disable plan authorized by
 *  the operator lane: the OKF destination deprecates the concept and cuts
 *  the version exactly as the direct operation did, and the kernel journals
 *  the `disable` transition. */
export async function disableOkfActivation(
  learning: CormidiaLearningLoop,
  activation: OkfActivation,
  identity: string,
): Promise<{ readonly version: string } | { readonly refused: string }> {
  const routing = activation.intervention.routing;
  if (routing === undefined) return { refused: `${activation.intervention.id} carries no host routing` };
  try {
    const prepared = await learning.loop.preparePublication({
      candidateId: activation.intervention.candidateId,
      destinationId: destinationIdForRouting(routing, undefined),
      action: "disable",
      interventionId: activation.intervention.id,
    });
    const outcome = await learning.loop.publish({
      planId: prepared.plan.id,
      authorizationEvidence: operatorEvidence(identity),
    });
    if ("diagnostics" in outcome) {
      return { refused: outcome.diagnostics.map((diagnostic) => diagnostic.message).join("; ") };
    }
    return { version: outcome.receipts[0]?.finalVersion ?? "unversioned" };
  } catch (error) {
    return { refused: messageOf(error) };
  }
}
