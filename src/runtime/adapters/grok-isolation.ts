// Per-turn provider isolation for the Grok Build harness.
//
// Grok merges hooks, permission rules and instruction files from `~/.grok`,
// `~/.claude` and `~/.cursor`. A turn that inherited the operator's home would
// inherit their permission mode — this operator's real config carries
// `[ui] permission_mode = "always-approve"` — and their Claude Code settings,
// which `grok inspect` confirms it loads. So every turn (and the readiness
// probe) gets a fresh HOME and a fresh GROK_HOME containing nothing but what
// Cormidia put there. The single operator byte carried across is `auth.json`,
// because request authentication is the one thing a certified turn cannot
// fabricate for itself.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Permission modes that let grok skip its own prompt pipeline. The PreToolUse
 *  hook still fires under them, but seeing one at all proves operator config
 *  reached an isolated turn — which is worth refusing over, not adapting to. */
const BYPASS_PERMISSION_MODES = new Set(["bypasspermissions", "always-approve", "auto", "dontask"]);

/** Config for the isolated provider home. No permission mode is set, so the
 *  session runs grok's `default`; the compat cells stop grok from reaching
 *  back into `~/.claude` / `~/.cursor` for rules, hooks, MCP and skills. */
const GROK_ISOLATED_CONFIG = [
  "[compat.claude]",
  "skills = false",
  "rules = false",
  "agents = false",
  "mcps = false",
  "hooks = false",
  "sessions = false",
  "",
  "[compat.cursor]",
  "skills = false",
  "rules = false",
  "agents = false",
  "mcps = false",
  "hooks = false",
  "sessions = false",
  "",
  "[compat.codex]",
  "sessions = false",
  "",
].join("\n");

/** The same cells as environment variables. Env beats config.toml in grok's
 *  resolution order, so both layers are set: the file survives a config
 *  reload, the variables survive a config file that failed to parse. */
const VENDOR_COMPAT_ENV: NodeJS.ProcessEnv = {
  GROK_CLAUDE_SKILLS_ENABLED: "0",
  GROK_CLAUDE_RULES_ENABLED: "0",
  GROK_CLAUDE_AGENTS_ENABLED: "0",
  GROK_CLAUDE_MCPS_ENABLED: "0",
  GROK_CLAUDE_HOOKS_ENABLED: "0",
  GROK_CLAUDE_SESSIONS_ENABLED: "0",
  GROK_CODEX_SKILLS_ENABLED: "0",
  GROK_CODEX_RULES_ENABLED: "0",
  GROK_CODEX_AGENTS_ENABLED: "0",
  GROK_CODEX_MCPS_ENABLED: "0",
  GROK_CODEX_HOOKS_ENABLED: "0",
  GROK_CODEX_SESSIONS_ENABLED: "0",
};

export interface IsolatedGrokHome {
  grokHome: string;
  isolatedHome: string;
  /** Whether a stored login was carried in. False means only `XAI_API_KEY` can
   *  authenticate this process — which readiness must know, because probing a
   *  login flow that cannot succeed headlessly blocks instead of answering. */
  credentialCopied: boolean;
  env: NodeJS.ProcessEnv;
  close(): Promise<void>;
}

/** Build the isolated pair inside an existing directory and copy ONLY the
 *  credential. Everything else in the operator's provider home — config,
 *  hooks, trusted folders, sessions, plugins — deliberately stays out. */
export async function materializeIsolatedGrokHome(
  grokHome: string,
  isolatedHome: string,
  sourceGrokHome?: string,
): Promise<boolean> {
  await mkdir(grokHome, { recursive: true });
  await mkdir(isolatedHome, { recursive: true });
  await writeFile(join(grokHome, "config.toml"), GROK_ISOLATED_CONFIG, { encoding: "utf8", mode: 0o600 });
  try {
    await copyFile(join(sourceGrokHome ?? defaultGrokHome(), "auth.json"), join(grokHome, "auth.json"));
    return true;
  } catch {
    return false;
  }
}

/**
 * The isolated provider home a turn uses, keyed by workdir and STABLE across
 * turns.
 *
 * Stability is a correctness requirement, not a convenience: grok stores its
 * session transcripts under `$GROK_HOME/sessions`, so a home that was recreated
 * per turn made `session/load` fail with `FS_NOT_FOUND` and destroyed exact
 * resume — the second half of the certification walk. Isolation's job is to
 * neutralize the operator's configuration, not to be ephemeral; a Cormidia-owned
 * home does that while behaving like a real provider home for resume. The
 * per-turn part that must stay per-turn is the gate socket, which travels in the
 * environment.
 *
 * Keyed by workdir so two checkouts never share a session store.
 */
export async function turnIsolatedGrokHome(
  workdir: string,
  sourceGrokHome?: string,
): Promise<{ grokHome: string; isolatedHome: string }> {
  const key = createHash("sha256").update(resolve(workdir)).digest("hex").slice(0, 16);
  const root = join(tmpdir(), "cormidia-grok", key);
  const grokHome = join(root, "home");
  const isolatedHome = join(root, "user");
  await materializeIsolatedGrokHome(grokHome, isolatedHome, sourceGrokHome);
  return { grokHome, isolatedHome };
}

/** A standalone, ephemeral isolated home for callers that need the isolation
 *  without the gate or session persistence (readiness). */
export async function createIsolatedGrokHome(sourceGrokHome?: string): Promise<IsolatedGrokHome> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-gh-"));
  const grokHome = join(root, "home");
  const isolatedHome = join(root, "user");
  try {
    const credentialCopied = await materializeIsolatedGrokHome(grokHome, isolatedHome, sourceGrokHome);
    return {
      grokHome,
      isolatedHome,
      credentialCopied,
      env: grokIsolationEnv(grokHome, isolatedHome),
      close: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

/** Environment that points grok at the isolated pair and nothing else. */
export function grokIsolationEnv(grokHome: string, isolatedHome: string): NodeJS.ProcessEnv {
  return {
    HOME: isolatedHome,
    GROK_HOME: grokHome,
    // `grok agent stdio` REJECTS `--no-auto-update` (verified against 1.0.0),
    // so the env knob is the only way to stop a self-mutating binary mid-turn.
    GROK_DISABLE_AUTOUPDATER: "1",
    ...VENDOR_COMPAT_ENV,
  };
}

/**
 * Launch argv for the ACP transport. The model is passed explicitly so
 * operator config can never substitute for an org assignment (core §1).
 *
 * Two flags are deliberately absent, both verified against grok 1.0.0:
 * `--no-auto-update` is rejected by `grok agent stdio` (see above), and
 * `--max-turns` exists only on the TUI surface — `grok agent` rejects it — so
 * `TurnRequest.maxTurns` has no native knob here and is recorded as an honest
 * absence. No effort flag is passed either: B-25 records grok's effort surface
 * as an honest absence for this adapter revision.
 */
export function grokAgentArgs(model: string): string[] {
  return ["agent", "--model", model, "stdio"];
}

export function isBypassPermissionMode(mode: string | undefined): boolean {
  return mode !== undefined && BYPASS_PERMISSION_MODES.has(mode.trim().toLowerCase());
}

export function defaultGrokHome(): string {
  const configured = process.env["GROK_HOME"];
  return configured !== undefined && configured.length > 0 ? configured : join(homedir(), ".grok");
}

/** Token-free version probe. Grok ships via an installer, never npm, so the
 *  binary is a required preinstalled dependency and Cormidia never installs
 *  a provider (#224). */
export function grokBinaryVersion(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("grok", ["--version"], { env, encoding: "utf8", timeout: 15_000 }, (error, stdout) => {
      if (error !== null) reject(error);
      else resolve(stdout.trim());
    });
  });
}
