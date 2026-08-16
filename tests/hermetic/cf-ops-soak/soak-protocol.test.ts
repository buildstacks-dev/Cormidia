// Traceability: CF-OPS-SOAK · HB-071 · risk-allocation.md §6 soak obligation (evidence protocol only).

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadApps } from "../../../src/org/apps.js";
import { makeTestClock } from "../../fixtures/clock.js";
import { makeTempOrgHome } from "../../fixtures/org-home.js";
import type { ValidationCampaignPolicyBinding } from "../../../src/org/validation-campaign-policy.js";
import { assertCampaignPolicyBindingBytes } from "../../campaign/policy-binding.js";
import {
  evaluateSoak,
  finishSoak,
  readSoakState,
  recordSoakCheckpoint,
  soakStatePath,
  startSoak,
  type SoakAdmission,
  type SoakCheckpointV1,
  type SoakConfigV1,
} from "../../ops/soak-protocol.js";

const revalidateAdmission = (): Promise<void> => Promise.resolve();

describe("CF-OPS-SOAK resumable evidence protocol", () => {
  it("stays incomplete until seven days, three real sleeps, and natural Codex rotation are all evidenced", async () => {
    const org = await makeTempOrgHome({ name: "soak-fixture" });
    try {
      const { policy, binding } = await policyFixture(org.root);
      const clock = makeTestClock("2026-07-01T08:00:00.000Z");
      const config = await configFor(org, policy, clock.nowIso());
      const admission = admissionFor(binding);
      let state = await startSoak(config, admission, clock.nowDate());
      expect(evaluateSoak(state, clock.nowDate()).collected_case_ids).toEqual([]);

      const sleeps: Array<[string, string]> = [
        ["2026-07-02T04:00:00.000Z", "2026-07-02T12:00:00.000Z"],
        ["2026-07-03T13:00:00.000Z", "2026-07-03T14:00:00.000Z"],
        ["2026-07-06T04:00:00.000Z", "2026-07-06T12:00:00.000Z"],
      ];
      for (const [index, sleep] of sleeps.entries()) {
        clock.set(sleep[1]);
        state = await recordSoakCheckpoint(
          config,
          checkpoint(`cp-${index}`, clock.nowIso(), sleep, index === 2),
          admission,
          clock.nowDate(),
        );
      }
      clock.set("2026-07-07T08:00:01.000Z");
      expect(evaluateSoak(state, clock.nowDate()).missing_reason_codes).toContain("soak_duration_incomplete");
      clock.set("2026-07-08T08:00:01.000Z");
      state = await recordSoakCheckpoint(
        config,
        checkpoint("cp-final", clock.nowIso(), undefined, false, true),
        admission,
        clock.nowDate(),
      );
      const blind = structuredClone(state);
      for (const item of blind.checkpoints) {
        item.source_health = item.source_health.map((source) =>
          source.id === "ledger" ? { ...source, status: "unavailable" } : source,
        );
      }
      expect(evaluateSoak(blind, clock.nowDate()).missing_reason_codes).toContain("source_health_incomplete");
      expect(evaluateSoak(blind, clock.nowDate()).collected_case_ids).not.toContain("CF-OPS-SOAK");
      const report = await finishSoak(config, admission, clock.nowDate());
      expect(report.outcome).toMatchObject({ completeness: "complete", verdict: "pass", violation_ids: [] });
      expect(report.coverage.missing_case_ids).toEqual([]);
      await expect(
        recordSoakCheckpoint(config, checkpoint("after-finish", clock.nowIso()), admission, clock.nowDate()),
      ).rejects.toThrow(/already completed/);
      await expect(finishSoak(config, admission, clock.nowDate())).rejects.toThrow(/finished twice/);
    } finally {
      await org.cleanup();
    }
  });

  it("negative control: sleep cannot manufacture permission or a green result", async () => {
    const org = await makeTempOrgHome({ name: "soak-negative" });
    try {
      const { policy, binding } = await policyFixture(org.root);
      const config = await configFor(org, policy, "2026-07-01T00:00:00.000Z");
      const revalidate = (): Promise<void> => assertCampaignPolicyBindingBytes(binding, org.root);
      const admission = admissionFor(binding, revalidate);
      await startSoak(config, admission, new Date("2026-07-01T00:00:00.000Z"));
      const seeded = checkpoint(
        "seeded",
        "2026-07-09T12:00:00.000Z",
        ["2026-07-08T04:00:00.000Z", "2026-07-08T12:00:00.000Z"],
        false,
      );
      seeded.human_decision_rows = 1;
      await recordSoakCheckpoint(config, seeded, admission);
      const report = await finishSoak(config, admission, new Date("2026-07-09T12:00:00.000Z"));
      expect(report.outcome.verdict).toBe("fail");
      expect(report.outcome.violation_ids).toContain("CF-OPS-SOAK:sleep_permission_delta");
      expect(report.outcome.completeness).toBe("incomplete");
    } finally {
      await org.cleanup();
    }
  });

  it("negative control: config or policy drift cannot rewrite a resumed campaign", async () => {
    const org = await makeTempOrgHome({ name: "soak-binding" });
    try {
      const { policy, binding } = await policyFixture(org.root);
      const config = await configFor(org, policy, "2026-07-01T00:00:00.000Z");
      const revalidate = (): Promise<void> => assertCampaignPolicyBindingBytes(binding, org.root);
      const admission = admissionFor(binding, revalidate);
      await startSoak(config, admission, new Date("2026-07-01T00:00:00.000Z"));
      const evidence = checkpoint("bound", "2026-07-02T00:00:00.000Z");
      const drifted = { ...config, human_authorization: { ...config.human_authorization, purpose: "widened later" } };
      await expect(recordSoakCheckpoint(drifted, evidence, admission)).rejects.toThrow(/config drifted/);
      await writeFile(policy, "schema_version: 2\n", "utf8");
      await expect(recordSoakCheckpoint(config, evidence, admission)).rejects.toThrow(/policy binding changed/);
    } finally {
      await org.cleanup();
    }
  });

  it("negative control: repository revalidation refuses a resumed checkpoint before persistence", async () => {
    const org = await makeTempOrgHome({ name: "soak-revalidation" });
    try {
      const { policy, binding } = await policyFixture(org.root);
      const config = await configFor(org, policy, "2026-07-01T00:00:00.000Z");
      let admitted = true;
      const revalidate = (): Promise<void> =>
        admitted ? Promise.resolve() : Promise.reject(new Error("campaign refused: checked-out HEAD changed"));
      const admission = admissionFor(binding, revalidate);
      await startSoak(config, admission, new Date("2026-07-01T00:00:00.000Z"));
      admitted = false;
      await expect(
        recordSoakCheckpoint(config, checkpoint("blocked", "2026-07-02T00:00:00.000Z"), admission),
      ).rejects.toThrow(/checked-out HEAD changed/);
    } finally {
      await org.cleanup();
    }
  });

  it("serializes concurrent checkpoints so no accepted violation is lost", async () => {
    const org = await makeTempOrgHome({ name: "soak-concurrent-checkpoint" });
    try {
      const { policy, binding } = await policyFixture(org.root);
      const config = await configFor(org, policy, "2026-07-01T00:00:00.000Z");
      const admission = admissionFor(binding);
      await startSoak(config, admission, new Date("2026-07-01T00:00:00.000Z"));
      const clean = checkpoint("concurrent-clean", "2026-07-02T00:00:00.000Z");
      const violating = checkpoint("concurrent-violation", "2026-07-02T00:00:01.000Z");
      violating.human_decision_rows = 1;
      const results = await Promise.allSettled([
        recordSoakCheckpoint(config, clean, admission),
        recordSoakCheckpoint(config, violating, admission),
      ]);
      const accepted = [clean.checkpoint_id, violating.checkpoint_id].filter(
        (_id, index) => results[index]?.status === "fulfilled",
      );
      const durable = await readSoakState(config.state_home, config.campaign_id);
      expect(durable.checkpoints.map((item) => item.checkpoint_id)).toEqual(expect.arrayContaining(accepted));
      expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    } finally {
      await org.cleanup();
    }
  });

  it("negative control: resumed state cannot replace the freshly admitted policy binding", async () => {
    const org = await makeTempOrgHome({ name: "soak-state-binding" });
    try {
      const { policy, binding } = await policyFixture(org.root);
      const config = await configFor(org, policy, "2026-07-01T00:00:00.000Z");
      const admission = admissionFor(binding);
      await startSoak(config, admission, new Date("2026-07-01T00:00:00.000Z"));
      const path = soakStatePath(config.state_home, config.campaign_id);
      const original = await readFile(path, "utf8");
      const checkpointRow = checkpoint("tamper", "2026-07-02T00:00:00.000Z");

      await writeFile(path, original.replace(binding.sha256, "c".repeat(64)), "utf8");
      await expect(recordSoakCheckpoint(config, checkpointRow, admission)).rejects.toThrow(/binding differs/);

      await writeFile(path, original.replace('"kind": "legacy"', '"kind": "model"'), "utf8");
      await expect(recordSoakCheckpoint(config, checkpointRow, admission)).rejects.toThrow(/exactly 8 entries/);

      const source = binding.validation_authority.sources[0];
      if (source === undefined) throw new Error("fixture authority source missing");
      await writeFile(path, original.replace(source.path, `../${source.path}`), "utf8");
      await expect(recordSoakCheckpoint(config, checkpointRow, admission)).rejects.toThrow(/is not validation-design/);
    } finally {
      await org.cleanup();
    }
  });

  it("negative control: string booleans and counters cannot enter resumed checkpoint evidence", async () => {
    const org = await makeTempOrgHome({ name: "soak-checkpoint-types" });
    try {
      const { policy, binding } = await policyFixture(org.root);
      const config = await configFor(org, policy, "2026-07-01T00:00:00.000Z");
      const admission = admissionFor(binding);
      await startSoak(config, admission, new Date("2026-07-01T00:00:00.000Z"));
      await recordSoakCheckpoint(config, checkpoint("typed", "2026-07-02T00:00:00.000Z"), admission);
      const path = soakStatePath(config.state_home, config.campaign_id);
      const original = await readFile(path, "utf8");

      await writeFile(path, original.replace('"measurement_valid": true', '"measurement_valid": "true"'), "utf8");
      await expect(readSoakState(config.state_home, config.campaign_id)).rejects.toThrow(/must be boolean/);

      await writeFile(path, original.replace('"completed_sweeps": 1', '"completed_sweeps": "1"'), "utf8");
      await expect(readSoakState(config.state_home, config.campaign_id)).rejects.toThrow(/non-negative finite number/);
    } finally {
      await org.cleanup();
    }
  });

  it("negative control: batch success and cache/recovery accounting cannot exceed their durable denominators", () => {
    const state = {
      schema_version: 2 as const,
      campaign_id: "soak-accounting",
      started_at: "2026-07-01T00:00:00.000Z",
      commit: "a".repeat(40),
      config_sha256: "b".repeat(64),
      policy_binding: fixturePolicyBinding(),
      timezone: "America/Los_Angeles",
      sandbox: { org: "fixture", apps: ["sandbox-app"], repos: ["fixture/sandbox-app"] },
      baseline: { provider_turns: 0, equiv_usd: 0, human_decision_rows: 0 },
      checkpoints: [checkpoint("seeded-accounting", "2026-07-09T12:00:00.000Z")],
    };
    state.checkpoints[0]!.roadmap_delivery = {
      ...state.checkpoints[0]!.roadmap_delivery,
      batches_observed: 1,
      batches_complete: 2,
      batches_every_unit_successful: 3,
      units_observed: 1,
      cache_evidence: { hit: 1, miss: 1, unknown: 0 },
    };
    expect(evaluateSoak(state, new Date("2026-07-09T12:00:00.000Z")).violation_ids).toEqual(
      expect.arrayContaining([
        "CF-OPS-SOAK:batch_completion_exceeds_observed",
        "CF-OPS-SOAK:batch_success_exceeds_completion",
        "CF-OPS-SOAK:cache_evidence_accounting_mismatch",
      ]),
    );
  });
});

async function configFor(
  org: Awaited<ReturnType<typeof makeTempOrgHome>>,
  policy: string,
  authorizedAt: string,
): Promise<SoakConfigV1> {
  await writeFile(
    join(org.orgHome, "apps.yaml"),
    [
      "schema_version: 1",
      `org: {name: ${org.orgName}, max_concurrent_turns: 2}`,
      "defaults: {budget_usd_month: 100}",
      "apps:",
      "  sandbox-app:",
      "    repo: fixture/sandbox-app",
      "    status: live",
      "    budget_usd_month: 100",
      "    cadence: {}",
      "    channels: {}",
      "",
    ].join("\n"),
    "utf8",
  );
  const apps = await loadApps(join(org.orgHome, "apps.yaml"));
  return {
    schema_version: 1,
    campaign_id: `soak-${org.orgName}`,
    human_authorization: {
      human_initiated: true,
      authorized_by: "fixture-human",
      authorized_at: authorizedAt,
      purpose: "fixture",
    },
    state_home: org.stateHome,
    org_home: org.orgHome,
    policy_path: policy,
    commit: "a".repeat(40),
    timezone: "America/Los_Angeles",
    sandbox: { org: org.orgName, apps: apps.apps.map((app) => app.name), repos: apps.apps.map((app) => app.repo) },
  };
}

async function policyFixture(root: string): Promise<{ policy: string; binding: ValidationCampaignPolicyBinding }> {
  const policy = join(root, "docs", "qualification", "host-policy.yaml");
  const legacy = join(root, "validation-design", "validation-policy.yaml");
  const hostBytes = "schema: cormidia/qualification-host-policy/v1\n";
  const legacyBytes = "schema_version: 1\n";
  await mkdir(dirname(policy), { recursive: true });
  await mkdir(dirname(legacy), { recursive: true });
  await writeFile(policy, hostBytes, "utf8");
  await writeFile(legacy, legacyBytes, "utf8");
  return {
    policy,
    binding: fixturePolicyBinding(digest(hostBytes), digest(legacyBytes)),
  };
}

function fixturePolicyBinding(
  hostDigest = "a".repeat(64),
  legacyDigest = "b".repeat(64),
): ValidationCampaignPolicyBinding {
  return {
    path: "docs/qualification/host-policy.yaml",
    sha256: hostDigest,
    validation_authority: {
      kind: "legacy",
      sources: [{ path: "validation-design/validation-policy.yaml", sha256: legacyDigest }],
    },
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function admissionFor(
  policyBinding: ValidationCampaignPolicyBinding,
  revalidate: SoakAdmission["revalidate"] = revalidateAdmission,
): SoakAdmission {
  return { policyBinding, revalidate };
}

function checkpoint(
  id: string,
  at: string,
  sleep?: [string, string],
  rotation = false,
  missed = false,
): SoakCheckpointV1 {
  return {
    checkpoint_id: id,
    captured_at: at,
    ...(sleep === undefined
      ? {}
      : {
          sleep_cycle: { slept_at: sleep[0], woke_at: sleep[1], overnight: localDay(sleep[0]) !== localDay(sleep[1]) },
        }),
    ...(rotation
      ? {
          rotation: {
            schema_version: 1,
            runtime: "codex",
            cause: "provider_auth_rotation",
            observed_without_injection: true,
            interrupted_at: "2026-07-06T02:00:00.000Z",
            resumed_at: "2026-07-06T02:05:00.000Z",
            session_id_before: "thread-rotation",
            session_id_after: "thread-rotation",
            checkpoint_before_sha256: "b".repeat(64),
            checkpoint_after_sha256: "b".repeat(64),
            evidence_refs: ["runs/sandbox/rotation/events.jsonl"],
          },
        }
      : {}),
    scheduler: {
      measurement_valid: true,
      reason_counts: { ...(missed ? { missed_window_reconciled: 1 } : {}) },
      duplicate_decisions: 0,
      duplicate_episodes: 0,
      orphaned_locks: 0,
      orphaned_journals: 0,
      orphaned_runs: 0,
      orphaned_settlements: 0,
      provider_settlement_agreement: true,
      active_locks: 0,
      wip_limit: 2,
    },
    spend: { provider_turns: 2, equiv_usd: 1, partial_usage_rows: 1 },
    state_growth: { files: 10, bytes: 1000 },
    retention: { completed_sweeps: 1, sweeps_with_errors: 0 },
    source_health: [
      { id: "local_files", status: "healthy" },
      { id: "approvals", status: "healthy" },
      { id: "ledger", status: "healthy" },
    ],
    roadmap_delivery: {
      batches_observed: 1,
      batches_complete: 1,
      batches_every_unit_successful: 0,
      units_observed: 2,
      stale_frontier_refusals: 1,
      session_reuse: { consider_exact_reuse: 1, rerun_without_session: 1, no_cross_unit_reuse: 0 },
      cache_evidence: { hit: 1, miss: 0, unknown: 1 },
      recovery_states: {
        not_started: 0,
        in_progress: 0,
        rerun_without_session: 1,
        consider_exact_session_reuse: 1,
        no_cross_unit_reuse: 0,
        terminal_completed: 0,
        terminal_returned: 0,
        terminal_failed: 0,
        unavailable: 0,
      },
    },
    human_decision_rows: 0,
  };
}

function localDay(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
