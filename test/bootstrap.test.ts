// Tests the non-interactive bootstrap path in src/org/bootstrap.ts and the
// bootstrap CLI wrapper.
// Covers repo scanning, command/doc detection, and scan-only onboarding output.
// Uses synthetic temp repos plus repo-local template files; no network, auth,
// real org state, or wall-clock time is required.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { scanRepo } from "../src/org/bootstrap.js";
import { cmdBootstrap } from "../src/cli/bootstrap.js";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Write a file map (relative path -> content) into a fresh temp repo root. */
function makeRepo(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "operon-bootstrap-"));
  tempDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

const NODE_REPO_FILES: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "sandbox-alpha",
    packageManager: "pnpm@11.10.0",
    scripts: { build: "tsc", test: "node --test", lint: "eslint ." },
    devDependencies: { typescript: "^5.0.0" },
  }),
  "tsconfig.json": "{}",
  "README.md": "# Sandbox Alpha\n",
  "docs/architecture.md": "# Architecture\n",
  "docs/specs/api.md": "# API spec\n",
  "RUNBOOK.md": "# Runbook\n",
  "AGENTS.md": "# AGENTS\n",
  ".github/workflows/ci.yml": "on: push\njobs:\n  ci:\n    steps:\n      - run: pnpm test\n",
  Dockerfile: "FROM node:22\n",
  ".git/config": '[remote "origin"]\n\turl = git@github.com:bikramgupta/operon-sandbox-alpha.git\n',
};

describe("scanRepo", () => {
  it("scan detects package.json, CI workflow, and AGENTS.md in a fixture", async () => {
    const scan = await scanRepo(makeRepo(NODE_REPO_FILES));

    expect(scan.language).toBe("typescript");
    expect(scan.languageSource).toBe("tsconfig.json");
    expect(scan.packageManager).toBe("pnpm");
    expect(scan.build).toEqual({ command: "pnpm run build", source: "package.json scripts.build" });
    expect(scan.test).toEqual({ command: "pnpm run test", source: "package.json scripts.test" });
    expect(scan.lint).toEqual({ command: "pnpm run lint", source: "package.json scripts.lint" });
    expect(scan.agentDocs).toEqual(["AGENTS.md"]);
    expect(scan.ciConfigs).toEqual([join(".github", "workflows", "ci.yml")]);
    expect(scan.deployHints).toEqual(["Dockerfile"]);
    expect(scan.repoSlug).toBe("bikramgupta/operon-sandbox-alpha");
    expect(Object.fromEntries(scan.docInventory.map((c) => [c.id, c.paths]))).toMatchObject({
      "product/readme": ["README.md"],
      architecture: ["docs/architecture.md"],
      "specs/requirements": ["docs/specs/api.md"],
      "operations/runbook": ["RUNBOOK.md"],
      "agent/contributor": ["AGENTS.md"],
      "testing/quality": [join(".github", "workflows", "ci.yml"), "package.json"],
    });
  });

  it("reports absence cleanly on an empty repo", async () => {
    const scan = await scanRepo(makeRepo());

    expect(scan.language).toBeUndefined();
    expect(scan.packageManager).toBeUndefined();
    expect(scan.build).toBeUndefined();
    expect(scan.test).toBeUndefined();
    expect(scan.lint).toBeUndefined();
    expect(scan.agentDocs).toEqual([]);
    expect(scan.ciConfigs).toEqual([]);
    expect(scan.deployHints).toEqual([]);
    expect(scan.repoSlug).toBeUndefined();
    expect(scan.docInventory.every((category) => category.paths.length === 0)).toBe(true);
    expect(scan.docInventory.map((category) => category.id)).toEqual([
      "product/readme",
      "architecture",
      "specs/requirements",
      "operations/runbook",
      "agent/contributor",
      "testing/quality",
    ]);
  });

  it("falls back to CI for the test command when the manifest names none", async () => {
    const root = makeRepo({
      "package.json": JSON.stringify({ name: "no-scripts" }),
      ".github/workflows/checks.yaml":
        "jobs:\n  test:\n    steps:\n      - run: echo hello\n      - run: npm test -- --ci\n",
    });
    const scan = await scanRepo(root);
    expect(scan.test).toEqual({
      command: "npm test -- --ci",
      source: join(".github", "workflows", "checks.yaml"),
    });
  });

  it("parses an https origin remote into owner/repo", async () => {
    const root = makeRepo({
      ".git/config": '[remote "origin"]\n\turl = https://github.com/owner/some-repo.git\n',
    });
    const scan = await scanRepo(root);
    expect(scan.repoSlug).toBe("owner/some-repo");
  });
});

describe("cmdBootstrap", () => {
  afterEach(() => vi.restoreAllMocks());

  it("--scan-only prints the profile and would-create list without writing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const target = makeRepo(NODE_REPO_FILES);

    const code = await cmdBootstrap(["--scan-only", target]);
    expect(code).toBe(0);

    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain(`bootstrap scan: ${target}`);
    expect(out).toContain("typescript");
    expect(out).toContain("would create:");
    expect(out).toContain("docs:");
    expect(out).toContain("doc gaps:");
    expect(out).toContain("full bootstrap creates .operon/onboarding-report.md");
    expect(out).toContain("initialize an org first");
    expect(out).toContain(".operon/policy.yaml");
    expect(out).toContain(".operon/onboarding-report.md");
    expect(out).toContain("nothing written");
    expect(existsSync(join(target, ".operon"))).toBe(false);
  });

  it("without an active org fails before writing", async () => {
    const target = makeRepo(NODE_REPO_FILES);
    await expect(cmdBootstrap([target])).rejects.toThrow(/no active org home/);
    expect(existsSync(join(target, ".operon"))).toBe(false);
  });

  it("rejects a GitHub URL before writing", async () => {
    await expect(
      cmdBootstrap(["https://github.com/buildstacks-dev/buildstacks.dev"]),
    ).rejects.toThrow(/expects a local repository path/);
  });

  it("rejects an unknown flag", async () => {
    await expect(cmdBootstrap(["--bogus"])).rejects.toThrow(/unknown flag "--bogus"/);
  });
});
