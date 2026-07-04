// OpenAI roles → Codex app-server via the official Codex TypeScript SDK.
//
// Integration notes (research/2026-07-03_runtime-layer.md):
// - JSON-RPC 2.0 to a local `codex app-server` process (SDK manages it)
// - threads: thread/start(model) → run() → resume by thread id → SessionHandle.id
// - approval policies + sandbox modes (readOnly / workspaceWrite) → map to
//   hooks.gate; sandbox default is workspaceWrite inside the role's worktree

import type { Runtime, TurnRequest, TurnHooks, TurnResult } from "../types.js";
import { NotImplementedError } from "../types.js";

export class CodexRuntime implements Runtime {
  readonly kind = "codex" as const;

  async runTurn(_req: TurnRequest, _hooks: TurnHooks): Promise<TurnResult> {
    throw new NotImplementedError(
      "CodexRuntime.runTurn",
      "research/2026-07-03_runtime-layer.md — Codex TypeScript SDK",
    );
  }
}
