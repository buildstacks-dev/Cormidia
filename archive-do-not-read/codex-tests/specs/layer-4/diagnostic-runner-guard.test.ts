import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ARTIFACT_ROOT, HARNESS_ROOT } from "../../src/fixtures/controlled-world.js";

const command = resolve(
  HARNESS_ROOT,
  "src",
  "cli",
  "run-episode-planner-diagnostic.ts",
);
const protectedEvidence = [
  resolve(ARTIFACT_ROOT, "layer-4", "OPERON-L4-002", "spend-ledger.json"),
  resolve(ARTIFACT_ROOT, "layer-4", "OPERON-L4-002", "diagnostic-report.json"),
];

describe("OPERON-L4-002 execution guard", () => {
  it("refuses missing or mismatched content-bound authorization without changing evidence", () => {
    const before = evidenceHashes();
    const missing = spawnSync(process.execPath, ["--import", "tsx", command], {
      cwd: HARNESS_ROOT,
      encoding: "utf8",
    });
    const wrong = spawnSync(
      process.execPath,
      ["--import", "tsx", command, "--execute", "--authorization", "OPERON-L4-001"],
      { cwd: HARNESS_ROOT, encoding: "utf8" },
    );

    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain(
      "provider execution requires --execute --authorization OPERON-L4-002",
    );
    expect(wrong.status).not.toBe(0);
    expect(wrong.stderr).toContain(
      "provider execution requires --execute --authorization OPERON-L4-002",
    );
    expect(evidenceHashes()).toEqual(before);
  });
});

function evidenceHashes(): Array<string | null> {
  return protectedEvidence.map((path) =>
    existsSync(path)
      ? createHash("sha256").update(readFileSync(path)).digest("hex")
      : null,
  );
}
