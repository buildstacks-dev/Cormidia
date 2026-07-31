import { readFileSync } from "node:fs";
import { join } from "node:path";

export function grade(root: string): boolean {
  const value = JSON.parse(readFileSync(join(root, "grader-evidence.json"), "utf8")) as Record<string, unknown>;
  return value.byte_deterministic === true && value.single_component_delta === true && value.protected_content_complete === true && value.hidden_marker_present === false && value.fabricated_token_attribution === false;
}
