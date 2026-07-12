import { readFileSync } from "node:fs";
import { join } from "node:path";

export function grade(root: string): boolean {
  const value = JSON.parse(readFileSync(join(root, "grader-evidence.json"), "utf8")) as Record<string, unknown>;
  return value.boundaries_resumed === 5 && value.repeated_valid_passes === 0 && value.terminal_integrity === true;
}
