// Tests OKF memory parsing, selection, and writing in src/org/memory.ts.
// Covers frontmatter validation, keyword excerpt selection, malformed-doc
// tolerance, byte caps, INDEX updates, overwrite, deprecation behavior, and
// the learning-loop `loop` block: validation, byte-for-byte round-trip
// preservation (unknown loop fields included), and status consistency.
// makeOrgHome supplies disposable memory directories; no network, auth, real
// org state, or live wall clock is required.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deprecateMemoryDoc,
  loadBundle,
  OkfParseError,
  OkfValidationError,
  parseOkfDocument,
  selectExcerpts,
  serializeOkfDocument,
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

  it("skips a malformed doc instead of crashing context assembly", async () => {
    // Reproduces a live wedge: a builder wrote an OKF doc with the O/K/F
    // headings but no YAML frontmatter, and every turn that assembled context
    // threw at loadBundle. A malformed agent-authored doc must be skipped.
    const home = makeOrgHome({
      memory: {
        roles: {
          builder: {
            docs: [
              { name: "good-lesson", content: okf("good-lesson", ["fixtures"], "Use fixture factories.\n") },
              {
                name: "money-report-rounding.okf",
                content: "# Money Report Rounding\n\n## Observation\nNo frontmatter here.\n",
              },
            ],
          },
        },
      },
    });
    try {
      const dir = home.paths.memoryRoleDir("builder");
      const bundle = await loadBundle(dir);
      expect(bundle.docs.map((doc) => doc.frontmatter.name)).toEqual(["good-lesson"]);
      expect(bundle.errors).toHaveLength(1);
      expect(bundle.errors[0]?.message).toContain("missing YAML frontmatter");

      const excerpts = await selectExcerpts([dir], "add tests with fixtures", 16_000);
      expect(excerpts.join("\n")).toContain("Use fixture factories.");
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

/** A concept file shaped like docs/learning-loop/ spec §3, including an
 *  unknown loop field and nested blocks the validator must carry through. */
function loopDoc(loopLines: string[], status = "active"): string {
  return [
    "---",
    "name: support-missing-payload-intake",
    "description: Support should not invent replies when payloads are missing.",
    "type: procedure",
    "keywords: [support, feedback]",
    'evidence: ["research/2026-07-07_assessment.md#support"]',
    `status: ${status}`,
    "created: 2026-07-07",
    "updated: 2026-07-07",
    "loop:",
    ...loopLines.map((line) => `  ${line}`),
    "---",
    "Produce an internal digest; never fabricate a user reply.\n",
  ].join("\n");
}

const FULL_LOOP = [
  "id: lrn_20260707_01JABC",
  "tier: T1",
  "status: active",
  "scope: apps/operon-marketplace-demo/roles/support",
  "topic_key: support.missing_payload",
  "version: 1",
  "supersedes: null",
  "ttl_days: 180",
  "eval_ref: null",
  "claim: authorized",
  "experiment_ref: null",
  "future_field: keep-me",
  "provenance:",
  "  source_channel: internal",
  "  trust: trusted",
  "  episode_ids: [ep_operon-marketplace-demo_feedback_0142]",
  "review:",
  "  verdict_ref: reviews/lrn_20260707_01JABC.json",
  "  approved_by: [human-operator]",
];

describe("OKF loop block (learning-loop spec §3)", () => {
  it("parses, validates, and preserves the loop block through a byte-identical round-trip", () => {
    const first = parseOkfDocument(loopDoc(FULL_LOOP));
    expect(first.frontmatter.loop).toMatchObject({
      id: "lrn_20260707_01JABC",
      tier: "T1",
      status: "active",
      scope: "apps/operon-marketplace-demo/roles/support",
      version: 1,
      claim: "authorized",
    });

    const serialized = serializeOkfDocument(first);
    const second = parseOkfDocument(serialized);
    // Structural preservation — including fields the validator doesn't know
    // (future_field) and nested provenance/review blocks.
    expect(second.frontmatter.loop).toEqual(first.frontmatter.loop);
    expect(second.frontmatter.loop?.["future_field"]).toBe("keep-me");
    expect(second.frontmatter.loop?.["supersedes"]).toBeNull();
    // Byte-for-byte: re-serializing the round-tripped document reproduces
    // the identical bytes (M1 done-criterion 4).
    expect(serializeOkfDocument(second)).toBe(serialized);
  });

  it("writeMemoryDoc rewrites preserve the loop block on disk", async () => {
    // The defect this extension fixes: the old validator reconstructed only
    // the eight known fields, so any rewrite silently stripped `loop`.
    const home = makeOrgHome({ memory: { roles: { support: {} } } });
    try {
      const doc = parseOkfDocument(loopDoc(FULL_LOOP));
      const path = await writeMemoryDoc(home.paths.memoryRoleDir("support"), doc, { now: DATE });
      const reread = parseOkfDocument(await readFile(path, "utf8"), path);
      expect(reread.frontmatter.loop).toEqual(doc.frontmatter.loop);
    } finally {
      home.cleanup();
    }
  });

  it("legacy docs without a loop block stay valid and gain none", () => {
    const doc = parseOkfDocument(okf("legacy-lesson", ["tests"], "Old but fine.\n"));
    expect(doc.frontmatter.loop).toBeUndefined();
    expect(serializeOkfDocument(doc)).not.toContain("loop:");
  });

  it("rejects invalid loop blocks with named errors", () => {
    const swap = (from: string, to: string): string[] =>
      FULL_LOOP.map((line) => (line === from ? to : line));
    const cases: Array<[string[], RegExp]> = [
      [swap("tier: T1", "tier: T9"), /loop\.tier/],
      [swap("status: active", "status: pending"), /loop\.status/],
      [swap("claim: authorized", "claim: proven"), /loop\.claim/],
      [swap("version: 1", "version: 0"), /loop\.version/],
      [swap("ttl_days: 180", "ttl_days: -3"), /loop\.ttl_days/],
      [swap("id: lrn_20260707_01JABC", 'id: ""'), /loop\.id/],
      [
        swap(
          "scope: apps/operon-marketplace-demo/roles/support",
          "scope: teams/support",
        ),
        /loop\.scope must be/,
      ],
    ];
    for (const [lines, message] of cases) {
      expect(() => parseOkfDocument(loopDoc(lines))).toThrow(message);
    }
  });

  it("rejects reserved identities/accounts scopes explicitly (spec §2)", () => {
    const lines = FULL_LOOP.map((line) =>
      line.startsWith("scope:") ? "scope: identities/support-us-anna" : line,
    );
    expect(() => parseOkfDocument(loopDoc(lines))).toThrow(/reserved for a future version/);
  });

  it("rejects a top-level status that disagrees with loop.status", () => {
    // A half-updated rewrite (deprecating the doc without moving loop.status)
    // must fail loudly instead of corrupting governance state.
    expect(() => parseOkfDocument(loopDoc(FULL_LOOP, "deprecated"))).toThrow(OkfValidationError);
    const archived = FULL_LOOP.map((line) =>
      line === "status: active" ? "status: archived" : line,
    );
    expect(() => parseOkfDocument(loopDoc(archived))).toThrow(/disagrees with loop\.status/);
    expect(parseOkfDocument(loopDoc(archived, "deprecated")).frontmatter.loop?.status).toBe(
      "archived",
    );
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
