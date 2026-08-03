#!/usr/bin/env node

// Reusable installed-product fixture. Everything lives under one temporary
// directory: no real user pointer, PATH entry, provider skill, org, state, or
// app repository is touched.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "cormidia-onboarding-smoke-"));
const home = join(root, "home");
const bin = join(root, "bin");
const codexHome = join(root, "codex");
const claudeHome = join(root, "claude");
const piHome = join(root, "pi");
const neutral = join(root, "neutral");
const orgHome = join(root, "org");
const stateHome = join(root, "state");
const app = join(root, "fixture-app");
const newApp = join(root, "greenfield-app");
const env = {
  ...process.env,
  HOME: home,
  CODEX_HOME: codexHome,
  CLAUDE_CONFIG_DIR: claudeHome,
  PI_CODING_AGENT_DIR: piHome,
  CORMIDIA_BIN_DIR: bin,
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
  const cormidia = join(bin, "cormidia");
  assert(existsSync(cormidia), "local binary link was not created");
  assert(existsSync(join(codexHome, "skills", "cormidia", "SKILL.md")), "Codex skill link was not created");
  assert(existsSync(join(claudeHome, "skills", "cormidia", "SKILL.md")), "Claude skill link was not created");
  assert(existsSync(join(piHome, "skills", "cormidia", "SKILL.md")), "pi skill link was not created");

  run(cormidia, ["--version"], neutral);
  const initPreview = JSON.parse(run(
    cormidia,
    ["org", "init", orgHome, "--name", "fixture-org", "--state-home", stateHome, "--dry-run", "--json"],
    neutral,
  ));
  assert(initPreview.status === "ready" && initPreview.executable === true, "org init dry-run was not executable");
  assert(initPreview.effects?.state_home?.action === "create", "org init dry-run omitted the state-home effect");
  assert(initPreview.effects?.active_pointer?.action === "create", "org init dry-run omitted the pointer effect");
  assert(initPreview.roles?.some((role) => role.name === "planner" && role.runtime && role.model && role.effort), "org init dry-run omitted the default role chart");
  assert(initPreview.effects?.generated_destinations?.some((entry) => entry.relative_path === "prompts/build/contract.md"), "org init dry-run omitted nested generated files");
  assert(!existsSync(orgHome), "org init dry-run created the org home");
  // The dry-run creates NO org: no org home, no active pointer. It does write
  // its invocation audit row, which is the documented audit exception every
  // command help epilogue states ("Preview/read-only/no-write claims exclude
  // this observability record") and which test/cli.test.ts pins. Assert the
  // state home holds only that record — the strong form of the original
  // "must not exist", which contradicted the audit contract added in 1b20244.
  const previewStateEntries = existsSync(stateHome) ? readdirSync(stateHome).sort() : [];
  assert(
    previewStateEntries.every((entry) => entry === "invocations" || entry === "state"),
    `org init dry-run wrote more than its audit row into the state home: ${previewStateEntries.join(", ")}`,
  );
  assert(!existsSync(join(home, ".cormidia", "config")), "org init dry-run wrote the active pointer");
  const initialized = run(
    cormidia,
    ["org", "init", orgHome, "--name", "fixture-org", "--state-home", stateHome],
    neutral,
  );
  assert(initialized.includes("Org home:"), "org init did not explain org home");
  assert(initialized.includes("State home:"), "org init did not explain state home");
  assert(initialized.includes("Automatic:"), "org init did not preview automatic authority");
  assert(initialized.includes("Human-gated:"), "org init did not preview gated authority");
  assert(existsSync(join(orgHome, "AUTHORITY.md")), "org init did not emit canonical authority");
  assert(readFileSync(join(orgHome, "AGENTS.md"), "utf8").includes("cormidia-authority:start"), "org Codex instructions lack authority");
  assert(readFileSync(join(orgHome, "CLAUDE.md"), "utf8").includes("cormidia-authority:start"), "org Claude instructions lack authority");

  await smokeObserver(cormidia, neutral);

  const scan = run(cormidia, ["bootstrap", app, "--scan-only"], neutral);
  assert(scan.includes("App repo:"), "bootstrap did not explain app repo");
  assert(scan.includes("Org home:"), "bootstrap did not explain org home");
  assert(scan.includes("State home:"), "bootstrap did not explain state home");
  assert(!existsSync(join(app, ".cormidia")), "scan-only wrote into the app repo");

  run(cormidia, ["bootstrap", app, "--answers", answers], neutral);
  assert(existsSync(join(app, ".cormidia", "config.yaml")), "full bootstrap did not emit app config");
  assert(existsSync(join(app, ".cormidia", "AUTHORITY.md")), "full bootstrap did not emit app authority");
  assert(readFileSync(join(app, "AGENTS.md"), "utf8").startsWith("# Existing agent rule\n"), "bootstrap replaced existing AGENTS.md content");
  assert(readFileSync(join(app, "AGENTS.md"), "utf8").includes("cormidia-authority:start"), "app Codex instructions lack authority");
  assert(readFileSync(join(app, "CLAUDE.md"), "utf8").startsWith("# Existing Claude rule\n"), "bootstrap replaced existing CLAUDE.md content");
  assert(!existsSync(join(app, ".cormidia", "org")), "bootstrap emitted the retired nested org profile");

  const context = JSON.parse(run(cormidia, ["context", "--json"], neutral));
  assert(context.orgHome === orgHome, "context resolved the wrong org home");
  assert(context.stateHome === stateHome, "context resolved the wrong state home");
  assert(context.authority?.version === "delegated-operator/v1", "context omitted the org authority version");
  assert(context.apps.some((entry) => entry.repo === "owner/fixture-app"), "onboarded app is absent from context");

  const capabilities = JSON.parse(run(cormidia, ["capabilities", "--json"], neutral));
  assert(capabilities.commands.some((entry) => entry.command === "bootstrap"), "bootstrap capability is absent");
  assert(capabilities.commands.some((entry) => entry.command === "observe" && entry.writes === false && entry.spendsTokens === false), "observe capability is absent or not read-only/token-free");
  assert(capabilities.commands.some((entry) => entry.command === "report" && entry.writes === false && entry.spendsTokens === false), "report capability is absent or not read-only/token-free");
  const reportJson = JSON.parse(run(cormidia, ["report", "--period", "7d", "--json"], neutral));
  assert(reportJson.schema_version === 1 && reportJson.scope.kind === "org", "report JSON contract is unavailable");
  const portableReport = join(root, "fixture-report.html");
  run(cormidia, ["report", "--period", "7d", "--html", portableReport], neutral);
  assert(existsSync(portableReport), "portable report was not written");
  assert(!readFileSync(portableReport, "utf8").includes("https://"), "portable report contains an external request");
  run(cormidia, ["doctor", "--json", "--config-only"], neutral);
  run(
    cormidia,
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
  run(process.execPath, [compiled, "doctor", "--json", "--config-only"], neutral);
  run(process.execPath, [compiled, "report", "--period", "7d", "--json"], neutral);

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

async function smokeObserver(command, cwd) {
  const child = spawn(command, ["observe", "--port", "0"], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const deadline = Date.now() + 10_000;
  let url;
  while (Date.now() < deadline) {
    const match = /^Cormidia observer: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)$/m.exec(stdout);
    if (match) {
      url = match[1];
      break;
    }
    if (child.exitCode !== null) throw new Error(`onboarding smoke: observer exited early: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert(url, `observer did not print a loopback capability URL: ${stderr}`);
  const health = new URL("/healthz", url);
  health.search = new URL(url).search;
  const response = await fetch(health, { cache: "no-store" });
  assert(response.ok, `observer health failed with ${response.status}`);
  assert(response.headers.get("cache-control")?.includes("no-store"), "observer health omitted no-store");
  const reports = new URL("/reports", url);
  reports.search = new URL(url).search;
  const reportPage = await fetch(reports, { cache: "no-store" });
  assert(reportPage.ok && (await reportPage.text()).includes("Cormidia Reports"), "observer Reports page failed");
  const summary = new URL("/api/v1/reports/summary?period=7d", url);
  summary.searchParams.set("token", new URL(url).searchParams.get("token"));
  const reportSummary = await fetch(summary, { cache: "no-store" });
  assert(reportSummary.ok && (await reportSummary.json()).schema_version === 1, "observer report API failed");
  child.kill("SIGTERM");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("onboarding smoke: observer did not stop")), 5_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`onboarding smoke: observer exit ${code}: ${stderr}`));
    });
  });
}
