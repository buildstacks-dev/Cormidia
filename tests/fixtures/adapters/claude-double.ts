// tests/fixtures/adapters/claude-double.ts — scripted Anthropic
// adapter double v1 (HB-004; boundary-map B-02; contracts
// provider-adapter-core.md + B-02-anthropic.md).
//
// Seam choice: the double does NOT reimplement the runtime contract. It
// plays an AdapterScenario through the REAL ClaudeRuntime via the adapter's
// own `queryFn` injection point (src/runtime/adapters/claude.ts,
// ClaudeRuntimeOptions.queryFn) — a scripted stand-in for the Claude Agent
// SDK's query(). Consequences, all deliberate:
//
// - The gate classification path under test is the adapter's real one
//   (PreToolUse hook + canUseTool backstop → normalizeToolAction →
//   hooks.gate), not a copy that could drift. Gate suites attack the double
//   and hit product code.
// - The Runtime returned here is a real `Runtime` (kind "claude"), so
//   src/loop / src/org code drives it unmodified through their existing
//   `runtimeFor` / `runtimeForAssignment` factory options.
// - The scripted query mimics only the SDK's TRANSPORT behavior: yielding
//   messages, consulting options.hooks.PreToolUse / options.canUseTool for
//   scripted tool steps, honoring options.abortController. LLM quality is
//   layer 4 material and deliberately absent (boundary-map B-02).
//
// SDK message shapes: the scripted messages are built as the minimal
// projection of @anthropic-ai/claude-agent-sdk 0.3.x message types that
// ClaudeRuntime actually consumes, cast once at the builder boundary. Drift
// in the consumed fields breaks the adapter's own compile (it imports the
// SDK types); the projection comment on each builder names the fields.
//
// Seeded violations (negative-control rule): claudeDouble() can be
// constructed with deliberate contract violations so every detector in
// ./scenario.ts proves it fires. Violations are for negative controls ONLY.

import { setTimeout as sleep } from "node:timers/promises";
import type { Options as SdkOptions, PreToolUseHookInput, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeRuntime, type QueryFn } from "../../../src/runtime/adapters/claude.js";
import type { RoleConfig, Runtime, TurnRequest } from "../../../src/runtime/types.js";
import {
  SeededEnvelopeViolationRuntime,
  type AdapterScenario,
  type EnvelopeViolation,
  type RecordedGateConsultation,
  type RecordedToolPlay,
  type ScriptedToolStep,
  type ScriptedTurnObservation,
  type ScriptedUsage,
} from "./scenario.js";

// ---------------------------------------------------------------------------
// Seeded violations
// ---------------------------------------------------------------------------

export type SeededViolation =
  /** Envelope lies (shared wrapper, ./scenario.ts): fabricate_zero_usage,
   *  mask_resume_identity. */
  | EnvelopeViolation
  /** Execute scripted tools without consulting any gate channel (an SDK
   *  that stopped firing PreToolUse and never asked permission). */
  | "bypass_gate"
  /** Execute only SUBAGENT-attributed tool steps ungated while main-thread
   *  steps stay honestly gated (an SDK whose hook stopped firing inside
   *  subagents — the exact hole the subagent gate-ordering cases exist for). */
  | "bypass_subagent_gate"
  /** Consult BOTH the hook and the permission channel for each tool step
   *  (the dormant canUseTool backstop waking up alongside the hook). */
  | "consult_both_channels";

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

/** Provider-construction facts the scripted query observed — the contract
 *  suite asserts the adapter threads the TurnRequest through unchanged. */
export interface RecordedProviderOptions {
  model: string | undefined;
  effort: string | number | undefined;
  cwd: string | undefined;
  resume: string | undefined;
  maxTurns: number | undefined;
  maxBudgetUsd: number | undefined;
  permissionMode: string | undefined;
  settingSources: readonly string[] | undefined;
  strictMcpConfig: boolean | undefined;
  systemPromptAppend: string | undefined;
  hasOutputFormatSchema: boolean;
  outputFormatSchema: unknown;
  permissionDenyRules: string[];
}

export interface ClaudeRecordedTurn extends ScriptedTurnObservation {
  prompt: string;
  options: RecordedProviderOptions;
}

export interface ClaudeDoubleRecorder {
  readonly turns: ClaudeRecordedTurn[];
}

// ---------------------------------------------------------------------------
// The double
// ---------------------------------------------------------------------------

export interface ClaudeDoubleOptions {
  violations?: SeededViolation[];
  /** Passed through to ClaudeRuntime baseOptions (adapter-computed keys
   *  still win, exactly as in production). */
  baseOptions?: Partial<SdkOptions>;
}

export interface ClaudeDouble {
  /** A real ClaudeRuntime wired to the scripted provider (or, under seeded
   *  result violations, a thin lying wrapper around it). */
  runtime: Runtime;
  recorder: ClaudeDoubleRecorder;
}

/**
 * Build a scripted Claude adapter double. Each `runTurn()` consumes the next
 * scenario in order; over-calling throws rather than silently reusing or
 * returning undefined (mirrors the repo's canonical scriptable-double rule).
 */
export function claudeDouble(scenarios: AdapterScenario[], opts: ClaudeDoubleOptions = {}): ClaudeDouble {
  const violations: ReadonlySet<SeededViolation> = new Set(opts.violations ?? []);
  const recorder: ClaudeDoubleRecorder = { turns: [] };
  const queryFn = scriptedClaudeQuery(scenarios, recorder, violations);
  const inner = new ClaudeRuntime({
    queryFn,
    ...(opts.baseOptions !== undefined ? { baseOptions: opts.baseOptions } : {}),
  });
  const envelopeViolations = new Set<EnvelopeViolation>(
    [...violations].filter(
      (violation): violation is EnvelopeViolation =>
        violation === "fabricate_zero_usage" || violation === "mask_resume_identity",
    ),
  );
  const runtime = envelopeViolations.size > 0 ? new SeededEnvelopeViolationRuntime(inner, envelopeViolations) : inner;
  return { runtime, recorder };
}

// ---------------------------------------------------------------------------
// Convenience request builders (kept minimal; suites may lift these later)
// ---------------------------------------------------------------------------

export function doubleRole(overrides: Partial<RoleConfig> = {}): RoleConfig {
  return {
    name: "planner", // a role with no toolset-shaping deny rules by default
    runtime: "claude",
    model: "claude-scripted-model",
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: [],
    maxTurnBudgetUsd: 5,
    ...overrides,
  };
}

export function doubleTurnRequest(spec: Partial<TurnRequest> & Pick<TurnRequest, "workdir">): TurnRequest {
  const { workdir, ...rest } = spec;
  return {
    role: doubleRole(),
    workdir,
    task: "scripted task",
    context: { taste: [], memoryExcerpts: [] },
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// Scripted query (the fake SDK transport)
// ---------------------------------------------------------------------------

function scriptedClaudeQuery(
  scenarios: AdapterScenario[],
  recorder: ClaudeDoubleRecorder,
  violations: ReadonlySet<SeededViolation>,
): QueryFn {
  return (params) => playTurn(params, scenarios, recorder, violations);
}

async function* playTurn(
  params: { prompt: string; options?: SdkOptions },
  scenarios: AdapterScenario[],
  recorder: ClaudeDoubleRecorder,
  violations: ReadonlySet<SeededViolation>,
): AsyncGenerator<SDKMessage, void, unknown> {
  const index = recorder.turns.length;
  const scenario = scenarios[index];
  if (scenario === undefined) {
    throw new Error(
      `claude-double: over-called — only ${scenarios.length} scenario(s) scripted ` +
        `but this is provider construction #${index + 1}. Script one AdapterScenario per expected turn.`,
    );
  }

  const options = params.options;
  const turn: ClaudeRecordedTurn = {
    scenario,
    prompt: params.prompt,
    options: recordProviderOptions(options),
    sessionReported: false,
    usageReported: false,
    resultDelivered: false,
    toolPlays: [],
    sequence: [],
    endedBy: "no_result",
  };
  recorder.turns.push(turn);

  const signal = options?.abortController?.signal;
  const aborted = (): boolean => signal?.aborted === true;

  if (aborted()) {
    turn.endedBy = "abort";
    return;
  }

  // Record delivery before yielding. The real adapter may reject immediately
  // while consuming this init message (resume-identity mismatch) and never ask
  // the generator for another value; recording after `yield` would therefore
  // falsely claim the provider never reported the identity and neuter the
  // negative-control detector.
  turn.sessionReported = true;
  turn.sequence.push("emit:init");
  yield initMessage(scenario.sessionId);

  const steps = scenario.steps ?? [];
  for (const [stepIndex, step] of steps.entries()) {
    if (aborted()) {
      turn.endedBy = "abort";
      return;
    }
    if (step.delayMs !== undefined) await sleep(step.delayMs);

    if (step.step === "tool") {
      await playToolStep(step, stepIndex, scenario.sessionId, options, turn, violations);
    } else if (step.step === "subagent_started") {
      turn.sequence.push(`emit:subagent:${step.subagentType}`);
      yield taskStartedMessage(scenario.sessionId, step.subagentType, step.description);
    } else {
      turn.usageReported = true;
      turn.sequence.push("emit:usage");
      yield assistantUsageMessage(scenario.sessionId, step.usage);
    }
  }

  if (aborted()) {
    turn.endedBy = "abort";
    return;
  }

  const outcome = scenario.outcome;
  switch (outcome.kind) {
    case "success":
    case "failure": {
      if (outcome.usage !== "absent") turn.usageReported = true;
      turn.resultDelivered = true;
      turn.endedBy = "result";
      turn.sequence.push(`result:${outcome.kind}`);
      yield resultMessage(scenario.sessionId, outcome);
      return;
    }
    case "stream_drop": {
      turn.endedBy = "stream_drop";
      turn.sequence.push("stream_drop");
      throw new Error(outcome.message ?? "scripted stream drop: connection lost mid-stream");
    }
    case "no_result": {
      turn.endedBy = "no_result";
      turn.sequence.push("no_result");
      return;
    }
  }
}

async function playToolStep(
  step: ScriptedToolStep,
  stepIndex: number,
  sessionId: string,
  options: SdkOptions | undefined,
  turn: ClaudeRecordedTurn,
  violations: ReadonlySet<SeededViolation>,
): Promise<void> {
  const play: RecordedToolPlay = { step, consultations: [], executed: false };
  turn.toolPlays.push(play);
  const toolUseId = `toolu_scripted_${stepIndex}`;

  if (violations.has("bypass_gate") || (violations.has("bypass_subagent_gate") && step.fromSubagent === true)) {
    // Seeded violation: execute without consulting any channel.
    play.executed = true;
    turn.sequence.push(`bypass:${step.tool}`, `execute:${step.tool}`);
    return;
  }

  const channel = step.channel ?? "hook";
  let allowed: boolean | undefined;

  if (channel === "hook") {
    turn.sequence.push(`consult:hook:${step.tool}`);
    const hookDecision = await consultHookChannel(step, sessionId, toolUseId, options);
    if (hookDecision !== undefined) {
      play.consultations.push(hookDecision);
      allowed = hookDecision.allowed;
    }
  }

  const consultPermission =
    channel === "permission" || // primary channel scripted silent
    allowed === undefined || // hook did not decide → permission system asks
    violations.has("consult_both_channels"); // seeded double-fire

  if (consultPermission) {
    turn.sequence.push(`consult:permission:${step.tool}`);
    const permissionDecision = await consultPermissionChannel(step, stepIndex, options);
    play.consultations.push(permissionDecision);
    if (allowed === undefined) allowed = permissionDecision.allowed;
  }

  if (allowed === true) {
    play.executed = true;
    turn.sequence.push(`execute:${step.tool}`);
  } else {
    turn.sequence.push(`denied:${step.tool}`);
  }
}

/** Consult options.hooks.PreToolUse the way the CLI does: callbacks in
 *  order, first explicit allow/deny wins. Returns undefined when no hook
 *  decides (then the permission system would ask). */
async function consultHookChannel(
  step: ScriptedToolStep,
  sessionId: string,
  toolUseId: string,
  options: SdkOptions | undefined,
): Promise<RecordedGateConsultation | undefined> {
  const matchers = options?.hooks?.PreToolUse ?? [];
  const input: PreToolUseHookInput = {
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    transcript_path: "/scripted/transcript.jsonl",
    cwd: options?.cwd ?? "",
    tool_name: step.tool,
    tool_input: step.input,
    tool_use_id: toolUseId,
    ...(step.fromSubagent === true ? { agent_id: "scripted-subagent-1" } : {}),
  };
  const inertSignal = new AbortController().signal;
  for (const matcher of matchers) {
    for (const callback of matcher.hooks) {
      const output = await callback(input, toolUseId, { signal: inertSignal });
      if (!("hookSpecificOutput" in output) || output.hookSpecificOutput === undefined) continue;
      const specific = output.hookSpecificOutput;
      if (specific.hookEventName !== "PreToolUse") continue;
      const decision = specific.permissionDecision;
      if (decision === "allow" || decision === "deny") {
        return {
          channel: "hook",
          toolName: step.tool,
          toolInput: step.input,
          allowed: decision === "allow",
          reason: specific.permissionDecisionReason,
        };
      }
    }
  }
  return undefined;
}

async function consultPermissionChannel(
  step: ScriptedToolStep,
  stepIndex: number,
  options: SdkOptions | undefined,
): Promise<RecordedGateConsultation> {
  const canUseTool = options?.canUseTool;
  if (canUseTool === undefined) {
    throw new Error(
      "claude-double scripting error: permission-channel consultation scripted but the " +
        "adapter provided no canUseTool — ClaudeRuntime always wires one",
    );
  }
  const inertSignal = new AbortController().signal;
  const result = await canUseTool(step.tool, step.input, {
    signal: inertSignal,
    toolUseID: `toolu_scripted_${stepIndex}`,
    requestId: `req_scripted_${stepIndex}`,
  });
  if (result === null || result === undefined) {
    throw new Error(
      "claude-double scripting error: the adapter's canUseTool returned no decision — " +
        "ClaudeRuntime always answers allow or deny",
    );
  }
  const denied = result.behavior === "deny";
  return {
    channel: "permission",
    toolName: step.tool,
    toolInput: step.input,
    allowed: result.behavior === "allow",
    reason: denied ? result.message : undefined,
  };
}

// ---------------------------------------------------------------------------
// SDK message builders (minimal consumed-field projections, cast once)
// ---------------------------------------------------------------------------

/** Projection consumed by ClaudeRuntime: type, subtype, session_id. */
function initMessage(sessionId: string): SDKMessage {
  return {
    type: "system",
    subtype: "init",
    session_id: sessionId,
  } as unknown as SDKMessage;
}

/** Projection consumed: type, session_id, message.usage.{input_tokens,
 *  output_tokens, cache_creation_input_tokens?, cache_read_input_tokens?}. */
function assistantUsageMessage(sessionId: string, usage: ScriptedUsage): SDKMessage {
  return {
    type: "assistant",
    session_id: sessionId,
    message: { usage: wireUsage(usage) },
  } as unknown as SDKMessage;
}

/** Projection consumed: type, subtype, subagent_type, description. */
function taskStartedMessage(sessionId: string, subagentType: string, description: string): SDKMessage {
  return {
    type: "system",
    subtype: "task_started",
    session_id: sessionId,
    task_id: "task_scripted",
    subagent_type: subagentType,
    description,
  } as unknown as SDKMessage;
}

/** Projection consumed: type, subtype, session_id, usage, total_cost_usd,
 *  duration_ms, result/structured_output (success), errors (failure).
 *  `usage: "absent"` deliberately omits BOTH the usage key and
 *  total_cost_usd — the scripted provider reported no usage at all (the
 *  INV-006 posture; a partially-reported cost would be the `partial`
 *  posture, scripted via zero-token usage instead). */
function resultMessage(
  sessionId: string,
  outcome: Extract<AdapterScenario["outcome"], { kind: "success" | "failure" }>,
): SDKMessage {
  const usageFields =
    outcome.usage !== "absent" ? { usage: wireUsage(outcome.usage), total_cost_usd: outcome.costUsd } : {};
  if (outcome.kind === "success") {
    return {
      type: "result",
      subtype: "success",
      session_id: sessionId,
      is_error: false,
      num_turns: 1,
      duration_ms: outcome.durationMs,
      result: outcome.text,
      ...(outcome.structuredOutput !== undefined ? { structured_output: outcome.structuredOutput } : {}),
      ...usageFields,
    } as unknown as SDKMessage;
  }
  return {
    type: "result",
    subtype: outcome.code,
    session_id: sessionId,
    is_error: true,
    num_turns: 1,
    duration_ms: outcome.durationMs,
    errors: outcome.errors,
    ...usageFields,
  } as unknown as SDKMessage;
}

function wireUsage(usage: ScriptedUsage): Record<string, number> {
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    ...(usage.cacheCreationTokens !== undefined ? { cache_creation_input_tokens: usage.cacheCreationTokens } : {}),
    ...(usage.cacheReadTokens !== undefined ? { cache_read_input_tokens: usage.cacheReadTokens } : {}),
  };
}

function recordProviderOptions(options: SdkOptions | undefined): RecordedProviderOptions {
  const systemPrompt = options?.systemPrompt;
  const systemPromptAppend =
    typeof systemPrompt === "object" && systemPrompt !== null && "append" in systemPrompt
      ? (systemPrompt as { append?: string }).append
      : undefined;

  let permissionDenyRules: string[] = [];
  const settings = options?.settings;
  if (typeof settings === "object" && settings !== null) {
    const permissions = (settings as Record<string, unknown>)["permissions"];
    if (typeof permissions === "object" && permissions !== null) {
      const deny = (permissions as Record<string, unknown>)["deny"];
      if (Array.isArray(deny)) {
        permissionDenyRules = deny.filter((rule): rule is string => typeof rule === "string");
      }
    }
  }

  return {
    model: options?.model,
    effort: options?.effort,
    cwd: options?.cwd,
    resume: options?.resume,
    maxTurns: options?.maxTurns,
    maxBudgetUsd: options?.maxBudgetUsd,
    permissionMode: options?.permissionMode,
    settingSources: options?.settingSources,
    strictMcpConfig: options?.strictMcpConfig,
    systemPromptAppend,
    hasOutputFormatSchema: options?.outputFormat !== undefined,
    outputFormatSchema: options?.outputFormat?.schema,
    permissionDenyRules,
  };
}
