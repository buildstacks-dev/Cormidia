import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEvalConfig } from "../../eval-runner/config.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("L4 reviewed authorization config", () => {
  it("refuses an absent opt-in instead of skipping", async () => {
    await expect(loadEvalConfig({})).rejects.toThrow(/OPERON_EVAL=1/);
  });

  it("negative control: refuses unknown widening fields", async () => {
    const { path, value } = await fixture();
    await writeFile(path, JSON.stringify({ ...value, allow_external_publication: true }), "utf8");
    await expect(loadEvalConfig({ OPERON_EVAL: "1", OPERON_EVAL_CONFIG: path })).rejects.toThrow(/unknown eval config field/);
  });

  it("accepts an exact reviewed envelope", async () => {
    const { path, value } = await fixture(); await writeFile(path, JSON.stringify(value), "utf8");
    await expect(loadEvalConfig({ OPERON_EVAL: "1", OPERON_EVAL_CONFIG: path })).resolves.toEqual(value);
  });
});

async function fixture(): Promise<{ path: string; value: Record<string, unknown> }> {
  const root = await mkdtemp(join(tmpdir(), "eval-config-")); roots.push(root);
  return { path: join(root, "config.json"), value: {
    schema_version: 1, campaign_id: "eval-fixture",
    human_authorization: { human_initiated: true, authorized_by: "fixture-human", authorized_at: "2026-07-31T00:00:00.000Z", purpose: "fixture" },
    state_home: join(root, "state"), policy_path: join(root, "policy.yaml"), commit: "a".repeat(40), app: "sandbox-app",
    golden_set_files: [join(root, "golden.json")],
    tuples: [{ id: "reviewer-a", runtime: "claude", model: "fixture-model", effort: "medium", maxCaseCostUsd: 1 }],
    max_tokens: 1000, max_provider_turns: 2, max_equiv_usd: 5, shard: null,
  } };
}
