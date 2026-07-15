import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadYamlFile, validateResult } from "../../../scripts/eval/core.js";
import { verifyContractEvidence } from "../../../scripts/eval/contract-evidence.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = join(root, "src/cli.ts");
const helpCache = new Map<string, string>();

export interface SurfaceDebtSpec {
  id: string;
  expectedFailure: string;
  help: string[];
  missingToken: string;
  nearMissToken: string;
}

export function definePublicSurfaceDebt(specs: SurfaceDebtSpec[]): void {
  for (const spec of specs) {
    describe(spec.id, () => {
      it("positive case executes the public CLI boundary and observes the exact known-red failure", () => {
        const output = runCli([...spec.help, "--help"]);
        expect(classifySurface(output, spec.missingToken, spec.expectedFailure)).toBe(spec.expectedFailure);
      });
      it("near-miss case proves an adjacent existing surface is not classified red", () => {
        const output = runCli([...spec.help, "--help"]);
        expect(classifySurface(output, spec.nearMissToken, spec.expectedFailure)).toBe("passed");
      });
      it("honest failure case keeps malformed observations distinct from product debt", () => {
        expect(classifySurface("", spec.missingToken, spec.expectedFailure)).toBe("invalid_contract_observation");
      });
    });
  }
}

export interface ResultDebtSpec {
  id: string;
  expectedFailure: string;
  caseId: string;
  campaign: string;
  repetitionIds: string[];
}

export function defineProviderEvidenceDebt(specs: ResultDebtSpec[]): void {
  for (const spec of specs) {
    describe(spec.id, () => {
      it("positive case executes the immutable promotion boundary and observes the declared state", () => {
        const campaign = loadYamlFile(join(root, "eval/campaigns", spec.campaign)) as { cases?: Array<{ case_id?: string }> };
        expect(campaign.cases?.some((item) => item.case_id === spec.caseId)).toBe(true);
        const committed = join(root, "research/evals/contracts", `${spec.id}.json`);
        const inventory = loadYamlFile(join(root, "eval/contracts.yaml")) as { contracts: Array<{ id: string; state: string }> };
        const state = inventory.contracts.find((item) => item.id === spec.id)?.state;
        expect(classifyResultEvidence(committed, spec, spec.expectedFailure)).toBe(state === "required" ? "passed" : spec.expectedFailure);
      });
      it("near-miss case refuses a complete but unbound locally-authored result", () => {
        const result = fixtureResult(spec.caseId);
        expect(validateResult(result)).toEqual([]);
        expect(classifyResultValue(result, spec.caseId, spec.expectedFailure)).toBe("invalid_contract_observation");
      });
      it("honest failure case rejects corrupt or foreign result evidence", () => {
        expect(classifyResultValue({ case_id: "foreign" }, spec.caseId, spec.expectedFailure)).toBe("invalid_contract_observation");
      });
    });
  }
}

function runCli(args: string[]): string {
  const key = args.join("\0");
  const cached = helpCache.get(key);
  if (cached !== undefined) return cached;
  const result = spawnSync(process.execPath, ["--import", "tsx", cli, ...args], {
    cwd: root,
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf8",
    timeout: 20_000,
  });
  const output = `${result.stdout}${result.stderr}`;
  if (result.error) throw result.error;
  if (output.trim() === "") throw new Error(`empty_cli_observation: ${args.join(" ")}`);
  helpCache.set(key, output);
  return output;
}

function classifySurface(output: string, token: string, expectedFailure: string): string {
  if (output.trim() === "") return "invalid_contract_observation";
  return output.includes(token) ? "passed" : expectedFailure;
}

function classifyResultEvidence(path: string, spec: ResultDebtSpec, expectedFailure: string): string {
  if (!existsSync(path)) return expectedFailure;
  try {
    verifyContractEvidence(root, path, { contractId: spec.id, caseId: spec.caseId, repetitionIds: spec.repetitionIds });
    return "passed";
  }
  catch { return "invalid_contract_observation"; }
}

function classifyResultValue(value: unknown, caseId: string, expectedFailure: string): string {
  const errors = validateResult(value);
  if (errors.length > 0) return "invalid_contract_observation";
  const result = value as { case_id: string; outcome: string; missing: string[] };
  if (result.case_id !== caseId) return "invalid_contract_observation";
  // A raw result is never sufficient promotion evidence. It lacks the
  // prepared campaign, qualifier, report, archive, grader, GitHub idempotence,
  // settlement reconciliation, and release-equivalence bindings.
  return result.outcome === "passed" && result.missing.length === 0 ? "invalid_contract_observation" : expectedFailure;
}

function fixtureResult(caseId: string): Record<string, unknown> {
  const excluded = (reason: string) => ({ excluded: [reason] });
  return {
    schema_version: 1,
    campaign_id: "contract-near-miss",
    campaign_sha256: `sha256:${"a".repeat(64)}`,
    attempt_id: "near-miss-1",
    case_id: caseId,
    repetition_id: "r1",
    outcome: "passed",
    admitted_at: "2026-07-12T00:00:00.000Z",
    terminal_at: "2026-07-12T00:01:00.000Z",
    evidence: ["fixture:near-miss"],
    metrics: { route: { planned: "standard", final: "standard", model_turns: 1 }, context: { rendered_bytes: 10, sources: { task: 10 } }, cost: { equivalent_usd: 0.01, product_usd: 0.01, evaluator_usd: 0, quality: "complete" }, tokens: { input: 10, output: 2, quality: "complete" }, latency: { elapsed_ms: 10, active_ms: 10, human_wait_ms: 0 }, human_load: { decisions: 0 }, productivity: { productive_passes: 1, total_passes: 1, ratio: 1, repeated_work_cost_usd: 0 }, continuation: caseId.startsWith("continuation/") ? { eligible: 1, resumed_without_repeat: 1, ratio: 1 } : excluded("not_continuation_case"), approvals: caseId.startsWith("approval/") ? { valid_requests: 1, total_requests: 1, precision: 1, recurrence: 0 } : excluded("not_approval_case"), scheduler: caseId.startsWith("soak/") ? { due_ticks: 1, reasoned_ticks: 1, reliability: 1 } : excluded("not_scheduler_case"), learning: caseId.startsWith("learning/") ? { eligible_capture: 1, captured: 1, capture_ratio: 1, effect_value: 1 } : excluded("not_learning_case"), execution: { terminal_integrity: 1, provider_turns: 1, mechanical_steps: 0, provider_settlements: 1, mechanical_settlements: 0 } },
    exclusions: [],
    missing: [],
  };
}
