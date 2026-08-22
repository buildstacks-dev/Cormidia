// Cormidia's publication routing rules on the kernel path — the host-owned
// half of design §6.1/§9.1 that the kernel deliberately does not model:
// which reviewed routings need the human gate, how each destination's bytes
// are rendered from the artifact (exactly as the forked publisher rendered
// them), the publish-time protected-bundle size rule (spec §3/§8.1), and the
// conditional experiment gate. The kernel owns the transitions; these rules
// decide what the host asks it to do and with which authority lane.

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import type { InterventionState } from "@cormidia/learning-loop";
import type { CandidateArtifact, CandidateDestination } from "./host/candidate.js";
import { bundleScopeDir, loadConceptDir, scopeApp, scopeShareKey, type LearningRoot } from "./host/concepts.js";
import type { LearningPolicy } from "./host/policy.js";
import type { ReviewerVerdict } from "./host/review.js";
import type { LoopTier } from "../memory.js";
import { destinationIdFor } from "./compose.js";
import { proposalDraftPath, type ProposalKind } from "./destination-proposal.js";
import { fingerprintMarker } from "./destination-ticket.js";
import type { CandidateRouting } from "./host-index.js";

/** Human approval gates exactly three things (design §6.1); on the publish
 *  surface that is activation into future context and anything T2/T3. */
export function requiresHumanGate(destination: CandidateDestination, tier: LoopTier): boolean {
  if (destination === "okf_concept") return true;
  return tier === "T2" || tier === "T3";
}

/** The reviewer's proposed destination/tier/scope govern from review on —
 *  that is what "reviewed" means (spec §15). */
export function routingOf(verdict: ReviewerVerdict): CandidateRouting {
  return { destination: verdict.proposed_destination, tier: verdict.proposed_tier, scope: verdict.proposed_scope };
}

export function proposalKindFor(destination: CandidateDestination): ProposalKind | undefined {
  if (destination === "skill_draft" || destination === "protocol_proposal" || destination === "eval_or_gate_proposal") {
    return destination;
  }
  return undefined;
}

/** The registry-stable destination id a routing publishes to. */
export function destinationIdForRouting(routing: CandidateRouting, ticketApp: string | undefined): string {
  const app = scopeApp(routing.scope);
  if (routing.destination === "okf_concept") return destinationIdFor("okf", app);
  if (routing.destination === "ticket") {
    const target = app ?? ticketApp;
    if (target === undefined) {
      throw new Error("learning-loop: an org-scoped ticket needs --app to name the repository it lands in");
    }
    return destinationIdFor("ticket", target);
  }
  return destinationIdFor("proposal", app);
}

/** Proposal draft bytes: the artifact's markdown, else a JSON dump of the
 *  artifact under its title (the forked publisher's rendering, preserved). */
export function renderProposalContent(
  artifact: CandidateArtifact,
  kind: ProposalKind,
): { readonly markdown: string; readonly path: string } {
  const draft = artifact.draft ?? {};
  const body =
    typeof draft["markdown"] === "string"
      ? draft["markdown"]
      : [
          `# ${artifact.title}`,
          "",
          `Draft proposal from learning-loop candidate ${artifact.candidate_id}.`,
          "The merge into a ratified surface stays human-gated; this file is the unmerged draft (design §6.1).",
          "",
          "```json",
          JSON.stringify(artifact, null, 2),
          "```",
        ].join("\n");
  return { markdown: body.endsWith("\n") ? body : `${body}\n`, path: proposalDraftPath(kind, artifact.candidate_id) };
}

/** Ticket title/body with the fingerprint marker (dedupe key, policy §13). */
export function renderTicketContent(artifact: CandidateArtifact): {
  readonly title: string;
  readonly body: string;
  readonly fingerprint: string;
} {
  const draft = artifact.draft ?? {};
  const title = typeof draft["issue_title"] === "string" ? draft["issue_title"] : artifact.title;
  const acceptanceRaw = draft["acceptance"];
  const acceptance = Array.isArray(acceptanceRaw) ? acceptanceRaw.map((line) => `- ${String(line)}`) : [];
  const body = [
    `Learning-loop candidate ${artifact.candidate_id} (routine publish, deduped + rate-capped).`,
    "",
    ...(artifact.error_class !== undefined ? [`Error class: \`${artifact.error_class}\``] : []),
    ...(artifact.cause_hypothesis !== undefined ? [`Cause hypothesis: ${artifact.cause_hypothesis}`] : []),
    ...(acceptance.length > 0 ? ["", "Acceptance:", ...acceptance] : []),
    ...(artifact.evidence_refs.length > 0 ? ["", "Evidence:", ...artifact.evidence_refs.map((ref) => `- ${ref}`)] : []),
    "",
    fingerprintMarker(artifact.content_hash),
  ].join("\n");
  return { title, body, fingerprint: artifact.content_hash };
}

/** Publish-time bundle-size validation (spec §3, §8.1): a protected-tier
 *  (T2/T3) concept must ALWAYS fit — together with every other protected
 *  concept already in its scope — inside the scope's share of the smallest
 *  configured byte budget, so the resolver can fail loud instead of ever
 *  evicting a protected concept. */
export async function protectedBundleOversize(
  policy: LearningPolicy,
  destRoot: LearningRoot,
  routing: CandidateRouting,
  bytes: string,
): Promise<string | null> {
  if (!policy.context_budget.eviction.protected_tiers.includes(routing.tier)) return null;
  const budget = policy.context_budget;
  const smallestTotal = Math.min(budget.default_bytes, ...Object.values(budget.roles));
  const shareBytes = Math.floor(smallestTotal * budget.shares[scopeShareKey(routing.scope)]);
  let used = Buffer.byteLength(bytes, "utf8");
  const dir = bundleScopeDir(destRoot, routing.scope);
  if (existsSync(dir)) {
    for (const concept of await loadConceptDir(dir, "bundle")) {
      const loop = concept.doc.frontmatter.loop;
      if (loop === undefined || loop.status !== "active") continue;
      if (!policy.context_budget.eviction.protected_tiers.includes(loop.tier)) continue;
      used += (await stat(concept.path)).size;
    }
  }
  if (used <= shareBytes) return null;
  return (
    `publishing this ${routing.tier} concept would put ${used} bytes of protected ` +
    `concepts in scope ${routing.scope}, over its ${shareBytes}-byte share of the ` +
    `smallest configured budget (${smallestTotal}) — an oversized protected concept is a ` +
    `publish-time error, not a resolve-time brick (spec §3)`
  );
}

export interface ActivationGateInput {
  readonly artifact: CandidateArtifact;
  readonly routing: CandidateRouting;
  /** Explicit human waiver text — waives the T2/T3 requirement ONLY. */
  readonly waiver?: string;
  /** The kernel validation of the experiment the artifact names, when any. */
  readonly validation?: InterventionState["validation"];
}

export interface ActivationEvaluability {
  /** Always `authorized` at this boundary — `validated` exists only on the
   *  intervention whose bound evaluation improved (design §9.1). */
  readonly claim: "authorized";
  readonly reported_as: "authorized (unproven)" | "experiment pending" | "waived (human)" | "experiment improved";
  readonly waiver: string | null;
}

/** The conditional experiment gate (design §9.1): an efficacy claim needs an
 *  improved kernel verdict and is never waivable; a T2/T3 activation needs a
 *  kernel verdict or an explicit non-empty human waiver. */
export function assertCandidateMayActivate(input: ActivationGateInput): ActivationEvaluability {
  const { artifact, routing } = input;
  const id = artifact.candidate_id;
  const required = artifact.claims_efficacy
    ? "claims_efficacy"
    : routing.tier === "T2" || routing.tier === "T3"
      ? "tier_t2_t3_activation"
      : null;
  if (artifact.experiment_ref !== null && input.validation === undefined) {
    throw new Error(
      `learning: ${id} references ${artifact.experiment_ref} but no kernel experiment verdict resolves for it — ` +
        `declare and run it through \`cormidia learn experiment\` first`,
    );
  }
  if (input.validation === "improved") {
    return { claim: "authorized", reported_as: "experiment improved", waiver: null };
  }
  if (required === null) {
    return {
      claim: "authorized",
      reported_as: input.validation === undefined ? "authorized (unproven)" : "experiment pending",
      waiver: null,
    };
  }
  if (required === "claims_efficacy") {
    throw new Error(
      `learning: ${id} claims efficacy but has no improved experiment verdict — ` +
        `run a kernel experiment or drop the claim; efficacy claims are never waivable (design §9.1)`,
    );
  }
  if (input.validation !== undefined) {
    return { claim: "authorized", reported_as: "experiment pending", waiver: null };
  }
  if (input.waiver !== undefined) {
    if (input.waiver.trim() === "") {
      throw new Error(`learning: ${id}: a T2/T3 waiver must say why — empty waivers do not record a decision`);
    }
    return { claim: "authorized", reported_as: "waived (human)", waiver: input.waiver };
  }
  throw new Error(
    `learning: ${id} proposes tier ${routing.tier} activation without an experiment — ` +
      `declare one, or record an explicit human waiver on the approval`,
  );
}
