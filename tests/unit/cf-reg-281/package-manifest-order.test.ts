// CF-REG-281 — the release tarball reader and validator must share one
// locale-independent path order. The seeded legacy order proves the detector fires.

import { gzipSync } from "node:zlib";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createReleaseManifest,
  packageManifestFromTarball,
  type ReleaseManifestBodyV1,
} from "../../../src/org/release-evidence.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("CF-REG-281 release package manifest ordering", () => {
  it("accepts an npm-like tarball with uppercase and lowercase package paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "cormidia-cf-reg-281-"));
    roots.push(root);
    const tarball = join(root, "cormidia-0.1.1.tgz");
    await writeFile(tarball, tarGzip([
      { path: "agent-skills/cormidia/SKILL.md", contents: "skill\n" },
      { path: "README.md", contents: "readme\n" },
      { path: "TASTE.md", contents: "taste\n" },
      { path: "package.json", contents: '{"name":"cormidia","version":"0.1.1"}\n' },
    ]));

    const manifest = await packageManifestFromTarball(tarball);
    expect(manifest.files.map((file) => file.path)).toEqual([
      "README.md",
      "TASTE.md",
      "agent-skills/cormidia/SKILL.md",
      "package.json",
    ]);

    const seededLegacyOrder = structuredClone(manifest);
    const legacyOrder = new Map([
      ["agent-skills/cormidia/SKILL.md", 0],
      ["package.json", 1],
      ["README.md", 2],
      ["TASTE.md", 3],
    ]);
    seededLegacyOrder.files.sort((left, right) => legacyOrder.get(left.path)! - legacyOrder.get(right.path)!);
    expect(seededLegacyOrder.files.map((file) => file.path)).not.toEqual(manifest.files.map((file) => file.path));
    expect(() => createReleaseManifest(bodyWithPackage(seededLegacyOrder))).toThrow(
      /package files must be unique and sorted/,
    );
  });
});

function tarGzip(entries: Array<{ path: string; contents: string }>): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const contents = Buffer.from(entry.contents, "utf8");
    const header = Buffer.alloc(512);
    header.write(`package/${entry.path}`, 0, 100, "utf8");
    header.write(`${contents.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    header[156] = "0".charCodeAt(0);
    blocks.push(header, contents, Buffer.alloc((512 - contents.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function bodyWithPackage(packageManifest: ReleaseManifestBodyV1["package"]): ReleaseManifestBodyV1 {
  return {
    schema_version: 1,
    contract_id: "RQ-1",
    prepared_at: "2026-08-05T12:00:00.000Z",
    repository: "cormidia/Cormidia",
    candidate_commit: "a".repeat(40),
    clean_tracked_tree: true,
    package: packageManifest,
    inputs: {
      policy: "1".repeat(64),
      dependency_lock: "2".repeat(64),
      prompts: "3".repeat(64),
      roles: "4".repeat(64),
      pipelines: "5".repeat(64),
      taste: "6".repeat(64),
      golden_sets: "7".repeat(64),
      assignments: "8".repeat(64),
      tools: "9".repeat(64),
    },
    assignments: [],
    toolchain: {
      node: "26.4.0",
      pnpm: "11.10.0",
      typescript: "5.9.3",
      vitest: "3.2.6",
      claude_agent_sdk: "0.3.201",
      pi_coding_agent: "0.80.7",
      openai_codex: "0.144.4",
      platform: "darwin",
      architecture: "arm64",
    },
    human_authorization: {
      authorized_by: "fixture-human",
      authorized_at: "2026-08-05T12:00:00.000Z",
      purpose: "fixture",
      approval_ref: "fixture",
    },
    deterministic: { required_checks: [], allowed_test_skips: [], producer_digest: "a".repeat(64) },
    l4: { mode: "bootstrap", sites: [], references: [], pairings: [] },
    triggered_campaigns: [],
    ceilings: {
      l3_premerge: { max_provider_turns: 2, max_equiv_usd: 5 },
      l3_release: { max_provider_turns: 24, max_equiv_usd: 100 },
      l4: { max_provider_turns: 1, max_equiv_usd: 1, max_tokens: 1, authorization_ref: "fixture" },
    },
    retry_policy: {
      merit_failures: "never",
      github_total_attempts: 3,
      ambiguous_writes: "single_shot_then_reconcile",
      provider_retry: "predeclared_typed_infrastructure_only",
      unknown_partial_usage: "debit_full_reservation",
    },
    obligations: [],
  };
}
