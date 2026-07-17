// Writer→loader round-trip for durable denial lessons (review L-009,
// sonnet-org ISSUES.md #10). The original writer emitted denial-lessons.md
// without YAML frontmatter, so the orchestrator's OWN memory loader rejected
// it as "malformed" on every turn — recorded lessons were never re-injected.
// The absence of exactly this round-trip test is why that shipped. The real
// writer and the real loader are exercised together here; no mocks.

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendDenialLesson, denialLessonsPath } from "../src/org/denial-lessons.js";
import { loadBundle, selectAttributedExcerpts } from "../src/org/memory.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeOrgHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "operon-denial-lessons-"));
  tempDirs.push(dir);
  return dir;
}

const LESSON = {
  app: "alpha",
  rule: "outbound-network",
  reason: "no raw egress from build turns",
  at: "2026-07-17T00:00:00.000Z",
};

describe("denial lessons writer→loader round trip (L-009)", () => {
  it("a written lesson passes the OKF loader and is selected for matching work", async () => {
    const orgHome = makeOrgHome();
    expect(appendDenialLesson(orgHome, "reviewer", LESSON)).toBe(true);

    const dir = join(orgHome, "memory", "roles", "reviewer");
    const bundle = await loadBundle(dir);
    // The exact defect: the writer's own file used to land in `errors` with
    // "missing YAML frontmatter delimited by ---" and never in `docs`.
    expect(bundle.errors).toEqual([]);
    expect(bundle.docs).toHaveLength(1);
    const doc = bundle.docs[0]!;
    expect(doc.frontmatter.name).toBe("denial-lessons");
    expect(doc.frontmatter.type).toBe("lesson");
    expect(doc.frontmatter.status).toBe("active");
    expect(doc.frontmatter.keywords).toContain("alpha");
    expect(doc.frontmatter.keywords).toContain("outbound-network");
    expect(doc.body).toContain("alpha [outbound-network] no raw egress from build turns");

    // Selection re-injects the lesson (keyword overlap on app/rule) and emits
    // no "skipping malformed memory doc" warning.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const excerpts = await selectAttributedExcerpts([dir], "build a ticket for app alpha");
    const warned = stderr.mock.calls.map((call) => String(call[0])).join("");
    expect(warned).not.toContain("malformed");
    expect(
      excerpts.some((excerpt) => excerpt.rendered.includes("no raw egress from build turns")),
    ).toBe(true);
  });

  it("deduplicates repeated lessons and keeps the doc loader-valid across appends", async () => {
    const orgHome = makeOrgHome();
    expect(appendDenialLesson(orgHome, "builder", LESSON)).toBe(true);
    expect(appendDenialLesson(orgHome, "builder", LESSON)).toBe(false);
    expect(
      appendDenialLesson(orgHome, "builder", {
        app: "beta",
        rule: "protocol-self-edit",
        reason: "propose, never rewrite",
        at: "2026-07-17T01:00:00.000Z",
      }),
    ).toBe(true);

    const raw = readFileSync(denialLessonsPath(orgHome, "builder"), "utf8");
    expect(raw.match(/\[outbound-network\]/g)).toHaveLength(1);

    const bundle = await loadBundle(join(orgHome, "memory", "roles", "builder"));
    expect(bundle.errors).toEqual([]);
    expect(bundle.docs).toHaveLength(1);
    const doc = bundle.docs[0]!;
    expect(doc.body).toContain("alpha [outbound-network]");
    expect(doc.body).toContain("beta [protocol-self-edit]");
    expect(doc.frontmatter.keywords).toEqual(
      expect.arrayContaining(["alpha", "outbound-network", "beta", "protocol-self-edit"]),
    );
  });

  it("migrates a legacy frontmatter-less file on the next denial without losing lessons", async () => {
    const orgHome = makeOrgHome();
    const path = denialLessonsPath(orgHome, "reviewer");
    mkdirSync(dirname(path), { recursive: true });
    // The exact pre-fix format the live org accumulated.
    writeFileSync(
      path,
      "# Denial lessons (orchestrator-curated)\n\n- 2026-07-15T00:00:00.000Z gamma [secrets-or-auth] never echo credentials\n",
      "utf8",
    );

    // Before migration, the loader rejects it — this pins the original defect.
    const before = await loadBundle(join(orgHome, "memory", "roles", "reviewer"));
    expect(before.docs).toHaveLength(0);
    expect(before.errors).toHaveLength(1);
    expect(before.errors[0]!.message).toContain("missing YAML frontmatter");

    expect(appendDenialLesson(orgHome, "reviewer", LESSON)).toBe(true);
    const after = await loadBundle(join(orgHome, "memory", "roles", "reviewer"));
    expect(after.errors).toEqual([]);
    expect(after.docs).toHaveLength(1);
    // The legacy lesson survived the migration alongside the new one.
    expect(after.docs[0]!.body).toContain("gamma [secrets-or-auth] never echo credentials");
    expect(after.docs[0]!.body).toContain("alpha [outbound-network]");
  });
});
