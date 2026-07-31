import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ContextBudgetExceededError,
  explainContext,
  writeContextManifest,
} from "../../src/loop/context-manifest.js";
import type { ContextBundle } from "../../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";

describe("Phase 3 context budget and deltas", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  async function write(runId: string, episodeId: string, context = bundle(), brief = structuredBrief(), capBytes?: number) {
    await mkdir(join(home.root, "runs", "app", runId), { recursive: true });
    return writeContextManifest({
      root: home.root,
      episodeId,
      app: "app",
      runId,
      context,
      brief,
      template: "versioned protocol",
      route: "standard",
      runtime: "codex",
      ...(capBytes !== undefined ? { capBytes } : {}),
    });
  }

  it("E-CTX-03 later passes reference unchanged optional components and delta only the changed source", async () => {
    home = makeOrgHome();
    const first = await write("run-a", "episode-delta");
    const second = await write("run-b", "episode-delta");
    const unchangedMemory = second.manifest.components.find((component) => component.source === "memory/fact.md")!;
    expect(unchangedMemory).toMatchObject({ prior_pass_change: "unchanged", transport: "reference" });
    expect(second.manifest.rendered_bytes).toBeLessThan(first.manifest.rendered_bytes);

    const changed = bundle();
    changed.components = changed.components!.map((component) =>
      component.source === "memory/fact.md" ? { ...component, rendered: "new validated fact" } : component,
    );
    changed.memoryExcerpts = [`new:${"y".repeat(500)}`, "quality constitution"];
    const third = await write("run-c", "episode-delta", changed);
    const changedComponents = third.manifest.components.filter((component) => component.prior_pass_change === "changed");
    expect(changedComponents.map((component) => component.source)).toEqual(["memory/fact.md"]);
    expect(changedComponents[0]?.transport).toBe("delta");
  });

  it("E-CTX-04 removes exact duplicate material before adapter submission", async () => {
    home = makeOrgHome();
    const result = await write("run-a", "episode-dedupe");
    const duplicate = result.manifest.components.find((component) => component.source === "memory/duplicate.md")!;
    expect(duplicate.eviction).toBe("evicted");
    expect(duplicate.duplicate_of).toMatch(/^[a-f0-9]{24}$/);
    expect(result.context.memoryExcerpts).not.toContain("quality constitution");
  });

  it("E-CTX-05 never evicts protected context and forces reassessment when it alone exceeds the cap", async () => {
    home = makeOrgHome();
    const required = `[ticket]\n${"goal ".repeat(400)}\n\n[contract]\n${"must ".repeat(400)}\n\n[findings]\n[active major] unresolved`;
    await expect(write("run-a", "episode-required", bundle(), required, 128)).rejects.toBeInstanceOf(ContextBudgetExceededError);
    const manifest = JSON.parse(
      await readFile(join(home.root, "runs", "app", "run-a", "context-manifest.json"), "utf8"),
    ) as { over_budget_required: boolean; components: Array<{ category: string; eviction: string }> };
    expect(manifest.over_budget_required).toBe(true);
    expect(manifest.components.filter((component) => ["authority", "taste", "ticket", "contract", "unresolved_findings"].includes(component.category)).every((component) => component.eviction === "kept")).toBe(true);
  });

  it("E-CTX-06 applies deterministic optional caps without crossing episode boundaries", async () => {
    home = makeOrgHome();
    const large = bundle();
    large.components = [
      ...large.components!,
      ...Array.from({ length: 8 }, (_, index) => ({
        category: "memory" as const,
        source: `memory/large-${index}.md`,
        rendered: `${index}:${"x".repeat(5_000)}`,
        inclusionReason: "optional historical context",
        requirement: "optional" as const,
      })),
    ];
    large.memoryExcerpts = large.components.filter((component) => component.category === "memory").map((component) => component.rendered);
    const first = await write("run-a", "episode-cap", large);
    const evicted = first.manifest.components.filter((component) => component.eviction === "evicted").map((component) => component.source);
    expect(evicted.length).toBeGreaterThan(0);
    const isolated = await write("run-b", "other-episode", large);
    expect(isolated.manifest.components.every((component) => component.prior_pass_change === "initial")).toBe(true);
    expect(isolated.manifest.components.filter((component) => component.eviction === "evicted").map((component) => component.source)).toEqual(evicted);
  });

  it("E-CTX-07 rejects hidden-answer markers before prompt construction", async () => {
    home = makeOrgHome();
    await expect(write("run-a", "episode-hidden", bundle(), "[ticket]\nOPERON_HIDDEN_SOLUTION_17")).rejects.toThrow(/hidden_answer_leakage/);
    await expect(readFile(join(home.root, "runs", "app", "run-a", "prompt.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("E-CTX-08 explain reports exact dominant sources/reasons without transcript data", async () => {
    home = makeOrgHome();
    await write("run-a", "episode-explain");
    const explanation = await explainContext(home.root, "episode-explain");
    expect(explanation.episode_id).toBe("episode-explain");
    expect(explanation.dominant.length).toBeGreaterThan(0);
    expect(explanation.dominant.every((component) => component.source !== "prompt.md" && component.source !== "output.md")).toBe(true);
    expect(explanation.dominant[0]).toMatchObject({ inclusion_reason: expect.any(String), rendered_bytes: expect.any(Number) });
  });
});

function structuredBrief(): string {
  return [
    "[ticket]",
    "goal\n- [ ] binary acceptance criterion",
    "",
    "[contract]",
    "test AC1 with pnpm test",
    "",
    "[findings]",
    "[active major] unresolved invariant",
    "",
    "[history]",
    "prior attempt was superseded",
  ].join("\n");
}

function bundle(): ContextBundle {
  return {
    authority: {
      profile: "operator",
      version: "1",
      sha256: "a".repeat(64),
      sources: ["AUTHORITY.md"],
      text: "delegated authority",
    },
    taste: ["quality constitution"],
    memoryExcerpts: ["validated fact", "quality constitution"],
    components: [
      { category: "authority", source: "AUTHORITY.md", rendered: "delegated authority", inclusionReason: "delegated authority; never evict", requirement: "required" },
      { category: "taste", source: "TASTE.md", rendered: "quality constitution", inclusionReason: "safety and quality constitution; never evict", requirement: "required" },
      { category: "memory", source: "memory/fact.md", rendered: `validated:${"x".repeat(500)}`, inclusionReason: "applicable governed fact", requirement: "optional" },
      { category: "memory", source: "memory/duplicate.md", rendered: "quality constitution", inclusionReason: "duplicate should be removed", requirement: "optional" },
    ],
  };
}
