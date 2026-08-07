// Per-harness credential-state classification for #333 auth-mode verification.
//
// Every function here is PURE: readiness performs the (already token-free)
// reads its probes were doing anyway and hands the raw facts over. That split
// is what makes each harness's mapping testable offline — including with a
// seeded liar credential reader — without a binary, a network, or a token.
//
// The standing rule for every mapping below: when the facts do not determine
// the answer, return an observation with NO mode. An indeterminate observation
// fails a declaration (`verifyAuthModes`) instead of quietly agreeing with it.

import { readFile } from "node:fs/promises";
import type { ObservedConnectionAuth } from "./auth-mode.js";

/** Credential facts the Claude probe already collects. */
export interface ClaudeAuthFacts {
  apiProvider?: string;
  tokenSource?: string;
  apiKeySource?: string;
  subscriptionType?: string;
  /** `authMethod` from `claude auth status --json` in the turn's exact env. */
  cliAuthMethod?: string;
}

export function observeClaudeAuth(facts: ClaudeAuthFacts): ObservedConnectionAuth {
  const family = "anthropic";
  if (facts.apiProvider !== undefined && facts.apiProvider !== "firstParty") {
    // Bedrock/Vertex/gateway credentials are the third party's own (AWS creds,
    // gcloud ADC, an enterprise gateway key). None is a Claude subscription.
    return { providerFamily: family, mode: "api_key", evidence: `external apiProvider=${facts.apiProvider}` };
  }
  const key = concrete(facts.apiKeySource);
  const token = concrete(facts.tokenSource);
  if (key !== undefined && token !== undefined) {
    // Both credentials are live and the CLI's precedence between them is not
    // documented. Naming a winner here would be a guess about who pays.
    return {
      providerFamily: family,
      evidence: `both an API-key source (${key}) and a token source (${token}) are present`,
    };
  }
  if (key !== undefined) return { providerFamily: family, mode: "api_key", evidence: `apiKeySource=${key}` };
  if (token !== undefined) return { providerFamily: family, mode: "subscription", evidence: `tokenSource=${token}` };
  const method = classifyAuthMethod(facts.cliAuthMethod);
  if (method !== undefined) {
    return { providerFamily: family, mode: method, evidence: `claude auth status authMethod=${facts.cliAuthMethod}` };
  }
  if (facts.subscriptionType !== undefined) {
    return {
      providerFamily: family,
      mode: "subscription",
      evidence: `subscriptionType=${facts.subscriptionType}`,
    };
  }
  return { providerFamily: family, evidence: "no credential source, auth method, or subscription type reported" };
}

/** Codex App Server `account/read` reports the account it is signed in as. */
export function observeCodexAuth(accountType: string | undefined, planType?: string): ObservedConnectionAuth {
  const family = "openai";
  const normalized = accountType?.trim().toLowerCase();
  const plan = planType === undefined ? "" : `, plan=${planType}`;
  if (normalized === "chatgpt") {
    return { providerFamily: family, mode: "subscription", evidence: `account type=chatgpt${plan}` };
  }
  if (normalized === "apikey" || normalized === "api_key" || normalized === "api") {
    return { providerFamily: family, mode: "api_key", evidence: `account type=${accountType}${plan}` };
  }
  return { providerFamily: family, evidence: `account type=${accountType ?? "absent"}${plan}` };
}

export function observeCursorAuth(facts: { storedLogin: boolean; apiKeySet: boolean }): ObservedConnectionAuth {
  const family = "cursor";
  if (facts.storedLogin && facts.apiKeySet) {
    // `cursor-agent` documents no precedence between a stored login and
    // CURSOR_API_KEY, so which account pays is genuinely unknown here.
    return {
      providerFamily: family,
      evidence: "a stored `cursor-agent login` and CURSOR_API_KEY are both present",
    };
  }
  if (facts.storedLogin) {
    return { providerFamily: family, mode: "subscription", evidence: "`cursor-agent status` reports a stored login" };
  }
  if (facts.apiKeySet) return { providerFamily: family, mode: "api_key", evidence: "CURSOR_API_KEY is set" };
  return { providerFamily: family, evidence: "no stored login and no CURSOR_API_KEY" };
}

/** Grok's precedence IS documented — by the adapter: `XAI_API_KEY` selects the
 *  `api_key` ACP method and the stored browser login is used otherwise. The
 *  observation mirrors that selection, so it describes the turn that would run. */
export function observeGrokAuth(facts: { apiKeySet: boolean; methodId: string }): ObservedConnectionAuth {
  const family = "xai";
  if (facts.apiKeySet) return { providerFamily: family, mode: "api_key", evidence: "XAI_API_KEY is set" };
  if (facts.methodId === "cached_token") {
    return { providerFamily: family, mode: "subscription", evidence: "ACP auth method cached_token (browser login)" };
  }
  return { providerFamily: family, evidence: `ACP auth method ${facts.methodId} with no XAI_API_KEY` };
}

/** Muse is API-key-only by construction; readiness has already resolved a key
 *  before this is called, so the mode is never in doubt. */
export function observeMuseAuth(source: string): ObservedConnectionAuth {
  return { providerFamily: "meta", mode: "api_key", evidence: `API key resolved from ${source}` };
}

/**
 * pi and OpenCode both persist type-tagged credentials per provider in a JSON
 * auth store, so one classifier serves both: `oauth` is a browser login on the
 * operator's plan, `api_key`/`api`/`wellknown` is a metered key. A provider
 * with no stored record that resolves anyway is credentialed from the
 * environment, and an environment credential is always an API key.
 */
export function observeStoredCredentialAuth(
  providerFamily: string,
  record: unknown,
  environmentCredential: boolean,
): ObservedConnectionAuth {
  const type =
    record !== null && typeof record === "object" && typeof (record as { type?: unknown }).type === "string"
      ? (record as { type: string }).type.trim().toLowerCase()
      : undefined;
  if (type === "oauth") {
    return { providerFamily, mode: "subscription", evidence: `stored credential type=oauth` };
  }
  if (type === "api" || type === "api_key" || type === "apikey" || type === "wellknown") {
    return { providerFamily, mode: "api_key", evidence: `stored credential type=${type}` };
  }
  if (type !== undefined) {
    return { providerFamily, evidence: `stored credential type=${type} is not a known auth kind` };
  }
  if (environmentCredential) {
    return { providerFamily, mode: "api_key", evidence: "no stored credential; resolved from the environment" };
  }
  return { providerFamily, evidence: "no stored credential record" };
}

/** Read a type-tagged auth store (pi `auth.json`, OpenCode `auth.json`).
 *  A missing store is an empty map — absence is not a credential type; an
 *  unreadable one is `undefined`, which every caller turns into an
 *  indeterminate observation rather than a guess. */
export async function readAuthStore(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? {} : undefined;
  }
}

function concrete(source: string | undefined): string | undefined {
  if (source === undefined) return undefined;
  const normalized = source.trim();
  // The SDK uses the literal "none" when the process has no accessible source.
  return normalized !== "" && normalized.toLowerCase() !== "none" ? normalized : undefined;
}

function classifyAuthMethod(method: string | undefined): ObservedConnectionAuth["mode"] {
  if (method === undefined) return undefined;
  const normalized = method.trim().toLowerCase();
  if (normalized.length === 0) return undefined;
  if (/api[\s_-]?key|console|developer|billing/.test(normalized)) return "api_key";
  if (/claude\.?ai|subscription|oauth|login|max|pro|team|enterprise/.test(normalized)) return "subscription";
  return undefined;
}
