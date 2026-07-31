import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { evaluateContracts } from "../../scripts/eval/contracts.js";
import type { ContractRecord } from "../../scripts/eval/core.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const required = (id: string, evidence: string): ContractRecord => ({ id, requirement: id, state: "required", qualification_scope: "current", workstream: "T1", phase: "T1", evidence, promotion: "already required" });
const red = (id: string, evidence: string, qualification_scope: ContractRecord["qualification_scope"] = "current"): ContractRecord => ({ id, requirement: id, state: "known_red", qualification_scope, expected_failure: "feature_absent", workstream: "future", phase: "T3", evidence, promotion: "evidence passes" });

it("requires executable evidence for the exact known-red set and keeps strict mode red", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-contracts-")); dirs.push(root); mkdirSync(join(root, "test")); writeFileSync(join(root, "test", "required.test.ts"), "// evidence\n");
  const contracts = [required("REQ", "test/required.test.ts"), red("RED", "test/red.test.ts")];
  expect(evaluateContracts(contracts, root).failures[0]).toContain("RED");
  writeFileSync(join(root, "test", "red.test.ts"), "// executable typed known-red assertion\n");
  expect(evaluateContracts(contracts, root)).toMatchObject({ knownRed: ["RED"], failures: [] });
  expect(evaluateContracts(contracts, root, { strict: true, qualificationScope: "current" }).failures.at(-1)).toContain("current strict mode");
});

it("strict evaluation filters only the declared scope while retaining inventory totals", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-contract-scopes-")); dirs.push(root); mkdirSync(join(root, "test"));
  for (const name of ["required", "current-red", "future-red"]) writeFileSync(join(root, "test", `${name}.test.ts`), "// evidence\n");
  const contracts = [
    required("REQ", "test/required.test.ts"),
    red("CURRENT-RED", "test/current-red.test.ts"),
    red("FUTURE-RED", "test/future-red.test.ts", "future_soak"),
  ];
  expect(evaluateContracts(contracts, root, { strict: true, qualificationScope: "current" })).toMatchObject({ inventoryTotal: 3, evaluatedTotal: 2, knownRed: ["CURRENT-RED"] });
  expect(evaluateContracts(contracts, root, { strict: true, qualificationScope: "future_soak" })).toMatchObject({ inventoryTotal: 3, evaluatedTotal: 1, knownRed: ["FUTURE-RED"] });
});
