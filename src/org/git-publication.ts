// Preflight for a committed-configuration publication (#388, #389).
//
// Pure inspection. Nothing here mutates the operator's checkout: it answers
// "what exactly would be published, from what base, to which repository, and
// what would stop it" so the preview and the execution decide from the same
// facts. `cormidia bootstrap publish` established this shape for
// bootstrap-owned paths; this generalizes it without loosening any of it.
//
// The owned set is always DECLARED, never discovered from "what changed in the
// working tree". Callers pass exact file paths and/or `dir/` prefixes they own;
// a prefix expands to its real files, bounded by the declaration at every step,
// so unrelated operator work can never enter the publication.
//
// The one network call is a fetch of the resolved default branch. Resolving the
// NAME is not enough (#101/#203): the publish branch is cut from
// `origin/<name>`, so that ref must exist and be current, and it is never
// cached across calls — a stale base diffs against the wrong tree.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { baseRevisionForBranch, resolveRemoteDefaultBranch } from "../loop/default-branch.js";
import {
  githubSlugForOrigin,
  publicationGit,
  publicationGitLines,
  publicationGitOptional,
  sha256Hex,
  showBlobAtRev,
  worktreeSha256,
} from "./git-publication-substrate.js";

/** Whether this checkout can publish at all.
 *
 *  `local_only` is a supported, explicit contract — an org home with no remote
 *  works, and simply may never claim remote durability. It is not a failure. */
export type GitPublicationMode = "not_a_repository" | "local_only" | "publishable";

export interface GitPublicationIdentity {
  root: string;
  origin_url: string | null;
  github_slug: string | null;
  /** The branch the operator is on. Detached HEAD reports null and blocks. */
  head_branch: string | null;
}

export interface GitPublicationOwnedPath {
  path: string;
  /** Content at the resolved base — the "before" side. Null means absent there. */
  base_sha256: string | null;
  /** Content in the operator's working tree — the "after" side. */
  worktree_sha256: string | null;
  changed: boolean;
}

export interface GitPublicationPreflight {
  schema_version: 1;
  kind: "git-publication-preflight";
  mode: GitPublicationMode;
  identity: GitPublicationIdentity;
  /** Resolved from the remote every time, never assumed or cached. */
  base: { ref: string; default_branch: string; commit: string } | null;
  branch: string;
  /** What the command declared it owns: file paths and `dir/` prefixes. */
  declared_paths: string[];
  /** The concrete files inside that declaration, with before/after hashes. */
  owned_paths: GitPublicationOwnedPath[];
  /** Owned paths whose working-tree bytes differ from the base. */
  changed_paths: string[];
  /** Staged paths OUTSIDE the declaration. Non-empty makes the scope ambiguous. */
  foreign_staged: string[];
  /** Content identity of exactly what would be published, base included. Two
   *  runs with the same answer are the same transaction; a changed base or a
   *  changed byte is a different one. */
  content_id: string;
  /** Complete, actionable sentences. Non-empty means do not execute. */
  blockers: string[];
  /** True when the base already carries these exact bytes: nothing to publish. */
  reachable_at_base: boolean;
}

export interface PreflightGitPublicationInput {
  root: string;
  /** The publication branch name — dedicated, never a default branch. */
  branch: string;
  /** The exact declaration: repo-relative file paths, and `dir/` prefixes for
   *  surfaces whose file set is open-ended. Never "what changed". */
  ownedPaths: readonly string[];
  /** Prefix for every blocker and error, naming the command. */
  errorPrefix: string;
  /** Extra identity this publication is bound to (surface id, app name). */
  scope: string;
}

export function preflightGitPublication(input: PreflightGitPublicationInput): GitPublicationPreflight {
  const root = resolve(input.root);
  const declared = [...new Set(input.ownedPaths)].sort();
  const files = declared.filter((path) => !path.endsWith("/"));
  const blockers: string[] = [];

  if (!existsSync(join(root, ".git"))) {
    return unpublishable(input, root, declared, files, "not_a_repository", nullIdentity(root), blockers);
  }
  const originUrl = publicationGitOptional(root, ["remote", "get-url", "origin"]) ?? null;
  const identity: GitPublicationIdentity = {
    root,
    origin_url: originUrl,
    github_slug: githubSlugForOrigin(root) ?? null,
    head_branch: publicationGitOptional(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) ?? null,
  };
  if (originUrl === null) {
    return unpublishable(input, root, declared, files, "local_only", identity, blockers);
  }

  // A publication mid-merge would commit conflict markers or someone else's
  // half-applied work; a detached HEAD has no branch to return the operator to.
  for (const marker of ["MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD"]) {
    if (existsSync(join(root, ".git", marker))) {
      blockers.push(
        `${input.errorPrefix}: ${root} has an operation in progress (${marker}) — finish or abort it, then re-run`,
      );
    }
  }
  if (identity.head_branch === null) {
    blockers.push(`${input.errorPrefix}: ${root} is on a detached HEAD — check out a branch, then re-run`);
  }

  // These probes use the THROWING reader deliberately: a guard must never read
  // a failed git call as "found nothing".
  const staged = publicationGitLines(root, ["diff", "--cached", "--name-only"], input.errorPrefix);
  const foreignStaged = staged.filter((path) => !declarationOwns(declared, path));
  if (foreignStaged.length > 0) {
    blockers.push(
      `${input.errorPrefix}: ${root} has unrelated staged changes, so the publication scope is ambiguous ` +
        `(${foreignStaged.slice(0, 5).join(", ")}${foreignStaged.length > 5 ? ", …" : ""}) — ` +
        "unstage them (`git restore --staged .`) and re-run",
    );
  }
  const conflicted = publicationGitLines(root, ["diff", "--name-only", "--diff-filter=U"], input.errorPrefix).filter(
    (path) => declarationOwns(declared, path),
  );
  if (conflicted.length > 0) {
    blockers.push(
      `${input.errorPrefix}: ${root} has unresolved conflicts in owned files (${conflicted.join(", ")}) — ` +
        "resolve them, then re-run",
    );
  }

  const base = resolveBase(root, input, blockers);
  if (base === null) {
    return {
      ...unpublishable(input, root, declared, files, "publishable", identity, blockers),
      foreign_staged: foreignStaged,
    };
  }

  const owned = expandDeclaration(root, declared, files, base.ref, input.errorPrefix).map((path) => {
    const blob = showBlobAtRev(root, base.ref, path);
    const baseHash = blob === undefined ? null : sha256Hex(blob);
    const worktreeHash = worktreeSha256(root, path);
    return { path, base_sha256: baseHash, worktree_sha256: worktreeHash, changed: baseHash !== worktreeHash };
  });
  const changedPaths = owned.filter((entry) => entry.changed).map((entry) => entry.path);

  return {
    schema_version: 1,
    kind: "git-publication-preflight",
    mode: "publishable",
    identity,
    base: { ref: base.ref, default_branch: base.defaultBranch, commit: base.commit },
    branch: input.branch,
    declared_paths: declared,
    owned_paths: owned,
    changed_paths: changedPaths,
    foreign_staged: foreignStaged,
    content_id: sha256Hex(
      [
        input.scope,
        input.branch,
        originUrl,
        base.defaultBranch,
        base.commit,
        ...owned.map((entry) => `${entry.path}:${entry.base_sha256 ?? "-"}:${entry.worktree_sha256 ?? "-"}`),
      ].join(" "),
    ),
    blockers,
    reachable_at_base: changedPaths.length === 0,
  };
}

/** The concrete files a declaration covers at this base: every declared file
 *  path (so its before/after hashes are always reported), plus, for each `dir/`
 *  prefix, the real files that differ from the base or are untracked. */
function expandDeclaration(
  root: string,
  declared: readonly string[],
  files: readonly string[],
  ref: string,
  errorPrefix: string,
): string[] {
  const prefixes = declared.filter((path) => path.endsWith("/"));
  const found = new Set(files);
  if (prefixes.length > 0) {
    const pathspecs = prefixes.map((prefix) => prefix.slice(0, -1));
    for (const path of [
      ...publicationGitLines(root, ["diff", "--name-only", ref, "--", ...pathspecs], errorPrefix),
      ...publicationGitLines(root, ["ls-files", "--others", "--exclude-standard", "--", ...pathspecs], errorPrefix),
    ]) {
      if (declarationOwns(declared, path)) found.add(path);
    }
  }
  return [...found].sort();
}

function declarationOwns(declared: readonly string[], path: string): boolean {
  return declared.some((owned) => (owned.endsWith("/") ? path.startsWith(owned) : path === owned));
}

function nullIdentity(root: string): GitPublicationIdentity {
  return { root, origin_url: null, github_slug: null, head_branch: null };
}

/** The shape returned when there is no resolvable base: declared files only,
 *  with their working-tree hashes and no "before" side to compare against. */
function unpublishable(
  input: PreflightGitPublicationInput,
  root: string,
  declared: string[],
  files: string[],
  mode: GitPublicationMode,
  identity: GitPublicationIdentity,
  blockers: string[],
): GitPublicationPreflight {
  const owned = files.map((path) => {
    const worktreeHash = worktreeSha256(root, path);
    return { path, base_sha256: null, worktree_sha256: worktreeHash, changed: worktreeHash !== null };
  });
  return {
    schema_version: 1,
    kind: "git-publication-preflight",
    mode,
    identity,
    base: null,
    branch: input.branch,
    declared_paths: declared,
    owned_paths: owned,
    changed_paths: owned.filter((entry) => entry.changed).map((entry) => entry.path),
    foreign_staged: [],
    content_id: sha256Hex([input.scope, mode, ...declared].join(" ")),
    blockers,
    reachable_at_base: false,
  };
}

interface ResolvedBase {
  ref: string;
  defaultBranch: string;
  commit: string;
}

/** Resolve, fetch, and pin the base. Every step can fail loudly; none degrades
 *  to a guessed `main` or to a tip fetched days ago. */
function resolveBase(root: string, input: PreflightGitPublicationInput, blockers: string[]): ResolvedBase | null {
  try {
    const base = baseRevisionForBranch(
      resolveRemoteDefaultBranch("origin", { cwd: root, errorPrefix: input.errorPrefix }),
    );
    publicationGit(root, ["fetch", "--quiet", "origin", base.defaultBranch], input.errorPrefix);
    const commit = publicationGit(root, ["rev-parse", "--verify", `${base.ref}^{commit}`], input.errorPrefix);
    return { ref: base.ref, defaultBranch: base.defaultBranch, commit };
  } catch (error) {
    blockers.push(
      `${input.errorPrefix}: cannot resolve the default branch for ${root} — ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
