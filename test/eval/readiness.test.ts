import { expect, it } from "vitest";
import type { RuntimeReadinessProbe } from "../../src/runtime/readiness.js";
import { CampaignReadinessError, checkCampaignReadiness } from "../../scripts/eval/readiness.js";
import type { CampaignManifest } from "../../scripts/eval/core.js";

it("J-MAN-01 live admission probes every distinct declared adapter/model without a billable turn", async () => {
  const calls: Array<{ runtime: string; models: string[] }> = [];
  const probe: RuntimeReadinessProbe = async (request) => { calls.push(request); return { runtime: request.runtime, models: request.models, status: "ready", detail: "fixture", durationMs: 1, billable: false }; };
  const results = await checkCampaignReadiness(campaign(), probe);
  expect(calls).toEqual([{ runtime: "claude", models: ["opus"] }, { runtime: "codex", models: ["gpt-a", "gpt-b"] }]);
  expect(results.every((result) => result.billable === false && result.status === "ready")).toBe(true);
});

it("J-MAN-02 missing adapter auth fails before campaign execution instead of becoming a green skip", async () => {
  const probe: RuntimeReadinessProbe = async (request) => ({ runtime: request.runtime, models: request.models, status: request.runtime === "codex" ? "unauthenticated" : "ready", detail: "fixture", durationMs: 1, billable: false });
  await expect(checkCampaignReadiness(campaign(), probe)).rejects.toEqual(expect.objectContaining<Partial<CampaignReadinessError>>({ name: "CampaignReadinessError", message: "campaign_adapter_readiness_failed: codex=unauthenticated" }));
});

function campaign(): CampaignManifest { const digest = `sha256:${"a".repeat(64)}`; return { schema_version: 1, campaign_id: "fixture", purpose: "fixture", owner: "test", created_at: "2026-07-12T00:00:00Z", intent: "non_qualification", candidate: { commit: "x", package_sha256: digest, suite_sha256: digest }, org_fingerprint: digest, system_fingerprint: digest, cases: [{ case_id: "quick/x/v1", repetition_ids: ["r1"] }], assignments: [{ role: "reviewer", runtime: "claude", model: "opus", effort: "low", capability_ref: "claude/v1" }, { role: "builder", runtime: "codex", model: "gpt-b", effort: "low", capability_ref: "codex/v1" }, { role: "planner", runtime: "codex", model: "gpt-a", effort: "low", capability_ref: "codex/v1" }], price_catalog_id: "prices/2026-07-12-v1", randomization_seed: "x", github: { owner: "x", repo_pattern: "operon-eval-*" }, spend: { campaign_max_usd: 1, case_max_usd: { "quick/x/v1": 1 } }, infrastructure_retries: 1, exclusions: [], stop_rules: ["safety"], operator_fixture: "x", evidence_dir: ".eval-artifacts/x" }; }
