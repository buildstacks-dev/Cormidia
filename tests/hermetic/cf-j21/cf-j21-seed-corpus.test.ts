// CF-J21-S (L2) — the provision phase's seed corpora.
//
// Two properties decide whether this scenario is re-runnable at all:
// determinism (same manifest, same bytes) and key separation (the `sealed`
// block names the plants and must never be written into a repository a grader
// can read). Both are asserted against the COMMITTED manifests, not fixtures —
// a manifest that drifted would silently make run 2 incomparable to run 1.

import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  materializeSeedCorpus,
  readSeedManifest,
  renderSeedItem,
  sealedSeedMaterial,
  SeedCorpusError,
} from "../../campaign/acceptance/seed-corpus.js";
import { makeTempGitRepo } from "../../fixtures/git-repo.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const seedsDir = join(repoRoot, "acceptance", "seeds");
const cleanups: Array<() => Promise<void>> = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("CF-J21-S the committed seed manifests", () => {
  it("walks a non-empty seeds directory", async () => {
    const files = await assertNonEmptyWalk(seedsDir, /\.json$/);
    expect(files.sort()).toEqual(["s-acc-2-tutorials.json", "s-acc-3-notes.json"]);
  });

  it("S-ACC-2 seeds exactly the ten tutorials its table specifies", async () => {
    const manifest = await readSeedManifest(join(seedsDir, "s-acc-2-tutorials.json"));
    expect(manifest.root).toBe("tutorials");
    expect(manifest.items).toHaveLength(10);
    expect(manifest.items.map((item) => item.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Every item carries a declared staleness, including the control.
    expect(manifest.items.every((item) => typeof item.staleness === "string")).toBe(true);
    expect(manifest.items[0]?.staleness).toBe("none");
    expect(manifest.support_files?.map((file) => file.path).sort()).toEqual([
      "package.json",
      "scripts/validate-corpus.mjs",
    ]);
  });

  it("S-ACC-2's overlap plant is real material, discoverable only by reading", async () => {
    const manifest = await readSeedManifest(join(seedsDir, "s-acc-2-tutorials.json"));
    const seven = manifest.items.find((item) => item.n === 7);
    const eight = manifest.items.find((item) => item.n === 8);
    const sevenText = renderSeedItem(seven!).toLowerCase();
    const eightText = renderSeedItem(eight!).toLowerCase();
    // They genuinely overlap: both teach workspace globs and sibling linking.
    for (const shared of ['"workspaces": ["packages/*"]', "resolver", "registry"]) {
      expect(sevenText).toContain(shared);
      expect(eightText).toContain(shared);
    }
    // And neither announces the overlap — that claim lives in the sealed key.
    expect(sevenText).not.toContain("overlap");
    expect(eightText).not.toContain("overlap");
  });

  it("S-ACC-3 plants a single-source tool, a conflicting pair, and a no-weakness tool — all distinct", async () => {
    const manifest = await readSeedManifest(join(seedsDir, "s-acc-3-notes.json"));
    const sealed = sealedSeedMaterial(manifest) as {
      single_source_tool: { name: string; appears_in: string[] };
      conflicting_tool: { name: string; claims: Record<string, string> };
      no_weakness_tool: { name: string; appears_in: string[] };
    };
    const names = [sealed.single_source_tool.name, sealed.conflicting_tool.name, sealed.no_weakness_tool.name];
    expect(new Set(names).size).toBe(3);

    const bodies = Object.fromEntries(manifest.items.map((item) => [item.slug, renderSeedItem(item)]));
    // The single-source tool really does appear in exactly one note.
    const mentions = Object.entries(bodies).filter(([, text]) => text.includes(sealed.single_source_tool.name));
    expect(mentions.map(([slug]) => slug)).toEqual(sealed.single_source_tool.appears_in);
    // The conflicting pair really does disagree on category.
    const claims = Object.entries(sealed.conflicting_tool.claims);
    expect(claims).toHaveLength(2);
    for (const [slug, claim] of claims) expect(bodies[slug]?.toLowerCase()).toContain(claim.toLowerCase());
    expect(new Set(claims.map(([, claim]) => claim)).size).toBe(2);
    // The no-weakness tool really has no stated weakness anywhere.
    for (const slug of sealed.no_weakness_tool.appears_in) {
      const section = bodies[slug]?.split(`## ${sealed.no_weakness_tool.name}`)[1] ?? "";
      expect(section.toLowerCase()).not.toContain("weakness:");
    }
  });
});

describe("CF-J21-S materialization is deterministic and key-separated", () => {
  it("writes the same bytes for the same manifest, every time", async () => {
    const manifest = await readSeedManifest(join(seedsDir, "s-acc-2-tutorials.json"));
    const first = await makeTempGitRepo({ seedFiles: [] });
    const second = await makeTempGitRepo({ seedFiles: [] });
    cleanups.push(first.cleanup, second.cleanup);

    const a = await materializeSeedCorpus(manifest, first.dir);
    const b = await materializeSeedCorpus(manifest, second.dir);
    expect(a.paths).toEqual(b.paths);
    for (const path of a.paths) {
      expect(await readFile(join(first.dir, path), "utf8")).toBe(await readFile(join(second.dir, path), "utf8"));
    }
  });

  it("S-ACC-2's baseline declares and passes an honest corpus-integrity test", async () => {
    const manifest = await readSeedManifest(join(seedsDir, "s-acc-2-tutorials.json"));
    const repo = await makeTempGitRepo({ seedFiles: [] });
    cleanups.push(repo.cleanup);
    const materialized = await materializeSeedCorpus(manifest, repo.dir);

    expect(materialized.paths).toContain("package.json");
    const result = await execFileAsync(process.execPath, ["scripts/validate-corpus.mjs"], { cwd: repo.dir });
    expect(result.stdout).toContain("validated 10 seeded tutorials");
  });

  it("negative control: the sealed block is NEVER written into the scenario repository", async () => {
    const manifest = await readSeedManifest(join(seedsDir, "s-acc-3-notes.json"));
    const repo = await makeTempGitRepo({ seedFiles: [] });
    cleanups.push(repo.cleanup);
    const materialized = await materializeSeedCorpus(manifest, repo.dir);

    const sealed = sealedSeedMaterial(manifest) as { single_source_tool: { why: string } };
    const written = await Promise.all(materialized.paths.map((path) => readFile(join(repo.dir, path), "utf8")));
    const wholeTree = written.join("\n");
    // The plant NAMES legitimately appear — they are the material. The sealed
    // block's REASONING must not, because that is the answer.
    expect(wholeTree).not.toContain(sealed.single_source_tool.why);
    expect(wholeTree).not.toContain("single_source_tool");
    expect(wholeTree).not.toContain("did not read all three inputs");

    const entries = await readdir(repo.dir);
    expect(entries).not.toContain("s-acc-3-notes.json");
  });

  it("returns the exact paths it wrote, so provisioning commits only the seed", async () => {
    const manifest = await readSeedManifest(join(seedsDir, "s-acc-3-notes.json"));
    const repo = await makeTempGitRepo({ seedFiles: [] });
    cleanups.push(repo.cleanup);
    const materialized = await materializeSeedCorpus(manifest, repo.dir);
    expect(materialized.paths).toEqual(["inputs/notes-a.md", "inputs/notes-b.md", "inputs/notes-c.md"]);
  });

  it("negative control: an empty or malformed manifest is refused, never seeded as nothing", async () => {
    const repo = await makeTempGitRepo({ seedFiles: [] });
    cleanups.push(repo.cleanup);
    const bad = join(repo.dir, "bad.json");
    await writeFile(bad, JSON.stringify({ schema_version: 1, corpus: "x", root: "y", items: [] }), "utf8");
    await expect(readSeedManifest(bad)).rejects.toThrow(/empty-corpus/);

    await writeFile(bad, "{ not json", "utf8");
    await expect(readSeedManifest(bad)).rejects.toThrow(/manifest-malformed/);

    await expect(readSeedManifest(join(repo.dir, "absent.json"))).rejects.toBeInstanceOf(SeedCorpusError);
  });

  it("negative control: support files cannot escape or collide inside the scenario repository", async () => {
    const repo = await makeTempGitRepo({ seedFiles: [] });
    cleanups.push(repo.cleanup);
    const bad = join(repo.dir, "bad.json");
    const base = {
      schema_version: 1,
      corpus: "x",
      root: "items",
      items: [{ slug: "one", title: "One", body: ["body"] }],
    };

    await writeFile(bad, JSON.stringify({ ...base, support_files: [{ path: "../outside", body: ["no"] }] }), "utf8");
    await expect(readSeedManifest(bad)).rejects.toThrow(/unsafe repo-relative path/);

    await writeFile(
      bad,
      JSON.stringify({ ...base, support_files: [{ path: "items/one.md", body: ["collision"] }] }),
      "utf8",
    );
    const manifest = await readSeedManifest(bad);
    await expect(materializeSeedCorpus(manifest, repo.dir)).rejects.toThrow(/duplicate output path/);
  });
});
