// The capabilities inventory (src/cli/context-info.ts) is the machine-
// readable discovery surface the packaged $operon skill defers to instead of
// enumerating commands. It is hand-maintained, so a new subcommand wired
// into src/cli.ts's dispatch table can silently miss it — `operon narrative`
// did exactly that in #132. cli.ts executes main() on import, so this test
// scans source text instead (the default-branch tripwire pattern).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("capabilities inventory covers the CLI dispatch table", () => {
  it("every dispatch-table command appears in CAPABILITIES (top-level token)", () => {
    const cli = readFileSync("src/cli.ts", "utf8");
    const registry = /const COMMANDS: Record<string, CliCommand> = \{([\s\S]*?)\n\};/.exec(cli);
    expect(registry, "COMMANDS registry literal not found in src/cli.ts").not.toBeNull();
    const dispatch = [...registry![1]!.matchAll(/^\s{2}(?:"([^"]+)"|([a-z][a-z-]*)):\s*\{/gm)]
      .map((m) => m[1] ?? m[2]!)
      .filter((name) => name !== undefined);
    expect(dispatch.length).toBeGreaterThan(15);

    const info = readFileSync("src/cli/context-info.ts", "utf8");
    const table = /const CAPABILITIES = \[([\s\S]*?)\n\] as const;/.exec(info);
    expect(table, "CAPABILITIES literal not found in src/cli/context-info.ts").not.toBeNull();
    const covered = new Set(
      [...table![1]!.matchAll(/command:\s*"([^"]+)"/g)].map((m) => m[1]!.split(" ")[0]!),
    );

    // `capabilities` and `context` describe the discovery surface itself;
    // everything else an agent can invoke must be discoverable through it.
    const exempt = new Set(["capabilities", "context"]);
    const missing = dispatch.filter((name) => !exempt.has(name) && !covered.has(name));
    expect(missing, `commands missing from CAPABILITIES: ${missing.join(", ")}`).toEqual([]);
  });
});
