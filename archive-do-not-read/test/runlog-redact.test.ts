// Tests runlog redaction helpers and the canonical secret-pattern list.
// Covers every supported secret family, benign near-misses, stateless regexes,
// preview truncation, newline collapse, and deterministic argument hashing.
// Uses inline strings only; no filesystem state, network, auth, or wall-clock
// time is required.

import { describe, expect, it } from "vitest";
import { hashArgs, scrubSecrets, truncatePreview } from "../src/runtime/runlog/redact.js";
import { SECRET_PATTERNS } from "../src/runtime/secret-patterns.js";

describe("scrubSecrets", () => {
  it("redacts every §5 secret family, named", () => {
    const cases: Array<{ text: string; marker: string }> = [
      { text: `key: sk-${"a1".repeat(20)}`, marker: "[REDACTED:sk-api-key]" },
      { text: `sk-ant-api03-${"x".repeat(24)}`, marker: "[REDACTED:sk-api-key]" },
      { text: `token ghp_${"A2".repeat(18)} pushed`, marker: "[REDACTED:github-token]" },
      // Fine-grained PAT (GitHub's current recommended token type): the
      // classic gh[pousr]_ pattern cannot match it, so it needs its own entry
      // or it leaks the live credential through every exportable log line.
      {
        text: `github_pat_11ABCDE0123456789_${"z".repeat(59)}`,
        marker: "[REDACTED:github-fine-grained-pat]",
      },
      {
        // Bare in a JSON field under a non-keyword key — the generic-assignment
        // fallback does not catch this shape, so the dedicated pattern must.
        text: `{"pat":"github_pat_22ZYXWV9876543210_${"q".repeat(59)}"}`,
        marker: "[REDACTED:github-fine-grained-pat]",
      },
      { text: "creds AKIAIOSFODNN7EXAMPLE end", marker: "[REDACTED:aws-access-key-id]" },
      {
        text: "-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----",
        marker: "[REDACTED:private-key-block]",
      },
      {
        // Partial PEM (chunked log line): redacts from BEGIN onward.
        text: "-----BEGIN PRIVATE KEY-----\nMIIB truncated…",
        marker: "[REDACTED:private-key-block]",
      },
      { text: 'password = "hunter2hunter2"', marker: "[REDACTED:generic-assignment]" },
      { text: "export API_KEY=abcd1234efgh", marker: "[REDACTED:generic-assignment]" },
      // A-003 regression — snake_case/SCREAMING_SNAKE keyword-bearing
      // identifiers. `_` is a word character, so the old \b-anchored keyword
      // group never fired at the `TOKEN`/`_` seam and every one of these
      // leaked through BOTH consumers of the list.
      { text: "GITHUB_TOKEN=ghSomeLongOpaqueValue123", marker: "[REDACTED:generic-assignment]" },
      { text: "DB_PASSWORD=SuperSecretValue123456", marker: "[REDACTED:generic-assignment]" },
      { text: "MY_API_TOKEN=SuperSecretValue123456", marker: "[REDACTED:generic-assignment]" },
      { text: "APP_SECRET=SuperSecretValue123456", marker: "[REDACTED:generic-assignment]" },
      { text: "openai_api_key=SuperSecretValue123456", marker: "[REDACTED:generic-assignment]" },
      {
        text: "export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        marker: "[REDACTED:generic-assignment]",
      },
      {
        // The exact spaced-assignment case the source comment on
        // aws-access-key-id claims the generic-assignment family covers.
        text: "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        marker: "[REDACTED:generic-assignment]",
      },
      {
        // Quoted-JSON form of the same credential.
        text: '  "aws_secret_access_key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"',
        marker: "[REDACTED:generic-assignment]",
      },
      // Hyphenated form — worked before the A-003 fix, must keep working.
      { text: "db-password = SuperSecretValue123456", marker: "[REDACTED:generic-assignment]" },
      // A-007 regression — credential families that had no pattern at all.
      {
        text: "sk_live_51H8xQ2eZvKYlo2CmPfRkTn0aBcDeFgHiJkLmNoPqRs",
        marker: "[REDACTED:stripe-api-key]",
      },
      {
        text: "restricted rk_live_51H8xQ2eZvKYlo2CmPfRkTn0aBcDeFgHiJkLmNoPqRs",
        marker: "[REDACTED:stripe-api-key]",
      },
      {
        text: "xoxb-2334455667-2334455667788-AbCdEfGhIjKlMnOpQrStUvWx",
        marker: "[REDACTED:slack-token]",
      },
      {
        text: "post to https://hooks.slack.com/services/T0000000/B0000000/XXXXXXXXXXXXXXXXXXXXXXXX",
        marker: "[REDACTED:slack-webhook-url]",
      },
      {
        // AIza + exactly 35 URL-safe chars (the real Google key length).
        text: `maps key AIzaSyD${"1aB-_2cD".repeat(4)}` /* 3+32=35 chars after AIza */,
        marker: "[REDACTED:google-api-key]",
      },
      {
        // Bare npm token under a non-keyword neighborhood — the
        // generic-assignment fallback cannot catch this shape, so the
        // dedicated pattern must.
        text: "published with npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
        marker: "[REDACTED:npm-token]",
      },
      {
        text: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
        marker: "[REDACTED:jwt]",
      },
      {
        text: "postgres://admin:S3cr3tP4ssw0rd@db.example.com:5432/prod",
        marker: "[REDACTED:url-userinfo-credentials]",
      },
    ];
    for (const { text, marker } of cases) {
      const scrubbed = scrubSecrets(text);
      expect(scrubbed, text).toContain(marker);
      // The secret material itself is gone.
      expect(scrubbed).not.toMatch(
        /hunter2hunter2|AKIAIOSFODNN7EXAMPLE|MIIB|SuperSecretValue123456|wJalrXUtnFEMI|51H8xQ2eZvKYlo2Cm|2334455667|aBcDeFgHiJkLmNoPqRs|S3cr3tP4ssw0rd|dBjftJeZ/,
      );
    }
  });

  it("leaves normal text untouched", () => {
    const benign = [
      "this sentence mentions skiing and github without credentials",
      "the token is important to the parser design",
      "tokenCount = 5 and passwordField has no value here",
      "rotate the key ceremony notes (no material present)",
      "the github_pat prefix is mentioned here without any actual token value",
      // Near-misses for the A-003 snake_case boundary fix: keyword-bearing
      // identifiers with no assignment, no value, or a short value.
      "set the GITHUB_TOKEN environment variable before running the loop",
      "DB_PASSWORD= (left empty on purpose)",
      "the aws_secret_access_key field is described in docs/config.md",
      "max_tokens: 128000 controls the context window", // "tokens" is not the keyword "token"
      // Near-misses for the A-007 families: prefixes in prose, no material.
      "the sk_live_ prefix denotes a live-mode Stripe key",
      "xoxb-style tokens rotate on reinstall",
      "see https://hooks.slack.com/services docs for the payload shape",
      "AIza is the fixed Google API key prefix",
      "npm_config_registry=https://registry.npmjs.org",
      "eyJ appears at the start of every JWT header segment",
      "https://example.com:8080/path has a port but no userinfo",
    ];
    for (const text of benign) expect(scrubSecrets(text), text).toBe(text);
  });

  it("patterns are stateless (no /g) so repeated .test() calls stay correct", () => {
    for (const p of SECRET_PATTERNS) {
      expect(p.pattern.flags.includes("g"), p.name).toBe(false);
    }
  });

  // P0-03 ReDoS regression. The generic-assignment identifier segment loops
  // used to be unbounded (`(?:[A-Za-z0-9]+[_-])*` … `(?:[_-][A-Za-z0-9]+)*`),
  // giving ~O(n²)/worse backtracking on a long `[A-Za-z0-9_-]` run that bears
  // a keyword but never reaches an assignment operator (base64url / JWT /
  // data-URI shapes). scrubSecrets runs every pattern with /g over untrusted
  // multi-line runlogs on EVERY write, so that was a reachable scrubber stall
  // (measured >10s at 10KB, >100s at 20KB before the bound). The bounded
  // `{1,32}` chunks / `{0,8}` segments make it linear. Ceiling is deliberately
  // generous (500ms for 80KB) so it cannot flake on slow CI while still being
  // orders of magnitude below any quadratic regression (which would take
  // minutes at this size).
  it("scrubs 80KB adversarial keyword runs in linear time (ReDoS regression)", () => {
    const N = 80 * 1024;
    const adversarial: Record<string, string> = {
      // keyword-bearing, `_`-delimited run — no `:`/`=` anywhere, so the match
      // never completes and the segment loops backtrack at every offset.
      "keyword-delimited": "secret_".repeat(Math.ceil(N / 7)).slice(0, N),
      // one separator-free alnum chunk ending in a keyword — exercises the
      // per-chunk `{1,32}` length bound (an unbounded `+` backtracks O(n) here).
      "separator-free": `${"a".repeat(N - 6)}secret`,
      // base64url-shaped run with an embedded keyword and no assignment.
      "base64url": `${"aB3-_dE7f".repeat(Math.ceil(N / 9)).slice(0, N - 6)}secret`,
    };
    // Warm the JIT so the timed run measures steady-state, not compilation.
    for (const text of Object.values(adversarial)) scrubSecrets(text.slice(0, 512));
    for (const [shape, text] of Object.entries(adversarial)) {
      const start = performance.now();
      scrubSecrets(text);
      const elapsedMs = performance.now() - start;
      expect(elapsedMs, `${shape} scrub took ${elapsedMs.toFixed(0)}ms`).toBeLessThan(500);
    }
  });
});

describe("truncatePreview", () => {
  it("caps at ~120 chars with an ellipsis and collapses newlines", () => {
    const short = "one line under the cap";
    expect(truncatePreview(short)).toBe(short);

    const long = "x".repeat(300);
    const preview = truncatePreview(long);
    expect(preview.length).toBe(120);
    expect(preview.endsWith("…")).toBe(true);

    expect(truncatePreview("a\n  b\nc")).toBe("a b c");
  });
});

describe("hashArgs", () => {
  it("is deterministic and key-order independent", () => {
    const a = hashArgs({ file: "x.ts", line: 3, opts: { deep: true } });
    const b = hashArgs({ opts: { deep: true }, line: 3, file: "x.ts" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("different args hash differently; primitives and arrays work", () => {
    expect(hashArgs({ cmd: "ls" })).not.toBe(hashArgs({ cmd: "rm" }));
    expect(hashArgs([1, 2, 3])).toBe(hashArgs([1, 2, 3]));
    expect(hashArgs([1, 2, 3])).not.toBe(hashArgs([3, 2, 1]));
    expect(hashArgs("bare string")).toBe(hashArgs("bare string"));
    expect(hashArgs(undefined)).toBe(hashArgs(undefined));
  });
});
