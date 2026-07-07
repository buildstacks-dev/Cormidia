// Redaction helpers + the canonical secret-pattern list (build plan M2.4;
// docs/loop.md §9 redaction rules, §5 secret families). M4.4's qgates scan
// imports the SAME pattern module — a second list anywhere is a bug.

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
    ];
    for (const { text, marker } of cases) {
      const scrubbed = scrubSecrets(text);
      expect(scrubbed, text).toContain(marker);
      // The secret material itself is gone.
      expect(scrubbed).not.toMatch(/hunter2hunter2|AKIAIOSFODNN7EXAMPLE|MIIB/);
    }
  });

  it("leaves normal text untouched", () => {
    const benign = [
      "this sentence mentions skiing and github without credentials",
      "the token is important to the parser design",
      "tokenCount = 5 and passwordField has no value here",
      "rotate the key ceremony notes (no material present)",
      "the github_pat prefix is mentioned here without any actual token value",
    ];
    for (const text of benign) expect(scrubSecrets(text), text).toBe(text);
  });

  it("patterns are stateless (no /g) so repeated .test() calls stay correct", () => {
    for (const p of SECRET_PATTERNS) {
      expect(p.pattern.flags.includes("g"), p.name).toBe(false);
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
