// `operon new-app` greenfield bootstrap: create a product repo skeleton, emit
// app-owned `.operon/` artifacts, and register the app in an existing org home.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import { loadApps } from "../src/org/apps.js";
import { createNewApp } from "../src/org/new-app.js";

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

function makeOrgHome(): string {
  const root = makeDir("operon-new-app-org-");
  write(
    root,
    "apps.yaml",
    `schema_version: 1
org:
  name: operon
  max_concurrent_turns: 2
defaults:
  budget_usd_month: 1000
apps:
  alpha:
    repo: owner/alpha
    status: live
    cadence: {}
`,
  );
  return root;
}

describe("createNewApp", () => {
  it("scaffolds a greenfield app, bootstraps .operon, and registers channels", async () => {
    const orgHome = makeOrgHome();
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

    const apps = await loadApps(join(orgHome, "apps.yaml"));
    const app = apps.apps.find((candidate) => candidate.name === "marketplace");
    expect(app).toMatchObject({
      repo: "owner/marketplace",
      status: "onboarding",
      channels: { support: ["fixture-helpdesk"], marketing: ["launch-drafts"] },
    });
  });

  it("dry-run reports planned files without writing target or org files", async () => {
    const orgHome = makeOrgHome();
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
    expect(result.created).toContain("README.md");
    expect(result.created).toContain(".operon/config.yaml");
    expect(existsSync(targetDir)).toBe(false);
    expect(await readFile(join(orgHome, "apps.yaml"), "utf8")).toBe(before);
  });

  it("refuses to write into a non-empty target directory", async () => {
    const orgHome = makeOrgHome();
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
