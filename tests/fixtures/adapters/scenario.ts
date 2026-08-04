// tests/fixtures/adapters/scenario.ts — the SHARED scripted-scenario
// format for provider adapter doubles (HB-004; boundary-map B-02/B-03/B-04).
//
// One scenario shape serves all three provider doubles so the conformance
// suites stay structurally identical across adapters (case-catalog CF-B02-* /
// CF-B03-* / CF-B04-* share the B-02 base failure-mode set):
//
// - The Claude double (./claude-double.ts, Wave 0) plays scenarios through the
//   REAL ClaudeRuntime via its `queryFn` injection seam — the adapter code
//   under test runs unmodified, including its gate classification path.
// - The Codex and pi doubles (HB-024, Wave 2) implement this same
//   AdapterScenario against their own seams and EXTEND the step/outcome kinds
//   with provider-specific events (subprocess death mid-RPC, auth-rotation
//   events, extension absence). Extensions add new kinds; they never
//   repurpose the ones defined here.
//
// Terminal tool outcomes: a ScriptedToolStep may carry `terminal` outcome
// data (success/durationMs). Providers that surface tool outcomes (Codex
// today) render it onto their TurnEvents; providers that surface tool calls
// PRE-EXECUTION only (Claude, pi — B-02 documented limitation) MUST ignore
// it and never synthesize outcome fields. The Claude contract suite asserts
// exactly that.
//
// This module also owns the provider-neutral turn OBSERVATION shape and the
// adapter-contract checkers (detectors) built on it, so every adapter double
// shares one detector family (negative-control rule: each detector proves it
// fires against a seeded violation before it counts as a guard).

import type {
  Runtime,
  SessionHandle,
  TurnHooks,
  TurnRequest,
  TurnResult,
} from "../../../src/runtime/types.js";

// ---------------------------------------------------------------------------
// Scenario format
// ---------------------------------------------------------------------------

/** Usage snapshot a scripted provider reports. Cache fields omitted =
 *  provider did not report the cached/uncached split (a PARTIAL report —
 *  adapters must tolerate it, never invent the split). */
export interface ScriptedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

/** `"absent"` scripts the INV-006 seed posture: the provider reported no
 *  usage at all. Adapters must surface unknown — never a fabricated zero. */
export type ScriptedUsageReport = ScriptedUsage | "absent";

/** Which provider channel consults the gate for a tool step.
 *  - "hook": the provider's primary pre-tool channel (Claude: PreToolUse
 *    hook; Codex: the PreToolUse hook bridge over the per-turn Unix socket —
 *    the compensating enforcement boundary of CORMIDIA-C-B03-001, which sees
 *    the auto-approved reads the approval callback misses; pi: the gating
 *    extension).
 *  - "permission": the secondary/backstop channel where the provider has one
 *    (Claude: canUseTool; Codex: an App Server approval request —
 *    item/commandExecution|fileChange/requestApproval — routed through the
 *    same in-process gate). Scripting "permission" simulates a provider whose
 *    primary channel did NOT fire — the backstop must still route the action
 *    through the same gate. Doubles for providers without a secondary
 *    channel (pi) must treat "permission" as a scripting error, not skip it. */
export type GateChannel = "hook" | "permission";

export interface ScriptedToolStep {
  step: "tool";
  /** Provider-native tool name, case preserved (normalization to the gate's
   *  provider-neutral ToolAction is the adapter's job and is under test). */
  tool: string;
  input: Record<string, unknown>;
  channel?: GateChannel;
  /** Attribute this call to an intra-turn subagent (the gate must see it
   *  exactly like a main-thread call — docs/loop contract). */
  fromSubagent?: boolean;
  /** Terminal tool outcome, rendered ONLY by providers that surface one
   *  (Codex). Pre-execution providers (Claude, pi) must ignore it. */
  terminal?: { success: boolean; durationMs: number };
  /** Optional scripted latency before this step plays. */
  delayMs?: number;
}

export interface ScriptedSubagentStep {
  step: "subagent_started";
  subagentType: string;
  description: string;
  delayMs?: number;
}

/** The provider streams a mid-turn usage checkpoint (Claude: assistant
 *  message usage; Codex: token-usage update). */
export interface ScriptedUsageStep {
  step: "usage";
  usage: ScriptedUsage;
  delayMs?: number;
}

export type ScenarioStep = ScriptedToolStep | ScriptedSubagentStep | ScriptedUsageStep;

export type ScenarioOutcome =
  | {
      kind: "success";
      text: string;
      structuredOutput?: unknown;
      usage: ScriptedUsageReport;
      costUsd: number;
      durationMs: number;
    }
  | {
      kind: "failure";
      /** Provider terminal error code (Claude result subtypes today). */
      code:
        | "error_during_execution"
        | "error_max_turns"
        | "error_max_budget_usd"
        | "error_max_structured_output_retries";
      errors: string[];
      usage: ScriptedUsageReport;
      costUsd: number;
      durationMs: number;
    }
  /** Truncated: partial stream then transport drop — NO terminal result. */
  | { kind: "stream_drop"; message?: string }
  /** Malformed provider behavior: stream ends cleanly with no result. */
  | { kind: "no_result" };

export interface AdapterScenario {
  /** Session identity the scripted provider reports/restores at init. For
   *  resume-identity-mismatch scripts, set this to an id DIFFERENT from the
   *  resume handle the orchestrator passes in. */
  sessionId: string;
  steps?: ScenarioStep[];
  outcome: ScenarioOutcome;
}

// ---------------------------------------------------------------------------
// script(...) builder helpers (the thin API other suites use)
// ---------------------------------------------------------------------------

export function turn(spec: {
  sessionId: string;
  steps?: ScenarioStep[];
  outcome: ScenarioOutcome;
}): AdapterScenario {
  if (spec.sessionId.length === 0) {
    throw new Error("scenario scripting error: sessionId must be non-empty");
  }
  return {
    sessionId: spec.sessionId,
    ...(spec.steps !== undefined ? { steps: spec.steps } : {}),
    outcome: spec.outcome,
  };
}

export function success(
  text: string,
  opts: {
    usage: ScriptedUsageReport;
    costUsd?: number;
    durationMs?: number;
    structuredOutput?: unknown;
  },
): ScenarioOutcome {
  return {
    kind: "success",
    text,
    usage: opts.usage,
    costUsd: opts.costUsd ?? 0.01,
    durationMs: opts.durationMs ?? 1200,
    ...(opts.structuredOutput !== undefined ? { structuredOutput: opts.structuredOutput } : {}),
  };
}

export function failure(
  code: Extract<ScenarioOutcome, { kind: "failure" }>["code"],
  errors: string[],
  opts: { usage: ScriptedUsageReport; costUsd?: number; durationMs?: number },
): ScenarioOutcome {
  return {
    kind: "failure",
    code,
    errors,
    usage: opts.usage,
    costUsd: opts.costUsd ?? 0.01,
    durationMs: opts.durationMs ?? 1200,
  };
}

export function streamDrop(message?: string): ScenarioOutcome {
  return { kind: "stream_drop", ...(message !== undefined ? { message } : {}) };
}

export function noResult(): ScenarioOutcome {
  return { kind: "no_result" };
}

export function tool(
  toolName: string,
  input: Record<string, unknown>,
  opts: {
    channel?: GateChannel;
    fromSubagent?: boolean;
    terminal?: { success: boolean; durationMs: number };
    delayMs?: number;
  } = {},
): ScriptedToolStep {
  return {
    step: "tool",
    tool: toolName,
    input,
    ...(opts.channel !== undefined ? { channel: opts.channel } : {}),
    ...(opts.fromSubagent !== undefined ? { fromSubagent: opts.fromSubagent } : {}),
    ...(opts.terminal !== undefined ? { terminal: opts.terminal } : {}),
    ...(opts.delayMs !== undefined ? { delayMs: opts.delayMs } : {}),
  };
}

export function subagentStarted(subagentType: string, description: string): ScriptedSubagentStep {
  return { step: "subagent_started", subagentType, description };
}

export function usageUpdate(usage: ScriptedUsage): ScriptedUsageStep {
  return { step: "usage", usage };
}

/** Namespace bundle so suites can `import { script }` and stay terse. */
export const script = {
  turn,
  success,
  failure,
  streamDrop,
  noResult,
  tool,
  subagentStarted,
  usageUpdate,
};

// ---------------------------------------------------------------------------
// Provider-neutral turn observation (what a double records)
// ---------------------------------------------------------------------------

export interface RecordedGateConsultation {
  channel: GateChannel;
  toolName: string;
  toolInput: Record<string, unknown>;
  allowed: boolean;
  reason: string | undefined;
}

/** One scripted tool step as it actually played: which channels consulted
 *  the adapter, and whether the step "executed" (the scripted provider only
 *  executes a step the adapter allowed — mirroring the real CLI). */
export interface RecordedToolPlay {
  step: ScriptedToolStep;
  consultations: RecordedGateConsultation[];
  executed: boolean;
}

/** Ground truth of one played turn — what the scripted provider actually
 *  did, independent of what the adapter's TurnResult claims. The contract
 *  checkers below compare envelope claims against this record. */
export interface ScriptedTurnObservation {
  scenario: AdapterScenario;
  /** Provider reported a session identity (init reached the adapter). */
  sessionReported: boolean;
  /** Provider reported usage at ANY point (checkpoint or terminal). */
  usageReported: boolean;
  resultDelivered: boolean;
  toolPlays: RecordedToolPlay[];
  /** Append-only trace of play order ("consult:hook:Bash", "execute:Bash",
   *  "emit:usage", …). Tests may push their own markers (gate calls, event
   *  emission) to assert interleaving. */
  sequence: string[];
  endedBy: "result" | "stream_drop" | "no_result" | "abort";
}

// ---------------------------------------------------------------------------
// Adapter-contract checkers (the shared detector family)
// ---------------------------------------------------------------------------

export class AdapterContractViolation extends Error {
  readonly clause: string;
  constructor(clause: string, message: string) {
    super(`${clause}: ${message}`);
    this.name = "AdapterContractViolation";
    this.clause = clause;
  }
}

/**
 * CORMIDIA-INV-006 / core §2: when the provider reported no usage for a turn,
 * the envelope must render it as UNKNOWN (quality "unavailable") — never as
 * an authoritative figure, zero included. Fires on any other rendering.
 */
export function checkUsageAbsentRenderedUnknown(
  observation: ScriptedTurnObservation,
  result: TurnResult,
): void {
  if (observation.usageReported) return; // clause applies to usage-absent turns only
  const usage = result.usage;
  if (usage.quality !== "unavailable") {
    throw new AdapterContractViolation(
      "INV-006 usage-unknown",
      `provider reported no usage for this turn but the envelope rendered ` +
        `quality ${JSON.stringify(usage.quality ?? "<omitted>")} — unknown usage must ` +
        `surface as "unavailable", never as an authoritative zero or estimate`,
    );
  }
  const fabricated =
    usage.tokensIn !== 0 ||
    usage.tokensOut !== 0 ||
    usage.costUsd !== 0 ||
    (usage.tokensInUncached ?? 0) !== 0 ||
    (usage.cacheCreationTokens ?? 0) !== 0 ||
    (usage.cacheReadTokens ?? 0) !== 0;
  if (fabricated) {
    throw new AdapterContractViolation(
      "INV-006 usage-unknown",
      "provider reported no usage but the envelope carries nonzero token/cost figures — fabricated",
    );
  }
}

/**
 * Core §2/§4: the envelope's session identity must be the one the provider
 * actually reported/restored (ground truth from the scenario) — an adapter
 * that echoes the REQUESTED resume id back would mask a resume-identity
 * mismatch and make it undetectable downstream.
 */
export function checkSessionIdentityHonest(
  observation: ScriptedTurnObservation,
  requested: SessionHandle | undefined,
  result: TurnResult,
): void {
  if (!observation.sessionReported) return; // provider never reported identity
  const restored = observation.scenario.sessionId;
  if (result.session.id !== restored) {
    const requestedNote =
      requested !== undefined ? ` (requested resume id: ${JSON.stringify(requested.id)})` : "";
    throw new AdapterContractViolation(
      "C-CORE §4 resume-identity",
      `provider restored session ${JSON.stringify(restored)} but the envelope reports ` +
        `${JSON.stringify(result.session.id)}${requestedNote} — identity mismatches must stay observable`,
    );
  }
}

// ---------------------------------------------------------------------------
// Shared seeded ENVELOPE violations (negative controls only)
// ---------------------------------------------------------------------------

/** Result-tampering lies shared by all three adapter doubles. Each double may
 *  additionally define transport-level violations of its own (gate bypass,
 *  double-channel firing) — those live in the double, because they change how
 *  the scripted provider behaves, not what the envelope claims. */
export type EnvelopeViolation =
  /** Render a usage-absent turn as authoritative zeros (INV-006 attack). */
  | "fabricate_zero_usage"
  /** Echo the requested resume id back, masking an identity mismatch. If the
   *  real adapter under the wrapper REFUSES the mismatch with a typed
   *  resume-mismatch error (core §4, enforced by ClaudeRuntime), the lying
   *  wrapper swallows the refusal and fabricates a completed envelope — the
   *  deeper masking failure the identity detector exists to catch. */
  | "mask_resume_identity";

/** Stable machine code carried by a typed core-§4 resume-mismatch refusal.
 *  src/runtime/adapters/claude.ts throws it today; the wrapper below and the
 *  conformance suites recognize the refusal by this code, never by prose. */
export const RESUME_MISMATCH_ERROR_CODE = "error_resume_session_mismatch";

export function isTypedResumeMismatchError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as Error & { code?: unknown }).code === RESUME_MISMATCH_ERROR_CODE
  );
}

/** Deliberately lying wrapper used ONLY for negative controls: the same real
 *  adapter runs underneath; the envelope is tampered on the way out. */
export class SeededEnvelopeViolationRuntime implements Runtime {
  readonly kind: Runtime["kind"];

  constructor(
    private readonly inner: Runtime,
    private readonly violations: ReadonlySet<EnvelopeViolation>,
  ) {
    this.kind = inner.kind;
  }

  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    let result: TurnResult;
    try {
      result = await this.inner.runTurn(req, hooks);
    } catch (error) {
      if (
        this.violations.has("mask_resume_identity") &&
        req.session !== undefined &&
        isTypedResumeMismatchError(error)
      ) {
        // The lie: swallow the typed refusal and fabricate a clean envelope
        // claiming the REQUESTED session was restored.
        result = {
          status: "completed",
          summary: "masked resume (seeded violation)",
          artifacts: [],
          session: { runtime: this.kind, id: req.session.id },
          usage: {
            tokensIn: 0,
            tokensOut: 0,
            costUsd: 0,
            subagentTurns: 0,
            wallClockMs: 0,
            quality: "unavailable",
          },
          escalations: [],
        };
        return result;
      }
      throw error;
    }
    if (this.violations.has("fabricate_zero_usage")) {
      result = {
        ...result,
        usage: {
          tokensIn: 0,
          tokensInUncached: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          tokensOut: 0,
          costUsd: 0,
          subagentTurns: result.usage.subagentTurns,
          wallClockMs: result.usage.wallClockMs,
          quality: "complete", // the lie: unknown rendered as authoritative zero
        },
      };
    }
    if (this.violations.has("mask_resume_identity") && req.session !== undefined) {
      result = {
        ...result,
        session: { runtime: this.kind, id: req.session.id }, // the lie: echo, not truth
      };
    }
    return result;
  }
}

/**
 * INV-002 / core §5: every tool action the provider EXECUTED must have been
 * classified through exactly one gate consultation. Zero consultations =
 * gate bypass (the SDK stopped firing its pre-tool channel); more than one =
 * double-channel firing (the dormant backstop woke up — duplicate gate calls
 * and duplicate tool_use emission). Both are the tripwire this detector
 * exists for.
 */
export function checkEveryExecutedToolConsulted(observation: ScriptedTurnObservation): void {
  for (const play of observation.toolPlays) {
    if (!play.executed) continue;
    if (play.consultations.length === 0) {
      throw new AdapterContractViolation(
        "INV-002 gate-before-execution",
        `tool ${JSON.stringify(play.step.tool)} executed ungated — no gate channel was consulted (gate bypass)`,
      );
    }
    if (play.consultations.length > 1) {
      throw new AdapterContractViolation(
        "INV-002 gate-exactly-once",
        `tool ${JSON.stringify(play.step.tool)} was gate-consulted ${play.consultations.length} times ` +
          `for one action — both channels fired (duplicate classification/emission)`,
      );
    }
  }
}
