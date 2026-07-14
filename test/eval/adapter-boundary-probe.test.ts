import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { defaultGate } from "../../src/runtime/gate.js";
import {
  boundaryProbePassed,
  probeAdapterBoundary,
} from "../../scripts/eval/adapter-boundary-probe.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

for (const runtime of ["claude", "codex", "pi"] as const) {
  it(`mechanically probes the real ${runtime} gate boundary without a provider turn`, async () => {
    const workdir = mkdtempSync(join(tmpdir(), `operon-${runtime}-boundary-`));
    roots.push(workdir);
    const evidence = await probeAdapterBoundary({ runtime, workdir, gate: defaultGate });

    expect(evidence.passed).toBe(true);
    expect(boundaryProbePassed(evidence)).toBe(true);
    expect(evidence.routine_allow).toMatchObject({ denied: false, gate_calls: 1, escalations: 0 });
    expect(evidence.secrets_gate).toMatchObject({ denied: true, rule: "secrets-or-auth", gate_calls: 1, escalations: 1 });
    expect(evidence.builder_role_shaping).toMatchObject({
      denied: true,
      rule: "self-merge-or-approve",
      escalations: 0,
      claim: runtime === "claude" ? "native_deny_rules" : "degraded_flat_deny",
    });
    expect(evidence.builder_role_shaping.gate_calls).toBe(runtime === "claude" ? 0 : 1);
    if (runtime === "pi") {
      expect(evidence.delegated_gate).toEqual({
        applicable: false,
        reason: "no_native_intra_turn_fanout",
      });
    } else {
      expect(evidence.delegated_gate).toMatchObject({
        denied: true,
        rule: "secrets-or-auth",
        gate_calls: 1,
        escalations: 1,
      });
    }
  });
}

it("does not self-attest when the supplied Operon gate allows a secret action", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "operon-boundary-broken-gate-"));
  roots.push(workdir);
  const evidence = await probeAdapterBoundary({
    runtime: "pi",
    workdir,
    gate: () => ({ allow: true }),
  });

  expect(evidence.passed).toBe(false);
  expect(evidence.secrets_gate).toMatchObject({
    denied: false,
    rule: "secrets-or-auth",
    gate_calls: 1,
    escalations: 0,
  });
});
