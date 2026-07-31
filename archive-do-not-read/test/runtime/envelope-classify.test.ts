// classifyEnvelopeUsage — the single derivation of an envelope's usage quality
// (#88). Replaces two divergent copies of a role/pipeline/pass substring match
// on "gate", both of which missed provision/setup entirely.

import { describe, expect, it } from "vitest";
import { classifyEnvelopeUsage } from "../../src/runtime/runlog/envelope.js";

type Input = Parameters<typeof classifyEnvelopeUsage>[0];

/** A provider pass always records runtime and model at admission. */
function providerEnvelope(patch: Partial<Input> = {}): Input {
  return {
    status: "completed",
    runtime: "claude",
    model: "claude-opus-4-8",
    usage: { tokens_in: 100, tokens_out: 50, cost_usd: 1.25 },
    ...patch,
  } as Input;
}

/** What openPhaseRun writes: no runtime, no model, no provider. */
function mechanicalEnvelope(patch: Partial<Input> = {}): Input {
  return { status: "completed", ...patch } as Input;
}

describe("classifyEnvelopeUsage", () => {
  it("honours an explicit recorded quality", () => {
    expect(classifyEnvelopeUsage(providerEnvelope({ usage: { tokens_in: 1, tokens_out: 1, cost_usd: 1, quality: "partial" } }))).toBe("partial");
    expect(classifyEnvelopeUsage(mechanicalEnvelope({ usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0, quality: "none" } }))).toBe("none");
  });

  it("classifies a legacy quality-gates envelope as none", () => {
    expect(classifyEnvelopeUsage(mechanicalEnvelope())).toBe("none");
  });

  it("classifies a legacy provision/setup envelope as none — the case the old heuristic missed (#88)", () => {
    // role "orchestrator", pipeline "provision", pass "setup": no substring
    // contains "gate", so the previous heuristic called this an unknown-cost
    // provider turn. 14 of these appeared in the buildstacks-site campaign.
    expect(classifyEnvelopeUsage(mechanicalEnvelope({ status: "completed" }))).toBe("none");
  });

  it("NEAR MISS: a provider envelope with no usage stays unavailable", () => {
    // The adversarial case. A configured provider that produced no usage is a
    // genuine unknown and must never be laundered into a free mechanical pass.
    expect(classifyEnvelopeUsage({ status: "completed", runtime: "claude", model: "claude-opus-4-8" } as Input)).toBe("unavailable");
  });

  it("NEAR MISS: runtime alone is enough to keep an envelope a provider turn", () => {
    expect(classifyEnvelopeUsage({ status: "completed", runtime: "codex" } as Input)).toBe("unavailable");
    expect(classifyEnvelopeUsage({ status: "completed", model: "gpt-5.6-sol" } as Input)).toBe("unavailable");
  });

  it("NEAR MISS: a settled provider turn is never mechanical, even with no runtime recorded", () => {
    // Belt-and-braces: if the ledger claims this run, a provider ran.
    expect(classifyEnvelopeUsage(mechanicalEnvelope(), { settledProviderTurns: 1 })).toBe("unavailable");
  });

  it("derives estimated and partial for provider turns without an explicit quality", () => {
    expect(classifyEnvelopeUsage(providerEnvelope({ usage: { tokens_in: 1, tokens_out: 1, cost_usd: 1, cost_estimated: true } }))).toBe("estimated");
    expect(classifyEnvelopeUsage(providerEnvelope({ status: "running" }))).toBe("partial");
    expect(classifyEnvelopeUsage(providerEnvelope())).toBe("complete");
  });

  it("a running mechanical pass is still none — it will never invoke a provider", () => {
    expect(classifyEnvelopeUsage(mechanicalEnvelope({ status: "running" }))).toBe("none");
  });
});
