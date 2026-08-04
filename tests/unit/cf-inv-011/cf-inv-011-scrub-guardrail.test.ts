// CF-INV-011 — one shared secret policy scrubs every egress: L1 scrub
// guardrail (HB-016, FLOOR — non-discretionary).
//
// CORMIDIA-INV-011 (validation-design/invariants.md): every egress surface
// scrubs through the ONE canonical pattern policy. The guard under test is
// the REAL product pair `SECRET_PATTERNS` + `scrubSecrets`
// (src/runtime/secret-patterns.ts, src/runtime/runlog/redact.ts) — the exact
// functions the envelope writer, event writer, observe projection, report
// detail reader, and narrative capture all import. Seeds come from
// fixtures/synthetic-secret.ts (runtime-minted, never committed).
//
// Layer: 1 (pure function, zero I/O, zero network, zero tokens).

import { describe, expect, it } from "vitest";
import { SECRET_PATTERNS } from "../../../src/runtime/secret-patterns.js";
import { scrubSecrets } from "../../../src/runtime/runlog/redact.js";
import { makeSyntheticSecret, SYNTHETIC_SECRET_KINDS } from "../../fixtures/synthetic-secret.js";
import {
  detectSecretEgress,
  findSecretEgress,
  makeAllSeeds,
  SecretEgressViolation,
} from "./secret-egress-detector.js";

/** A realistic multi-line run-log context around one planted secret. */
function logAround(secret: string): string {
  return [
    "== pass output (excerpt) ==",
    "$ deploy --dry-run",
    `provider says: ${secret}`,
    "exit status 0",
  ].join("\n");
}

describe("CF-INV-011 — one shared secret policy scrubs every egress (L1 guardrail, HB-016)", () => {
  it("every synthetic seed kind trips exactly its expected canonical pattern (fixture ↔ product agreement)", () => {
    expect(SYNTHETIC_SECRET_KINDS).toHaveLength(8); // the ticket's 8 kinds — a shrunk fixture must fail loudly
    for (const kind of SYNTHETIC_SECRET_KINDS) {
      const seed = makeSyntheticSecret(kind);
      const pattern = SECRET_PATTERNS.find((p) => p.name === seed.expectedPatternName);
      expect(pattern, `no canonical pattern named "${seed.expectedPatternName}" for kind "${kind}"`).toBeDefined();
      expect(
        pattern!.pattern.test(seed.value),
        `canonical pattern "${seed.expectedPatternName}" does not fire on its own synthetic seed (${kind})`,
      ).toBe(true);
    }
  });

  it("scrubSecrets removes each seed kind from realistic log text and leaves the named marker", () => {
    for (const seed of makeAllSeeds()) {
      const scrubbed = scrubSecrets(logAround(seed.value));
      expect(scrubbed, `seed ${seed.kind} survived scrubSecrets`).not.toContain(seed.value);
      expect(scrubbed, `no named marker for ${seed.kind}`).toContain(`[REDACTED:${seed.expectedPatternName}]`);
      // The family oracle agrees: nothing secret-shaped is left.
      detectSecretEgress(`scrubSecrets(${seed.kind})`, scrubbed, [seed]);
    }
  });

  it("a multi-secret blob (all 8 kinds interleaved with prose) comes out with zero canonical-pattern matches", () => {
    const seeds = makeAllSeeds();
    const blob = seeds.map((seed, i) => `step ${i}: captured ${seed.value} during the turn`).join("\n");
    const scrubbed = scrubSecrets(blob);
    detectSecretEgress("multi-secret blob", scrubbed, seeds);
    // Non-vacuous: one marker per planted seed actually landed.
    const markers = scrubbed.match(/\[REDACTED:[a-z-]+\]/g) ?? [];
    expect(markers.length).toBeGreaterThanOrEqual(seeds.length);
  });

  it("re-scrubbing already-scrubbed text is byte-identical (capture-time re-scrub relies on this, src/narrative/sources.ts)", () => {
    const seeds = makeAllSeeds();
    const once = scrubSecrets(seeds.map((seed) => logAround(seed.value)).join("\n---\n"));
    expect(scrubSecrets(once)).toBe(once);
  });

  it("scans stay fresh across occurrences and calls: the same seed twice in one text, and the same text twice, are always fully scrubbed", () => {
    // Guards the asGlobal contract: a shared /g RegExp's mutable lastIndex
    // would let the second occurrence or the second call slip through.
    const seed = makeSyntheticSecret("github-token");
    const text = `first ${seed.value} then again ${seed.value} end`;
    const first = scrubSecrets(text);
    expect(first).not.toContain(seed.value);
    expect(first.match(/\[REDACTED:github-token\]/g)).toHaveLength(2);
    expect(scrubSecrets(text)).toBe(first);
  });

  it("negative control: a weakened scrub (identity bypass wrapper, test-side only) leaks every seed and the detector FIRES", () => {
    const seeds = makeAllSeeds();
    // The deliberate bypass — what an egress path would emit if its scrub
    // were dropped or forked to a weaker local list. Lives HERE, never in src.
    const weakenedScrub = (text: string): string => text;
    const leaked = weakenedScrub(seeds.map((seed) => logAround(seed.value)).join("\n"));

    expect(() => detectSecretEgress("weakened-scrub egress", leaked, seeds)).toThrow(SecretEgressViolation);

    // The detector names both the verbatim seed and the canonical pattern —
    // every kind is individually caught, so the detector cannot be passing on
    // a subset.
    const findings = findSecretEgress(leaked, seeds);
    for (const seed of seeds) {
      expect(findings.join("\n")).toContain(`verbatim synthetic seed survived (${seed.kind})`);
      expect(findings.join("\n")).toContain(`"${seed.expectedPatternName}"`);
    }
  });

  it("negative control: the detector fires on a pattern match even when the verbatim seed was mangled (JSON-escaped PEM)", () => {
    const seed = makeSyntheticSecret("pem-private-key");
    // What a JSON serializer does to a PEM block: newlines become the two
    // characters `\n`. `includes(seed.value)` can no longer fire; the
    // canonical pattern scan still must.
    const escaped = JSON.stringify({ output: seed.value });
    expect(escaped.includes(seed.value)).toBe(false);
    expect(() => detectSecretEgress("json-escaped PEM", escaped, [seed])).toThrow(/private-key-block/);
  });
});
