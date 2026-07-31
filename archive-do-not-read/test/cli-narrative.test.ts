// CLI argument surface for `operon narrative` (#129) — parsing only; the
// fold/merge/render behavior is covered in test/narrative/.

import { describe, expect, it } from "vitest";
import { parseNarrativeArgs } from "../src/cli/narrative.js";

describe("operon narrative CLI", () => {
  it("parses flags and rejects unknown arguments", () => {
    expect(parseNarrativeArgs([])).toEqual({ json: false });
    expect(parseNarrativeArgs(["--app", "greenfield", "--json"])).toEqual({ app: "greenfield", json: true });
    expect(parseNarrativeArgs(["--episode", "ticket:greenfield:41"])).toEqual({
      episode: "ticket:greenfield:41",
      json: false,
    });
    expect(() => parseNarrativeArgs(["--bogus"])).toThrow('unknown argument "--bogus"');
    expect(() => parseNarrativeArgs(["--app"])).toThrow("--app needs a value");
  });
});
