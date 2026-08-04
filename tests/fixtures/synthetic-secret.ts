// fixtures/synthetic-secret.ts — runtime-generated secret-shaped strings.
//
// Harness rule 5 (tests/README.md): credential-shaped fixture content
// is generated at test time, never committed. Every generator here produces a
// value that (a) matches exactly one named entry in the product's canonical
// pattern list (src/runtime/secret-patterns.ts — the ONE list redaction and
// qgates share), so INV-011/redaction suites can plant it and assert the
// product detector fires, and (b) is guaranteed non-real: values embed a
// SYNTHETIC marker wherever the pattern's alphabet allows and fill the rest
// with fresh crypto randomness — they are minted locally and never read from
// env, keychains, or credential stores.
//
// The prefixes below are assembled by concatenation ("AK" + "IA", "gh" + "p_")
// so this committed file itself never contains a full secret-shaped literal —
// the self-test scans this source with the product patterns to hold that line.

import { randomBytes } from "node:crypto";

export type SyntheticSecretKind =
  | "aws-access-key-id"
  | "github-token"
  | "sk-api-key"
  | "slack-token"
  | "npm-token"
  | "jwt"
  | "pem-private-key"
  | "generic-assignment";

export interface SyntheticSecret {
  kind: SyntheticSecretKind;
  /** The secret-shaped string to plant in fixture content. */
  value: string;
  /** The `SECRET_PATTERNS` entry (by name) this value must trip. */
  expectedPatternName: string;
}

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const UPPER36 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const DIGITS = "0123456789";

function randomFrom(alphabet: string, length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    // Modulo bias is irrelevant for fixture material.
    out += alphabet.charAt((bytes[i] as number) % alphabet.length);
  }
  return out;
}

function base64url(length: number): string {
  return randomBytes(length).toString("base64url");
}

export function makeSyntheticSecret(kind: SyntheticSecretKind): SyntheticSecret {
  switch (kind) {
    case "aws-access-key-id":
      // \b(?:AKIA|ASIA)[0-9A-Z]{16}\b — marker consumes 9 of the 16 chars.
      return {
        kind,
        value: "AK" + "IA" + "SYNTHETIC" + randomFrom(UPPER36, 7),
        expectedPatternName: "aws-access-key-id",
      };
    case "github-token":
      // \bgh[pousr]_[A-Za-z0-9]{20,}\b
      return {
        kind,
        value: "gh" + "p_" + "SYNTHETIC" + randomFrom(BASE62, 27),
        expectedPatternName: "github-token",
      };
    case "sk-api-key":
      // \bsk-[A-Za-z0-9_-]{20,}
      return {
        kind,
        value: "sk-" + "SYNTHETIC-" + randomFrom(BASE62, 24),
        expectedPatternName: "sk-api-key",
      };
    case "slack-token":
      // \bxox[abprs]-[A-Za-z0-9-]{10,}
      return {
        kind,
        value: "xox" + "b-SYNTHETIC-" + randomFrom(DIGITS, 12),
        expectedPatternName: "slack-token",
      };
    case "npm-token":
      // \bnpm_[A-Za-z0-9]{36}
      return {
        kind,
        value: "npm" + "_SYNTHETIC" + randomFrom(BASE62, 27),
        expectedPatternName: "npm-token",
      };
    case "jwt": {
      // \beyJ…\.eyJ…\.… — "eyJ" is base64 of `{"`, so encode real JSON headers.
      const header = Buffer.from(`{"alg":"none","synthetic":"${base64url(6)}"}`, "utf8")
        .toString("base64url");
      const payload = Buffer.from(`{"sub":"synthetic-${base64url(6)}"}`, "utf8")
        .toString("base64url");
      return { kind, value: `${header}.${payload}.${base64url(12)}`, expectedPatternName: "jwt" };
    }
    case "pem-private-key": {
      // -----BEGIN [A-Z ]*PRIVATE KEY----- … -----END [A-Z ]*PRIVATE KEY-----
      // The body is random base64 — key-shaped, decodes to noise, never a key.
      const marker = "PRIVATE KEY";
      const body = [base64url(36), base64url(36), base64url(18)].join("\n");
      return {
        kind,
        value: `-----BEGIN SYNTHETIC ${marker}-----\n${body}\n-----END SYNTHETIC ${marker}-----`,
        expectedPatternName: "private-key-block",
      };
    }
    case "generic-assignment":
      // keyword-bearing assignment with a ≥8-char value.
      return {
        kind,
        value: `SYNTHETIC_API_${"KEY"}=${randomFrom(BASE62, 24)}`,
        expectedPatternName: "generic-assignment",
      };
  }
}

// Declared with `= [` + satisfies (not `: readonly …`) so this committed line
// itself cannot trip the generic-assignment product pattern — the self-test
// scans this file with the real pattern list and proved the annotated form
// matches (a nice negative control for the scan, resolved by rephrasing).
export const SYNTHETIC_SECRET_KINDS = [
  "aws-access-key-id",
  "github-token",
  "sk-api-key",
  "slack-token",
  "npm-token",
  "jwt",
  "pem-private-key",
  "generic-assignment",
] as const satisfies readonly SyntheticSecretKind[];
