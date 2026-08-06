// `cormidia bootstrap publish` — the coordinated, reviewable way to get
// bootstrap's output in front of humans (#61).
//
// `cormidia bootstrap` writes app-owned `.cormidia/` artifacts into the app repo
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
//     changed in the working tree". A file Cormidia did not write is not
//     Cormidia's to commit.
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
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { baseRevisionForBranch, resolveRemoteDefaultBranch, type BaseRevision } from "../loop/default-branch.js";
import { GhCliOps, type GhOps } from "../loop/github.js";
import { loadApps, type AppEntry } from "./apps.js";
import { AUTHORITY_BLOCK_END, AUTHORITY_BLOCK_START } from "./authority.js";
import { appArtifactFiles, type BootstrapAnswers } from "./bootstrap.js";
import { loadRoles } from "./roles.js";

/** Project instruction files bootstrap composes an authority block into. They
 *  are bootstrap-owned only in the sense that bootstrap edited them — they
 *  usually pre-exist, so they are published as modifications, not creations. */
const PROJECT_INSTRUCTION_DOCS = ["AGENTS.md", "CLAUDE.md"] as const;

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
};

interface RepoPublishPlan {
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
  /** Present only when this side has a GitHub remote to open a pull request
   *  against. Absent means the branch is pushed for review and no pull request
   *  is claimed — a non-GitHub remote is a supported setup, not a failure.
   *
   *  There is deliberately no "existing pull request" field: discovering one
   *  requires a GitHub call, and preview must stay network-free. Execution
   *  reuses an existing pull request instead of opening a second. */
  pr?: {
    repo: string;
    title: string;
    body: string;
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

interface BootstrapPublishOptions {
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

export async function planBootstrapPublish(options: BootstrapPublishOptions): Promise<BootstrapPublishPlan> {
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
          "run `cormidia bootstrap` for this app first",
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
      `chore(cormidia): onboard ${entry.name}\n\n` +
      "Adds the Cormidia app-owned `.cormidia/` artifacts written by `cormidia\n" +
      "bootstrap`. Review the charter, policy, and authority before merging —\n" +
      "these are human-ratified surfaces.\n",
    blockers,
  });
  if (appPlan !== undefined) {
    appPlan.pr = {
      repo: entry.repo,
      title: `chore(cormidia): onboard ${entry.name}`,
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
        `chore(cormidia): register ${entry.name}\n\n` + `Registers ${entry.repo} in the org app registry.\n`,
      // An org home that is not a git repo is a normal, supported setup — it
      // is simply not publishable, which is reported rather than treated as
      // a failure of the app side.
      blockers: [],
      optional: true,
    });
    if (orgPlan !== undefined) {
      // The org home is usually a GitHub repo too, and #61 asks for
      // COORDINATED draft pull requests. Open one when the remote is a GitHub
      // slug we can name; otherwise push the branch and claim nothing more.
      const orgSlug = githubSlugForOrigin(orgHome);
      if (orgSlug !== undefined) {
        orgPlan.pr = {
          repo: orgSlug,
          title: `chore(cormidia): register ${entry.name}`,
          body: orgRepoPrBody(entry),
        };
      }
      repos.push(orgPlan);
    }
  }

  if (repos.length === 0 && blockers.length === 0) {
    blockers.push(
      `bootstrap publish: no bootstrap-owned changes are pending for "${entry.name}" — ` + "nothing to publish",
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
        `bootstrap publish: ${label} has an operation in progress (${marker}) — ` + "finish or abort it, then re-run",
      );
      return undefined;
    }
  }

  // Detached HEAD has no branch to return the operator to.
  const head = safeGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (head === undefined) {
    input.blockers.push(`bootstrap publish: ${label} is on a detached HEAD — check out a branch, then re-run`);
    return undefined;
  }

  // Scope ambiguity: pre-staged content that is NOT bootstrap-owned would be
  // easy to sweep into the publish commit. Refuse rather than reason about it.
  //
  // These two probes use the THROWING git(): a safety guard must never read a
  // failed git call as "found nothing". A corrupt index or a locked `.git`
  // would otherwise report a clean scope and wave the publish through.
  const staged = requiredGitLines(root, ["diff", "--cached", "--name-only"]);
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
  const conflicted = requiredGitLines(root, ["diff", "--name-only", "--diff-filter=U"]).filter((path) =>
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

  // `AGENTS.md` / `CLAUDE.md` are the one owned-path category Cormidia does not
  // author outright — it appends a delimited authority block to a file the
  // operator owns. Staging is file-granular, so publishing one whole would
  // sweep in any unrelated edit the operator has in flight, which is exactly
  // what rule #1 forbids ("a file Cormidia did not write is not Cormidia's to
  // commit"). Refuse when the pending change is not confined to that block,
  // and name the file so the operator can commit or stash their own work.
  for (const doc of PROJECT_INSTRUCTION_DOCS) {
    if (!files.includes(doc)) continue;
    if (pendingChangeIsAuthorityBlockOnly(root, doc)) continue;
    input.blockers.push(
      `bootstrap publish: ${label} has changes to ${doc} beyond the Cormidia authority block, ` +
        "so publishing it would commit unrelated work — commit or stash your own " +
        `${doc} changes, then re-run`,
    );
    return undefined;
  }

  // Idempotent retry. "Already published" means the work actually REACHED the
  // remote — a local commit is not publication.
  //
  // Checking only for a local branch was a wedge: if `--execute` committed and
  // then the push failed, a re-run saw no pending changes plus an existing
  // branch, reported "already published", and skipped the repo forever. The
  // branch was never pushed and no pull request was ever opened, while the
  // operator was told the opposite. The remote-tracking ref is the authority,
  // and the PR is confirmed separately at execution time.
  // Publication is judged by CONTENT on the remote branch, not by the state of
  // the operator's working tree. Publishing happens in a temporary worktree
  // and deliberately never commits in the operator's checkout, so their files
  // legitimately remain uncommitted afterwards — "still pending locally" is
  // not evidence that anything is unpublished.
  const localBranch = safeGit(root, ["rev-parse", "--verify", "--quiet", input.branch]);
  const remoteRef = `refs/remotes/origin/${input.branch}`;
  const remoteBranch = safeGit(root, ["rev-parse", "--verify", "--quiet", remoteRef]);
  const publishedMatches =
    remoteBranch !== undefined && files.every((rel) => publishedCopyMatches(root, remoteRef, rel));
  const alreadyPublished = publishedMatches;

  // Committed locally but never pushed: there IS work to finish, even though a
  // naive check would call it done. Publish must resume, not skip.
  const unpushedCommit = files.length === 0 && localBranch !== undefined && remoteBranch === undefined;

  if (files.length === 0 && !alreadyPublished && !unpushedCommit) {
    if (input.optional === true) return undefined;
    input.blockers.push(`bootstrap publish: ${label} has no pending bootstrap-owned changes — nothing to publish`);
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
 *  onto `master` (#101).
 *
 *  Resolving the NAME is not enough: the publish branch is cut from
 *  `origin/<name>`, so that ref must exist and be current. A checkout that has
 *  never fetched it fails outright, and one that fetched days ago would
 *  silently cut from a stale tip — the same staleness bug #60 fixed in
 *  interactive planning. Fetch, then verify the tip is really there. */
function resolveBase(root: string, input: InspectRepoInput, label: string): BaseRevision | undefined {
  try {
    const base = baseRevisionForBranch(
      resolveRemoteDefaultBranch("origin", { cwd: root, errorPrefix: "bootstrap publish" }),
    );
    git(root, ["fetch", "--quiet", "origin", base.defaultBranch]);
    git(root, ["rev-parse", "--verify", `${base.ref}^{commit}`]);
    return base;
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
    `Onboards \`${entry.name}\` onto Cormidia by adding the app-owned \`.cormidia/\` artifacts`,
    "written by `cormidia bootstrap`.",
    "",
    "## Review notes",
    "",
    "- `.cormidia/TASTE.md`, `.cormidia/policy.yaml`, and `.cormidia/AUTHORITY.md` are",
    "  human-ratified surfaces. Read them rather than skimming the diff.",
    "- The org-side registry change (`apps.yaml`) is published separately against",
    "  the org repo — as a draft pull request when that remote is on GitHub, and",
    "  otherwise as a pushed branch. Land the two together.",
    "",
    "Opened as a draft by `cormidia bootstrap publish`. Cormidia does not merge this.",
  ].join("\n");
}

function orgRepoPrBody(entry: AppEntry): string {
  return [
    "## What",
    "",
    `Registers \`${entry.repo}\` as \`${entry.name}\` in the org app registry (\`apps.yaml\`).`,
    "",
    "## Review notes",
    "",
    "- This is the org half of an onboarding pair. The app-owned `.cormidia/`",
    `  artifacts are published as a separate draft pull request on \`${entry.repo}\`.`,
    "  Land them together.",
    "",
    "Opened as a draft by `cormidia bootstrap publish`. Cormidia does not merge this.",
  ].join("\n");
}

/** The GitHub slug for a repo's `origin`, or undefined when it is not GitHub.
 *
 *  Two sources, because neither alone covers the real configurations:
 *  `remote get-url` applies `url.<base>.insteadOf` rewriting, which expands a
 *  shorthand like `gh:owner/repo` into a real GitHub URL, but also rewrites a
 *  GitHub URL into a local mirror path. `config --get remote.origin.url` is
 *  the raw configured value. Whichever parses as GitHub is the answer. */
function githubSlugForOrigin(root: string): string | undefined {
  const configured = githubSlugFromRemote(safeGit(root, ["config", "--get", "remote.origin.url"]));
  if (configured !== undefined) return configured;
  return githubSlugFromRemote(safeGit(root, ["remote", "get-url", "origin"]));
}

/** `owner/repo` when a remote URL is a GitHub one, otherwise undefined.
 *  Undefined is a normal answer — a self-hosted or local remote simply gets a
 *  pushed branch rather than a pull request, and the output must not claim
 *  otherwise. */
function githubSlugFromRemote(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const match =
    /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    );
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return `${match[1]}/${match[2]}`;
}

// ---------------------------------------------------------------------------
// execution — every mutation lives below this line
// ---------------------------------------------------------------------------

interface PublishedRepo {
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

interface BootstrapPublishResult {
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
      // The git work is done, but the pull request may not be: a run whose
      // push succeeded and whose `gh pr create` then failed leaves exactly
      // this state. Skipping outright would mean the branch is on origin and
      // no pull request ever appears, with the operator told it is published.
      // Ensuring the PR is idempotent, so it is safe on a genuine no-op too.
      const published: PublishedRepo = {
        kind: repo.kind,
        root: repo.root,
        branch: repo.branch,
        committed: false,
        pushed: false,
        skipped: "already published — the branch is on origin with no pending bootstrap-owned changes",
      };
      await ensureDraftPullRequest(repo, options, published);
      repos.push(published);
      continue;
    }

    // The operator's checkout is never moved. Everything happens in a
    // throwaway worktree.
    //
    // Committing in place needs a `git checkout`, and both outcomes of that
    // are bad: leaving the checkout parked on the publish branch means every
    // later `cormidia` command reads the ORG HOME's config from a branch cut
    // from the remote tip, while switching back afterwards DELETES the newly
    // committed files from the operator's working tree (they are tracked on
    // the publish branch and absent from the branch they were on). A separate
    // worktree has neither problem: HEAD, the index, and every file the
    // operator can see are untouched.
    if (repo.files.length > 0) {
      publishFromTemporaryWorktree(repo);
    } else {
      // Resume: the commit already exists locally and only the push (and
      // possibly the pull request) is outstanding. Push the ref directly —
      // still no checkout.
      git(repo.root, ["push", "origin", `refs/heads/${repo.branch}:refs/heads/${repo.branch}`]);
    }

    const published: PublishedRepo = {
      kind: repo.kind,
      root: repo.root,
      branch: repo.branch,
      committed: true,
      pushed: true,
    };

    await ensureDraftPullRequest(repo, options, published);
    repos.push(published);
  }

  return { app: plan.app, repos };
}

/** Open the branch's draft pull request, or adopt the one already open.
 *  Idempotent by construction, so it is safe to call on a resume and on a
 *  repo whose git work was already complete. */
async function ensureDraftPullRequest(
  repo: RepoPublishPlan,
  options: BootstrapPublishOptions,
  published: PublishedRepo,
): Promise<void> {
  if (repo.pr === undefined) return;
  const gh = options.gh ?? new GhCliOps(repo.pr.repo);
  // Never open a second pull request for the same branch.
  const existing = await gh.listPRsForBranch(repo.branch, { state: "all" });
  const pr =
    existing.length > 0
      ? existing[0]!
      : await gh.createPR({
          head: repo.branch,
          base: repo.base.defaultBranch,
          title: repo.pr.title,
          body: repo.pr.body,
          // Draft, always. Cormidia opens the conversation; a human lands it.
          draft: true,
        });
  published.prNumber = pr.number;
  if (pr.url !== undefined) published.prUrl = pr.url;
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

/** Does the already-published branch carry this file byte-for-byte as the
 *  working tree has it? Compares raw blobs rather than commit ids, because the
 *  operator's copy is intentionally left uncommitted. A file missing from both
 *  sides counts as a match (bootstrap removed it and the removal is published);
 *  present on one side only does not. */
function publishedCopyMatches(root: string, remoteRef: string, rel: string): boolean {
  const published = showBlob(root, `${remoteRef}:${rel}`);
  const localPath = join(root, rel);
  const local = existsSync(localPath) ? readFileSync(localPath, "utf8") : undefined;
  if (published === undefined && local === undefined) return true;
  if (published === undefined || local === undefined) return false;
  return published === local;
}

/** Raw file content at a git revision — no trimming, unlike safeGit, because
 *  trailing-newline differences are real content differences here. */
function showBlob(cwd: string, revPath: string): string | undefined {
  try {
    return execFileSync("git", ["show", revPath], {
      cwd,
      env: GIT_ENV,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return undefined;
  }
}

/** Build and push the publish commit in a throwaway worktree cut from the
 *  resolved base, copying in exactly the bootstrap-owned files from the
 *  operator's working tree. The operator's checkout is never touched.
 *
 *  A deleted owned path is carried across as a deletion rather than skipped,
 *  so the publish reflects what bootstrap actually left behind. */
function publishFromTemporaryWorktree(repo: RepoPublishPlan): void {
  const worktree = mkdtempSync(join(tmpdir(), "cormidia-publish-"));
  // `git worktree add` wants to create the directory itself.
  rmSync(worktree, { recursive: true, force: true });

  git(repo.root, ["worktree", "add", "--quiet", "--detach", worktree, repo.base.ref]);
  try {
    for (const rel of repo.files) {
      const from = join(repo.root, rel);
      const to = join(worktree, rel);
      if (existsSync(from)) {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      } else {
        rmSync(to, { force: true });
      }
    }

    // Stage EXACTLY the bootstrap-owned paths. `--` guards pathspecs, and the
    // planner already proved nothing foreign is staged in the source repo.
    git(worktree, ["add", "--", ...repo.files]);
    git(worktree, ["commit", "-m", repo.commitMessage]);
    // Name the branch at the new commit. `-f` makes a retry that re-commits
    // idempotent rather than failing on an existing branch.
    git(worktree, ["branch", "-f", repo.branch, "HEAD"]);
    git(worktree, ["push", "origin", `refs/heads/${repo.branch}:refs/heads/${repo.branch}`]);
  } finally {
    // Best-effort: a failed publish must not leave a registered worktree
    // behind, but cleanup trouble must not mask the original error.
    safeGit(repo.root, ["worktree", "remove", "--force", worktree]);
    rmSync(worktree, { recursive: true, force: true });
  }
}

/** Is this instruction file's pending change confined to the Cormidia authority
 *  block? Compares the committed and working copies with the delimited block
 *  removed from both: if the remainder is identical, the only difference is
 *  the block bootstrap owns.
 *
 *  A file with no committed version did not exist before this onboarding, so
 *  bootstrap authored all of it and publishing it whole is correct — refusing
 *  there would block the ordinary first-time onboarding this command exists
 *  for. Otherwise it fails closed: an unreadable blob or a malformed or
 *  duplicated block returns false, producing a refusal rather than a silent
 *  whole-file publish. */
function pendingChangeIsAuthorityBlockOnly(root: string, doc: string): boolean {
  const committed = safeGit(root, ["show", `HEAD:${doc}`]);
  if (committed === undefined) return true;

  let working: string;
  try {
    working = readFileSync(join(root, doc), "utf8");
  } catch {
    return false;
  }

  const strippedCommitted = stripAuthorityBlock(committed);
  const strippedWorking = stripAuthorityBlock(working);
  if (strippedCommitted === undefined || strippedWorking === undefined) return false;
  return strippedCommitted === strippedWorking;
}

/** The text with the delimited authority block removed, or undefined when the
 *  markers are missing-in-part, out of order, or duplicated — the same
 *  malformed shapes `composeProjectInstructions` refuses to compose. */
function stripAuthorityBlock(text: string): string | undefined {
  const start = text.indexOf(AUTHORITY_BLOCK_START);
  const end = text.indexOf(AUTHORITY_BLOCK_END);
  if (start === -1 && end === -1) return normalizeWhitespace(text);
  if (start === -1 || end === -1 || end < start) return undefined;
  if (text.lastIndexOf(AUTHORITY_BLOCK_START) !== start) return undefined;
  if (text.lastIndexOf(AUTHORITY_BLOCK_END) !== end) return undefined;
  return normalizeWhitespace(text.slice(0, start) + text.slice(end + AUTHORITY_BLOCK_END.length));
}

/** Blank-line differences around an inserted block are an artifact of the
 *  insertion, not operator content. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** `gitLines` for the safety guards: a git failure propagates instead of
 *  reading as an empty result. "I could not check" and "there is nothing
 *  there" must never be the same answer in a refusal path. */
function requiredGitLines(cwd: string, args: string[]): string[] {
  const out = git(cwd, args);
  return out === "" ? [] : out.split("\n").filter(Boolean);
}
