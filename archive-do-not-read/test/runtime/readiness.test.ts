// Non-billable runtime readiness classification. Provider implementations are
// injected: these tests exercise deadlines and diagnostics without auth,
// subprocesses, sockets, network, or model turns.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  claudeAuthIsConfigured,
  probePi,
  probeRuntimeReadiness,
  type RuntimeReadinessImplementations,
} from "../../src/runtime/readiness.js";

describe("probeRuntimeReadiness", () => {
  it("does not treat stale Claude account metadata as a usable first-party credential", () => {
    expect(
      claudeAuthIsConfigured({
        apiProvider: "firstParty",
        email: "stale@example.invalid",
        subscriptionType: "max",
      }),
    ).toBe(false);
    expect(
      claudeAuthIsConfigured({ apiProvider: "firstParty", tokenSource: "oauth" }),
    ).toBe(true);
    expect(
      claudeAuthIsConfigured({ apiProvider: "firstParty", tokenSource: "none" }),
    ).toBe(false);
    expect(
      claudeAuthIsConfigured(
        {
          apiProvider: "firstParty",
          tokenSource: "none",
          email: "current@example.invalid",
          subscriptionType: "max",
        },
        {
          loggedIn: true,
          authMethod: "claude.ai",
          apiProvider: "firstParty",
          subscriptionType: "max",
        },
      ),
    ).toBe(true);
    expect(
      claudeAuthIsConfigured(
        { apiProvider: "firstParty", subscriptionType: "max" },
        { loggedIn: false, authMethod: "none", apiProvider: "firstParty" },
      ),
    ).toBe(false);
    expect(
      claudeAuthIsConfigured({ apiProvider: "firstParty", apiKeySource: " NONE " }),
    ).toBe(false);
    expect(
      claudeAuthIsConfigured({ apiProvider: "firstParty", apiKeySource: "environment" }),
    ).toBe(true);
    expect(claudeAuthIsConfigured({ apiProvider: "bedrock" })).toBe(true);
  });

  it("reports a configured adapter as ready and explicitly non-billable", async () => {
    const implementations: RuntimeReadinessImplementations = {
      codex: async () => ({ status: "ready", detail: "App Server account available" }),
    };
    await expect(
      probeRuntimeReadiness(
        { runtime: "codex", models: ["gpt-5.5"], timeoutMs: 50 },
        implementations,
      ),
    ).resolves.toMatchObject({
      runtime: "codex",
      status: "ready",
      billable: false,
      models: ["gpt-5.5"],
    });
  });

  it("bounds a probe that never initializes", async () => {
    const implementations: RuntimeReadinessImplementations = {
      claude: async () => new Promise(() => {}),
    };
    await expect(
      probeRuntimeReadiness(
        { runtime: "claude", models: ["claude-opus-4-8"], timeoutMs: 5 },
        implementations,
      ),
    ).resolves.toMatchObject({
      status: "timed_out",
      errorCode: "error_adapter_readiness_timeout",
      billable: false,
    });
  });

  it.each([
    ["ENOENT", "spawn helper ENOENT", "missing_binary", "error_adapter_binary_missing"],
    ["ECONNREFUSED", "connect ECONNREFUSED /tmp/provider.sock", "transport_unavailable", "error_adapter_transport_unavailable"],
  ] as const)("classifies %s startup failures", async (code, message, status, errorCode) => {
    const error = Object.assign(new Error(message), { code });
    const implementations: RuntimeReadinessImplementations = {
      pi: async () => {
        throw error;
      },
    };
    await expect(
      probeRuntimeReadiness({ runtime: "pi", models: ["provider/model"], timeoutMs: 50 }, implementations),
    ).resolves.toMatchObject({ status, errorCode, billable: false });
  });

  it("preserves a concrete unauthenticated result", async () => {
    const implementations: RuntimeReadinessImplementations = {
      pi: async () => ({
        status: "unauthenticated",
        errorCode: "error_adapter_unauthenticated",
        detail: "provider/model has no configured credential",
      }),
    };
    await expect(
      probeRuntimeReadiness({ runtime: "pi", models: ["provider/model"] }, implementations),
    ).resolves.toMatchObject({
      status: "unauthenticated",
      errorCode: "error_adapter_unauthenticated",
    });
  });

  it("pi readiness resolves OAuth through the file-backed store used by the runtime", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "operon-pi-readiness-"));
    const authPath = join(agentDir, "auth.json");
    writeFileSync(authPath, '{"anthropic":{"type":"oauth","refresh":"old"}}\n');
    let createdPath: string | undefined;
    const authStorage = {} as AuthStorage;
    const model = { provider: "anthropic", id: "fixture" };
    const registry = {
      getError: () => undefined,
      getAll: () => [model],
      find: (provider: string, id: string) =>
        provider === model.provider && id === model.id ? model : undefined,
      hasConfiguredAuth: () => true,
      getProviderAuthStatus: () => ({ source: "oauth" }),
      getApiKeyAndHeaders: async () => {
        writeFileSync(authPath, '{"anthropic":{"type":"oauth","refresh":"rotated"}}\n');
        return { ok: true, apiKey: "fixture", headers: {} };
      },
    } as unknown as ModelRegistry;

    try {
      const result = await probePi(
        {
          runtime: "pi",
          models: ["anthropic/fixture"],
          signal: new AbortController().signal,
        },
        {
          agentDir,
          createAuthStorage: (path) => {
            createdPath = path;
            return authStorage;
          },
          createModelRegistry: (storage, path) => {
            expect(storage).toBe(authStorage);
            expect(path).toBe(join(agentDir, "models.json"));
            return registry;
          },
        },
      );

      expect(result.status).toBe("ready");
      expect(createdPath).toBe(authPath);
      expect(readFileSync(authPath, "utf8")).toContain('"rotated"');
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("pi readiness rejects an expired credential that resolves without an API key", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "operon-pi-readiness-expired-"));
    const authPath = join(agentDir, "auth.json");
    writeFileSync(authPath, '{"anthropic":{"type":"oauth","refresh":"expired"}}\n');
    const model = { provider: "anthropic", id: "fixture" };
    const registry = {
      getError: () => undefined,
      getAll: () => [model],
      find: (provider: string, id: string) =>
        provider === model.provider && id === model.id ? model : undefined,
      hasConfiguredAuth: () => true,
      getProviderAuthStatus: () => ({ configured: true, source: "oauth" }),
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: undefined }),
    } as unknown as ModelRegistry;

    try {
      await expect(
        probePi(
          {
            runtime: "pi",
            models: ["anthropic/fixture"],
            signal: new AbortController().signal,
          },
          {
            agentDir,
            createAuthStorage: () => ({}) as AuthStorage,
            createModelRegistry: () => registry,
          },
        ),
      ).resolves.toMatchObject({
        status: "unauthenticated",
        errorCode: "error_adapter_unauthenticated",
        detail: expect.stringContaining("produced no API key"),
      });
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });
});
