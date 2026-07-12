#!/usr/bin/env node

// Reusable installed-product fixture. Everything lives under one temporary
// directory: no real user pointer, PATH entry, Codex skill, org, state, or app
// repository is touched.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "operon-onboarding-smoke-"));
const home = join(root, "home");
const bin = join(root, "bin");
const codexHome = join(root, "codex");
const neutral = join(root, "neutral");
const orgHome = join(root, "org");
const stateHome = join(root, "state");
const app = join(root, "fixture-app");
const newApp = join(root, "greenfield-app");
const env = {
  ...process.env,
  HOME: home,
  CODEX_HOME: codexHome,
  OPERON_BIN_DIR: bin,
  PATH: `${bin}:${process.env.PATH ?? ""}`,
};

try {
  mkdirSync(neutral, { recursive: true });
  write(app, "README.md", "# Fixture app\n");
  write(app, "AGENTS.md", "# Existing agent rule\n");
  write(app, "CLAUDE.md", "# Existing Claude rule\n");
  write(app, "package.json", `${JSON.stringify({ name: "fixture-app", scripts: { test: "node --test" } }, null, 2)}\n`);
  write(app, ".git/config", '[remote "origin"]\n\turl = git@github.com:owner/fixture-app.git\n');
  const answers = join(root, "answers.json");
  write(
    root,
    "answers.json",
    `${JSON.stringify(
      {
        product: "A disposable onboarding fixture.",
        good: "The installed command keeps package, org, state, and app paths separate.",
        roles: ["planner", "builder"],
      },
      null,
      2,
    )}\n`,
  );

  run(process.execPath, [join(packageRoot, "scripts", "link-local.mjs")], packageRoot);
  const operon = join(bin, "operon");
  assert(existsSync(operon), "local binary link was not created");
  assert(existsSync(join(codexHome, "skills", "operon", "SKILL.md")), "Operon skill link was not created");

  run(operon, ["--version"], neutral);
  const initialized = run(
    operon,
    ["org", "init", orgHome, "--name", "fixture-org", "--state-home", stateHome],
    neutral,
  );
  assert(initialized.includes("Org home:"), "org init did not explain org home");
  assert(initialized.includes("State home:"), "org init did not explain state home");
  assert(initialized.includes("Automatic:"), "org init did not preview automatic authority");
  assert(initialized.includes("Human-gated:"), "org init did not preview gated authority");
  assert(existsSync(join(orgHome, "AUTHORITY.md")), "org init did not emit canonical authority");
  assert(readFileSync(join(orgHome, "AGENTS.md"), "utf8").includes("operon-authority:start"), "org Codex instructions lack authority");
  assert(readFileSync(join(orgHome, "CLAUDE.md"), "utf8").includes("operon-authority:start"), "org Claude instructions lack authority");

  const scan = run(operon, ["bootstrap", app, "--scan-only"], neutral);
  assert(scan.includes("App repo:"), "bootstrap did not explain app repo");
  assert(scan.includes("Org home:"), "bootstrap did not explain org home");
  assert(scan.includes("State home:"), "bootstrap did not explain state home");
  assert(!existsSync(join(app, ".operon")), "scan-only wrote into the app repo");

  run(operon, ["bootstrap", app, "--answers", answers], neutral);
  assert(existsSync(join(app, ".operon", "config.yaml")), "full bootstrap did not emit app config");
  assert(existsSync(join(app, ".operon", "AUTHORITY.md")), "full bootstrap did not emit app authority");
  assert(readFileSync(join(app, "AGENTS.md"), "utf8").startsWith("# Existing agent rule\n"), "bootstrap replaced existing AGENTS.md content");
  assert(readFileSync(join(app, "AGENTS.md"), "utf8").includes("operon-authority:start"), "app Codex instructions lack authority");
  assert(readFileSync(join(app, "CLAUDE.md"), "utf8").startsWith("# Existing Claude rule\n"), "bootstrap replaced existing CLAUDE.md content");
  assert(!existsSync(join(app, ".operon", "org")), "bootstrap emitted the retired nested org profile");

  const context = JSON.parse(run(operon, ["context", "--json"], neutral));
  assert(context.orgHome === orgHome, "context resolved the wrong org home");
  assert(context.stateHome === stateHome, "context resolved the wrong state home");
  assert(context.authority?.version === "delegated-operator/v1", "context omitted the org authority version");
  assert(context.apps.some((entry) => entry.repo === "owner/fixture-app"), "onboarded app is absent from context");

  const capabilities = JSON.parse(run(operon, ["capabilities", "--json"], neutral));
  assert(capabilities.commands.some((entry) => entry.command === "bootstrap"), "bootstrap capability is absent");
  run(operon, ["doctor", "--json"], neutral);
  run(
    operon,
    [
      "new-app",
      "greenfield-app",
      "--target-dir",
      newApp,
      "--repo",
      "owner/greenfield-app",
      "--goal",
      "A disposable greenfield fixture.",
      "--dry-run",
    ],
    neutral,
  );
  assert(!existsSync(newApp), "new-app --dry-run wrote its target");

  const compiled = join(packageRoot, "dist", "cli.js");
  assert(existsSync(compiled), "compiled CLI is missing; run pnpm build first");
  run(process.execPath, [compiled, "context", "--json"], neutral);
  run(process.execPath, [compiled, "doctor", "--json"], neutral);

  console.log(`onboarding smoke: PASS (${root})`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

function write(rootDir, rel, content) {
  const path = join(rootDir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function assert(condition, message) {
  if (!condition) throw new Error(`onboarding smoke: ${message}`);
}
