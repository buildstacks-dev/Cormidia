import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, expect, it } from "vitest";
import type { RoleConfig, Runtime, TurnHooks, TurnRequest, TurnResult } from "../../src/runtime/types.js";
import { defaultGate } from "../../src/runtime/gate.js";
import { executeLiveCampaign, gradeLiveCase } from "../../scripts/eval/live-executor.js";
import { makeEvalRoleGate } from "../../scripts/eval/safety.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("D-LIVE-01 provider product episodes use Operon's durable executor, settle every turn once, and resume immutable results", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-provider-workflow-")); roots.push(root);
  cpSync(join(process.cwd(), "eval"), join(root, "eval"), { recursive: true });
  const campaign = {
    schema_version: 1, campaign_id: "workflow-fixture", purpose: "fixture", owner: "test", created_at: "2026-07-12T00:00:00.000Z", intent: "non_qualification",
    candidate: { commit: "fixture", package_sha256: `sha256:${"a".repeat(64)}`, suite_sha256: `sha256:${"b".repeat(64)}` }, org_fingerprint: `sha256:${"c".repeat(64)}`, system_fingerprint: `sha256:${"d".repeat(64)}`,
    cases: [{ case_id: "quick/ignore-config/v1", repetition_ids: ["q1"] }],
    assignments: [{ role: "builder", runtime: "codex", model: "fixture", effort: "low", capability_ref: "codex/v1" }, { role: "reviewer", runtime: "claude", model: "fixture", effort: "low", capability_ref: "claude/v1" }],
    price_catalog_id: "prices/2026-07-12-v1", randomization_seed: "fixture", github: { owner: "fixture", repo_pattern: "operon-eval-*" }, spend: { campaign_max_usd: 10, case_max_usd: { "quick/ignore-config/v1": 5 } }, infrastructure_retries: 1, exclusions: [], stop_rules: ["hard_safety_violation"], operator_fixture: "fixture/v1", evidence_dir: ".eval-artifacts/workflow-fixture",
  };
  const manifestPath = join(root, "campaign.yaml"); writeFileSync(manifestPath, stringify(campaign));
  let calls = 0;
  const runtimeFactory = (role: RoleConfig): Runtime => ({
    kind: role.runtime,
    runTurn: async (request: TurnRequest, hooks: TurnHooks): Promise<TurnResult> => {
      calls += 1;
      if (calls === 1) writeFileSync(join(request.workdir, "eval-contract.md"), "- [ ] binary fixture criterion\n");
      if (calls === 2) writeFileSync(join(request.workdir, "implementation.txt"), "implemented\n");
      hooks.onProgress?.({ session: { runtime: role.runtime, id: `${role.name}-${calls}` }, usage: usage() });
      return { status: "completed", summary: "fixture", artifacts: [], session: { runtime: role.runtime, id: `${role.name}-${calls}` }, usage: usage(), escalations: [] };
    },
  });
  const options = { root, manifestPath, maxUsd: 10, evalRoot: join(root, ".eval-artifacts/workflow-fixture/world"), runtimeFactory, hiddenGrader: () => true };
  const first = await executeLiveCampaign(options);
  expect(first.attempts[0]).toMatchObject({ outcome: "passed", metrics: { execution: { provider_turns: 3, provider_settlements: 3, mechanical_settlements: 0 } } });
  expect(first.attempts[0]).toMatchObject({ metrics: { productivity: { productive_passes: 3, total_passes: 3, ratio: 1, repeated_work_cost_usd: 0 } } });
  expect(first.attempts[0]?.evidence.filter((ref) => ref.startsWith("run:"))).toHaveLength(3);
  expect(ledgerRows(join(root, ".eval-artifacts/workflow-fixture/state/telemetry"))).toHaveLength(3);
  expect(calls).toBe(3);

  const resumed = await executeLiveCampaign(options);
  expect(resumed.attempts).toEqual(first.attempts);
  expect(calls).toBe(3);
  expect(ledgerRows(join(root, ".eval-artifacts/workflow-fixture/state/telemetry"))).toHaveLength(3);
});

it("B-MET-02 uses verifier-owned worktree fingerprints and charges unchanged completed work as repeated", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-provider-productivity-")); roots.push(root); cpSync(join(process.cwd(), "eval"), join(root, "eval"), { recursive: true });
  const campaign = { ...fixtureCampaign("productivity-fixture"), infrastructure_retries: 0 }; const manifestPath = join(root, "campaign.yaml"); writeFileSync(manifestPath, stringify(campaign));
  const result = await executeLiveCampaign({ root, manifestPath, maxUsd: 10, evalRoot: join(root, ".eval-artifacts/productivity-fixture/world"), visibleGate: () => true, hiddenGrader: () => true, runtimeFactory: (role) => ({ kind: role.runtime, runTurn: async () => ({ status: "completed", summary: "unchanged agent claim", artifacts: [], session: { runtime: role.runtime, id: role.name }, usage: usage(), escalations: [] }) }) });
  expect(result.attempts[0]).toMatchObject({ outcome: "passed", metrics: { productivity: { productive_passes: 1, total_passes: 3, ratio: 1 / 3, repeated_work_cost_usd: 0.02 } } });
  const evidence = ((result.attempts[0]!.metrics.productivity as Record<string, unknown>).evidence as Array<Record<string, unknown>>);
  expect(evidence.map((item) => item.productive)).toEqual([false, false, true]);
  expect(evidence[0]?.before_sha256).toBe(evidence[0]?.after_sha256);
});

it("J-STAT-02 retains a typed infrastructure failure and links its one declared retry instead of replacing the attempt", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-provider-retry-")); roots.push(root);
  cpSync(join(process.cwd(), "eval"), join(root, "eval"), { recursive: true });
  const campaign = fixtureCampaign("retry-fixture");
  const manifestPath = join(root, "campaign.yaml"); writeFileSync(manifestPath, stringify(campaign));
  let calls = 0;
  const runtimeFactory = (role: RoleConfig): Runtime => ({ kind: role.runtime, runTurn: async (): Promise<TurnResult> => { calls += 1; if (calls === 1) throw new Error("provider transport disconnected"); return { status: "completed", summary: "fixture", artifacts: [], session: { runtime: role.runtime, id: `${role.name}-${calls}` }, usage: usage(), escalations: [] }; } });
  const result = await executeLiveCampaign({ root, manifestPath, maxUsd: 10, evalRoot: join(root, ".eval-artifacts/retry-fixture/world"), runtimeFactory, hiddenGrader: () => true });
  expect(result.attempts).toHaveLength(2);
  expect(result.attempts[0]).toMatchObject({ attempt_id: "quick-ignore-config-v1-q1", outcome: "infra_invalid" });
  expect(result.attempts[0]?.evidence).toContain("artifact:errors/quick-ignore-config-v1-q1.json");
  expect(JSON.parse(readFileSync(join(root, ".eval-artifacts/retry-fixture/errors/quick-ignore-config-v1-q1.json"), "utf8"))).toMatchObject({
    attempt_id: "quick-ignore-config-v1-q1",
    detail: expect.stringContaining("provider transport disconnected"),
  });
  expect(result.attempts[1]).toMatchObject({ attempt_id: "quick-ignore-config-v1-q1-retry-1", retry_of: "quick-ignore-config-v1-q1", outcome: "passed" });
  expect(calls).toBe(4);
  expect(ledgerRows(join(root, ".eval-artifacts/retry-fixture/state/telemetry"))).toHaveLength(4);
});

it("A-SPEC-03 a non-completed delivery contract settles once and prevents implementation and review", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-provider-contract-stop-")); roots.push(root); cpSync(join(process.cwd(), "eval"), join(root, "eval"), { recursive: true });
  const campaign = { ...fixtureCampaign("contract-stop-fixture"), infrastructure_retries: 0 };
  const manifestPath = join(root, "campaign.yaml"); writeFileSync(manifestPath, stringify(campaign)); const roles: string[] = [];
  const result = await executeLiveCampaign({ root, manifestPath, maxUsd: 10, evalRoot: join(root, ".eval-artifacts/contract-stop-fixture/world"), visibleGate: () => true, hiddenGrader: () => true, runtimeFactory: (role) => ({ kind: role.runtime, runTurn: async () => { roles.push(role.name); return { status: "blocked_on_gate", summary: "contract stopped at approval boundary", artifacts: [], session: { runtime: role.runtime, id: "contract" }, usage: usage(), escalations: [{ action: "publish", reason: "approval required" }] }; } }) });
  expect(roles).toEqual(["builder"]);
  expect(result.attempts[0]).toMatchObject({ outcome: "safety_stop", metrics: { execution: { provider_turns: 1, provider_settlements: 1 } } });
  expect(result.attempts[0]?.evidence.filter((ref) => ref.startsWith("run:"))).toHaveLength(1);
  expect(ledgerRows(join(root, ".eval-artifacts/contract-stop-fixture/state/telemetry"))).toHaveLength(1);
});

it("I-SOAK-03 qualification executes the seven-day virtual soak mechanically with zero runtime construction or provider settlement", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-provider-virtual-")); roots.push(root); cpSync(join(process.cwd(), "eval"), join(root, "eval"), { recursive: true });
  const campaign = { ...fixtureCampaign("virtual-fixture"), cases: [{ case_id: "soak/virtual-seven-day/v1", repetition_ids: ["virtual-1"] }], spend: { campaign_max_usd: 1, case_max_usd: { "soak/virtual-seven-day/v1": 1 } } };
  const manifestPath = join(root, "campaign.yaml"); writeFileSync(manifestPath, stringify(campaign));
  const result = await executeLiveCampaign({ root, manifestPath, maxUsd: 1, evalRoot: join(root, ".eval-artifacts/virtual-fixture/world"), runtimeFactory: () => { throw new Error("provider_tripwire"); } });
  expect(result.attempts[0]).toMatchObject({ outcome: "passed", metrics: { execution: { provider_turns: 0, provider_settlements: 0, mechanical_steps: 2016, mechanical_settlements: 0 } } });
  expect(result.product_cost_usd).toBe(0);
});

it("I-ROLE-02 standing-role provider cases invoke the declared Support role through the ordinary pass executor", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-provider-role-")); roots.push(root); cpSync(join(process.cwd(), "eval"), join(root, "eval"), { recursive: true });
  const base = fixtureCampaign("role-fixture");
  const campaign = { ...base, cases: [{ case_id: "roles/standing/v1", repetition_ids: ["support-1"] }], assignments: [{ role: "support", runtime: "pi", model: "fixture", effort: "low", capability_ref: "pi/v1" }], spend: { campaign_max_usd: 5, case_max_usd: { "roles/standing/v1": 5 } } };
  const manifestPath = join(root, "campaign.yaml"); writeFileSync(manifestPath, stringify(campaign)); const roles: string[] = [];
  const result = await executeLiveCampaign({ root, manifestPath, maxUsd: 5, evalRoot: join(root, ".eval-artifacts/role-fixture/world"), runtimeFactory: (role) => ({ kind: role.runtime, runTurn: async () => { roles.push(role.name); return { status: "completed", summary: "fixture", artifacts: [], session: { runtime: role.runtime, id: "support" }, usage: usage(), escalations: [] }; } }), visibleGate: () => true, hiddenGrader: () => true });
  expect(roles).toEqual(["support"]);
  expect(result.attempts[0]).toMatchObject({ outcome: "passed", metrics: { execution: { provider_turns: 1, provider_settlements: 1 } } });
});

it("F-CONT-04 sampled live continuation performs a real cancellation checkpoint and a separately settled recovery pass", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-provider-continuation-")); roots.push(root); cpSync(join(process.cwd(), "eval"), join(root, "eval"), { recursive: true });
  const base = fixtureCampaign("continuation-fixture"); const campaign = { ...base, cases: [{ case_id: "continuation/matrix/v1", repetition_ids: ["mixed-iq"] }], spend: { campaign_max_usd: 10, case_max_usd: { "continuation/matrix/v1": 10 } } };
  const manifestPath = join(root, "campaign.yaml"); writeFileSync(manifestPath, stringify(campaign)); let calls = 0;
  const result = await executeLiveCampaign({ root, manifestPath, maxUsd: 10, evalRoot: join(root, ".eval-artifacts/continuation-fixture/world"), visibleGate: () => true, hiddenGrader: () => true, runtimeFactory: (role) => ({ kind: role.runtime, runTurn: async (request, hooks) => { calls += 1; if (calls === 1) { hooks.onProgress?.({ session: { runtime: role.runtime, id: "interrupted" }, usage: { ...usage(), quality: "partial" } }); return { status: request.signal?.aborted ? "cancelled" : "completed", summary: "interrupted", artifacts: [], session: { runtime: role.runtime, id: "interrupted" }, usage: { ...usage(), quality: "partial" }, escalations: [] }; } return { status: "completed", summary: "recovered", artifacts: [], session: { runtime: role.runtime, id: "recovery" }, usage: usage(), escalations: [] }; } }) });
  expect(result.attempts[0]).toMatchObject({ outcome: "passed", metrics: { execution: { provider_turns: 2, provider_settlements: 2 } } }); expect(result.attempts[0]?.evidence.filter((ref) => ref.startsWith("run:"))).toHaveLength(2); expect(calls).toBe(2);
});

it("J-GRADE-01 dispatches every evidence-backed live benchmark to its calibrated hidden grader", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-live-grader-dispatch-")); roots.push(root);
  for (const [caseId, grader] of [
    ["planning/quality/v1", "plan-quality"],
    ["context/delta/v1", "context-delta"],
    ["continuation/matrix/v1", "continuation"],
    ["approval/semantics/v1", "approval-semantics"],
    ["learning/closure/v1", "learning-closure"],
    ["roles/standing/v1", "standing-roles"],
  ] as const) {
    cpSync(join(process.cwd(), "eval/graders", grader, "reference/grader-evidence.json"), join(root, "grader-evidence.json"));
    expect(await gradeLiveCase(caseId, root), caseId).toBe(true);
  }
  writeFileSync(join(root, "grader-evidence.json"), "{}\n");
  expect(await gradeLiveCase("approval/semantics/v1", root)).toBe(false);
  expect(await gradeLiveCase("unknown/not-real/v1", root)).toBe(false);

  cpSync(join(process.cwd(), "eval/apps/service/seed"), join(root, "broken-service"), { recursive: true });
  writeFileSync(join(root, "broken-service/src/auth.js"), "export const unrelated = true;\n");
  await expect(gradeLiveCase("deep/auth-migration/v1", join(root, "broken-service"))).resolves.toBe(false);
});

it("G-SHAPE-01 flat-denies role-forbidden acts without an approval request while preserving other roles' ordinary gate", () => {
  const action = { tool: "bash", input: { command: "gh pr merge 7 --squash" } };
  expect(makeEvalRoleGate("builder", defaultGate)(action)).toMatchObject({ allow: false, escalate: false, reason: expect.stringContaining("self-merge-or-approve") });
  expect(makeEvalRoleGate("reviewer", defaultGate)(action)).toMatchObject({ allow: false, escalate: false });
  expect(makeEvalRoleGate("sre", defaultGate)(action)).toMatchObject({ allow: false, escalate: true });
});

it("J-MAN-02 refuses a manifest/hash race before constructing any runtime", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-provider-hash-race-")); roots.push(root); cpSync(join(process.cwd(), "eval"), join(root, "eval"), { recursive: true }); const campaign = fixtureCampaign("hash-race-fixture"); const manifestPath = join(root, "campaign.yaml"); writeFileSync(manifestPath, stringify(campaign)); let constructions = 0;
  await expect(executeLiveCampaign({ root, manifestPath, maxUsd: 10, evalRoot: join(root, ".eval-artifacts/hash-race-fixture/world"), expectedCampaignSha256: `sha256:${"0".repeat(64)}`, runtimeFactory: () => { constructions += 1; throw new Error("runtime_tripwire"); } })).rejects.toThrow("campaign_hash_changed_before_execution");
  expect(constructions).toBe(0);
});

function usage() { return { tokensIn: 10, tokensOut: 2, costUsd: 0.01, subagentTurns: 0, wallClockMs: 5, quality: "complete" as const }; }
function ledgerRows(root: string): unknown[] { return readdirSync(root).flatMap((name) => readFileSync(join(root, name), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))); }
function fixtureCampaign(id: string) { return { schema_version: 1, campaign_id: id, purpose: "fixture", owner: "test", created_at: "2026-07-12T00:00:00.000Z", intent: "non_qualification", candidate: { commit: "fixture", package_sha256: `sha256:${"a".repeat(64)}`, suite_sha256: `sha256:${"b".repeat(64)}` }, org_fingerprint: `sha256:${"c".repeat(64)}`, system_fingerprint: `sha256:${"d".repeat(64)}`, cases: [{ case_id: "quick/ignore-config/v1", repetition_ids: ["q1"] }], assignments: [{ role: "builder", runtime: "codex", model: "fixture", effort: "low", capability_ref: "codex/v1" }, { role: "reviewer", runtime: "claude", model: "fixture", effort: "low", capability_ref: "claude/v1" }], price_catalog_id: "prices/2026-07-12-v1", randomization_seed: "fixture", github: { owner: "fixture", repo_pattern: "operon-eval-*" }, spend: { campaign_max_usd: 10, case_max_usd: { "quick/ignore-config/v1": 5 } }, infrastructure_retries: 1, exclusions: [], stop_rules: ["hard_safety_violation"], operator_fixture: "fixture/v1", evidence_dir: `.eval-artifacts/${id}` } as const; }
