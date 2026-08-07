import { ClaudeRuntime } from "./adapters/claude.js";
import { CodexRuntime } from "./adapters/codex.js";
import { CursorRuntime } from "./adapters/cursor.js";
import { MuseRuntime } from "./adapters/muse.js";
import { PiRuntime } from "./adapters/pi.js";
import type { Runtime, RuntimeKind } from "./types.js";

const registry: Record<RuntimeKind, () => Runtime> = {
  claude: () => new ClaudeRuntime(),
  codex: () => new CodexRuntime(),
  cursor: () => new CursorRuntime(),
  pi: () => new PiRuntime(),
  muse: () => new MuseRuntime(),
};

export function getRuntime(kind: RuntimeKind): Runtime {
  return registry[kind]();
}

/** Every registered harness, derived from the exhaustive registry rather than
 *  restated — a hand-maintained literal silently stayed three long when a
 *  fourth adapter landed, hiding it from `cormidia doctor`. */
export const RUNTIME_KINDS: RuntimeKind[] = Object.keys(registry) as RuntimeKind[];
