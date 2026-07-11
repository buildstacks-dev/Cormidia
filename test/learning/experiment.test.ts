// Tests the ExperimentRecord contract (src/org/learning/experiment.ts):
// declared-before-results enforced structurally, two distinct fingerprint
// arms with a reportable delta, guardrail rule shapes, immutable
// declarations, and the declared → running → decided status walk. M3
// done-criterion 1 (first half): an experiment declared against two stored
// fingerprints validates.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  declareExperiment,
  experimentPath,
  listExperimentRecords,
  markExperimentRunning,
  readExperimentRecord,
  validateExperimentRecord,
} from "../../src/org/learning/experiment.js";
import {
  computeSystemFingerprint,
  storeFingerprint,
} from "../../src/org/learning/fingerprint.js";
import { makeExperiment } from "./helpers.js";

const CLEANUPS: Array<() => void> = [];
afterEach(() => {
  while (CLEANUPS.length > 0) CLEANUPS.pop()!();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  CLEANUPS.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function twoStoredFingerprints(stateHome: string): Promise<[string, string]> {
  const orgHome = tempDir("operon-exp-org-");
  const base = {
    packageRoot: orgHome, // no package.json — version reads null, fine
    orgHome,
    app: { name: "alpha" },
    env: { node: "v26.0.0", platform: "darwin" },
  };
  const control = await computeSystemFingerprint({
    ...base,
    roles: { builder: { runtime: "claude", model: "claude-fable-5", effort: "high", maxTurnBudgetUsd: 10 } },
  });
  // Treatment differs only in the builder's effort — the intervention.
  const treatment = await computeSystemFingerprint({
    ...base,
    roles: { builder: { runtime: "claude", model: "claude-fable-5", effort: "medium", maxTurnBudgetUsd: 10 } },
  });
  await storeFingerprint(stateHome, control);
  await storeFingerprint(stateHome, treatment);
  return [control.fingerprint_id, treatment.fingerprint_id];
}

describe("validateExperimentRecord", () => {
  it("accepts the spec-shaped record and normalizes it", () => {
    const record = validateExperimentRecord(makeExperiment());
    expect(record.experiment_id).toBe("exp_builder-test-mapping_01");
    expect(record.primary_metric.expected_direction).toBe("decrease");
    expect(record.guardrails[1]).toEqual({ metric: "cost_usd", rule: "max_increase_pct", pct: 10 });
    expect(record.stop_thresholds?.rollback_immediately_if.below_control_pct).toBe(20);
  });

  it("rejects identical control and treatment fingerprints — two arms must differ", () => {
    expect(() =>
      validateExperimentRecord(
        makeExperiment({
          control: { fingerprint_ref: "sys_same" },
          treatment: { fingerprint_ref: "sys_same" },
        }),
      ),
    ).toThrow(/measure nothing/);
  });

  it("declared-before-results: a non-decided record cannot carry a result", () => {
    expect(() =>
      validateExperimentRecord(makeExperiment({ status: "declared", result: "eval_abc" })),
    ).toThrow(/declared-before-observed/);
    expect(() =>
      validateExperimentRecord(makeExperiment({ status: "running", result: "eval_abc" })),
    ).toThrow(/declared-before-observed/);
  });

  it("a decided record must carry its result ref", () => {
    expect(() => validateExperimentRecord(makeExperiment({ status: "decided" }))).toThrow(
      /requires a result ref/,
    );
  });

  it("percentage-bounded guardrails require pct; plain rules refuse it", () => {
    expect(() =>
      validateExperimentRecord(
        makeExperiment({ guardrails: [{ metric: "cost", rule: "max_increase_pct" }] }),
      ),
    ).toThrow(/pct must be a positive number/);
    expect(() =>
      validateExperimentRecord(
        makeExperiment({ guardrails: [{ metric: "cost", rule: "must_not_increase", pct: 5 }] }),
      ),
    ).toThrow(/only applies to percentage-bounded/);
  });

  it("rejects ids without the exp_ prefix", () => {
    expect(() => validateExperimentRecord(makeExperiment({ experiment_id: "expr-1" }))).toThrow(
      /must start with "exp_"/,
    );
  });
});

describe("declareExperiment", () => {
  it("declares against two stored fingerprints and reports the arm delta (done-criterion 1)", async () => {
    const orgHome = tempDir("operon-exp-org-");
    const stateHome = tempDir("operon-exp-state-");
    const [control, treatment] = await twoStoredFingerprints(stateHome);

    const declared = await declareExperiment(
      makeExperiment({
        control: { fingerprint_ref: control },
        treatment: { fingerprint_ref: treatment },
      }),
      { orgHome, stateHome },
    );

    expect(declared.record.status).toBe("declared");
    // The arms differ exactly in the intervention under test.
    expect(declared.arm_delta).toEqual(["models.builder.effort"]);
    expect(readFileSync(declared.path, "utf8")).toContain('"exp_builder-test-mapping_01"');
    expect(await readExperimentRecord(orgHome, "exp_builder-test-mapping_01")).toEqual(
      declared.record,
    );
    expect(declared.path).toBe(experimentPath(orgHome, "exp_builder-test-mapping_01"));
    expect(declared.path).toContain(join("learning", "experiments"));
  });

  it("refuses arms that are not in the fingerprint store", async () => {
    const orgHome = tempDir("operon-exp-org-");
    const stateHome = tempDir("operon-exp-state-");
    await expect(declareExperiment(makeExperiment(), { orgHome, stateHome })).rejects.toThrow(
      /not in the store/,
    );
  });

  it("declarations are immutable: identical re-declare is a no-op, edits refuse", async () => {
    const orgHome = tempDir("operon-exp-org-");
    await declareExperiment(makeExperiment(), { orgHome });
    await declareExperiment(makeExperiment(), { orgHome }); // idempotent
    await expect(
      declareExperiment(makeExperiment({ hypothesis: "revised after peeking at results" }), {
        orgHome,
      }),
    ).rejects.toThrow(/immutable/);
  });

  it("only status declared can be declared", async () => {
    const orgHome = tempDir("operon-exp-org-");
    await expect(
      declareExperiment(makeExperiment({ status: "running" }), { orgHome }),
    ).rejects.toThrow(/must be declared with status "declared"/);
  });
});

describe("markExperimentRunning", () => {
  it("walks declared → running idempotently and refuses re-running a decided experiment", async () => {
    const orgHome = tempDir("operon-exp-org-");
    await declareExperiment(makeExperiment(), { orgHome });
    expect((await markExperimentRunning(orgHome, "exp_builder-test-mapping_01")).status).toBe(
      "running",
    );
    expect((await markExperimentRunning(orgHome, "exp_builder-test-mapping_01")).status).toBe(
      "running",
    );
    expect((await listExperimentRecords(orgHome)).map((r) => r.status)).toEqual(["running"]);
  });
});

describe("fingerprintDelta via declare", () => {
  it("an unstored-arm check is skipped without a stateHome (pure declaration)", async () => {
    const orgHome = tempDir("operon-exp-org-");
    const declared = await declareExperiment(makeExperiment(), { orgHome });
    expect(declared.arm_delta).toBeNull();
  });
});
