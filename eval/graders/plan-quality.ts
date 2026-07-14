import { readFileSync } from "node:fs";
import { join } from "node:path";

export function grade(root: string): boolean {
  const value = JSON.parse(readFileSync(join(root, "grader-evidence.json"), "utf8")) as Record<string, unknown>;
  return value.routes_covered === 3 && value.validated_plan_of_record === true && value.binary_criteria === true && value.product_coverage === true && value.intermediate_only === false;
}
