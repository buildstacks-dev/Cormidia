import { ClaudeRuntime } from "./adapters/claude.js";
import { CodexRuntime } from "./adapters/codex.js";
import { GrokRuntime } from "./adapters/grok.js";
import { PiRuntime } from "./adapters/pi.js";
import type { Runtime, RuntimeKind } from "./types.js";

const registry: Record<RuntimeKind, () => Runtime> = {
  claude: () => new ClaudeRuntime(),
  codex: () => new CodexRuntime(),
  pi: () => new PiRuntime(),
  grok: () => new GrokRuntime(),
};

export function getRuntime(kind: RuntimeKind): Runtime {
  return registry[kind]();
}

export const RUNTIME_KINDS: RuntimeKind[] = ["claude", "codex", "pi", "grok"];
