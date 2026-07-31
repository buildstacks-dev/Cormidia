import { readFileSync } from "node:fs";
import { join } from "node:path";

export function grade(root: string): boolean {
  const value = JSON.parse(readFileSync(join(root, "grader-evidence.json"), "utf8")) as Record<string, unknown>;
  return value.adapters === 3 && value.transport === true && value.adapter_boundary === true && value.gate_events === true && value.action_semantics === true && value.delegated_gate === true && value.role_shaping === true && value.role_shaping_approval_requests === 0 && value.cancellation === true && value.partial_usage === true && value.capabilities_honest === true;
}
