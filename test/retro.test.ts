// Tests retro reporting in src/org/retro.ts plus cmdRetro.
// Covers weekly telemetry/scorecard aggregation and CLI path output.
// (Memory curation was retired with learning-loop M1 — issue #34.)
// Uses temp org homes and mocked console output; no network, auth, real org
// state, or live clock is required.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runRetro } from "../src/org/retro.js";
import { appendScorecardEvent } from "../src/org/scorecards.js";
import { cmdRetro } from "../src/cli/retro.js";
import { initOrgHome } from "../src/org/home.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

describe("runRetro", () => {
  it("writes a weekly report with telemetry and scorecard aggregates", async () => {
    const home = makeOrgHome();
    try {
      mkdirSync(join(home.root, "telemetry"), { recursive: true });
      writeFileSync(
        join(home.root, "telemetry", "2026-07-04.jsonl"),
        `${JSON.stringify({ at: "2026-07-04T12:00:00Z", app: "alpha", role: "builder", status: "completed", tokensIn: 10, tokensOut: 5, costUsd: 0.25 })}\n`,
      );
      await appendScorecardEvent(
        home.root,
        { type: "review_cycles", app: "alpha", role: "builder", turnId: "turn-1", ticketRef: "#1", value: 1 },
        new Date("2026-07-04T12:10:00Z"),
      );

      const result = await runRetro({
        orgHome: home.root,
        date: "2026-07-04",
        apps: ["alpha"],
        roles: ["builder"],
      });

      expect(result.path).toBe(join(home.root, "retro", "2026-07-04.md"));
      expect(result.content).toContain("## alpha / builder");
      expect(result.content).toContain("Turns: 1");
      expect(result.content).toContain("Cost: $0.25");
      expect(result.content).toContain("- review_cycles: 1");
      expect(readFileSync(result.path, "utf8")).toBe(result.content);
    } finally {
      home.cleanup();
    }
  });

  it("CLI prints the written path", async () => {
    const home = makeOrgHome();
    const orgHome = join(home.root, "org");
    await initOrgHome({ target: orgHome, name: "retro-test", stateHome: home.root, homeDir: home.root });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await cmdRetro([
        "--date",
        "2026-07-04",
        "--org-home",
        orgHome,
        "--state-home",
        home.root,
      ]);
      expect(code).toBe(0);
      expect(log.mock.calls[0]?.[0]).toBe(join(orgHome, "retro", "2026-07-04.md"));
    } finally {
      log.mockRestore();
      home.cleanup();
    }
  });
});
