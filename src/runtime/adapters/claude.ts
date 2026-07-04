// Anthropic roles → Claude Agent SDK (TypeScript), in-process.
//
// Integration notes (research/2026-07-03_runtime-layer.md):
// - headless Claude Code; sessions resume/fork by id → SessionHandle.id
// - hooks + canUseTool callback → route EVERY tool action through hooks.gate
//   (session-wide, so subagents inherit the gate)
// - AgentDefinition subagents → delegation.allow maps to permitted fan-out
// - model + fallback model per options; effort maps to output effort

import type { Runtime, TurnRequest, TurnHooks, TurnResult } from "../types.js";
import { NotImplementedError } from "../types.js";

export class ClaudeRuntime implements Runtime {
  readonly kind = "claude" as const;

  async runTurn(_req: TurnRequest, _hooks: TurnHooks): Promise<TurnResult> {
    throw new NotImplementedError(
      "ClaudeRuntime.runTurn",
      "research/2026-07-03_runtime-layer.md — Claude Agent SDK (TS)",
    );
  }
}
