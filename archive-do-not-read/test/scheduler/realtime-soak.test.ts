import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { validateCampaign, type CampaignManifest } from "../../scripts/eval/core.js";
import { loadYamlFile } from "../../scripts/eval/core.js";
import { withSoakLock } from "../../scripts/eval/soak-lock.js";

it("I-LIVE-01 positive: previews a runnable 48-hour isolated schedule with bounded useful turns and a declared restart", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/eval/soak.ts", "--campaign", "eval/campaigns/realtime-soak.yaml"], { cwd: process.cwd(), encoding: "utf8" });
  expect(JSON.parse(output)).toMatchObject({ mode: "preview", schedule: { duration_hours: 48, useful_turn_cap: 12, deliberate_restart_hour: 24 }, restart_protocol: expect.stringContaining("distinct process") });
});

it("I-LIVE-01 near-miss: accepts the upper 72-hour boundary but rejects an out-of-window restart", () => {
  const campaign = structuredClone(loadYamlFile("eval/campaigns/realtime-soak.yaml")) as CampaignManifest;
  campaign.soak = { ...campaign.soak!, duration_hours: 72, deliberate_restart_hour: 71 };
  expect(validateCampaign(campaign)).toEqual([]);
  campaign.soak.deliberate_restart_hour = 72;
  expect(validateCampaign(campaign)).toContain("soak.deliberate_restart_hour must precede duration_hours");
});

it("I-LIVE-01 honest failure: execute cannot create state without the environment switch, exact id, and explicit cap", () => {
  const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/eval/soak.ts", "--campaign", "eval/campaigns/realtime-soak.yaml", "--execute", "--max-usd", "40", "--confirm", "realtime-soak-v1"], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, OPERON_EVAL_SOAK: "0" } });
  expect(run.status).not.toBe(0);
  expect(`${run.stdout}${run.stderr}`).toContain("live_eval_env_not_enabled");
});

it("I-LIVE-01 atomically excludes a concurrent tick and releases the lock after work", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-soak-lock-")); const lock = join(root, "tick.lock");
  try {
    await withSoakLock(lock, async () => { await expect(withSoakLock(lock, () => undefined)).rejects.toThrow(`soak_tick_locked:${process.pid}`); });
    await expect(withSoakLock(lock, () => "released")).resolves.toBe("released");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("I-LIVE-01 recovers a dead owner but fails closed for corrupt lock evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-soak-lock-stale-")); const lock = join(root, "tick.lock");
  try {
    mkdirSync(lock); writeFileSync(join(lock, "owner.json"), '{"schema_version":1,"pid":999999,"acquired_at":"2026-07-12T00:00:00.000Z"}\n');
    await expect(withSoakLock(lock, () => "recovered", { processAlive: () => false })).resolves.toBe("recovered");
    mkdirSync(lock); writeFileSync(join(lock, "owner.json"), "not-json\n");
    await expect(withSoakLock(lock, () => undefined)).rejects.toThrow("soak_lock_corrupt");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
