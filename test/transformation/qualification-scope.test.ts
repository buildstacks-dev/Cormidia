import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { verifyContractEvidence } from "../../scripts/eval/contract-evidence.js";
import {
  FUTURE_SOAK_CONTRACT_IDS,
  loadYamlFile,
  validateContracts,
  type ContractRecord,
} from "../../scripts/eval/core.js";

const roots: string[] = [];
const currentProviderContracts = [
  "D-LIVE-01",
  "D-LIVE-02",
  "D-LIVE-03",
  "E-LIVE-01",
  "E-LIVE-02",
  "G-MET-01",
  "I-ROLE-01",
  "I-ROLE-02",
  "I-ROLE-03",
];

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("declares all 84 contracts exactly once and future-scopes only I-LIVE-01", () => {
  const inventory = loadInventory();
  expect(validateContracts(inventory)).toEqual([]);
  expect(inventory.contracts).toHaveLength(84);
  expect(inventory.contracts.filter((contract) => contract.qualification_scope === "current")).toHaveLength(83);
  expect(inventory.contracts.filter((contract) => contract.qualification_scope === "future_soak").map((contract) => contract.id)).toEqual([...FUTURE_SOAK_CONTRACT_IDS]);
});

it("fails closed if any current provider debt is moved into the future soak scope", () => {
  for (const id of currentProviderContracts) {
    const inventory = loadInventory();
    inventory.contracts.find((contract) => contract.id === id)!.qualification_scope = "future_soak";
    expect(validateContracts(inventory)).toContain("future_soak scope must contain exactly I-LIVE-01");
  }
});

it("fails closed if I-LIVE-01 is deleted, unscoped, duplicated, or given a foreign scope", () => {
  const deleted = loadInventory();
  deleted.contracts = deleted.contracts.filter((contract) => contract.id !== "I-LIVE-01");
  expect(validateContracts(deleted)).toEqual(expect.arrayContaining([
    "contracts must contain exactly 84 records",
    "future_soak scope must contain exactly I-LIVE-01",
    "future_soak contract missing from inventory I-LIVE-01",
  ]));

  const unscoped = loadInventory() as unknown as { contracts: Array<Record<string, unknown>> };
  delete unscoped.contracts.find((contract) => contract.id === "I-LIVE-01")!.qualification_scope;
  expect(validateContracts(unscoped).join("\n")).toContain("qualification_scope must be one of current, future_soak");

  const missingFuture = loadInventory();
  missingFuture.contracts.find((contract) => contract.id === "I-LIVE-01")!.qualification_scope = "current";
  expect(validateContracts(missingFuture)).toContain("future_soak scope must contain exactly I-LIVE-01");

  const duplicated = loadInventory();
  duplicated.contracts[0]!.id = duplicated.contracts[1]!.id;
  expect(validateContracts(duplicated).join("\n")).toContain(`duplicate contract id ${duplicated.contracts[1]!.id}`);

  const foreign = loadInventory() as unknown as { contracts: Array<Record<string, unknown>> };
  foreign.contracts.find((contract) => contract.id === "I-LIVE-01")!.qualification_scope = "later";
  expect(validateContracts(foreign).join("\n")).toContain("qualification_scope must be one of current, future_soak");

  const malformed = loadInventory() as unknown as { contracts: Array<Record<string, unknown>> };
  malformed.contracts[0]!.scope = "current";
  expect(validateContracts(malformed).join("\n")).toContain("contracts[0] has unknown key scope");
});

it("rejects a locally-authored passing marker even if I-LIVE-01 is marked required", () => {
  const inventory = loadInventory();
  const live = inventory.contracts.find((contract) => contract.id === "I-LIVE-01")!;
  live.state = "required";
  delete live.expected_failure;
  expect(validateContracts(inventory)).toEqual([]);

  const root = mkdtempSync(join(tmpdir(), "operon-future-soak-marker-")); roots.push(root);
  const marker = join(root, "I-LIVE-01.json");
  writeFileSync(marker, '{"contract_id":"I-LIVE-01","state":"passed"}\n');
  expect(() => verifyContractEvidence(root, marker, {
    contractId: "I-LIVE-01",
    caseId: "soak/realtime-48h/v1",
    repetitionIds: ["real-1"],
  })).toThrow("contract_evidence_invalid_root");
});

it("keeps current and future strict results separate and preserves the runnable soak preview", () => {
  const current = runContracts("--strict");
  expect(current.status).not.toBe(0);
  expect(JSON.parse(current.stdout)).toMatchObject({
    qualification_scope: "current",
    inventory_total: 84,
    evaluated_total: 83,
    known_red: currentProviderContracts,
  });

  const future = runContracts("--strict", "--scope", "future_soak");
  expect(future.status).not.toBe(0);
  expect(JSON.parse(future.stdout)).toMatchObject({
    qualification_scope: "future_soak",
    inventory_total: 84,
    evaluated_total: 1,
    known_red: ["I-LIVE-01"],
  });

  const soak = spawnSync(process.execPath, ["--import", "tsx", "scripts/eval/soak.ts", "--campaign", "eval/campaigns/realtime-soak.yaml"], { cwd: process.cwd(), encoding: "utf8" });
  expect(soak.status).toBe(0);
  expect(JSON.parse(soak.stdout)).toMatchObject({ mode: "preview", schedule: { duration_hours: 48, tick_interval_minutes: 5, useful_turn_cap: 12, deliberate_restart_hour: 24 } });
});

function loadInventory(): { schema_version: 1; contracts: ContractRecord[] } {
  return structuredClone(loadYamlFile("eval/contracts.yaml")) as { schema_version: 1; contracts: ContractRecord[] };
}

function runContracts(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/eval/run-contracts.ts", ...args], { cwd: process.cwd(), encoding: "utf8" });
}
