// `operon bootstrap publish` (#61): coordinated draft-PR publication of the
// artifacts `operon bootstrap` wrote.
//
// The acceptance criteria this file pins, one describe block each:
//  - only bootstrap-owned changes are staged, never unrelated worktree content
//  - ambiguous or unsafe publication scope refuses instead of guessing
//  - pull requests are opened as DRAFTS and never merged or marked ready
//  - preview mutates nothing, in either repo or on GitHub
//  - retries are idempotent
//
// Real git, zero network: GitHub is the injected FakeGhOps, and "origin" is a
// local bare repo.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  executeBootstrapPublish,
  planBootstrapPublish,
} from "../src/org/bootstrap-publish.js";
import { FakeGhOps } from "./support/fakeGhOps.js";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "Operon Fixture",
  GIT_AUTHOR_EMAIL: "fixture@operon.invalid",
  GIT_COMMITTER_NAME: "Operon Fixture",
  GIT_COMMITTER_EMAIL: "fixture@operon.invalid",
  GIT_TERMINAL_PROMPT: "0",
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
}

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

/** A checkout backed by a real local bare origin, on `defaultBranch`. */
function makeRepo(prefix: string, defaultBranch = "main"): string {
  const host = makeDir(prefix);
  const bare = join(host, "origin.git");
  execFileSync("git", ["init", "--bare", `--initial-branch=${defaultBranch}`, bare], {
    env: GIT_ENV,
  });
  const work = join(host, "work");
  execFileSync("git", ["clone", bare, work], { env: GIT_ENV });
  // Repo-local identity, because `bootstrap publish` commits as the OPERATOR:
  // its git calls inherit the ambient environment rather than forcing an
  // Operon author. A real checkout has this configured; a CI runner does not,
  // so the fixture must supply it the same way a real one would.
  execFileSync("git", ["config", "user.email", "fixture@operon.invalid"], { cwd: work });
  execFileSync("git", ["config", "user.name", "Operon Fixture"], { cwd: work });
  write(work, "README.md", "# app\n");
  git(work, ["add", "-A"]);
  git(work, ["commit", "-m", "initial"]);
  git(work, ["push", "-u", "origin", defaultBranch]);
  return work;
}

const ROLES_YAML = `roles:
  planner:
    runtime: claude
    model: claude-opus-4-8
    effort: high
  builder:
    runtime: claude
    model: claude-opus-4-8
    effort: high
`;

function appsYaml(app: string, repo: string): string {
  return `org: {name: operon, max_concurrent_turns: 2}
defaults: {budget_usd_month: 1000}
apps:
  ${app}:
    repo: ${repo}
    status: onboarding
    cadence: {}
`;
}

/** An org home + app checkout with bootstrap's output present but unpublished
 *  — the exact state `operon bootstrap` leaves behind. */
function fixture(options: { defaultBranch?: string; orgIsGit?: boolean } = {}) {
  const defaultBranch = options.defaultBranch ?? "main";
  const app = "alpha";
  const repoSlug = "owner/alpha";

  const orgHome = options.orgIsGit === false ? makeDir("operon-pub-org-") : makeRepo("operon-pub-org-", defaultBranch);
  write(orgHome, "roles.yaml", ROLES_YAML);
  write(orgHome, "TASTE.md", "# Org Taste\n");
  write(orgHome, "apps.yaml", appsYaml(app, repoSlug));
  if (options.orgIsGit !== false) {
    // roles.yaml/TASTE.md are pre-existing org content; only apps.yaml is the
    // pending bootstrap-owned change. Pushed, because publish branches are cut
    // from the remote tip — shared org config lives on the remote.
    git(orgHome, ["add", "roles.yaml", "TASTE.md"]);
    git(orgHome, ["commit", "-m", "chore: org config"]);
    git(orgHome, ["push", "origin", defaultBranch]);
  }

  const appDir = makeRepo("operon-pub-app-", defaultBranch);
  for (const [rel, body] of Object.entries(bootstrapOutput())) write(appDir, rel, body);

  return { app, repoSlug, orgHome, appDir, defaultBranch };
}

function bootstrapOutput(): Record<string, string> {
  return {
    ".operon/TASTE.md": "# App Charter\n",
    ".operon/AUTHORITY.md": "# Authority\n",
    ".operon/config.yaml": "app: alpha\n",
    ".operon/policy.yaml": "riskTiers: {}\n",
    ".operon/onboarding-report.md": "# Onboarding\n",
    ".operon/memory/planner/INDEX.md": "# planner memory\n",
    ".operon/memory/builder/INDEX.md": "# builder memory\n",
    "AGENTS.md": "# AGENTS\n\nAuthority: .operon/AUTHORITY.md\n",
  };
}

function planFor(f: ReturnType<typeof fixture>, gh?: FakeGhOps) {
  return planBootstrapPublish({
    app: f.app,
    orgHome: f.orgHome,
    appDir: f.appDir,
    ...(gh !== undefined ? { gh } : {}),
  });
}

describe("bootstrap publish — scope", () => {
  it("stages only bootstrap-owned paths, never unrelated worktree content", async () => {
    const f = fixture();
    // Unrelated work in progress, both tracked and untracked. A publish that
    // swept these into the onboarding commit is the defect #61 guards against.
    write(f.appDir, "README.md", "# app\n\nlocal edit nobody asked to publish\n");
    write(f.appDir, "src/feature.ts", "export const wip = true;\n");
    write(f.appDir, "notes.txt", "scratch\n");

    const plan = await planFor(f);

    expect(plan.blockers).toEqual([]);
    const appRepo = plan.repos.find((r) => r.kind === "app");
    expect(appRepo).toBeDefined();
    expect(appRepo!.files).toEqual([
      ".operon/AUTHORITY.md",
      ".operon/TASTE.md",
      ".operon/config.yaml",
      ".operon/memory/builder/INDEX.md",
      ".operon/memory/planner/INDEX.md",
      ".operon/onboarding-report.md",
      ".operon/policy.yaml",
      "AGENTS.md",
    ]);
    expect(appRepo!.files).not.toContain("README.md");
    expect(appRepo!.files).not.toContain("src/feature.ts");
    expect(appRepo!.files).not.toContain("notes.txt");

    const gh = new FakeGhOps({ repo: f.repoSlug, issues: [] });
    await executeBootstrapPublish(plan, { app: f.app, orgHome: f.orgHome, appDir: f.appDir, gh });

    // The commit contains exactly the bootstrap-owned files...
    const committed = git(f.appDir, ["show", "--name-only", "--format=", "HEAD"])
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(committed).toEqual(appRepo!.files);

    // ...and the operator's unrelated work is untouched in the worktree.
    expect(readFileSync(join(f.appDir, "README.md"), "utf8")).toContain("local edit");
    expect(existsSync(join(f.appDir, "src/feature.ts"))).toBe(true);
    expect(existsSync(join(f.appDir, "notes.txt"))).toBe(true);
  });

  it("publishes the org registry change separately from the app repo", async () => {
    const f = fixture();
    const plan = await planFor(f);

    const orgRepo = plan.repos.find((r) => r.kind === "org");
    expect(orgRepo).toBeDefined();
    // Only apps.yaml — never roles.yaml or TASTE.md, which bootstrap does not own.
    expect(orgRepo!.files).toEqual(["apps.yaml"]);
    // The org side is a local review surface; only the app repo opens a PR
    // against a GitHub slug.
    expect(orgRepo!.pr).toBeUndefined();
    expect(plan.repos.find((r) => r.kind === "app")!.pr?.repo).toBe(f.repoSlug);
  });

  it("cuts branches from each remote's resolved default branch, not an assumed main", async () => {
    // Ties #61 to the #101 root cause: publishing onto a hardcoded `main`
    // would fail outright in a `master` org.
    const f = fixture({ defaultBranch: "master" });
    const plan = await planFor(f);

    expect(plan.blockers).toEqual([]);
    for (const repo of plan.repos) {
      expect(repo.base).toEqual({ ref: "origin/master", defaultBranch: "master" });
    }

    const gh = new FakeGhOps({ repo: f.repoSlug, issues: [] });
    await executeBootstrapPublish(plan, { app: f.app, orgHome: f.orgHome, appDir: f.appDir, gh });
    expect(gh.calls.filter((c) => c.op === "createPR").length).toBe(1);
    expect((await gh.readPR(1)).baseRefName).toBe("master");
  });

  it("skips a non-git org home rather than failing the app publish", async () => {
    const f = fixture({ orgIsGit: false });
    const plan = await planFor(f);

    expect(plan.blockers).toEqual([]);
    expect(plan.repos.map((r) => r.kind)).toEqual(["app"]);
  });
});

describe("bootstrap publish — refuses ambiguous or unsafe scope", () => {
  it("refuses when unrelated changes are already staged", async () => {
    const f = fixture();
    write(f.appDir, "src/feature.ts", "export const wip = true;\n");
    git(f.appDir, ["add", "src/feature.ts"]);

    const plan = await planFor(f);

    expect(plan.blockers.join("\n")).toMatch(/unrelated staged changes/i);
    expect(plan.blockers.join("\n")).toContain("src/feature.ts");
    // And the recovery step is actually named.
    expect(plan.blockers.join("\n")).toMatch(/restore --staged/);
  });

  it("refuses on a detached HEAD", async () => {
    const f = fixture();
    git(f.appDir, ["checkout", "--detach"]);

    const plan = await planFor(f);
    expect(plan.blockers.join("\n")).toMatch(/detached HEAD/i);
  });

  it("refuses when a merge is in progress", async () => {
    const f = fixture();
    // Simulate the in-progress state git itself uses as the marker.
    writeFileSync(join(f.appDir, ".git", "MERGE_HEAD"), git(f.appDir, ["rev-parse", "HEAD"]));

    const plan = await planFor(f);
    expect(plan.blockers.join("\n")).toMatch(/operation in progress \(MERGE_HEAD\)/);
  });

  it("refuses for an app that is not registered in the org", async () => {
    const f = fixture();
    const plan = await planBootstrapPublish({
      app: "not-registered",
      orgHome: f.orgHome,
      appDir: f.appDir,
    });
    expect(plan.blockers.join("\n")).toMatch(/is not registered/);
    expect(plan.repos).toEqual([]);
  });

  it("never executes a blocked plan, even when called directly as a library", async () => {
    const f = fixture();
    git(f.appDir, ["checkout", "--detach"]);
    const plan = await planFor(f);
    expect(plan.blockers.length).toBeGreaterThan(0);

    const gh = new FakeGhOps({ repo: f.repoSlug, issues: [] });
    await expect(
      executeBootstrapPublish(plan, { app: f.app, orgHome: f.orgHome, appDir: f.appDir, gh }),
    ).rejects.toThrow(/refusing to execute a blocked plan/i);
    expect(gh.calls.filter((c) => c.op === "createPR")).toEqual([]);
  });
});

describe("bootstrap publish — draft only, never merges", () => {
  it("opens a draft pull request and performs no merge or ready-for-review call", async () => {
    const f = fixture();
    const plan = await planFor(f);
    const gh = new FakeGhOps({ repo: f.repoSlug, issues: [] });

    const result = await executeBootstrapPublish(plan, {
      app: f.app,
      orgHome: f.orgHome,
      appDir: f.appDir,
      gh,
    });

    const appSide = result.repos.find((r) => r.kind === "app");
    expect(appSide?.prNumber).toBe(1);
    expect((await gh.readPR(1)).isDraft).toBe(true);

    // The whole point of a draft-only workflow: no merge, ever.
    const ops = gh.calls.map((c) => c.op);
    expect(ops).not.toContain("mergePR");
    expect(ops).not.toContain("markReady");
    expect(ops).not.toContain("closePR");
  });
});

describe("bootstrap publish — preview mutates nothing", () => {
  it("plans without touching either repo or GitHub", async () => {
    const f = fixture();
    const appHeadBefore = git(f.appDir, ["rev-parse", "HEAD"]);
    const orgHeadBefore = git(f.orgHome, ["rev-parse", "HEAD"]);
    const gh = new FakeGhOps({ repo: f.repoSlug, issues: [] });

    const plan = await planFor(f, gh);

    expect(plan.blockers).toEqual([]);
    expect(plan.repos.length).toBeGreaterThan(0);
    // Nothing committed, no branch created, nothing staged, no GitHub call.
    expect(git(f.appDir, ["rev-parse", "HEAD"])).toBe(appHeadBefore);
    expect(git(f.orgHome, ["rev-parse", "HEAD"])).toBe(orgHeadBefore);
    expect(git(f.appDir, ["branch", "--list", `op/bootstrap-${f.app}`])).toBe("");
    expect(git(f.appDir, ["diff", "--cached", "--name-only"])).toBe("");
    expect(gh.calls).toEqual([]);
  });
});

describe("bootstrap publish — idempotent retries", () => {
  it("reuses the branch and pull request instead of opening a second one", async () => {
    const f = fixture();
    const gh = new FakeGhOps({ repo: f.repoSlug, issues: [] });

    const first = await executeBootstrapPublish(await planFor(f, gh), {
      app: f.app,
      orgHome: f.orgHome,
      appDir: f.appDir,
      gh,
    });
    expect(first.repos.find((r) => r.kind === "app")?.prNumber).toBe(1);
    const createdFirst = gh.calls.filter((c) => c.op === "createPR").length;
    expect(createdFirst).toBe(1);

    // Re-run the whole workflow exactly as an operator retrying would.
    const secondPlan = await planFor(f, gh);
    expect(secondPlan.blockers).toEqual([]);
    expect(secondPlan.noop).toBe(true);

    const second = await executeBootstrapPublish(secondPlan, {
      app: f.app,
      orgHome: f.orgHome,
      appDir: f.appDir,
      gh,
    });

    // No duplicate pull request, no duplicate commit.
    expect(gh.calls.filter((c) => c.op === "createPR").length).toBe(createdFirst);
    for (const repo of second.repos) expect(repo.skipped).toBeDefined();
    expect(git(f.appDir, ["rev-list", "--count", `origin/${f.defaultBranch}..HEAD`])).toBe("1");
  });
});
