// The one place Cormidia's DRIFTING harness facts live: per-model prices used
// for cost estimation, documented model rosters, and the official upstream
// source each fact came from (#332).
//
// These facts used to sit inline in four modules — a price table in
// `adapters/codex.ts`, another in `adapters/cursor-pricing.ts`, a flat rate in
// `adapters/muse-usage.ts`, and a documented roster in `model-catalog.ts`. All
// four drift on the vendor's schedule, and a fact that drifts in four places is
// refreshed in none. `harness-metadata.json` is the machine-readable single
// source; `harness-metadata-parse.ts` validates it and this module hands
// adapters typed values.
//
// The freshness probe (`scripts/harness-freshness.mjs`) diffs that same JSON
// against upstream and proposes edits in a pull request. What the probe may
// never touch is deliberately NOT here: version bands live in
// `harness-support.ts`, because moving `testedWith` is a re-certification claim
// (docs/harness/adding-updating.md §6), not a fetched fact.

import document from "./harness-metadata.json" with { type: "json" };
import { parseHarnessMetadataEntry, type HarnessMetadataEntry, type ModelPrice } from "./harness-metadata-parse.js";
import type { RuntimeKind } from "./types.js";

export type { HarnessMetadataEntry, ModelPrice };

/**
 * Exhaustive by construction, the same guarantee `HARNESS_SUPPORT` gives: a new
 * `RuntimeKind` is a compile error until its metadata exists. A harness with no
 * declared upstream source is a harness nothing keeps current.
 */
export const HARNESS_METADATA: Record<RuntimeKind, HarnessMetadataEntry> = {
  claude: parseHarnessMetadataEntry(document, "claude"),
  codex: parseHarnessMetadataEntry(document, "codex"),
  pi: parseHarnessMetadataEntry(document, "pi"),
  cursor: parseHarnessMetadataEntry(document, "cursor"),
  grok: parseHarnessMetadataEntry(document, "grok"),
  opencode: parseHarnessMetadataEntry(document, "opencode"),
  muse: parseHarnessMetadataEntry(document, "muse"),
};

export function harnessMetadata(runtime: RuntimeKind): HarnessMetadataEntry {
  return HARNESS_METADATA[runtime];
}

/** The DOCUMENTED roster for harnesses that enumerate nothing locally, or
 *  `undefined` when the install itself is the roster. */
export function harnessRosterModels(runtime: RuntimeKind): readonly string[] | undefined {
  return HARNESS_METADATA[runtime].roster?.models;
}
