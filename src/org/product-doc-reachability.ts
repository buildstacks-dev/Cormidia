// What automated planning actually knows about the product-document decision
// (#389), and how it says so.
//
// Planning reads Cormidia's MANAGED checkout, synchronized from the app remote.
// That isolation is deliberate and stays: a live plan must never depend on
// whatever happens to be sitting in a human working tree. But "the managed base
// carries no decision" was being reported as "no decision exists", which sent
// an operator who had just recorded one back to run the same command again.
//
// The missing information is not in the human checkout — it is in Cormidia's
// own publication journal, which is state-home data planning may read. Joining
// the managed-base manifest with that journal distinguishes five states, and
// each refusal names the transition that is actually missing.

import { resolve } from "node:path";
import { listPublicationTransactions } from "./git-publication-journal.js";
import {
  PRODUCT_DOC_PUBLICATION_SURFACE,
  productDocPublicationScope,
  productDocPublishCommand,
} from "./product-doc-publication.js";
import type { ProductDocDisposition, ProductDocSnapshot } from "./product-doc-record.js";

export type ProductDocDecisionState =
  /** No decision exists anywhere Cormidia can see. */
  | { kind: "absent" }
  /** A decision was written into a checkout and never published, so it is not
   *  reachable from the managed base. */
  | { kind: "recorded_locally"; workdir: string }
  /** Published and awaiting human merge. */
  | { kind: "pending_merge"; branch: string; pullRequestUrl: string | null; defaultBranch: string }
  /** Merged, but the bytes it was bound to have changed since. */
  | { kind: "stale_content"; changed: Array<{ path: string; recorded: string | null; current: string | null }> }
  /** Current and reachable: planning may proceed. */
  | { kind: "current"; disposition: ProductDocDisposition };

export interface ResolveProductDocDecisionInput {
  app: string;
  /** The decision recorded at the managed base, or null when there is none. */
  decision: { value: ProductDocDisposition; documents: Array<{ path: string; current_sha256: string | null }> } | null;
  /** The documents as they are at the managed base right now. */
  documents: readonly ProductDocSnapshot[];
  /** Cormidia's own state home. Omitted means the journal cannot be consulted,
   *  which narrows what may be claimed — never widens it. */
  stateHome?: string;
}

/** Join the managed-base manifest with Cormidia's publication journal.
 *
 *  Ordering matters: a decision that IS reachable wins outright, because a
 *  stale journal entry from an earlier attempt must never downgrade a merged
 *  decision. Only when the base carries nothing does the journal get asked what
 *  is in flight. */
export async function resolveProductDocDecision(
  input: ResolveProductDocDecisionInput,
): Promise<ProductDocDecisionState> {
  if (input.decision !== null) {
    const changed = input.documents
      .map((document) => ({
        path: document.path,
        recorded: input.decision?.documents.find((entry) => entry.path === document.path)?.current_sha256 ?? null,
        current: document.current_sha256,
      }))
      .filter((entry) => entry.recorded !== entry.current);
    if (changed.length > 0) return { kind: "stale_content", changed };
    return { kind: "current", disposition: input.decision.value };
  }
  if (input.stateHome === undefined) return { kind: "absent" };
  const transactions = await listPublicationTransactions(
    resolve(input.stateHome),
    productDocPublicationScope(input.app),
    PRODUCT_DOC_PUBLICATION_SURFACE,
  );
  const published = transactions.find((transaction) => transaction.pushed_commit !== null);
  if (published !== undefined) {
    return {
      kind: "pending_merge",
      branch: published.branch,
      pullRequestUrl: published.pull_request?.url ?? null,
      defaultBranch: published.base.default_branch,
    };
  }
  const recorded = transactions[0];
  if (recorded !== undefined) return { kind: "recorded_locally", workdir: recorded.root };
  return { kind: "absent" };
}

/** The refusal for a state planning cannot proceed from.
 *
 *  Every branch names a transition the operator has NOT already performed.
 *  `recorded_locally` and `pending_merge` in particular must never route back
 *  to the disposition command — that loop is the defect. */
export function productDocDecisionRefusal(state: ProductDocDecisionState, app: string): string | undefined {
  if (state.kind === "current") return undefined;
  if (state.kind === "absent") {
    return (
      "plan: scaffold product documents have no keep/reconcile/remove disposition reachable from the app remote; " +
      `record one with \`cormidia app product-docs ${app} --workdir <app-checkout> ` +
      "--disposition keep|reconcile|remove --execute --confirm " +
      `${app}:<disposition>\``
    );
  }
  if (state.kind === "recorded_locally") {
    return (
      "plan: a product-document disposition is recorded in a local checkout but was never published, so the " +
      "managed base Cormidia plans from does not carry it. The decision is not missing — its publication is. " +
      `Finish it with \`${productDocPublishCommand(app, state.workdir)}\`. Do not record the disposition again.`
    );
  }
  if (state.kind === "pending_merge") {
    const where = state.pullRequestUrl ?? `branch ${state.branch}`;
    return (
      `plan: the product-document disposition is published at ${where} and is awaiting human merge into ` +
      `${state.defaultBranch}. Merge it, then re-run planning. Do not record the disposition again.`
    );
  }
  const changed = state.changed
    .map((entry) => `${entry.path} (${shortHash(entry.recorded)} -> ${shortHash(entry.current)})`)
    .join(", ");
  return (
    "plan: the merged product-document disposition is stale — the bytes it was bound to have changed since it was " +
    `recorded: ${changed}. Preview and record the disposition again for the current bytes.`
  );
}

function shortHash(value: string | null): string {
  return value === null ? "absent" : value.slice(0, 12);
}
