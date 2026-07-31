import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { hashManifest, type CampaignManifest } from "../../scripts/eval/core.js";
import { reconcileRealtimeSoak, type RealtimeSoakStateEvidence } from "../../scripts/eval/soak-reconcile.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("I-LIVE-01 independently reconciles all 576 ticks, 12 terminal provider turns, settlements, and a distinct-process restart", async () => {
  const fixture = makeFixture();
  const result = await reconcileRealtimeSoak(fixture);
  expect(result).toMatchObject({ passed: true, provider_settlements: 12, duplicate_ticks: 0, silent_misses: 0, orphaned_runs: 0, orphaned_settlements: 0, distinct_process_restart: true, missing: [] });
  expect(result.receipt).toMatchObject({ evidence_kind: "soak-accounting", provider_turns: 12, provider_settlements: 12, mechanical_settlements: 0, terminal_integrity: 1, passed: true });
});

it("I-LIVE-01 retains duplicate ticks, missing settlement, orphan run, and same-process restart as invalid denominators", async () => {
  // Deliberately inject a malformed/duplicate tick (index 575 repeats tick 574,
  // and lacks due_at/recorded_at/reason) to prove the reconciler flags it.
  const duplicate = makeFixture(); duplicate.state.ticks[575] = { index: 575 } as RealtimeSoakStateEvidence["ticks"][number];
  expect((await reconcileRealtimeSoak(duplicate)).missing).toEqual(expect.arrayContaining(["soak_ticks", "soak_duplicate_ticks", "soak_silent_misses"]));

  const missingSettlement = makeFixture({ settlements: 11 });
  expect((await reconcileRealtimeSoak(missingSettlement)).missing).toContain("soak_provider_settlements");

  const orphan = makeFixture();
  const path = join(orphan.campaignRoot, "state/runs/service/orphan/envelope.json"); mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, "{}\n");
  expect((await reconcileRealtimeSoak(orphan)).missing).toContain("soak_orphaned_runs");

  const sameProcess = makeFixture(); sameProcess.state.restart.replacement_pid = sameProcess.state.restart.prior_pid;
  expect((await reconcileRealtimeSoak(sameProcess)).missing).toContain("soak_restart_receipt");

  const missingExit = makeFixture(); delete missingExit.state.restart.exit_requested_at;
  expect((await reconcileRealtimeSoak(missingExit)).missing).toContain("soak_restart_receipt");

  const missingContext = makeFixture();
  rmSync(join(missingContext.campaignRoot, "state/runs/service/run-1/context-manifest.json"));
  expect((await reconcileRealtimeSoak(missingContext)).missing).toContain("soak_context_manifests");

  const mechanicalSettlement = makeFixture();
  writeFileSync(join(mechanicalSettlement.campaignRoot, "state/telemetry/2026-07-15.jsonl"), `${JSON.stringify({ app: "service", runId: "mechanical-run" })}\n`);
  expect((await reconcileRealtimeSoak(mechanicalSettlement)).missing).toContain("soak_mechanical_settlements");

  const invalidSchedule = makeFixture(); invalidSchedule.state.ticks[0]!.due_at = "2026-07-14T00:06:00.000Z";
  expect((await reconcileRealtimeSoak(invalidSchedule)).missing).toContain("soak_ticks");
});

function makeFixture(options: { settlements?: number } = {}): { campaign: CampaignManifest; campaignSha256: string; campaignRoot: string; state: RealtimeSoakStateEvidence } {
  const campaignRoot = mkdtempSync(join(tmpdir(), "operon-soak-reconcile-")); roots.push(campaignRoot);
  const digest = `sha256:${"a".repeat(64)}`;
  const campaign: CampaignManifest = { schema_version: 1, campaign_id: "soak-fixture", purpose: "fixture", owner: "test", created_at: "2026-07-14T00:00:00.000Z", intent: "qualification", profile: "production-parity", soak: { duration_hours: 48, tick_interval_minutes: 5, useful_turn_cap: 12, deliberate_restart_hour: 24, requires_external_restart_receipt: true }, candidate: { commit: "fixture", package_sha256: digest, suite_sha256: digest }, org_fingerprint: digest, system_fingerprint: digest, cases: [{ case_id: "soak/realtime-48h/v1", repetition_ids: ["real-1"] }], assignments: [{ role: "sre", runtime: "codex", model: "fixture", effort: "medium", capability_ref: "codex/v1" }], price_catalog_id: "prices/2026-07-12-v1", randomization_seed: "fixture", github: { owner: "fixture", repo_pattern: "operon-eval-*" }, spend: { campaign_max_usd: 40, case_max_usd: { "soak/realtime-48h/v1": 40 } }, infrastructure_retries: 1, exclusions: [], stop_rules: ["hard_safety_violation"], operator_fixture: "operator-fixtures/fixture-v1.yaml", evidence_dir: ".eval-artifacts/soak-fixture" };
  const turns = Array.from({ length: 12 }, (_, index) => ({ run_id: `run-${index + 1}` }));
  for (const [index, turn] of turns.entries()) {
    const dir = join(campaignRoot, "state", "runs", "service", turn.run_id); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "envelope.json"), `${JSON.stringify({ schema_version: 1, run_id: turn.run_id, app: "service", status: "completed", provider_turn_ids: [`provider-${index + 1}`] })}\n`);
    writeFileSync(join(dir, "context-manifest.json"), `${JSON.stringify({ schema_version: 1, episode_id: `episode-${index + 1}`, app: "service", run_id: turn.run_id, route: "standard", render_sha256: "a".repeat(64), rendered_bytes: 100, components: [] })}\n`);
  }
  const telemetryDir = join(campaignRoot, "state", "telemetry"); mkdirSync(telemetryDir, { recursive: true });
  const settlements = options.settlements ?? 12;
  writeFileSync(join(telemetryDir, "2026-07-14.jsonl"), `${Array.from({ length: settlements }, (_, index) => JSON.stringify({ app: "service", runId: `run-${index + 1}`, providerTurnId: `provider-${index + 1}`, status: "completed", costUsd: 1, wallClockMs: 100, tokensIn: 10, tokensOut: 2, usageQuality: "complete" })).join("\n")}\n`);
  const startedAt = Date.parse("2026-07-14T00:00:00.000Z");
  const ticks = Array.from({ length: 576 }, (_, index) => { const tick = index + 1; const due = new Date(startedAt + index * 5 * 60_000).toISOString(); return { index: tick, due_at: due, recorded_at: due, reason: tick % 48 === 0 ? "useful_turn" as const : "not_useful_due" as const }; });
  const stateTurns = turns.map((turn, index) => ({ index: index + 1, tick_index: (index + 1) * 48, run_id: turn.run_id, cost_usd: 1, wall_clock_ms: 100, tokens_in: 10, tokens_out: 2, usage_quality: "complete", status: "completed" }));
  return { campaign, campaignSha256: hashManifest(campaign), campaignRoot, state: { started_at: "2026-07-14T00:00:00.000Z", ends_at: "2026-07-16T00:00:00.000Z", ticks, turns: stateTurns, restart: { due_at: "2026-07-15T00:00:00.000Z", prior_pid: 100, exit_requested_at: "2026-07-15T00:00:00.000Z", replacement_pid: 200, receipt_at: "2026-07-15T00:00:00.000Z" } } };
}
