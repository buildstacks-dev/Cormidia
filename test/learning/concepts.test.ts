// Governed concept storage (learning-loop M4): placement validation
// (directory ↔ loop.status, spec §3 table), manifests and version cuts
// (spec §8), disable, rollback, and quarantine authoring.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appLearningRoot,
  assertConceptPlacement,
  bundleScopeDir,
  cutManifestVersion,
  disableConcept,
  findBundleConcept,
  loadConceptDir,
  manifestPath,
  orgLearningRoot,
  readManifest,
  rollbackRoot,
  rootKindForScope,
  quarantineDir,
  writeProvisionalConcept,
} from "../../src/org/learning/concepts.js";
import { defaultLearningPolicy } from "../../src/org/learning/policy.js";
import { parseOkfDocument } from "../../src/org/memory.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";
import { conceptMarkdown } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function orgFixture(): OrgHomeFixture {
  const fixture = makeOrgHome();
  cleanups.push(fixture.cleanup);
  return fixture;
}

function seedConcept(dir: string, file: string, markdown: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(path, markdown, "utf8");
  return path;
}

describe("scope → root mapping", () => {
  it("routes org and role scopes to the org root, app scopes to the app root", () => {
    expect(rootKindForScope("org")).toBe("org");
    expect(rootKindForScope("roles/builder")).toBe("org");
    expect(rootKindForScope("apps/alpha")).toBe("app");
    expect(rootKindForScope("apps/alpha/roles/support")).toBe("app");
  });

  it("bundleScopeDir refuses a scope from the other root and invalid scopes", () => {
    const root = orgLearningRoot("/tmp/org");
    expect(() => bundleScopeDir(root, "apps/alpha")).toThrow(/app learning root/);
    expect(() => bundleScopeDir(root, "apps/../escape")).toThrow(/not a valid V1 scope/);
    expect(bundleScopeDir(root, "roles/builder")).toBe("/tmp/org/learning/bundle/roles/builder");
    expect(bundleScopeDir(appLearningRoot("/tmp/app"), "apps/alpha/roles/support")).toBe(
      "/tmp/app/.operon/learning/bundle/apps/alpha/roles/support",
    );
  });
});

describe("placement validation (spec §3 table)", () => {
  const doc = (status: "candidate" | "provisional" | "active", extra: object = {}) =>
    parseOkfDocument(
      conceptMarkdown({
        name: "n",
        id: "lrn_x",
        scope: "org",
        status,
        ...(status === "provisional" ? { ttlDays: 7, author: "human" } : {}),
        ...extra,
      }),
    );

  it("accepts status/directory agreement and rejects disagreement", () => {
    expect(() => assertConceptPlacement(doc("candidate"), "candidates")).not.toThrow();
    expect(() => assertConceptPlacement(doc("active"), "bundle")).not.toThrow();
    expect(() => assertConceptPlacement(doc("provisional"), "quarantine")).not.toThrow();
    expect(() => assertConceptPlacement(doc("candidate"), "bundle")).toThrow(/cannot live in bundle/);
    expect(() => assertConceptPlacement(doc("active"), "candidates")).toThrow(
      /cannot live in candidates/,
    );
  });

  it("quarantine requires a human author and a TTL", () => {
    const noAuthor = parseOkfDocument(
      conceptMarkdown({ name: "n", id: "lrn_x", scope: "org", status: "provisional", ttlDays: 7 }),
    );
    expect(() => assertConceptPlacement(noAuthor, "quarantine")).toThrow(/human author/);
    const noTtl = parseOkfDocument(
      conceptMarkdown({ name: "n", id: "lrn_x", scope: "org", status: "provisional", author: "h" }),
    );
    expect(() => assertConceptPlacement(noTtl, "quarantine")).toThrow(/ttl_days/);
  });

  it("a legacy doc without a loop block cannot live in governed dirs", () => {
    const legacy = parseOkfDocument(
      [
        "---",
        "name: legacy",
        "description: d",
        "type: fact",
        "keywords: [x]",
        "evidence: []",
        "status: active",
        "created: 2026-07-01",
        "updated: 2026-07-01",
        "---",
        "body",
        "",
      ].join("\n"),
    );
    expect(() => assertConceptPlacement(legacy, "bundle")).toThrow(/no loop block/);
  });

  it("loadConceptDir is loud on a malformed governed doc", async () => {
    const fixture = orgFixture();
    const root = orgLearningRoot(fixture.root);
    const dir = bundleScopeDir(root, "org");
    seedConcept(dir, "bad.md", "# not OKF at all\n");
    await expect(loadConceptDir(dir, "bundle")).rejects.toThrow(/bad\.md/);
  });
});

describe("manifest version cuts (spec §8)", () => {
  it("cuts YYYY.MM.DD-N versions, advances stable, and is idempotent by approval ref", async () => {
    const fixture = orgFixture();
    const root = orgLearningRoot(fixture.root);
    const now = new Date("2026-07-11T10:00:00Z");

    const first = await cutManifestVersion(root, { concepts: ["lrn_a"], now });
    expect(first.version).toBe("2026.07.11-1");
    const second = await cutManifestVersion(root, {
      approvalRef: "appr-1",
      concepts: ["lrn_b"],
      now,
    });
    expect(second.version).toBe("2026.07.11-2");

    // Crash-resume: the same approval never cuts twice (spec §14 step 4).
    const replay = await cutManifestVersion(root, {
      approvalRef: "appr-1",
      concepts: ["lrn_b"],
      now,
    });
    expect(replay.version).toBe("2026.07.11-2");

    const manifest = await readManifest(root);
    expect(manifest?.bundle_version).toBe("2026.07.11-2");
    expect(manifest?.stable).toBe("2026.07.11-2");
    expect(manifest?.history).toHaveLength(2);
    expect(existsSync(manifestPath(root))).toBe(true);
  });
});

describe("disable (milestone Done #1 mechanics)", () => {
  it("deprecates the concept in place and cuts a version; unknown ids return undefined", async () => {
    const fixture = orgFixture();
    const root = orgLearningRoot(fixture.root);
    const dir = bundleScopeDir(root, "roles/builder");
    seedConcept(
      dir,
      "bad-idea.md",
      conceptMarkdown({ name: "bad-idea", id: "lrn_bad", scope: "roles/builder", status: "active" }),
    );

    expect(await disableConcept(root, "lrn_missing")).toBeUndefined();
    const result = await disableConcept(root, "lrn_bad", { now: new Date("2026-07-11T10:00:00Z") });
    expect(result?.version).toBe("2026.07.11-1");

    const reparsed = parseOkfDocument(await readFile(result!.path, "utf8"));
    expect(reparsed.frontmatter.status).toBe("deprecated");
    expect(reparsed.frontmatter.loop?.status).toBe("deprecated");
    // Preserved loop fields survive the rewrite (round-trip guarantee).
    expect(reparsed.frontmatter.loop?.id).toBe("lrn_bad");

    await expect(disableConcept(root, "lrn_bad")).rejects.toThrow(/already "deprecated"/);
  });
});

describe("rollback (milestone M4: revert the latest version cut)", () => {
  it("deactivates the latest cut's concepts and records the rollback as a new cut", async () => {
    const fixture = orgFixture();
    const root = orgLearningRoot(fixture.root);
    const dir = bundleScopeDir(root, "org");
    seedConcept(
      dir,
      "keep.md",
      conceptMarkdown({ name: "keep", id: "lrn_keep", scope: "org", status: "active" }),
    );
    seedConcept(
      dir,
      "revert-me.md",
      conceptMarkdown({ name: "revert-me", id: "lrn_revert", scope: "org", status: "active" }),
    );
    const now = new Date("2026-07-11T10:00:00Z");
    await cutManifestVersion(root, { concepts: ["lrn_keep"], now });
    await cutManifestVersion(root, { concepts: ["lrn_revert"], now });

    const result = await rollbackRoot(root, { now });
    expect(result.revertedVersion).toBe("2026.07.11-2");
    expect(result.newVersion).toBe("2026.07.11-3");
    expect(result.deactivated).toEqual(["lrn_revert"]);

    const reverted = await findBundleConcept(root, "lrn_revert");
    expect(reverted?.doc.frontmatter.loop?.status).toBe("deprecated");
    const kept = await findBundleConcept(root, "lrn_keep");
    expect(kept?.doc.frontmatter.loop?.status).toBe("active");

    // History is append-only and a rollback never rolls back.
    await expect(rollbackRoot(root, { now })).rejects.toThrow(/already a rollback/);
    expect((await readManifest(root))?.history).toHaveLength(3);
  });

  it("refuses when there is nothing to roll back", async () => {
    const fixture = orgFixture();
    await expect(rollbackRoot(orgLearningRoot(fixture.root))).rejects.toThrow(/no version cuts/);
  });
});

describe("quarantine authoring (design §7 urgent human lane)", () => {
  it("writes a valid provisional and enforces the policy TTL cap", async () => {
    const fixture = orgFixture();
    const root = orgLearningRoot(fixture.root);
    const policy = defaultLearningPolicy();
    const doc = parseOkfDocument(
      conceptMarkdown({
        name: "urgent-fact",
        id: "lrn_urgent",
        scope: "roles/support",
        status: "provisional",
        ttlDays: 7,
        author: "human-operator",
      }),
    );
    const path = await writeProvisionalConcept(root, { doc, policy });
    expect(path).toBe(join(quarantineDir(root), "urgent-fact.md"));
    expect((await loadConceptDir(quarantineDir(root), "quarantine"))[0]?.doc.frontmatter.name).toBe(
      "urgent-fact",
    );

    const tooLong = parseOkfDocument(
      conceptMarkdown({
        name: "urgent-fact",
        id: "lrn_urgent",
        scope: "roles/support",
        status: "provisional",
        ttlDays: 45,
        author: "human-operator",
      }),
    );
    await expect(writeProvisionalConcept(root, { doc: tooLong, policy })).rejects.toThrow(
      /TTL must be 1\.\.14/,
    );
  });
});
