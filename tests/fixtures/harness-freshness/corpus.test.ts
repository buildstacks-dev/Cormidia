// Self-test for the recorded upstream corpus (tests/README.md → "fixtures kit
// … their self-tests are the API truth"; policy `harness_self_tests`).
//
// A fixture corpus is itself a thing that rots: a harness gains a source, a
// payload is renamed, a scenario stops overriding what its name claims. None of
// that would fail the probe suite — every scenario would still "pass" — so the
// corpus is asserted directly here, and every sweep starts from
// `assertNonEmptyWalk` so a moved directory fails red instead of green.

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHarnessMetadataEntry } from "../../../src/runtime/harness-metadata-parse.js";
import { RUNTIME_KINDS } from "../../../src/runtime/registry.js";
import { assertNonEmptyWalk } from "../walk.js";

const corpus = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(corpus, "..", "..", "..");

const SCENARIOS = [
  "base",
  "version-drift",
  "price-change",
  "new-model",
  "retired-model",
  "unreachable",
  "malformed",
  "stale-snapshot",
] as const;

async function readJson(path: string): Promise<Record<string, never>> {
  return JSON.parse(await readFile(path, "utf8"));
}

interface FixtureIndex {
  note?: string;
  extends?: string;
  responses?: Record<string, { bodyFile?: string; status?: number; reason?: string }>;
}

describe("CF-REG-332 fixtures — the recorded upstream corpus is self-tested", () => {
  it("the corpus walk is non-empty and every declared scenario is present", async () => {
    const files = await assertNonEmptyWalk(corpus, /index\.json$/);
    expect(files.sort()).toEqual(SCENARIOS.map((scenario) => `${scenario}/index.json`).sort());
  });

  it("every recorded response resolves to a real payload, or declares a failure status", async () => {
    let bodies = 0;
    for (const scenario of SCENARIOS) {
      const index = (await readJson(join(corpus, scenario, "index.json"))) as FixtureIndex;
      expect(typeof index.note, `${scenario} must say what it seeds`).toBe("string");
      for (const [url, recorded] of Object.entries(index.responses ?? {})) {
        expect(url, `${scenario}: ${url}`).toMatch(/^https:\/\//);
        if (recorded.bodyFile === undefined) {
          expect(recorded.status, `${scenario}: ${url} must declare a failing status`).toBeGreaterThanOrEqual(400);
          expect(typeof recorded.reason).toBe("string");
          continue;
        }
        const body = await readFile(join(corpus, scenario, recorded.bodyFile), "utf8");
        expect(body.length, `${scenario}: ${recorded.bodyFile} is empty`).toBeGreaterThan(0);
        if (recorded.bodyFile.endsWith(".json")) expect(() => JSON.parse(body)).not.toThrow();
        bodies += 1;
      }
    }
    expect(bodies, "the corpus recorded no payloads at all").toBeGreaterThan(15);
  });

  it("the baseline covers every upstream source the committed metadata declares", async () => {
    const metadata = (await readJson(join(repoRoot, "src", "runtime", "harness-metadata.json"))) as never;
    const index = (await readJson(join(corpus, "base", "index.json"))) as FixtureIndex;
    const recorded = new Set(Object.keys(index.responses ?? {}));
    const expected = new Set<string>();
    for (const entry of Object.values((metadata as { harnesses: Record<string, never> }).harnesses)) {
      const harness = entry as unknown as {
        upstream: { versionSources: { kind: string; package?: string; repo?: string }[] };
        pricing: { source: { url: string } } | null;
        roster: { source: { url: string } } | null;
      };
      for (const source of harness.upstream.versionSources) {
        if (source.kind === "npm")
          expected.add(`https://registry.npmjs.org/${source.package!.replace("/", "%2F")}/latest`);
        if (source.kind === "github_release") {
          expected.add(`https://api.github.com/repos/${source.repo}/releases/latest`);
        }
      }
      if (harness.pricing !== null) expected.add(harness.pricing.source.url);
      if (harness.roster !== null) expected.add(harness.roster.source.url);
    }
    // A new harness source with no recorded payload would otherwise surface as
    // a probe FAILURE in every scenario rather than as a missing fixture.
    expect([...recorded].sort()).toEqual([...expected].sort());
  });

  it("every scenario snapshot is schema-valid for all seven harnesses", async () => {
    for (const scenario of SCENARIOS) {
      const path = join(corpus, scenario, "metadata.json");
      const document = await readFile(path, "utf8").catch(() => undefined);
      if (document === undefined) continue;
      const parsed = JSON.parse(document);
      for (const kind of RUNTIME_KINDS) {
        expect(() => parseHarnessMetadataEntry(parsed, kind), `${scenario}/${kind}`).not.toThrow();
      }
      expect(Object.keys(parsed.harnesses).sort()).toEqual([...RUNTIME_KINDS].sort());
    }
  });

  it("the seeded stale snapshot really is stale — otherwise the negative control proves nothing", async () => {
    const stale = (await readJson(join(corpus, "stale-snapshot", "metadata.json"))) as never as {
      harnesses: Record<string, never>;
    };
    const base = (await readJson(join(corpus, "base", "metadata.json"))) as never as {
      harnesses: Record<string, never>;
    };
    expect(stale.harnesses).not.toEqual(base.harnesses);
  });

  it("overlay scenarios override only what their name claims", async () => {
    const overlays: Record<string, string[]> = {
      "version-drift": ["https://registry.npmjs.org/@openai%2Fcodex/latest"],
      "price-change": ["https://developers.openai.com/api/docs/pricing"],
      "new-model": ["https://research.meta.ai/blog/introducing-muse-code-and-muse-spark-1-2"],
      "retired-model": ["https://research.meta.ai/blog/introducing-muse-code-and-muse-spark-1-2"],
      "stale-snapshot": [],
    };
    for (const [scenario, urls] of Object.entries(overlays)) {
      const index = (await readJson(join(corpus, scenario, "index.json"))) as FixtureIndex;
      expect(index.extends, `${scenario} must extend the shared corpus`).toBe("../base");
      expect(Object.keys(index.responses ?? {}).sort()).toEqual([...urls].sort());
    }
  });
});
