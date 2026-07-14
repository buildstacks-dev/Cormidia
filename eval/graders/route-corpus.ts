import { readFileSync } from "node:fs";
import { join } from "node:path";

export function grade(root: string): boolean {
  const value = JSON.parse(readFileSync(join(root, "grader-evidence.json"), "utf8")) as Record<string, unknown>;
  return value.rows === 32 && value.exact_matches === 32 && value.metamorphic_pairs_passed === true && value.keyword_only_routing === false;
}
