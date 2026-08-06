// Durable, resumable publication for scheduled Planner turns (#232).
// Provider work ends before this state machine begins. Every retry consumes
// only persisted Planner output and deterministic repository/GitHub facts.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BaseRevision } from "../loop/default-branch.js";
import type { GhIssue, GhOps } from "../loop/github.js";
import { writeLoopFileAtomic } from "../loop/durable.js";
import { stableHash } from "../loop/episode-plan.js";
import type { PublishedTicket, TicketPlan } from "../loop/plan-tickets.js";
import { parseDependsOn } from "../loop/scheduling.js";
import { hashedFileStem } from "../runtime/runlog/paths.js";
import { scrubSecrets } from "../runtime/runlog/redact.js";
import { withFileLock } from "../runtime/file-lock.js";
import { SECRET_PATTERNS } from "../runtime/secret-patterns.js";
import type { AppEntry } from "./apps.js";
import {
  applyPlannerReadinessDecisions,
  plannerRoutineReadinessGuard,
  type PlannerIssueIntake,
  type PlannerReadinessApplication,
  type PlannerReadinessDecision,
} from "./planner-intake.js";
import { persistPublishedRoadmap } from "./plan-auto.js";
import { ratifiedRoadmapValidationCatalog } from "./ratified-validation-catalog.js";
import { canonicalJson as schedulerCanonicalJson, sha256 as schedulerSha256 } from "./scheduler/model.js";
import {
  acceptDeliveryUnitReadiness,
  acceptValidationCatalog,
  acceptValidationContract,
  readCurrentRoadmapPlan,
  readCurrentValidationCatalog,
  readCurrentValidationContract,
  unitMembershipHash,
  type AcceptedAuthority,
  type AuthorityRef,
  type DeliveryUnitReadiness,
  type RoutingSnapshotEntry,
  type ValidationAffectedStructure,
  type ValidationCatalog,
  type ValidationContract,
} from "./roadmap-delivery.js";
import { readBacklogSnapshotAuthority } from "./roadmap-delivery.js";

export const PLANNER_PUBLICATION_SCHEMA_VERSION = 1 as const;
export const PLANNER_PUBLICATION_BACKLOG_LIMIT = 10_001;

export type PlannerPublicationState = "publication_pending" | "published" | "refused";

export interface PlannerPublicationError {
  code: string;
  message: string;
  permanence: "retryable" | "permanent";
  observed_at: string;
}

export interface PlannerPublicationTransaction {
  schema_version: typeof PLANNER_PUBLICATION_SCHEMA_VERSION;
  kind: "planner-publication";
  publication_id: string;
  state: PlannerPublicationState;
  app: string;
  turn_id: string;
  repository: string;
  worktree_path: string;
  branch: string;
  commit: string;
  base: { ref: string; default_branch: string; commit: string };
  branch_created: boolean;
  changed_paths: string[];
  intended_effects: Array<{
    kind: "git_branch" | "planner_readiness" | "roadmap_plan" | "validation_readiness";
    identity: string;
    detail: Record<string, unknown>;
  }>;
  planner_input: {
    intake: PlannerIssueIntake;
    decisions: PlannerReadinessDecision[];
  };
  evidence: {
    episode_id: string;
    provider_run_ids: string[];
    provider_output_sha256: string;
    intake_sha256: string;
    remote_commit: string | null;
    readiness_application: PlannerReadinessApplication | null;
    roadmap_ref: AuthorityRef | null;
    validation_refs: AuthorityRef[];
    readiness_refs: AuthorityRef[];
  };
  error: PlannerPublicationError | null;
  recovery: {
    identity: string;
    command: string;
  };
  created_at: string;
  updated_at: string;
}

export interface PreparedPlannerGitPublication {
  branchCreated: boolean;
  commit: string;
  baseCommit: string;
  remoteRepository?: string;
  changedPaths: string[];
  protectedPaths: string[];
  secretPatterns: string[];
}

export interface PlannerPublicationGit {
  prepare(input: {
    worktree: string;
    branch: string;
    base: BaseRevision;
    turnId: string;
  }): PreparedPlannerGitPublication;
  remoteCommit(worktree: string, branch: string): string | null;
  push(worktree: string, branch: string, commit: string): void;
}

export class PermanentPlannerPublicationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PermanentPlannerPublicationError";
    this.code = code;
  }
}

export interface PreparePlannerPublicationInput {
  stateHome: string;
  app: AppEntry;
  turnId: string;
  worktree: string;
  branch: string;
  base: BaseRevision;
  intake: PlannerIssueIntake;
  decisions: readonly PlannerReadinessDecision[];
  episodeId: string;
  providerRunIds: readonly string[];
  providerOutput: string;
  now: Date;
  git?: PlannerPublicationGit;
}

export async function preparePlannerPublication(
  input: PreparePlannerPublicationInput,
): Promise<PlannerPublicationTransaction> {
  const publicationId = plannerPublicationId(input.app.name, input.turnId);
  return withPlannerPublicationLock(input.stateHome, input.app.name, publicationId, () =>
    preparePlannerPublicationUnlocked(input, publicationId),
  );
}

async function preparePlannerPublicationUnlocked(
  input: PreparePlannerPublicationInput,
  publicationId: string,
): Promise<PlannerPublicationTransaction> {
  const existing = await readPlannerPublication(input.stateHome, input.app.name, publicationId);
  if (existing !== undefined) {
    assertResumeIdentity(existing, input);
    return existing;
  }
  const roadmapBefore = await readCurrentRoadmapPlan(input.stateHome, input.app.name);
  const prepared = (input.git ?? defaultPlannerPublicationGit).prepare({
    worktree: input.worktree,
    branch: input.branch,
    base: input.base,
    turnId: input.turnId,
  });
  const createdAt = input.now.toISOString();
  const providerOutputSha256 = stableHash(input.providerOutput);
  const roadmapSource = plannerPublicationRoadmapSource(publicationId);
  const effects: PlannerPublicationTransaction["intended_effects"] = [
    ...(prepared.branchCreated
      ? [
          {
            kind: "git_branch" as const,
            identity: `${input.app.repo}:refs/heads/${input.branch}@${prepared.commit}`,
            detail: { branch: input.branch, commit: prepared.commit, changed_paths: prepared.changedPaths },
          },
        ]
      : []),
    {
      kind: "planner_readiness",
      identity: input.intake.manifest_sha256,
      detail: { issue_numbers: input.decisions.map((decision) => decision.issue_number).sort(numeric) },
    },
    {
      kind: "roadmap_plan",
      identity: `${input.app.name}:${input.turnId}:roadmap`,
      detail: { source: roadmapSource, predecessor: roadmapBefore?.ref ?? null },
    },
    {
      kind: "validation_readiness",
      identity: `${input.app.name}:${input.turnId}:validation`,
      detail: { template: "routine-v1", after: "roadmap_plan" },
    },
  ];
  const recoveryIdentity = plannerPublicationRecoveryIdentity({
    app: input.app.name,
    turnId: input.turnId,
    publicationId,
    repository: input.app.repo,
    branch: input.branch,
    commit: prepared.commit,
    intakeSha256: input.intake.manifest_sha256,
    decisionsSha256: stableHash(input.decisions),
    providerOutputSha256,
    intendedEffectsSha256: stableHash(effects),
  });
  const repositoryMismatch =
    prepared.remoteRepository !== undefined &&
    normalizeRepository(prepared.remoteRepository) !== normalizeRepository(input.app.repo);
  const publicationRefusal = repositoryMismatch
    ? publicationError(
        "error_planner_publication_repository_mismatch",
        "Planner worktree origin does not match the registered publication repository",
        "permanent",
        createdAt,
      )
    : prepared.protectedPaths.length > 0
      ? publicationError(
          "error_planner_protected_surface",
          `Planner publication contains protected paths: ${prepared.protectedPaths.join(", ")}`,
          "permanent",
          createdAt,
        )
      : prepared.secretPatterns.length > 0
        ? publicationError(
            "error_planner_publication_secret",
            `Planner publication matches credential patterns: ${prepared.secretPatterns.join(", ")}`,
            "permanent",
            createdAt,
          )
        : null;
  const transaction: PlannerPublicationTransaction = {
    schema_version: PLANNER_PUBLICATION_SCHEMA_VERSION,
    kind: "planner-publication",
    publication_id: publicationId,
    state: publicationRefusal === null ? "publication_pending" : "refused",
    app: input.app.name,
    turn_id: input.turnId,
    repository: input.app.repo,
    worktree_path: input.worktree,
    branch: input.branch,
    commit: prepared.commit,
    base: {
      ref: input.base.ref,
      default_branch: input.base.defaultBranch,
      commit: prepared.baseCommit,
    },
    branch_created: prepared.branchCreated,
    changed_paths: prepared.changedPaths,
    intended_effects: effects,
    planner_input: {
      intake: structuredClone(input.intake),
      decisions: structuredClone([...input.decisions]),
    },
    evidence: {
      episode_id: input.episodeId,
      provider_run_ids: [...input.providerRunIds],
      provider_output_sha256: providerOutputSha256,
      intake_sha256: input.intake.manifest_sha256,
      remote_commit: null,
      readiness_application: null,
      roadmap_ref: null,
      validation_refs: [],
      readiness_refs: [],
    },
    error: publicationRefusal,
    recovery: {
      identity: recoveryIdentity,
      command: plannerPublicationRecoveryCommand(input.app.name, publicationId),
    },
    created_at: createdAt,
    updated_at: createdAt,
  };
  await writePlannerPublication(input.stateHome, transaction);
  return transaction;
}

export interface ResumePlannerPublicationInput {
  stateHome: string;
  app: AppEntry;
  publicationId: string;
  gh: Pick<GhOps, "addLabel" | "removeLabel" | "readIssue" | "listIssues">;
  now: Date;
  git?: PlannerPublicationGit;
  fault?: (boundary: "after_push" | "after_readiness" | "after_roadmap") => void | Promise<void>;
}

export async function resumePlannerPublication(
  input: ResumePlannerPublicationInput,
): Promise<PlannerPublicationTransaction> {
  return withPlannerPublicationLock(input.stateHome, input.app.name, input.publicationId, () =>
    resumePlannerPublicationUnlocked(input),
  );
}

async function resumePlannerPublicationUnlocked(
  input: ResumePlannerPublicationInput,
): Promise<PlannerPublicationTransaction> {
  let transaction = await requiredPlannerPublication(input.stateHome, input.app.name, input.publicationId);
  if (transaction.repository !== input.app.repo) {
    throw new PermanentPlannerPublicationError(
      "error_planner_publication_repository_mismatch",
      `publication ${transaction.publication_id} names ${transaction.repository}, not ${input.app.repo}`,
    );
  }
  const git = input.git ?? defaultPlannerPublicationGit;
  if (transaction.state === "refused") {
    // A permanent refusal never authorizes this reconciler to repeat the
    // rejected effect. It can, however, acknowledge an exact commit that a
    // human subsequently published after resolving the refusal. That is the
    // sole terminal-refusal recovery and it performs no Git mutation.
    if (!transaction.branch_created || transaction.evidence.remote_commit !== null) return transaction;
    const observed = transaction.branch_created
      ? safeRemoteCommit(git, transaction.worktree_path, transaction.branch)
      : null;
    if (observed !== transaction.commit) return transaction;
    transaction = {
      ...transaction,
      state: "publication_pending",
      evidence: { ...transaction.evidence, remote_commit: transaction.commit },
      error: null,
      updated_at: input.now.toISOString(),
    };
    await writePlannerPublication(input.stateHome, transaction);
  }
  if (transaction.state !== "publication_pending") return transaction;
  let currentIssues: GhIssue[] | undefined;

  if (transaction.branch_created && transaction.evidence.remote_commit === null) {
    try {
      const observed = git.remoteCommit(transaction.worktree_path, transaction.branch);
      if (observed !== null && observed !== transaction.commit) {
        return refuse(
          input.stateHome,
          transaction,
          "error_planner_publication_remote_conflict",
          `remote branch ${transaction.branch} is ${observed}, expected absent or ${transaction.commit}`,
          input.now,
        );
      }
      if (observed === null) {
        try {
          git.push(transaction.worktree_path, transaction.branch, transaction.commit);
        } catch (error) {
          const after = safeRemoteCommit(git, transaction.worktree_path, transaction.branch);
          if (after !== transaction.commit) {
            if (after !== null) {
              return refuse(
                input.stateHome,
                transaction,
                "error_planner_publication_remote_conflict",
                `remote branch ${transaction.branch} changed to ${after} while publication was in flight`,
                input.now,
              );
            }
            return recordPublicationFailure(input.stateHome, transaction, error, input.now);
          }
        }
        // Fault boundary is deliberately before the local acknowledgement.
        // A replay proves the remote ref and never pushes twice.
        await input.fault?.("after_push");
      }
      transaction = {
        ...transaction,
        evidence: { ...transaction.evidence, remote_commit: transaction.commit },
        error: null,
        updated_at: input.now.toISOString(),
      };
      await writePlannerPublication(input.stateHome, transaction);
    } catch (error) {
      return recordPublicationFailure(input.stateHome, transaction, error, input.now);
    }
  }

  if (transaction.evidence.readiness_application === null) {
    try {
      const application = await applyPlannerReadinessDecisions({
        gh: input.gh,
        intake: transaction.planner_input.intake,
        decisions: transaction.planner_input.decisions,
      });
      await input.fault?.("after_readiness");
      transaction = {
        ...transaction,
        evidence: { ...transaction.evidence, readiness_application: application },
        error: null,
        updated_at: input.now.toISOString(),
      };
      await writePlannerPublication(input.stateHome, transaction);
    } catch (error) {
      return recordPublicationFailure(input.stateHome, transaction, error, input.now);
    }
  }

  if (transaction.evidence.roadmap_ref === null) {
    try {
      const expectedRoadmap = plannerPublicationRoadmapEffect(transaction);
      let roadmap = await readCurrentRoadmapPlan(input.stateHome, input.app.name);
      if (
        roadmap !== undefined &&
        (await roadmapHasSource(input.stateHome, input.app.name, roadmap, expectedRoadmap.source))
      ) {
        // Crash/lost acknowledgement after the atomic RoadmapPlan pointer:
        // observe the exact content-bound authority and never publish v+1.
      } else {
        if (!sameOptionalAuthority(roadmap?.ref ?? null, expectedRoadmap.predecessor)) {
          return refuse(
            input.stateHome,
            transaction,
            "error_planner_publication_roadmap_conflict",
            "current RoadmapPlan changed after the Planner publication was prepared",
            input.now,
          );
        }
        const issues = await completeOpenBacklog(input.gh);
        currentIssues = issues;
        const authorizedReady = authorizedReadyIssueNumbers(transaction, issues);
        await persistScheduledPlannerRoadmap({
          stateHome: input.stateHome,
          app: input.app,
          gh: input.gh,
          issues,
          readyIssueNumbers: authorizedReady,
          now: new Date(transaction.created_at),
          source: expectedRoadmap.source,
        });
        roadmap = await readCurrentRoadmapPlan(input.stateHome, input.app.name);
      }
      if (roadmap === undefined) throw new Error("scheduled Planner publication produced no RoadmapPlan");
      await input.fault?.("after_roadmap");
      transaction = {
        ...transaction,
        evidence: { ...transaction.evidence, roadmap_ref: roadmap.ref },
        error: null,
        updated_at: input.now.toISOString(),
      };
      await writePlannerPublication(input.stateHome, transaction);
    } catch (error) {
      return recordPublicationFailure(input.stateHome, transaction, error, input.now);
    }
  }

  try {
    const issues = currentIssues ?? (await completeOpenBacklog(input.gh));
    const authorities = await acceptRoutineValidationReadiness({
      stateHome: input.stateHome,
      app: input.app,
      issues,
      acceptedAt: transaction.created_at,
    });
    transaction = {
      ...transaction,
      state: "published",
      evidence: {
        ...transaction.evidence,
        validation_refs: authorities.validation.map((entry) => entry.ref),
        readiness_refs: authorities.readiness.map((entry) => entry.ref),
      },
      error: null,
      updated_at: input.now.toISOString(),
    };
    await writePlannerPublication(input.stateHome, transaction);
    return transaction;
  } catch (error) {
    return recordPublicationFailure(input.stateHome, transaction, error, input.now);
  }
}

export async function listPlannerPublications(
  stateHome: string,
  app?: string,
): Promise<PlannerPublicationTransaction[]> {
  const root = plannerPublicationRoot(stateHome);
  if (!existsSync(root)) return [];
  const appDirs =
    app === undefined
      ? (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      : [hashedFileStem(app)];
  const records: PlannerPublicationTransaction[] = [];
  for (const appDir of appDirs.sort()) {
    const dir = join(root, appDir);
    if (!existsSync(dir)) continue;
    for (const file of (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()) {
      const parsed = parsePlannerPublication(await readFile(join(dir, file), "utf8"), join(dir, file));
      if (app === undefined || parsed.app === app) records.push(parsed);
    }
  }
  return records.sort(
    (left, right) =>
      right.updated_at.localeCompare(left.updated_at) || left.publication_id.localeCompare(right.publication_id),
  );
}

export async function readPlannerPublication(
  stateHome: string,
  app: string,
  publicationId: string,
): Promise<PlannerPublicationTransaction | undefined> {
  const path = plannerPublicationPath(stateHome, app, publicationId);
  if (!existsSync(path)) return undefined;
  return parsePlannerPublication(await readFile(path, "utf8"), path);
}

export function plannerPublicationId(app: string, turnId: string): string {
  return `pub-${stableHash({ kind: "planner-publication", app, turnId }).slice(0, 32)}`;
}

export function plannerPublicationPath(stateHome: string, app: string, publicationId: string): string {
  return join(plannerPublicationRoot(stateHome), hashedFileStem(app), `${publicationId}.json`);
}

async function persistScheduledPlannerRoadmap(input: {
  stateHome: string;
  app: AppEntry;
  gh: Pick<GhOps, "listIssues">;
  issues: GhIssue[];
  readyIssueNumbers: number[];
  now: Date;
  source: string;
}): Promise<void> {
  const grouped = input.issues
    .map((issue) => ({ issue, group: executionGroup(issue.body) }))
    .filter((entry): entry is { issue: GhIssue; group: string } => entry.group !== undefined);
  const indexByIssue = new Map(grouped.map((entry, index) => [entry.issue.number, index]));
  const tickets: TicketPlan["tickets"] = grouped.map(({ issue, group }) => ({
    title: issue.title,
    tier: tierFor(issue),
    priority: priorityFor(issue),
    dependsOn: parseDependsOn(issue.body)
      .map((number) => indexByIssue.get(number))
      .filter((index): index is number => index !== undefined),
    executionGroup: group,
    fileScope: fileScope(issue.body),
    goal: section(issue.body, "Goal") ?? issue.title,
    context: section(issue.body, "Context") ?? "Scheduled Planner backlog intake.",
    acceptanceCriteria: acceptanceCriteria(issue.body),
    outOfScope: section(issue.body, "Out of scope") ?? "Anything outside the declared issue scope.",
    notesForBuilder: section(issue.body, "Notes for the builder") ?? "Follow the accepted validation contract.",
  }));
  const published: PublishedTicket[] = grouped.map(({ issue }, index) => ({
    index,
    issueNumber: issue.number,
    title: issue.title,
    ready: input.readyIssueNumbers.includes(issue.number),
    labels: [...issue.labels],
  }));
  const syntheticPlan: TicketPlan = {
    stage: "growth",
    ticketCountRationale: "Complete scheduled backlog projection; no new issue publication.",
    releaseDisposition: "merge-only",
    releaseKind: "merge-only",
    tickets,
  };
  await persistPublishedRoadmap({
    stateHome: input.stateHome,
    app: input.app,
    gh: input.gh as GhOps,
    plan: syntheticPlan,
    published,
    now: input.now,
    issues: input.issues,
    readyIssueNumbers: input.readyIssueNumbers,
    source: input.source,
  });
}

async function acceptRoutineValidationReadiness(input: {
  stateHome: string;
  app: AppEntry;
  issues: GhIssue[];
  acceptedAt: string;
}): Promise<{
  validation: Array<AcceptedAuthority<ValidationContract>>;
  readiness: Array<AcceptedAuthority<DeliveryUnitReadiness>>;
}> {
  const roadmap = await readCurrentRoadmapPlan(input.stateHome, input.app.name);
  if (roadmap === undefined) throw new Error("validation readiness requires the current RoadmapPlan");
  const catalog = await ensureValidationCatalog(input.stateHome, input.app.name);
  const sharedCase = catalog.value.cases.find((entry) => entry.canonicalId === "CF-B21-SHARED");
  const template = catalog.value.templates.find((entry) => entry.templateId === "routine-v1" && entry.version === 1);
  if (sharedCase === undefined || sharedCase.routineEligible !== true || template?.kind !== "routine") {
    throw new Error("current validation catalog has no accepted routine shared-boundary template");
  }
  const issueByNumber = new Map(input.issues.map((issue) => [issue.number, issue]));
  const validation: Array<AcceptedAuthority<ValidationContract>> = [];
  const readiness: Array<AcceptedAuthority<DeliveryUnitReadiness>> = [];
  for (const unitId of roadmap.value.readyFrontier) {
    const unit = roadmap.value.deliveryUnits.find((candidate) => candidate.unitId === unitId);
    if (unit === undefined) throw new Error(`RoadmapPlan frontier names missing unit ${unitId}`);
    const members = unit.issueNumbers.map((number) => {
      const issue = issueByNumber.get(number);
      if (issue === undefined) throw new Error(`validation readiness cannot reread #${number}`);
      return issue;
    });
    const current = await readCurrentValidationContract(input.stateHome, input.app.name, unitId);
    const sameRoadmap =
      current !== undefined &&
      sameAuthority(current.value.roadmapRef, roadmap.ref) &&
      current.value.unitMembershipHash === unitMembershipHash(unit.issueNumbers);
    const accepted = sameRoadmap
      ? current
      : await acceptValidationContract({
          root: input.stateHome,
          contract: routineValidationContract({
            app: input.app.name,
            roadmapRef: roadmap.ref,
            catalog,
            unitId,
            issueNumbers: unit.issueNumbers,
            issues: members,
            affected: sharedCase.affected,
            caseId: sharedCase.canonicalId,
            detectorId: sharedCase.detectorId,
            previous: current,
            acceptedAt: input.acceptedAt,
          }),
        });
    validation.push(accepted);
    const routing: RoutingSnapshotEntry[] = members.map((issue) => ({
      issueNumber: issue.number,
      disposition: issue.labels.includes("routing:human-only") ? "human_only" : "automated",
      observedLabels: [...issue.labels],
    }));
    readiness.push(
      await acceptDeliveryUnitReadiness({
        root: input.stateHome,
        app: input.app.name,
        roadmapRef: roadmap.ref,
        expectedFrontierHash: stableHash(roadmap.value.readyFrontier),
        validationRef: accepted.ref,
        unitId,
        routing,
        readyAt: input.acceptedAt,
      }),
    );
  }
  return { validation, readiness };
}

function routineValidationContract(input: {
  app: string;
  roadmapRef: AuthorityRef;
  catalog: AcceptedAuthority<ValidationCatalog>;
  unitId: string;
  issueNumbers: number[];
  issues: GhIssue[];
  affected: ValidationAffectedStructure;
  caseId: string;
  detectorId: string;
  previous: AcceptedAuthority<ValidationContract> | undefined;
  acceptedAt: string;
}): ValidationContract {
  const criteria = unique(input.issues.flatMap((issue) => acceptanceCriteria(issue.body)));
  return {
    schemaVersion: 1,
    contractId: `validation-${input.unitId}`,
    version: (input.previous?.value.version ?? 0) + 1,
    predecessor: input.previous?.ref ?? null,
    app: input.app,
    catalogRef: input.catalog.ref,
    roadmapRef: input.roadmapRef,
    unitId: input.unitId,
    unitMembershipHash: unitMembershipHash(input.issueNumbers),
    templateRef: { templateId: "routine-v1", version: 1 },
    affected: structuredClone(input.affected),
    acceptanceCriteria:
      criteria.length > 0 ? criteria : [`Delivery unit ${input.unitId} satisfies its issue acceptance criteria.`],
    requiresHarnessRevision: false,
    harnessRevisionReason: null,
    sharedBoundaryDetectorRefs: input.affected.boundaryIds.includes("B-21")
      ? [{ boundaryId: "B-21", caseId: input.caseId, detectorId: input.detectorId }]
      : [],
    obligations: [
      {
        obligationId: `obligation-${stableHash({ unitId: input.unitId, caseId: input.caseId }).slice(0, 20)}`,
        caseId: input.caseId,
        covers: structuredClone(input.affected),
        cheapestFalsifyingLayer: "L2",
        failureCases: ["delivery evidence loses the accepted validation lineage"],
        detectorId: input.detectorId,
        negativeControlId: "seed-swap-boundary-lineage",
        expectedEvidence: ["exact accepted validation-contract ref and hash"],
        waiver: null,
      },
    ],
    requiredGates: ["pnpm-test", "pnpm-typecheck"],
    proposedAt: input.acceptedAt,
    acceptedAt: input.acceptedAt,
  };
}

async function ensureValidationCatalog(stateHome: string, app: string): Promise<AcceptedAuthority<ValidationCatalog>> {
  return (
    (await readCurrentValidationCatalog(stateHome, app)) ??
    acceptValidationCatalog({ root: stateHome, catalog: ratifiedRoadmapValidationCatalog(app) })
  );
}

function authorizedReadyIssueNumbers(
  transaction: PlannerPublicationTransaction,
  currentIssues: readonly GhIssue[],
): number[] {
  const fromApplication = new Set(
    transaction.evidence.readiness_application?.outcomes
      .filter((outcome) => outcome.disposition === "ready")
      .map((outcome) => outcome.issue_number) ?? [],
  );
  for (const intakeIssue of transaction.planner_input.intake.issues) {
    if (intakeIssue.labels.includes("op:ready") && plannerRoutineReadinessGuard(intakeIssue) === undefined)
      fromApplication.add(intakeIssue.number);
  }
  const current = new Map(currentIssues.map((issue) => [issue.number, issue]));
  return [...fromApplication]
    .filter((number) => current.get(number)?.labels.includes("op:ready") === true)
    .sort(numeric);
}

async function completeOpenBacklog(gh: Pick<GhOps, "listIssues">): Promise<GhIssue[]> {
  const issues = await gh.listIssues({ state: "open", limit: PLANNER_PUBLICATION_BACKLOG_LIMIT });
  if (issues.length >= PLANNER_PUBLICATION_BACKLOG_LIMIT) {
    throw new Error(`open backlog reached the ${PLANNER_PUBLICATION_BACKLOG_LIMIT - 1} issue completeness bound`);
  }
  return issues
    .filter((issue) => issue.state.toUpperCase() === "OPEN")
    .sort((left, right) => left.number - right.number);
}

const defaultPlannerPublicationGit: PlannerPublicationGit = {
  prepare: ({ worktree, branch, base, turnId }) => {
    const remoteRepository = git(worktree, "remote", "get-url", "origin");
    const baseCommit = git(worktree, "rev-parse", "--verify", base.ref);
    const initialHead = git(worktree, "rev-parse", "HEAD");
    const dirty = git(worktree, "status", "--porcelain=v1", "--untracked-files=all") !== "";
    const changed = dirty || initialHead !== baseCommit;
    if (!changed) {
      return {
        branchCreated: false,
        commit: initialHead,
        baseCommit,
        remoteRepository,
        changedPaths: [],
        protectedPaths: [],
        secretPatterns: [],
      };
    }
    const currentBranch = gitOptional(worktree, "symbolic-ref", "--quiet", "--short", "HEAD");
    if (currentBranch === null) {
      if (git(worktree, "branch", "--list", branch) === "") git(worktree, "branch", branch, "HEAD");
      git(worktree, "switch", branch);
    } else if (currentBranch !== branch) {
      if (git(worktree, "branch", "--list", branch) !== "") {
        throw new PermanentPlannerPublicationError(
          "error_planner_publication_local_branch_conflict",
          `isolated Planner worktree is on ${currentBranch} and ${branch} already exists`,
        );
      }
      git(worktree, "branch", "-m", branch);
    }
    if (dirty) {
      git(worktree, "add", "--all");
      if (git(worktree, "diff", "--cached", "--name-only") !== "") {
        git(worktree, "commit", "-m", `chore(planner): publish ${turnId}`);
      }
    }
    const commit = git(worktree, "rev-parse", "HEAD");
    const changedPaths = git(worktree, "diff", "--name-only", `${baseCommit}..${commit}`)
      .split("\n")
      .filter(Boolean)
      .sort();
    const patch = git(worktree, "diff", "--no-ext-diff", "--binary", `${baseCommit}..${commit}`);
    return {
      branchCreated: true,
      commit,
      baseCommit,
      remoteRepository,
      changedPaths,
      protectedPaths: changedPaths.filter(plannerPublicationProtectedSurface),
      secretPatterns: SECRET_PATTERNS.filter((candidate) => candidate.pattern.test(patch)).map(
        (candidate) => candidate.name,
      ),
    };
  },
  remoteCommit: (worktree, branch) => {
    const output = git(worktree, "ls-remote", "--heads", "origin", `refs/heads/${branch}`);
    if (output === "") return null;
    const rows = output.split("\n").filter(Boolean);
    if (rows.length !== 1) {
      throw new PermanentPlannerPublicationError(
        "error_planner_publication_remote_ambiguous",
        `remote returned ${rows.length} rows for refs/heads/${branch}`,
      );
    }
    return rows[0]!.split(/\s+/)[0] ?? null;
  },
  push: (worktree, branch, commit) => {
    git(
      worktree,
      "push",
      "--porcelain",
      "origin",
      `${commit}:refs/heads/${branch}`,
      `--force-with-lease=refs/heads/${branch}:`,
    );
  },
};

function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Cormidia Planner",
        GIT_AUTHOR_EMAIL: "planner@cormidia.local",
        GIT_COMMITTER_NAME: "Cormidia Planner",
        GIT_COMMITTER_EMAIL: "planner@cormidia.local",
        GIT_TERMINAL_PROMPT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    const message = stderr === "" ? (error instanceof Error ? error.message : String(error)) : stderr;
    if (
      /authentication failed|permission denied|repository not found|protected branch|remote rejected|access denied/i.test(
        message,
      )
    ) {
      throw new PermanentPlannerPublicationError("error_planner_publication_permanent_refusal", message);
    }
    throw new Error(message);
  }
}

function gitOptional(cwd: string, ...args: string[]): string | null {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
}

async function recordPublicationFailure(
  stateHome: string,
  transaction: PlannerPublicationTransaction,
  error: unknown,
  now: Date,
): Promise<PlannerPublicationTransaction> {
  if (error instanceof PermanentPlannerPublicationError) {
    return refuse(stateHome, transaction, error.code, error.message, now);
  }
  const pending: PlannerPublicationTransaction = {
    ...transaction,
    state: "publication_pending",
    error: publicationError(
      "error_planner_publication_retryable",
      error instanceof Error ? error.message : String(error),
      "retryable",
      now.toISOString(),
    ),
    updated_at: now.toISOString(),
  };
  await writePlannerPublication(stateHome, pending);
  return pending;
}

async function refuse(
  stateHome: string,
  transaction: PlannerPublicationTransaction,
  code: string,
  message: string,
  now: Date,
): Promise<PlannerPublicationTransaction> {
  const refused: PlannerPublicationTransaction = {
    ...transaction,
    state: "refused",
    error: publicationError(code, message, "permanent", now.toISOString()),
    updated_at: now.toISOString(),
  };
  await writePlannerPublication(stateHome, refused);
  return refused;
}

function publicationError(
  code: string,
  message: string,
  permanence: PlannerPublicationError["permanence"],
  observedAt: string,
): PlannerPublicationError {
  return { code, message: scrubSecrets(message), permanence, observed_at: observedAt };
}

function safeRemoteCommit(gitOps: PlannerPublicationGit, worktree: string, branch: string): string | null {
  try {
    return gitOps.remoteCommit(worktree, branch);
  } catch {
    return null;
  }
}

async function requiredPlannerPublication(
  stateHome: string,
  app: string,
  publicationId: string,
): Promise<PlannerPublicationTransaction> {
  const transaction = await readPlannerPublication(stateHome, app, publicationId);
  if (transaction === undefined) throw new Error(`planner publication ${publicationId} does not exist for ${app}`);
  return transaction;
}

async function writePlannerPublication(stateHome: string, transaction: PlannerPublicationTransaction): Promise<void> {
  const path = plannerPublicationPath(stateHome, transaction.app, transaction.publication_id);
  await mkdir(dirname(path), { recursive: true });
  await writeLoopFileAtomic(path, `${JSON.stringify(transaction, null, 2)}\n`);
}

function parsePlannerPublication(raw: string, path: string): PlannerPublicationTransaction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`planner publication ${path} is not valid JSON`);
  }
  if (!isPlannerPublication(parsed)) {
    const keys =
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.keys(parsed).sort().join(",")
        : typeof parsed;
    const failures = plannerPublicationValidationFailures(parsed);
    throw new Error(
      `planner publication ${path} is not a valid v1 transaction ` +
        `(keys: ${keys}; invalid: ${failures.join(",") || "top-level-shape"})`,
    );
  }
  return parsed;
}

function plannerPublicationValidationFailures(value: unknown): string[] {
  if (!isRecord(value)) return ["record"];
  const failures: string[] = [];
  const app = value["app"];
  const turnId = value["turn_id"];
  const plannerInput = value["planner_input"];
  const evidence = value["evidence"];
  const recovery = value["recovery"];
  if (
    !isNonemptyString(app) ||
    !isNonemptyString(turnId) ||
    value["publication_id"] !== plannerPublicationId(String(app), String(turnId))
  )
    failures.push("publication_id");
  if (!isRecord(plannerInput)) failures.push("planner_input.record");
  else {
    if (!isPlannerIssueIntake(plannerInput["intake"])) failures.push("planner_input.intake");
    if (!isPlannerDecisions(plannerInput["decisions"])) failures.push("planner_input.decisions");
  }
  if (!isPlannerEffects(value["intended_effects"])) failures.push("intended_effects");
  if (!isRecord(evidence)) failures.push("evidence.record");
  else {
    if (!isSha256(evidence["provider_output_sha256"])) failures.push("evidence.provider_hash");
    if (!isContentHash(evidence["intake_sha256"])) failures.push("evidence.intake_hash");
    if (!isAuthorityRefArray(evidence["validation_refs"])) failures.push("evidence.validation_refs");
    if (!isAuthorityRefArray(evidence["readiness_refs"])) failures.push("evidence.readiness_refs");
  }
  if (!isRecord(recovery) || !isNonemptyString(recovery["identity"]) || !isNonemptyString(recovery["command"]))
    failures.push("recovery");
  if (!isIsoDate(value["created_at"]) || !isIsoDate(value["updated_at"])) failures.push("timestamps");
  return failures;
}

function isPlannerPublication(value: unknown): value is PlannerPublicationTransaction {
  if (!isRecord(value)) return false;
  const row = value;
  const state = row["state"];
  const app = row["app"];
  const turnId = row["turn_id"];
  const repository = row["repository"];
  const branch = row["branch"];
  const commit = row["commit"];
  const base = row["base"];
  const plannerInput = row["planner_input"];
  const evidence = row["evidence"];
  const recovery = row["recovery"];
  const error = row["error"];
  if (
    row["schema_version"] !== 1 ||
    row["kind"] !== "planner-publication" ||
    !isOneOf(state, ["publication_pending", "published", "refused"]) ||
    !isNonemptyString(app) ||
    !isNonemptyString(turnId) ||
    !isNonemptyString(repository) ||
    !isNonemptyString(row["worktree_path"]) ||
    !isNonemptyString(branch) ||
    !isNonemptyString(commit) ||
    row["publication_id"] !== plannerPublicationId(app, turnId) ||
    typeof row["branch_created"] !== "boolean" ||
    !isStringArray(row["changed_paths"]) ||
    !isIsoDate(row["created_at"]) ||
    !isIsoDate(row["updated_at"]) ||
    !isRecord(base) ||
    !isNonemptyString(base["ref"]) ||
    !isNonemptyString(base["default_branch"]) ||
    !isNonemptyString(base["commit"]) ||
    !isRecord(plannerInput) ||
    !isPlannerIssueIntake(plannerInput["intake"]) ||
    !isPlannerDecisions(plannerInput["decisions"]) ||
    !isPlannerEffects(row["intended_effects"]) ||
    !isRecord(evidence) ||
    !isRecord(recovery)
  )
    return false;
  const expectedRecovery = plannerPublicationRecoveryIdentity({
    app,
    turnId,
    publicationId: row["publication_id"],
    repository,
    branch,
    commit,
    intakeSha256: plannerInput["intake"].manifest_sha256,
    decisionsSha256: stableHash(plannerInput["decisions"]),
    providerOutputSha256: isSha256(evidence["provider_output_sha256"]) ? evidence["provider_output_sha256"] : "invalid",
    intendedEffectsSha256: stableHash(row["intended_effects"]),
  });
  const expectedRecoveryCommand = plannerPublicationRecoveryCommand(app, row["publication_id"]);
  if (
    recovery["identity"] !== expectedRecovery ||
    recovery["command"] !== expectedRecoveryCommand ||
    plannerInput["intake"].app !== app ||
    plannerInput["intake"].turn_id !== turnId ||
    !isNonemptyString(evidence["episode_id"]) ||
    !isStringArray(evidence["provider_run_ids"]) ||
    !isSha256(evidence["provider_output_sha256"]) ||
    !isContentHash(evidence["intake_sha256"]) ||
    evidence["intake_sha256"] !== plannerInput["intake"].manifest_sha256 ||
    !(evidence["remote_commit"] === null || isNonemptyString(evidence["remote_commit"])) ||
    !(evidence["readiness_application"] === null || isPlannerReadinessApplication(evidence["readiness_application"])) ||
    (isPlannerReadinessApplication(evidence["readiness_application"]) &&
      evidence["readiness_application"].intake_sha256 !== plannerInput["intake"].manifest_sha256) ||
    !(evidence["roadmap_ref"] === null || isAuthorityRef(evidence["roadmap_ref"])) ||
    !isAuthorityRefArray(evidence["validation_refs"]) ||
    !isAuthorityRefArray(evidence["readiness_refs"])
  )
    return false;
  if (
    error !== null &&
    !(
      isRecord(error) &&
      isNonemptyString(error["code"]) &&
      isNonemptyString(error["message"]) &&
      isOneOf(error["permanence"], ["retryable", "permanent"]) &&
      isIsoDate(error["observed_at"])
    )
  )
    return false;
  if (state === "published") {
    if (error !== null || evidence["readiness_application"] === null || evidence["roadmap_ref"] === null) return false;
    if (row["branch_created"] === true && evidence["remote_commit"] !== commit) return false;
  }
  if (state === "refused" && (!isRecord(error) || error["permanence"] !== "permanent")) return false;
  if (state === "publication_pending" && isRecord(error) && error["permanence"] !== "retryable") return false;
  return true;
}

function isPlannerIssueIntake(value: unknown): value is PlannerIssueIntake {
  if (
    !(
      isRecord(value) &&
      value["schema_version"] === 1 &&
      value["kind"] === "planner-issue-intake" &&
      isNonemptyString(value["app"]) &&
      isNonemptyString(value["turn_id"]) &&
      isRecord(value["query"]) &&
      Number.isInteger(value["budget_bytes"]) &&
      Number.isInteger(value["included_bytes"]) &&
      Number.isInteger(value["deferred_count"]) &&
      Array.isArray(value["issues"]) &&
      value["issues"].every(
        (issue) =>
          isRecord(issue) &&
          Number.isInteger(issue["number"]) &&
          isNonemptyString(issue["title"]) &&
          typeof issue["body"] === "string" &&
          isStringArray(issue["labels"]) &&
          Number.isInteger(issue["source_bytes"]) &&
          Number.isInteger(issue["included_bytes"]) &&
          isOneOf(issue["inclusion"], ["full", "truncated"]),
      ) &&
      isRecord(value["diagnostic"]) &&
      isNonemptyString(value["diagnostic"]["code"]) &&
      typeof value["diagnostic"]["detail"] === "string" &&
      isContentHash(value["manifest_sha256"])
    )
  )
    return false;
  const { manifest_sha256: manifestSha256, ...withoutHash } = value;
  return schedulerSha256(schedulerCanonicalJson(withoutHash)) === manifestSha256;
}

function isPlannerDecisions(value: unknown): value is PlannerReadinessDecision[] {
  return (
    Array.isArray(value) &&
    value.every(
      (decision) =>
        isRecord(decision) &&
        Number.isInteger(decision["issue_number"]) &&
        isOneOf(decision["disposition"], ["ready", "unready"]) &&
        isNonemptyString(decision["reason_code"]) &&
        isNonemptyString(decision["reason"]),
    )
  );
}

function isPlannerReadinessApplication(value: unknown): value is PlannerReadinessApplication {
  return (
    isRecord(value) &&
    value["schema_version"] === 1 &&
    value["kind"] === "planner-readiness-application" &&
    isContentHash(value["intake_sha256"]) &&
    Array.isArray(value["applied_issue_numbers"]) &&
    value["applied_issue_numbers"].every((number) => Number.isInteger(number)) &&
    Array.isArray(value["outcomes"]) &&
    value["outcomes"].every(
      (outcome) =>
        isRecord(outcome) &&
        Number.isInteger(outcome["issue_number"]) &&
        isOneOf(outcome["disposition"], ["ready", "unready"]) &&
        isOneOf(outcome["requested_disposition"], ["ready", "unready"]) &&
        isNonemptyString(outcome["reason_code"]) &&
        isNonemptyString(outcome["reason"]),
    )
  );
}

function isPlannerEffects(value: unknown): value is PlannerPublicationTransaction["intended_effects"] {
  return (
    Array.isArray(value) &&
    value.every((effect) => {
      if (
        !(
          isRecord(effect) &&
          isOneOf(effect["kind"], ["git_branch", "planner_readiness", "roadmap_plan", "validation_readiness"]) &&
          isNonemptyString(effect["identity"]) &&
          isRecord(effect["detail"])
        )
      )
        return false;
      const detail = effect["detail"];
      if (effect["kind"] === "git_branch") {
        return (
          isNonemptyString(detail["branch"]) &&
          isNonemptyString(detail["commit"]) &&
          isStringArray(detail["changed_paths"])
        );
      }
      if (effect["kind"] === "planner_readiness") {
        return (
          Array.isArray(detail["issue_numbers"]) && detail["issue_numbers"].every((number) => Number.isInteger(number))
        );
      }
      if (effect["kind"] === "roadmap_plan") {
        return (
          isNonemptyString(detail["source"]) &&
          (detail["predecessor"] === null || isAuthorityRef(detail["predecessor"]))
        );
      }
      return detail["template"] === "routine-v1" && detail["after"] === "roadmap_plan";
    })
  );
}

function isAuthorityRef(value: unknown): value is AuthorityRef {
  return (
    isRecord(value) &&
    isNonemptyString(value["kind"]) &&
    isNonemptyString(value["id"]) &&
    Number.isInteger(value["version"]) &&
    isSha256(value["sha256"])
  );
}

function isAuthorityRefArray(value: unknown): value is AuthorityRef[] {
  return Array.isArray(value) && value.every(isAuthorityRef);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isContentHash(value: unknown): value is string {
  return isSha256(value) || (typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value));
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function plannerPublicationRoot(stateHome: string): string {
  return join(stateHome, "planning", "publications");
}

function withPlannerPublicationLock<T>(
  stateHome: string,
  app: string,
  publicationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = join(plannerPublicationRoot(stateHome), hashedFileStem(app), `${publicationId}.lock`);
  return withFileLock(
    lockPath,
    {
      staleMs: 10 * 60_000,
      maxWaitMs: 30_000,
      retryMinMs: 20,
      retryMaxMs: 60,
    },
    fn,
  );
}

function assertResumeIdentity(transaction: PlannerPublicationTransaction, input: PreparePlannerPublicationInput): void {
  if (
    transaction.app !== input.app.name ||
    transaction.repository !== input.app.repo ||
    transaction.turn_id !== input.turnId ||
    transaction.worktree_path !== input.worktree ||
    transaction.branch !== input.branch ||
    transaction.planner_input.intake.manifest_sha256 !== input.intake.manifest_sha256 ||
    stableHash(transaction.planner_input.decisions) !== stableHash(input.decisions) ||
    transaction.evidence.provider_output_sha256 !== stableHash(input.providerOutput)
  ) {
    throw new PermanentPlannerPublicationError(
      "error_planner_publication_identity_conflict",
      `publication ${transaction.publication_id} does not match the requested recovery identity`,
    );
  }
}

function plannerPublicationRecoveryIdentity(input: {
  app: string;
  turnId: string;
  publicationId: string;
  repository: string;
  branch: string;
  commit: string;
  intakeSha256: string;
  decisionsSha256: string;
  providerOutputSha256: string;
  intendedEffectsSha256: string;
}): string {
  return stableHash({ kind: "planner-publication-recovery", ...input });
}

function plannerPublicationRoadmapSource(publicationId: string): string {
  return `planner-publication:${publicationId}:complete-open-backlog`;
}

function plannerPublicationRoadmapEffect(transaction: PlannerPublicationTransaction): {
  source: string;
  predecessor: AuthorityRef | null;
} {
  const effect = transaction.intended_effects.find((candidate) => candidate.kind === "roadmap_plan");
  if (
    effect === undefined ||
    !isNonemptyString(effect.detail["source"]) ||
    !(effect.detail["predecessor"] === null || isAuthorityRef(effect.detail["predecessor"]))
  ) {
    throw new PermanentPlannerPublicationError(
      "error_planner_publication_intent_invalid",
      `publication ${transaction.publication_id} has no valid RoadmapPlan effect`,
    );
  }
  return { source: effect.detail["source"], predecessor: effect.detail["predecessor"] };
}

async function roadmapHasSource(
  stateHome: string,
  app: string,
  roadmap: AcceptedAuthority<import("./roadmap-delivery.js").RoadmapPlan>,
  source: string,
): Promise<boolean> {
  const snapshot = await readBacklogSnapshotAuthority(stateHome, app, roadmap.value.backlogSnapshotRef);
  return snapshot.value.source === source;
}

function sameOptionalAuthority(left: AuthorityRef | null, right: AuthorityRef | null): boolean {
  if (left === null || right === null) return left === right;
  return sameAuthority(left, right);
}

function plannerPublicationRecoveryCommand(app: string, publicationId: string): string {
  return `cormidia publication resume --app ${shellQuote(app)} --id ${shellQuote(publicationId)}`;
}

function executionGroup(body: string): string | undefined {
  const value = /^Execution group:\s*(\S(?:.*\S)?)\s*$/im.exec(body)?.[1]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function tierFor(issue: GhIssue): "op:tier-quick" | "op:tier-standard" | "op:tier-deep" {
  return (
    issue.labels.find((label): label is "op:tier-quick" | "op:tier-standard" | "op:tier-deep" =>
      ["op:tier-quick", "op:tier-standard", "op:tier-deep"].includes(label),
    ) ?? "op:tier-standard"
  );
}

function priorityFor(issue: GhIssue): "p1" | "p2" | "p3" {
  return issue.labels.find((label): label is "p1" | "p2" | "p3" => ["p1", "p2", "p3"].includes(label)) ?? "p2";
}

function section(body: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|$)`, "im").exec(body);
  const value = match?.[1]?.trim();
  return value === "" ? undefined : value;
}

function acceptanceCriteria(body: string): string[] {
  const source = section(body, "Acceptance criteria") ?? "";
  return unique([...source.matchAll(/^\s*-\s+\[[ xX]\]\s+(.+\S)\s*$/gm)].map((match) => match[1]!.trim()));
}

function fileScope(body: string): string[] {
  const source = section(body, "Scope") ?? "";
  const entries = unique(
    [...source.matchAll(/^\s*-\s+(.+\S)\s*$/gm)].map((match) => match[1]!.replace(/^`|`$/g, "").trim()),
  );
  return entries.length > 0 ? entries : ["."];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function plannerPublicationProtectedSurface(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  const basename = normalized.split("/").at(-1) ?? normalized;
  if (
    [
      "taste.md",
      "roles.yaml",
      "agents.md",
      "purpose.md",
      "pipelines.yaml",
      "apps.yaml",
      "authority.md",
      "policy.yaml",
    ].includes(basename)
  )
    return true;
  if (normalized === ".cormidia/config.yaml") return true;
  return (
    normalized.startsWith("prompts/") ||
    normalized.includes("/prompts/") ||
    normalized.startsWith("taste/") ||
    normalized.includes("/taste/")
  );
}

function sameAuthority(left: AuthorityRef, right: AuthorityRef): boolean {
  return (
    left.kind === right.kind && left.id === right.id && left.version === right.version && left.sha256 === right.sha256
  );
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizeRepository(value: string): string {
  const trimmed = value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  const github = /^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)?([^/:\s]+\/[^/\s]+)$/i.exec(
    trimmed,
  )?.[1];
  return github === undefined ? trimmed : `github:${github.toLowerCase()}`;
}

function numeric(left: number, right: number): number {
  return left - right;
}
