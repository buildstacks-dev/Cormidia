import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeContextManifest } from "../src/loop/context-manifest.js";
import type { ContextBundle } from "../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

describe("context manifests", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("E-CTX-01 records every required attribution field for every component", async () => {
    home = makeOrgHome();
    await mkdir(join(home.root, "runs", "fixture", "run-a"), { recursive: true });
    const { manifest } = await writeContextManifest({
      root: home.root,
      episodeId: "episode:context",
      app: "fixture",
      runId: "run-a",
      context: bundle(),
      brief: "ticket and acceptance criteria",
      template: "perform the selected pass",
    });
    expect(manifest.schema_version).toBe(1);
    expect(manifest.components.map((component) => component.category).sort()).toEqual([
      "authority",
      "brief",
      "memory",
      "role_protocol",
      "taste",
      "template",
    ]);
    for (const component of manifest.components) {
      expect(component).toMatchObject({
        component_id: expect.stringMatching(/^[a-f0-9]{24}$/),
        source: expect.any(String),
        source_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        rendered_bytes: expect.any(Number),
        inclusion_reason: expect.any(String),
        prior_pass_change: "initial",
        cache_identity: expect.any(String),
        requirement: expect.stringMatching(/required|optional/),
        eviction: "kept",
      });
    }
  });

  it("E-CTX-02 keeps rendered identity byte-stable across run id, clock, filesystem order, and restart", async () => {
    home = makeOrgHome();
    await Promise.all([
      mkdir(join(home.root, "runs", "fixture", "run-z"), { recursive: true }),
      mkdir(join(home.root, "runs", "fixture", "run-a"), { recursive: true }),
    ]);
    const first = await writeContextManifest({
      root: home.root,
      episodeId: "episode:stable",
      app: "fixture",
      runId: "run-z",
      context: bundle(),
      brief: "same brief",
      template: "same template",
    });
    const second = await writeContextManifest({
      root: home.root,
      episodeId: "episode:stable",
      app: "fixture",
      runId: "run-a",
      context: bundle(),
      brief: "same brief",
      template: "same template",
    });
    expect(second.manifest.render_sha256).toBe(first.manifest.render_sha256);
    expect(second.manifest.rendered_bytes).toBe(first.manifest.rendered_bytes);
    const stripIdentity = (value: typeof first.manifest) => ({
      render_sha256: value.render_sha256,
      rendered_bytes: value.rendered_bytes,
      components: value.components.map(({ prior_pass_change: _change, ...component }) => component),
    });
    expect(stripIdentity(second.manifest)).toEqual(stripIdentity(first.manifest));
    expect(JSON.parse(await readFile(join(home.root, "runs", "fixture", "run-a", "context-manifest.json"), "utf8"))).toEqual(second.manifest);
  });
});

function bundle(): ContextBundle {
  return {
    authority: {
      profile: "operator",
      version: "1",
      sha256: "a".repeat(64),
      sources: ["authority.yaml"],
      text: "do only delegated work",
    },
    taste: ["quality constitution", "builder protocol"],
    memoryExcerpts: ["validated prior fact"],
    components: [
      {
        category: "authority",
        source: "authority.yaml",
        rendered: "do only delegated work",
        inclusionReason: "delegated authority is mandatory",
        requirement: "required",
      },
      {
        category: "taste",
        source: "TASTE.md",
        rendered: "quality constitution",
        inclusionReason: "org constitution",
        requirement: "required",
      },
      {
        category: "role_protocol",
        source: "roles.yaml#builder",
        rendered: "builder protocol",
        inclusionReason: "role protocol",
        requirement: "required",
      },
      {
        category: "memory",
        source: "memory/roles/builder/INDEX.md",
        rendered: "validated prior fact",
        inclusionReason: "task-relevant memory",
        requirement: "optional",
      },
    ],
  };
}
