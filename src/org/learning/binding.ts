// Content-bound approval for learning publishes (docs/learning-loop/
// learning-loop-spec.md §14; design §11.1).
//
// Human approval binds IMMUTABLE BYTES, not intentions: the approval item —
// a `learning_publish` kind in the existing approvals store, never a second
// inbox — carries the candidate hash, the reviewer verdict hash, the
// destination/tier/scope, the base manifest version, and the hash of the
// exact bytes the publish will write. If any of those change after approval,
// the binding no longer matches current state and the publish refuses.
//
// The binding rides in the approval action's `input`, so the store's own
// actionHash covers every bound field for grant matching — approving one
// binding can never authorize different bytes.

import type { ApprovalItem, ApprovalStore } from "../approvals.js";
import type { LoopTier } from "../memory.js";
import type { CandidateDestination } from "./candidate.js";
import { CANDIDATE_DESTINATIONS } from "./candidate.js";
import { requireEnum, requireRecord, requireSha256Ref, requireString, requireStringArray } from "./validate.js";

const LEARNING_PUBLISH_TOOL = "learning_publish";
const LEARNING_PUBLISH_RULE = "learning-publish";

export interface LearningPublishBinding {
  kind: "learning_publish";
  candidate_id: string;
  candidate_hash: string;
  verdict_hash: string;
  destination: CandidateDestination;
  tier: LoopTier;
  scope: string;
  /** Manifest version of the destination root at approval time
   *  ("unversioned" before the first cut). A publish against a moved
   *  manifest refuses — the human approved a change to a base that no
   *  longer exists. */
  base_manifest_version: string;
  /** Hash of the exact bytes the publish will write (activated concept
   *  file, issue body, proposal draft). */
  final_diff_hash: string;
  /** Explicit human waivers (T2/T3 without experiment, design §9.1) —
   *  recorded on the approval, quoted by the publisher. */
  waivers: string[];
}

function validateLearningPublishBinding(value: unknown): LearningPublishBinding {
  const spec = requireRecord(value, "learning_publish");
  if (spec["kind"] !== "learning_publish") {
    throw new Error(`learning: learning_publish.kind must be "learning_publish"`);
  }
  const candidateId = requireString(spec, "candidate_id", "learning_publish");
  const source = `learning_publish(${candidateId})`;
  return {
    kind: "learning_publish",
    candidate_id: candidateId,
    candidate_hash: requireSha256Ref(spec, "candidate_hash", source),
    verdict_hash: requireSha256Ref(spec, "verdict_hash", source),
    destination: requireEnum(spec, "destination", CANDIDATE_DESTINATIONS, source),
    tier: requireEnum(spec, "tier", ["T0", "T1", "T2", "T3"] as const, source),
    scope: requireString(spec, "scope", source),
    base_manifest_version: requireString(spec, "base_manifest_version", source),
    final_diff_hash: requireSha256Ref(spec, "final_diff_hash", source),
    waivers: requireStringArray(spec, "waivers", source),
  };
}

interface RaiseLearningPublishInput {
  binding: LearningPublishBinding;
  app: string;
  justification?: string;
  now?: Date;
}

/** One human decision authorizes one content-hashed publish transaction
 *  (design §6.1). Raising is idempotent per binding: an identical open item
 *  is returned instead of duplicated. */
export async function raiseLearningPublish(
  store: ApprovalStore,
  input: RaiseLearningPublishInput,
): Promise<{ item: ApprovalItem; alreadyPending: boolean }> {
  const existing = await findLearningPublishItem(store, input.binding.candidate_id, "pending");
  if (existing !== undefined && bindingOf(existing) !== undefined) {
    return { item: existing, alreadyPending: true };
  }
  const item = await store.raise({
    app: input.app,
    role: "learning",
    rule: LEARNING_PUBLISH_RULE,
    action: {
      tool: LEARNING_PUBLISH_TOOL,
      input: input.binding,
      description:
        `learning publish: ${input.binding.destination} ${input.binding.candidate_id} ` +
        `(tier ${input.binding.tier}, scope ${input.binding.scope})`,
    },
    ...(input.justification !== undefined ? { justification: input.justification } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
  return { item, alreadyPending: false };
}

/** The binding an approval item carries, when it is a learning publish. */
export function bindingOf(item: ApprovalItem): LearningPublishBinding | undefined {
  if (item.action.tool !== LEARNING_PUBLISH_TOOL) return undefined;
  try {
    return validateLearningPublishBinding(item.action.input);
  } catch {
    return undefined;
  }
}

/** Newest learning_publish item for a candidate in the given queue. */
export async function findLearningPublishItem(
  store: ApprovalStore,
  candidateId: string,
  queue: "pending" | "decided",
): Promise<ApprovalItem | undefined> {
  const items = queue === "pending" ? await store.listPending() : await store.listDecided();
  return items.filter((item) => bindingOf(item)?.candidate_id === candidateId).at(-1);
}

/** Field-by-field comparison of an approved binding against the binding
 *  rebuilt from CURRENT bytes. Any difference names itself — the refusal
 *  message must say what moved, or the human cannot fix it. */
export function bindingMismatches(approved: LearningPublishBinding, current: LearningPublishBinding): string[] {
  const fields: Array<keyof LearningPublishBinding> = [
    "candidate_id",
    "candidate_hash",
    "verdict_hash",
    "destination",
    "tier",
    "scope",
    "base_manifest_version",
    "final_diff_hash",
  ];
  const out: string[] = [];
  for (const field of fields) {
    const a = approved[field];
    const b = current[field];
    if (a !== b) out.push(`${field}: approved ${String(a)} but current is ${String(b)}`);
  }
  return out;
}
