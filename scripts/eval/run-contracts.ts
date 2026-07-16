import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { evaluateContracts, type ContractEvaluationScope } from "./contracts.js";
import { loadYamlFile, validateContracts, type ContractRecord } from "./core.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const inventoryPath = resolve(root, "eval/contracts.yaml");
const raw = loadYamlFile(inventoryPath);
const errors = validateContracts(raw);
if (errors.length > 0) {
  console.error(`invalid contract inventory:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.exitCode = 1;
} else {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const scopeFlags = args.flatMap((arg, index) => arg === "--scope" ? [args[index + 1]] : []);
  const unknown = args.filter((arg, index) => arg !== "--strict" && arg !== "--scope" && args[index - 1] !== "--scope");
  const requestedScope = scopeFlags[0];
  if (unknown.length > 0 || scopeFlags.length > 1 || scopeFlags.some((scope) => scope === undefined) || (requestedScope !== undefined && !["all", "current", "future_soak"].includes(requestedScope))) {
    console.error("usage: run-contracts [--strict] [--scope all|current|future_soak]");
    process.exitCode = 1;
  } else {
    const qualificationScope = (requestedScope ?? (strict ? "current" : "all")) as ContractEvaluationScope;
    const contracts = (raw as { contracts: ContractRecord[] }).contracts;
    const result = evaluateContracts(contracts, root, { strict, qualificationScope });
    console.log(JSON.stringify({ schema_version: 1, strict, qualification_scope: qualificationScope, inventory_total: result.inventoryTotal, evaluated_total: result.evaluatedTotal, known_red: result.knownRed, failures: result.failures }, null, 2));
    if (result.failures.length > 0) process.exitCode = 1;
  }
}
