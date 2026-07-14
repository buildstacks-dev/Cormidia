import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface EvalProviderScratch {
  root: string;
  home: string;
  codexHome: string;
  claudeConfigDir: string;
  /** Sanitized environment for the Claude subprocess only. On macOS its HOME
   * remains the source home so Claude Code can reach the user's encrypted
   * Keychain credential; filesystem settings and model tools are isolated by
   * the runtime options and protected-home sandbox. */
  claudeProcessEnv: NodeJS.ProcessEnv;
  claudeProtectedHome?: string;
  piAgentDir: string;
  processEnv: NodeJS.ProcessEnv;
}

/**
 * Stage only provider authentication and non-sensitive model-cache material
 * into campaign-local scratch. Provider sessions and refresh-token rotations
 * then stay inside `.eval-artifacts/<campaign>/provider-scratch`; personal
 * histories, instructions, plugins, skills, and project state are not copied.
 */
export function prepareEvalProviderScratch(
  campaignRoot: string,
  sourceEnv: NodeJS.ProcessEnv = process.env,
): EvalProviderScratch {
  const sourceHome = resolve(sourceEnv.HOME ?? homedir());
  const sourceCodexHome = resolve(sourceEnv.CODEX_HOME ?? join(sourceHome, ".codex"));
  const sourceClaudeConfig = resolve(
    sourceEnv.CLAUDE_CONFIG_DIR ?? join(sourceHome, ".claude"),
  );
  const sourcePiAgent = resolve(
    sourceEnv.PI_CODING_AGENT_DIR ?? join(sourceHome, ".pi", "agent"),
  );
  const root = resolve(campaignRoot, "provider-scratch");
  const home = join(root, "home");
  const codexHome = join(root, "codex");
  const claudeConfigDir = join(root, "claude");
  const piAgentDir = join(root, "pi");
  const tmp = join(root, "tmp");
  const xdgConfig = join(home, ".config");
  const xdgCache = join(home, ".cache");
  const xdgState = join(home, ".local", "state");
  const isolatedOrg = join(root, "operon-org");
  const isolatedState = join(root, "operon-state");
  for (const path of [
    root,
    home,
    codexHome,
    claudeConfigDir,
    piAgentDir,
    tmp,
    xdgConfig,
    xdgCache,
    xdgState,
    isolatedOrg,
    isolatedState,
  ]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }

  copyPrivateFile(join(sourceCodexHome, "auth.json"), join(codexHome, "auth.json"));
  copyPrivateFile(
    join(sourceCodexHome, "models_cache.json"),
    join(codexHome, "models_cache.json"),
  );
  copyPrivateFile(
    join(sourceClaudeConfig, ".credentials.json"),
    join(claudeConfigDir, ".credentials.json"),
  );
  copyPrivateFile(join(sourcePiAgent, "auth.json"), join(piAgentDir, "auth.json"));
  copyPrivateFile(join(sourcePiAgent, "models.json"), join(piAgentDir, "models.json"));
  // With CLAUDE_CONFIG_DIR set, Claude Code resolves its global state inside
  // that directory rather than at HOME/.claude.json.
  writeMinimalClaudeState(
    join(sourceHome, ".claude.json"),
    join(claudeConfigDir, ".claude.json"),
  );

  const processEnv = providerProcessEnv(sourceEnv, {
    home,
    codexHome,
    claudeConfigDir,
    piAgentDir,
    tmp,
    xdgConfig,
    xdgCache,
    xdgState,
    isolatedOrg,
    isolatedState,
    campaignId: campaignIdFromRoot(campaignRoot),
  });
  const claudeProcessEnv: NodeJS.ProcessEnv = {
    ...processEnv,
    CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1",
  };
  let claudeProtectedHome: string | undefined;
  if (process.platform === "darwin") {
    // Claude.ai subscription OAuth is stored in the encrypted macOS Keychain,
    // not .credentials.json. Keychain lookup is bound to Claude Code's default
    // HOME/config context, so a synthetic HOME or explicit CLAUDE_CONFIG_DIR
    // appears logged out even when the host CLI is authenticated. Only the
    // Claude subprocess receives this HOME; every other eval actor stays in
    // campaign scratch.
    claudeProcessEnv.HOME = sourceHome;
    delete claudeProcessEnv.CLAUDE_CONFIG_DIR;
    claudeProtectedHome = sourceHome;
  }
  return {
    root,
    home,
    codexHome,
    claudeConfigDir,
    claudeProcessEnv,
    ...(claudeProtectedHome !== undefined ? { claudeProtectedHome } : {}),
    piAgentDir,
    processEnv,
  };
}

/** Dedicated eval: replace, then restore, the whole environment. This keeps
 * auto-loaded host secrets out of pi's in-process shell tools as well as the
 * Claude/Codex subprocess trees. */
export async function withEvalProviderEnvironment<T>(
  env: NodeJS.ProcessEnv,
  run: () => Promise<T>,
): Promise<T> {
  const original = { ...process.env };
  replaceProcessEnv(env);
  try {
    return await run();
  } finally {
    replaceProcessEnv(original);
  }
}

function providerProcessEnv(
  source: NodeJS.ProcessEnv,
  paths: {
    home: string;
    codexHome: string;
    claudeConfigDir: string;
    piAgentDir: string;
    tmp: string;
    xdgConfig: string;
    xdgCache: string;
    xdgState: string;
    isolatedOrg: string;
    isolatedState: string;
    campaignId: string;
  },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "SHELL",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "COLORTERM",
    "USER",
    "LOGNAME",
    "__CF_USER_TEXT_ENCODING",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "SYSTEMROOT",
    "COMSPEC",
    "PATHEXT",
  ]) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return {
    ...env,
    HOME: paths.home,
    CODEX_HOME: paths.codexHome,
    CLAUDE_CONFIG_DIR: paths.claudeConfigDir,
    PI_CODING_AGENT_DIR: paths.piAgentDir,
    TMPDIR: paths.tmp,
    TMP: paths.tmp,
    TEMP: paths.tmp,
    XDG_CONFIG_HOME: paths.xdgConfig,
    XDG_CACHE_HOME: paths.xdgCache,
    XDG_STATE_HOME: paths.xdgState,
    OPERON_ORG_HOME: paths.isolatedOrg,
    OPERON_STATE_HOME: paths.isolatedState,
    OPERON_EVAL_CAMPAIGN_ID: paths.campaignId,
    OPERON_EVAL_PROVIDER_MODE: "live-isolated",
    CI: "1",
    NO_COLOR: "1",
  };
}

function copyPrivateFile(source: string, destination: string): void {
  if (!existsSync(source) || existsSync(destination)) return;
  const stat = lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`provider_credential_source_not_regular: ${source}`);
  }
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
}

function writeMinimalClaudeState(source: string, destination: string): void {
  if (!existsSync(source) || existsSync(destination)) return;
  const parsed: unknown = JSON.parse(readFileSync(source, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("provider_claude_state_invalid");
  }
  const value = parsed as Record<string, unknown>;
  const minimal: Record<string, unknown> = {};
  for (const key of ["hasCompletedOnboarding", "installMethod", "oauthAccount", "userID"]) {
    if (value[key] !== undefined) minimal[key] = value[key];
  }
  writeFileSync(destination, `${JSON.stringify(minimal, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function replaceProcessEnv(next: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) process.env[key] = value;
  }
}

function campaignIdFromRoot(campaignRoot: string): string {
  const parts = resolve(campaignRoot).split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? "unknown-eval-campaign";
}
