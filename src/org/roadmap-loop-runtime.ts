import type { AdmittedLoopDeliveryUnit, DeliveryUnitClaimLease, DeliveryUnitRuntime } from "../loop/driver.js";
import { deliveryUnitEpisodeId } from "../loop/driver.js";
import { readExecutionSteps } from "../loop/efficiency.js";
import type { GhIssue, GhOps } from "../loop/github.js";
import {
  autonomousExecutionExclusionLabel,
  MANUAL_REVIEW_EXCLUSION_LABEL,
  STATE_LABELS,
} from "../loop/plan-tickets.js";
import type { LoopDeliveryUnit, LoopItem } from "../loop/types.js";
import { checkAcceptanceBoxes } from "../loop/loop.js";
import { issueContentHash } from "../loop/issue-snapshot.js";
import type { EpisodePlan, ProviderTurnStep } from "../loop/episode-plan.js";
import type { CreatorEpisodeScope } from "../loop/episode-plan.js";
import { TICKET_STANDARD_DELIVERY_WORKFLOW_TEMPLATE } from "../loop/ticket-episode-plan.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  admitExecutionBatch,
  bindDeliveryUnitEpisodePlan,
  claimDeliveryUnit,
  commitDeliveryUnitClaim,
  completeDeliveryUnitMerge,
  findActiveExecutionUnit,
  listActiveExecutionUnits,
  readCurrentDeliveryUnitReadiness,
  readCurrentRoadmapPlan,
  readCurrentValidationCatalog,
  readCurrentValidationContract,
  readBacklogSnapshotAuthority,
  readDeliveryUnitClaim,
  readExecutionUnitJournal,
  recordBuilderEvidence,
  recordReviewerVerdict,
  settleDeliveryUnitClaim,
  settleDeliveryUnitRefusal,
  transitionExecutionUnitJournal,
  unitMembershipHash,
  type AcceptedAuthority,
  type ActiveExecutionUnit,
  type AuthorityRef,
  type BuilderEvidenceManifest,
  type DeliveryEpisodeBinding,
  type DeliveryUnitClaim,
  type DeliveryUnitReadiness,
  type ExecutionBatch,
  type ReviewerVerdict,
  type RoadmapDeliveryUnit,
  type RoutingSnapshotEntry,
  type ValidationContract,
  type ValidationCatalog,
} from "./roadmap-delivery.js";
import type { AppEntry } from "./apps.js";
import { stableHash } from "../loop/episode-plan.js";
import { processIdentityStatus } from "../runtime/process-identity.js";

interface AdmissionState {
  batch: AcceptedAuthority<ExecutionBatch>;
  roadmapUnit: RoadmapDeliveryUnit;
  readiness: AcceptedAuthority<DeliveryUnitReadiness>;
  validation: AcceptedAuthority<ValidationContract>;
  issues: GhIssue[];
}

interface BindingState extends AdmissionState {
  binding: AcceptedAuthority<DeliveryEpisodeBinding>;
  request: Parameters<DeliveryUnitRuntime["bindAcceptedPlan"]>[0]["request"];
  accepted: Parameters<DeliveryUnitRuntime["bindAcceptedPlan"]>[0]["accepted"];
}

const HUMAN_ONLY_LABEL = "routing:human-only";

/** Production bridge from accepted roadmap/validation authority into the
 * provider-backed loop. All mutable state is durable; maps only avoid reparsing
 * content-bound tokens during one process invocation. */
export function createRoadmapLoopRuntime(input: { root: string; app: AppEntry; gh: GhOps }): DeliveryUnitRuntime {
  const admissions = new Map<string, AdmissionState>();
  const bindings = new Map<string, BindingState>();
  const claims = new Map<string, DeliveryUnitClaim>();
  const evidence = new Map<string, AcceptedAuthority<BuilderEvidenceManifest>>();
  const verdicts = new Map<string, AcceptedAuthority<ReviewerVerdict>>();

  return {
    reconcile: async ({ now }) => reconcileActiveProjections(input, now),
    admit: async ({ maxUnits, planOnly, now }) => {
      if (input.app.status !== "live") return { units: [] };
      const roadmap = await readCurrentRoadmapPlan(input.root, input.app.name);
      if (roadmap === undefined) return { units: [] };
      const backlog = await readBacklogSnapshotAuthority(input.root, input.app.name, roadmap.value.backlogSnapshotRef);
      const validationCatalog = await readCurrentValidationCatalog(input.root, input.app.name);
      const refusals: NonNullable<Awaited<ReturnType<DeliveryUnitRuntime["admit"]>>["refusals"]> = [];
      const selected: Array<{
        unit: RoadmapDeliveryUnit;
        issues: GhIssue[];
        routing: RoutingSnapshotEntry[];
        readiness: AcceptedAuthority<DeliveryUnitReadiness>;
        validation: AcceptedAuthority<ValidationContract>;
        active?: ActiveExecutionUnit;
      }> = [];
      for (const unitId of roadmap.value.readyFrontier) {
        if (selected.length >= maxUnits) break;
        const unit = roadmap.value.deliveryUnits.find((candidate) => candidate.unitId === unitId);
        if (unit === undefined) throw new Error(`RoadmapPlan frontier names missing unit ${unitId}`);
        const active = await findActiveExecutionUnit(input.root, input.app.name, unitId);
        if (active !== undefined && !["admitted", "planning", "claimed"].includes(active.journal.state)) {
          continue;
        }
        const issues = await Promise.all(unit.issueNumbers.map((number) => input.gh.readIssue(number)));
        const excluded = issues.find((issue) => autonomousExecutionExclusionLabel(issue.labels) !== undefined);
        if (excluded !== undefined) {
          const exclusion = autonomousExecutionExclusionLabel(excluded.labels);
          refusals.push({
            issueNumber: excluded.number,
            code: exclusion === MANUAL_REVIEW_EXCLUSION_LABEL ? "manual_review" : "routing_human_only",
            reason: `delivery unit ${unitId} refused because #${excluded.number} is not autonomously ready`,
          });
          continue;
        }
        const changed = issues.find((issue) => {
          const snapshotted = backlog.value.issues.find((entry) => entry.issueNumber === issue.number);
          return (
            snapshotted === undefined ||
            snapshotted.lifecycle !== "open" ||
            snapshotted.contentHash !== issueContentHash(issue)
          );
        });
        if (changed !== undefined) {
          refusals.push({
            issueNumber: changed.number,
            code: "roadmap_member_changed",
            reason: `delivery unit ${unit.unitId} refused because #${changed.number} changed after the accepted backlog snapshot`,
          });
          continue;
        }
        const routing = issues.map(routingEntry);
        if (issues.some((issue) => issue.state.toUpperCase() !== "OPEN" || !issue.labels.includes("op:ready"))) {
          continue;
        }
        const [readiness, validation] = await Promise.all([
          readCurrentDeliveryUnitReadiness(input.root, input.app.name, unitId),
          readCurrentValidationContract(input.root, input.app.name, unitId),
        ]);
        if (readiness === undefined || validation === undefined) continue;
        if (
          !sameAuthority(readiness.value.roadmapRef, roadmap.ref) ||
          readiness.value.frontierHash !== stableHash(roadmap.value.readyFrontier) ||
          !sameAuthority(validation.value.roadmapRef, roadmap.ref)
        )
          continue;
        selected.push({
          unit,
          issues,
          routing,
          readiness,
          validation,
          ...(active === undefined ? {} : { active }),
        });
      }
      if (selected.length === 0) return { units: [], ...(refusals.length === 0 ? {} : { refusals }) };
      const activeBatch = selected.find((entry) => entry.active !== undefined)?.active?.batch;
      const admittedSelection =
        activeBatch === undefined
          ? selected
          : selected.filter((entry) => entry.active?.batch.ref.sha256 === activeBatch.ref.sha256);
      if (planOnly) {
        return {
          units: admittedSelection.map((entry) =>
            previewAdmission(
              input.app.name,
              entry.unit,
              entry.issues,
              entry.readiness,
              entry.validation,
              validationCatalog,
            ),
          ),
          ...(refusals.length === 0 ? {} : { refusals }),
        };
      }
      const batch =
        activeBatch ??
        (await admitExecutionBatch({
          root: input.root,
          app: input.app.name,
          batchId: `batch-${stableHash({
            roadmap: roadmap.ref,
            units: admittedSelection.map((entry) => entry.unit.unitId),
          }).slice(0, 32)}`,
          roadmapRef: roadmap.ref,
          expectedFrontierHash: stableHash(roadmap.value.readyFrontier),
          orderedUnitIds: admittedSelection.map((entry) => entry.unit.unitId),
          readinessRefs: admittedSelection.map((entry) => entry.readiness.ref),
          routing: admittedSelection.flatMap((entry) => entry.routing),
          admittedAt: now.toISOString(),
          maxUnits,
        }));
      const units = admittedSelection.map((entry) => {
        const admitted = admittedProjection(
          input.app.name,
          batch,
          entry.unit,
          entry.issues,
          entry.readiness,
          entry.validation,
          validationCatalog,
        );
        admissions.set(admitted.authorityToken, { batch, roadmapUnit: entry.unit, ...entry });
        return admitted;
      });
      return { units, ...(refusals.length === 0 ? {} : { refusals }) };
    },
    bindAcceptedPlan: async ({ admitted, request, accepted, now }) => {
      const state = requireAdmission(admissions, admitted.authorityToken);
      const binding = await bindDeliveryUnitEpisodePlan({
        root: input.root,
        app: input.app.name,
        batchRef: state.batch.ref,
        unitId: state.roadmapUnit.unitId,
        plan: accepted.plan,
        now,
      });
      const bindingToken = token({
        batchRef: state.batch.ref,
        unitId: state.roadmapUnit.unitId,
        bindingRef: binding.ref,
      });
      bindings.set(bindingToken, { ...state, binding, request, accepted });
      return { ...admitted, bindingToken };
    },
    failBeforeClaim: async ({ admitted, error, now }) => {
      const state = requireAdmission(admissions, admitted.authorityToken);
      await transitionExecutionUnitJournal({
        root: input.root,
        app: input.app.name,
        batchRef: state.batch.ref,
        unitId: state.roadmapUnit.unitId,
        expectedStates: ["admitted", "planning"],
        nextState: "failed",
        outcome: "failed",
        now,
      });
      await returnAllMembers(input.gh, state.issues);
      return (
        `delivery unit ${state.roadmapUnit.unitId} failed before claim without changing sibling outcomes: ` +
        `${error instanceof Error ? error.message : String(error)}`
      );
    },
    claim: async ({ unit, now }) => {
      const state = requireBinding(bindings, unit.bindingToken);
      const claimed = await claimDeliveryUnit({
        root: input.root,
        app: input.app.name,
        episodeBindingRef: state.binding.ref,
        readCurrentRouting: async (numbers) =>
          Promise.all(numbers.map(async (number) => routingEntry(await input.gh.readIssue(number)))),
        now,
      });
      const priorOwner = claimed.record.owner;
      const priorOwnerStillLive =
        priorOwner !== null && processIdentityStatus(priorOwner.pid, priorOwner.process_start_identity) !== "mismatch";
      if (
        claimed.record.status === "settled" ||
        (claimed.disposition === "already_claimed" && (claimed.record.status === "claimed" || priorOwnerStillLive))
      ) {
        throw new Error(`delivery unit ${state.roadmapUnit.unitId} is already actively claimed`);
      }
      const runId = claimed.record.run_id ?? `delivery-${claimed.record.settlement_id}-a${claimed.record.attempt}`;
      claims.set(claimed.record.settlement_id, claimed);
      return { claimId: claimed.record.settlement_id, attempt: claimed.record.attempt, runId };
    },
    commit: async ({ lease, now }) => {
      const claim = requireClaim(claims, lease.claimId);
      if (claim.record.status === "committed") return;
      await commitDeliveryUnitClaim({
        root: input.root,
        app: input.app.name,
        claim,
        runId: lease.runId,
        now,
      });
    },
    providerStarted: async ({ unit, reservedCostUsd, now }) => {
      const state = requireBinding(bindings, unit.bindingToken);
      await transitionExecutionUnitJournal({
        root: input.root,
        app: input.app.name,
        batchRef: state.batch.ref,
        unitId: state.roadmapUnit.unitId,
        expectedStates: ["claimed", "running", "reviewing"],
        nextState: "running",
        // Reserve the accepted step ceiling before provider admission. Actual
        // spend remains in the canonical budget ledger; the unit journal is a
        // conservative no-lending guard and can never understate authority.
        usageDelta: { providerTurns: 1, equivalentCostUsd: reservedCostUsd },
        now,
      });
    },
    afterGates: async ({ unit, lease, plan, item, now }) => {
      const state = requireBinding(bindings, unit.bindingToken);
      const manifest = await productionBuilderManifest(input, state, lease, plan, item, now);
      const recorded = await recordBuilderEvidence({ root: input.root, manifest });
      evidence.set(unit.bindingToken, recorded);
      await transitionExecutionUnitJournal({
        root: input.root,
        app: input.app.name,
        batchRef: state.batch.ref,
        unitId: state.roadmapUnit.unitId,
        expectedStates: ["running", "reviewing"],
        nextState: "reviewing",
        evidenceRefs: [recorded.ref],
        candidateHead: manifest.candidateHead,
        pullRequestNumber: manifest.pullRequestNumber,
        now,
      });
    },
    afterReview: async ({ unit, plan, item, now }) => {
      const state = requireBinding(bindings, unit.bindingToken);
      const builder = requireMap(evidence, unit.bindingToken, "Builder evidence");
      const verdict = await productionReviewerVerdict(input, state, builder, plan, item, now);
      const recorded = await recordReviewerVerdict({ root: input.root, verdict });
      verdicts.set(unit.bindingToken, recorded);
      await transitionExecutionUnitJournal({
        root: input.root,
        app: input.app.name,
        batchRef: state.batch.ref,
        unitId: state.roadmapUnit.unitId,
        expectedStates: ["running", "reviewing", "approved"],
        nextState: "approved",
        evidenceRefs: [builder.ref, recorded.ref],
        candidateHead: verdict.candidateHead,
        pullRequestNumber: builder.value.pullRequestNumber,
        now,
      });
    },
    beforeShip: async ({ unit, item }) => {
      const builder = requireMap(evidence, unit.bindingToken, "Builder evidence");
      const verdict = requireMap(verdicts, unit.bindingToken, "Reviewer verdict");
      const pr = await input.gh.readPR(builder.value.pullRequestNumber);
      if (
        item.approvedCommitId === undefined ||
        item.approvedCommitId !== builder.value.candidateHead ||
        verdict.value.candidateHead !== builder.value.candidateHead ||
        pr.headRefOid !== builder.value.candidateHead
      ) {
        throw new Error("delivery unit merge authority does not bind the exact reviewed PR HEAD");
      }
    },
    finish: async ({ unit, lease, item, now }) => {
      const state = requireBinding(bindings, unit.bindingToken);
      if (item.phase === "blocked" && item.continuation !== undefined) {
        // The exact approval continuation still owns this committed unit. It
        // is neither a refusal nor a terminal batch disposition.
        return;
      }
      if (item.phase === "merged") {
        const builder = requireMap(evidence, unit.bindingToken, "Builder evidence");
        const verdict = requireMap(verdicts, unit.bindingToken, "Reviewer verdict");
        await settleDeliveryUnitClaim({
          root: input.root,
          app: input.app.name,
          claimSettlementId: lease.claimId,
          claimAttempt: lease.attempt,
          runId: lease.runId,
          reviewerVerdictRef: verdict.ref,
          validationContractHash: state.validation.ref.sha256,
          outcome: "approved",
          now,
        });
        await completeDeliveryUnitMerge({
          root: input.root,
          app: input.app.name,
          batchRef: state.batch.ref,
          unitId: state.roadmapUnit.unitId,
          candidateHead: builder.value.candidateHead,
          pullRequestNumber: builder.value.pullRequestNumber,
          now,
        });
        return;
      }
      await settleDeliveryUnitRefusal({
        root: input.root,
        app: input.app.name,
        claimSettlementId: lease.claimId,
        claimAttempt: lease.attempt,
        runId: lease.runId,
        batchRef: state.batch.ref,
        unitId: state.roadmapUnit.unitId,
        reason: `delivery loop ended in ${item.phase}`,
        now,
      });
    },
    recover: async ({ unit, lease, error, now }) => {
      const state = requireBinding(bindings, unit.bindingToken);
      const journal = await readExecutionUnitJournal(
        input.root,
        input.app.name,
        state.batch.ref.id,
        state.roadmapUnit.unitId,
      );
      if (journal?.state === "approved" && journal.pullRequestNumber !== null && journal.candidateHead !== null) {
        const pr = await input.gh.readPR(journal.pullRequestNumber);
        const reviewerRef = journal.evidenceRefs.find((ref) => ref.kind === "reviewer_verdict");
        if (
          pr.state.toUpperCase() === "MERGED" &&
          pr.headRefOid === journal.candidateHead &&
          reviewerRef !== undefined
        ) {
          // The merge is the irreversible fact. Keep the journal approved
          // until every idempotent member projection is repaired, then settle
          // and complete the exact-HEAD unit. Never rewrite this as returned.
          await completeMergedMemberProjections(input.gh, state.issues);
          await settleDeliveryUnitClaim({
            root: input.root,
            app: input.app.name,
            claimSettlementId: lease.claimId,
            claimAttempt: lease.attempt,
            runId: lease.runId,
            reviewerVerdictRef: reviewerRef,
            validationContractHash: state.validation.ref.sha256,
            outcome: "approved",
            now,
          });
          await completeDeliveryUnitMerge({
            root: input.root,
            app: input.app.name,
            batchRef: state.batch.ref,
            unitId: state.roadmapUnit.unitId,
            candidateHead: journal.candidateHead,
            pullRequestNumber: journal.pullRequestNumber,
            now,
          });
          return `delivery unit ${state.roadmapUnit.unitId} recovered merged exact HEAD atomically`;
        }
      }
      try {
        await settleDeliveryUnitRefusal({
          root: input.root,
          app: input.app.name,
          claimSettlementId: lease.claimId,
          claimAttempt: lease.attempt,
          runId: lease.runId,
          batchRef: state.batch.ref,
          unitId: state.roadmapUnit.unitId,
          reason: error instanceof Error ? error.message : String(error),
          now,
        });
      } catch {
        await transitionExecutionUnitJournal({
          root: input.root,
          app: input.app.name,
          batchRef: state.batch.ref,
          unitId: state.roadmapUnit.unitId,
          expectedStates: ["claimed", "running", "reviewing", "approved"],
          nextState: "failed",
          outcome: "failed",
          now,
        });
      }
      await returnAllMembers(input.gh, state.issues);
      return `delivery unit ${state.roadmapUnit.unitId} returned atomically after: ${error instanceof Error ? error.message : String(error)}`;
    },
  };
}

function previewAdmission(
  app: string,
  unit: RoadmapDeliveryUnit,
  issues: GhIssue[],
  readiness: AcceptedAuthority<DeliveryUnitReadiness>,
  validation: AcceptedAuthority<ValidationContract>,
  validationCatalog: AcceptedAuthority<ValidationCatalog> | undefined,
): AdmittedLoopDeliveryUnit {
  const projection = loopUnit(unit, issues);
  const creatorScope = routineDeliveryCreatorScope(undefined, unit, readiness, validation, validationCatalog);
  return {
    authorityToken: token({ app, unitId: unit.unitId, preview: true }),
    episodeId: deliveryUnitEpisodeId(app, projection),
    unit: projection,
    issues: structuredClone(issues),
    ...(creatorScope === undefined ? {} : { creatorScope }),
  };
}

function admittedProjection(
  app: string,
  batch: AcceptedAuthority<ExecutionBatch>,
  unit: RoadmapDeliveryUnit,
  issues: GhIssue[],
  readiness: AcceptedAuthority<DeliveryUnitReadiness>,
  validation: AcceptedAuthority<ValidationContract>,
  validationCatalog: AcceptedAuthority<ValidationCatalog> | undefined,
): AdmittedLoopDeliveryUnit {
  const projection = loopUnit(unit, issues);
  const creatorScope = routineDeliveryCreatorScope(batch, unit, readiness, validation, validationCatalog);
  return {
    authorityToken: token({ batchRef: batch.ref, unitId: unit.unitId }),
    episodeId: deliveryUnitEpisodeId(app, projection),
    unit: projection,
    issues: structuredClone(issues),
    ...(creatorScope === undefined ? {} : { creatorScope }),
  };
}

/** A routine accepted validation contract is the structured low-risk code
 * profile. It may skip only the delivery-planning provider turn. Ticket label
 * safety facts are merged later by the ticket adapter, so security, migration,
 * release, or other safety floors make this template ineligible and take the
 * bounded planner path. */
function routineDeliveryCreatorScope(
  batch: AcceptedAuthority<ExecutionBatch> | undefined,
  unit: RoadmapDeliveryUnit,
  readiness: AcceptedAuthority<DeliveryUnitReadiness>,
  validation: AcceptedAuthority<ValidationContract>,
  validationCatalog: AcceptedAuthority<ValidationCatalog> | undefined,
): CreatorEpisodeScope | undefined {
  const template =
    validation.value.templateRef === null ||
    validationCatalog === undefined ||
    !sameAuthority(validation.value.catalogRef, validationCatalog.ref)
      ? undefined
      : validationCatalog.value.templates.find(
          (candidate) =>
            candidate.templateId === validation.value.templateRef!.templateId &&
            candidate.version === validation.value.templateRef!.version,
        );
  if (template?.kind !== "routine" || validation.value.requiresHarnessRevision) return undefined;
  const evidenceRefs = [
    authorityRefText(validation.value.roadmapRef),
    authorityRefText(readiness.ref),
    authorityRefText(validation.ref),
    ...(batch === undefined ? [] : [authorityRefText(batch.ref)]),
  ];
  return {
    planningDisposition: "execution_ready",
    provenance: {
      source: "agent",
      creatorId: "cormidia-roadmap-validation-normalizer",
      createdAt: validation.value.acceptedAt,
      evidenceRefs,
    },
    workKind: "roadmap-code-delivery-unit",
    objective: unit.objective,
    inScope: unit.issueNumbers.map((number) => `issue:#${number}`),
    outOfScope: [
      "work outside the accepted delivery-unit membership",
      "unapproved publication, deployment, release, or protected-surface changes",
    ],
    acceptanceCriteria: [...validation.value.acceptanceCriteria],
    expectedArtifacts: [{ id: "ship-result", kind: "ship-result", required: true }],
    declaredConstraints: {
      roadmapRef: authorityRefText(validation.value.roadmapRef),
      readinessRef: authorityRefText(readiness.ref),
      validationRef: authorityRefText(validation.ref),
      ...(batch === undefined ? {} : { batchRef: authorityRefText(batch.ref) }),
      membershipHash: unitMembershipHash(unit.issueNumbers),
      onePullRequest: true,
      exactHeadReview: true,
    },
    safetyFacts: [{ kind: "independent_review", evidenceRefs: [authorityRefText(validation.ref)] }],
    workflowTemplate: { ...TICKET_STANDARD_DELIVERY_WORKFLOW_TEMPLATE },
  };
}

function loopUnit(unit: RoadmapDeliveryUnit, issues: GhIssue[]): LoopDeliveryUnit {
  return {
    unitId: unit.unitId,
    membershipHash: unitMembershipHash(unit.issueNumbers),
    members: unit.issueNumbers.map((number) => {
      const issue = issues.find((candidate) => candidate.number === number);
      if (issue === undefined) throw new Error(`delivery unit ${unit.unitId} is missing #${number}`);
      return {
        issueNumber: issue.number,
        ticketRef: `#${issue.number}`,
        contentHash: issueContentHash(issue),
        title: issue.title,
        body: issue.body,
        labels: [...issue.labels],
      };
    }),
  };
}

function routingEntry(issue: GhIssue): RoutingSnapshotEntry {
  return {
    issueNumber: issue.number,
    disposition: issue.labels.includes(HUMAN_ONLY_LABEL) ? "human_only" : "automated",
    observedLabels: [...issue.labels],
  };
}

async function productionBuilderManifest(
  input: { root: string; app: AppEntry; gh: GhOps },
  state: BindingState,
  lease: DeliveryUnitClaimLease,
  plan: EpisodePlan,
  item: LoopItem,
  now: Date,
): Promise<BuilderEvidenceManifest> {
  const prNumber = required(item.prNumber, "delivery unit PR number");
  const pr = await input.gh.readPR(prNumber);
  const candidateHead = required(pr.headRefOid, "delivery unit PR HEAD");
  const builderStep = providerStep(plan, "builder");
  const records = await readExecutionSteps(input.root, plan.episodeId);
  const builderRecord = [...records]
    .reverse()
    .find((record) => record.role === "builder" && record.status === "completed");
  if (builderRecord === undefined) throw new Error("delivery unit has no completed Builder execution record");
  const gateRows = item.gateResults
    .filter((run) => run.status === "pass" && run.headCommitId === candidateHead)
    .flatMap((run) => run.results)
    .filter((gate) => gate.status === "pass");
  const gates = state.validation.value.requiredGates.map((gate) => {
    const receipt = gateRows.find((candidate) => candidate.gate === gate);
    if (receipt === undefined) throw new Error(`validation contract required gate ${gate} has no passing receipt`);
    return { gate, status: "passed" as const, evidence: receipt.detail };
  });
  const caseEvidence = new Map(
    state.validation.value.obligations
      .filter((obligation) => obligation.waiver === null)
      .map((obligation) => {
        const receipt = gateRows.find((candidate) => {
          const evidenceText = `${candidate.gate}\n${candidate.detail}\n${candidate.outputTail ?? ""}`;
          return [obligation.caseId, obligation.detectorId, obligation.negativeControlId].every((identity) =>
            evidenceText.includes(identity),
          );
        });
        if (receipt === undefined) {
          throw new Error(
            `validation obligation ${obligation.caseId} lacks a passing receipt naming its detector and negative control`,
          );
        }
        return [obligation.obligationId, receipt] as const;
      }),
  );
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    app: input.app.name,
    unitId: state.roadmapUnit.unitId,
    issueNumbers: [...state.roadmapUnit.issueNumbers],
    membershipHash: unitMembershipHash(state.roadmapUnit.issueNumbers),
    roadmapRef: state.binding.value.roadmapRef,
    readinessRef: state.readiness.ref,
    validationRef: state.validation.ref,
    validationContractHash: state.validation.ref.sha256,
    batchRef: state.batch.ref,
    episodeBindingRef: state.binding.ref,
    episodeId: plan.episodeId,
    episodePlanVersion: plan.version,
    episodePlanHash: stableHash(plan),
    claimSettlementId: lease.claimId,
    claimAttempt: lease.attempt,
    repository: input.app.repo,
    baseRevision: state.request.base.ref,
    candidateHead,
    pullRequestNumber: prNumber,
    pullRequestUrl: pr.url ?? `https://github.com/${input.app.repo}/pull/${prNumber}`,
    builderRole: "builder",
    builderAssignment: builderStep.assignment,
    builderSessionId: builderRecord.provider_turn_id ?? builderRecord.run_id,
    cases: state.validation.value.obligations.map((obligation) =>
      obligation.waiver === null
        ? {
            caseId: obligation.caseId,
            detectorId: obligation.detectorId,
            negativeControlId: obligation.negativeControlId,
            status: "passed" as const,
            waiverId: null,
            evidence: `PR #${prNumber} HEAD ${candidateHead}; ${caseEvidence.get(obligation.obligationId)!.detail}`,
          }
        : {
            caseId: obligation.caseId,
            detectorId: obligation.detectorId,
            negativeControlId: obligation.negativeControlId,
            status: "waived" as const,
            waiverId: obligation.waiver.waiverId,
            evidence: `current accepted waiver ${obligation.waiver.waiverId}`,
          },
    ),
    gates,
    recordedAt: now.toISOString(),
  };
}

async function productionReviewerVerdict(
  input: { root: string; app: AppEntry; gh: GhOps },
  state: BindingState,
  builder: AcceptedAuthority<BuilderEvidenceManifest>,
  plan: EpisodePlan,
  item: LoopItem,
  now: Date,
): Promise<ReviewerVerdict> {
  const reviewerStep = providerStep(plan, "reviewer");
  const records = await readExecutionSteps(input.root, plan.episodeId);
  const reviewerRecord = [...records]
    .reverse()
    .find((record) => record.role === "reviewer" && record.status === "completed");
  if (reviewerRecord === undefined) throw new Error("delivery unit has no completed Reviewer execution record");
  const head = required(item.approvedCommitId, "approved delivery unit HEAD");
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    app: input.app.name,
    unitId: state.roadmapUnit.unitId,
    membershipHash: builder.value.membershipHash,
    roadmapRef: state.binding.value.roadmapRef,
    readinessRef: state.readiness.ref,
    validationRef: state.validation.ref,
    validationContractHash: state.validation.ref.sha256,
    episodeBindingRef: state.binding.ref,
    builderEvidenceRef: builder.ref,
    candidateHead: head,
    reviewerRole: "reviewer",
    reviewerAssignment: reviewerStep.assignment,
    reviewerSessionId: reviewerRecord.provider_turn_id ?? reviewerRecord.run_id,
    disposition: "approved",
    evidenceAccepted: true,
    reproducedCaseIds: state.validation.value.obligations
      .filter((obligation) => obligation.waiver === null)
      .map((obligation) => obligation.caseId),
    rationale: `independent review authorized exact PR HEAD ${head} after accepted validation gates`,
    recordedAt: now.toISOString(),
  };
}

function providerStep(plan: EpisodePlan, role: "builder" | "reviewer"): ProviderTurnStep {
  const step = [...plan.steps]
    .reverse()
    .find((candidate): candidate is ProviderTurnStep => candidate.kind === "provider_turn" && candidate.role === role);
  if (step === undefined) throw new Error(`delivery EpisodePlan has no ${role} step`);
  return step;
}

async function reconcileActiveProjections(
  input: { root: string; app: AppEntry; gh: GhOps },
  now: Date,
): Promise<string[]> {
  const lines: string[] = [];
  const currentRoadmap = await readCurrentRoadmapPlan(input.root, input.app.name);
  for (const active of await listActiveExecutionUnits(input.root, input.app.name)) {
    if (active.unit.kind === "direct_operation") continue;
    const unitId = active.unit.unitId;
    const issues = await Promise.all((active.unit.issueNumbers ?? []).map((number) => input.gh.readIssue(number)));
    const batchRoadmap = active.batch.value.roadmapRef;
    const staleRoadmap =
      currentRoadmap === undefined || batchRoadmap === null || !sameAuthority(batchRoadmap, currentRoadmap.ref);
    if (staleRoadmap && ["admitted", "planning", "claimed"].includes(active.journal.state)) {
      await transitionExecutionUnitJournal({
        root: input.root,
        app: input.app.name,
        batchRef: active.batch.ref,
        unitId,
        expectedStates: ["admitted", "planning", "claimed"],
        nextState: "failed",
        outcome: "failed",
        now,
      });
      await projectAllMembers(input.gh, issues, "op:returned");
      lines.push(`${unitId}: refused stale pre-provider roadmap authority for every member`);
      continue;
    }
    if (["admitted", "planning"].includes(active.journal.state)) continue;
    if (active.journal.state === "claimed") {
      await projectAllMembers(input.gh, issues, "op:ready");
      lines.push(`${unitId}: recovered pre-provider claim projection to op:ready for every member`);
      continue;
    }
    if (!["running", "reviewing", "approved"].includes(active.journal.state)) continue;
    const projectedStates = issues.map((issue) =>
      issue.labels.find((label) => (STATE_LABELS as readonly string[]).includes(label)),
    );
    if (projectedStates.length > 0 && projectedStates.every((label) => label === "op:blocked")) {
      lines.push(`${unitId}: preserved one all-member approval continuation`);
      continue;
    }
    const claimId = active.journal.claimSettlementId;
    const claim = claimId === null ? undefined : await readDeliveryUnitClaim(input.root, claimId);
    if (
      active.journal.state === "approved" &&
      active.journal.pullRequestNumber !== null &&
      active.journal.candidateHead !== null &&
      claim !== undefined &&
      claim.run_id !== null
    ) {
      const pr = await input.gh.readPR(active.journal.pullRequestNumber);
      const reviewerRef = active.journal.evidenceRefs.find((ref) => ref.kind === "reviewer_verdict");
      if (
        pr.state.toUpperCase() === "MERGED" &&
        pr.headRefOid === active.journal.candidateHead &&
        reviewerRef !== undefined
      ) {
        await completeMergedMemberProjections(input.gh, issues);
        await settleDeliveryUnitClaim({
          root: input.root,
          app: input.app.name,
          claimSettlementId: claim.settlement_id,
          claimAttempt: claim.attempt,
          runId: claim.run_id,
          reviewerVerdictRef: reviewerRef,
          validationContractHash: claim.payload.validationContractHash,
          outcome: "approved",
          now,
        });
        await completeDeliveryUnitMerge({
          root: input.root,
          app: input.app.name,
          batchRef: active.batch.ref,
          unitId,
          candidateHead: active.journal.candidateHead,
          pullRequestNumber: active.journal.pullRequestNumber,
          now,
        });
        lines.push(`${unitId}: recovered exact-HEAD merged outcome for every member`);
        continue;
      }
    }
    if (claim !== undefined && claim.run_id !== null && claim.status !== "claimed") {
      await settleDeliveryUnitRefusal({
        root: input.root,
        app: input.app.name,
        claimSettlementId: claim.settlement_id,
        claimAttempt: claim.attempt,
        runId: claim.run_id,
        batchRef: active.batch.ref,
        unitId,
        reason: "process stopped after provider execution before a recoverable terminal merge",
        now,
      });
    } else {
      await transitionExecutionUnitJournal({
        root: input.root,
        app: input.app.name,
        batchRef: active.batch.ref,
        unitId,
        expectedStates: ["running", "reviewing", "approved"],
        nextState: "failed",
        outcome: "failed",
        now,
      });
    }
    await projectAllMembers(input.gh, issues, "op:returned");
    lines.push(`${unitId}: recovered post-provider unit to one terminal returned projection`);
  }
  return lines;
}

async function completeMergedMemberProjections(gh: GhOps, issues: readonly GhIssue[]): Promise<void> {
  const stateLabels = new Set<string>(STATE_LABELS);
  for (const source of issues) {
    const issue = await gh.readIssue(source.number);
    for (const label of issue.labels.filter((candidate) => stateLabels.has(candidate))) {
      await gh.removeLabel(issue.number, label);
    }
    const checkedBody = checkAcceptanceBoxes(issue.body);
    if (checkedBody !== issue.body) await gh.updateIssueBody(issue.number, checkedBody);
  }
}

async function returnAllMembers(gh: GhOps, issues: readonly GhIssue[]): Promise<void> {
  await projectAllMembers(gh, issues, "op:returned");
}

async function projectAllMembers(gh: GhOps, issues: readonly GhIssue[], target: string): Promise<void> {
  for (const source of issues) {
    const issue = await gh.readIssue(source.number);
    const current = issue.labels.find((label) => (STATE_LABELS as readonly string[]).includes(label));
    if (current === target) continue;
    if (current === undefined) await gh.addLabel(issue.number, target);
    else await gh.swapLabel(issue.number, current, target);
  }
}

function requireAdmission(map: Map<string, AdmissionState>, key: string): AdmissionState {
  return requireMap(map, key, "delivery admission");
}

function requireBinding(map: Map<string, BindingState>, key: string): BindingState {
  return requireMap(map, key, "delivery binding");
}

function requireClaim(map: Map<string, DeliveryUnitClaim>, key: string): DeliveryUnitClaim {
  return requireMap(map, key, "delivery claim");
}

function requireMap<T>(map: Map<string, T>, key: string, kind: string): T {
  const value = map.get(key);
  if (value === undefined) throw new Error(`${kind} ${key} is unavailable`);
  return value;
}

function token(value: unknown): string {
  return stableHash(value);
}

function sameAuthority(left: AuthorityRef, right: AuthorityRef): boolean {
  return (
    left.kind === right.kind && left.id === right.id && left.version === right.version && left.sha256 === right.sha256
  );
}

function authorityRefText(ref: AuthorityRef): string {
  return `${ref.kind}:${ref.id}@${ref.version}#${ref.sha256}`;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} is missing`);
  return value;
}
