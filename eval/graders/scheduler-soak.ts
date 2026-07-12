import { readFileSync } from "node:fs";
import { join } from "node:path";

export function grade(root: string): boolean {
  const value = JSON.parse(readFileSync(join(root, "grader-evidence.json"), "utf8")) as Record<string, unknown>;
  return value.virtual_days === 7 && value.duplicate_ticks === 0 && value.silent_misses === 0 && value.orphaned_runs === 0;
}
