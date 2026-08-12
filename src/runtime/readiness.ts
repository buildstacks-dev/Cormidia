// Bounded, non-billable runtime readiness probes.
//
// These follow the same launch paths as the adapters but stop before a model
// turn: Claude initializes its SDK transport and reads account info; Codex
// initializes App Server and calls account/read; pi resolves every configured
// model and its credential/request configuration. A successful import or
// constructor alone is deliberately not readiness.

import {
  query as claudeQuery,
  type AccountInfo,
  type Query as ClaudeQuery,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { getAgentDir, ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { StdioCodexAppServerClient } from "./adapters/codex.js";
import { StdioGrokAcpClient } from "./adapters/grok-acp-client.js";
import { createIsolatedGrokHome, grokBinaryVersion } from "./adapters/grok-isolation.js";
import { museHandshakeArgs, resolveMuseApiKey } from "./adapters/muse-exec.js";
import { startMuseGateBridge } from "./adapters/muse-gate-bridge.js";
import { resolvePiModel } from "./adapters/pi.js";
import {
  observeClaudeAuth,
  observeCodexAuth,
  observeCursorAuth,
  observeGrokAuth,
  observeMuseAuth,
  observeStoredCredentialAuth,
  readAuthStore,
} from "./auth-mode-observers.js";
import { verifyAuthModes, type HarnessAuthDeclaration, type ObservedConnectionAuth } from "./auth-mode.js";
import { toErrorMessage as errorMessage } from "./error-message.js";
import { assessHarnessVersion, type HarnessVersionDetector } from "./harness-support.js";
import type { RuntimeKind } from "./types.js";
import { definedProps } from "./optional-properties.js";

// A clean, isolated Codex home can spend several seconds initializing its
// local App Server caches even though no model request is sent. Keep the probe
// bounded but leave enough startup headroom for that token-free first launch.
const DEFAULT_READINESS_TIMEOUT_MS = 30_000;

/** Readiness-probe outcomes are a SEPARATE vocabulary from the provider run
 *  envelope's terminal status. F-PT-017 renamed `timed_out` to `interrupted`
 *  for CORMIDIA-C-CORE-001 §2 only; a probe that misses its deadline never ran
 *  a turn, so `timed_out` stays exactly right here and the ruling is not
 *  broadened past what the owner decided. */
type RuntimeReadinessStatus =
  | "ready"
  | "missing_binary"
  | "transport_unavailable"
  | "unauthenticated"
  | "unsupported_version"
  | "misconfigured"
  | "auth_mode_mismatch"
  | "timed_out";

export interface RuntimeReadinessRequest {
  runtime: RuntimeKind;
  /** Distinct model IDs used by roles configured on this runtime. */
  models: string[];
  timeoutMs?: number;
  /** Optional complete subprocess environment for an isolated provider probe. */
  processEnv?: NodeJS.ProcessEnv;
  /** Org-declared billing for this harness connection (#333). Present =
   *  the probe VERIFIES the declaration against the real credential state and
   *  refuses a mismatch; absent = unchanged pre-#333 behaviour. */
  auth?: HarnessAuthDeclaration;
}

export interface RuntimeReadinessResult {
  runtime: RuntimeKind;
  models: string[];
  status: RuntimeReadinessStatus;
  detail: string;
  durationMs: number;
  /** Probes perform no model inference and incur no token charge. */
  billable: false;
  errorCode?: string;
  /** What the credential probe observed per provider family. Reported whether
   *  or not a declaration exists, so `cormidia doctor` can show the operator
   *  which billing each connection is actually on. */
  authModes?: readonly ObservedConnectionAuth[];
}

interface RuntimeReadinessImplementationRequest extends RuntimeReadinessRequest {
  signal: AbortSignal;
}

type ProbeOutcome = Pick<RuntimeReadinessResult, "status" | "detail"> & {
  errorCode?: string;
  /** Credential state the probe read while proving usable authentication.
   *  Populated on the `ready` path; a probe that never got that far has
   *  nothing truthful to say about which billing a turn would use. */
  observed?: readonly ObservedConnectionAuth[];
};

type RuntimeReadinessImplementation = (request: RuntimeReadinessImplementationRequest) => Promise<ProbeOutcome>;

type RuntimeReadinessImplementations = Partial<Record<RuntimeKind, RuntimeReadinessImplementation>>;

export type RuntimeReadinessProbe = (request: RuntimeReadinessRequest) => Promise<RuntimeReadinessResult>;

interface PiReadinessDependencies {
  agentDir?: string;
  createModelRuntime?: (authPath: string, modelsPath: string) => Promise<ModelRuntime>;
}

const DEFAULT_IMPLEMENTATIONS: Record<RuntimeKind, RuntimeReadinessImplementation> = {
  claude: probeClaude,
  codex: probeCodex,
  cursor: probeCursor,
  opencode: probeOpencode,
  pi: probePi,
  grok: probeGrok,
  muse: probeMuse,
};

export async function probeRuntimeReadiness(
  request: RuntimeReadinessRequest,
  implementations: RuntimeReadinessImplementations = {},
  detectVersion?: HarnessVersionDetector,
): Promise<RuntimeReadinessResult> {
  const started = Date.now();
  const timeoutMs = request.timeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`runtime readiness timeout must be positive; received ${timeoutMs}`);
  }

  // A harness below its declared floor cannot speak the interface this adapter
  // targets (#331). Refuse here, before any provider is constructed: a probe
  // that launches an unsupported harness fails later, more expensively, and in
  // a shape that reads as an auth or transport fault.
  const version = assessHarnessVersion(request.runtime, detectVersion);
  if (version.band === "below_floor") {
    return {
      runtime: request.runtime,
      models: [...new Set(request.models)].sort(),
      status: "unsupported_version",
      detail: version.detail,
      durationMs: Date.now() - started,
      billable: false,
      errorCode: "error_adapter_version_below_floor",
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<ProbeOutcome>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort("runtime readiness deadline exceeded");
      resolve({
        status: "timed_out",
        errorCode: "error_adapter_readiness_timeout",
        detail: `${request.runtime} readiness probe exceeded ${timeoutMs}ms`,
      });
    }, timeoutMs);
  });

  const implementation = implementations[request.runtime] ?? DEFAULT_IMPLEMENTATIONS[request.runtime];
  const running = implementation({ ...request, signal: controller.signal }).catch((error): ProbeOutcome => {
    if (timedOut) {
      return {
        status: "timed_out",
        errorCode: "error_adapter_readiness_timeout",
        detail: `${request.runtime} readiness probe exceeded ${timeoutMs}ms`,
      };
    }
    return classifyProbeError(error);
  });

  const outcome = await Promise.race([running, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  // A deliberately broken injected implementation may ignore the signal.
  // Do not let a late rejection become unhandled after the deadline wins.
  void running.catch(() => undefined);
  const settled = verifiedOutcome(request, outcome);
  return {
    runtime: request.runtime,
    models: [...new Set(request.models)].sort(),
    status: settled.status,
    detail: settled.detail,
    durationMs: Date.now() - started,
    billable: false,
    ...definedProps({ errorCode: settled.errorCode }),
    ...definedProps({ authModes: outcome.observed }),
  };
}

/**
 * Hold the org's declared billing against the credential state the probe just
 * read (#333). This runs AFTER usable authentication is proven, because a
 * connection with no credential has no billing mode to disagree about — that
 * is still `unauthenticated`, unchanged.
 *
 * A mismatch is terminal in both directions and never a warning: declaring
 * `subscription` while an API key is in use bills the operator for work they
 * expected their plan to cover, and declaring `api_key` while a subscription
 * credential is in use burns plan quota they never approved.
 */
function verifiedOutcome(request: RuntimeReadinessRequest, outcome: ProbeOutcome): ProbeOutcome {
  if (request.auth === undefined || outcome.status !== "ready") return outcome;
  const verdict = verifyAuthModes(request.runtime, request.auth, outcome.observed ?? []);
  if (!verdict.ok) {
    return {
      status: "auth_mode_mismatch",
      errorCode: verdict.errorCode,
      detail: verdict.detail,
      ...definedProps({ observed: outcome.observed }),
    };
  }
  return { ...outcome, detail: `${outcome.detail}; auth verified — ${verdict.detail}` };
}

async function probeClaude(request: RuntimeReadinessImplementationRequest): Promise<ProbeOutcome> {
  const abortController = new AbortController();
  const abort = (): void => abortController.abort(request.signal.reason);
  if (request.signal.aborted) abort();
  else request.signal.addEventListener("abort", abort, { once: true });

  const query = claudeQuery({
    prompt: idleClaudeInput(abortController.signal),
    options: {
      cwd: process.cwd(),
      settingSources: [],
      tools: [],
      ...definedProps({ env: request.processEnv }),
      abortController,
    },
  });
  try {
    const account = await query.accountInfo();
    const status =
      account.apiProvider !== undefined && account.apiProvider !== "firstParty"
        ? undefined
        : await claudeCliAuthStatus(request.processEnv, request.signal);
    if (!claudeAuthIsConfigured(account, status)) {
      return {
        status: "unauthenticated",
        errorCode: "error_adapter_unauthenticated",
        detail: "Claude SDK initialized, but accountInfo reported no first-party credential or external provider",
      };
    }
    const provider = account.apiProvider ?? "firstParty";
    const source =
      concreteClaudeCredentialSource(account.tokenSource) ??
      concreteClaudeCredentialSource(account.apiKeySource) ??
      status?.authMethod ??
      account.subscriptionType ??
      "configured";
    return {
      status: "ready",
      detail: `Claude SDK initialized; provider=${provider}; auth=${source}; no model turn sent`,
      observed: [
        observeClaudeAuth({
          ...definedProps({ apiProvider: account.apiProvider }),
          ...definedProps({ tokenSource: account.tokenSource }),
          ...definedProps({ apiKeySource: account.apiKeySource }),
          ...definedProps({ subscriptionType: account.subscriptionType }),
          ...definedProps({ cliAuthMethod: status?.authMethod }),
        }),
      ],
    };
  } finally {
    request.signal.removeEventListener("abort", abort);
    abortController.abort("readiness probe complete");
    await closeClaudeQuery(query);
  }
}

async function* idleClaudeInput(signal: AbortSignal): AsyncIterable<SDKUserMessage> {
  if (!signal.aborted) {
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  }
}

interface ClaudeCliAuthStatus {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  subscriptionType?: string;
}

function claudeAuthIsConfigured(account: AccountInfo, status?: ClaudeCliAuthStatus): boolean {
  if (account.apiProvider !== undefined && account.apiProvider !== "firstParty") return true;
  // email/subscriptionType are durable account metadata and can outlive the
  // credential itself. API-key/token-backed first-party auth has an explicit
  // source, while a Claude.ai subscription on macOS may be Keychain-backed and
  // leave both SDK source fields empty. In that case the Claude CLI status in
  // the exact child-process environment is the authoritative login signal.
  // Third-party providers are handled above because their auth is external
  // (AWS, gcloud, enterprise gateway, and so on).
  if (
    concreteClaudeCredentialSource(account.tokenSource) !== undefined ||
    concreteClaudeCredentialSource(account.apiKeySource) !== undefined
  )
    return true;
  return status?.loggedIn === true && (status.apiProvider === undefined || status.apiProvider === "firstParty");
}

function concreteClaudeCredentialSource(source: string | undefined): string | undefined {
  if (source === undefined) return undefined;
  const normalized = source.trim().toLowerCase();
  // The SDK uses the literal string "none" when the current process has no
  // accessible API/token source. It is a sentinel, not a credential source.
  return normalized !== "" && normalized !== "none" ? source.trim() : undefined;
}

function claudeCliAuthStatus(env: NodeJS.ProcessEnv | undefined, signal: AbortSignal): Promise<ClaudeCliAuthStatus> {
  return new Promise((resolve, reject) => {
    execFile(
      "claude",
      ["auth", "status", "--json"],
      {
        ...definedProps({ env }),
        signal,
        encoding: "utf8",
      },
      (error, stdout) => {
        try {
          const parsed: unknown = JSON.parse(stdout);
          if (!isRecord(parsed) || typeof parsed["loggedIn"] !== "boolean") {
            throw new Error("Claude auth status returned an invalid JSON payload");
          }
          resolve({
            loggedIn: parsed["loggedIn"],
            ...(typeof parsed["authMethod"] === "string" ? { authMethod: parsed["authMethod"] } : {}),
            ...(typeof parsed["apiProvider"] === "string" ? { apiProvider: parsed["apiProvider"] } : {}),
            ...(typeof parsed["subscriptionType"] === "string" ? { subscriptionType: parsed["subscriptionType"] } : {}),
          });
        } catch (parseError) {
          reject(error ?? parseError);
        }
      },
    );
  });
}

async function closeClaudeQuery(query: ClaudeQuery): Promise<void> {
  try {
    await query.return(undefined);
  } catch {
    // The abort may close the transport before the generator acknowledges
    // return. Readiness has already been classified; cleanup is best effort.
  }
}

async function probeCodex(request: RuntimeReadinessImplementationRequest): Promise<ProbeOutcome> {
  const client = new StdioCodexAppServerClient();
  const abort = (): void => {
    void client.close();
  };
  if (request.signal.aborted) abort();
  else request.signal.addEventListener("abort", abort, { once: true });
  try {
    await client.request("initialize", {
      clientInfo: { name: "cormidia-readiness", title: "Cormidia readiness", version: "0.1.0" },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: [],
      },
    });
    await client.notify("initialized");
    const raw = await client.request("account/read", { refreshToken: false });
    const response = isRecord(raw) ? raw : {};
    const account = isRecord(response["account"]) ? response["account"] : undefined;
    const requiresAuth = response["requiresOpenaiAuth"] === true;
    if (requiresAuth && account === undefined) {
      return {
        status: "unauthenticated",
        errorCode: "error_adapter_unauthenticated",
        detail: "Codex App Server initialized, but account/read reported no authenticated account",
      };
    }
    const accountType = typeof account?.["type"] === "string" ? account["type"] : "external";
    const plan = typeof account?.["planType"] === "string" ? `; plan=${account["planType"]}` : "";
    return {
      status: "ready",
      detail: `Codex App Server initialized; account=${accountType}${plan}; no model turn sent`,
      observed: [
        observeCodexAuth(accountType, typeof account?.["planType"] === "string" ? account["planType"] : undefined),
      ],
    };
  } finally {
    request.signal.removeEventListener("abort", abort);
    await client.close();
  }
}

/**
 * Cursor ships via a curl installer, so the binary is a REQUIRED PREINSTALLED
 * artifact — Cormidia never installs a provider (#224). Readiness is therefore
 * two things and no fewer: the `cursor-agent` binary is resolvable (never the
 * short alias `agent`, which is Grok Build on real operator machines), and the
 * stored login is usable or an explicit `CURSOR_API_KEY` is present.
 * `cursor-agent status` reads the stored credential without sending a model
 * request, so the probe stays non-billable.
 */
async function probeCursor(request: RuntimeReadinessImplementationRequest): Promise<ProbeOutcome> {
  const env = request.processEnv ?? process.env;
  const version = (await runCursorAgent(["--version"], env, request.signal)).stdout.trim();
  const status = await runCursorAgent(["status"], env, request.signal);
  const output = `${status.stdout}\n${status.stderr}`.trim();
  const apiKeySet = typeof env["CURSOR_API_KEY"] === "string" && env["CURSOR_API_KEY"].trim().length > 0;
  const storedLogin = status.code === 0 && /logged in/i.test(output);
  if (storedLogin) {
    return {
      status: "ready",
      detail: `cursor-agent ${version} reports a usable stored login (${firstLine(output)}); no model turn sent`,
      observed: [observeCursorAuth({ storedLogin, apiKeySet })],
    };
  }
  if (apiKeySet) {
    return {
      status: "ready",
      detail: `cursor-agent ${version} has no stored login, but CURSOR_API_KEY is set; no model turn sent`,
      observed: [observeCursorAuth({ storedLogin, apiKeySet })],
    };
  }
  return {
    status: "unauthenticated",
    errorCode: "error_adapter_unauthenticated",
    detail:
      `cursor-agent ${version} reports no usable credential ` +
      `(${firstLine(output) || `status exited ${status.code}`}); run \`cursor-agent login\` or set CURSOR_API_KEY`,
  };
}

function runCursorAgent(
  args: string[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("cursor-agent", args, { env, signal, encoding: "utf8" }, (error, stdout, stderr) => {
      const code = (error as (Error & { code?: unknown }) | null)?.code;
      if (error !== null && typeof code !== "number") {
        // ENOENT and friends carry a string code — classifyProbeError turns
        // those into missing_binary rather than a misconfiguration.
        reject(error);
        return;
      }
      resolve({ code: typeof code === "number" ? code : 0, stdout, stderr });
    });
  });
}

function firstLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ""
  );
}

/**
 * Grok Build readiness.
 *
 * Grok ships via an installer, never npm, so the binary is a *required
 * preinstalled* dependency (#224) and its absence is `missing_binary`, not a
 * Cormidia bug to work around. Readiness then means usable request
 * authentication, proved through ACP `authenticate`, which resolves the stored
 * credential (or `XAI_API_KEY`) against the vendor and returns account
 * metadata without sending a model request.
 *
 * The credential-source check before that call is load-bearing, not a
 * shortcut: with no credential at all, `authenticate` starts an interactive
 * login flow that a headless probe can never complete, so it would hang until
 * the deadline instead of reporting the honest answer. The probe runs in the
 * same per-turn isolated provider home the adapter uses, so a green result
 * describes the environment a turn will actually get.
 */
async function probeGrok(request: RuntimeReadinessImplementationRequest): Promise<ProbeOutcome> {
  const version = await grokBinaryVersion(request.processEnv ?? process.env);
  const isolated = await createIsolatedGrokHome();
  const apiKey = (request.processEnv ?? process.env)["XAI_API_KEY"];
  const hasApiKey = typeof apiKey === "string" && apiKey.trim().length > 0;
  if (!isolated.credentialCopied && !hasApiKey) {
    await isolated.close();
    return {
      status: "unauthenticated",
      errorCode: "error_adapter_unauthenticated",
      detail: `grok ${version} is installed, but no stored login (auth.json) and no XAI_API_KEY were found`,
    };
  }
  const client = new StdioGrokAcpClient({
    args: ["agent", "stdio"],
    env: { ...(request.processEnv ?? process.env), ...isolated.env },
  });
  const abort = (): void => {
    void client.close();
  };
  if (request.signal.aborted) abort();
  else request.signal.addEventListener("abort", abort, { once: true });
  try {
    const initialize = await client.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "cormidia-readiness", title: "Cormidia readiness", version: "0.1.0" },
    });
    const result = isRecord(initialize) ? initialize : {};
    if (result["protocolVersion"] !== 1) {
      return {
        status: "misconfigured",
        errorCode: "error_adapter_misconfigured",
        detail: `grok ${version} negotiated ACP protocolVersion ${JSON.stringify(result["protocolVersion"])}; Cormidia speaks 1`,
      };
    }
    const meta = isRecord(result["_meta"]) ? result["_meta"] : {};
    const defaultMethod = typeof meta["defaultAuthMethodId"] === "string" ? meta["defaultAuthMethodId"] : undefined;
    // grok answers `initialize` with `defaultAuthMethodId: null` and drops
    // `cached_token` from `authMethods` when it found no usable credential.
    // Probed 2026-08-07: calling `authenticate` in that state starts a browser
    // login and fails ten minutes later, so classify it here instead.
    if (!hasApiKey && defaultMethod === undefined) {
      return {
        status: "unauthenticated",
        errorCode: "error_adapter_unauthenticated",
        detail: `grok ${version} offered no usable auth method; the stored login is missing or expired (run \`grok login\`)`,
      };
    }
    const methodId = hasApiKey ? "api_key" : (defaultMethod ?? "cached_token");
    const account = await client.request("authenticate", { methodId });
    const accountMeta = isRecord(account) && isRecord(account["_meta"]) ? account["_meta"] : {};
    const mode = typeof accountMeta["auth_mode"] === "string" ? accountMeta["auth_mode"] : methodId;
    const tier =
      typeof accountMeta["subscription_tier"] === "string" ? `; tier=${accountMeta["subscription_tier"]}` : "";
    return {
      status: "ready",
      detail: `grok ${version} authenticated over ACP; method=${methodId}; mode=${mode}${tier}; no model turn sent`,
      observed: [observeGrokAuth({ apiKeySet: hasApiKey, methodId })],
    };
  } finally {
    request.signal.removeEventListener("abort", abort);
    await client.close();
    await isolated.close();
  }
}

/**
 * OpenCode readiness: the operator's preinstalled binary (never installed by
 * Cormidia, #224), its version band (#331), and — the part that actually
 * matters — a provider roster resolved from the real auth store. `/config/providers`
 * lists only providers whose credential resolves, so a model whose provider is
 * absent is `unauthenticated`, and a model absent from a present provider's
 * roster is `misconfigured`. No model turn is sent and no token is spent.
 */
async function probeOpencode(request: RuntimeReadinessImplementationRequest): Promise<ProbeOutcome> {
  const { resolveOpencodeBinary, startOpencodeServer } = await import("./adapters/opencode-server.js");
  const { execFile: execFileAsync } = await import("node:child_process");
  const { promisify: promisifyAsync } = await import("node:util");
  if (request.models.length === 0) {
    return {
      status: "misconfigured",
      errorCode: "error_adapter_misconfigured",
      detail: "opencode readiness requires at least one configured role model",
    };
  }
  const binary = resolveOpencodeBinary(request.processEnv ?? process.env);
  const { stdout: versionOut } = await promisifyAsync(execFileAsync)(binary, ["--version"], {
    encoding: "utf8",
    timeout: 15_000,
  });
  const version = versionOut.trim().split(/\r?\n/).pop() ?? "unknown";
  const server = await startOpencodeServer({
    workdir: process.cwd(),
    inlineConfig: { $schema: "https://opencode.ai/config.json", mcp: {}, share: "disabled", autoupdate: false },
    bridgeEnv: {},
    ...definedProps({ extraEnv: request.processEnv }),
    startTimeoutMs: 45_000,
  });
  try {
    const response = await fetch(`${server.url}/config/providers`, { signal: request.signal });
    const parsed: unknown = await response.json();
    const providers = isRecord(parsed) && Array.isArray(parsed["providers"]) ? parsed["providers"] : [];
    const roster = new Map<string, Set<string>>();
    for (const entry of providers) {
      if (!isRecord(entry) || typeof entry["id"] !== "string") continue;
      roster.set(entry["id"], new Set(isRecord(entry["models"]) ? Object.keys(entry["models"]) : []));
    }
    const checked: string[] = [];
    const observed = new Map<string, ObservedConnectionAuth>();
    // `opencode auth login` writes type-tagged records here (`oauth` for a
    // plan login, `api`/`wellknown` for a key) — the same store
    // `opencode auth list` renders. An unreadable store stays `undefined` and
    // every observation from it is indeterminate rather than guessed.
    const authRecords = await readAuthStore(opencodeAuthStorePath(request.processEnv ?? process.env));
    for (const model of [...new Set(request.models)].sort()) {
      const separator = model.indexOf("/");
      if (separator <= 0) {
        return {
          status: "misconfigured",
          errorCode: "error_adapter_misconfigured",
          detail: `opencode model ${model} is not an exact provider/model identifier`,
        };
      }
      const providerId = model.slice(0, separator);
      const models = roster.get(providerId);
      if (models === undefined) {
        return {
          status: "unauthenticated",
          errorCode: "error_adapter_unauthenticated",
          detail:
            `opencode provider ${providerId} has no resolvable credential ` +
            `(reachable providers: ${[...roster.keys()].sort().join(", ") || "none"})`,
        };
      }
      if (!models.has(model.slice(separator + 1))) {
        return {
          status: "misconfigured",
          errorCode: "error_adapter_misconfigured",
          detail: `opencode model ${model} is absent from provider ${providerId}'s roster`,
        };
      }
      checked.push(model);
      observed.set(
        providerId,
        // Every provider in the roster HAS a resolvable credential, so a
        // provider with no stored record was credentialed from the
        // environment — and an environment credential is always a metered key.
        observeStoredCredentialAuth(providerId, authRecords?.[providerId], authRecords !== undefined),
      );
    }
    return {
      status: "ready",
      detail: `opencode ${version} at ${binary}; credentialed providers resolved for ${checked.join(", ")}; no model turn sent`,
      observed: [...observed.values()],
    };
  } finally {
    await server.close();
  }
}

/** The documented OpenCode credential store
 *  (`research/2026-08-06_adapter-upstream-references.md`), honouring the same
 *  XDG data home the adapter deliberately leaves in place. */
function opencodeAuthStorePath(env: NodeJS.ProcessEnv): string {
  const dataHome = env["XDG_DATA_HOME"];
  const base =
    typeof dataHome === "string" && dataHome.trim().length > 0
      ? dataHome
      : join(env["HOME"] ?? homedir(), ".local", "share");
  return join(base, "opencode", "auth.json");
}

async function probePi(
  request: RuntimeReadinessImplementationRequest,
  dependencies: PiReadinessDependencies = {},
): Promise<ProbeOutcome> {
  if (request.models.length === 0) {
    return {
      status: "misconfigured",
      errorCode: "error_adapter_misconfigured",
      detail: "pi readiness requires at least one configured role model",
    };
  }
  const agentDir = dependencies.agentDir ?? getAgentDir();
  const authPath = join(agentDir, "auth.json");
  // pi stores one type-tagged credential per provider; the records are what
  // says whether a family is reached on an OAuth login or a metered key (#333).
  let authRecords: Record<string, unknown> = {};
  if (existsSync(authPath)) {
    try {
      const parsed: unknown = JSON.parse(await readFile(authPath, "utf8"));
      if (!isRecord(parsed)) throw new Error("expected a provider-to-credential mapping");
      authRecords = parsed;
    } catch (error) {
      return {
        status: "misconfigured",
        errorCode: "error_adapter_misconfigured",
        detail: `pi auth store is unreadable: ${errorMessage(error)}`,
      };
    }
  }
  // OAuth resolution may rotate a refresh token. Readiness must use the same
  // file-backed store as PiRuntime so a successful refresh is persisted for
  // the subsequent turn; the old in-memory copy consumed the rotation and
  // then discarded it, making a green probe break the live runtime. pi 0.84
  // builds that store inside ModelRuntime from `authPath`; `allowModelNetwork`
  // stays default-false so the probe remains offline and non-billable.
  const modelRuntime = await (dependencies.createModelRuntime ?? createPiModelRuntime)(
    authPath,
    join(agentDir, "models.json"),
  );
  const registry = new ModelRegistry(modelRuntime);
  const registryError = registry.getError();
  if (registryError !== undefined) {
    return {
      status: "misconfigured",
      errorCode: "error_adapter_misconfigured",
      detail: `pi model registry is invalid: ${registryError}`,
    };
  }

  const checked: string[] = [];
  const observed = new Map<string, ObservedConnectionAuth>();
  for (const requestedModel of [...new Set(request.models)].sort()) {
    if (request.signal.aborted) throw new Error("pi readiness probe aborted");
    const model = resolvePiModel(registry, requestedModel);
    if (model === undefined) {
      return {
        status: "misconfigured",
        errorCode: "error_adapter_misconfigured",
        detail: `pi model is absent from the active registry: ${requestedModel}`,
      };
    }
    const provider = String(model.provider);
    if (!registry.hasConfiguredAuth(model)) {
      const auth = registry.getProviderAuthStatus(provider);
      return {
        status: "unauthenticated",
        errorCode: "error_adapter_unauthenticated",
        detail:
          `pi model ${requestedModel} has no configured credential ` +
          `(provider=${provider}, source=${auth.source ?? "none"})`,
      };
    }
    const resolved = await registry.getApiKeyAndHeaders(model);
    if (!resolved.ok) {
      return {
        status: "unauthenticated",
        errorCode: "error_adapter_unauthenticated",
        detail: `pi model ${requestedModel} credential resolution failed: ${resolved.error}`,
      };
    }
    // hasConfiguredAuth() is intentionally a cheap presence check. An expired
    // OAuth record can satisfy it even when refresh fails; in that case pi's
    // current registry returns ok:true with no apiKey and the provider turn
    // later fails with "No API key". Require the same concrete request key the
    // SDK will pass to streamSimple before claiming readiness.
    if (typeof resolved.apiKey !== "string" || resolved.apiKey.trim().length === 0) {
      const auth = registry.getProviderAuthStatus(provider);
      return {
        status: "unauthenticated",
        errorCode: "error_adapter_unauthenticated",
        detail:
          `pi model ${requestedModel} credential resolution produced no API key ` +
          `(provider=${provider}, source=${auth.source ?? "none"})`,
      };
    }
    checked.push(`${requestedModel} (${provider})`);
    observed.set(
      provider,
      observeStoredCredentialAuth(
        provider,
        authRecords[provider],
        registry.getProviderAuthStatus(provider).source === "environment",
      ),
    );
  }
  return {
    status: "ready",
    detail: `pi model/auth resolution succeeded: ${checked.join(", ")}; no model turn sent`,
    observed: [...observed.values()],
  };
}

function createPiModelRuntime(authPath: string, modelsPath: string): Promise<ModelRuntime> {
  return ModelRuntime.create({ authPath, modelsPath });
}

/**
 * Muse Code readiness: the preinstalled binary (Cormidia never installs a
 * provider, #224), a usable API key, and — because `muse exec` auto-approves
 * headlessly — proof that the managed-hook gate seam is live. A harness whose
 * gate cannot be proven is not ready: every turn would refuse, and discovering
 * that inside a paid turn is exactly what this probe exists to prevent.
 */
async function probeMuse(request: RuntimeReadinessImplementationRequest): Promise<ProbeOutcome> {
  const env = request.processEnv ?? process.env;
  const version = await museVersion(env, request.signal);
  const key = await resolveMuseApiKey(env);
  if (key === undefined) {
    return {
      status: "unauthenticated",
      errorCode: "error_adapter_unauthenticated",
      detail:
        `muse ${version} is installed, but no API key is resolvable from the operator's ` +
        `configured source (CORMIDIA_MUSE_API_KEY_FILE, CORMIDIA_MUSE_API_KEY, MUSE_API_KEY, META_API_KEY)`,
    };
  }
  const keySource = museApiKeySource(env);
  const seam = await probeMuseGateSeam(env);
  if (!seam) {
    return {
      status: "misconfigured",
      errorCode: "error_adapter_gate_seam_unavailable",
      detail:
        `muse ${version} is installed and authenticated, but no managed hook reached the Cormidia ` +
        `gate socket, so no tool action could be classified before execution. MuseRuntime refuses ` +
        `every turn in this state rather than running one ungated ` +
        `(docs/harness/capability-matrix.md, contracts/B-26-muse-code.md).`,
    };
  }
  return {
    status: "ready",
    detail: `muse ${version} is installed, authenticated, and its managed-hook gate seam is live; no model turn sent`,
    observed: [observeMuseAuth(keySource)],
  };
}

/** Which configured source produced the Muse key. Muse exposes no subscription
 *  login at all, so this names the key's origin rather than deciding a mode. */
function museApiKeySource(env: NodeJS.ProcessEnv): string {
  for (const name of ["CORMIDIA_MUSE_API_KEY_FILE", "CORMIDIA_MUSE_API_KEY", "MUSE_API_KEY", "META_API_KEY"]) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) return name;
  }
  return "the configured Muse key source";
}

function museVersion(env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "muse",
      ["--version"],
      { env: { ...env, MUSE_NO_AUTO_UPDATE: "1" }, signal, encoding: "utf8" },
      (error, stdout) => {
        if (error !== null) reject(error);
        else resolve(stdout.trim());
      },
    );
  });
}

/** Token-free: an echo-provider run with the managed hook root installed. */
async function probeMuseGateSeam(env: NodeJS.ProcessEnv): Promise<boolean> {
  const gate = (): { allow: false; reason: string; escalate: boolean } => ({
    allow: false,
    reason: "cormidia readiness probe denies every action",
    escalate: false,
  });
  const bridge = await startMuseGateBridge(process.cwd(), { gate }, []);
  try {
    await new Promise<void>((resolve) => {
      execFile(
        "muse",
        museHandshakeArgs(process.cwd()),
        { env: { ...env, ...bridge.env }, encoding: "utf8", timeout: 20_000 },
        () => resolve(),
      );
    });
    return bridge.handshakeObserved();
  } finally {
    await bridge.close();
  }
}

function classifyProbeError(error: unknown): ProbeOutcome {
  const code =
    error !== null && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  const message = errorMessage(error);
  if (
    code === "ENOENT" ||
    code === "MODULE_NOT_FOUND" ||
    /cannot find module|not found on PATH|spawn .* ENOENT/i.test(message)
  ) {
    return {
      status: "missing_binary",
      errorCode: "error_adapter_binary_missing",
      detail: message,
    };
  }
  if (
    /not logged in|no cached auth|session expired|re-?authentication|unauthorized|no credentials found/i.test(message)
  ) {
    return {
      status: "unauthenticated",
      errorCode: "error_adapter_unauthenticated",
      detail: message,
    };
  }
  if (
    code === "ECONNREFUSED" ||
    code === "EPIPE" ||
    /ECONNREFUSED|socket|broken pipe|App Server exited|client closed/i.test(message)
  ) {
    return {
      status: "transport_unavailable",
      errorCode: "error_adapter_transport_unavailable",
      detail: message,
    };
  }
  return {
    status: "misconfigured",
    errorCode: "error_adapter_misconfigured",
    detail: message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
