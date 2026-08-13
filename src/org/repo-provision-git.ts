// The git half of repository provisioning (#382): build the bootstrap commit,
// wire the remote, and push it.
//
// Split from the transaction so each module stays inside the new-module size
// ceiling, and because these two steps are where the operator's own checkout is
// at risk. Each function returns a FACT and leaves journalling to the caller,
// so the resumable boundaries stay in one place.
//
// Three properties this file exists to hold:
//
//  * The commit is built against a TEMPORARY index, so the operator's index is
//    never staged into. `publicationGit`'s env parameter is the only sanctioned
//    way to set `GIT_INDEX_FILE` — the substrate snapshots its environment at
//    module load, so mutating `process.env` around a call is silently ignored.
//  * An existing HEAD becomes the commit's PARENT, and the bootstrap tree is
//    overlaid on the parent's tree. A parentless commit plus `update-ref` would
//    orphan an org home's entire history; a tree built from the declaration
//    alone would record every file outside it as deleted.
//  * A remote branch whose content differs is a REFUSAL. Provisioning never
//    force-pushes: the remote moved, and that is a fact to inspect rather than
//    a race to win.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicationGit, publicationGitOptional } from "./git-publication-substrate.js";
import type { RepositoryProvisionTransaction } from "./repo-provision-journal.js";

export class ProvisionGitRefusedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProvisionGitRefusedError";
  }
}

/** Build the bootstrap commit and return its oid.
 *
 *  `git init` runs when the source root is not a repository yet. That is local
 *  and reversible; nothing outward has happened at this point beyond the
 *  repository existing. */
export function buildBootstrapCommit(
  transaction: RepositoryProvisionTransaction,
  commitMessage: string,
  errorPrefix: string,
): string {
  const root = transaction.root;
  if (!existsSync(join(root, ".git"))) {
    publicationGit(root, ["init", "--quiet", "-b", transaction.branch], errorPrefix);
  }

  // Does the checkout already have history? Decided BEFORE the commit exists,
  // because it changes both the commit's shape and what a correct end state
  // looks like for the operator.
  const parent = publicationGitOptional(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  const genesis = parent === undefined;

  const indexDir = mkdtempSync(join(tmpdir(), "cormidia-provision-"));
  const indexFile = join(indexDir, "index");
  let commit: string;
  try {
    // Start from the parent's tree so tracked files OUTSIDE the declaration are
    // carried forward rather than recorded as deleted.
    if (parent !== undefined) gitWithIndex(root, indexFile, ["read-tree", parent], errorPrefix);
    // `--` guards pathspecs so a path that looks like a rev cannot be
    // reinterpreted as one, and the preflight already proved every entry is
    // inside the declaration.
    gitWithIndex(root, indexFile, ["add", "--", ...transaction.owned_paths], errorPrefix);
    const tree = gitWithIndex(root, indexFile, ["write-tree"], errorPrefix);
    commit = publicationGit(
      root,
      ["commit-tree", tree, ...(parent === undefined ? [] : ["-p", parent]), "-m", commitMessage],
      errorPrefix,
    );
    // Name the branch at the new commit. With `parent` set this is a
    // fast-forward from the operator's own HEAD, so nothing is rewritten.
    publicationGit(root, ["update-ref", `refs/heads/${transaction.branch}`, commit], errorPrefix);
  } finally {
    rmSync(indexDir, { recursive: true, force: true });
  }

  // On a GENESIS commit only, sync the operator's index to it.
  //
  // Without this the checkout is left actively misleading: HEAD now resolves to
  // a commit containing the bootstrap tree while the operator's index is still
  // empty, so `git status` reports every provisioned file as DELETED. Nothing
  // was lost — but an operator who reacts by committing those "deletions" would
  // wipe the bootstrap commit's contents on their first interaction with the
  // new repository.
  //
  // Deliberately genesis-only: a checkout that already had commits keeps the
  // full temporary-index isolation, because its operator may have staged work
  // of their own and `reset` would discard exactly that.
  if (
    genesis &&
    publicationGitOptional(root, ["symbolic-ref", "--quiet", "HEAD"]) === `refs/heads/${transaction.branch}`
  ) {
    publicationGit(root, ["reset", "--quiet", "--mixed", commit], errorPrefix);
  }
  return commit;
}

/** Wire the remote if needed and push the bootstrap commit. Returns the commit
 *  that is now on the remote branch — which may be a pre-existing one whose
 *  content already matches, in which case nothing was pushed. */
export function pushBootstrapCommit(
  transaction: RepositoryProvisionTransaction,
  commit: string,
  errorPrefix: string,
): string {
  const root = transaction.root;

  // The preflight already refused a remote naming a different repository, so
  // reaching here means an existing remote agrees with the target.
  const configured = publicationGitOptional(root, ["remote", "get-url", transaction.remote_name]);
  if (configured === undefined) {
    publicationGit(root, ["remote", "add", transaction.remote_name, transaction.remote_url], errorPrefix);
  }

  publicationGitOptional(root, ["fetch", "--quiet", transaction.remote_name, transaction.branch]);
  const remoteRef = `refs/remotes/${transaction.remote_name}/${transaction.branch}`;
  const remoteTip = publicationGitOptional(root, ["rev-parse", "--verify", "--quiet", remoteRef]);

  if (remoteTip !== undefined && remoteTip !== commit) {
    // CONTENT decides, and a difference is never overwritten. A previous run
    // whose push landed under a different commit id (a different timestamp, a
    // different parent) has the same tree and is adopted; anything else is
    // somebody's work.
    const sameTree =
      publicationGitOptional(root, ["rev-parse", `${remoteTip}^{tree}`]) ===
      publicationGitOptional(root, ["rev-parse", `${commit}^{tree}`]);
    if (!sameTree) {
      throw new ProvisionGitRefusedError(
        "provision_remote_branch_diverged",
        `${errorPrefix}: ${transaction.remote_name}/${transaction.branch} on ${transaction.slug} carries different ` +
          "content than this bootstrap commit — it is never force-pushed. Inspect the remote branch, then re-run.",
      );
    }
    return remoteTip;
  }
  if (remoteTip === undefined) {
    publicationGit(
      root,
      ["push", transaction.remote_name, `refs/heads/${transaction.branch}:refs/heads/${transaction.branch}`],
      errorPrefix,
    );
  }
  return commit;
}

/** Run git with an isolated index file, so staging never touches the operator's
 *  own index. Passed through `publicationGit`'s env parameter, NOT via
 *  `process.env` — the substrate snapshots its environment at module load, so a
 *  mutation there would be silently ignored. */
function gitWithIndex(root: string, indexFile: string, args: readonly string[], errorPrefix: string): string {
  return publicationGit(root, args, errorPrefix, { GIT_INDEX_FILE: indexFile });
}
