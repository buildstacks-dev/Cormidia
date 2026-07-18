// `operon bootstrap publish` — the coordinated, reviewable way to get
// bootstrap's output in front of humans (#61).
//
// `operon bootstrap` writes app-owned `.operon/` artifacts into the app repo
// and registers the app in the org's `apps.yaml`. Both are human-ratified
// surfaces, and until now publication was entirely manual: an operator had to
// remember which files bootstrap owned, stage exactly those in two separate
// repositories, and open two pull requests that referenced each other. Doing
// that by hand is how unrelated working-tree content ends up in an onboarding
// commit.
//
// The design rules this module enforces, in order of importance:
//
//  1. **Only bootstrap-owned paths are ever staged.** The publishable set is
//     computed from the same artifact list bootstrap emits — never from "what
//     changed in the working tree". A file Operon did not write is not
//     Operon's to commit.
//  2. **Ambiguity refuses.** Pre-staged unrelated content, a merge or rebase
//     in progress, a detached HEAD, or a conflicted bootstrap path all stop
//     the publish with an actionable message. Guessing is worse than stopping.
//  3. **Draft pull requests only.** This module never merges, never marks a PR
//     ready, and never pushes to a default branch. A human reviews and lands.
//  4. **Preview by default.** Nothing mutates a repo or GitHub without an
//     explicit `--execute`, matching the scheduler's install/uninstall
//     convention for outward-facing effects.
//  5. **Retries are idempotent.** Re-running after a partial failure reuses
//     the existing branch and pull request instead of erroring, and reports
//     "already published" when there is nothing left to do.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadApps, type AppEntry } from "./apps.js";
import { loadRoles } from "./roles.js";
import { appArtifactFiles, type BootstrapAnswers } from "./bootstrap.js";
import {
  baseRevisionForBranch,
  resolveRemoteDefaultBranch,
  type BaseRevision,
} from "../loop/default-branch.js";
import { GhCliOps, type GhOps } from "../loop/github.js";

/** Project instruction files bootstrap composes an authority block into. They
 *  are bootstrap-owned only in the sense that bootstrap edited them — they
 *  usually pre-exist, so they are published as modifications, not creations. */
const PROJECT_INSTRUCTION_DOCS = ["AGENTS.md", "CLAUDE.md"] as const;

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
};

export interface RepoPublishPlan {
  /** Which side of the coordinated publish this is. */
  kind: "app" | "org";
  root: string;
  /** Branch the publish commit lands on. */
  branch: string;
  /** Resolved base — the merge target and the branch point. */
  base: BaseRevision;
  /** Bootstrap-owned paths with actual pending changes, repo-relative. */
  files: string[];
  commitMessage: string;
  /** Present only when this side publishes to GitHub. */
  pr?: {
    repo: string;
    title: string;
    body: string;
    /** Set when a pull request for this branch already exists (idempotent
     *  retry) — execution reuses it instead of opening a second one. */
    existingNumber?: number;
  };
  /** True when the branch already carries this content: nothing to do. */
  alreadyPublished: boolean;
}

export interface BootstrapPublishPlan {
  app: string;
  repos: RepoPublishPlan[];
  /** Non-empty means the publish must not proceed. Each entry is a complete,
   *  actionable sentence naming the repo and the recovery step. */
  blockers: string[];
  /** True when every side reports alreadyPublished and there are no blockers. */
  noop: boolean;
}

export interface BootstrapPublishOptions {
  app: string;
  orgHome: string;
  /** App checkout to publish from. Defaults to the app's configured local
   *  path when one is discoverable. */
  appDir: string;
  /** Injected for tests; production uses GhCliOps against the app's slug. */
  gh?: GhOps;
  /** Injected for tests: the org home's own remote is optional, and many orgs
   *  keep the org home outside git entirely. */
  publishOrgHome?: boolean;
}

// ---------------------------------------------------------------------------
// planning — pure inspection, never mutates
// ---------------------------------------------------------------------------

export async function planBootstrapPublish(
  options: BootstrapPublishOptions,
): Promise<BootstrapPublishPlan> {
  const orgHome = resolve(options.orgHome);
  const appDir = resolve(options.appDir);
  const blockers: string[] = [];

  const appsFile = await loadApps(join(orgHome, "apps.yaml"));
  const entry = appsFile.apps.find((candidate) => candidate.name === options.app);
  if (entry === undefined) {
    return {
      app: options.app,
      repos: [],
      blockers: [
        `bootstrap publish: "${options.app}" is not registered in ${join(orgHome, "apps.yaml")} — ` +
          "run `operon bootstrap` for this app first",
      ],
      noop: false,
    };
  }

  const ownedAppPaths = await bootstrapOwnedAppPaths(orgHome);

  const repos: RepoPublishPlan[] = [];
  const appPlan = inspectRepo({
    kind: "app",
    root: appDir,
    ownedPaths: ownedAppPaths,
    branch: `op/bootstrap-${entry.name}`,
    commitMessage:
      `chore(operon): onboard ${entry.name}\n\n` +
      "Adds the Operon app-owned `.operon/` artifacts written by `operon\n" +
      "bootstrap`. Review the charter, policy, and authority before merging —\n" +
      "these are human-ratified surfaces.\n",
    blockers,
  });
  if (appPlan !== undefined) {
    appPlan.pr = {
      repo: entry.repo,
      title: `chore(operon): onboard ${entry.name}`,
      body: appRepoPrBody(entry),
    };
    repos.push(appPlan);
  }

  if (options.publishOrgHome !== false) {
    const orgPlan = inspectRepo({
      kind: "org",
      root: orgHome,
      ownedPaths: ["apps.yaml"],
      branch: `op/bootstrap-${entry.name}`,
      commitMessage:
        `chore(operon): register ${entry.name}\n\n` +
        `Registers ${entry.repo} in the org app registry.\n`,
      // An org home that is not a git repo is a normal, supported setup — it
      // is simply not publishable, which is reported rather than treated as
      // a failure of the app side.
      blockers: [],
      optional: true,
    });
    if (orgPlan !== undefined) repos.push(orgPlan);
  }

  if (repos.length === 0 && blockers.length === 0) {
    blockers.push(
      `bootstrap publish: no bootstrap-owned changes are pending for "${entry.name}" — ` +
        "nothing to publish",
    );
  }

  return {
    app: entry.name,
    repos,
    blockers,
    noop: blockers.length === 0 && repos.length > 0 && repos.every((r) => r.alreadyPublished),
  };
}

/** The exact set of paths bootstrap is allowed to publish for this app.
 *
 *  Derived from the same `appArtifactFiles` bootstrap emits from, so the two
 *  cannot drift into publishing something bootstrap did not author. Every org
 *  role is treated as a candidate rather than reading back which roles this
 *  app enabled: this is an allow-list, and a candidate path that bootstrap
 *  never wrote simply has no pending change to publish. Erring wide here would
 *  be unsafe only if it let non-bootstrap content through, and it cannot —
 *  every entry is a fixed bootstrap-authored path. */
async function bootstrapOwnedAppPaths(orgHome: string): Promise<string[]> {
  const allRoles = (await loadRoles(join(orgHome, "roles.yaml"))).roles.map((role) => role.name);
  const answers = { roles: allRoles } as unknown as BootstrapAnswers;
  return [...appArtifactFiles(answers, allRoles), ...PROJECT_INSTRUCTION_DOCS];
}

interface InspectRepoInput {
  kind: "app" | "org";
  root: string;
  ownedPaths: readonly string[];
  branch: string;
  commitMessage: string;
  blockers: string[];
  /** When true, "not a git repo" is reported as skip rather than a blocker. */
  optional?: boolean;
}

function inspectRepo(input: InspectRepoInput): RepoPublishPlan | undefined {
  const { root, kind } = input;
  const label = `${kind} repo ${root}`;

  if (!existsSync(join(root, ".git"))) {
    if (input.optional === true) return undefined;
    input.blockers.push(`bootstrap publish: ${label} is not a git checkout`);
    return undefined;
  }

  // A publish in the middle of a merge/rebase would commit conflict markers
  // or someone else's half-applied work.
  for (const marker of ["MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD"]) {
    if (existsSync(join(root, ".git", marker))) {
      input.blockers.push(
        `bootstrap publish: ${label} has an operation in progress (${marker}) — ` +
          "finish or abort it, then re-run",
      );
      return undefined;
    }
  }

  // Detached HEAD has no branch to return the operator to.
  const head = safeGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (head === undefined) {
    input.blockers.push(
      `bootstrap publish: ${label} is on a detached HEAD — check out a branch, then re-run`,
    );
    return undefined;
  }

  // Scope ambiguity: pre-staged content that is NOT bootstrap-owned would be
  // easy to sweep into the publish commit. Refuse rather than reason about it.
  const staged = gitLines(root, ["diff", "--cached", "--name-only"]);
  const foreignStaged = staged.filter((path) => !input.ownedPaths.includes(path));
  if (foreignStaged.length > 0) {
    input.blockers.push(
      `bootstrap publish: ${label} has unrelated staged changes, so the publication scope ` +
        `is ambiguous (${foreignStaged.slice(0, 5).join(", ")}${foreignStaged.length > 5 ? ", …" : ""}) — ` +
        "unstage them (`git restore --staged .`) and re-run",
    );
    return undefined;
  }

  // Conflicted bootstrap-owned paths must never be committed.
  const conflicted = gitLines(root, ["diff", "--name-only", "--diff-filter=U"]).filter((path) =>
    input.ownedPaths.includes(path),
  );
  if (conflicted.length > 0) {
    input.blockers.push(
      `bootstrap publish: ${label} has unresolved conflicts in bootstrap-owned files ` +
        `(${conflicted.join(", ")}) — resolve them, then re-run`,
    );
    return undefined;
  }

  const base = resolveBase(root, input, label);
  if (base === undefined) return undefined;

  // Only bootstrap-owned paths that actually differ from the base are
  // publishable. `--` separates pathspecs so a path that looks like a rev
  // cannot be reinterpreted as one.
  const pending = new Set([
    ...gitLines(root, ["diff", "--name-only", "--", ...input.ownedPaths]),
    ...gitLines(root, ["ls-files", "--others", "--exclude-standard", "--", ...input.ownedPaths]),
    ...staged,
  ]);
  const files = [...pending].filter((path) => input.ownedPaths.includes(path)).sort();

  // Idempotent retry: the branch already exists and already carries the
  // content, so a second run has nothing to add.
  const alreadyPublished =
    files.length === 0 && safeGit(root, ["rev-parse", "--verify", "--quiet", input.branch]) !== undefined;

  if (files.length === 0 && !alreadyPublished) {
    if (input.optional === true) return undefined;
    input.blockers.push(
      `bootstrap publish: ${label} has no pending bootstrap-owned changes — nothing to publish`,
    );
    return undefined;
  }

  return {
    kind,
    root,
    branch: input.branch,
    base,
    files,
    commitMessage: input.commitMessage,
    alreadyPublished,
  };
}

/** The branch this publish targets, resolved from the remote — the same
 *  resolver the loop uses. An org whose default branch is `master` publishes
 *  onto `master` (#101). */
function resolveBase(
  root: string,
  input: InspectRepoInput,
  label: string,
): BaseRevision | undefined {
  try {
    return baseRevisionForBranch(
      resolveRemoteDefaultBranch("origin", { cwd: root, errorPrefix: "bootstrap publish" }),
    );
  } catch (error) {
    if (input.optional === true) return undefined;
    input.blockers.push(
      `bootstrap publish: cannot resolve the default branch for ${label} — ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function appRepoPrBody(entry: AppEntry): string {
  return [
    "## What",
    "",
    `Onboards \`${entry.name}\` onto Operon by adding the app-owned \`.operon/\` artifacts`,
    "written by `operon bootstrap`.",
    "",
    "## Review notes",
    "",
    "- `.operon/TASTE.md`, `.operon/policy.yaml`, and `.operon/AUTHORITY.md` are",
    "  human-ratified surfaces. Read them rather than skimming the diff.",
    "- The org-side registry change is published as a separate draft pull request",
    "  against the org repo; both should land together.",
    "",
    "Opened as a draft by `operon bootstrap publish`. Operon does not merge this.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// execution — every mutation lives below this line
// ---------------------------------------------------------------------------

export interface PublishedRepo {
  kind: "app" | "org";
  root: string;
  branch: string;
  committed: boolean;
  pushed: boolean;
  prNumber?: number;
  prUrl?: string;
  /** Set when this side was already published and execution skipped it. */
  skipped?: string;
}

export interface BootstrapPublishResult {
  app: string;
  repos: PublishedRepo[];
}

export async function executeBootstrapPublish(
  plan: BootstrapPublishPlan,
  options: BootstrapPublishOptions,
): Promise<BootstrapPublishResult> {
  if (plan.blockers.length > 0) {
    // Belt and braces: the CLI already refuses, but a library caller must not
    // be able to execute a blocked plan.
    throw new Error(`bootstrap publish: refusing to execute a blocked plan:\n${plan.blockers.join("\n")}`);
  }

  const repos: PublishedRepo[] = [];
  for (const repo of plan.repos) {
    if (repo.alreadyPublished) {
      repos.push({
        kind: repo.kind,
        root: repo.root,
        branch: repo.branch,
        committed: false,
        pushed: false,
        skipped: "already published — branch exists with no pending bootstrap-owned changes",
      });
      continue;
    }

    // Reuse the branch on a retry; create it from the resolved base otherwise.
    const exists = safeGit(repo.root, ["rev-parse", "--verify", "--quiet", repo.branch]) !== undefined;
    if (exists) git(repo.root, ["checkout", repo.branch]);
    else git(repo.root, ["checkout", "-b", repo.branch, repo.base.ref]);

    // Stage EXACTLY the bootstrap-owned paths. `--` guards pathspecs, and the
    // planner already proved nothing foreign is staged.
    git(repo.root, ["add", "--", ...repo.files]);
    git(repo.root, ["commit", "-m", repo.commitMessage]);

    git(repo.root, ["push", "--set-upstream", "origin", repo.branch]);

    const published: PublishedRepo = {
      kind: repo.kind,
      root: repo.root,
      branch: repo.branch,
      committed: true,
      pushed: true,
    };

    if (repo.pr !== undefined) {
      const gh = options.gh ?? new GhCliOps(repo.pr.repo);
      // Idempotent: never open a second pull request for the same branch.
      const existing = await gh.listPRsForBranch(repo.branch, { state: "all" });
      const pr =
        existing.length > 0
          ? existing[0]!
          : await gh.createPR({
              head: repo.branch,
              base: repo.base.defaultBranch,
              title: repo.pr.title,
              body: repo.pr.body,
              // Draft, always. Operon opens the conversation; a human lands it.
              draft: true,
            });
      published.prNumber = pr.number;
      if (pr.url !== undefined) published.prUrl = pr.url;
    }

    repos.push(published);
  }

  return { app: plan.app, repos };
}

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      env: GIT_ENV,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const detail = typeof stderr === "string" && stderr.trim() !== "" ? `: ${stderr.trim()}` : "";
    throw new Error(`bootstrap publish: \`git ${args.join(" ")}\` failed in ${cwd}${detail}`);
  }
}

function safeGit(cwd: string, args: string[]): string | undefined {
  try {
    const out = git(cwd, args);
    return out === "" ? undefined : out;
  } catch {
    return undefined;
  }
}

function gitLines(cwd: string, args: string[]): string[] {
  const out = safeGit(cwd, args);
  return out === undefined ? [] : out.split("\n").filter(Boolean);
}
