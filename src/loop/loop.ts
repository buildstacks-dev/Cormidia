// Loop v1 ticket state machine (M5): one GitHub issue flows from op:ready
// toward a squash-merged PR, with real quality gates between phases.
//
// This module stays provider-blind. Builder/Reviewer model turns arrive via
// the pipeline executor in M6; M5 proves the GitHub/gate/state-machine shell
// that those turns plug into.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { ContextBundle, RoleConfig, Runtime, TurnHooks } from "../runtime/types.js";
import type { TriggerKind } from "../runtime/telemetry.js";
import type { GateResultEntry } from "../runtime/runlog/envelope.js";
import { scrubSecrets } from "../runtime/runlog/redact.js";
import { assembleBrief, type SpecDoc } from "./brief.js";
import type { GhIssue, GhOps, GhPullRequest, GhReview } from "./github.js";
import { contractMarker, hashTicketBody, renderFixResolutionsComment } from "./rehydrate.js";
import { isMergeConflict } from "./github.js";
import { verifiedSelfApprovalMarker } from "./github.js";
import { openPhaseRun, type LoopRunlog, type PhaseRun } from "./loop-runlog.js";
import type { Policy, RiskTier } from "./policy.js";
import { matchedDimensions, packageJsonTouchesSecurityKeys, resolveTier } from "./policy.js";
import {
  executePipeline,
  type ExecutePipelineOptions,
  type PassRunRecord,
  type VerdictRecordContext,
  type VerdictRecordOutcome,
} from "./pipeline.js";
import { getPipeline, type PassConfig, type PassSelection, type PipelinesFile } from "./pipelines.js";
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
import {
  parseVerdict,
  parseVerdictEither,
  parseWithRetry,
  VerdictParseError,
  VERDICT_SCHEMAS,
  type BuildVerdict,
  type ContractVerdict,
  type Finding,
  type ParseResult,
  type ReviewVerdict,
  type VerdictTypes,
} from "./verdicts.js";
import type { LoopItem, LoopPhase, ReleaseConfig, ScorecardEvent, TicketTier } from "./types.js";
export type { LoopItem, LoopPhase, ScorecardEvent, TicketTier } from "./types.js";
import { parseReleaseKind, STATE_LABELS } from "./plan-tickets.js";
import { parseDependsOn } from "./scheduling.js";
import {
  recordExecutionBoundary,
  stopExecutionJournal,
  type ExecutionBoundary,
  type JournalStopKind,
} from "./execution-journal.js";

export interface ClaimTicketOptions {
  gh: GhOps;
  targetRepo: string;
  localRepo: string;
  worktreeRoot: string;
  baseBranch?: string;
}

export interface GatePhaseOptions {
  gh: GhOps;
  policy: Policy;
  commands: GateCommands;
  criteria: readonly AcceptanceCriterion[];
  criterionTests: CriterionTestMap;
  findings?: readonly CompletenessFinding[];
  process?: ProcessGateOpts;
  baseRef?: string;
  headRef?: string;
  reviewState?: ReviewFreshnessState;
  /** Test/M5 harness hook: performs the bounded fix pass before gates retry. */
  remediate?: (
    item: LoopItem,
    result: GateRunResult,
  ) => LoopItem | void | Promise<LoopItem | void>;
  prDraft?: boolean;
  /** When present, the gate phase gets its own run record: `gate.started/
   *  passed/failed` + `ticket.transition` events and `envelope.gate_results`
   *  (docs/loop.md §9). Absent → no run record, identical behavior. */
  runlog?: LoopRunlog;
  /** Ticket execution journal prepared by the driver. Pure state-machine
   * callers omit it and retain the same provider-free behavior. */
  journal?: ExecutionJournalTarget;
  /** Route-owned repair cap. The policy cap remains an upper bound. */
  maxRemediationAttempts?: number;
}

export interface ExecutionJournalTarget {
  root: string;
  episodeId: string;
  clock?: () => Date;
}

export interface ReviewPhaseOptions {
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

export interface ShippingPhaseOptions extends GatePhaseOptions {
  localRepo: string;
  gateRunner?: (item: LoopItem, stage: "entry" | "pre-merge") => Promise<GateRunResult>;
  /** The app's declared release mechanism (`release:` in `.operon/config.yaml`
   *  / apps.yaml), when it declares one. advanceShipping enforces P7 against
   *  it: a milestone whose ticket declares `Release-kind: deploy|package`
   *  with no matching declared mechanism is unfinished, mechanically. */
  release?: ReleaseConfig;
}

export interface LoopPipelineOptions {
  gh: GhOps;
  pipelines: PipelinesFile;
  roles: Record<string, RoleConfig>;
  runtimeFor: (role: RoleConfig) => Runtime;
  promptsDir: string;
  runlogRoot: string;
  app: string;
  policy: Policy;
  commands: GateCommands;
  hooks: TurnHooks;
  /** Role-aware critical-op gate used by manual loop execution. */
  gateForRole?: (role: RoleConfig) => TurnHooks["gate"];
  context?: ContextBundle;
  /** Per-episode governed context (learning-loop M5, design §8.4): invoked
   *  once per pipeline invocation with the ticket item, pipeline name, and
   *  the pipeline's lead role (from the loaded pipelines.yaml config — never
   *  a parallel role table) so the resolve pins on the TICKET episode with
   *  the role that actually runs. An undefined return falls back to
   *  `context`. The org layer supplies the resolver-backed implementation;
   *  loop code never reads learning state (one-way imports). */
  contextFor?: (item: LoopItem, pipeline: string, role: string) => Promise<ContextBundle | undefined>;
  baseRef?: string;
  headRef?: string;
  clock?: () => Date;
  briefBudgetTokens?: number;
  authorization?: ReviewAuthorization;
  /** Explicitly allow runtime network access for this loop tick. */
  networkAccess?: boolean;
  /** Per-pass ledger settlement target — see ExecutePipelineOptions.telemetry. */
  telemetry?: { orgDir: string; trigger?: TriggerKind };
  /** Cooperative cancellation for every provider pass in this tick. */
  signal?: AbortSignal;
  parentTaskId?: string;
  /** Ticket-wide route admission prepared by the loop driver. */
  episode?: ExecutePipelineOptions["episode"];
  maxReviewCycles?: number;
}

export interface BuilderPipelineOptions extends LoopPipelineOptions {
  pipelineName?: "build" | "fix";
  gateResult?: GateRunResult;
}

const DEFAULT_MAX_REVIEW_CYCLES = 3;
const DEFAULT_BRIEF_BUDGET_TOKENS = 24_000;

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

export async function claimTicket(
  issue: GhIssue,
  options: ClaimTicketOptions,
): Promise<LoopItem> {
  const item = itemFromIssue(issue, options.targetRepo);
  const branch = branchNameForIssue(issue);

  await options.gh.swapLabel(issue.number, "op:ready", "op:building");
  const worktree = createWorktree(
    options.localRepo,
    options.worktreeRoot,
    branch,
    options.baseBranch ?? "main",
  );

  return {
    ...item,
    labels: replaceLabel(item.labels, "op:ready", "op:building"),
    phase: "building",
    branch,
    worktree,
  };
}

export async function advanceGates(
  item: LoopItem,
  options: GatePhaseOptions,
): Promise<LoopItem> {
  const worktree = requireField(item, "worktree");
  const branch = requireField(item, "branch");
  let current = { ...item, phase: "gates" as LoopPhase };
  const gateResults = [...current.gateResults];
  const rec = options.runlog !== undefined ? await openPhaseRun(options.runlog, "gates", "quality-gates") : undefined;

  while (true) {
    if (rec !== undefined) await rec.events.append({ type: "gate.started", detail: { attempt: current.remediationAttempts } });
    const result = await runGateSet(current, options);
    gateResults.push(result);
    await recordGateResult(rec, result);

    if (result.status === "pass") {
      pushBranch(worktree, branch);
      await journalBoundary(options.journal, "push", {
        branch,
        head: headSha(worktree),
      });
      await journalBoundary(options.journal, "gates", result);
      const pr = await ensurePr(current, options.gh, options.prDraft === true);
      await journalBoundary(options.journal, "pr", {
        number: pr.number,
        head: headSha(worktree),
      });
      await options.gh.swapLabel(current.issueNumber, "op:building", "op:in-review");
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

    const comment = blockedWithEvidenceComment("quality gates exhausted", result);
    await options.gh.commentIssue(current.issueNumber, comment);
    const fromLabel = stateLabelForPhase(current.phase);
    await options.gh.swapLabel(current.issueNumber, fromLabel, "op:returned");
    await rec?.transition(fromLabel, "op:returned");
    await rec?.finalize("blocked");
    await journalStop(options.journal, "cap_stop", `quality-gate repair cap exhausted at ${current.remediationAttempts}`);
    return {
      ...current,
      labels: replaceLabel(current.labels, fromLabel, "op:returned"),
      phase: "returned",
      gateResults,
    };
  }
}

export interface ProvisionSetupOptions {
  gh: GhOps;
  commands: GateCommands;
  process?: ProcessGateOpts;
  /** When present, the provision-setup step gets its own run record so its
   *  `gate.started/passed/failed` events and `envelope.gate_results` land in
   *  events.jsonl BEFORE the first implement pass (docs/loop.md §5, §9). Absent
   *  → no run record, identical behavior. */
  runlog?: LoopRunlog;
}

/** Run the app's `setup` gate in the freshly provisioned worktree, BEFORE the
 *  first implement pass (L1-02 / L-003, docs/loop.md §5). `createWorktree`
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
export async function advanceProvisionSetup(
  item: LoopItem,
  options: ProvisionSetupOptions,
): Promise<LoopItem> {
  const worktree = requireField(item, "worktree");
  const setupResult = await runSetupGate(worktree, options.commands, options.process);
  if (setupResult === undefined) return item;

  const rec =
    options.runlog !== undefined ? await openPhaseRun(options.runlog, "provision", "setup") : undefined;
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
  await options.gh.swapLabel(item.issueNumber, fromLabel, "op:returned");
  await rec?.transition(fromLabel, "op:returned");
  await rec?.finalize("blocked");
  return {
    ...item,
    labels: replaceLabel(item.labels, fromLabel, "op:returned"),
    phase: "returned",
  };
}

/** Provision-time setup failure evidence for the returned ticket — the same
 *  "loud, verbatim, no rediscovery" discipline as the gate-failure comment
 *  (Stage 3): the operator sees the exact command and its output tail. */
function provisionSetupFailedComment(result: GateResult): string {
  const tail = result.outputTail ?? result.failures?.join("\n") ?? "";
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
    "The app's `setup_command` (dependency install) failed in the fresh worktree",
    "before any implementation pass ran — no build turn was spent. The builder's",
    "baseline check could only fail for lack of dependencies.",
    "",
    "**Assessment:**",
    "Fix `setup_command` in `.operon/config.yaml` (or the environment it needs)",
    "and re-arm the ticket.",
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
  // Envelopes are L1 (export-eligible): the failing command and its bounded
  // tail ride along, scrubbed — remediation must never need a model turn just
  // to learn what the gate saw (Stage 3).
  const parts = [gate.detail];
  if (status === "failed" && gate.command !== undefined) parts.push(`$ ${gate.command}`);
  if (status === "failed" && gate.outputTail !== undefined) parts.push(boundTail(gate.outputTail));
  return { gate: gate.gate, status, detail: scrubSecrets(parts.join("\n")) };
}

export async function advanceReviewing(
  item: LoopItem,
  options: ReviewPhaseOptions,
): Promise<LoopItem> {
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
    // (loud, never silent, never unbounded — docs/loop.md §6/§7).
    const findings = parsed.ok ? parsed.verdict.findings : [unstructuredReviewFinding(latest.body)];
    const cycles = item.cycles + 1;
    if (cycles > (options.maxCycles ?? DEFAULT_MAX_REVIEW_CYCLES)) {
      await options.gh.commentIssue(
        item.issueNumber,
        returnedFindingsComment(cycles, findings),
      );
      await options.gh.swapLabel(item.issueNumber, "op:in-review", "op:returned");
      return {
        ...item,
        cycles,
        findings,
        labels: replaceLabel(item.labels, "op:in-review", "op:returned"),
        phase: "returned",
      };
    }
    await options.gh.swapLabel(item.issueNumber, "op:in-review", "op:building");
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
async function stalledReviewing(
  item: LoopItem,
  options: ReviewPhaseOptions,
  reason: string,
): Promise<LoopItem> {
  const cycles = item.cycles + 1;
  if (cycles > (options.maxCycles ?? DEFAULT_MAX_REVIEW_CYCLES)) {
    await options.gh.commentIssue(item.issueNumber, reviewStalledComment(cycles, reason));
    await options.gh.swapLabel(item.issueNumber, "op:in-review", "op:returned");
    return {
      ...item,
      cycles,
      labels: replaceLabel(item.labels, "op:in-review", "op:returned"),
      phase: "returned",
    };
  }
  return { ...item, cycles };
}

export async function runBuilderPipeline(
  item: LoopItem,
  options: BuilderPipelineOptions,
): Promise<LoopItem> {
  const worktree = requireField(item, "worktree");
  const pipelineName = options.pipelineName ?? "build";
  const pipeline = getPipeline(options.pipelines, pipelineName);
  let contract = item.contract;
  let buildVerdict: BuildVerdict | undefined;
  const journal = journalFromPipelineOptions(options);
  if (contract !== undefined) {
    await journalBoundary(journal, "contract", {
      ticketBodyHash: hashTicketBody(item.body),
      contract,
    });
  }

  const result = await executePipeline({
    pipeline,
    selection: passSelectionForItem(item, options),
    roles: options.roles,
    runtimeFor: options.runtimeFor,
    briefFor: (pass) =>
      buildBrief(item, options, {
        pass,
        ...(contract !== undefined ? { contract } : {}),
        ...(options.gateResult !== undefined ? { gateResult: options.gateResult } : {}),
      }),
    promptsDir: options.promptsDir,
    context:
      (await options.contextFor?.(item, pipelineName, pipeline.passes[0]?.role ?? "builder")) ??
      options.context ??
      EMPTY_CONTEXT,
    workdir: worktree,
    hooks: options.hooks,
    ...(options.gateForRole !== undefined ? { gateForRole: options.gateForRole } : {}),
    runlog: {
      root: options.runlogRoot,
      app: options.app,
      ticket: item.ticketRef,
      traceId: traceIdFor(item, pipeline.name, options.clock),
    },
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.networkAccess === true ? { networkAccess: true } : {}),
    ...(options.telemetry !== undefined ? { telemetry: options.telemetry } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.parentTaskId !== undefined ? { parentTaskId: options.parentTaskId } : {}),
    ...(options.episode !== undefined ? { episode: options.episode } : {}),
    verdictSchemaFor: (pass) => VERDICT_SCHEMAS[verdictKindForPass(pass)],
    recordVerdict: async (ctx) => {
      const kind = verdictKindForPass(ctx.pass);
      const outcome = await recordPassVerdict(kind, ctx);
      if (!outcome.ok) return outcome.failure;
      if (kind === "contract") {
        const verdict = outcome.verdict as ContractVerdict;
        // The marker binds the contract to the exact ticket body it was
        // derived from, so a re-claim can reuse it (skip the contract pass)
        // while the body is unchanged and re-derive when it is not (Stage 2).
        contract = `${renderContractComment(verdict)}\n\n${contractMarker(hashTicketBody(item.body))}`;
        item = { ...item, criterionTests: criterionTestMapFromContract(verdict) };
        await options.gh.commentIssue(item.issueNumber, contract);
        await journalBoundary(journal, "contract", {
          ticketBodyHash: hashTicketBody(item.body),
          contract,
        });
      } else if (kind === "build") {
        buildVerdict = outcome.verdict as BuildVerdict;
      }
      return { ok: true };
    },
  });

  if (result.aborted) {
    // Honest terminal handling (Stage 3): report BOTH the turn outcome and
    // the durable-work outcome, and leave the ticket in a recoverable state.
    // The episode's final $30 fix pass had already pushed its commit when the
    // budget cap killed it; the bare "failed" invited a needless full re-run,
    // and the stranded op:building label needed a human relabel to recover.
    // Remediation-context aborts (gateResult present) keep throwing —
    // advanceGates owns that loop's bookkeeping.
    if (options.gateResult === undefined) {
      const last = result.passes[result.passes.length - 1]?.result;
      await journalStop(
        journal,
        journalStopKind(last?.errorCode, last?.status),
        last?.summary ?? `${pipelineName} pipeline aborted`,
      );
      const work = durableWorkSummary(worktree, item.branch);
      const stopped =
        `## Turn stopped before completion\n\n` +
        `The ${pipelineName} pipeline stopped: ${last?.summary ?? "no pass result"}` +
        `${last?.errorCode !== undefined ? ` (\`${last.errorCode}\`)` : ""}.\n\n` +
        `**Durable work preserved:** ${work}\n\n`;
      if (last?.status === "blocked_on_gate") {
        // An approval wait, not a defect: op:blocked is the approval path.
        await options.gh.commentIssue(
          item.issueNumber,
          `${stopped}Waiting on the pending approval (\`operon approvals\`); the ticket re-arms after the decision.`,
        );
        await options.gh.swapLabel(item.issueNumber, stateLabelForPhase(item.phase), "op:blocked");
        return {
          ...item,
          ...(contract !== undefined ? { contract } : {}),
          labels: replaceLabel(item.labels, stateLabelForPhase(item.phase), "op:blocked"),
          phase: "blocked",
        };
      }
      // A stopped turn is not lost work: re-arm op:ready so the next tick
      // continues from the durable artifacts. The cross-claim cap (default 3)
      // bounds this — the human is summoned with a digest, never used as the
      // retry loop.
      await options.gh.commentIssue(
        item.issueNumber,
        `${stopped}Re-armed \`op:ready\`: the next claim continues from these artifacts ` +
          `(contract reused while the ticket body is unchanged; open PR consulted before pipeline selection).`,
      );
      await options.gh.swapLabel(item.issueNumber, stateLabelForPhase(item.phase), "op:ready");
      return {
        ...item,
        ...(contract !== undefined ? { contract } : {}),
        labels: replaceLabel(item.labels, stateLabelForPhase(item.phase), "op:ready"),
        phase: "ready",
      };
    }
    throw new Error(`${pipelineName} pipeline aborted before completion`);
  }

  await journalBoundary(journal, "implementation", {
    head: headSha(worktree),
  });

  // Fix verdicts carry per-finding dispositions; post them durably so the
  // findings ledger survives the pass (verdicts otherwise live only in the
  // run log) and every later review round sees fixed/rebutted vs still open.
  if (pipelineName === "fix" && buildVerdict?.resolutions !== undefined) {
    await options.gh.commentIssue(
      item.issueNumber,
      renderFixResolutionsComment(buildVerdict.resolutions),
    );
  }

  if (buildVerdict?.status === "blocked") {
    const comment = renderBuildBlockedComment(buildVerdict);
    await options.gh.commentIssue(item.issueNumber, comment);
    await options.gh.swapLabel(item.issueNumber, stateLabelForPhase(item.phase), "op:returned");
    return {
      ...item,
      ...(contract !== undefined ? { contract } : {}),
      labels: replaceLabel(item.labels, stateLabelForPhase(item.phase), "op:returned"),
      phase: "returned",
    };
  }

  return {
    ...item,
    ...(contract !== undefined ? { contract } : {}),
    phase: "gates",
  };
}

export async function runReviewPipeline(
  item: LoopItem,
  options: LoopPipelineOptions,
): Promise<LoopItem> {
  const prNumber = requireField(item, "prNumber");
  const pipeline = getPipeline(options.pipelines, "review");
  const verdicts: { pass: string; verdict: ReviewVerdict }[] = [];
  const journal = journalFromPipelineOptions(options);

  const result = await executePipeline({
    pipeline,
    selection: passSelectionForItem(item, options),
    roles: options.roles,
    runtimeFor: options.runtimeFor,
    briefFor: (pass) => reviewBrief(item, options, pass),
    promptsDir: options.promptsDir,
    context:
      (await options.contextFor?.(item, "review", pipeline.passes[0]?.role ?? "reviewer")) ??
      options.context ??
      EMPTY_CONTEXT,
    workdir: requireField(item, "worktree"),
    hooks: options.hooks,
    ...(options.gateForRole !== undefined ? { gateForRole: options.gateForRole } : {}),
    runlog: {
      root: options.runlogRoot,
      app: options.app,
      ticket: item.ticketRef,
      traceId: traceIdFor(item, "review", options.clock),
    },
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.networkAccess === true ? { networkAccess: true } : {}),
    ...(options.telemetry !== undefined ? { telemetry: options.telemetry } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.parentTaskId !== undefined ? { parentTaskId: options.parentTaskId } : {}),
    ...(options.episode !== undefined ? { episode: options.episode } : {}),
    verdictSchemaFor: () => VERDICT_SCHEMAS.review,
    recordVerdict: async (ctx) => {
      const outcome = await recordPassVerdict("review", ctx);
      if (!outcome.ok) return outcome.failure;
      verdicts.push({ pass: ctx.pass.id, verdict: outcome.verdict });
      // Forward reformat-retry spend so the envelope and ledger settle it —
      // the builder pipeline already does; undercounting here is Defect B.
      return { ok: true };
    },
  });

  if (result.aborted) {
    const last = result.passes[result.passes.length - 1]?.result;
    const kind = journalStopKind(last?.errorCode, last?.status);
    await journalStop(journal, kind, last?.summary ?? "review pipeline aborted");
    // L-005: a legitimately-fired cap terminalizes cleanly (op:returned +
    // evidence comment) instead of crashing the loop and stranding the PR.
    // A genuine internal error still throws.
    if (isCapDrivenStop(kind)) {
      return returnedOnCapStop(item, options, "review", last);
    }
    throw new Error("review pipeline aborted before completion");
  }

  const body = renderReviewBody(verdicts);
  await options.gh.commentIssue(item.issueNumber, `## Structured review verdict\n\n${body}`);
  const findings = verdicts.flatMap((entry) => entry.verdict.findings);
  await options.gh.createReview(prNumber, {
    state: findings.length > 0 ? "request_changes" : "approve",
    body,
  });
  await journalBoundary(journal, "findings", {
    reviewedHead: headSha(requireField(item, "worktree")),
    findings,
    passes: verdicts.map((entry) => entry.pass),
  });
  // GitHub rejects REQUEST_CHANGES on a PR authored by the same account. The
  // adapter records a comment-review fallback in that case, but the structured
  // Reviewer verdict is already trusted pipeline output. Bounce directly from
  // it rather than asking advanceReviewing to discover a GitHub state that
  // cannot exist for a self-authored PR.
  if (findings.length > 0) {
    const cycles = item.cycles + 1;
    if (cycles > (options.maxReviewCycles ?? DEFAULT_MAX_REVIEW_CYCLES)) {
      await options.gh.commentIssue(item.issueNumber, returnedFindingsComment(cycles, findings));
      await options.gh.swapLabel(item.issueNumber, "op:in-review", "op:returned");
      return {
        ...item,
        cycles,
        findings,
        labels: replaceLabel(item.labels, "op:in-review", "op:returned"),
        phase: "returned",
      };
    }
    await options.gh.swapLabel(item.issueNumber, "op:in-review", "op:building");
    return {
      ...item,
      cycles,
      findings,
      labels: replaceLabel(item.labels, "op:in-review", "op:building"),
      phase: "building",
    };
  }
  return advanceReviewing(item, {
    gh: options.gh,
    ...(options.maxReviewCycles !== undefined ? { maxCycles: options.maxReviewCycles } : {}),
    ...(options.authorization !== undefined ? { authorization: options.authorization } : {}),
    ...(journal !== undefined ? { journal } : {}),
  });
}

export async function runShipCheckPipeline(
  item: LoopItem,
  options: LoopPipelineOptions,
): Promise<LoopItem> {
  const pipeline = getPipeline(options.pipelines, "ship");
  const verdicts: { pass: string; verdict: ReviewVerdict }[] = [];
  const journal = journalFromPipelineOptions(options);

  const result = await executePipeline({
    pipeline,
    selection: passSelectionForItem(item, options),
    roles: options.roles,
    runtimeFor: options.runtimeFor,
    briefFor: (pass) => reviewBrief(item, options, pass),
    promptsDir: options.promptsDir,
    context:
      (await options.contextFor?.(item, "ship", pipeline.passes[0]?.role ?? "reviewer")) ??
      options.context ??
      EMPTY_CONTEXT,
    workdir: requireField(item, "worktree"),
    hooks: options.hooks,
    ...(options.gateForRole !== undefined ? { gateForRole: options.gateForRole } : {}),
    runlog: {
      root: options.runlogRoot,
      app: options.app,
      ticket: item.ticketRef,
      traceId: traceIdFor(item, "ship", options.clock),
    },
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.networkAccess === true ? { networkAccess: true } : {}),
    ...(options.telemetry !== undefined ? { telemetry: options.telemetry } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.parentTaskId !== undefined ? { parentTaskId: options.parentTaskId } : {}),
    ...(options.episode !== undefined ? { episode: options.episode } : {}),
    verdictSchemaFor: () => VERDICT_SCHEMAS.review,
    recordVerdict: async (ctx) => {
      const outcome = await recordPassVerdict("review", ctx);
      if (!outcome.ok) return outcome.failure;
      verdicts.push({ pass: ctx.pass.id, verdict: outcome.verdict });
      // Forward reformat-retry spend so the envelope and ledger settle it —
      // the builder pipeline already does; undercounting here is Defect B.
      return { ok: true };
    },
  });

  if (result.aborted) {
    const last = result.passes[result.passes.length - 1]?.result;
    const kind = journalStopKind(last?.errorCode, last?.status);
    await journalStop(journal, kind, last?.summary ?? "ship-check pipeline aborted");
    // L-005: as in runReviewPipeline, a cap terminalizes cleanly to op:returned
    // rather than crashing the loop; a genuine internal error still throws.
    if (isCapDrivenStop(kind)) {
      return returnedOnCapStop(item, options, "ship", last);
    }
    throw new Error("ship pipeline aborted before completion");
  }
  if (result.passes.length === 0) return item;

  const body = renderReviewBody(verdicts);
  await options.gh.commentIssue(item.issueNumber, `## Ship-check verdict\n\n${body}`);
  await options.gh.createReview(requireField(item, "prNumber"), {
    state: hasFindings(verdicts) ? "request_changes" : "approve",
    body,
  });

  if (!hasFindings(verdicts)) return item;

  // A ship-check bounce is a rework cycle just like a reviewer CHANGES_REQUESTED:
  // count it against the same review-cycle cap so building<->shipping cannot
  // loop until the driver's phase guard throws and orphans the ticket in
  // op:building. When the cap is exhausted, route to op:returned with findings
  // for the Planner (mirrors advanceReviewing / advanceGates bounding).
  const findings = verdicts.flatMap((entry) => entry.verdict.findings);
  const cycles = item.cycles + 1;
  if (cycles > (options.maxReviewCycles ?? DEFAULT_MAX_REVIEW_CYCLES)) {
    await options.gh.commentIssue(item.issueNumber, returnedFindingsComment(cycles, findings));
    await options.gh.swapLabel(item.issueNumber, "op:in-review", "op:returned");
    return {
      ...item,
      cycles,
      findings,
      labels: replaceLabel(item.labels, "op:in-review", "op:returned"),
      phase: "returned",
    };
  }
  await options.gh.swapLabel(item.issueNumber, "op:in-review", "op:building");
  return {
    ...item,
    cycles,
    findings,
    labels: replaceLabel(item.labels, "op:in-review", "op:building"),
    phase: "building",
  };
}

export async function advanceShipping(
  item: LoopItem,
  options: ShippingPhaseOptions,
): Promise<LoopItem> {
  const branch = requireField(item, "branch");
  const worktree = requireField(item, "worktree");
  const prNumber = requireField(item, "prNumber");
  const gateResults = [...item.gateResults];

  // P7 (docs/approval-and-release-amendment.md A4): a milestone whose plan
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
        ? `the app declares no release mechanism (no \`release:\` block in .operon/config.yaml)`
        : declared.kind !== requiredKind
          ? `the app declares \`release.kind: ${declared.kind}\`, not \`${requiredKind}\``
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
          "the app's `.operon/config.yaml` `release:` block (kind, command, owner) or re-plan the",
          "milestone as merge-only. The PR is left open; no merge was attempted.",
        ].join("\n"),
      );
      await options.gh.swapLabel(item.issueNumber, "op:in-review", "op:returned");
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

  try {
    await options.gh.squashMerge(prNumber, {
      subject: squashSubject(item),
      body: `Closes ${item.ticketRef}`,
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
  await options.gh.removeLabel(item.issueNumber, "op:in-review");
  // Render done-ness: the merged ticket's acceptance boxes end checked, and
  // the orchestrator is the only party the design allows to write them
  // (criteria are never Builder-edited; publication renders them unchecked).
  const checkedBody = checkAcceptanceBoxes(item.body);
  if (checkedBody !== item.body) {
    await options.gh.updateIssueBody(item.issueNumber, checkedBody);
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
  const releaseTrigger =
    requiredKind !== undefined && requiredKind !== "merge-only" && options.release?.command !== undefined
      ? { kind: requiredKind, command: options.release.command, owner: options.release.owner }
      : undefined;
  await journalBoundary(options.journal, "release", {
    disposition: releaseTrigger === undefined ? "merge-only" : "queued-for-scoped-approval",
    kind: releaseTrigger?.kind ?? "merge-only",
    owner: releaseTrigger?.owner ?? null,
    commandHash:
      releaseTrigger === undefined
        ? null
        : createHash("sha256").update(releaseTrigger.command).digest("hex"),
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

const EMPTY_CONTEXT: ContextBundle = { taste: [], memoryExcerpts: [] };

function passSelectionForItem(item: LoopItem, options: LoopPipelineOptions): PassSelection {
  const worktree = requireField(item, "worktree");
  const baseRef = options.baseRef ?? "origin/main";
  const headRef = options.headRef ?? "HEAD";
  const changedFiles = gitLines(worktree, "diff", "--name-only", baseRef, headRef);
  return {
    tier: item.tier,
    riskTier: resolveTier(options.policy, changedFiles),
    labels: item.labels,
    // Content-gate package.json so a bare metadata/test-glob edit does not
    // select the security-deep review pass — same predicate the route
    // reassessment uses (L1-05).
    dimensions: matchedDimensions(options.policy, changedFiles, {
      dependencyRelevantPackageJson: dependencyRelevantPackageJson(worktree, baseRef, headRef, changedFiles),
    }),
    // A rehydrated, still-applicable contract makes the contract pass
    // redundant: 21 claims must never again produce 20 contract passes.
    // The implement brief carries the reused contract verbatim.
    ...(item.contract !== undefined ? { excludePasses: ["contract"] } : {}),
  };
}

interface BuildBriefState {
  pass: PassConfig;
  contract?: string;
  gateResult?: GateRunResult;
}

function buildBrief(
  item: LoopItem,
  options: BuilderPipelineOptions,
  state: BuildBriefState,
): string {
  const specs = resolveContextSpecs(item);
  const attempts = historyEntries(item);
  return assembleBrief(
    {
      ticket: { title: ticketTitle(item), body: item.body },
      ...(specs.length > 0 ? { specs } : {}),
      ...(state.contract !== undefined ? { contract: state.contract } : {}),
      findings: item.findings.map((finding) => ({
        text: findingLine(finding),
        severity: finding.severity,
        resolved: false,
      })),
      ...(state.gateResult !== undefined ? { gateOutput: formatGateResult(state.gateResult) } : {}),
      ...(attempts.length > 0
        ? { attempts, maxAttempts: options.policy.remediation.maxAttempts }
        : {}),
      memory: options.context?.memoryExcerpts ?? [],
      repo: repoBrief(item, options),
    },
    { budgetTokens: options.briefBudgetTokens ?? DEFAULT_BRIEF_BUDGET_TOKENS },
  );
}

function reviewBrief(
  item: LoopItem,
  options: LoopPipelineOptions,
  _pass: PassConfig,
): string {
  const specs = resolveContextSpecs(item);
  return assembleBrief(
    {
      ticket: { title: ticketTitle(item), body: item.body },
      ...(specs.length > 0 ? { specs } : {}),
      ...(item.contract !== undefined ? { contract: item.contract } : {}),
      findings: item.findings.map((finding) => ({
        text: findingLine(finding),
        severity: finding.severity,
        resolved: false,
      })),
      memory: options.context?.memoryExcerpts ?? [],
      repo: repoBrief(item, options),
    },
    { budgetTokens: options.briefBudgetTokens ?? DEFAULT_BRIEF_BUDGET_TOKENS },
  );
}

/** §3 [spec]: resolve the ticket body's `## Context` links to repo-relative
 *  files, read verbatim from the worktree. A missing or unreadable file
 *  degrades to a note (never a throw) — a broken link must not fail a build. */
function resolveContextSpecs(item: LoopItem): SpecDoc[] {
  if (item.worktree === undefined) return [];
  const section = headingSection(item.body, "Context");
  if (section === undefined) return [];
  const specs: SpecDoc[] = [];
  for (const rel of contextRepoPaths(section)) {
    const abs = join(item.worktree, rel);
    try {
      specs.push({ title: rel, content: readFileSync(abs, "utf8") });
    } catch {
      specs.push({
        title: rel,
        content: `(spec "${rel}" linked in the ticket Context was not found in the worktree — omitted, not fatal)`,
      });
    }
  }
  return specs;
}

/** Extract repo-relative file paths from a Context section: markdown link
 *  targets and bare paths that look like files. URLs, mailto, `#123` issue
 *  refs, absolute paths, and `..` escapes are dropped. Order-preserving,
 *  de-duplicated. */
function contextRepoPaths(section: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const add = (raw: string): void => {
    const p = normalizeRepoPath(raw);
    if (p !== undefined && !seen.has(p)) {
      seen.add(p);
      order.push(p);
    }
  };
  for (const m of section.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) add(m[1]!);
  for (const m of section.matchAll(/(?:^|\s)([A-Za-z0-9._/-]+\.[A-Za-z0-9]{1,8})(?=$|\s|\))/gm)) add(m[1]!);
  return order;
}

function normalizeRepoPath(raw: string): string | undefined {
  let p = raw.trim();
  if (p === "") return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p) || p.startsWith("mailto:") || p.startsWith("#")) return undefined;
  p = p.replace(/^\.\//, "");
  if (isAbsolute(p) || p.split("/").includes("..")) return undefined; // stay inside the repo
  if (!/\.[A-Za-z0-9]{1,8}$/.test(p)) return undefined; // must look like a file
  return p;
}

/** §3 [history]: prior attempts on this ticket, oldest first — the assembler
 *  labels them "attempt N of M". Derived from the durable counters on the
 *  item (remediation fix passes, review cycles); empty on a first attempt. */
function historyEntries(item: LoopItem): string[] {
  const entries: string[] = [];
  for (let i = 0; i < item.remediationAttempts; i++) {
    entries.push(`Remediation ${i + 1}: quality gates failed and a bounded fix pass was dispatched.`);
  }
  if (item.cycles > 0) {
    entries.push(
      `Review cycle ${item.cycles}: the reviewer requested changes; this pass addresses the findings above.`,
    );
  }
  return entries;
}

function repoBrief(item: LoopItem, options: LoopPipelineOptions): string {
  const worktree = requireField(item, "worktree");
  const changedFiles = gitLines(
    worktree,
    "diff",
    "--name-only",
    options.baseRef ?? "origin/main",
    options.headRef ?? "HEAD",
  );
  const selection = passSelectionForItem(item, options);
  return [
    `Target repo: ${item.targetRepo}`,
    `Worktree: ${worktree}`,
    `Branch: ${item.branch ?? "(none)"}`,
    `PR: ${item.prNumber !== undefined ? `#${item.prNumber}` : "(not opened yet)"}`,
    `Ticket tier: ${item.tier}`,
    `Risk tier: ${selection.riskTier ?? "(unknown)"}`,
    `Review dimensions: ${(selection.dimensions ?? []).join(", ") || "(none)"}`,
    `Test command: ${options.commands.testCommand ?? "(not configured)"}`,
    `Lint command: ${options.commands.lintCommand ?? "(not configured)"}`,
    "Changed files:",
    ...(changedFiles.length === 0 ? ["(none)"] : changedFiles.map((file) => `- ${file}`)),
  ].join("\n");
}

type PassVerdictKind = "contract" | "build" | "review";

function verdictKindForPass(pass: PassConfig): PassVerdictKind {
  if (pass.id === "contract") return "contract";
  if (pass.role === "builder") return "build";
  return "review";
}


type PassVerdictOutcome<K extends PassVerdictKind> =
  | { ok: true; verdict: VerdictTypes[K] }
  | { ok: false; failure: VerdictRecordOutcome };

/** Parse the pass's verdict with exactly one session-resuming reformat retry
 *  (docs/loop.md §6, §13 row 11), emit `verdict.recorded` into the pass's run
 *  record on success, and on unparseable-after-retry surface a typed infra
 *  failure (distinct `error_code`, never a merit outcome). */
async function recordPassVerdict<K extends PassVerdictKind>(
  kind: K,
  ctx: VerdictRecordContext,
): Promise<PassVerdictOutcome<K>> {
  const reformat = async (reason: string): Promise<string> => {
    const res = await ctx.runProviderTurn({
      operation: `${kind}-verdict-reformat`,
      task: reformatTask(kind, reason),
      session: ctx.result.session,
    });
    return res.summary;
  };
  try {
    const verdict = await parseWithRetry(kind, ctx.result.summary, reformat, (t) => parseVerdictEither(kind, t));
    await ctx.events.append({ type: "verdict.recorded", detail: verdictDetail(kind, verdict) });
    return { ok: true, verdict };
  } catch (error) {
    if (error instanceof VerdictParseError) {
      return { ok: false, failure: { ok: false, errorCode: "error_verdict_unparseable", error } };
    }
    throw error;
  }
}

function reformatTask(kind: PassVerdictKind, reason: string): string {
  return [
    `Your ${kind} verdict could not be parsed:`,
    reason,
    "",
    "Reformat your verdict as specified in the pass template — output only the",
    "corrected verdict, nothing else.",
  ].join("\n");
}

function verdictDetail(
  kind: PassVerdictKind,
  verdict: ContractVerdict | BuildVerdict | ReviewVerdict,
): Record<string, string | number | boolean> {
  if (kind === "contract") {
    const v = verdict as ContractVerdict;
    return { kind, complexity: v.complexity, files: v.files.length };
  }
  if (kind === "build") {
    const v = verdict as BuildVerdict;
    return { kind, status: v.status, blocked: v.status === "blocked" };
  }
  const v = verdict as ReviewVerdict;
  return { kind, verdict: v.verdict, findings: v.findings.length };
}

function renderContractComment(verdict: ContractVerdict): string {
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

function renderBuildBlockedComment(verdict: BuildVerdict): string {
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

function renderReviewBody(entries: readonly { pass: string; verdict: ReviewVerdict }[]): string {
  const findings = entries.flatMap((entry) => entry.verdict.findings);
  const lines = [
    ...findings.map(findingLine),
    `Verdict: ${findings.length === 0 ? "approve" : "findings"}`,
    "",
    "Passes:",
    ...entries.map((entry) => `- ${entry.pass}: ${entry.verdict.verdict}`),
  ];
  return lines.join("\n");
}

function hasFindings(entries: readonly { verdict: ReviewVerdict }[]): boolean {
  return entries.some((entry) => entry.verdict.findings.length > 0);
}

function findingLine(finding: Finding): string {
  return `- ${finding.category}/${finding.severity} ${finding.location} -- ${finding.description} -> ${finding.action}`;
}

function formatGateResult(result: GateRunResult): string {
  return result.results
    .filter((gate) => gate.status === "fail")
    .map((gate) => {
      const detail = gate.outputTail ?? gate.failures?.join("\n") ?? gate.detail;
      return `### ${gate.gate}\n${gate.detail}\n\n${detail}`;
    })
    .join("\n\n");
}

function ticketTitle(item: LoopItem): string {
  return `${item.ticketRef} ${item.title}`;
}

function traceIdFor(item: LoopItem, pipeline: string, clock: (() => Date) | undefined): string {
  const stamp = (clock?.() ?? new Date()).toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `${stamp}-${pipeline}-${item.issueNumber}`;
}

async function runGateSet(item: LoopItem, options: GatePhaseOptions): Promise<GateRunResult> {
  const worktree = requireField(item, "worktree");
  const baseRef = options.baseRef ?? "origin/main";
  const headRef = options.headRef ?? "HEAD";
  const changedFiles = gitLines(worktree, "diff", "--name-only", baseRef, headRef);
  const riskTier: RiskTier = resolveTier(options.policy, changedFiles);
  const head = headSha(worktree);
  const reviewState = options.reviewState ?? { approvedCommitId: head, headCommitId: head };

  return runGates(
    riskTier,
    worktree,
    options.criteria,
    options.findings ?? [],
    reviewState,
    {
      policy: options.policy,
      commands: options.commands,
      criterionTests: options.criterionTests,
      currentAttempt: item.remediationAttempts,
      ...(options.process !== undefined ? { process: options.process } : {}),
      diff: { baseRef, headRef },
    },
  );
}

async function ensurePr(item: LoopItem, gh: GhOps, draft: boolean): Promise<GhPullRequest> {
  const branch = requireField(item, "branch");
  const existing = await gh.listPRsForBranch(branch, { state: "all" });
  if (existing.length > 0) return existing[0]!;
  return gh.createPR({
    head: branch,
    base: "main",
    title: prTitle(item),
    body: prBody(item),
    draft,
  });
}

function prTitle(item: LoopItem): string {
  return `build: ${item.title} (${item.ticketRef})`;
}

function prBody(item: LoopItem): string {
  return [
    "## What",
    `Implements ${item.ticketRef}: ${item.title}`,
    "",
    "## Why",
    firstParagraph(headingSection(item.body, "Goal") ?? item.body),
    "",
    "## Evidence",
    "- Quality gates passed before review.",
    "",
    `Closes ${item.ticketRef}`,
    "",
  ].join("\n");
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
    `${result.remediation.maxAttempts} bounded remediation attempt(s).`,
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

function latestActionableReview(
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

function isMarkedSelfApproval(
  review: GhReview,
  prNumber: number,
  auth?: ReviewAuthorization,
): boolean {
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
  if (
    !verifiedSelfApprovalMarker(review.body, auth?.selfApprovalSecret, prNumber, review.commitId)
  ) {
    return false;
  }
  const parsed = parseVerdict("review", review.body);
  return parsed.ok && parsed.verdict.verdict === "approve";
}

function createWorktree(
  localRepo: string,
  worktreeRoot: string,
  branch: string,
  baseBranch: string,
): string {
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
}

function isNonFastForwardPush(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /non-fast-forward|\[rejected\]|tip of your current branch is behind|fetch first/i.test(
    message,
  );
}

function headSha(worktree: string): string {
  return git(worktree, "rev-parse", "HEAD");
}

function gitLines(cwd: string, ...args: string[]): string[] {
  const output = git(cwd, ...args);
  return output === "" ? [] : output.split("\n");
}

/** The repo-relative `package.json` paths in this diff whose dependency or
 *  run-script keys actually changed — the security dimension's content gate
 *  (L1-05). Shared by the review pass selector (`passSelectionForItem`) and
 *  the loop driver's route reassessment (`reassessForObservedWorktreeRisk`),
 *  so both treat a bare metadata/test-glob `package.json` edit identically:
 *  not a security signal.
 *
 *  Each side is read with a THREE-way result: content, a legitimate ABSENCE
 *  (the path does not exist at that ref — a newly-added or newly-deleted file),
 *  or a genuine git FAILURE ("cannot check"). A failure is fail-SAFE: it means
 *  we cannot compare, so package.json is treated as security-relevant and the
 *  route escalates (the commit's "cannot compare → escalate" claim; Theme 1 —
 *  cannot-determine must fail safe). A legitimate absence maps to an empty
 *  side, so the present side's own deps still drive the comparison (an added
 *  package.json with dependencies escalates; a deleted one does not). Exported
 *  for the behavioral regression test. */
export function dependencyRelevantPackageJson(
  worktree: string,
  baseRef: string,
  headRef: string,
  changedFiles: string[],
): Set<string> {
  const relevant = new Set<string>();
  for (const file of changedFiles) {
    if (file !== "package.json" && !file.endsWith("/package.json")) continue;
    const before = packageJsonAtRef(worktree, `${baseRef}:${file}`);
    const after = packageJsonAtRef(worktree, `${headRef}:${file}`);
    // A genuine git failure on either side is fail-safe: cannot compare →
    // escalate. Do NOT collapse it into "empty" the way a legitimate absence
    // is (that would fail open on a transient error).
    if (before.kind === "error" || after.kind === "error") {
      relevant.add(file);
      continue;
    }
    const beforeText = before.kind === "content" ? before.text : undefined;
    const afterText = after.kind === "content" ? after.text : undefined;
    if (packageJsonTouchesSecurityKeys(beforeText, afterText)) relevant.add(file);
  }
  return relevant;
}

type PackageJsonAtRef =
  | { kind: "content"; text: string }
  | { kind: "absent" } // the path legitimately does not exist at this ref
  | { kind: "error" }; // git could not answer — treat as risky (fail-safe)

/** Read a file's content at a git ref, distinguishing a legitimate absence
 *  (added/deleted file) from a genuine git failure. `git show <ref>:<path>`
 *  for a path that simply is not present at that ref exits non-zero with a
 *  recognizable "does not exist" / "exists on disk, but not in" message; any
 *  other non-zero exit (bad ref, not a repo, object-store error) is a failure
 *  we must not mistake for "no change". */
function packageJsonAtRef(cwd: string, spec: string): PackageJsonAtRef {
  const result = spawnSync("git", ["show", spec], {
    cwd: resolve(cwd),
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error === undefined && result.status === 0) {
    return { kind: "content", text: result.stdout };
  }
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (/does not exist in|exists on disk, but not in/.test(stderr)) {
    return { kind: "absent" };
  }
  return { kind: "error" };
}

function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: resolve(cwd),
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Operon Loop",
        GIT_AUTHOR_EMAIL: "loop@operon.invalid",
        GIT_COMMITTER_NAME: "Operon Loop",
        GIT_COMMITTER_EMAIL: "loop@operon.invalid",
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

/** What survives a stopped turn: commits on the ticket branch and whether
 *  they reached the remote. Read-only; a broken worktree degrades to a note. */
function durableWorkSummary(worktree: string, branch: string | undefined): string {
  try {
    const ahead = git(worktree, "rev-list", "--count", "origin/main..HEAD");
    if (ahead.trim() === "0") return "no commits beyond origin/main";
    let pushed = "unpushed";
    try {
      const unpushed = git(worktree, "rev-list", "--count", "@{u}..HEAD");
      pushed = unpushed.trim() === "0" ? "pushed" : `${unpushed.trim()} commit(s) unpushed`;
    } catch {
      // No upstream — nothing pushed yet.
    }
    return `${ahead.trim()} commit(s) on ${branch ?? "the ticket branch"} (${pushed})`;
  } catch {
    return "(worktree state unreadable)";
  }
}

function journalFromPipelineOptions(options: LoopPipelineOptions): ExecutionJournalTarget | undefined {
  if (options.episode?.id === undefined) return undefined;
  return {
    root: options.runlogRoot,
    episodeId: options.episode.id,
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
  };
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

function journalStopKind(
  errorCode: string | undefined,
  status: string | undefined,
): JournalStopKind {
  if (status === "cancelled" || errorCode === "error_cancelled") return "cancelled";
  if (status === "timed_out" || errorCode?.includes("timeout") || errorCode?.includes("wall_clock")) {
    return "provider_timeout";
  }
  if (errorCode?.includes("budget") || errorCode?.includes("cap")) return "cap_stop";
  return "crash";
}

/** A pipeline abort caused by a legitimately-fired resource limit — a
 *  budget/route cap (`cap_stop`) or a wall-clock/adapter timeout
 *  (`provider_timeout`) — rather than a genuine internal defect (`crash`).
 *  L-005: the former must terminalize the ticket cleanly (a paid cap firing is
 *  correct behaviour, not a crash); the latter must still throw loudly so a
 *  real defect is never swallowed as a clean terminal. `cancelled` keeps
 *  throwing too — an operator-cancelled run has no clean-terminal story here. */
function isCapDrivenStop(kind: JournalStopKind): boolean {
  return kind === "cap_stop" || kind === "provider_timeout";
}

interface AbortPassResult {
  errorCode?: string;
  status?: string;
  summary?: string;
}

/** L-005: terminalize a review/ship pipeline that a cap stopped mid-flight.
 *  Route `op:in-review -> op:returned` with a budget/limit-exhaustion evidence
 *  comment so the ticket does not sit forever at `op:in-review` (a label that
 *  falsely reads "review in progress") with an open, mergeable PR the loop
 *  will never touch again. The PR is left open and untouched — a human decides
 *  whether to merge it as-is or raise the budget and re-run. */
async function returnedOnCapStop(
  item: LoopItem,
  options: LoopPipelineOptions,
  pipelineName: string,
  last: AbortPassResult | undefined,
): Promise<LoopItem> {
  await options.gh.commentIssue(item.issueNumber, capExhaustionComment(pipelineName, last, item.prNumber));
  await options.gh.swapLabel(item.issueNumber, "op:in-review", "op:returned");
  return {
    ...item,
    labels: replaceLabel(item.labels, "op:in-review", "op:returned"),
    phase: "returned",
  };
}

function capExhaustionComment(
  pipelineName: string,
  last: AbortPassResult | undefined,
  prNumber: number | undefined,
): string {
  const label = pipelineName === "ship" ? "Ship-check" : "Review";
  const detail = last?.summary ?? "a provider budget or wall-clock cap was reached";
  return [
    `## ${label} stopped: budget/limit exhausted`,
    "",
    `The ${pipelineName} pipeline stopped before completion because a cap fired: ${detail}` +
      `${last?.errorCode !== undefined ? ` (\`${last.errorCode}\`)` : ""}.`,
    "",
    prNumber !== undefined
      ? `**PR #${prNumber} is left open and was not orphaned.** The code work is durable; a human decides whether to:`
      : "**The ticket is returned for a human decision:**",
    "- merge the open PR as-is if the review so far is sufficient, or",
    "- raise the app/route budget (or the wall-clock cap) and re-run `operon loop` to finish the review.",
    "",
    "Routed to `op:returned` rather than left at `op:in-review` (which would falsely read " +
      '"PR open, review in progress" for a ticket the loop will never touch again).',
  ].join("\n");
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
  return text.trim().split(/\n\s*\n/)[0]?.trim() ?? "";
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

function requireField<K extends keyof LoopItem>(
  item: LoopItem,
  key: K,
): Exclude<LoopItem[K], undefined> {
  const value = item[key];
  if (value === undefined) throw new Error(`loop item ${item.ticketRef} missing ${String(key)}`);
  return value as Exclude<LoopItem[K], undefined>;
}

function squashSubject(item: LoopItem): string {
  return `${item.title} (${item.ticketRef})`;
}
