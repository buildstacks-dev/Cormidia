import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  prepareEvalProviderScratch,
  withEvalProviderEnvironment,
} from "../../scripts/eval/provider-scratch.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("stages provider auth under campaign scratch without copying personal context", async () => {
  const root = mkdtempSync(join(tmpdir(), "operon-provider-scratch-"));
  roots.push(root);
  const sourceHome = join(root, "source-home");
  const codex = join(root, "source-codex");
  const claude = join(root, "source-claude");
  const pi = join(root, "source-pi");
  for (const path of [sourceHome, codex, claude, pi]) mkdirSync(path, { recursive: true });
  writeFileSync(join(codex, "auth.json"), '{"tokens":"codex-secret"}\n');
  writeFileSync(join(codex, "config.toml"), 'developer_instructions="personal"\n');
  writeFileSync(join(claude, ".credentials.json"), '{"oauth":"claude-secret"}\n');
  writeFileSync(join(pi, "auth.json"), '{"anthropic":"pi-secret"}\n');
  writeFileSync(join(pi, "settings.json"), '{"theme":"personal"}\n');
  writeFileSync(
    join(sourceHome, ".claude.json"),
    JSON.stringify({
      hasCompletedOnboarding: true,
      oauthAccount: { organizationUuid: "fixture" },
      projects: { "/private/project": { instructions: "personal" } },
      customApiKeyResponses: { secret: true },
    }),
  );
  const campaignRoot = join(root, ".eval-artifacts", "campaign-fixture");
  const sourceEnv = {
    HOME: sourceHome,
    CODEX_HOME: codex,
    CLAUDE_CONFIG_DIR: claude,
    PI_CODING_AGENT_DIR: pi,
    PATH: process.env.PATH,
    SHELL: process.env.SHELL,
    ANTHROPIC_API_KEY: "must-not-leak",
    GH_TOKEN: "must-not-leak",
  };

  const scratch = prepareEvalProviderScratch(campaignRoot, sourceEnv);
  expect(readFileSync(join(scratch.codexHome, "auth.json"), "utf8")).toContain(
    "codex-secret",
  );
  expect(readFileSync(join(scratch.claudeConfigDir, ".credentials.json"), "utf8")).toContain(
    "claude-secret",
  );
  expect(readFileSync(join(scratch.piAgentDir, "auth.json"), "utf8")).toContain(
    "pi-secret",
  );
  const claudeState = readFileSync(join(scratch.claudeConfigDir, ".claude.json"), "utf8");
  expect(claudeState).toContain("oauthAccount");
  expect(claudeState).not.toContain("projects");
  expect(claudeState).not.toContain("customApiKeyResponses");
  expect(() => readFileSync(join(scratch.codexHome, "config.toml"), "utf8")).toThrow();
  expect(() => readFileSync(join(scratch.piAgentDir, "settings.json"), "utf8")).toThrow();
  expect(scratch.claudeProcessEnv.ANTHROPIC_API_KEY).toBeUndefined();
  expect(scratch.claudeProcessEnv.GH_TOKEN).toBeUndefined();
  expect(scratch.claudeProcessEnv.CLAUDE_CODE_SKIP_PROMPT_HISTORY).toBe("1");
  if (process.platform === "darwin") {
    expect(scratch.claudeProcessEnv.HOME).toBe(sourceHome);
    expect(scratch.claudeProcessEnv.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(scratch.claudeProtectedHome).toBe(sourceHome);
  } else {
    expect(scratch.claudeProcessEnv.HOME).toBe(scratch.home);
    expect(scratch.claudeProcessEnv.CLAUDE_CONFIG_DIR).toBe(scratch.claudeConfigDir);
    expect(scratch.claudeProtectedHome).toBeUndefined();
  }

  const originalHome = process.env.HOME;
  await withEvalProviderEnvironment(scratch.processEnv, async () => {
    expect(process.env.HOME).toBe(scratch.home);
    expect(process.env.CODEX_HOME).toBe(scratch.codexHome);
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(process.env.GH_TOKEN).toBeUndefined();
  });
  expect(process.env.HOME).toBe(originalHome);
});

it("preserves a token refreshed inside scratch instead of overwriting it from the host", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-provider-refresh-"));
  roots.push(root);
  const sourceHome = join(root, "home");
  const sourcePi = join(root, "pi");
  mkdirSync(sourceHome, { recursive: true });
  mkdirSync(sourcePi, { recursive: true });
  writeFileSync(join(sourcePi, "auth.json"), '{"refresh":"host-old"}\n');
  const campaignRoot = join(root, ".eval-artifacts", "campaign-refresh");
  const sourceEnv = { HOME: sourceHome, PI_CODING_AGENT_DIR: sourcePi, PATH: process.env.PATH };
  const first = prepareEvalProviderScratch(campaignRoot, sourceEnv);
  writeFileSync(join(first.piAgentDir, "auth.json"), '{"refresh":"scratch-rotated"}\n');

  prepareEvalProviderScratch(campaignRoot, sourceEnv);

  expect(readFileSync(join(first.piAgentDir, "auth.json"), "utf8")).toContain(
    "scratch-rotated",
  );
});
