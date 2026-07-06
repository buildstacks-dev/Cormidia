import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runRetro, runRetroCuration } from "../src/org/retro.js";
import { appendScorecardEvent } from "../src/org/scorecards.js";
import { cmdRetro } from "../src/cli/retro.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

function write(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function okf(name: string, description: string, evidence: string[] = ["PR #1"]): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "type: lesson",
    "keywords: [tests, fixtures]",
    `evidence: [${evidence.map((item) => JSON.stringify(item)).join(", ")}]`,
    "status: active",
    "created: 2026-07-01",
    "updated: 2026-07-01",
    "---",
    `${description}.`,
  ].join("\n");
}

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
    const configDir = join(home.root, "config");
    mkdirSync(configDir, { recursive: true });
    write(
      join(configDir, "apps.yaml"),
      `org: {name: operon, max_concurrent_turns: 2}
defaults: {budget_usd_month: 1000}
apps: {alpha: {repo: owner/alpha, status: live}}
`,
    );
    write(
      join(configDir, "roles.yaml"),
      `defaults: {max_turn_budget_usd: 5}
roles:
  builder: {runtime: claude, model: m, effort: medium, delegation: {allow: []}, triggers: [], outputs: []}
`,
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await cmdRetro([
        "--date",
        "2026-07-04",
        "--home",
        home.root,
        "--apps",
        join(configDir, "apps.yaml"),
        "--roles",
        join(configDir, "roles.yaml"),
      ]);
      expect(code).toBe(0);
      expect(log.mock.calls[0]?.[0]).toBe(join(home.root, "retro", "2026-07-04.md"));
    } finally {
      log.mockRestore();
      home.cleanup();
    }
  });
});

describe("runRetroCuration", () => {
  it("merges duplicate lessons, deletes contradicted lessons, drafts skills, and avoids protocol files", async () => {
    const home = makeOrgHome({
      memory: {
        roles: {
          builder: {
            docs: [
              { name: "fixtures-a", content: okf("fixtures-a", "Prefer fixture factories") },
              { name: "fixtures-b", content: okf("fixtures-b", "Prefer fixture factories") },
              { name: "wrong", content: okf("wrong", "Wrong advice", ["contradicted: incident #2"]) },
              { name: "fixtures-c", content: okf("fixtures-c", "Use fixture builders") },
            ],
          },
        },
      },
    });
    try {
      const result = await runRetroCuration({ orgHome: home.root, role: "builder", date: "2026-07-04" });
      expect(result.merged).toEqual(["fixtures-b -> fixtures-a"]);
      expect(result.deleted).toEqual(["wrong"]);
      expect(result.skillDrafts.some((path) => path.endsWith("skills/builder-tests/SKILL.md"))).toBe(true);
      expect(existsSync(join(home.paths.memoryRoleDir("builder"), "fixtures-b.md"))).toBe(false);
      expect(existsSync(join(home.paths.memoryRoleDir("builder"), "wrong.md"))).toBe(false);
      expect(result.proposalBody).toContain("No direct writes to TASTE.md or roles.yaml");
      expect(existsSync(join(home.root, "TASTE.md"))).toBe(false);
      expect(existsSync(join(home.root, "roles.yaml"))).toBe(false);
    } finally {
      home.cleanup();
    }
  });
});
