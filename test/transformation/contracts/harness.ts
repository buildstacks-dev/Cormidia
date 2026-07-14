import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadYamlFile, validateResult } from "../../../scripts/eval/core.js";

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
}

export function defineProviderEvidenceDebt(specs: ResultDebtSpec[]): void {
  for (const spec of specs) {
    describe(spec.id, () => {
      it("positive case executes the immutable campaign/result boundary and observes exact missing behavior", () => {
        const campaign = loadYamlFile(join(root, "eval/campaigns", spec.campaign)) as { cases?: Array<{ case_id?: string }> };
        expect(campaign.cases?.some((item) => item.case_id === spec.caseId)).toBe(true);
        const committed = join(root, "research/evals/contracts", `${spec.id}.json`);
        expect(classifyResultEvidence(committed, spec.caseId, spec.expectedFailure)).toBe(spec.expectedFailure);
      });
      it("near-miss case accepts a complete typed result for the same case", () => {
        const result = fixtureResult(spec.caseId);
        expect(validateResult(result)).toEqual([]);
        expect(classifyResultValue(result, spec.caseId, spec.expectedFailure)).toBe("passed");
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

function classifyResultEvidence(path: string, caseId: string, expectedFailure: string): string {
  if (!existsSync(path)) return expectedFailure;
  try { return classifyResultValue(JSON.parse(readFileSync(path, "utf8")), caseId, expectedFailure); }
  catch { return "invalid_contract_observation"; }
}

function classifyResultValue(value: unknown, caseId: string, expectedFailure: string): string {
  const errors = validateResult(value);
  if (errors.length > 0) return "invalid_contract_observation";
  const result = value as { case_id: string; outcome: string; missing: string[] };
  if (result.case_id !== caseId) return "invalid_contract_observation";
  return result.outcome === "passed" && result.missing.length === 0 ? "passed" : expectedFailure;
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
    metrics: { route: { planned: "standard", final: "standard", model_turns: 1 }, context: { rendered_bytes: 10, sources: { task: 10 } }, cost: { equivalent_usd: 0.01, product_usd: 0.01, evaluator_usd: 0, quality: "complete" }, tokens: { input: 10, output: 2, quality: "complete" }, latency: { elapsed_ms: 10, active_ms: 10, human_wait_ms: 0 }, human_load: { decisions: 0 }, productivity: { productive_passes: 1, total_passes: 1, ratio: 1, repeated_work_cost_usd: 0 }, continuation: caseId.startsWith("continuation/") ? { eligible: 1, resumed_without_repeat: 1, ratio: 1 } : excluded("not_continuation_case"), approvals: caseId.startsWith("approval/") ? { valid_requests: 1, total_requests: 1, precision: 1, recurrence: 0 } : excluded("not_approval_case"), scheduler: caseId.startsWith("soak/") ? { due_ticks: 1, reasoned_ticks: 1, reliability: 1 } : excluded("not_scheduler_case"), learning: caseId.startsWith("learning/") ? { eligible_capture: 1, captured: 1, capture_ratio: 1, effect_delta: 1 } : excluded("not_learning_case"), execution: { terminal_integrity: 1, provider_turns: 1, mechanical_steps: 0, provider_settlements: 1, mechanical_settlements: 0 } },
    exclusions: [],
    missing: [],
  };
}
