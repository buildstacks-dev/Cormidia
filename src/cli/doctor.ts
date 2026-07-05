// `operon doctor` — check runtime adapter status.

import { getRuntime, RUNTIME_KINDS } from "../runtime/registry.js";

export function cmdDoctor(): number {
  console.log("runtime adapters:");
  for (const kind of RUNTIME_KINDS) {
    const rt = getRuntime(kind);
    console.log(`  ${rt.kind.padEnd(7)} stub — see research/2026-07-03_runtime-layer.md`);
  }
  return 0;
}
