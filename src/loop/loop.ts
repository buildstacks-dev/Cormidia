// Loop v1 ticket state machine (M5): one GitHub issue flows from op:ready
// toward a squash-merged PR, with real quality gates between phases.
//
// This module stays provider-blind. Builder/Reviewer model turns arrive via
// the pipeline executor in M6; M5 proves the GitHub/gate/state-machine shell
// that those turns plug into.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { ContextBundle, RoleConfig, Runtime, TurnHooks, TurnUsage } from "../runtime/types.js";
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
import { matchedDimensions, resolveTier } from "./policy.js";
import {
  executePipeline,
  type PassRunRecord,
  type VerdictRecordContext,
  type VerdictRecordOutcome,
} from "./pipeline.js";
import { getPipeline, type PassConfig, type PassSelection, type PipelinesFile } from "./pipelines.js";
import {
  runGates,
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
  type VerdictKind,
  type VerdictTypes,
} from "./verdicts.js";
import type { LoopItem, LoopPhase, ReleaseConfig, ScorecardEvent, TicketTier } from "./types.js";
export type { LoopItem, LoopPhase, ScorecardEvent, TicketTier } from "./types.js";
import { parseReleaseKind } from "./plan-tickets.js";

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
}

export interface ReviewPhaseOptions {
  gh: GhOps;
  maxCycles?: number;
  /** Merge-authorization policy. Without it, a real GitHub APPROVE is accepted
   *  as today (independence still enforced by the cross-provider reviewer), but
   *  the single-account self-approval fallback is never trusted (fail closed). */
  authorization?: ReviewAuthorization;
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
      const pr = await ensurePr(current, options.gh, options.prDraft === true);
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

    if (result.remediation.canRetry) {
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
    return {
      ...current,
      labels: replaceLabel(current.labels, fromLabel, "op:returned"),
      phase: "returned",
      gateResults,
    };
  }
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
    verdictSchemaFor: (pass) => VERDICT_SCHEMAS[verdictKindForPass(pass)],
    recordVerdict: async (ctx) => {
      const kind = verdictKindForPass(ctx.pass);
      const outcome = await recordPassVerdict(kind, ctx);
      if (!outcome.ok) return outcome.failure;
      if (kind === "contract") {
        // The marker binds the contract to the exact ticket body it was
        // derived from, so a re-claim can reuse it (skip the contract pass)
        // while the body is unchanged and re-derive when it is not (Stage 2).
        contract = `${renderContractComment(outcome.verdict as ContractVerdict)}\n\n${contractMarker(hashTicketBody(item.body))}`;
        await options.gh.commentIssue(item.issueNumber, contract);
      } else if (kind === "build") {
        buildVerdict = outcome.verdict as BuildVerdict;
      }
      return { ok: true, ...(outcome.retryUsage !== undefined ? { extraUsage: outcome.retryUsage } : {}) };
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
    verdictSchemaFor: () => VERDICT_SCHEMAS.review,
    recordVerdict: async (ctx) => {
      const outcome = await recordPassVerdict("review", ctx);
      if (!outcome.ok) return outcome.failure;
      verdicts.push({ pass: ctx.pass.id, verdict: outcome.verdict });
      // Forward reformat-retry spend so the envelope and ledger settle it —
      // the builder pipeline already does; undercounting here is Defect B.
      return { ok: true, ...(outcome.retryUsage !== undefined ? { extraUsage: outcome.retryUsage } : {}) };
    },
  });

  if (result.aborted) throw new Error("review pipeline aborted before completion");

  const body = renderReviewBody(verdicts);
  await options.gh.commentIssue(item.issueNumber, `## Structured review verdict\n\n${body}`);
  const findings = verdicts.flatMap((entry) => entry.verdict.findings);
  await options.gh.createReview(prNumber, {
    state: findings.length > 0 ? "request_changes" : "approve",
    body,
  });
  // GitHub rejects REQUEST_CHANGES on a PR authored by the same account. The
  // adapter records a comment-review fallback in that case, but the structured
  // Reviewer verdict is already trusted pipeline output. Bounce directly from
  // it rather than asking advanceReviewing to discover a GitHub state that
  // cannot exist for a self-authored PR.
  if (findings.length > 0) {
    const cycles = item.cycles + 1;
    if (cycles > DEFAULT_MAX_REVIEW_CYCLES) {
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
    ...(options.authorization !== undefined ? { authorization: options.authorization } : {}),
  });
}

export async function runShipCheckPipeline(
  item: LoopItem,
  options: LoopPipelineOptions,
): Promise<LoopItem> {
  const pipeline = getPipeline(options.pipelines, "ship");
  const verdicts: { pass: string; verdict: ReviewVerdict }[] = [];

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
    verdictSchemaFor: () => VERDICT_SCHEMAS.review,
    recordVerdict: async (ctx) => {
      const outcome = await recordPassVerdict("review", ctx);
      if (!outcome.ok) return outcome.failure;
      verdicts.push({ pass: ctx.pass.id, verdict: outcome.verdict });
      // Forward reformat-retry spend so the envelope and ledger settle it —
      // the builder pipeline already does; undercounting here is Defect B.
      return { ok: true, ...(outcome.retryUsage !== undefined ? { extraUsage: outcome.retryUsage } : {}) };
    },
  });

  if (result.aborted) throw new Error("ship pipeline aborted before completion");
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
  if (cycles > DEFAULT_MAX_REVIEW_CYCLES) {
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

  return {
    ...item,
    labels: item.labels.filter((label) => label !== "op:in-review"),
    phase: "merged",
    gateResults,
    scorecardEvents,
    ...(releaseTrigger !== undefined ? { releaseTrigger } : {}),
  };
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

export function defaultCriterionTests(
  criteria: readonly AcceptanceCriterion[],
  testName = "quality-gates",
): CriterionTestMap {
  const map: CriterionTestMap = {};
  for (const criterion of criteria) map[criterion.id] = [testName];
  return map;
}

const EMPTY_CONTEXT: ContextBundle = { taste: [], memoryExcerpts: [] };

function passSelectionForItem(item: LoopItem, options: LoopPipelineOptions): PassSelection {
  const worktree = requireField(item, "worktree");
  const changedFiles = gitLines(
    worktree,
    "diff",
    "--name-only",
    options.baseRef ?? "origin/main",
    options.headRef ?? "HEAD",
  );
  return {
    tier: item.tier,
    riskTier: resolveTier(options.policy, changedFiles),
    labels: item.labels,
    dimensions: matchedDimensions(options.policy, changedFiles),
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

function verdictKindForPass(pass: PassConfig): VerdictKind {
  if (pass.id === "contract") return "contract";
  if (pass.role === "builder") return "build";
  return "review";
}


type PassVerdictOutcome<K extends VerdictKind> =
  | { ok: true; verdict: VerdictTypes[K]; retryUsage?: TurnUsage }
  | { ok: false; failure: VerdictRecordOutcome };

/** Parse the pass's verdict with exactly one session-resuming reformat retry
 *  (docs/loop.md §6, §13 row 11), emit `verdict.recorded` into the pass's run
 *  record on success, and on unparseable-after-retry surface a typed infra
 *  failure (distinct `error_code`, never a merit outcome). */
async function recordPassVerdict<K extends VerdictKind>(
  kind: K,
  ctx: VerdictRecordContext,
): Promise<PassVerdictOutcome<K>> {
  // The reformat retry is an extra runTurn; its spend must not vanish from the
  // pass's usage rollup. Capture the retry turn's usage so the executor can add
  // it to the envelope (loop.ts:766 finding — was silently discarded).
  let retryUsage: TurnUsage | undefined;
  const reformat = async (reason: string): Promise<string> => {
    const res = await ctx.runtime.runTurn(
      {
        role: ctx.role,
        workdir: ctx.workdir,
        task: reformatTask(kind, reason),
        context: ctx.context,
        session: ctx.result.session,
      },
      ctx.hooks,
    );
    retryUsage = res.usage;
    return res.summary;
  };
  try {
    const verdict = await parseWithRetry(kind, ctx.result.summary, reformat, (t) => parseVerdictEither(kind, t));
    await ctx.events.append({ type: "verdict.recorded", detail: verdictDetail(kind, verdict) });
    return { ok: true, verdict, ...(retryUsage !== undefined ? { retryUsage } : {}) };
  } catch (error) {
    if (error instanceof VerdictParseError) {
      return { ok: false, failure: { ok: false, errorCode: "error_verdict_unparseable", error } };
    }
    throw error;
  }
}

function reformatTask(kind: VerdictKind, reason: string): string {
  return [
    `Your ${kind} verdict could not be parsed:`,
    reason,
    "",
    "Reformat your verdict as specified in the pass template — output only the",
    "corrected verdict, nothing else.",
  ].join("\n");
}

function verdictDetail(
  kind: VerdictKind,
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
    verdict.tests,
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
  // Only a marker carrying a valid HMAC tag for this PR is trusted — a bare or
  // forged marker (e.g. posted by a prompt-injected builder) is rejected.
  if (!verifiedSelfApprovalMarker(review.body, auth?.selfApprovalSecret, prNumber)) return false;
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
