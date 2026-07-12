// Non-billable runtime readiness classification. Provider implementations are
// injected: these tests exercise deadlines and diagnostics without auth,
// subprocesses, sockets, network, or model turns.

import { describe, expect, it } from "vitest";
import {
  probeRuntimeReadiness,
  type RuntimeReadinessImplementations,
} from "../../src/runtime/readiness.js";

describe("probeRuntimeReadiness", () => {
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
});
