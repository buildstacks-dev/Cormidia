// Tests the existing-org register/join path for bootstrap.
// Covers org-home discovery, appending to apps.yaml without disturbing existing
// entries, duplicate detection, rollback on malformed appends, and CLI output.
// Temp directories stand in for org homes and app repos; no network, auth, real
// org state, or wall-clock time is required.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { findExistingOrg, joinExistingOrg, loadApps } from "../src/org/apps.js";
import { bootstrapRun, registerAppWithExistingOrg } from "../src/org/bootstrap.js";
import { cmdBootstrap } from "../src/cli/bootstrap.js";

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
  const root = makeDir("operon-org-home-");
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

function makeAppRepo(slug = "owner/beta"): string {
  const root = makeDir("operon-app-");
  write(root, ".git/config", `[remote "origin"]\n\turl = git@github.com:${slug}.git\n`);
  write(root, "package.json", JSON.stringify({ name: slug.split("/")[1] ?? "app" }));
  return root;
}

const ANSWERS = {
  product: "A second sandbox app.",
  good: "It joins the existing org without forking config.",
  roles: ["planner", "builder"],
};

describe("findExistingOrg", () => {
  it("returns an explicit org home when present", async () => {
    const orgHome = makeOrgHome();
    await expect(findExistingOrg({ orgHome })).resolves.toBe(orgHome);
  });

  it("returns undefined when no env or pointer file is present", async () => {
    const home = makeDir("operon-no-pointer-");
    await expect(findExistingOrg({ env: {}, homeDir: home })).resolves.toBeUndefined();
  });

  it("reads a pointer file", async () => {
    const home = makeDir("operon-pointer-home-");
    const orgHome = makeOrgHome();
    write(home, ".operon/config", `org_home: ${orgHome}\n`);
    await expect(findExistingOrg({ env: {}, homeDir: home })).resolves.toBe(orgHome);
  });
});

describe("joinExistingOrg", () => {
  it("appends without altering existing entries", async () => {
    const orgHome = makeOrgHome();
    const before = await readFile(join(orgHome, "apps.yaml"), "utf8");
    const untouchedEntry = before.slice(before.indexOf("  alpha:"), before.length);

    const result = await joinExistingOrg(orgHome, {
      name: "beta",
      repo: "owner/beta",
      status: "onboarding",
      cadence: {},
    });

    expect(result.orgHome).toBe(orgHome);
    const after = await readFile(join(orgHome, "apps.yaml"), "utf8");
    expect(after).toContain(untouchedEntry);
    const file = await loadApps(join(orgHome, "apps.yaml"));
    expect(file.apps.map((a) => [a.name, a.repo, a.status])).toEqual([
      ["alpha", "owner/alpha", "live"],
      ["beta", "owner/beta", "onboarding"],
    ]);
  });

  it("rejects a duplicate repo slug", async () => {
    const orgHome = makeOrgHome();
    await expect(
      joinExistingOrg(orgHome, {
        name: "alpha-copy",
        repo: "owner/alpha",
        status: "onboarding",
      }),
    ).rejects.toThrow(/duplicate repo slugs/);
  });

  it("rolls back and throws when a non-canonical layout swallows the append", async () => {
    // Human-ratified apps.yaml with a top-level key AFTER apps:, so the
    // 2-space EOF append nests the new app under `defaults` instead of `apps`.
    const orgHome = makeDir("operon-noncanon-org-");
    const appsPath = join(orgHome, "apps.yaml");
    const before = `org:
  name: operon
  max_concurrent_turns: 2
apps:
  alpha:
    repo: owner/alpha
    status: live
    cadence: {}
defaults:
  budget_usd_month: 1000
`;
    writeFileSync(appsPath, before);

    await expect(
      joinExistingOrg(orgHome, { name: "beta", repo: "owner/beta", status: "onboarding" }),
    ).rejects.toThrow(/invalid registry; rolled back/);

    // The registry is restored to its exact prior bytes and still parses.
    expect(await readFile(appsPath, "utf8")).toBe(before);
    const file = await loadApps(appsPath);
    expect(file.apps.map((a) => a.name)).toEqual(["alpha"]);
  });
});

describe("bootstrap existing-org flow", () => {
  afterEach(() => vi.restoreAllMocks());

  it("register-only bootstrap joins the existing org", async () => {
    const orgHome = makeOrgHome();
    const app = makeAppRepo("owner/beta");

    const result = await registerAppWithExistingOrg(app, { orgHome });

    expect(result.joinedOrgHome).toBe(orgHome);
    expect(existsSync(join(app, ".operon"))).toBe(false);
    const file = await loadApps(join(orgHome, "apps.yaml"));
    expect(file.apps.map((a) => a.repo)).toEqual(["owner/alpha", "owner/beta"]);
    expect(file.apps[1]!.repo).toBe("owner/beta");
  });

  it("full bootstrap emits app artifacts only and joins the org registry", async () => {
    const orgHome = makeOrgHome();
    const app = makeAppRepo("owner/beta");

    const result = await bootstrapRun(app, ANSWERS, { orgHome });

    expect(result.joinedOrgHome).toBe(orgHome);
    expect(result.created).not.toContain(".operon/org/apps.yaml");
    expect(result.created).toContain(".operon/TASTE.md");
    expect(result.created).toContain(".operon/config.yaml");
    expect(result.created).toContain(".operon/policy.yaml");
    expect(result.created).toContain(".operon/onboarding-report.md");
    expect(existsSync(join(app, ".operon", "onboarding-report.md"))).toBe(true);
    expect(existsSync(join(app, ".operon", "org"))).toBe(false);

    const file = await loadApps(join(orgHome, "apps.yaml"));
    expect(file.apps.at(-1)).toMatchObject({
      repo: "owner/beta",
      status: "onboarding",
      budgetUsdMonth: 1000,
    });
  });

  it('CLI --org-home prints "joined existing org at"', async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const orgHome = makeOrgHome();
    const app = makeAppRepo("owner/beta");

    const code = await cmdBootstrap([app, "--org-home", orgHome]);

    expect(code).toBe(0);
    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain(`joined existing org at ${orgHome}`);
    const file = await loadApps(join(orgHome, "apps.yaml"));
    expect(file.apps.at(-1)!.repo).toBe("owner/beta");
  });
});
