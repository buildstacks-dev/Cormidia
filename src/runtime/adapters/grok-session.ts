// Session lifecycle for a Grok Build turn: opening or resuming the ACP
// session, PROVING the gate before any prompt is sent, and answering the ACP
// permission backstop.
//
// The gate proof is the module's reason to exist. Grok's hook runner fails
// open on every handler failure, so a turn that observed no hook is
// indistinguishable from a turn that attempted no tool. Cormidia therefore
// requires positive evidence — a SessionStart handler that reached the
// adapter's own socket — before spending a token, and refuses with a typed
// error otherwise (F-PT-027).

import type { GateEscalation, ToolAction, TurnHooks, TurnRequest } from "../types.js";
import type { GrokAcpClient, GrokAgentMessage } from "./grok-acp-client.js";
import type { GrokGateBridge } from "./grok-gate-bridge.js";
import { isBypassPermissionMode } from "./grok-isolation.js";

/** Handshake budget. Generous because a cold provider home initializes caches
 *  before its first session, but bounded: an unproven gate is a refusal. */
const HANDSHAKE_TIMEOUT_MS = 45_000;

/** The turn's gate could not be proven live. Raised before any prompt is sent,
 *  so a refusal costs nothing: an ungated grok turn is never an acceptable
 *  degradation, and "no permission request observed" is never approval. */
export class GrokGateUnprovenError extends Error {
  readonly code = "error_gate_unproven";
  constructor(detail: string) {
    super(`GrokRuntime refused the turn: ${detail}`);
    this.name = "GrokGateUnprovenError";
  }
}

/** ACP restored a different session than the one requested. */
export class GrokSessionResumeMismatchError extends Error {
  readonly code = "error_resume_session_mismatch";
  constructor(
    readonly requestedSessionId: string,
    readonly restoredSessionId: string,
  ) {
    super(
      `GrokRuntime resume mismatch: requested session ${JSON.stringify(requestedSessionId)} ` +
        `but grok restored ${JSON.stringify(restoredSessionId)}`,
    );
    this.name = "GrokSessionResumeMismatchError";
  }
}

/** `session/new` for a fresh turn, `session/load` for an exact resume. */
export async function openGrokSession(client: GrokAcpClient, req: TurnRequest): Promise<string> {
  if (req.session === undefined) {
    const created = await client.request("session/new", { cwd: req.workdir, mcpServers: [] });
    const id = isRecord(created) && typeof created["sessionId"] === "string" ? created["sessionId"] : undefined;
    if (id === undefined) throw new Error("GrokRuntime: session/new did not return a session id");
    return id;
  }
  await client.request("session/load", { sessionId: req.session.id, cwd: req.workdir, mcpServers: [] });
  return req.session.id;
}

/**
 * Fail-closed handshake. Runs after the session exists and before the prompt.
 * Three ways to fail, all typed: the hook never reached the socket; the hook
 * reported a session grok did not give us (`session/load` returns no id of its
 * own, so the hook envelope is the only honest resume witness); or operator
 * config leaked a bypass permission mode into an isolated turn.
 */
export async function proveGrokGate(
  bridge: GrokGateBridge,
  sessionId: string,
  requestedResume?: string,
): Promise<void> {
  if (!(await bridge.awaitHandshake(HANDSHAKE_TIMEOUT_MS))) {
    throw new GrokGateUnprovenError(
      "the PreToolUse gate handshake never reached Cormidia, so tool actions this turn would not " +
        "be observed (grok hooks fail open); no prompt was sent and no tokens were spent",
    );
  }
  const observed = bridge.observedSessionId();
  if (observed !== undefined && observed !== sessionId) {
    throw new GrokSessionResumeMismatchError(requestedResume ?? sessionId, observed);
  }
  const mode = bridge.observedPermissionMode();
  if (isBypassPermissionMode(mode)) {
    throw new GrokGateUnprovenError(
      `grok resolved permission mode ${JSON.stringify(mode)} for this session, which means operator ` +
        "configuration reached an isolated turn; refusing rather than running under an unproven policy",
    );
  }
}

/** Backstop channel. The hook has already classified everything it saw, so a
 *  request arriving here is either a tool the hook allowed (grok asks anyway)
 *  or a channel the hook missed — both must traverse the same gate. */
export async function routeGrokPermission(
  client: GrokAcpClient,
  message: GrokAgentMessage,
  hooks: TurnHooks,
  escalations: GateEscalation[],
): Promise<void> {
  if (message.id === undefined) return;
  const params = isRecord(message.params) ? message.params : {};
  const toolCall = isRecord(params["toolCall"]) ? params["toolCall"] : {};
  const action: ToolAction = {
    tool: permissionToolName(toolCall),
    input: isRecord(toolCall["rawInput"]) ? toolCall["rawInput"] : {},
    ...(typeof toolCall["title"] === "string" ? { description: toolCall["title"] } : {}),
  };
  const decision = hooks.gate(action);
  if (!decision.allow && decision.escalate) escalations.push({ action, reason: decision.reason });
  const options = Array.isArray(params["options"]) ? params["options"] : [];
  const chosen = selectPermissionOption(options, decision.allow);
  // No answerable option is a fail-closed cancellation, never an approval.
  if (chosen === undefined) await client.respond(message.id, { outcome: { outcome: "cancelled" } });
  else await client.respond(message.id, { outcome: { outcome: "selected", optionId: chosen } });
}

function permissionToolName(toolCall: Record<string, unknown>): string {
  const meta = isRecord(toolCall["_meta"]) ? toolCall["_meta"] : undefined;
  const tool = isRecord(meta?.["x.ai/tool"]) ? (meta["x.ai/tool"] as Record<string, unknown>) : undefined;
  if (typeof tool?.["name"] === "string") return tool["name"];
  if (typeof toolCall["kind"] === "string") return toolCall["kind"];
  return "unknown";
}

function selectPermissionOption(options: unknown[], allow: boolean): string | undefined {
  const wanted = allow ? "allow" : "reject";
  for (const option of options) {
    if (!isRecord(option)) continue;
    const kind = typeof option["kind"] === "string" ? option["kind"] : "";
    const id = typeof option["optionId"] === "string" ? option["optionId"] : undefined;
    if (id !== undefined && kind.startsWith(wanted)) return id;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
