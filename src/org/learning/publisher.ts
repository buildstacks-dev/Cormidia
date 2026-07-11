// The deterministic publisher (docs/learning-loop/learning-loop-design.md
// §11.1; spec §14) — orchestrator code with no model in the loop, and the
// only component that writes inside the gate-protected learning surfaces.
//
// One publish is one atomic, idempotent, JOURNALED transaction:
//   1. verify (fail-closed review, suppression window, experiment gate,
//      binding hashes for human-gated publishes, bundle-size for T2/T3);
//   2. journal the intent — including the exact rendered bytes, so a crash
//      after the candidate file moved can still finish from the journal;
//   3. write the destination artifacts (idempotent per step receipt);
//   4. bump the manifest (idempotent by approval ref);
//   5. write the InterventionRecord, emit `publish_committed` (deduped),
//      consume the grant, mark the journal done.
// Re-running after a crash completes or no-ops by journal id; it never
// double-publishes.
//
// Routing is proportional (design §6.1): activation into future context
// (okf_concept — bundle or quarantine) and anything T2/T3 require the human
// gate through the existing approvals store; tickets (deduped by candidate
// fingerprint, rate-capped per policy §13) and unmerged proposal drafts
// publish routinely; rejections go to the ledger.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { GhOps } from "../../loop/github.js";
import type { ApprovalStore } from "../approvals.js";
import { writeFileAtomic } from "../atomic.js";
import type { LoopTier } from "../memory.js";
import {
  assertCandidateCanProceed,
  type CandidateArtifact,
  type CandidateDestination,
} from "./candidate.js";
import {
  candidateArtifactHash,
  conceptDraftPath,
  findCandidateArtifact,
  sha256Ref,
} from "./candidate-store.js";
import {
  bundleScopeDir,
  cutManifestVersion,
  loadConceptDir,
  orgLearningRoot,
  proposalsDir,
  readManifest,
  renderActivatedConcept,
  rootKindForScope,
  scopeApp,
  scopeShareKey,
  type LearningRoot,
} from "./concepts.js";
import {
  bindingMismatches,
  bindingOf,
  findLearningPublishItem,
  raiseLearningPublish,
  type LearningPublishBinding,
} from "./binding.js";
import { appendLearningEventsDeduped, sanitizeIdSegment } from "./events.js";
import { readExperimentRecord } from "./experiment.js";
import {
  interventionIdForCandidate,
  listInterventionRecords,
  readInterventionRecord,
  writeInterventionRecord,
  type InterventionRecord,
  type PublishKind,
} from "./intervention.js";
import type { LearningPolicy } from "./policy.js";
import {
  appendRejection,
  checkSuppression,
  readRejections,
  type RejectionEntry,
} from "./rejections.js";
import { readReviewerVerdict, reviewDisposition, reviewerVerdictHash, type ReviewerVerdict } from "./review.js";

export const LEARNING_TICKET_LABEL = "op:learning";
const FINGERPRINT_MARKER = "operon:candidate-fingerprint";

export interface PublisherDeps {
  orgHome: string;
  stateHome: string;
  policy: LearningPolicy;
  approvals: ApprovalStore;
  /** App learning roots by registered app name — needed for `apps/<app>`
   *  scopes; an app without a local checkout cannot receive a publish. */
  appRoots?: Record<string, LearningRoot>;
  /** Required only for the `ticket` destination. */
  gh?: GhOps;
  /** `owner/repo` the tickets land in, for intervention refs. */
  repo?: string;
  clock?: () => Date;
}

export type PublishOutcome =
  | { status: "published"; intervention: InterventionRecord; refs: string[] }
  | { status: "rejected"; entry: RejectionEntry }
  | { status: "raised"; approvalId: string }
  | { status: "awaiting_approval"; approvalId: string }
  | { status: "denied"; approvalId: string; reason?: string }
  | { status: "refused"; reason: string };

export interface PublishOptions {
  /** Explicit human waiver for a T2/T3 activation without an experiment
   *  (design §9.1) — bound into the approval, quoted in the record. */
  waiver?: string;
}

/** Human approval gates exactly three things (design §6.1); in M4's surface
 *  that is: activation into future context, and anything T2/T3. */
export function requiresHumanGate(destination: CandidateDestination, tier: LoopTier): boolean {
  if (destination === "okf_concept") return true;
  return tier === "T2" || tier === "T3";
}

export async function publishCandidate(
  deps: PublisherDeps,
  candidateId: string,
  options: PublishOptions = {},
): Promise<PublishOutcome> {
  const now = deps.clock ?? ((): Date => new Date());
  const orgRoot = orgLearningRoot(deps.orgHome);
  const roots = [orgRoot, ...Object.values(deps.appRoots ?? {})];
  const found = await findCandidateArtifact(roots, candidateId);
  if (found === undefined) {
    return { status: "refused", reason: `no candidate ${candidateId} in any learning root` };
  }
  const { root: candidateRoot, candidate } = found;

  // Review fails closed: no verdict, no publish — the candidate stays queued
  // and the report's SLA section surfaces its age (spec §15).
  const verdict = await readReviewerVerdict(deps.orgHome, candidateId);
  if (verdict === undefined) {
    return {
      status: "refused",
      reason:
        `${candidateId} has no reviewer verdict — review fails closed; ` +
        `record one with: operon learn review ${candidateId}`,
    };
  }
  const disposition = reviewDisposition(verdict);
  if (disposition !== "proceed") {
    return {
      status: "refused",
      reason:
        `${candidateId} review disposition is "${disposition}"` +
        (verdict.rubric.injection_screen !== "clean"
          ? ` (injection screen ${verdict.rubric.injection_screen} — escalates regardless of verdict)`
          : "") +
        ` — ${verdict.rationale}`,
    };
  }

  // The reviewer's proposed destination/tier/scope govern from here — that
  // is what "reviewed" means (spec §15 shows the reviewer re-routing an OKF
  // candidate to a ticket).
  const destination = verdict.proposed_destination;
  const tier = verdict.proposed_tier;
  const scope = verdict.proposed_scope;

  if (destination === "reject") {
    // Idempotent per candidate: the ledger is append-only, so a re-run must
    // report the existing entry, never write a duplicate.
    const existing = (await readRejections(deps.orgHome)).find(
      (entry) => entry.candidate_id === candidateId,
    );
    if (existing !== undefined) return { status: "rejected", entry: existing };
    const entry = await appendRejection(deps.orgHome, {
      candidate,
      reason: verdict.rationale,
      by: verdict.reviewed_by,
      now: now(),
    });
    return { status: "rejected", entry };
  }

  const suppression = await checkSuppression(deps.orgHome, candidate, deps.policy, now());
  if (suppression.suppressed) {
    return {
      status: "refused",
      reason:
        `${candidateId} is inside the rejection suppression window (key ` +
        `"${suppression.entry!.suppress_key}", until ${suppression.until}) — ` +
        `needs ${suppression.evidenceNeeded} distinct evidence refs to override (policy §13)`,
    };
  }

  // The conditional experiment gate (design §9.1) with the reviewed tier.
  const experiment =
    candidate.experiment_ref !== null
      ? await readExperimentRecord(deps.orgHome, candidate.experiment_ref)
      : undefined;
  const gateInput = { ...candidate, proposed_tier: tier };

  const destRoot = resolveDestinationRoot(deps, orgRoot, scope);
  if (typeof destRoot === "string") return { status: "refused", reason: destRoot };

  // A completed transaction is terminal — checked before rendering, because
  // a finished okf publish has already MOVED the draft out of candidates/.
  const decided = await findLearningPublishItem(deps.approvals, candidateId, "decided");
  if (
    decided !== undefined &&
    decided.decision === "approved" &&
    (await journalIsDone(deps.stateHome, decided.id))
  ) {
    return {
      status: "refused",
      reason: `approval ${decided.id} was already published — nothing to redo`,
    };
  }

  // Resume an in-flight (crashed) transaction BEFORE re-rendering anything:
  // the artifact step may already have moved the concept draft out of
  // candidates/, so a fresh render cannot succeed — the journal carries the
  // exact rendered bytes instead (design §11.1 crash resume).
  const routineJournalId = `routine-${candidateId}`;
  const resumeId = (await journalInFlight(deps.stateHome, routineJournalId))
    ? routineJournalId
    : decided !== undefined &&
        decided.decision === "approved" &&
        (await journalInFlight(deps.stateHome, decided.id))
      ? decided.id
      : undefined;
  if (resumeId !== undefined) {
    return executePublish(deps, { journalId: resumeId, candidate, candidateRoot, destRoot, now });
  }

  // Render the final artifact now: the binding hashes the exact bytes the
  // publish will write, and the routine path writes those same bytes.
  const artifact = await renderArtifact(deps, destRoot, candidateRoot, candidate, verdict, destination);
  if ("refused" in artifact) return { status: "refused", reason: artifact.refused };

  if (!requiresHumanGate(destination, tier)) {
    // Routine lane (design §6.1). The experiment gate still applies.
    const evaluability = assertCandidateCanProceed(gateInput, {
      ...(experiment !== undefined ? { experiment } : {}),
    });
    return executePublish(deps, {
      journalId: routineJournalId,
      candidate,
      candidateRoot,
      destRoot,
      now,
      create: {
        destination,
        tier,
        scope,
        artifact,
        approvalRef: null,
        claim: evaluability.claim,
      },
    });
  }

  // Human-gated lane: build the content binding from current bytes.
  const binding: LearningPublishBinding = {
    kind: "learning_publish",
    candidate_id: candidateId,
    candidate_hash: await candidateArtifactHash(candidateRoot, candidateId),
    verdict_hash: await reviewerVerdictHash(deps.orgHome, candidateId),
    destination,
    tier,
    scope,
    base_manifest_version: (await readManifest(destRoot))?.bundle_version ?? "unversioned",
    final_diff_hash: sha256Ref(artifact.bytes),
    waivers: options.waiver !== undefined ? [options.waiver] : [],
  };

  const pending = await findLearningPublishItem(deps.approvals, candidateId, "pending");

  // A pending item that still matches current bytes is simply awaiting the
  // human; anything else (void approval, changed content after a denial,
  // stale pending) supersedes into a FRESH content-bound raise — a candidate
  // must never dead-end just because its bytes moved after a decision.
  const raiseFresh = async (note?: string): Promise<PublishOutcome> => {
    assertCandidateCanProceed(gateInput, {
      ...(experiment !== undefined ? { experiment } : {}),
      ...(options.waiver !== undefined ? { humanWaiver: options.waiver } : {}),
      ...(options.waiver === undefined && binding.waivers.length > 0
        ? { humanWaiver: binding.waivers.join("; ") }
        : {}),
    });
    const raised = await raiseLearningPublish(deps.approvals, {
      binding,
      app: scopeApp(scope) ?? "org",
      justification: note !== undefined ? `${note}; ${verdict.rationale}` : verdict.rationale,
      now: now(),
    });
    return { status: "raised", approvalId: raised.item.id };
  };

  if (pending !== undefined) {
    const pendingBinding = bindingOf(pending)!;
    if (bindingMismatches(pendingBinding, binding).length === 0) {
      return { status: "awaiting_approval", approvalId: pending.id };
    }
    return {
      status: "refused",
      reason:
        `pending approval ${pending.id} no longer matches current bytes — ` +
        `deny it (operon approvals) and re-run publish to raise a fresh one`,
    };
  }

  if (decided !== undefined && decided.decision === "approved") {
    const approved = bindingOf(decided)!;
    const mismatches = bindingMismatches(approved, binding);
    if (mismatches.length > 0) {
      // The approval is VOID (bound bytes changed after the decision) —
      // supersede it with a fresh binding rather than dead-ending.
      return raiseFresh(`supersedes VOID approval ${decided.id} (${mismatches.join("; ")})`);
    }
    // The waiver the human approved is the one that counts.
    const evaluability = assertCandidateCanProceed(gateInput, {
      ...(experiment !== undefined ? { experiment } : {}),
      ...(approved.waivers.length > 0 ? { humanWaiver: approved.waivers.join("; ") } : {}),
    });
    return executePublish(deps, {
      journalId: decided.id,
      candidate,
      candidateRoot,
      destRoot,
      now,
      create: {
        destination,
        tier,
        scope,
        artifact,
        approvalRef: decided.id,
        claim: evaluability.claim,
        waivers: approved.waivers,
      },
    });
  }

  if (decided !== undefined && decided.decision === "denied") {
    const denied = bindingOf(decided);
    if (denied === undefined || bindingMismatches(denied, binding).length === 0) {
      // Same bytes the human already said no to — the denial stands.
      return {
        status: "denied",
        approvalId: decided.id,
        ...(decided.reason !== undefined ? { reason: decided.reason } : {}),
      };
    }
    // The content changed since the denial (re-review, amended draft) — a
    // fresh decision on the new bytes is legitimate.
    return raiseFresh(`supersedes denied approval ${decided.id} (content changed since denial)`);
  }

  // Fail early on an unsatisfiable experiment gate BEFORE raising: a human
  // tap on an approval the publisher would refuse anyway is wasted attention.
  return raiseFresh();
}

// ---------------------------------------------------------------------------
// destination artifacts
// ---------------------------------------------------------------------------

interface RenderedArtifact {
  kind: PublishKind;
  /** Exact bytes the publish writes (concept file, issue body, draft). */
  bytes: string;
  /** okf_concept: concept id + name; proposals: target path. */
  conceptId?: string;
  conceptName?: string;
  proposalPath?: string;
  issueTitle?: string;
}

/** The scope alone picks the destination root — a candidate emitted into the
 *  "wrong" root still publishes to the scope's root; the candidate file
 *  location carries no authority. */
function resolveDestinationRoot(
  deps: PublisherDeps,
  orgRoot: LearningRoot,
  scope: string,
): LearningRoot | string {
  if (rootKindForScope(scope) === "org") return orgRoot;
  const app = scopeApp(scope)!;
  const root = deps.appRoots?.[app];
  if (root === undefined) {
    return (
      `scope "${scope}" needs the ${app} app learning root but no local checkout was ` +
      `resolved — pass --app or onboard the app first`
    );
  }
  return root;
}

async function renderArtifact(
  deps: PublisherDeps,
  destRoot: LearningRoot,
  candidateRoot: LearningRoot,
  candidate: CandidateArtifact,
  verdict: ReviewerVerdict,
  destination: CandidateDestination,
): Promise<RenderedArtifact | { refused: string }> {
  switch (destination) {
    case "okf_concept": {
      // The draft may sit beside the candidate JSON in ANY root (an app-repo
      // candidate re-scoped by review to an org scope still has its draft in
      // the app root); the destination root and org root are checked too.
      const source = [
        conceptDraftPath(destRoot, candidate.candidate_id),
        conceptDraftPath(candidateRoot, candidate.candidate_id),
        conceptDraftPath(orgLearningRoot(deps.orgHome), candidate.candidate_id),
      ].find((path) => existsSync(path));
      if (source === undefined) {
        return {
          refused:
            `${candidate.candidate_id} routes to okf_concept but has no concept draft ` +
            `(${relative(deps.orgHome, conceptDraftPath(candidateRoot, candidate.candidate_id))}) — ` +
            `the .md beside the candidate JSON is what activates`,
        };
      }
      const rendered = await renderActivatedConcept(source);
      if (rendered.scope !== verdict.proposed_scope) {
        return {
          refused:
            `${candidate.candidate_id} concept draft declares loop.scope "${rendered.scope}" but the ` +
            `review approved scope "${verdict.proposed_scope}" — align the draft and re-review`,
        };
      }
      const oversize = await protectedBundleOversize(deps, destRoot, verdict, rendered.bytes);
      if (oversize !== null) return { refused: oversize };
      return {
        kind: "bundle_version",
        bytes: rendered.bytes,
        conceptId: rendered.conceptId,
        conceptName: rendered.name,
      };
    }
    case "ticket": {
      const draft = candidate.draft ?? {};
      const title = typeof draft["issue_title"] === "string" ? draft["issue_title"] : candidate.title;
      const acceptance = Array.isArray(draft["acceptance"])
        ? (draft["acceptance"] as unknown[]).map((line) => `- ${String(line)}`)
        : [];
      const body = [
        `Learning-loop candidate ${candidate.candidate_id} (routine publish, deduped + rate-capped).`,
        "",
        ...(candidate.error_class !== undefined ? [`Error class: \`${candidate.error_class}\``] : []),
        ...(candidate.cause_hypothesis !== undefined
          ? [`Cause hypothesis: ${candidate.cause_hypothesis}`]
          : []),
        ...(acceptance.length > 0 ? ["", "Acceptance:", ...acceptance] : []),
        ...(candidate.evidence_refs.length > 0
          ? ["", "Evidence:", ...candidate.evidence_refs.map((ref) => `- ${ref}`)]
          : []),
        "",
        `<!-- ${FINGERPRINT_MARKER} ${candidate.content_hash} -->`,
      ].join("\n");
      return { kind: "issue", bytes: body, issueTitle: title };
    }
    case "skill_draft":
    case "protocol_proposal":
    case "eval_or_gate_proposal": {
      const dirKind =
        destination === "skill_draft" ? "skills" : destination === "protocol_proposal" ? "protocol" : "gates";
      const draft = candidate.draft ?? {};
      const body =
        typeof draft["markdown"] === "string"
          ? draft["markdown"]
          : [
              `# ${candidate.title}`,
              "",
              `Draft proposal from learning-loop candidate ${candidate.candidate_id}.`,
              `The merge into a ratified surface stays human-gated; this file is the unmerged draft (design §6.1).`,
              "",
              "```json",
              JSON.stringify(candidate, null, 2),
              "```",
            ].join("\n");
      return {
        kind: "commit",
        bytes: body.endsWith("\n") ? body : body + "\n",
        proposalPath: join(proposalsDir(destRoot, dirKind), `${candidate.candidate_id}.md`),
      };
    }
    case "reject":
      return { refused: "reject routes to the ledger before rendering — unreachable" };
  }
}

/** Publish-time bundle-size validation (spec §3, §8.1): a protected-tier
 *  (T2/T3) concept must ALWAYS fit — together with every other protected
 *  concept already in its scope — inside the scope's share of the smallest
 *  configured byte budget. Enforced here, paired with the resolver's
 *  protected-first selection, so resolve() can fail loud instead of ever
 *  evicting a protected concept. */
async function protectedBundleOversize(
  deps: PublisherDeps,
  destRoot: LearningRoot,
  verdict: ReviewerVerdict,
  bytes: string,
): Promise<string | null> {
  if (!deps.policy.context_budget.eviction.protected_tiers.includes(verdict.proposed_tier)) {
    return null;
  }
  const budget = deps.policy.context_budget;
  const smallestTotal = Math.min(budget.default_bytes, ...Object.values(budget.roles));
  const shareBytes = Math.floor(smallestTotal * budget.shares[scopeShareKey(verdict.proposed_scope)]);

  let used = Buffer.byteLength(bytes, "utf8");
  const dir = bundleScopeDir(destRoot, verdict.proposed_scope);
  if (existsSync(dir)) {
    for (const concept of await loadConceptDir(dir, "bundle")) {
      const loop = concept.doc.frontmatter.loop!;
      if (loop.status !== "active") continue;
      if (!deps.policy.context_budget.eviction.protected_tiers.includes(loop.tier)) continue;
      used += (await stat(concept.path)).size; // file bytes; no second content read
    }
  }
  if (used <= shareBytes) return null;
  return (
    `publishing this ${verdict.proposed_tier} concept would put ${used} bytes of protected ` +
    `concepts in scope ${verdict.proposed_scope}, over its ${shareBytes}-byte share of the ` +
    `smallest configured budget (${smallestTotal}) — an oversized protected concept is a ` +
    `publish-time error, not a resolve-time brick (spec §3)`
  );
}

// ---------------------------------------------------------------------------
// the journaled transaction
// ---------------------------------------------------------------------------

interface PublishJournal {
  schema_version: 1;
  journal_id: string;
  candidate_id: string;
  /** Hash of the candidate JSON as reviewed — becomes the intervention's
   *  reviewed_content_hash. */
  candidate_hash: string;
  destination: CandidateDestination;
  tier: LoopTier;
  scope: string;
  approval_ref: string | null;
  claim: "authorized" | "validated";
  waivers: string[];
  artifact: RenderedArtifact;
  /** Step receipts — presence means the step committed. */
  artifact_ref?: string;
  manifest_version?: string;
  intervention_id?: string;
  done_at?: string;
}

function journalPath(stateHome: string, journalId: string): string {
  return join(stateHome, "learning", "publish-journal", `${sanitizeIdSegment(journalId)}.json`);
}

/** In-flight (not-done) okf publish journals targeting a root kind — the
 *  canary start gate reads this: starting a trial while an activation is
 *  mid-journal would let the resume land ungoverned content mid-window. */
export async function listInFlightOkfJournals(
  stateHome: string,
  rootKind: "org" | "app",
): Promise<string[]> {
  const dir = join(stateHome, "learning", "publish-journal");
  if (!existsSync(dir)) return [];
  const ids: string[] = [];
  for (const name of (await readdir(dir)).filter((entry) => entry.endsWith(".json")).sort()) {
    try {
      const journal = JSON.parse(await readFile(join(dir, name), "utf8")) as PublishJournal;
      if (
        journal.done_at === undefined &&
        journal.destination === "okf_concept" &&
        rootKindForScope(journal.scope) === rootKind
      ) {
        ids.push(journal.journal_id);
      }
    } catch {
      // A torn journal is the publisher's own crash-resume concern.
    }
  }
  return ids;
}

async function readJournal(stateHome: string, journalId: string): Promise<PublishJournal | undefined> {
  const path = journalPath(stateHome, journalId);
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8")) as PublishJournal;
}

async function journalIsDone(stateHome: string, journalId: string): Promise<boolean> {
  return (await readJournal(stateHome, journalId))?.done_at !== undefined;
}

/** A journal that exists but never committed — a crashed transaction. */
async function journalInFlight(stateHome: string, journalId: string): Promise<boolean> {
  const journal = await readJournal(stateHome, journalId);
  return journal !== undefined && journal.done_at === undefined;
}

interface ExecuteInput {
  journalId: string;
  candidate: CandidateArtifact;
  candidateRoot: LearningRoot;
  destRoot: LearningRoot;
  now: () => Date;
  /** Present on first execution; absent when resuming a crashed journal —
   *  the journal is then the sole source for the transaction's content. */
  create?: {
    destination: CandidateDestination;
    tier: LoopTier;
    scope: string;
    artifact: RenderedArtifact;
    approvalRef: string | null;
    claim: "authorized" | "validated";
    waivers?: string[];
  };
}

async function executePublish(deps: PublisherDeps, input: ExecuteInput): Promise<PublishOutcome> {
  let journal = await readJournal(deps.stateHome, input.journalId);
  if (journal !== undefined && journal.done_at !== undefined) {
    // Crash between done-mark and the caller seeing it, or a plain re-run:
    // the transaction already committed — report it, change nothing.
    const intervention = await readExistingIntervention(deps, journal);
    return { status: "published", intervention, refs: refsOf(journal) };
  }
  if (journal === undefined) {
    if (input.create === undefined) {
      throw new Error(`learning: no publish journal ${input.journalId} to resume`);
    }
    journal = {
      schema_version: 1,
      journal_id: input.journalId,
      candidate_id: input.candidate.candidate_id,
      candidate_hash: await candidateArtifactHash(
        input.candidateRoot,
        input.candidate.candidate_id,
      ),
      destination: input.create.destination,
      tier: input.create.tier,
      scope: input.create.scope,
      approval_ref: input.create.approvalRef,
      claim: input.create.claim,
      waivers: input.create.waivers ?? [],
      artifact: input.create.artifact,
    };
    await writeJournal(deps.stateHome, journal);
  }

  const refs: string[] = [];

  // Mid-trial guard, BEFORE any mutation (adversarial-verify finding): the
  // artifact step writes the activated concept straight into bundle/<scope>,
  // where the resolver loads any active file — a later cut refusal would
  // leave ungoverned content live in BOTH trial arms. Fresh publishes and
  // resumed journals alike wait for the trial to close; the journal (when
  // one exists) stays in-flight and resumes cleanly afterwards.
  if (journal.destination === "okf_concept" && journal.manifest_version === undefined) {
    const trialManifest = await readManifest(input.destRoot);
    if (trialManifest !== null && trialManifest.canary !== null) {
      return {
        status: "refused",
        reason:
          `the ${input.destRoot.kind} root has an active canary (${trialManifest.canary}) — ` +
          `activation mid-trial would contaminate the population under measurement; ` +
          `\`operon learn canary promote|stop --root ${input.destRoot.kind}\`, then re-run publish`,
      };
    }
  }

  // Step: destination artifact (idempotent via the artifact_ref receipt).
  if (journal.artifact_ref === undefined) {
    journal.artifact_ref = await writeDestinationArtifact(deps, input, journal);
    await writeJournal(deps.stateHome, journal);
  }
  refs.push(journal.artifact_ref);

  // Step: manifest cut — activation into a bundle only.
  if (journal.destination === "okf_concept" && journal.manifest_version === undefined) {
    const cut = await cutManifestVersion(input.destRoot, {
      ...(journal.approval_ref !== null ? { approvalRef: journal.approval_ref } : {}),
      concepts: [journal.artifact.conceptId!],
      note: `publish ${journal.candidate_id}`,
      now: input.now(),
    });
    journal.manifest_version = cut.version;
    await writeJournal(deps.stateHome, journal);
  }

  // Step: intervention lineage (deterministic id → same record on replay).
  if (journal.intervention_id === undefined) {
    const intervention = await writeLineage(deps, input, journal);
    journal.intervention_id = intervention.intervention_id;
    await writeJournal(deps.stateHome, journal);
  }

  // Step: publish_committed event — deterministic id, deduped on replay.
  await appendLearningEventsDeduped(deps.stateHome, [
    {
      event_id: `evt_publish_${sanitizeIdSegment(journal.journal_id)}`,
      episode_id: input.candidate.episode_ids[0] ?? `ep_learning_publish_${journal.candidate_id}`,
      ts: input.now().toISOString(),
      app: scopeApp(journal.scope) ?? "org",
      type: "publish_committed",
      emitter: "publisher",
      source_channel: "internal",
      trust: "trusted",
      payload: {
        candidate_id: journal.candidate_id,
        destination: journal.destination,
        tier: journal.tier,
        scope: journal.scope,
        approval_ref: journal.approval_ref,
        intervention_id: journal.intervention_id,
        refs,
        ...(journal.manifest_version !== undefined
          ? { bundle_version: journal.manifest_version }
          : {}),
      },
    },
  ]);

  // Step: consume the single-use grant, then mark done. A crash between the
  // two leaves a done-less journal whose steps all no-op on resume, and the
  // consumed grant blocks any parallel re-approval replay.
  if (journal.approval_ref !== null) {
    const decided = await deps.approvals.show(journal.approval_ref);
    if (decided.item.grantId !== undefined && (decided.grant?.uses ?? 0) > 0) {
      deps.approvals.consumeGrantSync(decided.item.grantId, input.now());
    }
  }
  journal.done_at = input.now().toISOString();
  await writeJournal(deps.stateHome, journal);

  const intervention = await readExistingIntervention(deps, journal);
  return { status: "published", intervention, refs };
}

async function writeJournal(stateHome: string, journal: PublishJournal): Promise<void> {
  const path = journalPath(stateHome, journal.journal_id);
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, JSON.stringify(journal, null, 2) + "\n");
}

async function writeDestinationArtifact(
  deps: PublisherDeps,
  input: ExecuteInput,
  journal: PublishJournal,
): Promise<string> {
  const artifact = journal.artifact;
  switch (journal.destination) {
    case "okf_concept": {
      const dir = bundleScopeDir(input.destRoot, journal.scope);
      await mkdir(dir, { recursive: true });
      const dest = join(dir, `${artifact.conceptName!}.md`);
      if (!existsSync(dest) || (await readFile(dest, "utf8")) !== artifact.bytes) {
        await writeFileAtomic(dest, artifact.bytes);
      }
      // Move semantics (spec §14 step 3): the candidate draft leaves
      // candidates/ — from every root renderArtifact would look in — so the
      // same lesson cannot be re-reviewed or re-published from a stale copy.
      await rm(conceptDraftPath(input.destRoot, journal.candidate_id), { force: true });
      await rm(conceptDraftPath(input.candidateRoot, journal.candidate_id), { force: true });
      await rm(conceptDraftPath(orgLearningRoot(deps.orgHome), journal.candidate_id), {
        force: true,
      });
      return dest;
    }
    case "ticket": {
      if (deps.gh === undefined) {
        throw new Error("learning: the ticket destination needs GhOps — run with a configured repo");
      }
      // Dedupe by candidate fingerprint (policy §13): an open learning issue
      // carrying this content hash IS this publish. This also makes the
      // create step crash-safe — a re-run finds the issue instead of filing
      // a duplicate. The marker comes from the JOURNALED bytes, so a resume
      // matches the issue this transaction rendered even if the candidate
      // file was re-distilled between crash and resume.
      const open = await deps.gh.listIssues({ state: "open", labels: [LEARNING_TICKET_LABEL] });
      const journaledHash = new RegExp(`${FINGERPRINT_MARKER} (sha256:[0-9a-f]{64})`).exec(
        journal.artifact.bytes,
      )?.[1];
      const marker = `${FINGERPRINT_MARKER} ${journaledHash ?? input.candidate.content_hash}`;
      const existing = open.find((issue) => issue.body.includes(marker));
      if (existing !== undefined) return `#${existing.number}`;

      // Rate caps (policy §13) — checked at creation time, not at routing,
      // so a resumed journal that already created its issue is never blocked.
      const caps = deps.policy.destinations.ticket;
      if (open.length >= caps.max_open_per_app) {
        throw new Error(
          `learning: ${open.length} open ${LEARNING_TICKET_LABEL} issues >= cap ` +
            `${caps.max_open_per_app} (policy §13) — close or triage before publishing more`,
        );
      }
      const weekAgo = input.now().getTime() - 7 * 24 * 60 * 60 * 1000;
      const recent = (await listInterventionRecords(deps.orgHome)).filter(
        (record) =>
          record.destination === "ticket" &&
          record.publish !== null &&
          new Date(record.publish.published_at).getTime() >= weekAgo,
      );
      if (recent.length >= caps.max_new_per_week) {
        throw new Error(
          `learning: ${recent.length} learning tickets published this week >= cap ` +
            `${caps.max_new_per_week} (policy §13)`,
        );
      }
      await deps.gh.ensureLabel({
        name: LEARNING_TICKET_LABEL,
        color: "BFD4F2",
        description: "opened by the learning loop (routine, deduped, rate-capped)",
      });
      const issue = await deps.gh.createIssue({
        title: artifact.issueTitle ?? input.candidate.title,
        body: artifact.bytes,
        labels: [LEARNING_TICKET_LABEL],
      });
      return `#${issue.number}`;
    }
    case "skill_draft":
    case "protocol_proposal":
    case "eval_or_gate_proposal": {
      const dest = artifact.proposalPath!;
      await mkdir(dirname(dest), { recursive: true });
      if (!existsSync(dest) || (await readFile(dest, "utf8")) !== artifact.bytes) {
        await writeFileAtomic(dest, artifact.bytes);
      }
      return dest;
    }
    case "reject":
      throw new Error("learning: reject never reaches the artifact step");
  }
}

async function writeLineage(
  deps: PublisherDeps,
  input: ExecuteInput,
  journal: PublishJournal,
): Promise<InterventionRecord> {
  const interventionId = interventionIdForCandidate(journal.candidate_id);
  const publishedAt = input.now().toISOString();
  const activates = journal.destination === "okf_concept";
  const record: InterventionRecord = {
    schema_version: 1,
    intervention_id: interventionId,
    candidate_ref: journal.candidate_id,
    destination: journal.destination as InterventionRecord["destination"],
    reviewed_content_hash: journal.candidate_hash,
    approval_ref: journal.approval_ref,
    publish: {
      kind: journal.artifact.kind,
      ref: activates
        ? `${input.destRoot.kind}@${journal.manifest_version ?? "unversioned"}`
        : journal.artifact_ref ?? "unknown",
      commit: null,
      published_at: publishedAt,
    },
    activation: activates ? { activated_at: publishedAt, claim: journal.claim } : null,
    affected_episodes: activates
      ? { query: `bundle_versions.${input.destRoot.kind} >= ${journal.manifest_version}` }
      : null,
    experiment_ref: input.candidate.experiment_ref,
    outcome_ref: null,
    rollback: null,
    status: activates ? "active" : "published",
  };
  return writeInterventionRecord(deps.orgHome, record);
}

async function readExistingIntervention(
  deps: PublisherDeps,
  journal: PublishJournal,
): Promise<InterventionRecord> {
  return readInterventionRecord(
    deps.orgHome,
    journal.intervention_id ?? interventionIdForCandidate(journal.candidate_id),
  );
}

function refsOf(journal: PublishJournal): string[] {
  return journal.artifact_ref !== undefined ? [journal.artifact_ref] : [];
}
