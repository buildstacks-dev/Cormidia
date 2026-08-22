// Rendering the exact bytes a reviewed candidate publishes, per destination
// (the forked publisher's `renderArtifact`, preserved): the OKF concept draft
// the destination activates, the proposal draft markdown and path, or the
// ticket title/body with its fingerprint marker. Pure reads; the result is
// the kernel candidate's intervention content, which the content-bound plan
// then freezes.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LearningLoopError } from "@cormidia/learning-loop";
import type { PublicationReceipt } from "@cormidia/learning-loop";
import { conceptDraftPath } from "./host/candidate-store.js";
import type { CandidateArtifact } from "./host/candidate.js";
import { orgLearningRoot, renderActivatedConcept, type LearningRoot } from "./host/concepts.js";
import type { LearningPolicy } from "./host/policy.js";
import type { KernelCandidateSpec } from "./candidates.js";
import type { CandidateRouting } from "./host-index.js";
import {
  destinationIdForRouting,
  proposalKindFor,
  protectedBundleOversize,
  renderProposalContent,
  renderTicketContent,
} from "./publish-route.js";

export interface RenderedSpec {
  readonly spec: Omit<KernelCandidateSpec, "artifact" | "routing">;
  /** The draft file the OKF activation moves out of candidates/ on publish. */
  readonly draftPath?: string;
}

export type RenderRefusal = { readonly refused: string };

export interface RenderInput {
  readonly orgHome: string;
  readonly policy: LearningPolicy;
  readonly artifact: CandidateArtifact;
  readonly routing: CandidateRouting;
  readonly candidateRoot: LearningRoot;
  readonly destRoot: LearningRoot;
  readonly ticketApp?: string;
}

export async function renderCandidateSpec(input: RenderInput): Promise<RenderedSpec | RenderRefusal> {
  const { artifact, routing } = input;
  const destinationId = destinationIdForRouting(routing, input.ticketApp);
  if (routing.destination === "okf_concept") {
    const orgRoot = orgLearningRoot(input.orgHome);
    // The draft may sit beside the candidate JSON in ANY root (an app-repo
    // candidate re-scoped by review to an org scope still has its draft in
    // the app root); the destination root and org root are checked too.
    const source = [input.destRoot, input.candidateRoot, orgRoot]
      .map((root) => conceptDraftPath(root, artifact.candidate_id))
      .find((path) => existsSync(path));
    if (source === undefined) {
      return {
        refused: `${artifact.candidate_id} routes to okf_concept but has no concept draft — the .md beside the candidate JSON is what activates`,
      };
    }
    const rendered = await renderActivatedConcept(source);
    if (rendered.scope !== routing.scope) {
      return {
        refused:
          `${artifact.candidate_id} concept draft declares loop.scope "${rendered.scope}" but the ` +
          `review approved scope "${routing.scope}" — align the draft and re-review`,
      };
    }
    const oversize = await protectedBundleOversize(input.policy, input.destRoot, routing, rendered.bytes);
    if (oversize !== null) return { refused: oversize };
    const markdown = await readFile(source, "utf8");
    return {
      spec: {
        destinationId,
        kind: "okf_concept",
        content: { markdown },
        rollbackIntent: `disable the activated concept ${rendered.conceptId}`,
      },
      draftPath: source,
    };
  }
  if (routing.destination === "ticket") {
    const content = renderTicketContent(artifact);
    return { spec: { destinationId, kind: "ticket", content: { ...content }, rollbackIntent: "close the issue" } };
  }
  const kind = proposalKindFor(routing.destination);
  if (kind === undefined) return { refused: "reject routes to the ledger before rendering — unreachable" };
  const content = renderProposalContent(artifact, kind);
  return { spec: { destinationId, kind, content: { ...content }, rollbackIntent: "withdraw the draft" } };
}

/** Human-facing refs of what a publish wrote: absolute file paths, `#issue` numbers. */
export function refsOf(receipts: readonly PublicationReceipt[], root: LearningRoot): string[] {
  return receipts.map((receipt) =>
    receipt.target.startsWith("issues/") ? (receipt.finalVersion ?? receipt.target) : join(root.dir, receipt.target),
  );
}

/** One spelling for kernel and host errors in refusal reasons. */
export function messageOf(error: unknown): string {
  if (error instanceof LearningLoopError) {
    return `${error.message} [${error.diagnostics.map((diagnostic) => diagnostic.code).join(", ")}]`;
  }
  return error instanceof Error ? error.message : String(error);
}
