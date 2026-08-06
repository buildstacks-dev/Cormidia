// Loop v1 ticket state machine (M5): one GitHub issue flows from op:ready
// toward a squash-merged PR, with real quality gates between phases.
//
// This module stays provider-blind. Builder/Reviewer model turns arrive via
// the pipeline executor in M6; M5 proves the GitHub/gate/state-machine shell
// that those turns plug into.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { preflightGitWorktreeIndex, type GitIndexPreflightResult } from "../runtime/git-worktree-sandbox.js";
import type { GateResultEntry } from "../runtime/runlog/envelope.js";
import { scrubSecrets } from "../runtime/runlog/redact.js";
import type { BaseRevision } from "./default-branch.js";
import { stableHash } from "./episode-plan.js";
import {
  recordExecutionBoundary,
  stopExecutionJournal,
  type ExecutionBoundary,
  type JournalStopKind,
} from "./execution-journal.js";
import type { GhIssue, GhOps, GhPullRequest, GhReview } from "./github.js";
import { isMergeConflict, verifiedSelfApprovalMarker } from "./github.js";
import { issueContentHash } from "./issue-snapshot.js";
import { openPhaseRun, type LoopRunlog, type PhaseRun } from "./loop-runlog.js";
import {
  AUTONOMOUS_EXECUTION_EXCLUSION_LABEL,
  autonomousExecutionExclusionLabel,
  MANUAL_REVIEW_EXCLUSION_LABEL,
  parseReleaseKind,
  parseReleaseVersion,
  releaseTagFor,
  resolveReleaseCommand,
  STATE_LABELS,
} from "./plan-tickets.js";
import type { Policy, RiskTier } from "./policy.js";
import { resolveTier } from "./policy.js";
import {
  runGates,
  runSetupGate,
  type AcceptanceCriterion,
  type CompletenessFinding,
  type CriterionTestMap,
  type GateCommands,
  type GateResult,
  type GateRunResult,
  type ProcessGateOpts,
  type ReviewFreshnessState,
} from "./qgates.js";
import { parseDependsOn } from "./scheduling.js";
import type {
  LoopDeliveryUnit,
  LoopItem,
  LoopPhase,
  ReleaseConfig,
  ScorecardEvent,
  SuppressedOperation,
  TicketTier,
} from "./types.js";
import {
  parseVerdict,
  parseVerdictEither,
  type BuildVerdict,
  type ContractVerdict,
  type Finding,
  type ReviewVerdict,
} from "./verdicts.js";
export type { LoopItem, LoopPhase, ScorecardEvent, TicketTier } from "./types.js";

interface ClaimTicketOptions {
  gh: GhOps;
  targetRepo: string;
  localRepo: string;
  worktreeRoot: string;
  /** Resolved base the ticket branch is cut from. Required, and deliberately
   *  never defaulted: cutting from a guessed `main` in a repo whose default is
   *  `master` fails inside git with an unreadable error *after* the ticket has
   *  already been relabelled `op:building`, stranding it (#101). */
  base: BaseRevision;
  /** Fault-boundary hook used by the claim saga after the external label
   * transition but before worktree creation. */
  afterLabelTransition?: () => void | Promise<void>;
}

export class LoopPhaseTransitionError extends Error {
  readonly code = "error_illegal_loop_phase_transition";

  constructor(operation: string, phase: LoopPhase, expected: readonly LoopPhase[]) {
    super(`error_illegal_loop_phase_transition: ${operation} requires ${expected.join("|")}, received ${phase}`);
    this.name = "LoopPhaseTransitionError";
  }
}

type AutonomousRoutingErrorCode =
  | "autonomous_routing_human_only"
  | "autonomous_manual_review"
  | "autonomous_routing_state_unreadable";

/** Typed fail-closed refusal shared by the live driver and the atomic claim
 * seam. It is intentionally not a phase-transition error: the ticket may be
 * perfectly op:ready while still being ineligible for autonomous execution. */
export class AutonomousRoutingExclusionError extends Error {
  constructor(
    readonly code: AutonomousRoutingErrorCode,
    readonly issueNumber: number,
    message: string,
  ) {
    super(`${code}: #${issueNumber} ${message}`);
    this.name = "AutonomousRoutingExclusionError";
  }
}

/** Re-read GitHub immediately before autonomous work. A list/read snapshot is
 * not authority because a human may add the routing label after readiness. */
export async function readAutonomousClaimIssue(
  issue: Pick<GhIssue, "number">,
  gh: Pick<GhOps, "readIssue">,
): Promise<GhIssue> {
  let observed: GhIssue;
  try {
    observed = await gh.readIssue(issue.number);
  } catch (error) {
    throw new AutonomousRoutingExclusionError(
      "autonomous_routing_state_unreadable",
      issue.number,
      `label state is unreadable; refusing autonomous claim (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const exclusion = autonomousExecutionExclusionLabel(observed.labels);
  if (exclusion !== undefined) {
    throw new AutonomousRoutingExclusionError(
      exclusion === AUTONOMOUS_EXECUTION_EXCLUSION_LABEL ? "autonomous_routing_human_only" : "autonomous_manual_review",
      issue.number,
      exclusion === MANUAL_REVIEW_EXCLUSION_LABEL
        ? `carries ${exclusion}; only a human may remove this review hold`
        : `carries ${exclusion}; only a human-routed coding agent may deliver this PR scope`,
    );
  }
  return observed;
}

function requireLoopPhase(operation: string, item: Pick<LoopItem, "phase">, expected: readonly LoopPhase[]): void {
  if (!expected.includes(item.phase)) {
    throw new LoopPhaseTransitionError(operation, item.phase, expected);
  }
}

interface GatePhaseOptions {
  gh: GhOps;
  policy: Policy;
  commands: GateCommands;
  criteria: readonly AcceptanceCriterion[];
  criterionTests: CriterionTestMap;
  findings?: readonly CompletenessFinding[];
  process?: ProcessGateOpts;
  /** Resolved base every gate diff compares against, and the branch a pull
   *  request is opened into. Required so a missed call site is a compile
   *  error rather than a silent diff against the wrong tree (#101). */
  base: BaseRevision;
  headRef?: string;
  reviewState?: ReviewFreshnessState;
  /** Test/M5 harness hook: performs the bounded fix pass before gates retry. */
  remediate?: (item: LoopItem, result: GateRunResult) => LoopItem | void | Promise<LoopItem | void>;
  prDraft?: boolean;
  /** When present, the gate phase gets its own run record: `gate.started/
   *  passed/failed` + `ticket.transition` events and `envelope.gate_results`
   *  (docs/loop/design.md §9). Absent → no run record, identical behavior. */
  runlog?: LoopRunlog;
  /** Ticket execution journal prepared by the driver. Pure state-machine
   * callers omit it and retain the same provider-free behavior. */
  journal?: ExecutionJournalTarget;
  /** Route-owned repair cap. The policy cap remains an upper bound. */
  maxRemediationAttempts?: number;
}

interface ExecutionJournalTarget {
  root: string;
  episodeId: string;
  clock?: () => Date;
}

interface ReviewPhaseOptions {
  gh: GhOps;
  maxCycles?: number;
  /** Merge-authorization policy. Without it, a real GitHub APPROVE is accepted
   *  as today (independence still enforced by the cross-provider reviewer), but
   *  the single-account self-approval fallback is never trusted (fail closed). */
  authorization?: ReviewAuthorization;
  journal?: ExecutionJournalTarget;
}

/** Who may authorize a merge. Guards against (a) an arbitrary/self-authored
 *  GitHub APPROVE and (b) a forged self-approval marker. */
export interface ReviewAuthorization {
  /** Operator secret (never repo-visible; not readable by the sandboxed agent).
   *  The self-approval fallback marker must carry a valid HMAC over the PR
   *  number computed with this secret. When unset, marker self-approval is not
   *  trusted at all. */
  selfApprovalSecret?: string;
  /** GitHub login of the PR/commit author (the builder). A real APPROVE from
   *  this identity is not an independent review and is ignored. */
  builderIdentity?: string;
  /** When set, only APPROVED reviews whose author is in this allowlist
   *  authorize a merge — any other identity's APPROVE is ignored. */
  reviewerIdentities?: readonly string[];
}

interface ShippingPhaseOptions extends GatePhaseOptions {
  localRepo: string;
  gateRunner?: (item: LoopItem, stage: "entry" | "pre-merge") => Promise<GateRunResult>;
  /** The app's declared release mechanism (`release:` in `.cormidia/config.yaml`
   *  / apps.yaml), when it declares one. advanceShipping enforces P7 against
   *  it: a milestone whose ticket declares `Release-kind: deploy|package`
   *  with no matching declared mechanism is unfinished, mechanically. */
  release?: ReleaseConfig;
}

const DEFAULT_MAX_REVIEW_CYCLES = 3;

export function itemFromIssue(issue: GhIssue, targetRepo: string): LoopItem {
  return {
    issueNumber: issue.number,
    ticketRef: `#${issue.number}`,
    title: issue.title,
    body: issue.body,
    targetRepo,
    labels: [...issue.labels],
    phase: phaseFromLabels(issue.labels),
    tier: tierFromLabels(issue.labels),
    cycles: 0,
    remediationAttempts: 0,
    gateResults: [],
    findings: [],
  };
}

export function branchNameForIssue(issue: Pick<GhIssue, "number" | "title">): string {
  return `op/${issue.number}-${slugify(issue.title)}`;
}

export function branchNameForDeliveryUnit(
  unit: Pick<LoopDeliveryUnit, "unitId" | "membershipHash" | "members">,
): string {
  const first = unit.members[0];
  if (first === undefined) throw new Error(`delivery unit ${unit.unitId} has no members`);
  if (unit.members.length === 1 && unit.unitId === `ticket-${first.issueNumber}`) {
    return branchNameForIssue({ number: first.issueNumber, title: first.title });
  }
  return `op/unit-${slugify(unit.unitId)}-${unit.membershipHash.slice(0, 12)}`;
}

export async function claimTicket(issue: GhIssue, options: ClaimTicketOptions): Promise<LoopItem> {
  return claimDeliveryUnitIssues([issue], {
    ...options,
    unit: {
      unitId: `ticket-${issue.number}`,
      membershipHash: stableHash([issue.number]),
      members: [issueMember(issue)],
    },
  });
}

/** All-member external projection with compensating rollback. */
export async function claimDeliveryUnitIssues(
  issues: readonly GhIssue[],
  options: ClaimTicketOptions & { unit: LoopDeliveryUnit },
): Promise<LoopItem> {
  if (issues.length === 0) throw new Error(`delivery unit ${options.unit.unitId} has no issues`);
  const expected = options.unit.members.map((member) => member.issueNumber);
  if (stableHash(expected) !== options.unit.membershipHash) {
    throw new Error(`delivery unit ${options.unit.unitId} membership hash is invalid`);
  }
  if (new Set(expected).size !== expected.length) {
    throw new Error(`delivery unit ${options.unit.unitId} contains duplicate members`);
  }
  const supplied = new Map(issues.map((candidate) => [candidate.number, candidate]));
  if (expected.some((number) => !supplied.has(number)) || supplied.size !== expected.length) {
    throw new Error(`delivery unit ${options.unit.unitId} issue set differs from its authority`);
  }
  const observed: GhIssue[] = [];
  for (const number of expected) {
    const current = await readAutonomousClaimIssue(supplied.get(number)!, options.gh);
    const authority = options.unit.members.find((member) => member.issueNumber === number)!;
    if (issueContentHash(current) !== authority.contentHash) {
      throw new Error(`delivery unit ${options.unit.unitId} member #${number} changed after admission`);
    }
    const states = current.labels.filter((label) => (STATE_LABELS as readonly string[]).includes(label));
    if (states.length !== 1 || states[0] !== "op:ready") {
      throw new LoopPhaseTransitionError(`claimDeliveryUnit(${options.unit.unitId})`, phaseFromLabels(current.labels), [
        "ready",
      ]);
    }
    observed.push(current);
  }
  const primary = observed[0]!;
  const item: LoopItem = {
    ...itemFromIssue(primary, options.targetRepo),
    deliveryUnit: structuredClone(options.unit),
  };
  const branch = branchNameForDeliveryUnit(options.unit);
  const transitioned: number[] = [];
  try {
    for (const member of observed) {
      await options.gh.swapLabel(member.number, "op:ready", "op:building");
      transitioned.push(member.number);
    }
    await options.afterLabelTransition?.();
    for (const member of observed) {
      const current = await readAutonomousClaimIssue(member, options.gh);
      if (!current.labels.includes("op:building")) {
        throw new Error(`delivery unit member #${member.number} lost op:building during claim`);
      }
    }
  } catch (error) {
    const rollback = await rollbackLabels(options.gh, transitioned, "op:building", "op:ready");
    if (rollback.length > 0) {
      throw new Error(
        `delivery unit ${options.unit.unitId} claim failed and rollback was incomplete: ${rollback.join("; ")}`,
        { cause: error },
      );
    }
    throw error;
  }
  let worktree: string;
  try {
    worktree = createWorktree(options.localRepo, options.worktreeRoot, branch, options.base.ref);
  } catch (error) {
    const rollback = await rollbackLabels(options.gh, transitioned, "op:building", "op:ready");
    if (rollback.length > 0) {
      throw new Error(
        `delivery unit ${options.unit.unitId} worktree creation failed and rollback was incomplete: ${rollback.join("; ")}`,
        { cause: error },
      );
    }
    throw error;
  }

  return {
    ...item,
    labels: replaceLabel(item.labels, "op:ready", "op:building"),
    phase: "building",
    branch,
    worktree,
  };
}

function issueMember(issue: GhIssue): LoopDeliveryUnit["members"][number] {
  return {
    issueNumber: issue.number,
    ticketRef: `#${issue.number}`,
    contentHash: issueContentHash(issue),
    title: issue.title,
    body: issue.body,
    labels: [...issue.labels],
  };
}

export async function swapDeliveryUnitLabel(item: LoopItem, gh: GhOps, from: string, to: string): Promise<void> {
  const transitioned: number[] = [];
  try {
    for (const issueNumber of deliveryUnitIssueNumbers(item)) {
      await gh.swapLabel(issueNumber, from, to);
      transitioned.push(issueNumber);
    }
    if (item.deliveryUnit !== undefined) {
      for (const member of item.deliveryUnit.members) {
        member.labels = replaceLabel(member.labels, from, to);
      }
    }
  } catch (error) {
    const rollback = await rollbackLabels(gh, transitioned, to, from);
    if (rollback.length > 0) {
      throw new Error(
        `delivery-unit label transaction ${from}->${to} failed and rollback was incomplete: ${rollback.join("; ")}`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function rollbackLabels(gh: GhOps, issueNumbers: readonly number[], from: string, to: string): Promise<string[]> {
  const failures: string[] = [];
  for (const issueNumber of [...issueNumbers].reverse()) {
    try {
      await gh.swapLabel(issueNumber, from, to);
    } catch (error) {
      failures.push(`#${issueNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

export function deliveryUnitIssueNumbers(item: LoopItem): number[] {
  return item.deliveryUnit?.members.map((member) => member.issueNumber) ?? [item.issueNumber];
}

export async function advanceGates(item: LoopItem, options: GatePhaseOptions): Promise<LoopItem> {
  requireLoopPhase("advanceGates", item, ["building", "gates"]);
  const worktree = requireField(item, "worktree");
  const branch = requireField(item, "branch");
  let current = { ...item, phase: "gates" as LoopPhase };
  const gateResults = [...current.gateResults];
  const rec = options.runlog !== undefined ? await openPhaseRun(options.runlog, "gates", "quality-gates") : undefined;
  // Identity of the previous attempt's failure, for no-progress detection
  // (ISSUE-029). Undefined on the first pass through the loop.
  let previousFailureIdentity: string | undefined;

  while (true) {
    if (rec !== undefined)
      await rec.events.append({ type: "gate.started", detail: { attempt: current.remediationAttempts } });
    const result = await runGateSet(current, options, previousFailureIdentity);
    previousFailureIdentity = result.remediation.failureIdentity;
    gateResults.push(result);
    await recordGateResult(rec, result);

    if (result.status === "pass") {
      pushBranch(worktree, branch);
      await journalBoundary(options.journal, "push", {
        branch,
        head: headSha(worktree),
      });
      await journalBoundary(options.journal, "gates", result);
      const pr = await ensurePr({ ...current, gateResults }, options.gh, options.prDraft === true, options.base);
      await journalBoundary(options.journal, "pr", {
        number: pr.number,
        head: headSha(worktree),
      });
      await swapDeliveryUnitLabel(current, options.gh, "op:building", "op:in-review");
      await rec?.transition("op:building", "op:in-review");
      await rec?.finalize("completed");
      return {
        ...current,
        labels: replaceLabel(current.labels, "op:building", "op:in-review"),
        phase: "reviewing",
        gateResults,
        prNumber: pr.number,
      };
    }

    const repairCap = Math.min(
      options.policy.remediation.maxAttempts,
      options.maxRemediationAttempts ?? options.policy.remediation.maxAttempts,
    );
    if (result.remediation.canRetry && current.remediationAttempts < repairCap) {
      const remediated = await options.remediate?.(current, result);
      current = {
        ...(remediated ?? current),
        remediationAttempts: current.remediationAttempts + 1,
        gateResults,
      };
      if (current.phase === "returned") {
        await rec?.finalize("blocked");
        return current;
      }
      continue;
    }

    // ISSUE-029: an attempt that reproduced the previous attempt's error
    // *exactly* made no progress, and the attempts still on the clock would only
    // reproduce it again. Escalate now, with the real cause, instead of paying
    // for the repetition. `remediation.noProgress` already cleared `canRetry`,
    // so this only changes what the operator is told and what is journalled.
    const noProgress = result.remediation.noProgress;
    const reason = noProgress
      ? `no progress: attempt ${current.remediationAttempts} failed with the identical error as the ` +
        "attempt before it, so the remaining repair attempts were not spent"
      : "quality gates exhausted";
    const comment = blockedWithEvidenceComment(reason, result);
    await options.gh.commentIssue(current.issueNumber, comment);
    const fromLabel = stateLabelForPhase(current.phase);
    await swapDeliveryUnitLabel(current, options.gh, fromLabel, "op:returned");
    await rec?.transition(fromLabel, "op:returned");
    await rec?.finalize("blocked");
    await journalStop(
      options.journal,
      "cap_stop",
      noProgress
        ? `quality-gate repair made no progress at attempt ${current.remediationAttempts}: identical failure identity ${result.remediation.failureIdentity?.slice(0, 12)}`
        : `quality-gate repair cap exhausted at ${current.remediationAttempts}`,
    );
    return {
      ...current,
      labels: replaceLabel(current.labels, fromLabel, "op:returned"),
      phase: "returned",
      gateResults,
    };
  }
}

interface ProvisionSetupOptions {
  gh: GhOps;
  commands: GateCommands;
  process?: ProcessGateOpts;
  /** Test seam for the cheap, source-preserving linked-worktree index probe. */
  indexPreflight?: (worktree: string) => GitIndexPreflightResult;
  /** When present, the provision-setup step gets its own run record so its
   *  `gate.started/passed/failed` events and `envelope.gate_results` land in
   *  events.jsonl BEFORE the first implement pass (docs/loop/design.md §5, §9). Absent
   *  → no run record, identical behavior. */
  runlog?: LoopRunlog;
}

/** Run the app's `setup` gate in the freshly provisioned worktree, BEFORE the
 *  first implement pass (L1-02 / L-003, docs/loop/design.md §5). `createWorktree`
 *  provisions an empty tree with no installed dependencies, and the builder's
 *  mandatory "baseline before changes — if red, stop" check runs at the very
 *  start of the implement pass. Without deps that baseline fails for every
 *  greenfield ticket regardless of ticket quality, so the dependency install
 *  has to happen here, at provision, not only in the post-implement gates
 *  runner (`runGates` keeps its own setup re-run — this is the earlier run a
 *  fresh worktree needs).
 *
 *  An unconfigured `setup_command` is a clean absence (`runSetupGate` returns
 *  undefined): no dependency step, no run record, nothing reported — identical
 *  to today. A setup FAILURE is surfaced loudly, mirroring `advanceGates`: a
 *  blocked-with-evidence comment plus an `op:returned` transition, and no
 *  implement pass runs. It is never a silent proceed into a doomed baseline. */
export async function advanceProvisionSetup(item: LoopItem, options: ProvisionSetupOptions): Promise<LoopItem> {
  const worktree = requireField(item, "worktree");
  const indexPreflight = (options.indexPreflight ?? preflightGitWorktreeIndex)(worktree);
  if (indexPreflight.status === "fail") {
    const fromLabel = stateLabelForPhase(item.phase);
    const rec =
      options.runlog !== undefined ? await openPhaseRun(options.runlog, "provision", "git-index-preflight") : undefined;
    await rec?.events.append({
      type: "gate.failed",
      severity: "error",
      detail: {
        gate: "git-index-preflight",
        ...(indexPreflight.errorCode === undefined ? {} : { errorCode: indexPreflight.errorCode }),
        detail: indexPreflight.detail,
        worktree,
        ...(indexPreflight.gitDir === undefined ? {} : { gitDir: indexPreflight.gitDir }),
        ...(indexPreflight.indexPath === undefined ? {} : { indexPath: indexPreflight.indexPath }),
      },
    });
    await options.gh.commentIssue(item.issueNumber, provisionGitIndexFailedComment(worktree, indexPreflight));
    await swapDeliveryUnitLabel(item, options.gh, fromLabel, "op:returned");
    await rec?.transition(fromLabel, "op:returned");
    await rec?.finalize("blocked");
    return {
      ...item,
      labels: replaceLabel(item.labels, fromLabel, "op:returned"),
      phase: "returned",
    };
  }
  const setupResult = await runSetupGate(worktree, options.commands, options.process);
  if (setupResult === undefined) return item;

  const rec = options.runlog !== undefined ? await openPhaseRun(options.runlog, "provision", "setup") : undefined;
  if (rec !== undefined) {
    await rec.events.append({ type: "gate.started", detail: { gate: "setup", provision: true } });
    if (setupResult.status === "fail") {
      await rec.events.append({
        type: "gate.failed",
        severity: "error",
        detail: {
          gate: setupResult.gate,
          detail: setupResult.detail,
          ...(setupResult.command !== undefined ? { command: setupResult.command } : {}),
          ...(setupResult.outputTail !== undefined ? { outputTail: boundTail(setupResult.outputTail) } : {}),
        },
      });
    } else {
      await rec.events.append({
        type: "gate.passed",
        detail: { gate: setupResult.gate, detail: setupResult.detail },
      });
    }
    await rec.setGateResults([toGateResultEntry(setupResult)]);
  }

  if (setupResult.status !== "fail") {
    await rec?.finalize("completed");
    return item;
  }

  const fromLabel = stateLabelForPhase(item.phase);
  await options.gh.commentIssue(item.issueNumber, provisionSetupFailedComment(setupResult));
  await swapDeliveryUnitLabel(item, options.gh, fromLabel, "op:returned");
  await rec?.transition(fromLabel, "op:returned");
  await rec?.finalize("blocked");
  return {
    ...item,
    labels: replaceLabel(item.labels, fromLabel, "op:returned"),
    phase: "returned",
  };
}

function provisionGitIndexFailedComment(worktree: string, result: GitIndexPreflightResult): string {
  return [
    "## Blocked with evidence — Git index is unwritable at worktree provision",
    "",
    `**Error code:** \`${result.errorCode ?? "error_git_index_unwritable"}\``,
    "",
    result.detail,
    "",
    "**Result:**",
    "The ticket was returned before any implementation provider turn started, so no",
    "paid builder work was stranded. Cormidia did not stage, commit, reset, or remove",
    "the checkout.",
    "",
    "**Recovery:**",
    `Prepared work remains at \`${worktree}\`. Restore write access to the resolved`,
    "Git administrative index, then re-arm this exact ticket; do not delete the",
    "worktree while it contains uncommitted work.",
    "",
  ].join("\n");
}

/** Provision-time setup failure evidence for the returned ticket — the same
 *  "loud, verbatim, no rediscovery" discipline as the gate-failure comment
 *  (Stage 3): the operator sees the exact command and its output tail. */
function provisionSetupFailedComment(result: GateResult): string {
  const tail = result.outputTail ?? result.failures?.join("\n") ?? "";
  // ISSUE-029: a tool that left an unresolved placeholder or a duplicated
  // mapping key in the tree is not a bad `setup_command` — the command may be
  // perfect and still be unrunnable. Saying "fix setup_command" there sends the
  // reader to the wrong file; the per-artifact remedy above names the right one.
  const unresolvedArtifact = result.cause === "unresolved-setup-artifact";
  return [
    "## Blocked with evidence — setup failed at worktree provision",
    "",
    "**Error:**",
    `### ${result.gate}`,
    result.detail,
    ...(result.command !== undefined ? ["", `$ ${result.command}`] : []),
    ...(tail !== "" ? ["", tail] : []),
    "",
    "**Result:**",
    ...(unresolvedArtifact
      ? [
          "A tool left the worktree in a state it cannot itself repair, so setup",
          "could not run and no implementation pass started — no build turn was",
          "spent. Every later invocation of that tool fails at parse time, including",
          "the ones that would fix the file.",
          "",
          "**Assessment:**",
          "Apply the remedy named above against the exact file named above, then",
          "re-arm the ticket. Do not add a second block answering the placeholder —",
          "that is what produced the duplicate key.",
        ]
      : [
          "The app's `setup_command` (dependency install) failed in the fresh worktree",
          "before any implementation pass ran — no build turn was spent. The builder's",
          "baseline check could only fail for lack of dependencies.",
          "",
          "**Assessment:**",
          "Fix `setup_command` in `.cormidia/config.yaml` (or the environment it needs)",
          "and re-arm the ticket.",
        ]),
    "",
  ].join("\n");
}

/** Emit per-gate `gate.passed`/`gate.failed` events and set the run record's
 *  `gate_results` from one gate-set outcome (§9). A `skip` is carried in
 *  gate_results only — the taxonomy has no `gate.skipped`. */
async function recordGateResult(rec: PhaseRun | undefined, result: GateRunResult): Promise<void> {
  if (rec === undefined) return;
  for (const gate of result.results) {
    if (gate.status === "pass") {
      await rec.events.append({ type: "gate.passed", detail: { gate: gate.gate, detail: gate.detail } });
    } else if (gate.status === "fail") {
      // Retain the exact command and a bounded output tail in the durable
      // record: "setup failed (exit 1)" alone forced a costly model turn to
      // rediscover the cause in the 2026-07-10 episode (Stage 3). The event
      // writer scrubs detail strings; the tail is already size-bounded.
      await rec.events.append({
        type: "gate.failed",
        severity: "error",
        detail: {
          gate: gate.gate,
          detail: gate.detail,
          ...(gate.command !== undefined ? { command: gate.command } : {}),
          ...(gate.outputTail !== undefined ? { outputTail: boundTail(gate.outputTail) } : {}),
        },
      });
    }
  }
  await rec.setGateResults(result.results.map(toGateResultEntry));
}

const GATE_TAIL_EVENT_BOUND = 2_000;

function boundTail(tail: string): string {
  return tail.length <= GATE_TAIL_EVENT_BOUND ? tail : `…${tail.slice(-GATE_TAIL_EVENT_BOUND)}`;
}

function toGateResultEntry(gate: GateResult): GateResultEntry {
  const status = gate.status === "pass" ? "passed" : gate.status === "fail" ? "failed" : "skipped";
  // Envelopes are L1 (export-eligible): every executed command and its bounded
  // tail ride along, scrubbed. Failures remain remediation input; successful
  // output is durable PR-delivery evidence.
  const parts = [gate.detail];
  if (gate.command !== undefined) parts.push(`$ ${gate.command}`);
  if (gate.outputTail !== undefined) parts.push(boundTail(gate.outputTail));
  return { gate: gate.gate, status, detail: scrubSecrets(parts.join("\n")) };
}

export async function advanceReviewing(item: LoopItem, options: ReviewPhaseOptions): Promise<LoopItem> {
  requireLoopPhase("advanceReviewing", item, ["reviewing"]);
  const prNumber = requireField(item, "prNumber");
  const reviews = await options.gh.listReviews(prNumber);
  const latest = latestActionableReview(reviews, prNumber, options.authorization);
  if (latest === undefined) {
    return stalledReviewing(item, options, "no actionable review is posted on the PR");
  }

  if (latest.state === "CHANGES_REQUESTED") {
    const parsed = parseVerdict("review", latest.body);
    // A human (or any reviewer that isn't the orchestrator's machine-rendered
    // grammar) can Request changes with plain prose. Do not crash the tick and
    // strand the ticket in op:in-review re-crashing forever: treat an
    // unparseable body as "changes requested with no structured findings" and
    // bounce to building with the prose captured as a single finding. The cycle
    // still counts, so the loop stays bounded and terminates in op:returned
    // (loud, never silent, never unbounded — docs/loop/design.md §6/§7).
    const findings = parsed.ok ? parsed.verdict.findings : [unstructuredReviewFinding(latest.body)];
    const cycles = item.cycles + 1;
    if (cycles > (options.maxCycles ?? DEFAULT_MAX_REVIEW_CYCLES)) {
      await options.gh.commentIssue(item.issueNumber, returnedFindingsComment(cycles, findings));
      await swapDeliveryUnitLabel(item, options.gh, "op:in-review", "op:returned");
      return {
        ...item,
        cycles,
        findings,
        labels: replaceLabel(item.labels, "op:in-review", "op:returned"),
        phase: "returned",
      };
    }
    await swapDeliveryUnitLabel(item, options.gh, "op:in-review", "op:building");
    return {
      ...item,
      cycles,
      findings,
      labels: replaceLabel(item.labels, "op:in-review", "op:building"),
      phase: "building",
    };
  }

  if (latest.state === "APPROVED") {
    const head = headSha(requireField(item, "worktree"));
    // Freshness gate: never merge on an approval that doesn't match the exact
    // reviewed commit. But do NOT return the item unchanged — that leaves the
    // phase "reviewing" and the driver re-runs the whole (token-spending)
    // review pipeline until its phase guard throws and orphans the ticket.
    // Count it as a cycle so the stall is bounded and terminates in op:returned.
    if (latest.commitId !== head) {
      return stalledReviewing(
        item,
        options,
        "the latest approval does not match the current reviewed commit (stale approval)",
      );
    }
    await journalBoundary(options.journal, "approvals", {
      submittedAt: latest.submittedAt ?? null,
      reviewer: latest.author,
      commitId: latest.commitId,
      state: latest.state,
    });
    return {
      ...item,
      approvedCommitId: latest.commitId,
      phase: "shipping",
    };
  }

  return stalledReviewing(item, options, `review state ${latest.state} is not actionable`);
}

/** A reviewing tick that made no forward progress — no actionable review yet,
 *  an APPROVE that doesn't match the reviewed commit, or an unexpected review
 *  state. Count it against the review-cycle cap so the phase is bounded: after
 *  maxCycles it routes to op:returned for human triage instead of the driver
 *  re-running the review pipeline until its phase guard throws (the same
 *  bounding discipline advanceReviewing's CHANGES_REQUESTED path and
 *  advanceGates already use). The freshness property is untouched — a stale
 *  approval still never merges; it just stops spinning. */
async function stalledReviewing(item: LoopItem, options: ReviewPhaseOptions, reason: string): Promise<LoopItem> {
  const cycles = item.cycles + 1;
  if (cycles > (options.maxCycles ?? DEFAULT_MAX_REVIEW_CYCLES)) {
    await options.gh.commentIssue(item.issueNumber, reviewStalledComment(cycles, reason));
    await swapDeliveryUnitLabel(item, options.gh, "op:in-review", "op:returned");
    return {
      ...item,
      cycles,
      labels: replaceLabel(item.labels, "op:in-review", "op:returned"),
      phase: "returned",
    };
  }
  return { ...item, cycles };
}

export async function advanceShipping(item: LoopItem, options: ShippingPhaseOptions): Promise<LoopItem> {
  requireLoopPhase("advanceShipping", item, ["shipping"]);
  const branch = requireField(item, "branch");
  const worktree = requireField(item, "worktree");
  const prNumber = requireField(item, "prNumber");
  const gateResults = [...item.gateResults];

  // P7 (docs/approvals/design.md A4): a milestone whose plan
  // declared a deploy/package disposition may not merge unless the app
  // declares a matching mechanism — "deployable but unowned" is unfinished,
  // mechanically. Checked before any merge side effect; routed to the
  // Planner/human (op:returned), not to the Builder — no code change can
  // declare a release mechanism.
  const requiredKind = parseReleaseKind(item.body);
  if (requiredKind !== undefined && requiredKind !== "merge-only") {
    const declared = options.release;
    const problem =
      declared === undefined
        ? `the app declares no release mechanism (no \`release:\` block in .cormidia/config.yaml)`
        : declared.kind !== requiredKind
          ? `the app declares \`release.kind: ${declared.kind}\`, not \`${requiredKind}\``
          : declared.trigger === "tag"
            ? parseReleaseVersion(item.body) === undefined
              ? "the milestone declares no valid `Release-version` for the app's tag release"
              : undefined
            : declared.command === undefined
              ? `the app's \`release:\` block has no command`
              : undefined;
    if (problem !== undefined) {
      await options.gh.commentIssue(
        item.issueNumber,
        [
          "## Release disposition unowned (P7)",
          "",
          `This milestone's plan declares \`Release-kind: ${requiredKind}\`, but ${problem}.`,
          "A deployable milestone with no owned mechanism is not done: declare the mechanism in",
          "the app's `.cormidia/config.yaml` `release:` block (kind, owner, and a command for",
          "`trigger: command`) or, for `trigger: tag`, a `Release-version` on the milestone —",
          "or re-plan the milestone as merge-only. The PR is left open; no merge was attempted.",
        ].join("\n"),
      );
      await swapDeliveryUnitLabel(item, options.gh, "op:in-review", "op:returned");
      return {
        ...item,
        labels: replaceLabel(item.labels, "op:in-review", "op:returned"),
        phase: "returned",
        gateResults,
      };
    }
  }
  const runGate =
    options.gateRunner ??
    ((target: LoopItem) =>
      runGateSet(target, {
        ...options,
        reviewState: {
          approvedCommitId: requireField(target, "approvedCommitId"),
          headCommitId: headSha(worktree),
        },
      }));

  for (const stage of ["entry", "pre-merge"] as const) {
    const result = await runGate(item, stage);
    gateResults.push(result);
    if (result.status !== "pass") {
      return { ...item, phase: "building", gateResults };
    }
  }

  let mergedPullRequest;
  try {
    mergedPullRequest = await options.gh.squashMerge(prNumber, {
      subject: squashSubject(item),
      body: deliveryUnitIssueNumbers(item)
        .map((number) => `Closes #${number}`)
        .join("\n"),
      ...(item.approvedCommitId !== undefined ? { matchHeadCommit: item.approvedCommitId } : {}),
    });
    await journalBoundary(options.journal, "merge", {
      prNumber,
      approvedCommitId: item.approvedCommitId ?? null,
      method: "squash",
    });
  } catch (error) {
    if (!isMergeConflict(error)) throw error;
    return {
      ...item,
      phase: "building",
      gateResults,
      rebaseNote:
        "Squash merge conflicted after another branch moved main. Rebase this branch on main, " +
        "resolve conflicts, then rerun gates and review freshness.",
    };
  }

  await options.gh.deleteBranch(branch);
  for (const issueNumber of deliveryUnitIssueNumbers(item)) {
    await options.gh.removeLabel(issueNumber, "op:in-review");
  }
  // Render done-ness: the merged ticket's acceptance boxes end checked, and
  // the orchestrator is the only party the design allows to write them
  // (criteria are never Builder-edited; publication renders them unchecked).
  for (const member of item.deliveryUnit?.members ?? [
    {
      issueNumber: item.issueNumber,
      body: item.body,
    },
  ]) {
    const checkedBody = checkAcceptanceBoxes(member.body);
    if (checkedBody !== member.body) {
      await options.gh.updateIssueBody(member.issueNumber, checkedBody);
    }
  }
  removeWorktree(options.localRepo, worktree);

  const scorecardEvents: ScorecardEvent[] =
    item.turnId === undefined
      ? []
      : [{ type: "review_cycles", turnId: item.turnId, ticketRef: item.ticketRef, value: item.cycles }];

  // The P7 check above guarantees a declared mechanism with a command exists
  // whenever the milestone requires one; hand the org layer the data it
  // needs to queue the release as a critical op (the loop layer never
  // touches the approval store — one-way imports).
  const releaseCommand =
    requiredKind !== undefined && requiredKind !== "merge-only" && options.release !== undefined
      ? resolveReleaseCommand(options.release, item.body)
      : undefined;
  const releaseTrigger =
    releaseCommand !== undefined && requiredKind !== undefined && options.release !== undefined
      ? {
          kind: requiredKind,
          command: releaseCommand,
          owner: options.release.owner,
          ...(options.release.trigger === "tag"
            ? {
                tag: releaseTagFor(parseReleaseVersion(item.body)!),
                ...(mergedPullRequest.mergeCommitOid === undefined
                  ? {}
                  : { releaseCommit: mergedPullRequest.mergeCommitOid }),
              }
            : {}),
        }
      : undefined;
  await journalBoundary(options.journal, "release", {
    disposition: releaseTrigger === undefined ? "merge-only" : "queued-for-scoped-approval",
    kind: releaseTrigger?.kind ?? "merge-only",
    owner: releaseTrigger?.owner ?? null,
    commandHash:
      releaseTrigger === undefined ? null : createHash("sha256").update(releaseTrigger.command).digest("hex"),
  });

  return {
    ...item,
    labels: item.labels.filter((label) => label !== "op:in-review"),
    phase: "merged",
    gateResults,
    scorecardEvents,
    ...(releaseTrigger !== undefined ? { releaseTrigger } : {}),
  };
}

/** Crash recovery for the narrow window after GitHub has durably merged the
 * PR but before the caller persisted its outer EpisodePlan step. It performs
 * only the idempotent post-merge tail; the caller must first prove the PR is
 * already `MERGED`. No gate, review, provider, or second merge is attempted. */
export async function recoverAlreadyMergedTicket(
  item: LoopItem,
  options: Pick<ShippingPhaseOptions, "gh" | "localRepo" | "release">,
): Promise<LoopItem> {
  const branch = requireField(item, "branch");
  try {
    await options.gh.deleteBranch(branch);
  } catch (error) {
    // Remote deletion is idempotent: an already-absent branch is success. A
    // transport/auth failure remains loud rather than being misreported as a
    // completed cleanup.
    if (
      !/not found|does not exist|no matching ref|reference does not exist/i.test(
        error instanceof Error ? error.message : String(error),
      )
    )
      throw error;
  }
  for (const issueNumber of deliveryUnitIssueNumbers(item)) {
    const issue = await options.gh.readIssue(issueNumber);
    if (issue.labels.includes("op:in-review")) {
      await options.gh.removeLabel(issueNumber, "op:in-review");
    }
    const checkedBody = checkAcceptanceBoxes(issue.body);
    if (checkedBody !== issue.body) await options.gh.updateIssueBody(issueNumber, checkedBody);
  }
  if (item.worktree !== undefined && existsSync(item.worktree)) {
    removeWorktree(options.localRepo, item.worktree);
  }
  const requiredKind = parseReleaseKind(item.body);
  const mergedPullRequest = await options.gh.readPR(requireField(item, "prNumber"));
  const releaseCommand =
    requiredKind !== undefined && requiredKind !== "merge-only" && options.release?.kind === requiredKind
      ? resolveReleaseCommand(options.release, item.body)
      : undefined;
  const releaseTrigger =
    releaseCommand !== undefined && requiredKind !== undefined && options.release !== undefined
      ? {
          kind: requiredKind,
          command: releaseCommand,
          owner: options.release.owner,
          ...(options.release.trigger === "tag"
            ? {
                tag: releaseTagFor(parseReleaseVersion(item.body)!),
                ...(mergedPullRequest.mergeCommitOid === undefined
                  ? {}
                  : { releaseCommit: mergedPullRequest.mergeCommitOid }),
              }
            : {}),
        }
      : undefined;
  return {
    ...item,
    labels: item.labels.filter((label) => label !== "op:in-review"),
    phase: "merged",
    ...(releaseTrigger === undefined ? {} : { releaseTrigger }),
  };
}

/** L-007 / L1-04: orchestrator-owned dependency re-arm. When a predecessor
 *  ticket merges, promote every dependency-locked backlog ticket whose
 *  dependencies are now all satisfied to `op:ready` — with no manual label edit
 *  and no reliance on the prompt-advisory Planner "groom" pass (which the live
 *  campaign confirmed unenforced, leaving 10/17 tickets never claimed).
 *
 *  A *dependent* is a still-open issue that carries a `Depends-on: #<merged>`
 *  reference and no op-state label yet — published stateless precisely because
 *  it had unmet dependencies (`publishTickets`: `op:ready` only on
 *  dependency-free tickets). A dependency is *satisfied* when it is the ticket
 *  we just merged (named explicitly, so a not-yet-propagated GitHub auto-close
 *  cannot hide it) or is no longer open (a merge closes the issue via
 *  `Closes #N`); a still-open dependency keeps the dependent blocked. This
 *  mirrors `selectReadyTickets`, which admits a ready ticket only once every
 *  dependency has merged. Returns the issue numbers armed, for the tick log. */
export async function rearmDependents(gh: GhOps, mergedIssueNumber: number): Promise<number[]> {
  const open = await gh.listIssues({ state: "open" });
  const openNumbers = new Set(open.map((issue) => issue.number));
  const stateLabels = STATE_LABELS as readonly string[];
  const armed: number[] = [];
  for (const issue of open) {
    if (issue.number === mergedIssueNumber) continue;
    // Only arm the stateless backlog: a ticket already claimed, in review,
    // returned, or blocked has an owner and must not be relabeled.
    if (issue.labels.some((label) => stateLabels.includes(label))) continue;
    const deps = parseDependsOn(issue.body);
    if (!deps.includes(mergedIssueNumber)) continue;
    const unblocked = deps.every((dep) => dep === mergedIssueNumber || !openNumbers.has(dep));
    if (!unblocked) continue;
    await gh.addLabel(issue.number, "op:ready");
    await gh.commentIssue(
      issue.number,
      `## Dependencies satisfied — armed \`op:ready\`\n\n` +
        `Predecessor #${mergedIssueNumber} merged and every \`Depends-on:\` reference is now ` +
        `resolved, so this ticket is armed for the build loop to claim. No manual label edit was ` +
        `needed — the merge transition owns this re-arm (L-007).`,
    );
    armed.push(issue.number);
  }
  return armed;
}

export function parseAcceptanceCriteria(body: string): AcceptanceCriterion[] {
  const section = headingSection(body, "Acceptance criteria");
  if (section === undefined) return [];
  const criteria: AcceptanceCriterion[] = [];
  for (const line of section.split("\n")) {
    const match = /^\s*[-*]\s+\[( |x|X)\]\s+(.+?)\s*$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    criteria.push({
      id: `AC${criteria.length + 1}`,
      checked: match[1].toLowerCase() === "x",
      text: match[2],
    });
  }
  return criteria;
}

/** Check every `- [ ]` box inside the "## Acceptance criteria" section —
 *  the orchestrator's merge-time rendering of done-ness (advanceShipping).
 *  Lines outside that section are untouched; no section → body unchanged. */
export function checkAcceptanceBoxes(body: string): string {
  const heading = /^##\s+Acceptance criteria\s*$/im.exec(body);
  if (!heading) return body;
  const start = heading.index + heading[0].length;
  const rest = body.slice(start);
  const next = /^##\s+/m.exec(rest);
  const end = next ? start + next.index : body.length;
  const section = body.slice(start, end).replace(/^(\s*[-*]\s+)\[ \]/gm, "$1[x]");
  return body.slice(0, start) + section + body.slice(end);
}

export function criterionTestMapFromContract(verdict: ContractVerdict): CriterionTestMap {
  const map: CriterionTestMap = {};
  for (const entry of verdict.tests) map[entry.criterionId] = [...entry.tests];
  return map;
}

/** Recover the typed mapping from a durable rendered contract comment. An
 * old/malformed comment yields an empty map so completeness fails closed. */
export function criterionTestMapFromContractText(contract: string | undefined): CriterionTestMap {
  if (contract === undefined) return {};
  const parsed = parseVerdictEither("contract", contract);
  return parsed.ok ? criterionTestMapFromContract(parsed.verdict) : {};
}

/** Stable orchestrator rendering reused by the EpisodePlan ticket adapter.
 * Keeping this in the loop layer ensures legacy pipeline and plan-DAG
 * execution publish the same durable contract grammar. */
export function renderContractComment(verdict: ContractVerdict): string {
  return [
    "## Implementation contract",
    "",
    "**Files:**",
    ...verdict.files.map((file) => `- ${file}`),
    "",
    "**Approach:**",
    verdict.approach,
    "",
    "**Tests:**",
    ...verdict.tests.map((entry) => `- ${entry.criterionId} -> ${entry.tests.join("; ")}`),
    "",
    "**Risks:**",
    verdict.risks,
    "",
    "**Complexity:**",
    verdict.complexity,
    "",
  ].join("\n");
}

/** Stable blocked-evidence rendering shared by both ticket executors. */
export function renderBuildBlockedComment(verdict: BuildVerdict): string {
  const entry = verdict.blockedEntry;
  if (entry === undefined) {
    return [
      "## Blocked with evidence",
      "",
      "**Error:**",
      "Builder reported blocked without a structured blocked entry.",
      "",
      "**Attempted:**",
      "See the builder pass run log.",
      "",
      "**Result:**",
      "Returned to Planner because implementation cannot proceed.",
      "",
      "**Assessment:**",
      "The ticket needs Planner rework before another build pass.",
      "",
    ].join("\n");
  }
  return [
    "## Blocked with evidence",
    "",
    "**Error:**",
    entry.error,
    "",
    "**Attempted:**",
    entry.attempted,
    "",
    "**Result:**",
    entry.result,
    "",
    "**Assessment:**",
    entry.assessment,
    "",
  ].join("\n");
}

/** Stable review rendering shared by both ticket executors. */
export function renderReviewBody(
  entries: readonly { pass: string; verdict: ReviewVerdict }[],
  suppressed: readonly SuppressedOperation[] = [],
): string {
  const findings = entries.flatMap((entry) => entry.verdict.findings);
  const notReviewed = entries.flatMap((entry) =>
    entry.verdict.review.notReviewed.map((scope) => `${entry.pass}: ${scope}`),
  );
  const lines = [
    `Verdict: ${findings.length === 0 ? "approve" : "findings"}`,
    "",
    "Passes:",
    ...entries.map((entry) => `- ${entry.pass}: ${entry.verdict.verdict}`),
    ...(findings.length === 0 ? [] : ["", "Findings:", ...findings.map(findingLine)]),
    "",
    "## Review rationale",
    ...entries.map((entry) => `- ${entry.pass}: ${entry.verdict.review.rationale}`),
    "",
    "## Evidence",
    ...entries.flatMap((entry) =>
      entry.verdict.review.evidence.map((evidence) => `- [${entry.pass}] ${evidence.claim} => ${evidence.evidence}`),
    ),
    "",
    "## Not reviewed",
    ...(notReviewed.length === 0 ? ["- None."] : notReviewed.map((scope) => `- ${scope}`)),
    "",
    ...renderSuppressedOperations(suppressed),
  ];
  return lines.join("\n");
}

/** #244: every verdict states what the turn ASKED FOR and did not get.
 *
 *  The section is unconditional. A turn that suppressed nothing renders an
 *  explicit "None recorded." — the absence of the heading would be
 *  indistinguishable from an older verdict that never checked, which is the
 *  exact ambiguity the issue exists to remove. It is a record, not a gate:
 *  whether a verdict may still PASS with evidence missing is #234's decision. */
export function renderSuppressedOperations(suppressed: readonly SuppressedOperation[]): string[] {
  return [
    "## Suppressed critical operations",
    ...(suppressed.length === 0
      ? ["- None recorded."]
      : suppressed.map(
          (record) =>
            `- ${record.rule} (${record.disposition}) \`${record.tool}\` ` +
            `action=${record.actionSha256.slice(0, 12)} approval=${record.approvalId}` +
            `${record.reason === undefined ? "" : ` — ${record.reason}`}`,
        )),
  ];
}

function findingLine(finding: Finding): string {
  return `- ${finding.category}/${finding.severity} ${finding.location} -- ${finding.description} -> ${finding.action}`;
}

async function runGateSet(
  item: LoopItem,
  options: GatePhaseOptions,
  previousFailureIdentity?: string,
): Promise<GateRunResult> {
  const worktree = requireField(item, "worktree");
  const baseRef = options.base.ref;
  const headRef = options.headRef ?? "HEAD";
  const changedFiles = gitLines(worktree, "diff", "--name-only", baseRef, headRef);
  const riskTier: RiskTier = resolveTier(options.policy, changedFiles);
  const head = headSha(worktree);
  const reviewState = options.reviewState ?? { approvedCommitId: head, headCommitId: head };

  const result = await runGates(riskTier, worktree, options.criteria, options.findings ?? [], reviewState, {
    policy: options.policy,
    commands: options.commands,
    criterionTests: options.criterionTests,
    currentAttempt: item.remediationAttempts,
    ...(previousFailureIdentity !== undefined ? { previousFailureIdentity } : {}),
    ...(options.process !== undefined ? { process: options.process } : {}),
    diff: { baseRef, headRef },
  });
  return { ...result, headCommitId: head };
}

/** Open (or recover) the ticket's pull request. The base is the *resolved*
 *  default branch: opening against a hardcoded `main` in a `master` repo is
 *  rejected by GitHub after the branch has already been pushed (#101). */
async function ensurePr(item: LoopItem, gh: GhOps, draft: boolean, base: BaseRevision): Promise<GhPullRequest> {
  const branch = requireField(item, "branch");
  const evidence = renderPrGateEvidence(item);
  const localHead = headSha(requireField(item, "worktree"));
  if (evidence?.headCommitId !== undefined && evidence.headCommitId !== localHead) {
    throw new Error(
      `refusing to publish gate evidence for ${evidence.headCommitId}: ` + `worktree HEAD is ${localHead}`,
    );
  }
  const existing = await gh.listPRsForBranch(branch, { state: "all" });
  if (existing.length > 0) {
    const pr = existing[0]!;
    if (evidence?.headCommitId !== undefined && evidence.headCommitId !== pr.headRefOid) {
      throw new Error(
        `refusing to publish gate evidence for ${evidence.headCommitId}: ` +
          `PR #${pr.number} head is ${pr.headRefOid ?? "unresolved"}`,
      );
    }
    const body = upsertPrGateEvidence(pr.body, item);
    if (body !== pr.body) {
      await gh.updatePullRequestBody(pr.number, body);
      return gh.readPR(pr.number);
    }
    return pr;
  }
  const created = await gh.createPR({
    head: branch,
    base: base.defaultBranch,
    title: prTitle(item),
    body: prBody(item),
    draft,
  });
  if (evidence?.headCommitId !== undefined && created.headRefOid !== evidence.headCommitId) {
    throw new Error(
      `PR #${created.number} was created at ${created.headRefOid ?? "an unresolved head"}, ` +
        `expected gated revision ${evidence.headCommitId}`,
    );
  }
  return created;
}

function prTitle(item: LoopItem): string {
  if (item.deliveryUnit !== undefined && item.deliveryUnit.members.length > 1) {
    return `build: ${item.deliveryUnit.unitId} (${item.deliveryUnit.members.length} tickets)`;
  }
  return `build: ${item.title} (${item.ticketRef})`;
}

function prBody(item: LoopItem): string {
  const evidence = renderPrGateEvidence(item);
  const members = item.deliveryUnit?.members ?? [
    {
      issueNumber: item.issueNumber,
      ticketRef: item.ticketRef,
      title: item.title,
      body: item.body,
      labels: item.labels,
    },
  ];
  const implementationLines =
    members.length === 1
      ? [`Implements ${members[0]!.ticketRef}: ${members[0]!.title}`]
      : members.map((member) => `- Implements ${member.ticketRef}: ${member.title}`);
  return [
    "## What",
    ...implementationLines,
    "",
    "## Why",
    firstParagraph(headingSection(item.body, "Goal") ?? item.body),
    "",
    "## Evidence",
    evidence?.body ?? "- Quality gates passed before review.",
    "",
    ...deliveryUnitClosingReferences(item),
    "",
  ].join("\n");
}

export function deliveryUnitClosingReferences(item: LoopItem): string[] {
  return (item.deliveryUnit?.members ?? [{ ticketRef: item.ticketRef }]).map((member) => `Closes ${member.ticketRef}`);
}

const PR_GATE_EVIDENCE_START = "<!-- cormidia:gate-evidence:start -->";
const PR_GATE_EVIDENCE_END = "<!-- cormidia:gate-evidence:end -->";
const PR_GATE_EVIDENCE_OUTPUT_BOUND = 8_000;

interface RenderedPrGateEvidence {
  body: string;
  headCommitId?: string;
  artifactReferences: string[];
}

/** Deterministic, content-addressed delivery evidence for the latest green
 * gate run. The PR owns this managed block: repairing it changes no source,
 * branch head, gate result, or review judgment. */
function renderPrGateEvidence(item: LoopItem): RenderedPrGateEvidence | undefined {
  const latestGreen = [...item.gateResults].reverse().find((run) => run.status === "pass");
  const executed =
    latestGreen?.results.filter(
      (gate) => gate.status === "pass" && gate.command !== undefined && gate.exitCode !== undefined,
    ) ?? [];
  if (executed.length === 0) return undefined;

  const artifactReferences: string[] = [];
  const sections = executed.flatMap((gate) => {
    const command = scrubSecrets(gate.command!);
    const rawOutput = gate.outputTail ?? "";
    const bounded =
      rawOutput.length <= PR_GATE_EVIDENCE_OUTPUT_BOUND
        ? { output: rawOutput, truncated: false }
        : {
            output: rawOutput.slice(-PR_GATE_EVIDENCE_OUTPUT_BOUND),
            truncated: true,
          };
    const output = scrubSecrets(bounded.output);
    const artifactContent = [
      latestGreen?.headCommitId ?? "unresolved",
      gate.gate,
      command,
      String(gate.exitCode),
      output,
    ].join("\0");
    const digest = createHash("sha256").update(artifactContent).digest("hex");
    const artifact = `cormidia-pr-gate-evidence:${gate.gate}:sha256:${digest}`;
    artifactReferences.push(artifact);
    return [
      `### ${gate.gate}`,
      "",
      "**Command**",
      fencedCode("sh", command),
      "",
      `**Exit status:** \`${gate.exitCode}\``,
      "",
      `**Captured output:** bounded verbatim ${bounded.truncated ? "tail" : "capture"}`,
      fencedCode("text", output === "" ? "(command produced no output)" : output),
      "",
      `**Artifact:** \`${artifact}\``,
      "",
    ];
  });

  return {
    body: [
      PR_GATE_EVIDENCE_START,
      "The following content-addressed evidence was captured by the gate runner; secrets are redacted before publication.",
      ...(latestGreen?.headCommitId === undefined ? [] : ["", `**Revision:** \`${latestGreen.headCommitId}\``]),
      "",
      ...sections,
      PR_GATE_EVIDENCE_END,
    ].join("\n"),
    ...(latestGreen?.headCommitId === undefined ? {} : { headCommitId: latestGreen.headCommitId }),
    artifactReferences,
  };
}

function fencedCode(language: string, text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function upsertPrGateEvidence(body: string, item: LoopItem): string {
  const evidence = renderPrGateEvidence(item);
  if (evidence === undefined) return body;
  const start = body.indexOf(PR_GATE_EVIDENCE_START);
  const end = body.indexOf(PR_GATE_EVIDENCE_END);
  if (start >= 0 && end >= start) {
    return [body.slice(0, start), evidence.body, body.slice(end + PR_GATE_EVIDENCE_END.length)].join("");
  }

  const legacy = "## Evidence\n- Quality gates passed before review.";
  if (body.includes(legacy)) {
    return body.replace(legacy, `## Evidence\n${evidence.body}`);
  }

  const evidenceHeading = /^## Evidence\s*$/m.exec(body);
  if (evidenceHeading?.index !== undefined) {
    const insertAt = evidenceHeading.index + evidenceHeading[0].length;
    return [body.slice(0, insertAt), `\n${evidence.body}`, body.slice(insertAt)].join("");
  }

  const closes = /^Closes\s+#\d+\s*$/m.exec(body);
  if (closes?.index !== undefined) {
    return [body.slice(0, closes.index), `## Evidence\n${evidence.body}\n\n`, body.slice(closes.index)].join("");
  }
  return `${body.replace(/\s*$/, "")}\n\n## Evidence\n${evidence.body}\n`;
}

interface PrGateEvidenceRepair {
  repaired: boolean;
  satisfied: boolean;
  headRefOid?: string;
  artifactReferences: string[];
}

/** Repair an absent/stale managed PR evidence block from already-persisted
 * green gate results. This never executes a command or changes the PR head. */
export async function repairPrGateEvidence(item: LoopItem, gh: GhOps): Promise<PrGateEvidenceRepair> {
  const rendered = renderPrGateEvidence(item);
  if (rendered === undefined || item.prNumber === undefined) {
    return { repaired: false, satisfied: false, artifactReferences: [] };
  }
  const before = await gh.readPR(item.prNumber);
  if (
    rendered.headCommitId === undefined ||
    before.headRefOid === undefined ||
    rendered.headCommitId !== before.headRefOid
  ) {
    return {
      repaired: false,
      satisfied: false,
      ...(before.headRefOid !== undefined ? { headRefOid: before.headRefOid } : {}),
      artifactReferences: rendered.artifactReferences,
    };
  }
  const body = upsertPrGateEvidence(before.body, item);
  if (body !== before.body) await gh.updatePullRequestBody(before.number, body);
  const after = body === before.body ? before : await gh.readPR(before.number);
  if (after.headRefOid !== before.headRefOid) {
    throw new Error(
      `PR #${before.number} head changed while repairing gate evidence: ` +
        `${before.headRefOid ?? "unresolved"} -> ${after.headRefOid ?? "unresolved"}`,
    );
  }
  return {
    repaired: body !== before.body,
    satisfied: after.body.includes(PR_GATE_EVIDENCE_START) && after.body.includes(PR_GATE_EVIDENCE_END),
    ...(after.headRefOid !== undefined ? { headRefOid: after.headRefOid } : {}),
    artifactReferences: rendered.artifactReferences,
  };
}

/** Narrow classifier for a review finding whose only remedy is attaching
 * already-captured green command output to the PR description. Any source,
 * test, or rerun request stays on the ordinary provider-planned revision path. */
export function isPrGateEvidenceOnlyFinding(finding: Finding): boolean {
  const location = finding.location.toLowerCase();
  const description = finding.description.toLowerCase();
  const action = finding.action.toLowerCase();
  const all = `${location} ${description} ${action}`;
  const prSurface = /\b(?:pr|pull request)\b/.test(location) && /\b(?:body|description|comment)\b/.test(location);
  const missing = /\b(?:missing|omits?|omitted|lacks?|absent|not included|does not include)\b/.test(description);
  const evidenceAction =
    /\b(?:paste|include|attach|add|provide)\b/.test(action) &&
    /\b(?:output|evidence|result|results|log|logs)\b/.test(action) &&
    /\b(?:gate|test|tests|lint|command|commands|ci)\b/.test(all);
  const asksForExecutionOrSourceChange =
    /\b(?:rerun|re-run|run again|source|implementation|code change|modify code|add test|fix test)\b/.test(
      `${description} ${action}`,
    ) || /\bsrc\//.test(all);
  return prSurface && missing && evidenceAction && !asksForExecutionOrSourceChange;
}

function blockedWithEvidenceComment(reason: string, result: GateRunResult): string {
  const failing = result.results.filter((gate) => gate.status === "fail");
  const output = failing
    .map((gate) => {
      const tail = gate.outputTail ?? gate.failures?.join("\n") ?? gate.detail;
      return `### ${gate.gate}\n${gate.detail}\n\n${tail}`;
    })
    .join("\n\n");
  return [
    "## Blocked with evidence",
    "",
    "**Error:**",
    output,
    "",
    "**Attempted:**",
    `${result.remediation.currentAttempt} of ${result.remediation.maxAttempts} bounded remediation attempt(s).`,
    "",
    "**Result:**",
    reason,
    "",
    "**Assessment:**",
    "The ticket needs Planner rework before the loop should spend more build turns.",
    "",
  ].join("\n");
}

function reviewStalledComment(cycles: number, reason: string): string {
  return [
    "## Returned — review did not converge",
    "",
    `The reviewing phase made no mergeable progress after ${cycles} cycles: ${reason}.`,
    "Returned for human triage rather than re-running the review indefinitely. A",
    "stale approval is never merged — the reviewed commit must match the branch head.",
    "",
  ].join("\n");
}

function returnedFindingsComment(cycles: number, findings: readonly Finding[]): string {
  const list = findings
    .map((f) => `- ${f.category}/${f.severity} ${f.location} -- ${f.description} -> ${f.action}`)
    .join("\n");
  return [
    "## Returned after review cycles",
    "",
    `Review cycles exceeded the cap at cycle ${cycles}. Findings preserved for Planner groom:`,
    "",
    list,
    "",
  ].join("\n");
}

function unstructuredReviewFinding(body: string): Finding {
  const trimmed = body.trim();
  const description =
    trimmed.length === 0
      ? "Reviewer requested changes without a structured verdict."
      : trimmed.length > 400
        ? `${trimmed.slice(0, 400)}…`
        : trimmed;
  return {
    category: "scope",
    severity: "major",
    location: "(review comment)",
    description,
    action: "Address the reviewer's requested changes; restate the verdict in the finding grammar.",
  };
}

export function latestActionableReview(
  reviews: readonly GhReview[],
  prNumber: number,
  auth?: ReviewAuthorization,
): GhReview | undefined {
  for (let i = reviews.length - 1; i >= 0; i--) {
    const review = reviews[i]!;
    if (review.state === "APPROVED") {
      // A real GitHub APPROVE authorizes a merge only if it is an independent
      // review — never the builder's own identity, and (when an allowlist is
      // configured) a sanctioned reviewer. A non-independent APPROVE is ignored
      // so it cannot force-merge or override an earlier changes-requested.
      if (isIndependentApproval(review, auth)) return review;
      continue;
    }
    if (review.state === "CHANGES_REQUESTED") return review;
    if (review.state === "COMMENTED" && isMarkedSelfApproval(review, prNumber, auth)) {
      return { ...review, state: "APPROVED" };
    }
  }
  return undefined;
}

function isIndependentApproval(review: GhReview, auth?: ReviewAuthorization): boolean {
  const author = review.author;
  if (auth?.builderIdentity !== undefined && author === auth.builderIdentity) return false;
  if (auth?.reviewerIdentities !== undefined) {
    return author !== undefined && auth.reviewerIdentities.includes(author);
  }
  return true;
}

function isMarkedSelfApproval(review: GhReview, prNumber: number, auth?: ReviewAuthorization): boolean {
  // The marker path must clear the SAME author-independence gate as a real
  // APPROVE (mirroring isIndependentApproval): a marker authored by the builder
  // identity, or by an identity outside a configured reviewer allowlist, is not
  // a sanctioned review. In the single-account pilot neither identity is
  // configured and this is a no-op — the commit binding below is what stops a
  // replay there.
  if (!isIndependentApproval(review, auth)) return false;
  // The marker's HMAC must bind the exact reviewed commit (A-001): a marker
  // replayed on a later push carries a commit_id GitHub stamped to the NEW
  // head, which no longer matches what the tag was signed for. An absent
  // commit_id fails closed (undefined → not verifiable).
  if (!verifiedSelfApprovalMarker(review.body, auth?.selfApprovalSecret, prNumber, review.commitId)) {
    return false;
  }
  const parsed = parseVerdict("review", review.body);
  if (parsed.ok) return parsed.verdict.verdict === "approve";
  // Compatibility for HMAC-authorized reviews published before the audit
  // payload became required. Authority comes from the commit-bound HMAC, not
  // this text; new orchestrator publications always carry the full audit.
  return (
    /^\s*Verdict:\s*`?approve`?\s*$/m.test(review.body) &&
    !/^\s*-\s+(?:architecture|testing|security|style|scope)\//im.test(review.body)
  );
}

function createWorktree(localRepo: string, worktreeRoot: string, branch: string, baseBranch: string): string {
  mkdirSync(worktreeRoot, { recursive: true });
  const worktree = join(worktreeRoot, pathSafeBranch(branch));
  if (existsSync(worktree)) return worktree;
  if (branchExists(localRepo, branch)) {
    // Resuming a ticket whose worktree was pruned: check out the existing
    // branch (with its commits) instead of failing on `-b` or, worse,
    // restarting from the base branch and abandoning prior work (Stage 2).
    git(localRepo, "worktree", "add", worktree, branch);
    return worktree;
  }
  git(localRepo, "worktree", "add", "-b", branch, worktree, baseBranch);
  return worktree;
}

function branchExists(localRepo: string, branch: string): boolean {
  try {
    git(localRepo, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
}

function removeWorktree(localRepo: string, worktree: string): void {
  try {
    git(localRepo, "worktree", "remove", "--force", worktree);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
}

export function pushBranch(worktree: string, branch: string): void {
  try {
    git(worktree, "push", "-u", "origin", branch);
  } catch (error) {
    if (!isNonFastForwardPush(error)) throw error;
    // The orchestrator owns the op/<issue>-… branch namespace and rebuilds the
    // branch from origin/main on every attempt. A prior interrupted attempt —
    // e.g. a builder turn that committed and pushed its branch, then was stopped
    // at its per-turn budget cap — can leave a stale, divergent remote branch
    // that makes a plain push fail non-fast-forward and permanently wedge the
    // ticket. The freshly rebuilt branch is authoritative, so force-update this
    // one ref (never any other; the branch name is always the ticket's).
    git(worktree, "push", "--force", "-u", "origin", branch);
  }
  const localHead = git(worktree, "rev-parse", "HEAD");
  const remoteLine = git(worktree, "ls-remote", "--heads", "origin", `refs/heads/${branch}`);
  const remoteHead = remoteLine.split(/\s+/)[0];
  if (remoteHead !== localHead) {
    throw new Error(
      `git push post-state mismatch for ${branch}: local HEAD ${localHead}, remote ${remoteHead ?? "<missing>"}`,
    );
  }
}

function isNonFastForwardPush(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /non-fast-forward|\[rejected\]|tip of your current branch is behind|fetch first/i.test(message);
}

function headSha(worktree: string): string {
  return git(worktree, "rev-parse", "HEAD");
}

function gitLines(cwd: string, ...args: string[]): string[] {
  const output = git(cwd, ...args);
  return output === "" ? [] : output.split("\n");
}

function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: resolve(cwd),
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Cormidia Loop",
        GIT_AUTHOR_EMAIL: "loop@cormidia.invalid",
        GIT_COMMITTER_NAME: "Cormidia Loop",
        GIT_COMMITTER_EMAIL: "loop@cormidia.invalid",
        GIT_TERMINAL_PROMPT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const detail = typeof stderr === "string" && stderr.trim() !== "" ? `\n${stderr.trim()}` : "";
    throw new Error(`git ${args.join(" ")} failed in ${cwd}${detail}`);
  }
}

function tierFromLabels(labels: readonly string[]): TicketTier {
  if (labels.includes("op:tier-quick")) return "quick";
  if (labels.includes("op:tier-deep")) return "deep";
  return "standard";
}

function phaseFromLabels(labels: readonly string[]): LoopPhase {
  if (labels.includes("op:ready")) return "ready";
  if (labels.includes("op:building")) return "building";
  if (labels.includes("op:in-review")) return "reviewing";
  if (labels.includes("op:returned")) return "returned";
  if (labels.includes("op:blocked")) return "blocked";
  return "ready";
}

async function journalBoundary(
  journal: ExecutionJournalTarget | undefined,
  boundary: ExecutionBoundary,
  artifact: unknown,
): Promise<void> {
  if (journal === undefined) return;
  await recordExecutionBoundary({
    root: journal.root,
    episodeId: journal.episodeId,
    boundary,
    artifact,
    now: journal.clock?.() ?? new Date(),
  });
}

async function journalStop(
  journal: ExecutionJournalTarget | undefined,
  kind: JournalStopKind,
  reason: string,
): Promise<void> {
  if (journal === undefined) return;
  await stopExecutionJournal({
    root: journal.root,
    episodeId: journal.episodeId,
    kind,
    reason,
    now: journal.clock?.() ?? new Date(),
  });
}

function stateLabelForPhase(phase: LoopPhase): string {
  switch (phase) {
    case "ready":
      return "op:ready";
    case "building":
    case "gates":
      return "op:building";
    case "reviewing":
    case "shipping":
      return "op:in-review";
    case "returned":
      return "op:returned";
    case "blocked":
      return "op:blocked";
    case "merged":
      return "op:merged";
  }
}

function replaceLabel(labels: readonly string[], remove: string, add: string): string[] {
  const next = labels.filter((label) => label !== remove);
  if (!next.includes(add)) next.push(add);
  return next;
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "ticket";
}

function pathSafeBranch(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function firstParagraph(text: string): string {
  return (
    text
      .trim()
      .split(/\n\s*\n/)[0]
      ?.trim() ?? ""
  );
}

function headingSection(text: string, heading: string): string | undefined {
  const re = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "im");
  const match = re.exec(text);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requireField<K extends keyof LoopItem>(item: LoopItem, key: K): Exclude<LoopItem[K], undefined> {
  const value = item[key];
  if (value === undefined) throw new Error(`loop item ${item.ticketRef} missing ${String(key)}`);
  return value as Exclude<LoopItem[K], undefined>;
}

function squashSubject(item: LoopItem): string {
  return `${item.title} (${item.ticketRef})`;
}
