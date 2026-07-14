import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { evaluateContracts } from "../../scripts/eval/contracts.js";
import type { ContractRecord } from "../../scripts/eval/core.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const required = (id: string, evidence: string): ContractRecord => ({ id, requirement: id, state: "required", workstream: "T1", phase: "T1", evidence, promotion: "already required" });
const red = (id: string, evidence: string): ContractRecord => ({ id, requirement: id, state: "known_red", expected_failure: "feature_absent", workstream: "future", phase: "T3", evidence, promotion: "evidence passes" });

it("requires executable evidence for the exact known-red set and keeps strict mode red", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-contracts-")); dirs.push(root); mkdirSync(join(root, "test")); writeFileSync(join(root, "test", "required.test.ts"), "// evidence\n");
  const contracts = [required("REQ", "test/required.test.ts"), red("RED", "test/red.test.ts")];
  expect(evaluateContracts(contracts, root).failures[0]).toContain("RED");
  writeFileSync(join(root, "test", "red.test.ts"), "// executable typed known-red assertion\n");
  expect(evaluateContracts(contracts, root)).toMatchObject({ knownRed: ["RED"], failures: [] });
  expect(evaluateContracts(contracts, root, true).failures.at(-1)).toContain("strict mode");
});
