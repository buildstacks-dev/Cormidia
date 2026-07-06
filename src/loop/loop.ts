// Loop v1 ticket state machine (M5): one GitHub issue flows from op:ready
// toward a squash-merged PR, with real quality gates between phases.
//
// This module stays provider-blind. Builder/Reviewer model turns arrive via
// the pipeline executor in M6; M5 proves the GitHub/gate/state-machine shell
// that those turns plug into.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ContextBundle, RoleConfig, Runtime, TurnHooks } from "../runtime/types.js";
import { assembleBrief } from "./brief.js";
import type { GhIssue, GhOps, GhPullRequest, GhReview } from "./github.js";
import { isMergeConflict } from "./github.js";
import { SELF_APPROVAL_FALLBACK_MARKER } from "./github.js";
import type { Policy, RiskTier } from "./policy.js";
import { matchedDimensions, resolveTier } from "./policy.js";
import { executePipeline, type PassRunRecord } from "./pipeline.js";
import { getPipeline, type PassConfig, type PassSelection, type PipelinesFile } from "./pipelines.js";
import {
  runGates,
  type AcceptanceCriterion,
  type CompletenessFinding,
  type CriterionTestMap,
  type GateCommands,
  type GateRunResult,
  type ProcessGateOpts,
  type ReviewFreshnessState,
} from "./qgates.js";
import {
  parseVerdict,
  validateVerdict,
  VERDICT_SCHEMAS,
  type BuildVerdict,
  type ContractVerdict,
  type Finding,
  type ReviewVerdict,
  type VerdictKind,
  type VerdictTypes,
} from "./verdicts.js";
import type { LoopItem, LoopPhase, ScorecardEvent, TicketTier } from "./types.js";
export type { LoopItem, LoopPhase, ScorecardEvent, TicketTier } from "./types.js";

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
}

export interface ReviewPhaseOptions {
  gh: GhOps;
  maxCycles?: number;
}

export interface ShippingPhaseOptions extends GatePhaseOptions {
  localRepo: string;
  gateRunner?: (item: LoopItem, stage: "entry" | "pre-merge") => Promise<GateRunResult>;
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
  context?: ContextBundle;
  baseRef?: string;
  headRef?: string;
  clock?: () => Date;
  briefBudgetTokens?: number;
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

  while (true) {
    const result = await runGateSet(current, options);
    gateResults.push(result);

    if (result.status === "pass") {
      pushBranch(worktree, branch);
      const pr = await ensurePr(current, options.gh, options.prDraft === true);
      await options.gh.swapLabel(current.issueNumber, "op:building", "op:in-review");
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
      if (current.phase === "returned") return current;
      continue;
    }

    const comment = blockedWithEvidenceComment("quality gates exhausted", result);
    await options.gh.commentIssue(current.issueNumber, comment);
    await options.gh.swapLabel(current.issueNumber, stateLabelForPhase(current.phase), "op:returned");
    return {
      ...current,
      labels: replaceLabel(current.labels, stateLabelForPhase(current.phase), "op:returned"),
      phase: "returned",
      gateResults,
    };
  }
}

export async function advanceReviewing(
  item: LoopItem,
  options: ReviewPhaseOptions,
): Promise<LoopItem> {
  const prNumber = requireField(item, "prNumber");
  const reviews = await options.gh.listReviews(prNumber);
  const latest = latestActionableReview(reviews);
  if (latest === undefined) return item;

  if (latest.state === "CHANGES_REQUESTED") {
    const parsed = parseVerdict("review", latest.body);
    if (!parsed.ok) throw new Error(`review verdict could not be parsed: ${parsed.reason}`);
    const cycles = item.cycles + 1;
    const findings = parsed.verdict.findings;
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
    if (latest.commitId !== head) return item;
    return {
      ...item,
      approvedCommitId: latest.commitId,
      phase: "shipping",
    };
  }

  return item;
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
    context: options.context ?? EMPTY_CONTEXT,
    workdir: worktree,
    hooks: options.hooks,
    runlog: {
      root: options.runlogRoot,
      app: options.app,
      ticket: item.ticketRef,
      traceId: traceIdFor(item, pipeline.name, options.clock),
    },
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    verdictSchemaFor: (pass) => VERDICT_SCHEMAS[verdictKindForPass(pass)],
    afterPass: async (record) => {
      const kind = verdictKindForPass(record.pass);
      if (kind === "contract") {
        const verdict = parsePassVerdict("contract", record.result.summary);
        contract = renderContractComment(verdict);
        await options.gh.commentIssue(item.issueNumber, contract);
      } else if (kind === "build") {
        buildVerdict = parsePassVerdict("build", record.result.summary);
      }
    },
  });

  if (result.aborted) throw new Error(`${pipelineName} pipeline aborted before completion`);

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
    context: options.context ?? EMPTY_CONTEXT,
    workdir: requireField(item, "worktree"),
    hooks: options.hooks,
    runlog: {
      root: options.runlogRoot,
      app: options.app,
      ticket: item.ticketRef,
      traceId: traceIdFor(item, "review", options.clock),
    },
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    verdictSchemaFor: () => VERDICT_SCHEMAS.review,
    afterPass: (record) => {
      verdicts.push({ pass: record.pass.id, verdict: parsePassVerdict("review", record.result.summary) });
    },
  });

  if (result.aborted) throw new Error("review pipeline aborted before completion");

  const body = renderReviewBody(verdicts);
  await options.gh.commentIssue(item.issueNumber, `## Structured review verdict\n\n${body}`);
  await options.gh.createReview(prNumber, {
    state: hasFindings(verdicts) ? "request_changes" : "approve",
    body,
  });
  return advanceReviewing(item, { gh: options.gh });
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
    context: options.context ?? EMPTY_CONTEXT,
    workdir: requireField(item, "worktree"),
    hooks: options.hooks,
    runlog: {
      root: options.runlogRoot,
      app: options.app,
      ticket: item.ticketRef,
      traceId: traceIdFor(item, "ship", options.clock),
    },
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    verdictSchemaFor: () => VERDICT_SCHEMAS.review,
    afterPass: (record) => {
      verdicts.push({ pass: record.pass.id, verdict: parsePassVerdict("review", record.result.summary) });
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
  await options.gh.swapLabel(item.issueNumber, "op:in-review", "op:building");
  return {
    ...item,
    findings: verdicts.flatMap((entry) => entry.verdict.findings),
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
  removeWorktree(options.localRepo, worktree);

  const scorecardEvents: ScorecardEvent[] =
    item.turnId === undefined
      ? []
      : [{ type: "review_cycles", turnId: item.turnId, ticketRef: item.ticketRef, value: item.cycles }];

  return {
    ...item,
    labels: item.labels.filter((label) => label !== "op:in-review"),
    phase: "merged",
    gateResults,
    scorecardEvents,
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
  return assembleBrief(
    {
      ticket: { title: ticketTitle(item), body: item.body },
      ...(state.contract !== undefined ? { contract: state.contract } : {}),
      findings: item.findings.map((finding) => ({
        text: findingLine(finding),
        severity: finding.severity,
        resolved: false,
      })),
      ...(state.gateResult !== undefined ? { gateOutput: formatGateResult(state.gateResult) } : {}),
      memory: [],
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
  return assembleBrief(
    {
      ticket: { title: ticketTitle(item), body: item.body },
      ...(item.contract !== undefined ? { contract: item.contract } : {}),
      findings: item.findings.map((finding) => ({
        text: findingLine(finding),
        severity: finding.severity,
        resolved: false,
      })),
      memory: [],
      repo: repoBrief(item, options),
    },
    { budgetTokens: options.briefBudgetTokens ?? DEFAULT_BRIEF_BUDGET_TOKENS },
  );
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

function parsePassVerdict<K extends VerdictKind>(
  kind: K,
  text: string,
): VerdictTypes[K] {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = validateVerdict(kind, JSON.parse(trimmed));
      if (parsed.ok) return parsed.verdict;
      throw new Error(parsed.reason);
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw new Error(`${kind} structured verdict invalid: ${errorMessage(error)}`);
      }
    }
  }

  const parsed = parseVerdict(kind, text);
  if (parsed.ok) return parsed.verdict;
  throw new Error(`${kind} verdict could not be parsed: ${parsed.reason}`);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function latestActionableReview(reviews: readonly GhReview[]): GhReview | undefined {
  for (let i = reviews.length - 1; i >= 0; i--) {
    const review = reviews[i]!;
    if (review.state === "APPROVED" || review.state === "CHANGES_REQUESTED") return review;
    if (review.state === "COMMENTED" && isMarkedSelfApproval(review)) {
      return { ...review, state: "APPROVED" };
    }
  }
  return undefined;
}

function isMarkedSelfApproval(review: GhReview): boolean {
  if (!review.body.includes(SELF_APPROVAL_FALLBACK_MARKER)) return false;
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
  git(localRepo, "worktree", "add", "-b", branch, worktree, baseBranch);
  return worktree;
}

function removeWorktree(localRepo: string, worktree: string): void {
  try {
    git(localRepo, "worktree", "remove", "--force", worktree);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
}

function pushBranch(worktree: string, branch: string): void {
  git(worktree, "push", "-u", "origin", branch);
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
