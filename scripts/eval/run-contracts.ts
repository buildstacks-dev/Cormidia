import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { evaluateContracts } from "./contracts.js";
import { loadYamlFile, validateContracts, type ContractRecord } from "./core.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const inventoryPath = resolve(root, "eval/contracts.yaml");
const raw = loadYamlFile(inventoryPath);
const errors = validateContracts(raw);
if (errors.length > 0) {
  console.error(`invalid contract inventory:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.exitCode = 1;
} else {
  const strict = process.argv.includes("--strict");
  const contracts = (raw as { contracts: ContractRecord[] }).contracts;
  const result = evaluateContracts(contracts, root, strict);
  console.log(JSON.stringify({ schema_version: 1, strict, total: contracts.length, known_red: result.knownRed, failures: result.failures }, null, 2));
  if (result.failures.length > 0) process.exitCode = 1;
}
