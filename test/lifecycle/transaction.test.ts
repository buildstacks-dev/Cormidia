import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLifecycleWorld, recoverAnswers, runLifecycleReplay } from "../../scripts/eval/lifecycle-harness.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("LIFE-LEGACY-001 complete deterministic lifecycle transaction harness", () => {
  it("positive case executes the complete refusal/recovery/upgrade/bootstrap/verify/promote sequence with a provider tripwire", () => {
    const root = mkdtempSync(join(tmpdir(), "operon-life-")); roots.push(root);
    const result = runLifecycleReplay(createLifecycleWorld(root), () => { throw new Error("provider_tripwire_constructed"); });
    expect(result.refusal_blockers).toEqual(["pending_approval:eval-only", "stale_run:stale"]);
    expect(result).toMatchObject({ branch_refusal: "unreachable_onboarding_commit", second_app_unchanged: true, provider_constructions: 0, provider_settlements: 0, idempotent_rerun: true, readiness: { status: "ready", app_status: "live" } });
    expect(result.source_after).toBe(result.source_before);
    expect(result.source_git_after).toEqual(result.source_git_before);
    expect(result.source_git_after).toMatchObject({ branch: "human/topic", status: "?? untracked.txt\n" });
    expect(result.mechanical_steps.every((step) => step.terminal_records === 1 && step.provider_settlements === 0)).toBe(true);
  });
  it("near-miss case retains ordinary non-secret normalized answers", () => {
    const root = mkdtempSync(join(tmpdir(), "operon-life-")); roots.push(root);
    const world = createLifecycleWorld(root);
    const archive = join(world.archives, "manual"); mkdirSync(archive, { recursive: true });
    const body = '{"name":"sparse","setup_command":"npm test"}\n'; writeFileSync(join(archive, "answers.json"), body);
    const hash = createHash("sha256").update(body).digest("hex"); writeFileSync(join(archive, "manifest.json"), `${JSON.stringify({ answers_sha256: `sha256:${hash}` })}\n`);
    expect(recoverAnswers(archive)).toMatchObject({ name: "sparse" });
  });
  it("honest failure case rejects archive tampering and secret-like recovered answers", () => {
    const root = mkdtempSync(join(tmpdir(), "operon-life-")); roots.push(root);
    const world = createLifecycleWorld(root);
    const archive = join(world.archives, "tampered"); mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, "answers.json"), '{"api_key":"fake"}\n');
    writeFileSync(join(archive, "manifest.json"), `${JSON.stringify({ answers_sha256: `sha256:${"0".repeat(64)}` })}\n`);
    expect(() => recoverAnswers(archive)).toThrow("archive_checksum_mismatch");
    const secretBody = readFileSync(join(archive, "answers.json"));
    writeFileSync(join(archive, "manifest.json"), `${JSON.stringify({ answers_sha256: `sha256:${createHash("sha256").update(secretBody).digest("hex")}` })}\n`);
    expect(() => recoverAnswers(archive)).toThrow("secret_like_onboarding_answer_forbidden");
    expect(readFileSync(join(archive, "answers.json"), "utf8")).toContain("api_key");
  });
});
