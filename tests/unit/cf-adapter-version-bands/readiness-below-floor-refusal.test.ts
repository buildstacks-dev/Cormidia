// CF-B02/03/04-BANDS (#331) — a harness below its declared floor cannot speak
// the interface its adapter targets. Readiness refuses it with a typed result
// BEFORE the provider is constructed, so the failure reads as a version
// refusal rather than as a late auth or transport fault. Drift in either
// direction is never a refusal.

import { describe, expect, it } from "vitest";
import { HARNESS_SUPPORT, type HarnessVersionDetector } from "../../../src/runtime/harness-support.js";
import { probeRuntimeReadiness } from "../../../src/runtime/readiness.js";
import { RUNTIME_KINDS } from "../../../src/runtime/registry.js";
import type { RuntimeKind } from "../../../src/runtime/types.js";

/** Records whether the adapter probe — i.e. provider construction — ran. */
function spyImplementations(constructed: RuntimeKind[]) {
  return Object.fromEntries(
    RUNTIME_KINDS.map((kind) => [
      kind,
      async () => {
        constructed.push(kind);
        return { status: "ready" as const, detail: `${kind} probe ran` };
      },
    ]),
  );
}

function detector(version: string): HarnessVersionDetector {
  return () => ({ detected: true, version });
}

function shiftPatch(version: string, by: number): string {
  const [major, minor, patch] = version.split(".");
  return `${major}.${minor}.${Number(patch) + by}`;
}

/**
 * The largest strict-semver version strictly BELOW `version`. Decrementing the
 * patch is not enough: a floor like grok's `1.0.0` would become `1.0.-1`, which
 * is not semver at all, so banding returns `unknown` and readiness proceeds —
 * the test would then assert nothing while still looking green. Borrow from the
 * lowest non-zero component instead, so every declared floor gets a real
 * below-floor probe. A `0.0.0` floor has nothing below it and is refused loudly
 * rather than silently skipped.
 */
function belowFloor(version: string): string {
  const parts = version.split(".").map(Number);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const value = parts[index];
    if (value !== undefined && value > 0) {
      parts[index] = value - 1;
      for (let lower = index + 1; lower < parts.length; lower += 1) parts[lower] = 999;
      return parts.join(".");
    }
  }
  throw new Error(`no version exists below ${version}; a 0.0.0 floor cannot be probed`);
}

describe("CF-B02/03/04-BANDS — below-floor readiness refusal", () => {
  it.each(RUNTIME_KINDS)("%s below its floor is a typed refusal, not a probe", async (kind) => {
    const constructed: RuntimeKind[] = [];
    const result = await probeRuntimeReadiness(
      { runtime: kind, models: ["fixture-model"] },
      spyImplementations(constructed),
      detector(belowFloor(HARNESS_SUPPORT[kind].floor)),
    );
    expect(result.status).toBe("unsupported_version");
    expect(result.errorCode).toBe("error_adapter_version_below_floor");
    expect(result.billable).toBe(false);
    expect(result.detail).toContain(HARNESS_SUPPORT[kind].floor);
    expect(result.detail).toContain(HARNESS_SUPPORT[kind].testedEvidence);
    // The refusal happens before provider construction.
    expect(constructed).toEqual([]);
  });

  it.each(RUNTIME_KINDS)("%s at its tested version proceeds to the probe", async (kind) => {
    const constructed: RuntimeKind[] = [];
    const result = await probeRuntimeReadiness(
      { runtime: kind, models: ["fixture-model"] },
      spyImplementations(constructed),
      detector(HARNESS_SUPPORT[kind].testedWith),
    );
    expect(result.status).toBe("ready");
    expect(constructed).toEqual([kind]);
  });

  it.each(RUNTIME_KINDS)("%s newer than tested drifts but is never blocked", async (kind) => {
    const constructed: RuntimeKind[] = [];
    const result = await probeRuntimeReadiness(
      { runtime: kind, models: ["fixture-model"] },
      spyImplementations(constructed),
      detector(shiftPatch(HARNESS_SUPPORT[kind].testedWith, 1)),
    );
    expect(result.status).toBe("ready");
    expect(constructed).toEqual([kind]);
  });

  it.each(RUNTIME_KINDS)("%s with an unreadable version still probes, and says so", async (kind) => {
    // An undetectable version cannot prove a below-floor install, so it must
    // not fabricate a refusal — but it must not be reported as tested either.
    // Doctor carries the `unknown` band (see doctor-version-bands.test.ts).
    const constructed: RuntimeKind[] = [];
    const result = await probeRuntimeReadiness(
      { runtime: kind, models: ["fixture-model"] },
      spyImplementations(constructed),
      () => ({ detected: false, reason: "no version surface" }),
    );
    expect(result.status).toBe("ready");
    expect(constructed).toEqual([kind]);
  });

  it("negative control: a detector that lies about a below-floor install fires the refusal", async () => {
    // Seeded liar — it reports the tested version for an install that is
    // actually below the floor. Swapping in the truthful reading must flip the
    // verdict; if it does not, the refusal is not wired to detection at all.
    const kind: RuntimeKind = "codex";
    const below = belowFloor(HARNESS_SUPPORT[kind].floor);
    const liar: HarnessVersionDetector = () => ({ detected: true, version: HARNESS_SUPPORT[kind].testedWith });

    const constructed: RuntimeKind[] = [];
    const lied = await probeRuntimeReadiness({ runtime: kind, models: ["m"] }, spyImplementations(constructed), liar);
    expect(lied.status).toBe("ready");
    expect(constructed).toEqual([kind]);

    const truthful = await probeRuntimeReadiness(
      { runtime: kind, models: ["m"] },
      spyImplementations(constructed),
      detector(below),
    );
    expect(truthful.status).toBe("unsupported_version");
    expect(constructed).toEqual([kind]);
  });
});
