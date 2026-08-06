// The canonical secret-detection pattern list (build plan M2.4; standing
// decision in TODO.md): runlog redaction (src/runtime/runlog/redact.ts) and
// the qgates security scan (M4.4, src/loop/qgates.ts) BOTH import this —
// loop→runtime is the legal import direction. A second pattern list
// anywhere in the repo is a bug.
//
// Families per docs/loop/design.md §5's security-gate row. Philosophy matches the
// critical-ops gate: fail closed — a false positive costs a redacted log
// line or a human tap; a false negative costs a leaked credential.

interface SecretPattern {
  name: string;
  /** Stateless (no /g): safe for .test()/.exec(). Consumers that scan or
   *  replace globally use asGlobal() for a fresh, lastIndex-free copy. */
  pattern: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    // §5 sketches sk-[A-Za-z0-9]{32,}; broadened to dashed/underscored
    // segments so real segmented keys (e.g. sk-ant-api03-…) can't slip
    // through the stricter alnum-only run-length.
    name: "sk-api-key",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}/,
  },
  {
    // GitHub token family — classic PATs (ghp_) plus the sibling prefixes
    // (gho_ OAuth, ghu_/ghs_ app, ghr_ refresh): same shape, same risk.
    name: "github-token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  },
  {
    // GitHub fine-grained PATs (`github_pat_<22>_<59>`) — GitHub's current
    // recommended token type. The classic `gh[pousr]_` family above does NOT
    // cover them (the char after `gh` is `i`), so without this entry a
    // fine-grained PAT slips the redactor AND the qgates security scan that
    // both import this list. Underscore is part of the value alphabet.
    name: "github-fine-grained-pat",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  },
  {
    // AWS access key ids (AKIA permanent, ASIA temporary). Secret access
    // keys have no reliable shape of their own — the generic-assignment
    // family below is what catches `aws_secret_access_key = …` (that exact
    // spelling is pinned in test/runlog-redact.test.ts; A-003 proved the
    // old \b-anchored pattern never matched it).
    name: "aws-access-key-id",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    // Stripe API keys — secret (sk_), restricted (rk_), publishable (pk_),
    // live and test modes. Underscore after the prefix letters: the sk-
    // entry above requires a literal hyphen and cannot match these (A-007).
    name: "stripe-api-key",
    pattern: /\b[srp]k_(?:live|test)_[A-Za-z0-9]{16,}/,
  },
  {
    // Slack tokens — xoxb (bot), xoxp (user), xoxa (app), xoxr (refresh),
    // xoxs (session): digit/letter runs joined by hyphens.
    name: "slack-token",
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  },
  {
    // Slack incoming-webhook URLs — the path IS the credential.
    name: "slack-webhook-url",
    pattern: /\bhttps:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/,
  },
  {
    // Google API keys — AIza + 35 URL-safe chars. No trailing \b: a longer
    // tail means a malformed key, not a safe one — fail closed.
    name: "google-api-key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}/,
  },
  {
    // npm access tokens — npm_ + 36 base62 chars.
    name: "npm-token",
    pattern: /\bnpm_[A-Za-z0-9]{36}/,
  },
  {
    // JWTs — dot-joined base64url segments; header and payload both start
    // with eyJ (base64 of `{"`). Signature may be short or absent (alg=none),
    // and a signed JWT is a bearer credential wherever it appears.
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/,
  },
  {
    // URL userinfo credentials — scheme://user:password@host (database DSNs,
    // basic-auth remotes). The password is the secret; the whole userinfo
    // authority is swallowed.
    name: "url-userinfo-credentials",
    pattern: /:\/\/[^:/\s@]+:[^@/\s]+@/,
  },
  {
    // PEM private-key blocks. When the END marker is missing (a chunked /
    // truncated log line) everything from BEGIN to end-of-text is key
    // material until proven otherwise — swallow it, fail closed.
    name: "private-key-block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|[\s\S]*$)/,
  },
  {
    // Generic key/token/password assignments: `password = "…"`,
    // `api_key: xyz`, env-style exports, and — critically — keyword-bearing
    // snake_case/SCREAMING_SNAKE/kebab identifiers (`GITHUB_TOKEN=…`,
    // `aws_secret_access_key = …`, `db-password: …`). `_` is a word
    // character, so a \b-anchored keyword can never fire at the `TOKEN`/`_`
    // seam (A-003); the explicit lookbehind boundary plus the `[_-]`-joined
    // prefix/suffix segments are what make the snake_case forms match.
    // Requires an assignment operator and a ≥8-char value so prose
    // ("the token is important") passes.
    //
    // The identifier segment loops are BOUNDED — chunks `{1,32}`, at most
    // `{0,8}` segments each side (P0-03). Real credential identifiers are
    // short; the previous `[A-Za-z0-9]+` chunk with a `*` segment loop was
    // ~O(n²)/worse on a long `[A-Za-z0-9_-]` run bearing a keyword but no
    // assignment (base64url/JWT/data-URI shapes) — an unbounded `+` backtracks
    // O(n) per start offset over O(n) offsets, and `scrubSecrets` runs this
    // pattern with /g over untrusted multi-line runlogs on every write, so
    // that was a reachable scrubber stall. The bounds keep per-offset work
    // constant (linear overall) with no loss of matched forms — every A-003
    // snake_case/SCREAMING/hyphenated/spaced form has ≤2 short segments.
    name: "generic-assignment",
    pattern:
      /(?<![A-Za-z0-9])(?:[A-Za-z0-9]{1,32}[_-]){0,8}(?:api[_-]?key|secret|token|password|passwd|pwd)(?:[_-][A-Za-z0-9]{1,32}){0,8}["']?\s*[:=]\s*["']?[A-Za-z0-9_\-/+=.]{8,}["']?/i,
  },
];

/** Fresh global copy for scan/replace use — never share a /g RegExp across
 *  calls (its lastIndex is mutable state). */
export function asGlobal(p: SecretPattern): RegExp {
  const flags = p.pattern.flags.includes("g") ? p.pattern.flags : `${p.pattern.flags}g`;
  return new RegExp(p.pattern.source, flags);
}
