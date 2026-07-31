// HB-002 fixtures/synthetic-secret self-test — every generated kind trips
// exactly the intended entry of the product's canonical pattern list
// (src/runtime/secret-patterns.ts) and the real redactor, values are fresh
// per mint, and the committed fixture/test sources themselves contain no
// secret-shaped literal (harness rule 5).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SECRET_PATTERNS } from "../../src/runtime/secret-patterns.js";
import { scrubSecrets } from "../../src/runtime/runlog/redact.js";
import {
  makeSyntheticSecret,
  SYNTHETIC_SECRET_KINDS,
  type SyntheticSecretKind,
} from "./synthetic-secret.js";

function patternFor(name: string): RegExp {
  const entry = SECRET_PATTERNS.find((candidate) => candidate.name === name);
  if (entry === undefined) throw new Error(`no product secret pattern named ${name}`);
  return entry.pattern;
}

describe("HB-002 fixtures/synthetic-secret (runtime-generated, product-detectable)", () => {
  it.each(SYNTHETIC_SECRET_KINDS.map((kind) => [kind] as [SyntheticSecretKind]))(
    "mints %s matching its named product pattern",
    (kind) => {
      const minted = makeSyntheticSecret(kind);
      expect(minted.kind).toBe(kind);
      expect(patternFor(minted.expectedPatternName).test(minted.value)).toBe(true);
    },
  );

  it("mints fresh values on every call (never a reusable committed constant)", () => {
    for (const kind of SYNTHETIC_SECRET_KINDS) {
      expect(makeSyntheticSecret(kind).value).not.toBe(makeSyntheticSecret(kind).value);
    }
  });

  it("negative control: a planted synthetic value FIRES the real product redactor", () => {
    for (const kind of SYNTHETIC_SECRET_KINDS) {
      const minted = makeSyntheticSecret(kind);
      const planted = `line before\ncredential material: ${minted.value}\nline after`;
      const scrubbed = scrubSecrets(planted);
      expect(scrubbed, kind).toContain(`[REDACTED:${minted.expectedPatternName}]`);
      expect(scrubbed, kind).not.toContain(minted.value);
    }
  });

  it("negative control: benign prose does NOT fire (the generator is what makes it fire)", () => {
    const benign = "the deploy discussion mentioned credentials in passing, nothing sensitive";
    expect(scrubSecrets(benign)).toBe(benign);
  });

  it("committed sources of this fixture pair contain no secret-shaped literal (rule 5)", () => {
    for (const relative of ["./synthetic-secret.ts", "./synthetic-secret.test.ts"]) {
      const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
      expect(scrubSecrets(source), relative).toBe(source);
    }
  });
});
