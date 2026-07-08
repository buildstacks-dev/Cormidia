// Tests context assembly across org, role, app, memory, and loop brief layers.
// Covers taste ordering, omitted role addenda, capped memory excerpts, and
// rendering selected memory into the brief.
// makeOrgHome and makeAppRepo are disposable local fixtures; no network, auth,
// real org state, or wall-clock time is required.

import { describe, expect, it } from "vitest";
import { assembleContext } from "../src/org/context.js";
import { assembleBrief } from "../src/loop/brief.js";
import type { RoleConfig } from "../src/runtime/types.js";
import { makeAppRepo, makeOrgHome } from "./fixtures/orgHome.js";

const REVIEWER: RoleConfig = {
  name: "reviewer",
  runtime: "claude",
  model: "m",
  effort: "high",
  delegation: { allow: [] },
  triggers: [],
  outputs: ["review"],
  maxTurnBudgetUsd: 5,
};

function okf(name: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${name} description`,
    "type: lesson",
    "keywords: [security]",
    'evidence: ["PR #1"]',
    "status: active",
    "created: 2026-07-01",
    "updated: 2026-07-01",
    "---",
    "Check auth boundaries.",
  ].join("\n");
}

describe("assembleContext", () => {
  it("produces four taste entries in order when all layers exist", async () => {
    const org = makeOrgHome({
      taste: { org: "# Org\n", roles: { reviewer: "# Reviewer\n" } },
      memory: { roles: { reviewer: { index: "- security: auth checks\n" } } },
    });
    const app = makeAppRepo({ taste: "# App\n" });
    try {
      const context = await assembleContext({
        orgHome: org.root,
        appWorkdir: app.root,
        app: "alpha",
        role: REVIEWER,
        taskText: "security review",
      });
      expect(context.bundle.taste).toHaveLength(4);
      expect(context.bundle.taste[0]).toContain("## Org TASTE.md");
      expect(context.bundle.taste[1]).toContain("## Role taste/reviewer.md");
      expect(context.bundle.taste[2]).toContain("## App .operon/TASTE.md");
      expect(context.bundle.taste[3]).toContain("## Role turn protocol");
      expect(context.bundle.taste[3]).toContain("Expected outputs from roles.yaml");
      expect(context.bundle.taste[3]).toContain("- review");
      expect(context.bundle.taste[3]).toContain("GitHub conventions marker");
      expect(context.bundle.taste[3]).toContain("End-of-turn memory write instruction");
    } finally {
      org.cleanup();
      app.cleanup();
    }
  });

  it("omits role addendum cleanly when absent and caps excerpts", async () => {
    const org = makeOrgHome({
      taste: { org: "# Org\n" },
      memory: {
        roles: {
          reviewer: {
            index: "- security: auth checks\n",
            docs: [{ name: "security", content: okf("security") }],
          },
        },
      },
    });
    const app = makeAppRepo({ taste: "# App\n" });
    try {
      const context = await assembleContext({
        orgHome: org.root,
        appWorkdir: app.root,
        app: "alpha",
        role: REVIEWER,
        taskText: "security",
        memoryCapBytes: 24,
      });
      expect(context.bundle.taste).toHaveLength(3);
      expect(context.bundle.taste.join("\n")).not.toContain("Role taste/reviewer.md");
      expect(Buffer.byteLength(context.bundle.memoryExcerpts.join(""), "utf8")).toBeLessThanOrEqual(24);
    } finally {
      org.cleanup();
      app.cleanup();
    }
  });

  it("renders loop brief [memory] from selected excerpts", async () => {
    const brief = assembleBrief(
      {
        ticket: { title: "#1 Fix auth", body: "security regression" },
        memory: ["## Memory security\nCheck auth boundaries."],
      },
      { budgetTokens: 2000 },
    );
    expect(brief).toContain("[memory]\n## Memory security");
  });
});
