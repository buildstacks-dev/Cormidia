// The canonical secret-detection pattern list (build plan M2.4; standing
// decision in TODO.md): runlog redaction (src/runtime/runlog/redact.ts) and
// the qgates security scan (M4.4, src/loop/qgates.ts) BOTH import this —
// loop→runtime is the legal import direction. A second pattern list
// anywhere in the repo is a bug.
//
// Families per docs/loop.md §5's security-gate row. Philosophy matches the
// critical-ops gate: fail closed — a false positive costs a redacted log
// line or a human tap; a false negative costs a leaked credential.

export interface SecretPattern {
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
    // family below is what catches `aws_secret_access_key = …`.
    name: "aws-access-key-id",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    // PEM private-key blocks. When the END marker is missing (a chunked /
    // truncated log line) everything from BEGIN to end-of-text is key
    // material until proven otherwise — swallow it, fail closed.
    name: "private-key-block",
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|[\s\S]*$)/,
  },
  {
    // Generic key/token/password assignments: `password = "…"`,
    // `api_key: xyz`, env-style exports. Requires an assignment operator
    // and a ≥8-char value so prose ("the token is important") passes.
    name: "generic-assignment",
    pattern:
      /\b(?:api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*["']?[A-Za-z0-9_\-/+=.]{8,}["']?/i,
  },
];

/** Fresh global copy for scan/replace use — never share a /g RegExp across
 *  calls (its lastIndex is mutable state). */
export function asGlobal(p: SecretPattern): RegExp {
  const flags = p.pattern.flags.includes("g") ? p.pattern.flags : `${p.pattern.flags}g`;
  return new RegExp(p.pattern.source, flags);
}
