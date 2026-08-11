// CF-REG-332 — HB-139 — case-catalog.md §10.3, defect #332.

// CF-REG-332 — the drifting harness facts have exactly one home.
//
// Two obligations, both load-bearing:
//
//  1. **Behaviour did not move.** Centralizing the price tables was a pure
//     refactor, so every figure the inline tables produced — including the
//     conservative fallbacks and GPT-5.6's long-context band — is pinned here
//     with the value it had before the move. These numbers back the hard
//     per-turn budget cap; a silent shift is a silent overspend.
//  2. **Nothing drifted back inline.** A source-level detector fails if a
//     per-million rate reappears anywhere in `src/**` outside the metadata
//     file, which is how a "quick fix" would quietly recreate the second copy
//     the centralization exists to remove.

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cursorModelPrice, estimateCursorCostUsd } from "../../../src/runtime/adapters/cursor-pricing.js";
import { estimateMuseCostUsd } from "../../../src/runtime/adapters/muse-usage.js";
import { HARNESS_METADATA, harnessRosterModels } from "../../../src/runtime/harness-metadata.js";
import { harnessModelPrice, harnessPriceMultipliers } from "../../../src/runtime/harness-pricing.js";
import { readRuntimeModelCatalog } from "../../../src/runtime/model-catalog.js";
import { RUNTIME_KINDS } from "../../../src/runtime/registry.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const sourceRoot = join(repoRoot, "src");

/** The estimate codex.ts computed from its inline table, restated. */
function codexCost(tokensIn: number, tokensOut: number, model: string): number {
  const price = harnessModelPrice("codex", model);
  const multipliers = harnessPriceMultipliers("codex", model, tokensIn);
  return (
    (tokensIn / 1_000_000) * price.inputPerMTok * multipliers.input +
    (tokensOut / 1_000_000) * price.outputPerMTok * multipliers.output
  );
}

describe("CF-REG-332 — centralized harness metadata preserves every asserted price", () => {
  it("codex rows keep their documented list prices, longest prefix first", () => {
    expect(harnessModelPrice("codex", "gpt-5.6-sol-high")).toEqual({ inputPerMTok: 5, outputPerMTok: 30 });
    expect(harnessModelPrice("codex", "gpt-5.5")).toEqual({ inputPerMTok: 5, outputPerMTok: 30 });
    expect(harnessModelPrice("codex", "gpt-5.4-mini")).toEqual({ inputPerMTok: 0.75, outputPerMTok: 4.5 });
    // nano's list price is not published: the flagship rate is a documented
    // upper bound, and it must not resolve to the cheaper gpt-5.4 row.
    expect(harnessModelPrice("codex", "gpt-5.4-nano")).toEqual({ inputPerMTok: 5, outputPerMTok: 30 });
    expect(harnessModelPrice("codex", "gpt-5.4")).toEqual({ inputPerMTok: 2.5, outputPerMTok: 15 });
  });

  it("an off-roster codex model takes the flagship upper bound, never $0", () => {
    expect(harnessModelPrice("codex", "some-unreleased-model")).toEqual({ inputPerMTok: 5, outputPerMTok: 30 });
    expect(codexCost(1_000_000, 1_000_000, "some-unreleased-model")).toBeCloseTo(35, 10);
  });

  it("GPT-5.6's long-context band still multiplies input ×2 and output ×1.5 above 272k", () => {
    expect(harnessPriceMultipliers("codex", "gpt-5.6-sol", 272_000)).toEqual({ input: 1, output: 1 });
    expect(harnessPriceMultipliers("codex", "gpt-5.6-sol", 272_001)).toEqual({ input: 2, output: 1.5 });
    // The band is model-scoped: a cheaper row never inherits the surcharge.
    expect(harnessPriceMultipliers("codex", "gpt-5.4", 5_000_000)).toEqual({ input: 1, output: 1 });
    expect(codexCost(1_000_000, 1_000_000, "gpt-5.6-sol")).toBeCloseTo(10 + 45, 10);
  });

  it("cursor keeps every published row and both documented fallbacks", () => {
    expect(cursorModelPrice("claude-opus-5-thinking-xhigh")).toEqual({
      inputPerMTok: 5,
      cacheWritePerMTok: 6.25,
      cacheReadPerMTok: 0.5,
      outputPerMTok: 25,
    });
    expect(cursorModelPrice("gpt-5.3-codex").cacheReadPerMTok).toBe(0.175);
    // Unchanged pins from the adapter double: unpriced ids, and the separate
    // fast-mode upper bound.
    expect(cursorModelPrice("composer-2.5").outputPerMTok).toBe(50);
    expect(cursorModelPrice("cursor-grok-4.5-high-fast").outputPerMTok).toBe(150);
    expect(cursorModelPrice("gpt-5.6-sol-xhigh").outputPerMTok).toBe(30);
    expect(estimateCursorCostUsd({ uncached: 1_000_000, cacheRead: 0, cacheWrite: 0, tokensOut: 0 }, "auto")).toBe(10);
  });

  it("muse keeps its flat Spark rate, cached input included", () => {
    expect(estimateMuseCostUsd(1_000_000, 0, 0)).toBeCloseTo(1.25, 10);
    expect(estimateMuseCostUsd(0, 1_000_000, 0)).toBeCloseTo(0.15, 10);
    expect(estimateMuseCostUsd(0, 0, 1_000_000)).toBeCloseTo(4.25, 10);
  });

  it("a harness whose provider reports real spend refuses to hand back an estimate", () => {
    for (const kind of ["claude", "pi", "grok", "opencode"] as const) {
      expect(HARNESS_METADATA[kind].pricing).toBeNull();
      expect(() => harnessModelPrice(kind, "anything")).toThrow(/asserts no price table/);
      expect(harnessPriceMultipliers(kind, "anything", 10_000_000)).toEqual({ input: 1, output: 1 });
    }
  });

  it("the documented muse roster is served from the metadata, not a second literal", async () => {
    expect(harnessRosterModels("muse")).toEqual(["muse-spark-1.1", "muse-spark-1.2"]);
    const catalog = await readRuntimeModelCatalog("muse");
    expect(catalog.available).toBe(true);
    if (!catalog.available) return;
    expect(catalog.models).toEqual(["muse-spark-1.1", "muse-spark-1.2"]);
    expect(catalog.source).toContain("research/2026-08-06_adapter-upstream-references.md");
  });

  it("every harness declares metadata and at least one upstream source", () => {
    expect(Object.keys(HARNESS_METADATA).sort()).toEqual([...RUNTIME_KINDS].sort());
    for (const kind of RUNTIME_KINDS) {
      const entry = HARNESS_METADATA[kind];
      expect(entry.upstream.versionSources.length, `${kind} declares no upstream version source`).toBeGreaterThan(0);
      expect(entry.upstream.references.length).toBeGreaterThan(0);
      // A harness asserts a price table or explains why it does not — silence
      // about spend is the outcome INV-006 forbids.
      if (entry.pricing === null) expect(entry.pricingNote).toBeTruthy();
      if (entry.roster === null) expect(entry.rosterNote).toBeTruthy();
    }
  });

  it("negative control: no per-million rate literal survives anywhere in src/ but the metadata file", async () => {
    const files = await assertNonEmptyWalk(sourceRoot, /\.(?:ts|json)$/);
    const rate = /(?:input|output|cacheRead|cacheWrite|cached)PerMTok"?\s*[:=]\s*-?\d/i;
    const offenders: string[] = [];
    for (const file of files) {
      if (file === "runtime/harness-metadata.json") continue;
      if (rate.test(await readFile(join(sourceRoot, file), "utf8"))) offenders.push(file);
    }
    expect(offenders, "a price literal drifted back into source").toEqual([]);
    // The detector is not vacuous: it fires on the one file that does hold them.
    expect(rate.test(await readFile(join(sourceRoot, "runtime", "harness-metadata.json"), "utf8"))).toBe(true);
  });
});
