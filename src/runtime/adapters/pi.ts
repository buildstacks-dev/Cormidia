// All other models → pi (badlogic/pi-mono), embedded in-process via its SDK
// (createAgentSession from pi-coding-agent). Fallback: `pi --mode rpc`
// subprocess (LF-delimited JSONL over stdio) if in-process embedding fights us.
//
// Integration notes (research/2026-07-03_runtime-layer.md):
// - protocol via SYSTEM.md / APPEND_SYSTEM.md + AGENTS.md context files
// - KNOWN WORK ITEM: pi has no first-class approval flow — our gating
//   extension must intercept tool events and enforce hooks.gate. The gate
//   conformance suite must pass on this adapter before any pi role goes live.
// - sessions are JSONL trees; resume by session id → SessionHandle.id
// - custom providers via models.json (Google, xAI, DeepSeek, local, ...)
// - pi also speaks Anthropic/OpenAI natively — an ALL-PI org (e.g. pi + Opus)
//   is a supported first-class profile (docs/PURPOSE.md)
// - degradation to document: no native intra-turn subagent fan-out

import type { Runtime, TurnRequest, TurnHooks, TurnResult } from "../types.js";
import { NotImplementedError } from "../types.js";

export class PiRuntime implements Runtime {
  readonly kind = "pi" as const;

  async runTurn(_req: TurnRequest, _hooks: TurnHooks): Promise<TurnResult> {
    throw new NotImplementedError(
      "PiRuntime.runTurn",
      "research/2026-07-03_runtime-layer.md — pi SDK / RPC mode",
    );
  }
}
