import { readFileSync } from "node:fs";
import { join } from "node:path";

export function grade(root: string): boolean {
  const value = JSON.parse(readFileSync(join(root, "grader-evidence.json"), "utf8")) as Record<string, unknown>;
  return value.eligible_capture === 1 && value.comparable_events_per_class === 2 && value.self_activated === false && value.efficacy_measured === true;
}
