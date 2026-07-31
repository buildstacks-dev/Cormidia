import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertEvalSeparation, assertGitHubTarget, assertLiveConfirmation, makeEvalActorGate } from "../../scripts/eval/safety.js";
import { evalAppNetworkPolicy, evalAppSandboxProfile, evalCommandEnv, runEvalAppGates } from "../../scripts/eval/app-gates.js";

describe("external eval safety", () => {
  it("accepts only exact private operon-eval targets", () => {
    expect(() => assertGitHubTarget({ owner: "acme", repo: "operon-eval-c1", isPrivate: true }, { owner: "acme", repo_pattern: "operon-eval-*" })).not.toThrow();
    expect(() => assertGitHubTarget({ owner: "other", repo: "operon-eval-c1", isPrivate: true }, { owner: "acme", repo_pattern: "operon-eval-*" })).toThrow("owner_not_allowlisted");
    expect(() => assertGitHubTarget({ owner: "acme", repo: "production", isPrivate: true }, { owner: "acme", repo_pattern: "operon-eval-*" })).toThrow("repo_not_allowlisted");
    expect(() => assertGitHubTarget({ owner: "acme", repo: "operon-eval-c1", isPrivate: false }, { owner: "acme", repo_pattern: "operon-eval-*" })).toThrow("must_be_private");
  });
  it("requires env, exact id, and a cap no larger than the manifest", () => {
    expect(() => assertLiveConfirmation({ envEnabled: true, campaignId: "c1", confirmedId: "c1", requestedMaxUsd: 10, manifestMaxUsd: 10 })).not.toThrow();
    expect(() => assertLiveConfirmation({ envEnabled: false, campaignId: "c1", confirmedId: "c1", requestedMaxUsd: 10, manifestMaxUsd: 10 })).toThrow("env_not_enabled");
    expect(() => assertLiveConfirmation({ envEnabled: true, campaignId: "c1", confirmedId: "wrong", requestedMaxUsd: 10, manifestMaxUsd: 10 })).toThrow("confirmation_mismatch");
    expect(() => assertLiveConfirmation({ envEnabled: true, campaignId: "c1", confirmedId: "c1", requestedMaxUsd: 11, manifestMaxUsd: 10 })).toThrow("cap_exceeds_manifest");
  });
  it("fails before execution when eval and active production paths overlap in either direction", () => {
    expect(() => assertEvalSeparation("/tmp/operon-eval/campaign", ["/tmp/operon-production"])).not.toThrow();
    expect(() => assertEvalSeparation("/tmp/operon-eval/campaign", ["/tmp/operon-eval"])).toThrow("production_path_overlap");
    expect(() => assertEvalSeparation("/tmp/operon-eval/campaign", ["/tmp/operon-eval/campaign/state"])).toThrow("production_path_overlap");
  });
  it("runs app gates without inheriting provider credentials or arbitrary host environment", () => {
    const root = mkdtempSync(join(tmpdir(), "operon-eval-app-gate-"));
    try {
      cpSync(join(process.cwd(), "eval/apps/library/seed"), root, { recursive: true });
      process.env.OPERON_EVAL_TEST_SECRET = "must-not-cross";
      const env = evalCommandEnv(root);
      expect(env.OPERON_EVAL_TEST_SECRET).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined(); expect(env.OPENAI_API_KEY).toBeUndefined();
      runEvalAppGates({ cwd: root, seedDir: join(process.cwd(), "eval/apps/library/seed"), commands: ["npm test", "npm run lint"] });
    } finally { delete process.env.OPERON_EVAL_TEST_SECRET; rmSync(root, { recursive: true, force: true }); }
  });
  it("keeps forbidden app gates network-dark and admits only loopback for service gates", () => {
    const forbidden = evalAppSandboxProfile("forbidden");
    expect(forbidden).toContain("(deny network*)");
    expect(forbidden).not.toContain("network-inbound");
    expect(forbidden).not.toContain("network-outbound");

    const loopback = evalAppSandboxProfile("loopback_only");
    expect(loopback).toContain("(deny network*)");
    expect(loopback).toContain('(allow network-inbound (local ip "localhost:*"))');
    expect(loopback).toContain('(allow network-outbound (remote ip "localhost:*"))');
    expect(evalAppNetworkPolicy("loopback_only")).toBe("loopback_only");
    expect(evalAppNetworkPolicy("provider_and_loopback_only")).toBe("loopback_only");
    expect(evalAppNetworkPolicy("forbidden")).toBe("forbidden");
    expect(evalAppNetworkPolicy("provider_only")).toBe("forbidden");

    const root = mkdtempSync(join(tmpdir(), "operon-eval-service-gate-"));
    try {
      const seed = join(process.cwd(), "eval/apps/service/seed");
      cpSync(seed, root, { recursive: true });
      runEvalAppGates({ cwd: root, seedDir: seed, commands: ["npm test", "npm run lint", "npm run e2e"], network: "loopback_only" });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("rejects provider-modified npm script definitions before invoking them", () => {
    const root = mkdtempSync(join(tmpdir(), "operon-eval-app-script-drift-"));
    try {
      const seed = join(process.cwd(), "eval/apps/library/seed"); cpSync(seed, root, { recursive: true });
      const path = join(root, "package.json"); const value = JSON.parse(readFileSync(path, "utf8")); value.scripts.test = "curl https://example.invalid"; writeFileSync(path, `${JSON.stringify(value)}\n`);
      expect(() => runEvalAppGates({ cwd: root, seedDir: seed, commands: ["npm test"] })).toThrow("eval_app_script_drift:test");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("denies model tools from reading paths outside the isolated worktree", () => {
    const root = mkdtempSync(join(tmpdir(), "operon-eval-actor-gate-"));
    try {
      const gate = makeEvalActorGate({ workdir: root, forbiddenRoots: [] });
      expect(gate({ tool: "bash", input: { command: "cat package.json" } }).allow).toBe(true);
      expect(gate({ tool: "bash", input: { command: "cat ~/.claude/settings.json" } })).toMatchObject({ allow: false, reason: expect.stringContaining("outside_worktree") });
      expect(gate({ tool: "bash", input: { command: "python /etc/passwd" } })).toMatchObject({ allow: false, reason: expect.stringContaining("outside_worktree") });
      expect(gate({ tool: "read", input: { path: "$HOME/.claude.json" } })).toMatchObject({ allow: false, reason: expect.stringContaining("outside_worktree") });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
