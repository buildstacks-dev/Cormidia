// `operon bootstrap` — non-interactive half (M3.3): scanRepo() learns a
// target repo (docs/architecture.md §9 step 1); emitOrgTemplates() emits the
// single-app-profile .operon/org/ skeleton (step 3) templated from this
// repo's root files (PURPOSE v0.8 dogfood note: the root TASTE.md/roles.yaml
// ARE the templates, so emission must be byte-identical).

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  emitOrgTemplates,
  scanRepo,
  ORG_TEMPLATE_FILES,
} from "../src/org/bootstrap.js";
import { loadApps } from "../src/org/apps.js";
import { cmdBootstrap } from "../src/cli/bootstrap.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

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

describe("emitOrgTemplates", () => {
  it("emitted org TASTE.md and roles.yaml are byte-identical to the repo root files", async () => {
    const target = makeRepo();
    const { created } = await emitOrgTemplates(target);

    expect(created).toEqual([...ORG_TEMPLATE_FILES]);
    for (const [rel, rootFile] of [
      [".operon/org/TASTE.md", "TASTE.md"],
      [".operon/org/roles.yaml", "roles.yaml"],
    ] as const) {
      const emitted = await readFile(join(target, rel), "utf8");
      const original = await readFile(join(REPO_ROOT, rootFile), "utf8");
      expect(emitted).toBe(original);
    }
  });

  it("emitted apps.yaml parses via loadApps and carries schema_version", async () => {
    const target = makeRepo();
    await emitOrgTemplates(target, {
      appName: "sandbox-alpha",
      repoSlug: "bikramgupta/operon-sandbox-alpha",
    });

    const file = await loadApps(join(target, ".operon", "org", "apps.yaml"));
    expect(file.schemaVersion).toBe(1);
    expect(file.org.name).toBe("sandbox-alpha");
    expect(file.apps).toHaveLength(1);
    expect(file.apps[0]!.name).toBe("sandbox-alpha");
    expect(file.apps[0]!.repo).toBe("bikramgupta/operon-sandbox-alpha");
    expect(file.apps[0]!.status).toBe("onboarding");
    expect(file.apps[0]!.cadence).toEqual({});
  });

  it("defaults the app name from the target basename and still parses", async () => {
    const target = makeRepo();
    await emitOrgTemplates(target);

    const file = await loadApps(join(target, ".operon", "org", "apps.yaml"));
    expect(file.schemaVersion).toBe(1);
    expect(file.apps[0]!.repo.startsWith("OWNER/")).toBe(true); // placeholder, marked TODO
  });

  it("refuses to overwrite an existing .operon/org file", async () => {
    const target = makeRepo({ ".operon/org/TASTE.md": "# already here\n" });
    await expect(emitOrgTemplates(target)).rejects.toThrow(/refusing to overwrite/);
    // Nothing else was written either — existence is checked before any write.
    expect(existsSync(join(target, ".operon", "org", "roles.yaml"))).toBe(false);
    expect(existsSync(join(target, ".operon", "org", "apps.yaml"))).toBe(false);
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
    for (const rel of ORG_TEMPLATE_FILES) expect(out).toContain(rel);
    expect(out).toContain(".operon/policy.yaml");
    expect(out).toContain("nothing written");
    expect(existsSync(join(target, ".operon"))).toBe(false);
  });

  it("without --scan-only emits the org skeleton using the scanned git slug", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const target = makeRepo(NODE_REPO_FILES);

    const code = await cmdBootstrap([target]);
    expect(code).toBe(0);

    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain("created:");
    for (const rel of ORG_TEMPLATE_FILES) {
      expect(existsSync(join(target, rel))).toBe(true);
    }
    const file = await loadApps(join(target, ".operon", "org", "apps.yaml"));
    expect(file.apps[0]!.repo).toBe("bikramgupta/operon-sandbox-alpha");
  });

  it("rejects an unknown flag", async () => {
    await expect(cmdBootstrap(["--bogus"])).rejects.toThrow(/unknown flag "--bogus"/);
  });
});
