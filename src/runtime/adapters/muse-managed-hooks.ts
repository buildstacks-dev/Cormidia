// The per-turn managed-hook installation for MuseRuntime.
//
// Two files are written into a private per-turn directory:
//
//  - `<hookDir>/hooks.json` — the hook manifest, in the Claude-Code-compatible
//    ("foreign") matcher-group shape Muse's hook loader documents, with
//    PascalCase event names (the only spelling this build accepts). It is
//    installed through `TBH_MANAGED_HOOKS_PATH` AND the `managed_hooks_path`
//    settings key, so a build that honours either source is covered.
//  - `<configHome>/muse/settings.json` — an isolated config root. The
//    operator's own `~/.config/muse/settings.json` must never shape an org
//    turn, and hermeticity is pinned OFF here as well as on the command line so
//    a dropped flag still cannot ingest foreign personal rules and skills.

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_TIMEOUT_MS = 30_000;

/** Every event the gate and its fail-closed handshake depend on. */
const MANAGED_EVENTS = [
  { event: "SessionStart", matcher: undefined },
  { event: "UserPromptSubmit", matcher: undefined },
  { event: "PreToolUse", matcher: ".*" },
  { event: "PermissionRequest", matcher: ".*" },
  { event: "SubagentStart", matcher: undefined },
  { event: "SubagentStop", matcher: undefined },
] as const;

export async function writeMuseManagedHooks(hookDir: string): Promise<void> {
  await mkdir(hookDir, { recursive: true });
  const command = museGateHookCommand();
  const manifest: Record<string, unknown> = {};
  for (const { event, matcher } of MANAGED_EVENTS) {
    manifest[event] = [
      {
        ...(matcher === undefined ? {} : { matcher }),
        hooks: [{ type: "command", command, timeoutMs: HOOK_TIMEOUT_MS }],
      },
    ];
  }
  await writeFile(join(hookDir, "hooks.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function writeMuseIsolatedSettings(configHome: string, hookDir: string): Promise<void> {
  const museConfig = join(configHome, "muse");
  await mkdir(museConfig, { recursive: true });
  const settings = {
    schema_version: 1,
    managed_hooks_path: hookDir,
    context: { foreign_personal_rules: false, foreign_personal_skills: false },
  };
  await writeFile(join(museConfig, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function museGateHookCommand(): string {
  const adapterPath = fileURLToPath(import.meta.url);
  const sourceMode = adapterPath.endsWith(".ts");
  const helperPath = join(dirname(adapterPath), `muse-gate-hook.${sourceMode ? "ts" : "js"}`);
  const argv = sourceMode
    ? [process.execPath, "--import", createRequire(import.meta.url).resolve("tsx"), helperPath]
    : [process.execPath, helperPath];
  return argv.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
