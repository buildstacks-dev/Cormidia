// The operator publish flow on the kernel path (Cormidia #467 phase B) — what
// `cormidia learn publish` and the scheduled reviewer drive. Cormidia keeps
// every host rule the forked publisher enforced (fail-closed review, author ≠
// reviewer, injection escalation, the rejection ledger and its suppression
// window, the §9.1 experiment gate, the protected-bundle size rule, the
// proportional-approval routing of design §6.1); the kernel owns the
// transitions: the verified candidate, the decisive review, the content-bound
// plan and binding, the journaled exactly-once publish, and the intervention
// state. The outcome vocabulary the CLI renders is unchanged.

import { existsSync } from "node:fs";
import type { PreparedPublication, PublicationOutcome } from "@cormidia/learning-loop";
import type { ApprovalItem, ApprovalStore } from "../approvals.js";
import { conceptDraftPath, findCandidateArtifact } from "./host/candidate-store.js";
import { appLearningRoot, orgLearningRoot, scopeApp, type LearningRoot } from "./host/concepts.js";
import type { LearningPolicy } from "./host/policy.js";
import { appendRejection, checkSuppression, readRejections, type RejectionEntry } from "./host/rejections.js";
import { publishPlanIdOf, raiseLearningLoopPublish } from "./authority.js";
import { approvalEvidence, routineEvidence } from "./authority-evidence.js";
import { experimentValidationFor } from "./experiments-audit.js";
import { readHostCandidateIndex, updateHostCandidateEntry } from "./host-index.js";
import { interventionIdForPlan, viewOfRecord, type KernelInterventionView } from "./interventions.js";
import { findLegacyPublishItem, readLegacyPublishJournal } from "./legacy.js";
import type { CormidiaLearningLoop } from "./loop.js";
import { commitPublished } from "./publish-commit.js";
import { prepareKernelCandidate } from "./publish-prepare.js";
import { messageOf } from "./publish-render.js";
import { assertCandidateMayActivate, requiresHumanGate } from "./publish-route.js";

export interface PublishDeps {
  readonly learning: CormidiaLearningLoop;
  readonly policy: LearningPolicy;
  readonly approvals: ApprovalStore;
  /** App learning roots with a resolvable local checkout, by app name. */
  readonly appRoots?: Record<string, LearningRoot>;
  /** The app whose repository receives an org-scoped ticket. */
  readonly ticketApp?: string;
  /** The routine-lane actor (`role:<name>` or `human:<identity>`). */
  readonly actor?: string;
  readonly clock?: () => Date;
}

export type PublishOutcome =
  | { readonly status: "published"; readonly intervention: KernelInterventionView; readonly refs: string[] }
  | { readonly status: "rejected"; readonly entry: RejectionEntry }
  | { readonly status: "raised"; readonly approvalId: string }
  | { readonly status: "awaiting_approval"; readonly approvalId: string }
  | { readonly status: "denied"; readonly approvalId: string; readonly reason?: string }
  | { readonly status: "refused"; readonly reason: string };

export interface PublishOptions {
  /** Explicit human waiver for a T2/T3 activation without an experiment. */
  readonly waiver?: string;
}

function refused(reason: string): PublishOutcome {
  return { status: "refused", reason };
}

type CompletedOutcome = Extract<PublicationOutcome, { readonly status: "published" | "resumed" | "no_op" }>;

function isCompleted(outcome: PublicationOutcome): outcome is CompletedOutcome {
  return outcome.status === "published" || outcome.status === "resumed" || outcome.status === "no_op";
}

async function planApproval(
  approvals: ApprovalStore,
  planId: string,
): Promise<{ readonly pending?: ApprovalItem; readonly decided?: ApprovalItem }> {
  const pending = (await approvals.listPending()).filter((item) => publishPlanIdOf(item) === planId).at(-1);
  const decided = (await approvals.listDecidedReadOnly()).filter((item) => publishPlanIdOf(item) === planId).at(-1);
  return { ...(pending !== undefined ? { pending } : {}), ...(decided !== undefined ? { decided } : {}) };
}

/** A plan this artifact already drove to the kernel journal: completed (a
 *  re-run is a no-op with reference — the OKF draft has moved, so nothing
 *  could be re-rendered) or failed mid-publish (resumable: the kernel never
 *  re-consults authority for a consumed plan and re-applies no journaled
 *  effect). Checked BEFORE rendering, like the forked publisher's journal. */
async function journaledOutcome(
  deps: PublishDeps,
  candidateId: string,
  now: () => Date,
): Promise<PublishOutcome | undefined> {
  const learning = deps.learning;
  const index = await readHostCandidateIndex(learning.stateDir, candidateId);
  const entry = [...(index?.entries ?? [])].reverse().find((candidate) => candidate.plan_id !== undefined);
  if (entry?.plan_id === undefined) return undefined;
  const interventionId = interventionIdForPlan(entry.plan_id);
  const record = await learning.loop.getIntervention({ interventionId });
  if (record === undefined) return undefined;
  if (record.state.publication === "published" || record.state.publication === "rolled_back") {
    return { status: "published", intervention: viewOfRecord(record, entry.routing), refs: [...(entry.refs ?? [])] };
  }
  if (record.state.publication !== "failed") return undefined;
  let outcome: PublicationOutcome;
  try {
    outcome = await learning.loop.publish({ planId: entry.plan_id });
  } catch (error) {
    return refused(messageOf(error));
  }
  if (!isCompleted(outcome)) {
    return refused(
      `kernel ${outcome.status}: ${outcome.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`,
    );
  }
  const found = await findCandidateArtifact(
    [orgLearningRoot(learning.orgHome), ...Object.values(deps.appRoots ?? {})],
    candidateId,
  );
  if (found === undefined) return refused(`no candidate ${candidateId} in any learning root`);
  const app = scopeApp(entry.routing.scope);
  const registeredApp = app === undefined ? undefined : learning.apps.find((candidate) => candidate.name === app);
  const destRoot =
    registeredApp === undefined ? orgLearningRoot(learning.orgHome) : appLearningRoot(registeredApp.workdir);
  const draftPath = [destRoot, found.root, orgLearningRoot(learning.orgHome)]
    .map((root) => conceptDraftPath(root, candidateId))
    .find((path) => existsSync(path));
  const refs = await commitPublished({
    learning,
    artifact: found.candidate,
    routing: entry.routing,
    kernelCandidateId: entry.id,
    planId: entry.plan_id,
    interventionId,
    receipts: outcome.receipts,
    destRoot,
    candidateRoot: found.root,
    draftPath: entry.routing.destination === "okf_concept" ? draftPath : undefined,
    approvalRef: record.authorizationIds[0] ?? "routine",
    reportedAs: "resumed",
    now: now(),
  });
  return { status: "published", intervention: viewOfRecord(outcome.intervention, entry.routing), refs };
}

export async function publishCandidate(
  deps: PublishDeps,
  candidateId: string,
  options: PublishOptions = {},
): Promise<PublishOutcome> {
  const now = deps.clock ?? ((): Date => new Date());
  const learning = deps.learning;
  const orgHome = learning.orgHome;

  const journaled = await journaledOutcome(deps, candidateId, now);
  if (journaled !== undefined) return journaled;

  const preparedOutcome = await prepareKernelCandidate(deps, candidateId, { requireProceed: true });
  if (preparedOutcome.status === "refused") return refused(preparedOutcome.reason);
  if (preparedOutcome.status === "reject") {
    // Idempotent per candidate: the ledger is append-only, so a re-run must
    // report the existing entry, never write a duplicate.
    const existing = (await readRejections(orgHome)).find((entry) => entry.candidate_id === candidateId);
    if (existing !== undefined) return { status: "rejected", entry: existing };
    const entry = await appendRejection(orgHome, {
      candidate: preparedOutcome.artifact,
      reason: preparedOutcome.verdict.rationale,
      by: preparedOutcome.verdict.reviewed_by,
      now: now(),
    });
    return { status: "rejected", entry };
  }
  const { artifact, verdict, routing, candidateRoot, destRoot, rendered, kernelCandidateId } = preparedOutcome.prepared;

  const suppression = await checkSuppression(orgHome, artifact, deps.policy, now());
  if (suppression.suppressed) {
    return refused(
      `${candidateId} is inside the rejection suppression window (key ` +
        `"${suppression.entry?.suppress_key ?? "unknown"}", until ${suppression.until ?? "unknown"}) — ` +
        `needs ${suppression.evidenceNeeded ?? 0} distinct evidence refs to override (policy §13)`,
    );
  }

  // A publish the forked engine completed is terminal (compatibility policy
  // §3a): its `learning_publish` approval and journal are preserved, never
  // redone or migrated.
  const legacy = await findLegacyPublishItem(deps.approvals, candidateId, "decided");
  if (legacy?.decision === "approved") {
    const journal = await readLegacyPublishJournal(learning.stateHome, legacy.id);
    if (journal?.done_at !== undefined) {
      return refused(`approval ${legacy.id} was already published by the forked engine — nothing to redo`);
    }
  }

  // The conditional experiment gate (design §9.1) on the reviewed tier.
  let reportedAs: string;
  try {
    const validation =
      artifact.experiment_ref === null ? undefined : await experimentValidationFor(learning, artifact.experiment_ref);
    reportedAs = assertCandidateMayActivate({
      artifact,
      routing,
      ...(options.waiver !== undefined ? { waiver: options.waiver } : {}),
      ...(validation !== undefined ? { validation: validation.validation } : {}),
    }).reported_as;
  } catch (error) {
    return refused(messageOf(error));
  }

  let prepared: PreparedPublication;
  try {
    prepared = await learning.loop.preparePublication({
      candidateId: kernelCandidateId,
      destinationId: rendered.spec.destinationId,
    });
  } catch (error) {
    return refused(messageOf(error));
  }
  await updateHostCandidateEntry(learning.stateDir, candidateId, kernelCandidateId, { plan_id: prepared.plan.id });
  if (prepared.governance.publication !== "eligible") {
    return refused(
      `${candidateId} is not publishable: ${prepared.governance.reasons.map((reason) => reason.message).join("; ")}`,
    );
  }

  const app = scopeApp(routing.scope);
  let approvalRef = "routine";
  let evidence: unknown = routineEvidence(deps.actor ?? "human:operator");
  if (requiresHumanGate(routing.destination, routing.tier)) {
    const { pending, decided } = await planApproval(deps.approvals, prepared.plan.id);
    if (pending !== undefined) return { status: "awaiting_approval", approvalId: pending.id };
    if (decided?.decision === "denied") {
      return {
        status: "denied",
        approvalId: decided.id,
        ...(decided.reason !== undefined ? { reason: decided.reason } : {}),
      };
    }
    if (decided?.decision !== "approved") {
      const superseded = await findLegacyPublishItem(deps.approvals, candidateId, "pending");
      if (superseded !== undefined) {
        process.stderr.write(
          `learning: pending legacy approval ${superseded.id} (forked engine) is superseded by the kernel binding — deny it with \`cormidia approvals\`\n`,
        );
      }
      const item = await raiseLearningLoopPublish(deps.approvals, {
        app: app ?? "org",
        plan: prepared.plan,
        binding: prepared.authorizationBinding,
        justification:
          options.waiver !== undefined ? `${verdict.rationale}; waiver: ${options.waiver}` : verdict.rationale,
        now: now(),
      });
      return { status: "raised", approvalId: item.id };
    }
    approvalRef = decided.id;
    evidence = approvalEvidence(decided.id);
  }

  let outcome: PublicationOutcome;
  try {
    outcome = await learning.loop.publish({ planId: prepared.plan.id, authorizationEvidence: evidence });
  } catch (error) {
    return refused(messageOf(error));
  }
  if (!isCompleted(outcome)) {
    const reason = outcome.diagnostics.map((diagnostic) => diagnostic.message).join("; ");
    if (outcome.status === "pending") return { status: "awaiting_approval", approvalId: approvalRef };
    if (outcome.status === "denied") return { status: "denied", approvalId: approvalRef, reason };
    return refused(`kernel ${outcome.status}: ${reason}`);
  }

  const interventionId = interventionIdForPlan(prepared.plan.id);
  const refs = await commitPublished({
    learning,
    artifact,
    routing,
    kernelCandidateId,
    planId: prepared.plan.id,
    interventionId,
    receipts: outcome.receipts,
    destRoot,
    candidateRoot,
    draftPath: outcome.status === "published" ? rendered.draftPath : undefined,
    approvalRef,
    reportedAs,
    now: now(),
  });
  return { status: "published", intervention: viewOfRecord(outcome.intervention, routing), refs };
}
