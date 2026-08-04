// CF-REG-269 — independently reported live case groups cannot share one
// mutable error accumulator. The seeded source below proves the structural
// detector fires on the file-scope shape that contaminated later wrappers.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const campaignSourcePath = fileURLToPath(new URL("../../live/campaign-live.test.ts", import.meta.url));

function hasFileScopeErrorAccumulator(source: string): boolean {
  return /^const errors: string\[\] = \[\];$/m.test(source);
}

describe("CF-REG-269 — live campaign error isolation", () => {
  it("keeps error accumulators inside the three case groups that catch and aggregate errors", () => {
    const source = readFileSync(campaignSourcePath, "utf8");

    expect(hasFileScopeErrorAccumulator(source)).toBe(false);
    expect(source.match(/^    const errors: string\[\] = \[\];$/gm)).toHaveLength(3);
  });

  it("seeded negative control: the former file-scope accumulator is rejected", () => {
    const seededViolation = [
      "let campaign: DurableCampaignRunner;",
      "const errors: string[] = [];",
      "describe('authorized L3 campaign', () => {});",
    ].join("\n");

    expect(hasFileScopeErrorAccumulator(seededViolation)).toBe(true);
  });
});
