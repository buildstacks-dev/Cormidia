// One Muse hook payload -> one Claude-Code-compatible hook response.
//
// Gate events are classified through the SAME in-process GateFn as a top-level
// action, whether the caller is the parent session or a swarm child; that
// identity is the whole point of B-26's swarm clause. Muse's children run under
// their own `session_id` and only `SubagentStart` carries the `subagent_id`, so
// the router keeps the join table that makes a child's consultation and its
// paired lifecycle events attributable.

import { invokesNestedHarness } from "../role-shaping.js";
import { toolUseEvent } from "../tool-events.js";
import type { GateEscalation, ToolAction, TurnEvent, TurnHooks } from "../types.js";
import { normalizeToolAction } from "./claude.js";

const GATE_EVENTS = ["PreToolUse", "PermissionRequest"] as const;
const HANDSHAKE_EVENTS = ["SessionStart", "UserPromptSubmit"] as const;
const SUBAGENT_EVENTS = ["SubagentStart", "SubagentStop"] as const;

/** Tools that start a swarm child. Fan-out is `unsupported` on this harness, so
 *  the spawn is REFUSED rather than passed through as delegation policy: no
 *  seam covering swarm members has been proven, and an ungated swarm is never
 *  an acceptable degradation. */
const SUBAGENT_SPAWN_TOOLS = new Set(["subagent_spawn", "subagent", "task", "agent"]);

const SPAWN_DENIAL = "Cormidia denies Muse subagent spawn: intra-turn fan-out has no proven gate seam (B-26)";

export interface MuseGateConsultation {
  event: (typeof GATE_EVENTS)[number];
  action: ToolAction;
  allowed: boolean;
  /** Muse session id of the caller — the parent, or a swarm child. */
  sessionId: string | undefined;
  /** Joined from SubagentStart when the caller is a swarm child. */
  subagentId: string | undefined;
}

export interface MuseHookRouterState {
  /** True once ANY hook reached the bridge — the fail-closed handshake. */
  handshake: boolean;
  consultations: MuseGateConsultation[];
  /** child session id -> subagent id, joined at SubagentStart. */
  subagentBySession: Map<string, string>;
  subagents: Set<string>;
}

export function newMuseHookRouterState(): MuseHookRouterState {
  return { handshake: false, consultations: [], subagentBySession: new Map(), subagents: new Set() };
}

export function handleMuseHookPayload(
  input: unknown,
  workdir: string,
  hooks: TurnHooks,
  escalations: GateEscalation[],
  state: MuseHookRouterState,
): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("hook input is not an object");
  }
  const record = input as Record<string, unknown>;
  const event = String(record["hook_event_name"] ?? "");
  state.handshake = true;
  const sessionId = typeof record["session_id"] === "string" ? record["session_id"] : undefined;

  if ((HANDSHAKE_EVENTS as readonly string[]).includes(event)) return {};
  if ((SUBAGENT_EVENTS as readonly string[]).includes(event)) {
    recordSubagentLifecycle(event, record, sessionId, hooks, state);
    return {};
  }
  if (!(GATE_EVENTS as readonly string[]).includes(event)) return {};
  const gateEvent = event as (typeof GATE_EVENTS)[number];

  const toolName = typeof record["tool_name"] === "string" ? record["tool_name"] : "";
  const rawInput = record["tool_input"];
  const toolInput =
    rawInput !== null && typeof rawInput === "object" && !Array.isArray(rawInput)
      ? (rawInput as Record<string, unknown>)
      : {};
  const action = normalizeToolAction(toolName, toolInput, workdir);
  const subagentId = sessionId === undefined ? undefined : state.subagentBySession.get(sessionId);
  const refusal = adapterRefusal(action);
  if (refusal !== undefined) {
    state.consultations.push({ event: gateEvent, action, allowed: false, sessionId, subagentId });
    escalations.push({ action, reason: refusal });
    return museDenyPayload(gateEvent, refusal);
  }

  const decision = hooks.gate(action);
  state.consultations.push({ event: gateEvent, action, allowed: decision.allow, sessionId, subagentId });
  if (decision.allow) {
    // Muse fires the hook BEFORE the tool runs, so outcome fields stay unset —
    // the same pre-execution emission contract as Claude and pi.
    hooks.onEvent?.(toolUseEvent(action));
    return { hookSpecificOutput: { hookEventName: gateEvent, permissionDecision: "allow" } };
  }
  if (decision.escalate) escalations.push({ action, reason: decision.reason });
  return museDenyPayload(gateEvent, decision.reason);
}

export function museDenyPayload(event: string, reason: string): unknown {
  return {
    hookSpecificOutput: {
      hookEventName: event,
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/**
 * Refusals the adapter owns before the org gate is consulted, because allowing
 * them would defeat the gate rather than merely permit an action.
 */
function adapterRefusal(action: ToolAction): string | undefined {
  if (SUBAGENT_SPAWN_TOOLS.has(action.tool)) return SPAWN_DENIAL;
  const input = action.input;
  if (input === null || typeof input !== "object") return undefined;
  const command = (input as Record<string, unknown>)["command"];
  if (typeof command !== "string" || !invokesNestedHarness(command)) return undefined;
  // A second agent launched from inside the turn inherits no managed hook
  // root, so its tool actions never reach Cormidia at all.
  return `Cormidia denies nested harness invocation: ${command.slice(0, 200)}`;
}

function recordSubagentLifecycle(
  event: string,
  record: Record<string, unknown>,
  sessionId: string | undefined,
  hooks: TurnHooks,
  state: MuseHookRouterState,
): void {
  const declared = typeof record["subagent_id"] === "string" ? record["subagent_id"] : undefined;
  const subagentId = declared ?? (sessionId === undefined ? undefined : state.subagentBySession.get(sessionId));
  if (subagentId === undefined) return;
  if (event === "SubagentStart") {
    if (sessionId !== undefined) state.subagentBySession.set(sessionId, subagentId);
    state.subagents.add(subagentId);
  }
  const lifecycle: TurnEvent = {
    type: "subagent",
    phase: event === "SubagentStart" ? "started" : "completed",
    spanId: subagentId,
    name: typeof record["agent_type"] === "string" ? record["agent_type"] : "muse-subagent",
    detail: `muse subagent ${event === "SubagentStart" ? "started" : "completed"}: ${subagentId}`,
  };
  hooks.onEvent?.(lifecycle);
}
