// CF-C-B32 (L1, contract): Cormidia's adapter projections honor the kernel's
// port contracts clause by clause — scope grammar/precedence/ancestry, identity
// evidence parsing, content-policy byte ceiling without rewrite, fingerprint
// components — with a seeded violation per clause so each detector is proven
// red-capable (tests/README.md convention 3).
import { describe, expect, it } from "vitest";
import { canonicalJsonText, systemFingerprintDigest } from "@cormidia/learning-loop";
import type { Scope } from "@cormidia/learning-loop";
import { createOkfContentPolicy, OKF_MAXIMUM_INPUT_BYTES } from "../../../src/org/learning-loop/content-policy.js";
import { fingerprintComponents, kernelFingerprint } from "../../../src/org/learning-loop/fingerprint.js";
import {
  createCormidiaIdentityPort,
  humanPrincipalEvidence,
  parsePrincipalEvidence,
  rolePrincipalEvidence,
} from "../../../src/org/learning-loop/identity.js";
import {
  cormidiaScopePolicy,
  loopScopeFromScope,
  scopeFromLoopScope,
  scopeParts,
} from "../../../src/org/learning-loop/scope.js";
import type { SystemFingerprint } from "../../../src/org/learning/fingerprint.js";

const ORG = "acme";

function fingerprint(overrides: Partial<SystemFingerprint> = {}): SystemFingerprint {
  return {
    fingerprint_id: "sys_0123456789ab",
    cormidia: { version: "0.1.1", commit: "abc" },
    org: { commit: "def", taste_hash: "t", roles_hash: "r", pipelines_hash: "p", prompts_hash: "q" },
    app: { name: "web", commit: null, config_hash: null },
    bundle_versions: { org: "2026.07.31-1" },
    bundle_lineage: "stable",
    models: { builder: { runtime: "codex", model: "gpt", effort: "high" } },
    gates_hash: null,
    permissions_hash: null,
    budget_caps: { app_usd_month: null, per_turn_usd_by_role: {} },
    env: { node: "v26.7.0", platform: "darwin" },
    ...overrides,
  };
}

describe("CF-C-B32 scope policy: V1 loop-scope grammar onto kernel scopes", () => {
  const policy = cormidiaScopePolicy();

  it("round-trips every V1 scope shape through kernel segments", () => {
    for (const loopScope of ["org", "roles/builder", "apps/web", "apps/web/roles/reviewer"]) {
      const scope = scopeFromLoopScope(ORG, loopScope);
      expect(policy.validate(scope)).toEqual(scope);
      expect(loopScopeFromScope(scope)).toBe(loopScope);
      expect(scope[0]).toEqual({ type: "org", id: ORG });
    }
  });

  it("orders precedence narrower-first: app-role > app > role > org, id breaks ties", () => {
    const org = scopeFromLoopScope(ORG, "org");
    const role = scopeFromLoopScope(ORG, "roles/builder");
    const app = scopeFromLoopScope(ORG, "apps/web");
    const appRole = scopeFromLoopScope(ORG, "apps/web/roles/builder");
    expect(policy.comparePrecedence(appRole, app)).toBe(1);
    expect(policy.comparePrecedence(app, role)).toBe(1);
    expect(policy.comparePrecedence(role, org)).toBe(1);
    expect(policy.comparePrecedence(org, appRole)).toBe(-1);
    expect(policy.comparePrecedence(app, app)).toBe(0);
    const other = scopeFromLoopScope(ORG, "apps/api");
    expect(policy.comparePrecedence(app, other)).toBe(-policy.comparePrecedence(other, app));
  });

  it("ancestry follows the resolver's four-scope gather (design §4.3) and never crosses the org", () => {
    const appRole = scopeFromLoopScope(ORG, "apps/web/roles/builder");
    expect(policy.ancestors(appRole)).toEqual([
      scopeFromLoopScope(ORG, "apps/web"),
      scopeFromLoopScope(ORG, "roles/builder"),
      scopeFromLoopScope(ORG, "org"),
    ]);
    expect(policy.ancestors(scopeFromLoopScope(ORG, "org"))).toEqual([]);
    expect(policy.isolationSegmentTypes).toEqual(["org"]);
    expect(policy.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("negative control: a foreign or malformed scope is refused, never mapped silently", () => {
    const foreign: Scope = [{ type: "project", id: "conformance" }];
    expect(scopeParts(foreign)).toBeUndefined();
    expect(loopScopeFromScope(foreign)).toBeUndefined();
    expect(() => policy.validate(foreign)).toThrow(/\[org\]/);
    expect(() =>
      policy.validate([
        { type: "org", id: ORG },
        { type: "role", id: "r" },
        { type: "app", id: "web" },
      ]),
    ).toThrow();
    expect(() =>
      policy.validate([
        { type: "org", id: ORG },
        { type: "app", id: ".." },
      ]),
    ).toThrow();
    expect(() => policy.validate([])).toThrow(/non-empty/);
    expect(() => scopeFromLoopScope(ORG, "apps/../x")).toThrow(/not a valid V1 scope/);
  });
});

describe("CF-C-B32 identity port: principals from host configuration, deterministic attestation", () => {
  it("verifies role and human evidence into stable, distinct principals", async () => {
    const port = createCormidiaIdentityPort();
    const distiller = await port.verify(rolePrincipalEvidence("distiller", "codex"));
    const again = await port.verify(rolePrincipalEvidence("distiller", "codex"));
    const reviewer = await port.verify(rolePrincipalEvidence("learning-reviewer", "claude"));
    const human = await port.verify(humanPrincipalEvidence("bikram"));
    expect(distiller.attestationDigest).toBe(again.attestationDigest);
    expect(distiller.ref).toEqual({ id: "role:distiller", kind: "agent", independenceDomain: "runtime:codex" });
    expect(reviewer.ref.independenceDomain).not.toBe(distiller.ref.independenceDomain);
    expect(human.ref.kind).toBe("human");
  });

  it("negative control: evidence missing a field or naming an unknown kind is refused", () => {
    expect(() => parsePrincipalEvidence({ principalId: "x", kind: "robot", independenceDomain: "d" })).toThrow(/kind/);
    expect(() => parsePrincipalEvidence({ principalId: "", kind: "agent", independenceDomain: "d" })).toThrow(
      /principalId/,
    );
    expect(() => parsePrincipalEvidence("role:distiller")).toThrow(/object/);
  });
});

describe("CF-C-B32 content policy: bounded, classified, never rewritten", () => {
  const policy = createOkfContentPolicy();

  it("accepts JSON content canonically unchanged and classifies it", async () => {
    const input = { markdown: "---\nname: x\n---\nbody\n" };
    const result = await policy.transform(input);
    expect(result.diagnostics).toEqual([]);
    expect(canonicalJsonText(result.accepted)).toBe(canonicalJsonText(input));
    expect(result.classification).toBe("okf-concept-draft");
    expect((await policy.transform({ text: "t" })).classification).toBe("plain-text");
    expect((await policy.transform({ a: 1 })).classification).toBe("structured");
    expect(policy.outboundUse).toBe("forbidden");
  });

  it("negative control: over-ceiling and non-JSON content are refused with an error diagnostic", async () => {
    const big = await policy.transform({ text: "x".repeat(OKF_MAXIMUM_INPUT_BYTES) });
    expect(big.diagnostics.map((d) => d.code)).toEqual(["content.too_large"]);
    const notJson = await policy.transform({ when: new Date(0) });
    expect(notJson.diagnostics.map((d) => d.code)).toEqual(["content.not_json"]);
  });
});

describe("CF-C-B32 fingerprint projection: one component per Cormidia section", () => {
  it("is deterministic and keyed by Cormidia's content-addressed id", () => {
    const a = kernelFingerprint(fingerprint());
    const b = kernelFingerprint(fingerprint());
    expect(a.digest).toBe(b.digest);
    expect(a.id).toBe("sys_0123456789ab");
    expect(a.components.map((component) => component.name)).toEqual([
      "cormidia",
      "org",
      "app",
      "bundle",
      "models",
      "gates",
      "budget_caps",
      "env",
    ]);
  });

  it("negative control: a drifted section changes exactly its component and the whole digest", () => {
    const base = fingerprintComponents(fingerprint());
    const drifted = fingerprintComponents(fingerprint({ bundle_versions: { org: "2026.08.01-1" } }));
    const changed = base.filter((component, index) => component.digest !== drifted[index]?.digest).map((c) => c.name);
    expect(changed).toEqual(["bundle"]);
    expect(systemFingerprintDigest(base)).not.toBe(systemFingerprintDigest(drifted));
  });
});
