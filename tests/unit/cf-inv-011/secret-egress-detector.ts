// CF-INV-011 — the family's shared egress detector (HB-016).
//
// CORMIDIA-INV-011 (validation-design/invariants.md): verbatim L3 evidence
// stays inside its permitted local evidence boundary; secret-bearing content
// never crosses into lower-sensitivity surfaces, and every surface that
// scans, scrubs, previews, exports, or captures does so through the ONE
// shared secret-pattern policy.
//
// This module is the family oracle every CF-INV-011 spec calls on a rendered
// egress corpus (published issue body, portable HTML, story.json bytes,
// snapshot JSON, envelope bytes). It throws when
//   (a) any planted synthetic seed value survives verbatim, or
//   (b) the product's own canonical pattern list (src/runtime/
//       secret-patterns.ts) still matches the corpus.
// Using SECRET_PATTERNS itself as the oracle keeps the detector incapable of
// drifting from the one policy the invariant names: anything the product
// would scrub or refuse elsewhere is what this detector flags here.
//
// Negative-control rule (tests/README.md rule 3): the scrub-guardrail
// unit spec proves this detector FIRES on a deliberately weakened (bypassed)
// scrub before any suite relies on its silence.

import { asGlobal, SECRET_PATTERNS } from "../../../src/runtime/secret-patterns.js";
import { makeSyntheticSecret, SYNTHETIC_SECRET_KINDS, type SyntheticSecret } from "../../fixtures/synthetic-secret.js";

export class SecretEgressViolation extends Error {
  constructor(
    readonly surface: string,
    readonly findings: readonly string[],
  ) {
    super(`INV-011 violated at egress surface "${surface}": ${findings.join("; ")}`);
    this.name = "SecretEgressViolation";
  }
}

/** One fresh synthetic seed per kind (all 8), minted at runtime — never
 *  committed (tests/README.md rule 5). */
export function makeAllSeeds(): SyntheticSecret[] {
  return SYNTHETIC_SECRET_KINDS.map((kind) => makeSyntheticSecret(kind));
}

/** Non-throwing scan: every verbatim seed survival plus every canonical
 *  pattern match found in the corpus, as human-readable findings. The
 *  pattern scan matters even where `includes` cannot fire (e.g. a PEM seed
 *  whose newlines were JSON-escaped inside an HTML data blob still matches
 *  the canonical private-key pattern). */
export function findSecretEgress(text: string, seeds: readonly SyntheticSecret[]): string[] {
  const findings: string[] = [];
  for (const seed of seeds) {
    if (text.includes(seed.value)) {
      findings.push(`verbatim synthetic seed survived (${seed.kind})`);
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    // Fresh /g copy per scan — never a shared, lastIndex-bearing RegExp.
    const match = asGlobal(pattern).exec(text);
    if (match !== null) {
      findings.push(`canonical pattern "${pattern.name}" matches: "${excerpt(match[0] ?? "")}"`);
    }
  }
  return findings;
}

/** The throwing entry point. Call it on the exact bytes/text that cross the
 *  boundary (file contents, HTTP body, issue body), not on some pre-render
 *  intermediate. */
export function detectSecretEgress(surface: string, text: string, seeds: readonly SyntheticSecret[]): void {
  const findings = findSecretEgress(text, seeds);
  if (findings.length > 0) throw new SecretEgressViolation(surface, findings);
}

/** JSON-aware entry point for JSON egress surfaces (snapshot bodies,
 *  story.json / envelope.json bytes). A structured document legitimately
 *  places schema vocabulary adjacent across key/value quoting — e.g. the
 *  observe snapshot's `"state_token":"completed"` — which the
 *  assignment-shaped canonical pattern (correctly, for plain text) reads as
 *  a credential assignment. Parsing and scanning every string key and every
 *  string value as independent texts keeps the detector precise for JSON
 *  without weakening the whole-text scan used for markdown/HTML surfaces.
 *  Unparseable input is itself a violation finding — never a silent pass. */
export function detectSecretEgressInJson(surface: string, jsonText: string, seeds: readonly SyntheticSecret[]): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new SecretEgressViolation(surface, ["surface claimed to be JSON but does not parse"]);
  }
  const findings: string[] = [];
  walkStrings(parsed, "$", (path, value) => {
    for (const finding of findSecretEgress(value, seeds)) {
      findings.push(`${path}: ${finding}`);
    }
  });
  if (findings.length > 0) throw new SecretEgressViolation(surface, findings);
}

function walkStrings(value: unknown, path: string, visit: (path: string, text: string) => void): void {
  if (typeof value === "string") {
    visit(path, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkStrings(entry, `${path}[${index}]`, visit));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      visit(`${path}.${key} (key)`, key);
      walkStrings(entry, `${path}.${key}`, visit);
    }
  }
}

function excerpt(match: string): string {
  const oneLine = match.replace(/\s+/g, " ");
  return oneLine.length <= 60 ? oneLine : `${oneLine.slice(0, 60)}…`;
}
