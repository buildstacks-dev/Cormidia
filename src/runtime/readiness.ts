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
import { AuthStorage, getAgentDir, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { StdioCodexAppServerClient } from "./adapters/codex.js";
import { museHandshakeArgs, resolveMuseApiKey } from "./adapters/muse-exec.js";
import { startMuseGateBridge } from "./adapters/muse-gate-bridge.js";
import { resolvePiModel } from "./adapters/pi.js";
import { toErrorMessage as errorMessage } from "./error-message.js";
import type { RuntimeKind } from "./types.js";
import { definedProps } from "./optional-properties.js";

// A clean, isolated Codex home can spend several seconds initializing its
// local App Server caches even though no model request is sent. Keep the probe
// bounded but leave enough startup headroom for that token-free first launch.
const DEFAULT_READINESS_TIMEOUT_MS = 30_000;

type RuntimeReadinessStatus =
  | "ready"
  | "missing_binary"
  | "transport_unavailable"
  | "unauthenticated"
  | "misconfigured"
  | "timed_out";

export interface RuntimeReadinessRequest {
  runtime: RuntimeKind;
  /** Distinct model IDs used by roles configured on this runtime. */
  models: string[];
  timeoutMs?: number;
  /** Optional complete subprocess environment for an isolated provider probe. */
  processEnv?: NodeJS.ProcessEnv;
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
}

interface RuntimeReadinessImplementationRequest extends RuntimeReadinessRequest {
  signal: AbortSignal;
}

type ProbeOutcome = Pick<RuntimeReadinessResult, "status" | "detail"> & {
  errorCode?: string;
};

type RuntimeReadinessImplementation = (request: RuntimeReadinessImplementationRequest) => Promise<ProbeOutcome>;

type RuntimeReadinessImplementations = Partial<Record<RuntimeKind, RuntimeReadinessImplementation>>;

export type RuntimeReadinessProbe = (request: RuntimeReadinessRequest) => Promise<RuntimeReadinessResult>;

interface PiReadinessDependencies {
  agentDir?: string;
  createAuthStorage?: (authPath: string) => AuthStorage;
  createModelRegistry?: (authStorage: AuthStorage, modelsPath: string) => ModelRegistry;
}

const DEFAULT_IMPLEMENTATIONS: Record<RuntimeKind, RuntimeReadinessImplementation> = {
  claude: probeClaude,
  codex: probeCodex,
  pi: probePi,
  muse: probeMuse,
};

export async function probeRuntimeReadiness(
  request: RuntimeReadinessRequest,
  implementations: RuntimeReadinessImplementations = {},
): Promise<RuntimeReadinessResult> {
  const started = Date.now();
  const timeoutMs = request.timeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`runtime readiness timeout must be positive; received ${timeoutMs}`);
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
  return {
    runtime: request.runtime,
    models: [...new Set(request.models)].sort(),
    status: outcome.status,
    detail: outcome.detail,
    durationMs: Date.now() - started,
    billable: false,
    ...definedProps({ errorCode: outcome.errorCode }),
  };
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
    };
  } finally {
    request.signal.removeEventListener("abort", abort);
    await client.close();
  }
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
  if (existsSync(authPath)) {
    try {
      const parsed: unknown = JSON.parse(await readFile(authPath, "utf8"));
      if (!isRecord(parsed)) throw new Error("expected a provider-to-credential mapping");
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
  // then discarded it, making a green probe break the live runtime.
  const authStorage = (dependencies.createAuthStorage ?? AuthStorage.create)(authPath);
  const registry = (dependencies.createModelRegistry ?? ModelRegistry.create)(
    authStorage,
    join(agentDir, "models.json"),
  );
  const registryError = registry.getError();
  if (registryError !== undefined) {
    return {
      status: "misconfigured",
      errorCode: "error_adapter_misconfigured",
      detail: `pi model registry is invalid: ${registryError}`,
    };
  }

  const checked: string[] = [];
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
  }
  return {
    status: "ready",
    detail: `pi model/auth resolution succeeded: ${checked.join(", ")}; no model turn sent`,
  };
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
  };
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
