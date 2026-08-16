// Traceability: CF-B02 · CF-B03 · CF-B04 · HB-051; CF-B23 · CF-B24 · CF-B25 · CF-B26 · HB-137; readiness verifies the declaration against the real
// credential state, per harness (#333), L1.
//
// The refusal must fire in BOTH directions and for every harness:
//   declared subscription, credential is a key  → surprise billing;
//   declared api_key,      credential is a plan → unapproved quota burn.
// Neither is a warning and neither silently falls back.
//
// The probe implementations are injected, which is exactly the seeded LIAR
// credential reader the negative-control rule asks for: a reader that reports
// the opposite of the declaration must produce a typed refusal every time. A
// detector that has never fired is an assumption, so each direction is
// exercised against every registered harness rather than a representative one.
//
// Layer: 1 (unit). Zero network, zero tokens, no real adapter is constructed.

import { describe, expect, it } from "vitest";
import { HARNESS_AUTH_SUPPORT, type AuthMode, type ObservedConnectionAuth } from "../../../src/runtime/auth-mode.js";
import { HARNESS_SUPPORT } from "../../../src/runtime/harness-support.js";
import { probeRuntimeReadiness } from "../../../src/runtime/readiness.js";
import { RUNTIME_KINDS } from "../../../src/runtime/registry.js";
import type { RuntimeKind } from "../../../src/runtime/types.js";

/** Version detection is a separate gate (#331); pin every harness at its own
 *  declared `testedWith` so these cases isolate the auth verdict rather than a
 *  version band (and cannot rot when a band moves). */
const atTestedVersion = (runtime: RuntimeKind) => ({
  detected: true as const,
  version: HARNESS_SUPPORT[runtime].testedWith,
  source: "test",
});

/** A credential reader that answers exactly what the case tells it to — the
 *  seam a lying credential store occupies. `undefined` mode = indeterminate. */
function credentialReader(observed: readonly ObservedConnectionAuth[], detail = "probe reached ready") {
  return {
    implementation: async () => ({ status: "ready" as const, detail, observed }),
  };
}

function implementationsFor(runtime: RuntimeKind, observed: readonly ObservedConnectionAuth[]) {
  return { [runtime]: credentialReader(observed).implementation };
}

/** The family a whole-harness `auth:` declaration covers for this harness. */
function familyOf(runtime: RuntimeKind): string {
  return HARNESS_AUTH_SUPPORT[runtime].providerFamily;
}

const modesFor = (runtime: RuntimeKind): readonly AuthMode[] => HARNESS_AUTH_SUPPORT[runtime].modes;

describe("CF-AUTH-MODE-READINESS — declared billing is verified, never assumed", () => {
  it("declared mode that matches the credential is ready, for every harness and mode", async () => {
    let asserted = 0;
    for (const runtime of RUNTIME_KINDS) {
      for (const mode of modesFor(runtime)) {
        const result = await probeRuntimeReadiness(
          { runtime, models: ["m"], auth: { auth: mode } },
          implementationsFor(runtime, [
            { providerFamily: familyOf(runtime), mode, evidence: `${mode} credential in use` },
          ]),
          atTestedVersion,
        );
        expect(result.status, `${runtime}/${mode}`).toBe("ready");
        expect(result.errorCode).toBeUndefined();
        expect(result.detail).toContain("auth verified");
        expect(result.authModes).toEqual([
          { providerFamily: familyOf(runtime), mode, evidence: `${mode} credential in use` },
        ]);
        asserted += 1;
      }
    }
    expect(asserted).toBe(RUNTIME_KINDS.reduce((sum, kind) => sum + modesFor(kind).length, 0));
    expect(asserted).toBeGreaterThan(RUNTIME_KINDS.length);
  });

  it("subscription declared, API key in use → typed refusal naming the surprise billing", async () => {
    let fired = 0;
    for (const runtime of RUNTIME_KINDS.filter((kind) => modesFor(kind).includes("subscription"))) {
      const result = await probeRuntimeReadiness(
        { runtime, models: ["m"], auth: { auth: "subscription" } },
        implementationsFor(runtime, [
          { providerFamily: familyOf(runtime), mode: "api_key", evidence: "an API key is configured" },
        ]),
        atTestedVersion,
      );
      expect(result.status, runtime).toBe("auth_mode_mismatch");
      expect(result.errorCode).toBe("error_auth_mode_mismatch");
      expect(result.detail).toContain("bill the operator's API account");
      expect(result.detail).toContain("an API key is configured");
      fired += 1;
    }
    expect(fired).toBeGreaterThan(0);
  });

  it("api_key declared, subscription credential in use → typed refusal naming the quota burn", async () => {
    let fired = 0;
    for (const runtime of RUNTIME_KINDS.filter((kind) => modesFor(kind).includes("subscription"))) {
      const result = await probeRuntimeReadiness(
        { runtime, models: ["m"], auth: { auth: "api_key" } },
        implementationsFor(runtime, [
          { providerFamily: familyOf(runtime), mode: "subscription", evidence: "a plan login is stored" },
        ]),
        atTestedVersion,
      );
      expect(result.status, runtime).toBe("auth_mode_mismatch");
      expect(result.errorCode).toBe("error_auth_mode_mismatch");
      expect(result.detail).toContain("subscription quota the operator did not approve");
      fired += 1;
    }
    expect(fired).toBeGreaterThan(0);
  });

  it("muse declared subscription is refused as unsupported even if a probe claims it", async () => {
    // Defense in depth: the config loader refuses this shape, so reaching
    // readiness means something bypassed it. A liar probe claiming muse is on
    // a subscription must still not produce a ready harness.
    const result = await probeRuntimeReadiness(
      { runtime: "muse", models: ["m"], auth: { auth: "subscription" } },
      implementationsFor("muse", [
        { providerFamily: "meta", mode: "subscription", evidence: "probe claims a plan login" },
      ]),
      atTestedVersion,
    );
    expect(result.status).toBe("auth_mode_mismatch");
    expect(result.errorCode).toBe("error_auth_mode_unsupported");
    expect(result.detail).toContain('muse cannot be reached under auth mode "subscription"');
  });

  it("an indeterminate credential state never satisfies a declaration", async () => {
    const result = await probeRuntimeReadiness(
      { runtime: "cursor", models: ["m"], auth: { auth: "subscription" } },
      implementationsFor("cursor", [
        { providerFamily: "cursor", evidence: "a stored login and CURSOR_API_KEY are both present" },
      ]),
      atTestedVersion,
    );
    expect(result.status).toBe("auth_mode_mismatch");
    expect(result.errorCode).toBe("error_auth_mode_unverifiable");
    expect(result.detail).toContain("indeterminate");
  });

  it("a multi-provider backbone is verified per provider family", async () => {
    const observed: ObservedConnectionAuth[] = [
      { providerFamily: "anthropic", mode: "api_key", evidence: "stored credential type=api" },
      { providerFamily: "openai", mode: "subscription", evidence: "stored credential type=oauth" },
    ];
    const matching = await probeRuntimeReadiness(
      {
        runtime: "opencode",
        models: ["anthropic/opus", "openai/gpt"],
        auth: { providers: { anthropic: "api_key", openai: "subscription" } },
      },
      implementationsFor("opencode", observed),
      atTestedVersion,
    );
    expect(matching.status).toBe("ready");

    // One family wrong is enough: the refusal names the exact connection.
    const mismatched = await probeRuntimeReadiness(
      {
        runtime: "opencode",
        models: ["anthropic/opus", "openai/gpt"],
        auth: { providers: { anthropic: "api_key", openai: "api_key" } },
      },
      implementationsFor("opencode", observed),
      atTestedVersion,
    );
    expect(mismatched.status).toBe("auth_mode_mismatch");
    expect(mismatched.errorCode).toBe("error_auth_mode_mismatch");
    expect(mismatched.detail).toContain("opencode/openai");
  });

  it("no declaration means no verification — behaviour is unchanged", async () => {
    const result = await probeRuntimeReadiness(
      { runtime: "claude", models: ["m"] },
      implementationsFor("claude", [
        { providerFamily: "anthropic", mode: "api_key", evidence: "apiKeySource=ANTHROPIC_API_KEY" },
      ]),
      atTestedVersion,
    );
    expect(result.status).toBe("ready");
    expect(result.detail).not.toContain("auth verified");
    // Still REPORTED, so an operator can see which billing they are on.
    expect(result.authModes?.[0]?.mode).toBe("api_key");
  });

  it("a missing credential stays `unauthenticated` — a declaration never masks it", async () => {
    for (const declared of [undefined, { auth: "subscription" as const }, { auth: "api_key" as const }]) {
      const result = await probeRuntimeReadiness(
        {
          runtime: "grok",
          models: ["m"],
          ...(declared === undefined ? {} : { auth: declared }),
        },
        {
          grok: async () => ({
            status: "unauthenticated" as const,
            errorCode: "error_adapter_unauthenticated",
            detail: "grok 1.0.0 is installed, but no stored login (auth.json) and no XAI_API_KEY were found",
          }),
        },
        atTestedVersion,
      );
      expect(result.status).toBe("unauthenticated");
      expect(result.errorCode).toBe("error_adapter_unauthenticated");
      expect(result.detail).toContain("no XAI_API_KEY");
    }
  });

  it("a version below floor still refuses first — auth verification never overrides it", async () => {
    const result = await probeRuntimeReadiness(
      { runtime: "claude", models: ["m"], auth: { auth: "subscription" } },
      implementationsFor("claude", [
        { providerFamily: "anthropic", mode: "subscription", evidence: "tokenSource=oauth" },
      ]),
      () => ({ detected: true, version: "0.0.1", source: "test" }),
    );
    expect(result.status).toBe("unsupported_version");
    expect(result.errorCode).toBe("error_adapter_version_below_floor");
  });
});
