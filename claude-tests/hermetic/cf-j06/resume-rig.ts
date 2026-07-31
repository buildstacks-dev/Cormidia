// hermetic/cf-j06/resume-rig.ts — shared composition rig for the CF-J06
// continuation/resume fingerprint families (HB-012; case-catalog §1 J-06 rows;
// contracts/B-09a-approval-continuation.md; system-map J-06).
//
// Two independent seams, both at ratified boundaries:
//
// 1. Executor seam (`makeResumeRig`): a REAL `executePipeline`
//    (src/loop/pipeline.ts) capture run over a temp state home + real temp git
//    workdir, scripted through the claude double's `queryFn` injection point —
//    zero tokens, zero network. The capture run's durable PassRunRecord is the
//    ONLY source of the continuation's context/work fingerprints, exactly the
//    fields `blockedOnApproval` (src/loop/loop.ts) persists at a real pause.
//    `resumeAttempt` then drives the same unmodified executor with that
//    continuation, so the revalidation under test (validateContinuationAssignment,
//    context/work fingerprint checks, remainingPasses) is product code.
//
// 2. Claim seam (`pauseTicketAtApproval` + helpers): the REAL claim-recovery
//    saga (src/loop/claim-recovery.ts) over ticket claim state, with GitHub
//    reached only through the gh process seam (github double). Fingerprints are
//    inert at this seam, so claim-walk suites may use `syntheticContinuation`
//    without paying for a capture run.
//
// Not a test file: no vitest imports; rig-integrity failures throw plain Errors.

import { readEfficiencyEvidence } from "../../../src/loop/efficiency.js";
import {
  beginTicketClaim,
  finishTicketClaim,
  markTicketClaimed,
  markTicketProviderStarted,
  type ClaimLease,
} from "../../../src/loop/claim-recovery.js";
import {
  executePipeline,
  type ExecutePipelineOptions,
  type PassRunRecord,
  type PipelineRunResult,
} from "../../../src/loop/pipeline.js";
import type { PipelineConfig } from "../../../src/loop/pipelines.js";
import { readTicketClaimState, type TicketClaimState } from "../../../src/loop/rehydrate.js";
import type {
  LoopContinuation,
  LoopContinuationDecision,
  LoopItem,
} from "../../../src/loop/types.js";
import { readTurnRecords } from "../../../src/runtime/telemetry.js";
import type { ContextBundle, RoleConfig, Runtime } from "../../../src/runtime/types.js";
import {
  claudeDouble,
  doubleRole,
  type ClaudeDoubleRecorder,
} from "../../fixtures/adapters/claude-double.js";
import { script, type AdapterScenario } from "../../fixtures/adapters/scenario.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

export const APP = "cf-j06-app";
export const PIPELINE_NAME = "build";
export const ROLE_NAME = "builder";
export const PLAN_PASS = "plan";
export const ACT_PASS = "act";
/** The exact native session parked at the approval boundary (B-09a §2). */
export const PAUSED_SESSION_ID = "sess-cf-j06-paused-1";
export const DEFAULT_BRANCH = "trunk"; // deliberately not main (#101)

/** Every op:* label the claim/label-projection walks touch, for the double. */
export const OP_LABELS = [
  { name: "op:ready", color: "1D76DB", description: "ready for the loop" },
  { name: "op:building", color: "FBCA04", description: "claimed, building" },
  { name: "op:in-review", color: "0E8A16", description: "PR opened, in review" },
  { name: "op:blocked", color: "5319E7", description: "paused on an approval" },
  { name: "op:returned", color: "B60205", description: "returned for triage" },
] as const;

const RIG_TASTE = "cf-j06 authority layer: deterministic fixture walk, no live effects";

export function rigRole(): RoleConfig {
  return doubleRole({ name: ROLE_NAME, effort: "medium" });
}

/** All-required context (taste is required, no optional memory) so the
 *  render_sha256 recomputed at resume is content-deterministic across runs. */
export function rigContext(): ContextBundle {
  return { taste: [RIG_TASTE], memoryExcerpts: [] };
}

/** A REAL context drift for the CF-J06-R context-mismatch class: the authority
 *  layer changed while the human was away, so the recomputed manifest render
 *  no longer matches the parked contextFingerprint. */
export function driftedContext(): ContextBundle {
  return {
    taste: [`${RIG_TASTE} — DRIFTED: authority text edited while paused`],
    memoryExcerpts: [],
  };
}

function pipelineConfig(): PipelineConfig {
  return {
    name: PIPELINE_NAME,
    mechanical: false,
    passes: [
      // template "" = brief-only task (only synthesized pipelines carry it;
      // the loader rejects empty templates in config) — no promptsDir files.
      { id: PLAN_PASS, role: ROLE_NAME, template: "" },
      { id: ACT_PASS, role: ROLE_NAME, template: "" },
    ],
  };
}

function briefFor(passId: string): string {
  return `cf-j06 rig brief for the ${passId} pass: deterministic scripted work.`;
}

function baseOptions(input: {
  stateHome: string;
  workdir: string;
  runtime: Runtime;
  traceId: string;
  context?: ContextBundle;
}): ExecutePipelineOptions {
  return {
    pipeline: pipelineConfig(),
    selection: { tier: "quick" },
    roles: { [ROLE_NAME]: rigRole() },
    runtimeFor: () => input.runtime,
    briefFor: (pass) => briefFor(pass.id),
    promptsDir: input.workdir, // unused: every pass is template ""
    context: input.context ?? rigContext(),
    workdir: input.workdir,
    hooks: { gate: () => ({ allow: true }) as const },
    runlog: { root: input.stateHome, app: APP, traceId: input.traceId },
  };
}

export function defaultResumeScenario(): AdapterScenario {
  return script.turn({
    sessionId: PAUSED_SESSION_ID,
    outcome: script.success("act pass resumed from the approval boundary and finished", {
      usage: { inputTokens: 700, outputTokens: 90 },
      costUsd: 0.07,
      durationMs: 400,
    }),
  });
}

export interface ResumeAttempt {
  run(): Promise<PipelineRunResult>;
  recorder: ClaudeDoubleRecorder;
  /** Claim-accounting commit point observations — MUST stay empty on any
   *  fail-closed refusal (B-09a §2: mismatch fails closed before any spend). */
  beforeProviderTurnCalls: Array<{ pipeline: string; pass: string; resumed: boolean }>;
}

export interface SpendEvidence {
  /** Settled telemetry ledger rows under the rig state home. */
  ledgerRows: number;
  /** Durable provider execution steps across all efficiency episodes. */
  providerSteps: number;
}

export interface ResumeRig {
  stateHome: string;
  repo: TempGitRepo;
  /** Durable record of the pass the continuation parks (fingerprint source). */
  actRecord: PassRunRecord;
  /** Spend already on the books from the capture run — the refusal suites
   *  assert spend evidence stays EXACTLY here. */
  captureSpend: SpendEvidence;
  /** Continuation shaped exactly like blockedOnApproval's (src/loop/loop.ts),
   *  from the capture run's durable record. */
  continuationFor(decisions: LoopContinuationDecision[]): LoopContinuation;
  resumeAttempt(input: {
    continuation: LoopContinuation;
    scenarios?: AdapterScenario[];
    context?: ContextBundle;
  }): ResumeAttempt;
  spendEvidence(): Promise<SpendEvidence>;
  cleanup(): Promise<void>;
}

async function measureSpend(stateHome: string): Promise<SpendEvidence> {
  const ledgerRows = (await readTurnRecords(stateHome)).length;
  const evidence = await readEfficiencyEvidence(stateHome);
  const providerSteps = evidence
    .flatMap((episode) => episode.steps)
    .filter((step) => step.kind === "provider").length;
  return { ledgerRows, providerSteps };
}

/** Build the executor-seam rig: one REAL two-pass capture run whose durable
 *  `act` record supplies the continuation fingerprints. */
export async function makeResumeRig(): Promise<ResumeRig> {
  const state: TempStateHome = await makeTempStateHome({ name: "cf-j06-org" });
  const repo = await makeTempGitRepo({ defaultBranch: DEFAULT_BRANCH });
  const cleanup = async (): Promise<void> => {
    await repo.cleanup();
    await state.cleanup();
  };

  const capture = claudeDouble([
    script.turn({
      sessionId: "sess-cf-j06-plan-1",
      outcome: script.success("plan pass output", {
        usage: { inputTokens: 500, outputTokens: 60 },
        costUsd: 0.05,
        durationMs: 300,
      }),
    }),
    script.turn({
      sessionId: PAUSED_SESSION_ID,
      outcome: script.success("act pass output at the approval boundary", {
        usage: { inputTokens: 800, outputTokens: 120 },
        costUsd: 0.11,
        durationMs: 500,
      }),
    }),
  ]);

  let result: PipelineRunResult;
  try {
    result = await executePipeline(
      baseOptions({
        stateHome: state.stateHome,
        workdir: repo.dir,
        runtime: capture.runtime,
        traceId: "cf-j06-capture",
      }),
    );
  } catch (error) {
    await cleanup();
    throw error;
  }
  if (result.aborted || result.passes.length !== 2) {
    await cleanup();
    throw new Error(
      `cf-j06 rig: capture run expected 2 completed passes, got aborted=${result.aborted} passes=${result.passes.length}`,
    );
  }
  const actRecord = result.passes[1]!;
  if (actRecord.pass.id !== ACT_PASS || actRecord.workFingerprint === null) {
    await cleanup();
    throw new Error("cf-j06 rig: capture run did not produce a fingerprinted act record");
  }

  const captureSpend = await measureSpend(state.stateHome);
  if (captureSpend.ledgerRows !== 2 || captureSpend.providerSteps !== 2) {
    await cleanup();
    throw new Error(
      `cf-j06 rig: capture spend evidence unexpected (${JSON.stringify(captureSpend)})`,
    );
  }

  let attemptSeq = 0;

  return {
    stateHome: state.stateHome,
    repo,
    actRecord,
    captureSpend,
    continuationFor(decisions) {
      return {
        pipeline: PIPELINE_NAME,
        pass: ACT_PASS,
        role: ROLE_NAME,
        assignment: actRecord.assignment,
        session: { runtime: "claude", id: PAUSED_SESSION_ID },
        completedPasses: [PLAN_PASS],
        contextFingerprint: actRecord.contextFingerprint,
        workFingerprint: actRecord.workFingerprint,
        runId: actRecord.runId,
        pausedAt: "2026-07-31T12:00:00.000Z",
        decisions,
        pauseCostUsd: 0.11,
      };
    },
    resumeAttempt(input) {
      const dbl = claudeDouble(input.scenarios ?? [defaultResumeScenario()]);
      const beforeProviderTurnCalls: ResumeAttempt["beforeProviderTurnCalls"] = [];
      attemptSeq += 1;
      const options: ExecutePipelineOptions = {
        ...baseOptions({
          stateHome: state.stateHome,
          workdir: repo.dir,
          runtime: dbl.runtime,
          traceId: `cf-j06-resume-${attemptSeq}`,
          ...(input.context !== undefined ? { context: input.context } : {}),
        }),
        continuation: input.continuation,
        beforeProviderTurn: (info) => {
          beforeProviderTurnCalls.push(info);
        },
      };
      return {
        run: () => executePipeline(options),
        recorder: dbl.recorder,
        beforeProviderTurnCalls,
      };
    },
    spendEvidence: () => measureSpend(state.stateHome),
    cleanup,
  };
}

// ---------------------------------------------------------------------------
// Claim-seam helpers (no capture run needed; fingerprints inert at this seam)
// ---------------------------------------------------------------------------

/** Continuation for claim-walk suites. The claim saga persists and replays
 *  these fields verbatim; nothing at this seam recomputes fingerprints. */
export function syntheticContinuation(
  decisions: LoopContinuationDecision[],
): LoopContinuation {
  return {
    pipeline: PIPELINE_NAME,
    pass: ACT_PASS,
    role: ROLE_NAME,
    assignment: { harness: "claude", model: "claude-scripted-model", effort: "medium" },
    session: { runtime: "claude", id: PAUSED_SESSION_ID },
    completedPasses: [PLAN_PASS],
    contextFingerprint: "cf-j06-synthetic-context-fingerprint",
    workFingerprint: null,
    runId: "20260731-120000-build-act",
    pausedAt: "2026-07-31T12:00:00.000Z",
    decisions,
    pauseCostUsd: 0.11,
  };
}

export function blockedLoopItem(input: {
  issueNumber: number;
  continuation: LoopContinuation;
  targetRepo?: string;
}): LoopItem {
  return {
    issueNumber: input.issueNumber,
    ticketRef: `#${input.issueNumber}`,
    title: "cf-j06 paused ticket",
    body: "## Goal\nContinuation/resume fingerprint suite walk.\n",
    targetRepo: input.targetRepo ?? "operon-double/cf-j06",
    labels: ["op:blocked"],
    phase: "blocked",
    tier: "standard",
    cycles: 0,
    remediationAttempts: 0,
    gateResults: [],
    findings: [],
    continuation: input.continuation,
  };
}

/** One full claim → provider turn → approval pause through the REAL saga:
 *  begin → claimed → provider started → finished blocked with continuation. */
export async function pauseTicketAtApproval(input: {
  root: string;
  issueNumber: number;
  continuation: LoopContinuation;
  app?: string;
  targetRepo?: string;
  defaultAllowance?: number;
}): Promise<{ lease: ClaimLease; state: TicketClaimState }> {
  const app = input.app ?? APP;
  const begun = await beginTicketClaim({
    root: input.root,
    app,
    issueNumber: input.issueNumber,
    defaultAllowance: input.defaultAllowance ?? 3,
  });
  if (!begun.allowed || begun.lease === undefined) {
    throw new Error(`cf-j06 rig: claim refused for #${input.issueNumber}`);
  }
  const claim = {
    root: input.root,
    app,
    issueNumber: input.issueNumber,
    claimId: begun.lease.claimId,
  };
  await markTicketClaimed(claim);
  await markTicketProviderStarted(claim);
  await finishTicketClaim({
    ...claim,
    item: blockedLoopItem({
      issueNumber: input.issueNumber,
      continuation: input.continuation,
      ...(input.targetRepo !== undefined ? { targetRepo: input.targetRepo } : {}),
    }),
  });
  return {
    lease: begun.lease,
    state: readTicketClaimState(input.root, app, input.issueNumber),
  };
}
