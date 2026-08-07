// The per-turn Cursor configuration Cormidia owns inside the org-managed
// worktree, and the integrity rules that keep it NARROWING (INV-001/INV-015,
// B-24 permission-config integrity).
//
// Cormidia writes two files and reads a third:
//   .cursor/hooks.json        the gate channel (written, masked, removed)
//   .cursor/cli.json          the native deny surface (written, masked, removed)
//   ~/.cursor/cli-config.json operator-global permissions (read only)
// A pre-existing app-authored file at either written path is a typed refusal
// before provider construction — replacing it destroys app configuration and
// merging it would let an app hook answer "allow" on Cormidia's deny channel.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CURSOR_HOOKS_RELATIVE_PATH = ".cursor/hooks.json";
export const CURSOR_CLI_CONFIG_RELATIVE_PATH = ".cursor/cli.json";

/** Typed pre-spend refusal: the workdir already carries Cursor configuration
 *  Cormidia would have to replace or merge. Both directions widen. */
export class CursorConfigConflictError extends Error {
  readonly code = "error_cursor_config_conflict";
  constructor(readonly conflictingPath: string) {
    super(
      `CursorRuntime: ${JSON.stringify(conflictingPath)} already exists in the workdir. Cormidia owns ` +
        `the per-turn Cursor configuration and never replaces or merges an app-authored one — an app ` +
        `hook answering "allow" on the gate channel, or an app permissions.allow entry, would widen ` +
        `the turn. Failing closed before provider construction.`,
    );
    this.name = "CursorConfigConflictError";
  }
}

/** Typed pre-spend refusal: operator-personal global Cursor config declares an
 *  allow entry the role's shaping denies. Cormidia narrows onto Cursor's
 *  config, never widens through it. */
export class CursorGlobalConfigWiderThanRoleError extends Error {
  readonly code = "error_cursor_global_config_wider";
  constructor(readonly entries: string[]) {
    super(
      `CursorRuntime: the operator-global Cursor permissions config allows ${JSON.stringify(entries)}, ` +
        `which the role's shaping denies. Cormidia never widens through provider config; failing ` +
        `closed before provider construction.`,
    );
    this.name = "CursorGlobalConfigWiderThanRoleError";
  }
}

export function assertNoConflictingCursorConfig(workdir: string): void {
  for (const relative of [CURSOR_HOOKS_RELATIVE_PATH, CURSOR_CLI_CONFIG_RELATIVE_PATH]) {
    if (existsSync(join(workdir, relative))) throw new CursorConfigConflictError(relative);
  }
}

/**
 * Deny-wins means an operator-global `allow` cannot defeat a Cormidia deny of
 * the same act, but a global allow naming an act the role forbids is exactly
 * the "role-wider-than-configured" state B-24 requires be refused rather than
 * reasoned about. Malformed global config is refused for the same reason: an
 * unreadable permissions file is not a proven-narrow one.
 */
export function assertGlobalConfigNotWiderThanRole(denyRules: readonly string[], globalConfigPath?: string): void {
  const path = globalConfigPath ?? join(homedir(), ".cursor", "cli-config.json");
  if (!existsSync(path)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new CursorGlobalConfigWiderThanRoleError([
      `<unparseable ${path}: ${error instanceof Error ? error.message : String(error)}>`,
    ]);
  }
  const permissions = isRecord(parsed) ? parsed["permissions"] : undefined;
  const allow = isRecord(permissions) ? permissions["allow"] : undefined;
  if (!Array.isArray(allow)) return;
  const denied = new Set(denyRules.map((rule) => rule.trim()));
  const widening = allow.filter((entry): entry is string => typeof entry === "string" && denied.has(entry.trim()));
  if (widening.length > 0) throw new CursorGlobalConfigWiderThanRoleError(widening.sort());
}

/**
 * The exact per-turn `.cursor/hooks.json` bytes.
 *
 * `preToolUse` is deliberately the ONLY registered event. Cursor also fires
 * `beforeShellExecution` and `beforeReadFile` for the same action, so
 * registering those too would consult the in-process gate twice per tool
 * action — the "gate exactly once" violation the shared conformance detector
 * exists to catch. Defense in depth comes from the native deny surface below.
 *
 * `failClosed: true` is load-bearing: Cursor's documented default is
 * fail-OPEN, which would let a crashed bridge silently ungate a turn.
 */
export function cursorHooksJson(hookCommand: string): string {
  return JSON.stringify(
    {
      version: 1,
      hooks: { preToolUse: [{ command: hookCommand, type: "command", timeout: 30, failClosed: true }] },
    },
    null,
    2,
  );
}

/**
 * The exact per-turn `.cursor/cli.json` bytes.
 *
 * The deny list is the native role-shaping surface. `allow` is ALWAYS the
 * empty array: cursor-agent's config schema requires the key (omitting it
 * fails validation and the CLI exits 1 before any turn — caught in live
 * certification 2026-08-07), and empty is the only value that cannot widen.
 * Under `--force` the CLI already allows what is not explicitly denied, so an
 * empty allow list adds no permission; deny-wins keeps the role's shaping.
 */
export function cursorCliConfigJson(denyRules: readonly string[]): string {
  return JSON.stringify({ permissions: { allow: [], deny: [...denyRules] } }, null, 2);
}

/** Cursor's always-apply project rule wrapping an already-rendered bundle.
 *  The repo's own `AGENTS.md` is app context Cursor reads natively; Cormidia
 *  must never clobber it to inject a turn bundle, so the bundle rides a masked
 *  per-turn rule file instead. */
export function cursorContextRule(renderedBundle: string): string {
  return ["---", "description: Cormidia turn context", "alwaysApply: true", "---", "", renderedBundle, ""].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
