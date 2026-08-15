// The per-turn managed-hook installation for MuseRuntime.
//
// Two files are written into a private per-turn directory:
//
//  - `<hookDir>/hooks.json` — the hook manifest, installed through
//    `TBH_MANAGED_HOOKS_PATH` AND the `managed_hooks_path` settings key so a
//    build that honours either source is covered.
//  - `<configHome>/muse/settings.json` — an isolated config root. The
//    operator's own `~/.config/muse/settings.json` must never shape an org
//    turn, and hermeticity is pinned OFF here as well as on the command line so
//    a dropped flag still cannot ingest foreign personal rules and skills.
//
// MANIFEST SHAPE IS COPIED, NOT INVENTED. It reproduces byte-for-byte the only
// manifest ever *observed* to load: the one captured by the F-PT-028 probe
// (`research/adapters/2026-08-07_muse-code-adapter-certification.md` §7) — a top-level
// `hooks` object, PascalCase event names, `{type,command}` entries, and
// deliberately NO `matcher` and NO `timeoutMs`. Muse's loader rejects a hook
// group it cannot parse without any diagnostic, so guessing extra fields is a
// silent-failure risk with nothing to gain. The hook child bounds itself
// (`muse-gate-hook.ts` has a 5 s socket deadline), so no manifest timeout is
// needed to keep a wedged hook from hanging a turn.

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Every event the gate and its fail-closed handshake depend on. */
const MANAGED_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "SubagentStart",
  "SubagentStop",
] as const;

/** Exported so the offline pin can assert the manifest against the captured
 *  probe artifact rather than against this module's own opinion. */
export function museManagedHookManifest(command: string): Record<string, unknown> {
  const group = { hooks: [{ type: "command", command }] };
  return { hooks: Object.fromEntries(MANAGED_EVENTS.map((event) => [event, [group]])) };
}

export async function writeMuseManagedHooks(hookDir: string): Promise<void> {
  await mkdir(hookDir, { recursive: true });
  const manifest = museManagedHookManifest(museGateHookCommand());
  await writeFile(join(hookDir, "hooks.json"), `${JSON.stringify(manifest, null, 1)}\n`, {
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
