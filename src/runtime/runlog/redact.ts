// Redaction helpers for L1/L2 run records (build plan M2.4; docs/loop.md §9:
// "no full prompts, no tool args, no secrets — the quality-gate secret
// regexes double as a log scrubber"; dashboards read previews ~120 chars,
// args hashed). L3 forensics stay verbatim and local — these helpers are for
// the exportable layers only.

import { createHash } from "node:crypto";
import { asGlobal, SECRET_PATTERNS } from "../secret-patterns.js";

/** Single-line preview capped at ~`max` chars (default 120, §9). Newlines
 *  collapse to spaces so an envelope preview never breaks a table row. */
export function truncatePreview(text: string, max = 120): string {
  const oneLine = text.replace(/\s*\n\s*/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/** Deterministic digest of tool args for L2's `tool.called` events (§9:
 *  never full args). Key order is canonicalized, so structurally equal
 *  objects hash identically regardless of construction order. */
export function hashArgs(args: unknown): string {
  return createHash("sha256").update(canonicalJson(args)).digest("hex").slice(0, 16);
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

/** Replace every canonical secret-pattern match (src/runtime/secret-patterns.ts
 *  — the single list M4.4's gate scan also imports) with a named marker.
 *  Normal text passes through untouched. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERNS) {
    out = out.replace(asGlobal(p), `[REDACTED:${p.name}]`);
  }
  return out;
}
