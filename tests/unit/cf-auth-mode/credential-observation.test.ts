// CF-AUTH-MODE — per-harness credential classification (#333), L1.
//
// Each harness proves its billing from a DIFFERENT token-free signal, and this
// is where each mapping is pinned against realistic raw payloads:
//
//   claude   `claude auth status --json` authMethod/apiProvider + SDK sources
//   codex    App Server account/read account type (ChatGPT vs API key)
//   pi       auth.json credential records (`type: oauth` vs `type: api_key`)
//   opencode the OpenCode auth store (`oauth` vs `api`/`wellknown`)
//   cursor   `cursor-agent status` stored login vs CURSOR_API_KEY
//   grok     ACP `cached_token` vs XAI_API_KEY (adapter precedence mirrored)
//   muse     an API key, and nothing else exists
//
// The standing rule under test: when the facts do not determine the answer,
// the observation carries NO mode. Guessing which account pays is the exact
// failure this path exists to prevent.
//
// Layer: 1 (unit). Zero network, zero tokens, no binary is executed.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  observeClaudeAuth,
  observeCodexAuth,
  observeCursorAuth,
  observeGrokAuth,
  observeMuseAuth,
  observeStoredCredentialAuth,
  readAuthStore,
} from "../../../src/runtime/auth-mode-observers.js";

const temps: string[] = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function storeWith(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cormidia-auth-store-"));
  temps.push(dir);
  const path = join(dir, "auth.json");
  await writeFile(path, body, "utf8");
  return path;
}

describe("CF-AUTH-MODE-OBSERVE — claude", () => {
  it("an OAuth token source is a subscription; an API-key source is metered", () => {
    expect(observeClaudeAuth({ tokenSource: "oauth", subscriptionType: "max" }).mode).toBe("subscription");
    expect(observeClaudeAuth({ apiKeySource: "ANTHROPIC_API_KEY" }).mode).toBe("api_key");
  });

  it("an external apiProvider is metered — third-party credentials are never a plan", () => {
    for (const provider of ["bedrock", "vertex", "gateway"]) {
      const observed = observeClaudeAuth({ apiProvider: provider, subscriptionType: "max" });
      expect(observed.mode, provider).toBe("api_key");
      expect(observed.evidence).toContain(provider);
    }
  });

  it("falls back to the CLI auth method when both SDK sources are the `none` sentinel", () => {
    // macOS Keychain-backed plan logins leave both SDK fields empty, which is
    // why `claude auth status --json` is consulted in the turn's exact env.
    expect(observeClaudeAuth({ tokenSource: "none", apiKeySource: "none", cliAuthMethod: "claude.ai" }).mode).toBe(
      "subscription",
    );
    expect(observeClaudeAuth({ cliAuthMethod: "apiKey" }).mode).toBe("api_key");
  });

  it("two live credentials are indeterminate — precedence is undocumented, so it is not guessed", () => {
    const observed = observeClaudeAuth({ tokenSource: "oauth", apiKeySource: "ANTHROPIC_API_KEY" });
    expect(observed.mode).toBeUndefined();
    expect(observed.evidence).toContain("both");
  });

  it("no credential signal at all is indeterminate, never a default", () => {
    expect(observeClaudeAuth({}).mode).toBeUndefined();
    expect(observeClaudeAuth({ cliAuthMethod: "something-new" }).mode).toBeUndefined();
  });
});

describe("CF-AUTH-MODE-OBSERVE — codex", () => {
  it("a ChatGPT account is a subscription and an api-key account is metered", () => {
    expect(observeCodexAuth("chatgpt", "pro").mode).toBe("subscription");
    expect(observeCodexAuth("chatgpt", "pro").evidence).toContain("plan=pro");
    expect(observeCodexAuth("apikey").mode).toBe("api_key");
  });

  it("an unrecognized or absent account type is indeterminate", () => {
    expect(observeCodexAuth("external").mode).toBeUndefined();
    expect(observeCodexAuth(undefined).mode).toBeUndefined();
  });
});

describe("CF-AUTH-MODE-OBSERVE — cursor", () => {
  it("a stored login is a subscription and CURSOR_API_KEY alone is metered", () => {
    expect(observeCursorAuth({ storedLogin: true, apiKeySet: false }).mode).toBe("subscription");
    expect(observeCursorAuth({ storedLogin: false, apiKeySet: true }).mode).toBe("api_key");
  });

  it("both present is indeterminate — cursor-agent documents no precedence", () => {
    const observed = observeCursorAuth({ storedLogin: true, apiKeySet: true });
    expect(observed.mode).toBeUndefined();
    expect(observed.evidence).toContain("CURSOR_API_KEY");
  });

  it("neither present is indeterminate (readiness has already refused it)", () => {
    expect(observeCursorAuth({ storedLogin: false, apiKeySet: false }).mode).toBeUndefined();
  });
});

describe("CF-AUTH-MODE-OBSERVE — grok", () => {
  it("mirrors the adapter's own precedence: XAI_API_KEY wins over a stored login", () => {
    // The adapter selects methodId `api_key` whenever XAI_API_KEY is set, so
    // the observation must describe the turn that would actually run.
    expect(observeGrokAuth({ apiKeySet: true, methodId: "cached_token" }).mode).toBe("api_key");
    expect(observeGrokAuth({ apiKeySet: false, methodId: "cached_token" }).mode).toBe("subscription");
  });

  it("an unfamiliar ACP method with no key is indeterminate", () => {
    expect(observeGrokAuth({ apiKeySet: false, methodId: "something_new" }).mode).toBeUndefined();
  });
});

describe("CF-AUTH-MODE-OBSERVE — muse", () => {
  it("is always metered and names the key source", () => {
    const observed = observeMuseAuth("MUSE_API_KEY");
    expect(observed.mode).toBe("api_key");
    expect(observed.providerFamily).toBe("meta");
    expect(observed.evidence).toContain("MUSE_API_KEY");
  });
});

describe("CF-AUTH-MODE-OBSERVE — pi and opencode type-tagged stores", () => {
  it("maps oauth to subscription and every key kind to metered", () => {
    expect(observeStoredCredentialAuth("anthropic", { type: "oauth" }, false).mode).toBe("subscription");
    for (const type of ["api_key", "api", "apikey", "wellknown"]) {
      expect(observeStoredCredentialAuth("anthropic", { type }, false).mode, type).toBe("api_key");
    }
  });

  it("a provider credentialed from the environment is metered", () => {
    expect(observeStoredCredentialAuth("openai", undefined, true).mode).toBe("api_key");
  });

  it("no record and no environment credential is indeterminate", () => {
    expect(observeStoredCredentialAuth("openai", undefined, false).mode).toBeUndefined();
    expect(observeStoredCredentialAuth("openai", { type: "quantum" }, true).mode).toBeUndefined();
    expect(observeStoredCredentialAuth("openai", "not-an-object", false).mode).toBeUndefined();
  });

  it("reads a real store from disk, treats a missing one as empty and a corrupt one as unreadable", async () => {
    const store = await storeWith(
      JSON.stringify({ anthropic: { type: "oauth", refresh: "r" }, openai: { type: "api", key: "k" } }),
    );
    const records = await readAuthStore(store);
    expect(observeStoredCredentialAuth("anthropic", records?.["anthropic"], false).mode).toBe("subscription");
    expect(observeStoredCredentialAuth("openai", records?.["openai"], false).mode).toBe("api_key");

    expect(await readAuthStore(join(store, "..", "absent.json"))).toEqual({});
    const corrupt = await storeWith("{ not json");
    expect(await readAuthStore(corrupt)).toBeUndefined();
    // An unreadable store yields indeterminate observations, never a guess.
    expect(observeStoredCredentialAuth("anthropic", undefined, false).mode).toBeUndefined();
  });

  it("NEGATIVE CONTROL — a lying store flips the verdict, proving the mapping is read, not assumed", async () => {
    // Same provider, opposite record: if the classifier ignored the store it
    // would answer identically both times and this case could never fail.
    const truthful = await storeWith(JSON.stringify({ anthropic: { type: "oauth" } }));
    const liar = await storeWith(JSON.stringify({ anthropic: { type: "api" } }));
    const truthfulRecords = await readAuthStore(truthful);
    const liarRecords = await readAuthStore(liar);
    expect(observeStoredCredentialAuth("anthropic", truthfulRecords?.["anthropic"], false).mode).toBe("subscription");
    expect(observeStoredCredentialAuth("anthropic", liarRecords?.["anthropic"], false).mode).toBe("api_key");
  });
});
