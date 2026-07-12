import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type ProbeOutcome = "passed" | "evidence_absent" | "route_admission_absent" | "efficiency_measurement_absent" | "efficiency_reporting_absent" | "lifecycle_command_absent" | "route_policy_absent" | "provider_baseline_not_run" | "context_manifest_absent" | "continuation_journal_absent" | "semantic_action_eval_absent" | "efficiency_learning_signal_absent" | "scheduler_management_absent" | "distribution_statistics_absent" | "portable_efficiency_report_absent" | "efficiency_release_gate_absent";

export function probeContract(id: string, root: string, evidenceExists: boolean): ProbeOutcome {
  if (["J-MAN-01", "J-MAN-02", "J-GRADE-01", "J-STAT-01", "J-STAT-02", "J-RPT-01"].includes(id)) return evidenceExists ? "passed" : "evidence_absent";
  if (id.startsWith("A-DOC-")) return doctrineProbe(id, root);
  if (id.startsWith("B-ADM-")) { const sources = sourceText(root); return sources.includes("planned_route") && sources.includes("current_route") ? "passed" : "route_admission_absent"; }
  if (id.startsWith("B-MET-")) { const sources = sourceText(root); return sources.includes("productive_pass") && sources.includes("execution_step") ? "passed" : "efficiency_measurement_absent"; }
  if (id.startsWith("B-RPT-")) { const sources = sourceText(root); return sources.includes("repeated_work_cost") && sources.includes("planned_route") ? "passed" : "efficiency_reporting_absent"; }
  if (id.startsWith("C-LIFE-")) return hasCapabilities(root, ["org upgrade", "app verify", "app promote"]) ? "passed" : "lifecycle_command_absent";
  if (id.startsWith("D-ROUTE-")) { const sources = sourceText(root); return sources.includes("planned_route") && sources.includes("blast_radius") ? "passed" : "route_policy_absent"; }
  if (id.startsWith("D-")) return hasBaseline(root, id) ? "passed" : "provider_baseline_not_run";
  if (id.startsWith("E-CTX-")) { const sources = sourceText(root); return sources.includes("context_manifest") && sources.includes("rendered_bytes") ? "passed" : "context_manifest_absent"; }
  if (id.startsWith("E-LIVE-")) return hasBaseline(root, id) ? "passed" : "provider_baseline_not_run";
  if (id.startsWith("F-")) { const sources = sourceText(root); return sources.includes("episode_execution_journal") && sources.includes("next_legal_transition") ? "passed" : "continuation_journal_absent"; }
  if (id.startsWith("G-")) return hasBaseline(root, id) ? "passed" : "semantic_action_eval_absent";
  if (id.startsWith("H-")) { const sources = sourceText(root); return sources.includes("route_overrun") && sources.includes("repeated_work") ? "passed" : "efficiency_learning_signal_absent"; }
  if (id.startsWith("I-")) return hasCapabilities(root, ["scheduler install", "scheduler status", "scheduler uninstall"]) ? "passed" : "scheduler_management_absent";
  if (id === "J-REL-01") return existsSync(join(root, ".github/workflows/efficiency-qualification.yml")) ? "passed" : "efficiency_release_gate_absent";
  return evidenceExists ? "passed" : "evidence_absent";
}

function doctrineProbe(id: string, root: string): ProbeOutcome {
  const efficiency = readFileSync(join(root, "docs/efficiency.md"), "utf8");
  const purpose = readFileSync(join(root, "docs/PURPOSE.md"), "utf8");
  if (id === "A-DOC-01") return efficiency.includes("## Normative identities") && efficiency.includes("**Active wall time:**") ? "passed" : "evidence_absent";
  if (id === "A-DOC-02") return (efficiency.match(/<!-- efficiency-budgets:start -->/g) ?? []).length === 1 ? "passed" : "evidence_absent";
  if (id === "A-DOC-03") return purpose.includes("superseded by the 2026-07-12 efficiency doctrine") ? "passed" : "evidence_absent";
  if (id === "A-DOC-04") return hasCapabilities(root, ["plan", "loop", "dispatch", "run-role", "learn"]) ? "passed" : "evidence_absent";
  if (id === "A-DOC-05") return existsSync(join(root, "eval/contracts.yaml")) && existsSync(join(root, "eval/cases")) ? "passed" : "evidence_absent";
  return "evidence_absent";
}

function hasCapabilities(root: string, commands: string[]): boolean {
  const capabilities = readFileSync(join(root, "src/cli/context-info.ts"), "utf8");
  return commands.every((command) => capabilities.includes(`command: "${command}"`));
}
function hasBaseline(root: string, id: string): boolean { return existsSync(join(root, "research/evals", `${id}.json`)); }
function sourceText(root: string): string {
  const chunks: string[] = [];
  visit(join(root, "src"));
  return chunks.join("\n").toLowerCase();
  function visit(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) chunks.push(readFileSync(path, "utf8"));
    }
  }
}
