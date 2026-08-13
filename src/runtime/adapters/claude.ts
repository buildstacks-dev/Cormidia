// Anthropic roles → Claude Agent SDK (TypeScript), in-process (build plan M1.2).
//
// Integration facts (research/2026-07-03_runtime-layer.md, verified against
// @anthropic-ai/claude-agent-sdk 0.3.x type definitions):
// - headless Claude Code; the SDK spawns the CLI with `--input-format
//   stream-json`, so the task prompt travels over stdin — multi-hundred-KB
//   briefs transport intact (docs/loop/design.md §2's ARG_MAX lesson).
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
//   Hermeticity is TWO options, because they cover disjoint discovery paths
//   (verified against 0.3.224 type definitions, research/2026-08-07):
//   `settingSources: []` disables the user/project/local *settings* layer and
//   CLAUDE.md, so the operator's personal settings never leak into an org turn
//   and no filesystem permission rule can silently pre-approve a tool around
//   the gate. It does NOT cover MCP discovery: the SDK's own `strictMcpConfig`
//   doc names "project `.mcp.json`, user settings, plugins, and on-disk agent
//   frontmatter" as consulted unless that flag is set. `strictMcpConfig: true`
//   closes it — an app repo checked out into `req.workdir` cannot introduce
//   MCP tool surface into an org turn. The CLI's `--bare` would subsume both,
//   but 0.3.224 exposes no SDK option for it (60 `Options` keys, no `bare`)
//   and bare mode "never reads OAuth credentials or the system keychain",
//   which would break the operator subscription auth this adapter's
//   protectedHome path exists to serve. Not adopted; see the research record.
// - `effort` maps 1:1: the SDK's EffortLevel and our Effort are the same
//   five-level union.
//
// Event emission: "subagent" from task_started notifications, plus one
// "tool_use" per gate-ALLOWED tool action (issue #27) — emitted from the
// same PreToolUse channel the gate rides, so it covers main-thread and
// subagent calls alike. Emission is pre-execution (the hook fires before
// the tool runs), so outcome fields stay unset; denied attempts emit no
// tool_use — they are escalations, not tool activity. The L2 bridge
// (src/loop/pipeline.ts) turns these into tool.called rows + tool_counts.

import type {
  HookInput,
  HookJSONOutput,
  PermissionResult,
  SDKMessage,
  Options as SdkOptions,
} from "@anthropic-ai/claude-agent-sdk";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import * as path from "node:path";
import { resolveTurnRequestAssignment } from "../assignment.js";
import { gitWorktreeWritableRoots } from "../git-worktree-sandbox.js";
import { withNonInteractiveEnv } from "../non-interactive-env.js";
import { permissionModeFor, type ClaudePermissionMode } from "../permission-mode.js";
import { claudeDenyRulesForRole } from "../role-shaping.js";
import { toolUseEvent } from "../tool-events.js";
import type {
  GateEscalation,
  InterruptedReason,
  Runtime,
  ToolAction,
  TurnHooks,
  TurnRequest,
  TurnResult,
  TurnUsage,
} from "../types.js";
import { parseInterruptedReason, terminalStopFields } from "../types.js";
import { renderContextBundle } from "../worktree-context.js";
import { definedProps } from "../optional-properties.js";

/** The SDK's query() shape, injectable so unit tests run with a scripted
 *  stand-in and zero network/CLI dependency. */
export type QueryFn = (params: { prompt: string; options?: SdkOptions }) => AsyncIterable<SDKMessage>;

interface ClaudeRuntimeOptions {
  /** Test injection point; defaults to the real SDK's query(). */
  queryFn?: QueryFn;
  /** Extra SDK options merged UNDER the adapter's own — adapter-computed
   *  keys (model, cwd, resume, systemPrompt, settingSources, strictMcpConfig,
   *  canUseTool, effort) always win. This is where org-level tuning and the
   *  live conformance harness's per-scenario knobs (tools, agents, maxTurns)
   *  enter. */
  baseOptions?: Partial<SdkOptions>;
  /** Optional host home needed only for macOS Keychain-backed authentication.
   * Bash reads are sandbox-denied from this path while the turn worktree is
   * explicitly re-allowed. Writes remain confined to the SDK sandbox's cwd,
   * and the Cormidia gate applies the same worktree boundary to every tool. */
  protectedHome?: string;
}

/** Subagent-spawn tool names ("Agent" is what the CLI emits live; "Task"
 *  kept as an alias). The spawn itself is intra-turn fan-out governed by
 *  delegation policy, not an external side effect — it is allowed at the
 *  adapter level and every tool action the subagent then takes is gated
 *  individually (mirroring FakeRuntime's model, where the scripted spawn
 *  is an event and only the subagent's action hits the gate). */
const SUBAGENT_SPAWN_TOOLS = new Set(["task", "agent"]);

/** Claude Code implements `--json-schema` with a harness-owned output tool.
 * It is not an agent capability or side effect: its input is the final value
 * already constrained by the schema attached to this exact turn. Routing it
 * through the org gate lets a deny-all turn (notably EpisodePlanner) disable
 * the very structured-output contract it was admitted with. The bypass is
 * deliberately conditional on that contract being present; an ordinary tool
 * with the same name still goes through the gate. */
const STRUCTURED_OUTPUT_TOOL = "structuredoutput";

/**
 * Normalize an SDK tool call into the gate's provider-neutral ToolAction
 * (src/runtime/types.ts: "as seen by the gate, normalized across
 * runtimes"): lowercase tool names, `path` fields made workdir-relative so
 * gate rules reason about repo paths, and volatile advisory fields (Bash's
 * `description`, timeouts) dropped so identical intents normalize
 * identically across turns.
 */
export function normalizeToolAction(toolName: string, input: Record<string, unknown>, workdir: string): ToolAction {
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

/** Layers joined in ContextBundle order: authority, org TASTE, role addendum,
 * app override, then memory excerpts (docs/architecture.md §5). */
function buildSystemPromptAppend(req: TurnRequest): string {
  return renderContextBundle(req.context);
}

/** Typed core-§4 refusal: a resume that authenticates but does not restore
 *  the EXACT requested session fails closed pre-spend — it must never
 *  silently continue as a fresh/different session (validation-design
 *  contracts/provider-adapter-core.md §4; B-02 resume delta). The adapter
 *  aborts the SDK session the moment the init message reports a different
 *  session id, before any tool action or usage accrues. */
export class ClaudeSessionResumeMismatchError extends Error {
  readonly code = "error_resume_session_mismatch";
  constructor(
    readonly requestedSessionId: string,
    readonly restoredSessionId: string,
  ) {
    super(
      `ClaudeRuntime: resume requested session ${JSON.stringify(requestedSessionId)} but the ` +
        `provider restored ${JSON.stringify(restoredSessionId)} — a resume must bind the exact ` +
        `prior session; failing closed pre-spend instead of continuing on the wrong session`,
    );
    this.name = "ClaudeSessionResumeMismatchError";
  }
}

export class ClaudeRuntime implements Runtime {
  readonly kind = "claude" as const;

  private readonly queryFn: QueryFn;
  private readonly baseOptions: Partial<SdkOptions>;
  private readonly protectedHome: string | undefined;

  constructor(opts: ClaudeRuntimeOptions = {}) {
    this.queryFn = opts.queryFn ?? (sdkQuery as QueryFn);
    this.baseOptions = opts.baseOptions ?? {};
    this.protectedHome = opts.protectedHome;
  }

  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    const assignment = resolveTurnRequestAssignment(req, this.kind);
    const permissionMode = permissionModeFor("claude", req.role.permissionModes) as ClaudePermissionMode;
    if (req.session !== undefined && req.session.runtime !== "claude") {
      throw new Error(
        `ClaudeRuntime cannot resume a "${req.session.runtime}" session — ` +
          `cross-runtime resume is an orchestrator bug (session id: ${req.session.id})`,
      );
    }

    const escalations: GateEscalation[] = [];
    const abortController = new AbortController();
    const forwardAbort = (): void => abortController.abort(req.signal?.reason);
    if (req.signal?.aborted) forwardAbort();
    else req.signal?.addEventListener("abort", forwardAbort, { once: true });

    /** Single gate closure both channels route through. Returns the
     *  decision so each channel can shape its own wire response. */
    const routeThroughGate = (
      toolName: string,
      input: Record<string, unknown>,
    ): { allow: true } | { allow: false; reason: string } => {
      const action = normalizeToolAction(toolName, input, req.workdir);
      const decision = hooks.gate(action);
      if (decision.allow) {
        // The tool WILL run: emit the L2-bridgeable tool_use (issue #27).
        // Pre-execution channel — no outcome fields. The dormant canUseTool
        // backstop shares this closure, but it never fires while the hook
        // answers (the conformance one-gate-call assertions are the tripwire),
        // so no double emission.
        hooks.onEvent?.(toolUseEvent(action));
        return { allow: true };
      }
      if (decision.escalate) {
        escalations.push({ action, reason: decision.reason });
      }
      return { allow: false, reason: decision.reason };
    };

    // Primary gate channel: fires for EVERY tool use, including
    // auto-allowed read-only commands and subagent calls (see header note).
    const preToolUseGate = async (input: HookInput): Promise<HookJSONOutput> => {
      if (input.hook_event_name !== "PreToolUse") return {};
      if (req.verdictSchema !== undefined && input.tool_name.toLowerCase() === STRUCTURED_OUTPUT_TOOL) {
        return {
          hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
        };
      }
      if (SUBAGENT_SPAWN_TOOLS.has(input.tool_name.toLowerCase())) {
        return {
          hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
        };
      }
      const verdict = routeThroughGate(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>);
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
    const canUseTool = async (toolName: string, input: Record<string, unknown>): Promise<PermissionResult> => {
      if (req.verdictSchema !== undefined && toolName.toLowerCase() === STRUCTURED_OUTPUT_TOOL) {
        return { behavior: "allow", updatedInput: input };
      }
      if (SUBAGENT_SPAWN_TOOLS.has(toolName.toLowerCase())) {
        return { behavior: "allow", updatedInput: input };
      }
      const verdict = routeThroughGate(toolName, input);
      return verdict.allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: verdict.reason };
    };

    // Toolset shaping (A4/Stage 6 follow-up): role-forbidden acts are
    // denied at the CLI's own permission layer (settings.permissions.deny,
    // full rule syntax) — a builder's `gh pr merge` or ~/.claude write is
    // refused by the harness itself, before any model-visible negotiation.
    // The composed gate stays as the adapter-independent backstop.
    const denyRules = claudeDenyRulesForRole(req.role.name);
    let settings = this.baseOptions.settings;
    if (this.protectedHome !== undefined) {
      settings = protectHostHome(settings, this.protectedHome, req.workdir);
    }
    if (denyRules.length > 0) {
      if (typeof settings === "string") {
        throw new Error(
          "ClaudeRuntime: role toolset shaping cannot merge deny rules into a settings file path — " +
            "pass baseOptions.settings as an object",
        );
      }
      const base = (settings ?? {}) as Record<string, unknown>;
      const basePermissions = (base["permissions"] ?? {}) as Record<string, unknown>;
      const baseDeny = Array.isArray(basePermissions["deny"]) ? (basePermissions["deny"] as string[]) : [];
      settings = {
        ...base,
        permissions: { ...basePermissions, deny: [...baseDeny, ...denyRules] },
      } as SdkOptions["settings"];
    }
    const outputSchema = req.verdictSchema === undefined ? undefined : { ...req.verdictSchema };
    if (outputSchema !== undefined) delete outputSchema["$schema"];
    const options: SdkOptions = {
      ...this.baseOptions,
      ...definedProps({ settings }),
      env: withNonInteractiveEnv(this.baseOptions.env ?? process.env),
      model: assignment.model,
      effort: assignment.effort,
      cwd: req.workdir,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: buildSystemPromptAppend(req),
      },
      settingSources: [],
      // Second half of hermeticity (see header): settings sources and MCP
      // discovery are disjoint paths, and only this one closes `.mcp.json`,
      // plugin, and agent-frontmatter MCP servers. Servers a caller passes
      // explicitly via baseOptions.mcpServers still load, so this restricts
      // ambient discovery without removing a deliberate org-level surface.
      strictMcpConfig: true,
      permissionMode,
      hooks: { PreToolUse: [{ hooks: [preToolUseGate] }] },
      canUseTool,
      // Per-turn budget cap, enforced by the CLI as a running mid-turn
      // guard (`--max-budget-usd`): crossing it stops the session
      // gracefully with an `error_max_budget_usd` result, which maps below
      // to status "failed" + an incident-note artifact (roles.yaml:
      // "overrun = incident note, not silent spend").
      maxBudgetUsd: req.role.maxTurnBudgetUsd,
      ...(req.session !== undefined ? { resume: req.session.id } : {}),
      ...definedProps({ maxTurns: req.maxTurns }),
      // Native structured output when the pass demands a typed verdict —
      // the CLI constrains the final response to the schema, so the result
      // text (→ summary) is the JSON itself. Absent verdictSchema, the key
      // is left untouched (docs/loop/design.md §10: adapters without support
      // ignore it; here "no schema" must not clobber a baseOptions value).
      ...(outputSchema === undefined ? {} : { outputFormat: { type: "json_schema" as const, schema: outputSchema } }),
      abortController,
    };

    let sessionId = req.session?.id;
    let subagentTurns = 0;
    let resultMsg: Extract<SDKMessage, { type: "result" }> | undefined;
    let partialUsage: TurnUsage | undefined;

    try {
      for await (const message of this.queryFn({ prompt: req.task, options })) {
        if (message.type === "system" && message.subtype === "init") {
          sessionId = message.session_id;
          if (req.session !== undefined && sessionId !== undefined && sessionId !== req.session.id) {
            // Core §4 fail-closed pre-spend: stop the SDK session before any
            // tool action or usage, then surface the typed refusal.
            const mismatch = new ClaudeSessionResumeMismatchError(req.session.id, sessionId);
            abortController.abort(mismatch.message);
            throw mismatch;
          }
          if (sessionId !== undefined) {
            hooks.onProgress?.({ session: { runtime: "claude", id: sessionId } });
          }
        } else if (message.type === "assistant") {
          sessionId = message.session_id;
          partialUsage = addClaudeMessageUsage(partialUsage, message.message.usage, subagentTurns);
          hooks.onProgress?.({
            ...(sessionId !== undefined ? { session: { runtime: "claude" as const, id: sessionId } } : {}),
            usage: partialUsage,
          });
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
    } catch (error) {
      if (!req.signal?.aborted) {
        // The Agent SDK can yield a terminal error result (including
        // error_max_budget_usd) and then reject the iterator when the owned
        // CLI exits non-zero. The terminal result is the authoritative usage
        // checkpoint; throwing here discarded its real tokens/cost and made a
        // measured provider stop look like an unmeasured transport failure.
        // A success followed by an iterator failure is still suspicious and
        // remains loud; only the SDK's explicit error-result path is retained.
        if (resultMsg === undefined || resultMsg.subtype === "success") throw error;
      }
    } finally {
      req.signal?.removeEventListener("abort", forwardAbort);
    }

    if (req.signal?.aborted) {
      const descriptor = claudeStopDescriptor(req.signal.reason);
      return {
        ...terminalStopFields(descriptor),
        errorCode: descriptor.errorCode,
        summary: descriptor.reason,
        artifacts: [],
        session: { runtime: "claude", id: sessionId ?? `cancelled-${Date.now()}` },
        usage: partialUsage ?? {
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          subagentTurns,
          wallClockMs: 0,
          quality: "unavailable",
        },
        escalations,
      };
    }

    if (resultMsg === undefined) {
      throw new Error("ClaudeRuntime: SDK stream ended without a result message");
    }
    if (sessionId === undefined) {
      throw new Error("ClaudeRuntime: SDK never reported a session id");
    }

    // The SDK's types promise a usage block and cost on every terminal
    // result, but a malformed provider message can omit them. That must
    // surface as the TYPED unknown-usage outcome (INV-006: unknown ≠ zero,
    // and never an untyped TypeError): checkpointed mid-turn usage is
    // retained as `partial`; with no checkpoint the snapshot is
    // `unavailable` — zeros are the unknown marker, never a claim.
    const usage = resultMsg.usage as (typeof resultMsg)["usage"] | undefined;
    const totalCostUsd = typeof resultMsg.total_cost_usd === "number" ? resultMsg.total_cost_usd : 0;
    const wallClockMs = typeof resultMsg.duration_ms === "number" ? resultMsg.duration_ms : 0;
    const budgetOverrun = resultMsg.subtype === "error_max_budget_usd";
    let turnUsage: TurnUsage;
    if (usage !== undefined) {
      const tokensIn =
        usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
      const tokensOut = usage.output_tokens;
      turnUsage = {
        tokensIn,
        tokensInUncached: usage.input_tokens,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        tokensOut,
        costUsd: totalCostUsd,
        subagentTurns,
        wallClockMs,
        quality: totalCostUsd > 0 && tokensIn + tokensOut === 0 ? "partial" : "complete",
      };
    } else if (partialUsage !== undefined) {
      turnUsage = {
        ...partialUsage,
        costUsd: totalCostUsd > 0 ? totalCostUsd : partialUsage.costUsd,
        subagentTurns,
        wallClockMs,
        quality: "partial",
      };
    } else {
      turnUsage = {
        tokensIn: 0,
        tokensOut: 0,
        costUsd: totalCostUsd,
        subagentTurns,
        wallClockMs,
        quality: totalCostUsd > 0 ? "partial" : "unavailable",
      };
    }
    const status = budgetOverrun
      ? "failed"
      : escalations.length > 0
        ? "blocked_on_gate"
        : resultMsg.subtype === "success"
          ? "completed"
          : "failed";
    return {
      ...(resultMsg.subtype !== "success" ? { errorCode: resultMsg.subtype } : {}),
      status,
      summary:
        resultMsg.subtype === "success"
          ? structuredResultSummary(req, resultMsg)
          : `${resultMsg.subtype}: ${resultMsg.errors.join("; ")}`,
      artifacts: budgetOverrun
        ? [
            {
              kind: "note",
              ref: `budget-overrun/${sessionId}`,
              summary:
                `Budget overrun: turn stopped at the per-turn cap — spent ` +
                `$${totalCostUsd.toFixed(4)} against maxTurnBudgetUsd ` +
                `$${req.role.maxTurnBudgetUsd} (role ${req.role.name}). ` +
                `Overrun = incident note, not silent spend (roles.yaml).`,
            },
          ]
        : [],
      session: { runtime: "claude", id: sessionId },
      usage: turnUsage,
      escalations,
    };
  }
}

function structuredResultSummary(
  req: TurnRequest,
  result: Extract<SDKMessage, { type: "result"; subtype: "success" }>,
): string {
  if (req.verdictSchema !== undefined && result.structured_output !== undefined) {
    const encoded = JSON.stringify(result.structured_output);
    if (encoded !== undefined) return encoded;
  }
  return result.result.trim();
}

function protectHostHome(
  settings: SdkOptions["settings"],
  protectedHome: string,
  workdir: string,
): SdkOptions["settings"] {
  if (typeof settings === "string") {
    throw new Error(
      "ClaudeRuntime: protected-home isolation cannot merge into a settings file path — " +
        "pass baseOptions.settings as an object",
    );
  }
  const base = (settings ?? {}) as Record<string, unknown>;
  const sandbox = (base["sandbox"] ?? {}) as Record<string, unknown>;
  const filesystem = (sandbox["filesystem"] ?? {}) as Record<string, unknown>;
  const appendPath = (key: string, value: string): string[] => [
    ...new Set([
      ...(Array.isArray(filesystem[key])
        ? filesystem[key].filter((item): item is string => typeof item === "string")
        : []),
      path.resolve(value),
    ]),
  ];
  return {
    ...base,
    sandbox: {
      ...sandbox,
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        ...filesystem,
        denyRead: appendPath("denyRead", protectedHome),
        // The SDK explicitly documents allowRead as taking precedence over an
        // enclosing denyRead. Writes need no analogous home deny: its sandbox
        // already limits writes to cwd, and a parent deny could also block the
        // nested eval worktree because allowWrite is not a deny override.
        allowRead: appendPath("allowRead", workdir),
        allowWrite: gitWorktreeWritableRoots(workdir),
      },
    },
  } as SdkOptions["settings"];
}

function addClaudeMessageUsage(
  previous: TurnUsage | undefined,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  },
  subagentTurns: number,
): TurnUsage {
  const uncached = usage.input_tokens;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return {
    tokensIn: (previous?.tokensIn ?? 0) + uncached + cacheCreation + cacheRead,
    tokensInUncached: (previous?.tokensInUncached ?? 0) + uncached,
    cacheCreationTokens: (previous?.cacheCreationTokens ?? 0) + cacheCreation,
    cacheReadTokens: (previous?.cacheReadTokens ?? 0) + cacheRead,
    tokensOut: (previous?.tokensOut ?? 0) + usage.output_tokens,
    // The SDK exposes provider dollars only on the terminal result. Preserve
    // token evidence now and mark dollar cost incomplete rather than fake it.
    costUsd: previous?.costUsd ?? 0,
    subagentTurns,
    wallClockMs: previous?.wallClockMs ?? 0,
    quality: "partial",
  };
}

function claudeStopDescriptor(reason: unknown): {
  status: "cancelled" | "interrupted";
  /** REQUIRED when status is `interrupted` (CORMIDIA-C-CORE-001 §2, F-PT-017);
   *  the stop site knows why, and only the stop site can know. */
  interruptedReason?: InterruptedReason;
  errorCode: string;
  reason: string;
} {
  if (reason !== null && typeof reason === "object") {
    const value = reason as Record<string, unknown>;
    if (
      (value["status"] === "cancelled" || value["status"] === "interrupted") &&
      typeof value["errorCode"] === "string" &&
      typeof value["reason"] === "string"
    ) {
      // The reason is carried by the abort descriptor the stop site built; an
      // `interrupted` stop without one is refused downstream rather than
      // silently defaulted (terminalStopFields).
      const carried = parseInterruptedReason(value["interruptedReason"]);
      return {
        status: value["status"],
        ...(carried === undefined ? {} : { interruptedReason: carried }),
        errorCode: value["errorCode"],
        reason: value["reason"],
      };
    }
  }
  return {
    status: "cancelled",
    errorCode: "error_cancelled",
    reason: typeof reason === "string" && reason.length > 0 ? reason : "operator cancellation",
  };
}
