// Anthropic roles → Claude Agent SDK (TypeScript), in-process (build plan M1.2).
//
// Integration facts (research/2026-07-03_runtime-layer.md, verified against
// @anthropic-ai/claude-agent-sdk 0.3.x type definitions):
// - headless Claude Code; the SDK spawns the CLI with `--input-format
//   stream-json`, so the task prompt travels over stdin — multi-hundred-KB
//   briefs transport intact (docs/loop.md §2's ARG_MAX lesson).
// - THE GATE CHANNEL IS A PreToolUse HOOK, not canUseTool. Settled
//   empirically (live runs, 2026-07-05): canUseTool is only consulted when
//   the permission system would ask, so it NEVER sees auto-allowed
//   read-only bash (`cat .env` executed ungated in testing) and did not
//   reliably see subagent tool calls. The PreToolUse hook fires for every
//   tool use — main thread, auto-allowed commands, and subagent calls
//   (marked by `agent_id`, which the SDK docs define as "present only when
//   the hook fires from within a subagent"). canUseTool stays wired to the
//   same gate closure as a fail-closed backstop; because the hook always
//   returns an explicit allow/deny, the permission system never asks and
//   the backstop stays dormant (the conformance suite's exact
//   one-gate-call-per-action assertions are the tripwire if an SDK change
//   ever makes both channels fire).
// - `resume` restores a session by id → SessionHandle.id round-trips.
// - ContextBundle is injected via the system-prompt append channel
//   (docs/architecture.md §5, claude row: "no files written").
//   `settingSources: []` keeps the turn hermetic — the operator's personal
//   settings/CLAUDE.md never leak into an org turn, and no filesystem
//   permission rule can silently pre-approve a tool around the gate.
// - `effort` maps 1:1: the SDK's EffortLevel and our Effort are the same
//   five-level union.
//
// Event emission is deliberately minimal: exactly one TurnEvent type
// ("subagent", from task_started notifications) is emitted for now. The
// conformance harness asserts the precise event/gate interleaving for the
// subagent case; richer text/tool_use event streams arrive with the runlog
// layer (M2.6), where the harness's expectations get extended deliberately.

import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type {
  HookInput,
  HookJSONOutput,
  Options as SdkOptions,
  PermissionResult,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import * as path from "node:path";
import type {
  GateEscalation,
  Runtime,
  ToolAction,
  TurnHooks,
  TurnRequest,
  TurnResult,
} from "../types.js";

/** The SDK's query() shape, injectable so unit tests run with a scripted
 *  stand-in and zero network/CLI dependency. */
export type QueryFn = (params: {
  prompt: string;
  options?: SdkOptions;
}) => AsyncIterable<SDKMessage>;

export interface ClaudeRuntimeOptions {
  /** Test injection point; defaults to the real SDK's query(). */
  queryFn?: QueryFn;
  /** Extra SDK options merged UNDER the adapter's own — adapter-computed
   *  keys (model, cwd, resume, systemPrompt, settingSources, canUseTool,
   *  effort) always win. This is where org-level tuning and the live
   *  conformance harness's per-scenario knobs (tools, agents, maxTurns)
   *  enter. */
  baseOptions?: Partial<SdkOptions>;
}

/** Subagent-spawn tool names ("Agent" is what the CLI emits live; "Task"
 *  kept as an alias). The spawn itself is intra-turn fan-out governed by
 *  delegation policy, not an external side effect — it is allowed at the
 *  adapter level and every tool action the subagent then takes is gated
 *  individually (mirroring FakeRuntime's model, where the scripted spawn
 *  is an event and only the subagent's action hits the gate). */
const SUBAGENT_SPAWN_TOOLS = new Set(["task", "agent"]);

/**
 * Normalize an SDK tool call into the gate's provider-neutral ToolAction
 * (src/runtime/types.ts: "as seen by the gate, normalized across
 * runtimes"): lowercase tool names, `path` fields made workdir-relative so
 * gate rules reason about repo paths, and volatile advisory fields (Bash's
 * `description`, timeouts) dropped so identical intents normalize
 * identically across turns.
 */
export function normalizeToolAction(
  toolName: string,
  input: Record<string, unknown>,
  workdir: string,
): ToolAction {
  const tool = toolName.toLowerCase();
  const rel = (p: unknown): string => {
    const raw = typeof p === "string" ? p : "";
    if (path.isAbsolute(raw)) {
      const relative = path.relative(workdir, raw);
      if (relative !== "" && !relative.startsWith("..")) return relative;
    }
    return raw;
  };

  switch (tool) {
    case "bash":
      return { tool, input: { command: typeof input.command === "string" ? input.command : "" } };
    case "write":
      return { tool, input: { path: rel(input.file_path), content: input.content } };
    case "edit":
      return {
        tool,
        input: { path: rel(input.file_path), old_string: input.old_string, new_string: input.new_string },
      };
    case "read":
      return { tool, input: { path: rel(input.file_path) } };
    default:
      return { tool, input };
  }
}

/** Layers joined in ContextBundle order: org TASTE, role addendum, app
 *  override, then memory excerpts (docs/architecture.md §5). */
export function buildSystemPromptAppend(req: TurnRequest): string {
  const sections: string[] = [...req.context.taste];
  if (req.context.memoryExcerpts.length > 0) {
    sections.push(["## Memory excerpts", ...req.context.memoryExcerpts].join("\n\n"));
  }
  return sections.join("\n\n---\n\n");
}

export class ClaudeRuntime implements Runtime {
  readonly kind = "claude" as const;

  private readonly queryFn: QueryFn;
  private readonly baseOptions: Partial<SdkOptions>;

  constructor(opts: ClaudeRuntimeOptions = {}) {
    this.queryFn = opts.queryFn ?? (sdkQuery as QueryFn);
    this.baseOptions = opts.baseOptions ?? {};
  }

  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    if (req.session !== undefined && req.session.runtime !== "claude") {
      throw new Error(
        `ClaudeRuntime cannot resume a "${req.session.runtime}" session — ` +
          `cross-runtime resume is an orchestrator bug (session id: ${req.session.id})`,
      );
    }

    const escalations: GateEscalation[] = [];

    /** Single gate closure both channels route through. Returns the
     *  decision so each channel can shape its own wire response. */
    const routeThroughGate = (
      toolName: string,
      input: Record<string, unknown>,
    ): { allow: true } | { allow: false; reason: string } => {
      const action = normalizeToolAction(toolName, input, req.workdir);
      const decision = hooks.gate(action);
      if (decision.allow) return { allow: true };
      if (decision.escalate) {
        escalations.push({ action, reason: decision.reason });
      }
      return { allow: false, reason: decision.reason };
    };

    // Primary gate channel: fires for EVERY tool use, including
    // auto-allowed read-only commands and subagent calls (see header note).
    const preToolUseGate = async (input: HookInput): Promise<HookJSONOutput> => {
      if (input.hook_event_name !== "PreToolUse") return {};
      if (SUBAGENT_SPAWN_TOOLS.has(input.tool_name.toLowerCase())) {
        return {
          hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
        };
      }
      const verdict = routeThroughGate(
        input.tool_name,
        (input.tool_input ?? {}) as Record<string, unknown>,
      );
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: verdict.allow ? "allow" : "deny",
          ...(verdict.allow ? {} : { permissionDecisionReason: verdict.reason }),
        },
      };
    };

    // Fail-closed backstop: dormant while the hook decides everything (an
    // explicit hook allow/deny means the permission system never asks).
    const canUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
    ): Promise<PermissionResult> => {
      if (SUBAGENT_SPAWN_TOOLS.has(toolName.toLowerCase())) {
        return { behavior: "allow", updatedInput: input };
      }
      const verdict = routeThroughGate(toolName, input);
      return verdict.allow
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: verdict.reason };
    };

    const options: SdkOptions = {
      ...this.baseOptions,
      model: req.role.model,
      effort: req.role.effort,
      cwd: req.workdir,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: buildSystemPromptAppend(req),
      },
      settingSources: [],
      hooks: { PreToolUse: [{ hooks: [preToolUseGate] }] },
      canUseTool,
      // Per-turn budget cap, enforced by the CLI as a running mid-turn
      // guard (`--max-budget-usd`): crossing it stops the session
      // gracefully with an `error_max_budget_usd` result, which maps below
      // to status "failed" + an incident-note artifact (roles.yaml:
      // "overrun = incident note, not silent spend").
      maxBudgetUsd: req.role.maxTurnBudgetUsd,
      ...(req.session !== undefined ? { resume: req.session.id } : {}),
    };

    let sessionId = req.session?.id;
    let subagentTurns = 0;
    let resultMsg: Extract<SDKMessage, { type: "result" }> | undefined;

    for await (const message of this.queryFn({ prompt: req.task, options })) {
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
      } else if (
        message.type === "system" &&
        message.subtype === "task_started" &&
        message.subagent_type !== undefined
      ) {
        subagentTurns += 1;
        hooks.onEvent?.({
          type: "subagent",
          detail: `subagent started: ${message.subagent_type} — ${message.description}`,
        });
      } else if (message.type === "result") {
        resultMsg = message;
        sessionId = message.session_id;
      }
    }

    if (resultMsg === undefined) {
      throw new Error("ClaudeRuntime: SDK stream ended without a result message");
    }
    if (sessionId === undefined) {
      throw new Error("ClaudeRuntime: SDK never reported a session id");
    }

    const usage = resultMsg.usage;
    const budgetOverrun = resultMsg.subtype === "error_max_budget_usd";
    return {
      status: resultMsg.subtype === "success" ? "completed" : "failed",
      summary:
        resultMsg.subtype === "success"
          ? resultMsg.result.trim()
          : `${resultMsg.subtype}: ${resultMsg.errors.join("; ")}`,
      artifacts: budgetOverrun
        ? [
            {
              kind: "note",
              ref: `budget-overrun/${sessionId}`,
              summary:
                `Budget overrun: turn stopped at the per-turn cap — spent ` +
                `$${resultMsg.total_cost_usd.toFixed(4)} against maxTurnBudgetUsd ` +
                `$${req.role.maxTurnBudgetUsd} (role ${req.role.name}). ` +
                `Overrun = incident note, not silent spend (roles.yaml).`,
            },
          ]
        : [],
      session: { runtime: "claude", id: sessionId },
      usage: {
        tokensIn:
          usage.input_tokens +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0),
        tokensOut: usage.output_tokens,
        costUsd: resultMsg.total_cost_usd,
        subagentTurns,
        wallClockMs: resultMsg.duration_ms,
      },
      escalations,
    };
  }
}
