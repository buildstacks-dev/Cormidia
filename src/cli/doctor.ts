// `operon doctor` — check runtime adapter status.

import type { RuntimeKind } from "../runtime/types.js";
import { getRuntime, RUNTIME_KINDS } from "../runtime/registry.js";

const ADAPTER_STATUS: Record<RuntimeKind, string> = {
  claude: "claude-agent-sdk wired (M1.2) — live conformance: pnpm test:live",
  codex: "stub — see research/2026-07-03_runtime-layer.md",
  pi: "stub — see research/2026-07-03_runtime-layer.md",
};

export function cmdDoctor(): number {
  console.log("runtime adapters:");
  for (const kind of RUNTIME_KINDS) {
    const rt = getRuntime(kind); // constructing proves the adapter loads
    console.log(`  ${rt.kind.padEnd(7)} ${ADAPTER_STATUS[rt.kind]}`);
  }
  return 0;
}
