// Tests greenfield app creation in src/org/new-app.ts.
// Covers scaffolded product files, app-owned .operon artifacts, setup/test/lint
// commands, channel registration, dry-run reporting, and non-empty target refusal.
// Uses temp target/org directories only; no network, auth, real org state, or
// wall-clock time is required.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import { gateCommandsForWorktree, loadGateCommands } from "../src/loop/driver.js";
import { runLintGate, runTestsGate } from "../src/loop/qgates.js";
import { loadApps } from "../src/org/apps.js";
import { createNewApp } from "../src/org/new-app.js";
import { initOrgHome } from "../src/org/home.js";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function write(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

async function makeOrgHome(): Promise<string> {
  const parent = makeDir("operon-new-app-org-");
  const root = join(parent, "org");
  await initOrgHome({ target: root, name: "operon", homeDir: makeDir("operon-new-app-home-") });
  return root;
}

describe("createNewApp", () => {
  it("scaffolds a greenfield app, bootstraps .operon, and registers channels", async () => {
    const orgHome = await makeOrgHome();
    const parent = makeDir("operon-new-app-parent-");
    const targetDir = join(parent, "marketplace");

    const result = await createNewApp({
      appName: "marketplace",
      targetDir,
      repoSlug: "owner/marketplace",
      goal: "A marketplace for dummy products with buyers, vendors, support, and launch notes.",
      orgHome,
      supportChannels: ["fixture-helpdesk"],
      marketingChannels: ["launch-drafts"],
    });

    expect(result.dryRun).toBe(false);
    expect(result.template).toBe("typescript-node");
    expect(result.qualityGates).toMatchObject({
      status: "configured",
      setupCommand: "npm install",
      testCommand: "npm test",
      lintCommand: "npm run lint",
    });
    expect(result.created).toContain("docs/VISION.md");
    expect(result.created).toContain("docs/REQUIREMENTS.md");
    expect(result.created).toContain(".operon/TASTE.md");
    expect(result.created).toContain(".operon/bootstrap/initial-issue.md");
    expect(result.updated).toContain(".operon/config.yaml");
    expect(result.updated).toContain(`${orgHome}/apps.yaml`);

    expect(existsSync(join(targetDir, "package.json"))).toBe(true);
    expect(existsSync(join(targetDir, "src", "domain.ts"))).toBe(true);
    expect(existsSync(join(targetDir, ".operon", "planning", "0001-greenfield-seed.md"))).toBe(true);

    const config = parse(await readFile(join(targetDir, ".operon", "config.yaml"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(config["setup_command"]).toBe("npm install");
    expect(config["test_command"]).toBe("npm test");
    expect(config["lint_command"]).toBe("npm run lint");

    const packageJson = JSON.parse(await readFile(join(targetDir, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.scripts).toEqual({
      build: "tsc",
      test: "npm run build && node --test dist/test/domain.test.js",
      lint: "node scripts/lint.mjs",
      start: "npm run build && node scripts/server.mjs",
    });
    expect(packageJson.devDependencies).toMatchObject({ typescript: "^5.7.0" });

    const apps = await loadApps(join(orgHome, "apps.yaml"));
    const app = apps.apps.find((candidate) => candidate.name === "marketplace");
    expect(app).toMatchObject({
      repo: "owner/marketplace",
      status: "onboarding",
      channels: { support: ["fixture-helpdesk"], marketing: ["launch-drafts"] },
    });
  });

  it("emits a stack-neutral bare scaffold whose required gates stay pending", async () => {
    const orgHome = await makeOrgHome();
    const targetDir = join(makeDir("operon-new-app-bare-parent-"), "bare-product");

    const result = await createNewApp({
      appName: "bare-product",
      targetDir,
      repoSlug: "owner/bare-product",
      goal: "Publish a content-rich product site from a separately reviewed design.",
      template: "bare",
      orgHome,
    });

    expect(result.template).toBe("bare");
    expect(result.qualityGates).toMatchObject({
      status: "pending",
      setupCommand: null,
      testCommand: null,
      lintCommand: null,
    });
    expect(result.qualityGates.detail).toContain(
      "Run only the generated stack-and-gates establishment issue through the loop first",
    );
    expect(result.qualityGates.detail).toContain("verification and promotion remain blocked");
    expect(result.created).toEqual(expect.arrayContaining([
      ".gitignore",
      "AGENTS.md",
      "README.md",
      "docs/VISION.md",
      "docs/REQUIREMENTS.md",
      "docs/ARCHITECTURE.md",
      "docs/RUNBOOK.md",
      "docs/TESTING.md",
      ".operon/config.yaml",
      ".operon/bootstrap/initial-issue.md",
    ]));
    expect(result.created).not.toEqual(expect.arrayContaining([
      "package.json",
      "tsconfig.json",
      "index.html",
      "styles.css",
      "src/domain.ts",
      "src/client.ts",
      "test/domain.test.ts",
      "scripts/lint.mjs",
      "scripts/server.mjs",
    ]));

    for (const rel of [
      "package.json",
      "tsconfig.json",
      "index.html",
      "styles.css",
      "src",
      "test",
      "scripts",
    ]) {
      expect(existsSync(join(targetDir, rel)), rel).toBe(false);
    }

    const configText = await readFile(join(targetDir, ".operon", "config.yaml"), "utf8");
    const config = parse(configText) as Record<string, unknown>;
    expect(config).not.toHaveProperty("setup_command");
    expect(config).not.toHaveProperty("test_command");
    expect(config).not.toHaveProperty("lint_command");
    expect(configText).toContain("Quality gates for the bare template are intentionally pending");
    expect(configText).toContain("fail closed");
    const gateCommands = loadGateCommands(targetDir);
    expect(gateCommands).toEqual({});
    await expect(runTestsGate(targetDir, gateCommands)).resolves.toMatchObject({
      gate: "tests",
      status: "fail",
    });
    await expect(runLintGate(targetDir, gateCommands)).resolves.toMatchObject({
      gate: "lint",
      status: "fail",
    });

    const controlledGuidance = await Promise.all([
      "AGENTS.md",
      "README.md",
      "docs/REQUIREMENTS.md",
      "docs/ARCHITECTURE.md",
      "docs/RUNBOOK.md",
      "docs/TESTING.md",
      ".operon/LABELS.md",
      ".operon/bootstrap/initial-issue.md",
      ".operon/bootstrap/next-commands.md",
      ".operon/planning/0001-greenfield-seed.md",
    ].map((rel) => readFile(join(targetDir, rel), "utf8")));
    const guidance = controlledGuidance.join("\n");
    expect(guidance).not.toContain("npm test");
    expect(guidance).not.toContain("npm run lint");
    expect(guidance).not.toContain("src/domain.ts");
    expect(guidance).toContain("meaningful stack-specific");
    expect(guidance).toContain("siblings of `apps`");
    expect(guidance).toContain("never under `apps.<name>`");
    expect(guidance).toContain("do not assert indentation with a text regex");
    expect(guidance).toContain("did not infer a stack from the goal");
    expect(guidance).toContain("Keep it as the only ready product-work issue until it");
    expect(guidance).toContain("Do not run `operon app verify` or `operon app promote` before that issue");

    // The safe first-ticket path is real, not merely prose: the loop keeps the
    // initially empty command set, then reloads the Builder worktree before
    // gates. Simulate that first implementation adding observable checks.
    write(targetDir, "product.txt", "first slice\n");
    write(targetDir, "docs/ARCHITECTURE.md", "# Architecture\n\nFixture stack selected.\n");
    writeFileSync(
      join(targetDir, ".operon", "config.yaml"),
      `${configText}\ntest_command: test "$(cat product.txt)" = "first slice"\n` +
        'lint_command: grep -q "Fixture stack selected" docs/ARCHITECTURE.md\n',
    );
    const firstImplementationCommands = gateCommandsForWorktree(gateCommands, targetDir);
    expect(firstImplementationCommands).toMatchObject({
      testCommand: 'test "$(cat product.txt)" = "first slice"',
      lintCommand: 'grep -q "Fixture stack selected" docs/ARCHITECTURE.md',
    });
    await expect(runTestsGate(targetDir, firstImplementationCommands)).resolves.toMatchObject({
      gate: "tests",
      status: "pass",
    });
    await expect(runLintGate(targetDir, firstImplementationCommands)).resolves.toMatchObject({
      gate: "lint",
      status: "pass",
    });
  });

  it("dry-run reports planned files without writing target or org files", async () => {
    const orgHome = await makeOrgHome();
    const before = await readFile(join(orgHome, "apps.yaml"), "utf8");
    const targetDir = join(makeDir("operon-new-app-dry-parent-"), "dry-marketplace");

    const result = await createNewApp({
      appName: "dry-marketplace",
      targetDir,
      repoSlug: "owner/dry-marketplace",
      goal: "A dry run marketplace.",
      orgHome,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.template).toBe("typescript-node");
    expect(result.created).toContain("README.md");
    expect(result.created).toContain(".operon/config.yaml");
    expect(existsSync(targetDir)).toBe(false);
    expect(await readFile(join(orgHome, "apps.yaml"), "utf8")).toBe(before);
  });

  it("does not infer a template from framework language in the goal", async () => {
    const orgHome = await makeOrgHome();
    const targetDir = join(makeDir("operon-new-app-no-inference-parent-"), "astro-site");

    const result = await createNewApp({
      appName: "astro-site",
      targetDir,
      repoSlug: "owner/astro-site",
      goal: "Build an Astro site with pnpm, MDX collections, and Shiki.",
      orgHome,
      dryRun: true,
    });

    expect(result.template).toBe("typescript-node");
    expect(result.created).toContain("package.json");
    expect(result.created).toContain("src/domain.ts");
    expect(existsSync(targetDir)).toBe(false);
  });

  it("refuses to write into a non-empty target directory", async () => {
    const orgHome = await makeOrgHome();
    const targetDir = makeDir("operon-new-app-nonempty-");
    write(targetDir, "README.md", "already here");

    await expect(
      createNewApp({
        appName: "taken",
        targetDir,
        repoSlug: "owner/taken",
        goal: "Should not overwrite existing work.",
        orgHome,
      }),
    ).rejects.toThrow(/already exists and is not empty/);
  });
});
