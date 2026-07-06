import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deprecateMemoryDoc,
  OkfParseError,
  parseOkfDocument,
  selectExcerpts,
  writeMemoryDoc,
} from "../src/org/memory.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

const DATE = new Date("2026-07-06T12:00:00Z");

function okf(name: string, keywords: string[], body: string, status = "active"): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${name} description`,
    "type: lesson",
    `keywords: [${keywords.join(", ")}]`,
    'evidence: ["PR #1"]',
    `status: ${status}`,
    "created: 2026-07-01",
    "updated: 2026-07-01",
    "---",
    body,
  ].join("\n");
}

describe("OKF memory reader", () => {
  it("parses full frontmatter and body", () => {
    const parsed = parseOkfDocument(okf("prefer-fixtures", ["tests", "fixtures"], "Use fixtures.\n"));
    expect(parsed.frontmatter).toMatchObject({
      name: "prefer-fixtures",
      type: "lesson",
      keywords: ["tests", "fixtures"],
      status: "active",
    });
    expect(parsed.body).toBe("Use fixtures.\n");
  });

  it("malformed document throws a named error", () => {
    expect(() => parseOkfDocument("no frontmatter")).toThrow(OkfParseError);
  });

  it("always includes INDEX and includes keyword-overlap docs only", async () => {
    const home = makeOrgHome({
      memory: {
        roles: {
          builder: {
            index: "- prefer-fixtures: prefer fixtures\n",
            docs: [
              { name: "prefer-fixtures", content: okf("prefer-fixtures", ["fixtures"], "Use fixture factories.\n") },
              { name: "avoid-bigbang", content: okf("avoid-bigbang", ["migration"], "Avoid large migrations.\n") },
            ],
          },
        },
      },
    });
    try {
      const excerpts = await selectExcerpts([home.paths.memoryRoleDir("builder")], "add tests with fixtures", 16_000);
      expect(excerpts.join("\n")).toContain("Memory INDEX");
      expect(excerpts.join("\n")).toContain("Use fixture factories.");
      expect(excerpts.join("\n")).not.toContain("Avoid large migrations.");
    } finally {
      home.cleanup();
    }
  });

  it("respects a tiny cap", async () => {
    const home = makeOrgHome({
      memory: { roles: { builder: { index: "INDEX-CONTENT-THAT-WILL-BE-TRUNCATED\n" } } },
    });
    try {
      const excerpts = await selectExcerpts([home.paths.memoryRoleDir("builder")], "anything", 12);
      expect(Buffer.byteLength(excerpts.join(""), "utf8")).toBeLessThanOrEqual(12);
    } finally {
      home.cleanup();
    }
  });
});

describe("OKF memory writer", () => {
  it("create appends to INDEX and same-name overwrite updates in place", async () => {
    const home = makeOrgHome({ memory: { roles: { builder: {} } } });
    try {
      const doc = parseOkfDocument(okf("prefer-fixtures", ["fixtures"], "Use factories.\n"));
      await writeMemoryDoc(home.paths.memoryRoleDir("builder"), doc, { now: DATE });
      await writeMemoryDoc(
        home.paths.memoryRoleDir("builder"),
        { ...doc, body: "Use composable fixture factories.\n" },
        { now: DATE },
      );

      const index = await readFile(home.paths.memoryIndex("builder"), "utf8");
      expect(index.trim().split("\n")).toEqual(["- prefer-fixtures: prefer-fixtures description"]);
      const raw = await readFile(home.paths.memoryDoc("builder", "prefer-fixtures"), "utf8");
      expect(raw).toContain("updated: 2026-07-06");
      expect(raw).toContain("Use composable fixture factories.");
    } finally {
      home.cleanup();
    }
  });

  it("deprecate drops from INDEX while preserving the file", async () => {
    const home = makeOrgHome({ memory: { roles: { builder: {} } } });
    try {
      await writeMemoryDoc(
        home.paths.memoryRoleDir("builder"),
        parseOkfDocument(okf("stale-lesson", ["tests"], "Old advice.\n")),
        { now: DATE },
      );
      await deprecateMemoryDoc(home.paths.memoryRoleDir("builder"), "stale-lesson", { now: DATE });
      expect(await readFile(home.paths.memoryIndex("builder"), "utf8")).toBe("");
      expect(await readFile(join(home.paths.memoryRoleDir("builder"), "stale-lesson.md"), "utf8")).toContain(
        "status: deprecated",
      );
    } finally {
      home.cleanup();
    }
  });
});
