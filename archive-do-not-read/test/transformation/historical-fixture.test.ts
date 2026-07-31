import { cpSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashFile, hashTree } from "../../scripts/eval/core.js";
import { makeEvalWorld } from "../fixtures/evalWorld.js";

const fixture = fileURLToPath(new URL("../fixtures/historical/2026-07-12-buildstacks-class", import.meta.url));

describe("independent historical fixture validation", () => {
  it("matches every committed checksum before and after an isolated copy", () => {
    const manifest = JSON.parse(readFileSync(join(fixture, "manifest.json"), "utf8")) as { files: Record<string, string> };
    const before = hashTree(fixture);
    for (const [name, expected] of Object.entries(manifest.files)) expect(`sha256:${hashFile(join(fixture, name))}`, name).toBe(expected);
    const world = makeEvalWorld();
    try {
      const copy = join(world.paths.artifacts, "historical"); cpSync(fixture, copy, { recursive: true });
      for (const [name, expected] of Object.entries(manifest.files)) expect(`sha256:${hashFile(join(copy, name))}`, name).toBe(expected);
      expect(hashTree(fixture)).toBe(before);
    } finally { world.cleanup(); }
  });
  it("retains the required regression signals without L3 content", () => {
    const runs = JSON.parse(readFileSync(join(fixture, "runs.json"), "utf8")) as Array<Record<string, unknown>>;
    const approvals = JSON.parse(readFileSync(join(fixture, "approvals.json"), "utf8")) as Array<{ classification: string }>;
    expect(runs.some((run) => run.status === "running" && run.runtime === null)).toBe(true);
    expect(runs.filter((run) => run.status === "cancelled")).toHaveLength(2);
    expect(approvals.every((item) => item.classification === "false_positive")).toBe(true);
    expect(hashTree(fixture)).toBeTruthy();
  });
});
