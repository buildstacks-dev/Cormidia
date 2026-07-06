// `operon doctor` — check runtime adapter status.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RuntimeKind } from "../runtime/types.js";
import { getRuntime, RUNTIME_KINDS } from "../runtime/registry.js";

const ADAPTER_STATUS: Record<RuntimeKind, string> = {
  claude: "claude-agent-sdk wired (M1.2) — live conformance: pnpm test:live",
  codex: "app-server wired (M10) — opt-in live smoke: OPERON_CODEX_LIVE=1 pnpm test:live",
  pi: "pi SDK wired (M10) — opt-in live smoke: OPERON_PI_LIVE=1 pnpm test:live",
};

export interface DoctorOptions {
  launchAgentsDir?: string;
}

export function cmdDoctor(options: DoctorOptions = {}): number {
  console.log("runtime adapters:");
  for (const kind of RUNTIME_KINDS) {
    const rt = getRuntime(kind); // constructing proves the adapter loads
    console.log(`  ${rt.kind.padEnd(7)} ${ADAPTER_STATUS[rt.kind]}`);
  }
  printScheduler(options.launchAgentsDir ?? join(homedir(), "Library", "LaunchAgents"));
  return 0;
}

function printScheduler(launchAgentsDir: string): void {
  const plist = join(launchAgentsDir, "dev.operon.dispatch.plist");
  console.log("scheduler:");
  if (existsSync(plist)) {
    console.log(`  launchd installed: ${plist}`);
    console.log(`  unload: launchctl unload ${plist}`);
  } else {
    console.log("  launchd not installed");
    console.log(`  install: cp config/launchd/operon-dispatch.plist.template ${plist}`);
    console.log(`  load: launchctl load ${plist}`);
  }
  console.log("  systemd timer: use the same 300s cadence to run `operon dispatch`");
}
