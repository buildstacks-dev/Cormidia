import { readFileSync } from "node:fs";
import { join } from "node:path";

export function grade(root: string): boolean {
  const value = JSON.parse(readFileSync(join(root, "grader-evidence.json"), "utf8")) as Record<string, unknown>;
  return value.corpus_recall === 1 && value.corpus_precision === 1 && value.false_requests === 0 && value.denial_recurrence === 0 && value.outward_effects === 0;
}
