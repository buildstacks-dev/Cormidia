// CF-INV-011 — exactly ONE pattern-policy source: structural sweep over src/
// (HB-016, FLOOR — non-discretionary).
//
// CORMIDIA-INV-011 falsifying shape (validation-design/invariants.md): "an
// egress path importing its own pattern list"; adversarial seed (e):
// "structural check: exactly one pattern-policy source". src/runtime/
// AGENTS.md pins the same rule: "`secret-patterns.ts` is the ONE
// secret-regex list — never fork a second list."
//
// Method: walk every src/**/*.ts (non-empty walk, fixtures/walk.ts) and flag
// any file whose source carries a credential-shape regex signature — the
// well-known token families (AWS key ids, GitHub token prefixes, Slack
// token/webhook shapes, Google API keys, JWT header prefix, PEM private-key
// markers, Stripe mode prefixes) that any real secret-pattern list must
// cover. The documented allowlist is exactly the one canonical module.
// This is a heuristic detector, so it proves itself both ways in this spec:
// it FIRES on the canonical list (so a rogue list of the same shape cannot
// hide) and on a seeded rogue module (negative control), and it stays silent
// on every other real src file (the sweep assertion itself).
//
// Layer: 1 (reads repo source, no product execution, no network).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";

const SRC_ROOT = fileURLToPath(new URL("../../../src/", import.meta.url));

/** The ONE module allowed to declare credential-shape patterns. */
const CANONICAL_POLICY_MODULE = "runtime/secret-patterns.ts";

/** Credential-shape signatures a secret-pattern list cannot avoid carrying.
 *  Each entry names the family it betrays. Kept case-sensitive and
 *  shape-specific so prose ("secret", "password") and non-secret regexes
 *  (e.g. the sensitive-domain keyword matchers in src/loop/plan-tickets.ts)
 *  never trip it. */
const PATTERN_LIST_SIGNATURES: ReadonlyArray<{ family: string; signature: RegExp }> = [
  // "AK"+"IA" assembled so this spec never contains the 4-char prefix run
  // in plain committed text (mirrors fixtures/synthetic-secret.ts hygiene).
  // No \b prefix: in regex SOURCE text the prefix often follows `\b` (a
  // word character), which a boundary-anchored signature would miss.
  { family: "aws-access-key-id", signature: new RegExp(`(?:${"AK"}IA|${"AS"}IA)[0-9A-Z[]`) },
  { family: "github-token", signature: /gh\[pousr\]|gh[pousr]_[A-Za-z0-9[]/ },
  { family: "github-fine-grained-pat", signature: /github_pat_/ },
  { family: "stripe-api-key", signature: /[srp]k_\(\?:live\|test\)|[srp]k_(?:live|test)_/ },
  { family: "slack-token", signature: /xox\[|xox[abprs]-/ },
  { family: "slack-webhook-url", signature: /hooks\\?\.slack\\?\.com/ },
  { family: "google-api-key", signature: /AIza/ },
  { family: "jwt", signature: /eyJ/ },
  { family: "private-key-block", signature: /PRIVATE KEY/ },
];

function signatureFamilies(source: string): string[] {
  return PATTERN_LIST_SIGNATURES.filter(({ signature }) => signature.test(source)).map(({ family }) => family);
}

describe("CF-INV-011 — exactly one pattern-policy source in src/ (structural, HB-016)", () => {
  it("no src module other than the canonical list carries credential-shape pattern signatures", async () => {
    // Non-empty walk: a moved/renamed src tree must fail red, never pass by
    // sweeping nothing (tests/README.md rule 4).
    const files = await assertNonEmptyWalk(SRC_ROOT, /\.ts$/);
    expect(files).toContain(CANONICAL_POLICY_MODULE);

    const offenders: Array<{ file: string; families: string[] }> = [];
    for (const file of files) {
      const source = await readFile(join(SRC_ROOT, file), "utf8");
      const families = signatureFamilies(source);
      if (families.length > 0) offenders.push({ file, families });
    }

    // The detector must FIRE on the canonical module itself — a sweep that
    // cannot see the real list could not see a rogue copy of it either.
    const canonical = offenders.find(({ file }) => file === CANONICAL_POLICY_MODULE);
    expect(canonical, "sweep failed to detect the canonical pattern list — the detector is blind").toBeDefined();
    expect(canonical!.families.length).toBeGreaterThanOrEqual(6);

    // The allowlist: exactly the one canonical module, nothing else.
    const rogue = offenders.filter(({ file }) => file !== CANONICAL_POLICY_MODULE);
    expect(
      rogue,
      `INV-011: src module(s) declare their own credential-shape patterns instead of importing ` +
        `${CANONICAL_POLICY_MODULE}: ${rogue.map(({ file, families }) => `${file} (${families.join(", ")})`).join("; ")}`,
    ).toEqual([]);
  });

  it("the two named policy consumers import the canonical module, not a fork (redaction + qgates)", async () => {
    // secret-patterns.ts's own header names its two structural consumers:
    // runlog redaction and the qgates security scan. Pin the import edges so
    // a refactor that forks either one goes red here.
    const redact = await readFile(join(SRC_ROOT, "runtime/runlog/redact.ts"), "utf8");
    expect(redact).toMatch(/from "\.\.\/secret-patterns\.js"/);
    const qgates = await readFile(join(SRC_ROOT, "loop/qgates.ts"), "utf8");
    expect(qgates).toMatch(/from "\.\.\/runtime\/secret-patterns\.js"/);
  });

  it("negative control: a seeded rogue local pattern list trips the sweep detector", () => {
    // Assembled by concatenation so this committed spec never carries a full
    // credential-shaped literal of its own.
    const rogueModule = [
      "// a hypothetical egress module quietly declaring its own scrubber",
      "const LOCAL_SECRET_RES = [",
      `  /\\b${"AK"}IA[0-9A-Z]{16}\\b/,`,
      `  /\\bgh${"p"}_[A-Za-z0-9]{20,}\\b/,`,
      "];",
    ].join("\n");
    const families = signatureFamilies(rogueModule);
    expect(families).toContain("aws-access-key-id");
    expect(families).toContain("github-token");
  });

  it("negative control: non-secret regexes that merely mention sensitive words do NOT trip the sweep (no false-positive drift)", () => {
    // The sensitive-domain prose matchers (src/loop/plan-tickets.ts) and
    // ordinary config prose must stay clean — the detector keys on
    // credential SHAPES, not vocabulary.
    const benign = [
      "const DOMAIN_PATTERNS = { secret: /\\bsecrets?\\b/i, payment: /\\bpayments?\\b/i };",
      'const label = "Touches secret/credential handling";',
      "const env = /\\b[A-Z_]*TOKEN\\b/;",
    ].join("\n");
    expect(signatureFamilies(benign)).toEqual([]);
  });
});
