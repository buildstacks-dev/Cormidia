// Tests context assembly across org, role, app, memory, and loop brief layers.
// Covers taste ordering, omitted role addenda, capped memory excerpts, and
// rendering selected memory into the brief.
// makeOrgHome and makeAppRepo are disposable local fixtures; no network, auth,
// real org state, or wall-clock time is required.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
      // Learning-loop M1 (design §7.1): the protocol requests candidate
      // learning notes, and must no longer request active memory writes —
      // this assertion pair pins the migration off agent-direct OKF writes.
      expect(context.bundle.taste[3]).toContain("End-of-turn learning note instruction");
      expect(context.bundle.taste[3]).toContain("learning/candidates/<role>/");
      expect(context.bundle.taste[3]).not.toContain("memory write");
      expect(context.bundle.taste[3]).not.toContain("memory/roles/<role>/");
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

  it("resolves governed concepts ahead of legacy memory when learning is wired (M4)", async () => {
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
    const state = makeOrgHome();
    const app = makeAppRepo();
    const conceptDir = join(org.root, "learning", "bundle", "roles", "reviewer");
    mkdirSync(conceptDir, { recursive: true });
    writeFileSync(
      join(conceptDir, "governed.md"),
      [
        "---",
        "name: governed",
        "description: governed reviewer concept",
        "type: procedure",
        "keywords: [security]",
        "evidence: []",
        "status: active",
        "created: 2026-07-01",
        "updated: 2026-07-01",
        "loop:",
        "  id: lrn_ctx01",
        "  tier: T1",
        "  status: active",
        "  scope: roles/reviewer",
        "  version: 1",
        "  claim: authorized",
        "---",
        "Inspect built browser entrypoints.",
        "",
      ].join("\n"),
      "utf8",
    );
    try {
      const context = await assembleContext({
        orgHome: org.root,
        appWorkdir: app.root,
        app: "alpha",
        role: REVIEWER,
        taskText: "security review",
        learning: { stateHome: state.root, turnId: "turn-ctx", episodeId: "ep_alpha_ticket_0001" },
      });
      const governed = context.bundle.memoryExcerpts.findIndex((entry) =>
        entry.includes("Learning concept governed"),
      );
      const legacy = context.bundle.memoryExcerpts.findIndex((entry) =>
        entry.includes("Memory INDEX"),
      );
      expect(governed).toBeGreaterThanOrEqual(0);
      expect(legacy).toBeGreaterThan(governed); // legacy resolves last (lowest precedence)
      expect(context.resolvedLearning?.concept_ids).toEqual(["lrn_ctx01"]);
      expect(
        existsSync(join(state.root, "learning", "resolved", "turn-ctx.json")),
      ).toBe(true);

      // An explicit caller cap bounds the COMBINED memory section — governed
      // concepts spend from it first, legacy memory gets the remainder.
      const capped = await assembleContext({
        orgHome: org.root,
        appWorkdir: app.root,
        app: "alpha",
        role: REVIEWER,
        taskText: "security review",
        memoryCapBytes: 64,
        learning: { stateHome: state.root, turnId: "turn-cap", episodeId: "ep_alpha_ticket_0002" },
      });
      expect(
        Buffer.byteLength(capped.bundle.memoryExcerpts.join(""), "utf8"),
      ).toBeLessThanOrEqual(64);

      // Without the learning option, assembly is unchanged legacy behavior.
      const plain = await assembleContext({
        orgHome: org.root,
        appWorkdir: app.root,
        app: "alpha",
        role: REVIEWER,
        taskText: "security review",
      });
      expect(plain.resolvedLearning).toBeUndefined();
      expect(plain.bundle.memoryExcerpts.join("\n")).not.toContain("Learning concept governed");
    } finally {
      org.cleanup();
      state.cleanup();
      app.cleanup();
    }
  });
});
