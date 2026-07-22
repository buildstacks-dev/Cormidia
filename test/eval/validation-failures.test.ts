import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

const repo = resolve(import.meta.dirname, "../..");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("eval:validate fail-closed traceability", () => {
  it("positive case validates the complete copied repository evidence", () => { expect(run(makeRoot())).toMatchObject({ status: 0, report: { valid: true } }); });
  it("fails for a nonempty evidence path whose file does not exist", () => {
    const root = makeRoot(); unlinkSync(join(root, "test/efficiency/admission.test.ts"));
    const result = run(root); expect(result.status).not.toBe(0); expect(result.report.failures.join("\n")).toContain("missing evidence file");
  });
  it("fails for an evidence file that does not declare its requirement id", () => {
    const root = makeRoot(); writeFileSync(join(root, "test/efficiency/admission.test.ts"), "import { it } from 'vitest'; it('unrelated', () => {});\n");
    const result = run(root); expect(result.status).not.toBe(0); expect(result.report.failures.join("\n")).toContain("does not declare the requirement id");
  });
  it("fails for an unknown campaign case id", () => {
    const root = makeRoot(); const path = join(root, "eval/campaigns/pre-transformation-baseline.yaml"); const value = parse(readFileSync(path, "utf8")) as { cases: Array<{ case_id: string }> }; value.cases[0]!.case_id = "unknown/not-real/v1"; writeFileSync(path, stringify(value));
    const result = run(root); expect(result.status).not.toBe(0); expect(result.report.failures.join("\n")).toContain("unknown case_id unknown/not-real/v1");
  });
  it("fails for a missing required benchmark family", () => {
    const root = makeRoot(); const path = join(root, "eval/benchmarks.yaml"); const value = parse(readFileSync(path, "utf8")) as { families: Array<{ id: string }> }; value.families = value.families.filter((item) => item.id !== "LIFE-LEGACY-001"); writeFileSync(path, stringify(value));
    const result = run(root); expect(result.status).not.toBe(0); expect(result.report.failures.join("\n")).toContain("missing benchmark family LIFE-LEGACY-001");
  });
  it("fails when the contract inventory size drifts from the ratified count", () => {
    const root = makeRoot(); const path = join(root, "eval/contracts.yaml"); const value = parse(readFileSync(path, "utf8")) as { contracts: Array<{ id: string }> }; value.contracts = value.contracts.filter((item) => item.id !== "B-ADM-01"); writeFileSync(path, stringify(value));
    const result = run(root); expect(result.status).not.toBe(0); expect(result.report.failures.join("\n")).toContain("contracts must contain exactly 84 records");
  });
  it("fails when pinned grader content changes without a new manifest hash", () => {
    const root = makeRoot(); const path = join(root, "eval/graders/route-corpus/reference/grader-evidence.json"); writeFileSync(path, `${readFileSync(path, "utf8")}\n`);
    const result = run(root); expect(result.status).not.toBe(0); expect(result.report.failures.join("\n")).toContain("content_sha256 expected");
  });
  it("fails when a benchmark family omits one of its declared executable cases", () => {
    const root = makeRoot(); const path = join(root, "eval/benchmarks.yaml"); const value = parse(readFileSync(path, "utf8")) as { families: Array<{ id: string; case_ids?: string[] }> }; const family = value.families.find((item) => item.id === "SCHEDULER-SOAK-001")!; family.case_ids = ["soak/virtual-seven-day/v1"]; writeFileSync(path, stringify(value));
    const result = run(root); expect(result.status).not.toBe(0); expect(result.report.failures).toContain("eval/benchmarks.yaml: SCHEDULER-SOAK-001 omits declared case soak/realtime-48h/v1");
  });
  it("fails when the immutable qualification sequence no longer has five clean quick episodes", () => {
    const root = makeRoot(); const path = join(root, "eval/campaigns/candidate-qualification.yaml"); const value = parse(readFileSync(path, "utf8")) as { blocks: Array<{ name: string; cases: Array<{ repetition_ids: string[] }> }> }; const clean = value.blocks.find((block) => block.name === "clean")!; clean.cases[0]!.repetition_ids.pop(); writeFileSync(path, stringify(value));
    const result = run(root); expect(result.status).not.toBe(0); expect(result.report.failures.join("\n")).toContain("qualification clean block must contain exactly five quick repetitions");
  });
  it("fails when a campaign capability claim has no pinned declaration", () => {
    const root = makeRoot(); const path = join(root, "eval/campaigns/adapter-harness-calibration.yaml"); const value = parse(readFileSync(path, "utf8")) as { assignments: Array<{ capability_ref: string }> }; value.assignments[0]!.capability_ref = "claude/v99"; writeFileSync(path, stringify(value));
    const result = run(root); expect(result.status).not.toBe(0); expect(result.report.failures.join("\n")).toContain("references unknown capability claude/v99");
  });
  it("fails when a case seed reference drifts from its content-addressed app template", () => {
    const root = makeRoot(); const path = join(root, "eval/cases/roles/standing-v1.yaml"); const value = parse(readFileSync(path, "utf8")) as { app: { seed_ref: string } }; value.app.seed_ref = `sha256:${"0".repeat(64)}`; writeFileSync(path, stringify(value));
    const result = run(root); expect(result.status).not.toBe(0); expect(result.report.failures.join("\n")).toContain("seed_ref expected");
  });
  it("fails when any one of the 60 exact fault boundaries is missing", () => {
    const root = makeRoot(); const path = join(root, "eval/faults.yaml"); const value = parse(readFileSync(path, "utf8")) as { faults: string[] }; value.faults = value.faults.filter((fault) => fault !== "before_usage_checkpoint"); writeFileSync(path, stringify(value));
    const result = run(root); expect(result.status).not.toBe(0); expect(result.report.failures).toContain("eval/faults.yaml: must exactly enumerate all 60 before/after durable boundaries");
  });
  it("fails when a campaign operator fixture is missing instead of accepting an unbound policy name", () => {
    const root = makeRoot(); const path = join(root, "eval/operator-fixtures/eval-only-content-bound-approvals-v1.yaml"); unlinkSync(path);
    const result = run(root); expect(result.status).not.toBe(0); expect(result.report.failures.join("\n")).toContain("missing operator_fixture operator-fixtures/eval-only-content-bound-approvals-v1.yaml");
  });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "operon-validate-copy-")); roots.push(root);
  for (const path of [
    "eval",
    "test/transformation",
    "test/eval",
    "test/efficiency",
    "test/lifecycle",
    "test/report/efficiency.test.ts",
    "test/context-manifest.test.ts",
    "test/loop/context-delta.test.ts",
    "test/continuation",
    "test/learning/efficiency-capture.test.ts",
    "test/learning/efficacy.test.ts",
    "test/learning/learning-closure.test.ts",
    "test/learning/reset-abandoned.test.ts",
    "test/approval-semantics.test.ts",
    "test/plan-auto.test.ts",
    "test/settlement/property.test.ts",
    "test/scheduler/lifecycle.test.ts",
    "test/scheduler/virtual-soak.test.ts",
  ]) { const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); cpSync(join(repo, path), target, { recursive: true }); }
  return root;
}
function run(root: string): { status: number | null; report: { valid: boolean; failures: string[] } } {
  const result = spawnSync(process.execPath, ["--import", "tsx", join(repo, "scripts/eval/validate.ts"), "--root", root], { cwd: repo, encoding: "utf8" });
  const start = result.stdout.indexOf("{"); const report = JSON.parse(result.stdout.slice(start)) as { valid: boolean; failures: string[] };
  return { status: result.status, report };
}
