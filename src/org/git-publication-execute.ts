// Execution for a committed-configuration publication (#388, #389).
//
// One journaled transaction, resumable at every boundary: build the commit,
// push the branch, open the draft pull request, and only then report a state
// stronger than "recorded locally". A retry after a crash, a failed push, or a
// lost success response converges instead of duplicating — the journal is keyed
// by the publication's content identity, and every step re-derives what is
// already true from git and GitHub rather than from a local success flag.
//
// Two things this never does, because both would be worse than stopping:
// it never force-pushes over a publish branch whose remote content differs
// (the remote moved; that is a refusal, not a conflict to win), and it never
// merges — a human lands every one of these surfaces.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GhCliOps, type GhOps } from "../loop/github.js";

/** The only two GitHub operations a publication needs. Narrowed so a test can
 *  supply a double without reimplementing the whole client, and so this module
 *  cannot quietly grow a third GitHub effect. */
export type PublicationGhOps = Pick<GhOps, "listPRsForBranch" | "createPR">;
import { publicationGit, publicationGitOptional, revisionMatchesWorktree } from "./git-publication-substrate.js";
import {
  publicationJournalPath,
  publicationNextAction,
  readPublicationTransaction,
  writePublicationTransaction,
  type PublicationDurability,
  type PublicationPhase,
  type PublicationTransaction,
} from "./git-publication-journal.js";
import type { GitPublicationPreflight } from "./git-publication.js";

export class PublicationRefusedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PublicationRefusedError";
  }
}

export interface GitPublicationExecuteInput {
  preflight: GitPublicationPreflight;
  stateHome: string;
  /** Journal namespace: `org`, or `app-<name>`. */
  scope: string;
  surface: string;
  commitMessage: string;
  /** Absent means "push the branch and claim nothing more" — a non-GitHub
   *  remote is a supported setup, not a failure. */
  pullRequest?: { title: string; body: string };
  /** The command an operator would run to resume. Never the mutating command
   *  they already ran. */
  publishCommand: string;
  errorPrefix: string;
  now?: Date;
  gh?: PublicationGhOps;
  /** Content id the operator reviewed in the preview. A mismatch means the
   *  remote or the owned bytes moved in between: refuse, never overwrite. */
  expectedContentId?: string;
}

export async function executeGitPublication(input: GitPublicationExecuteInput): Promise<PublicationTransaction> {
  const { preflight } = input;
  if (preflight.blockers.length > 0) {
    throw new PublicationRefusedError("publication_blocked", preflight.blockers.join("\n"));
  }
  if (preflight.mode !== "publishable" || preflight.base === null || preflight.identity.origin_url === null) {
    throw new PublicationRefusedError(
      "publication_not_publishable",
      `${input.errorPrefix}: ${preflight.identity.root} has no publishable remote`,
    );
  }
  if (input.expectedContentId !== undefined && input.expectedContentId !== preflight.content_id) {
    throw new PublicationRefusedError(
      "publication_stale_preview",
      `${input.errorPrefix}: the remote or the owned content moved since the preview ` +
        `(${input.expectedContentId} -> ${preflight.content_id}) — preview again before executing`,
    );
  }

  const path = publicationJournalPath(input.stateHome, input.scope, preflight.content_id);
  const now = (input.now ?? new Date()).toISOString();
  const existing = await readPublicationTransaction(path);
  let transaction = existing ?? initialTransaction(input, now);
  if (existing === undefined) await writePublicationTransaction(path, transaction);

  // Already merged: the owned bytes are reachable from the resolved default
  // branch. Terminal, and reached without touching anything.
  if (preflight.reachable_at_base) {
    return persist(path, settle(transaction, "complete", "reachable_at_remote", input, now));
  }

  const root = preflight.identity.root;
  transaction = await ensureCommit(path, transaction, input, now);
  transaction = await ensurePushed(path, transaction, input, now);
  transaction = await ensurePullRequest(path, transaction, input, now);

  // A publish whose branch reached the remote and whose content is ALSO
  // already on the default branch (a human merged between steps) settles
  // terminal rather than reporting a merge that is no longer pending.
  if (preflight.owned_paths.every((entry) => revisionMatchesWorktree(root, preflight.base?.ref ?? "", entry.path))) {
    return persist(path, settle(transaction, "complete", "reachable_at_remote", input, now));
  }
  return transaction;
}

function initialTransaction(input: GitPublicationExecuteInput, now: string): PublicationTransaction {
  const { preflight } = input;
  if (preflight.base === null || preflight.identity.origin_url === null) {
    throw new PublicationRefusedError("publication_not_publishable", `${input.errorPrefix}: no publishable remote`);
  }
  return {
    schema_version: 1,
    kind: "git-publication",
    content_id: preflight.content_id,
    scope: input.scope,
    surface: input.surface,
    root: preflight.identity.root,
    origin_url: preflight.identity.origin_url,
    github_slug: preflight.identity.github_slug,
    base: preflight.base,
    branch: preflight.branch,
    owned_paths: preflight.owned_paths.map((entry) => entry.path),
    changed_paths: [...preflight.changed_paths],
    phase: "planned",
    durability: "recorded_locally",
    commit: null,
    pushed_commit: null,
    pull_request: null,
    next_action: publicationNextAction("recorded_locally", {
      branch: preflight.branch,
      defaultBranch: preflight.base.default_branch,
      publishCommand: input.publishCommand,
    }),
    created_at: now,
    updated_at: now,
  };
}

/** Build the publish commit in a throwaway worktree cut from the resolved base.
 *
 *  The operator's checkout is never moved: committing in place would need a
 *  `git checkout`, and both outcomes are bad — parking the org home on the
 *  publish branch changes what every later command reads, and switching back
 *  deletes the newly committed files from the operator's working tree. */
async function ensureCommit(
  path: string,
  transaction: PublicationTransaction,
  input: GitPublicationExecuteInput,
  now: string,
): Promise<PublicationTransaction> {
  if (transaction.phase !== "planned" && transaction.commit !== null) return transaction;
  const root = transaction.root;
  const worktree = mkdtempSync(join(tmpdir(), "cormidia-publication-"));
  rmSync(worktree, { recursive: true, force: true });
  publicationGit(root, ["worktree", "add", "--quiet", "--detach", worktree, transaction.base.ref], input.errorPrefix);
  let commit: string;
  try {
    for (const rel of transaction.changed_paths) {
      const from = join(root, rel);
      const to = join(worktree, rel);
      if (existsSync(from)) {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      } else {
        rmSync(to, { force: true });
      }
    }
    // Stage EXACTLY the owned paths. `--` guards pathspecs so a path that
    // looks like a rev cannot be reinterpreted as one, and the preflight
    // already proved nothing foreign is staged in the source repo.
    publicationGit(worktree, ["add", "--", ...transaction.changed_paths], input.errorPrefix);
    publicationGit(worktree, ["commit", "-m", input.commitMessage], input.errorPrefix);
    commit = publicationGit(worktree, ["rev-parse", "HEAD"], input.errorPrefix);
    publicationGit(worktree, ["branch", "-f", transaction.branch, "HEAD"], input.errorPrefix);
  } finally {
    publicationGitOptional(root, ["worktree", "remove", "--force", worktree]);
    rmSync(worktree, { recursive: true, force: true });
  }
  return persist(path, { ...transaction, phase: "committed", commit, updated_at: now });
}

async function ensurePushed(
  path: string,
  transaction: PublicationTransaction,
  input: GitPublicationExecuteInput,
  now: string,
): Promise<PublicationTransaction> {
  if (transaction.pushed_commit !== null) return transaction;
  const root = transaction.root;
  const commit = transaction.commit;
  if (commit === null) throw new PublicationRefusedError("publication_missing_commit", "no publication commit");
  const remoteRef = `refs/remotes/origin/${transaction.branch}`;
  publicationGitOptional(root, ["fetch", "--quiet", "origin", transaction.branch]);
  const remoteTip = publicationGitOptional(root, ["rev-parse", "--verify", "--quiet", remoteRef]);
  if (remoteTip !== undefined && remoteTip !== commit) {
    // Someone else's branch, or a previous run whose push landed under a
    // different commit id. Content decides; a difference is never overwritten.
    const matches = transaction.owned_paths.every((rel) => revisionMatchesWorktree(root, remoteRef, rel));
    if (!matches) {
      throw new PublicationRefusedError(
        "publication_remote_branch_diverged",
        `${input.errorPrefix}: origin/${transaction.branch} carries different content than this publication — ` +
          "it is never overwritten; inspect and delete or rename the remote branch, then re-run",
      );
    }
    return persist(path, advance(transaction, "pushed", "pending_merge", input, { pushed: remoteTip, now }));
  }
  if (remoteTip === undefined) {
    publicationGit(
      root,
      ["push", "origin", `refs/heads/${transaction.branch}:refs/heads/${transaction.branch}`],
      input.errorPrefix,
    );
  }
  return persist(path, advance(transaction, "pushed", "pending_merge", input, { pushed: commit, now }));
}

/** Open the branch's draft pull request, or adopt the one already open.
 *  Idempotent by construction, so a lost `gh pr create` response resolves to
 *  the existing pull request rather than a duplicate. */
async function ensurePullRequest(
  path: string,
  transaction: PublicationTransaction,
  input: GitPublicationExecuteInput,
  now: string,
): Promise<PublicationTransaction> {
  const slug = transaction.github_slug;
  if (slug === null || input.pullRequest === undefined) return transaction;
  if (transaction.pull_request !== null) return transaction;
  const gh = input.gh ?? new GhCliOps(slug);
  const existing = await gh.listPRsForBranch(transaction.branch, { state: "all" });
  const first = existing[0];
  const pr =
    first ??
    (await gh.createPR({
      head: transaction.branch,
      base: transaction.base.default_branch,
      title: input.pullRequest.title,
      body: input.pullRequest.body,
      // Draft, always. Cormidia opens the conversation; a human lands it.
      draft: true,
    }));
  const next: PublicationTransaction = {
    ...transaction,
    phase: "pull_request_open",
    pull_request: { number: pr.number, url: pr.url ?? null },
  };
  return persist(path, advance(next, "pull_request_open", "pending_merge", input, { pushed: null, now }));
}

function advance(
  transaction: PublicationTransaction,
  phase: PublicationPhase,
  durability: PublicationDurability,
  input: GitPublicationExecuteInput,
  detail: { pushed: string | null; now: string },
): PublicationTransaction {
  return {
    ...transaction,
    phase,
    durability,
    pushed_commit: detail.pushed ?? transaction.pushed_commit,
    next_action: publicationNextAction(durability, {
      branch: transaction.branch,
      defaultBranch: transaction.base.default_branch,
      pullRequestUrl: transaction.pull_request?.url ?? null,
      publishCommand: input.publishCommand,
    }),
    updated_at: detail.now,
  };
}

function settle(
  transaction: PublicationTransaction,
  phase: PublicationPhase,
  durability: PublicationDurability,
  input: GitPublicationExecuteInput,
  now: string,
): PublicationTransaction {
  return advance(transaction, phase, durability, input, { pushed: null, now });
}

async function persist(path: string, transaction: PublicationTransaction): Promise<PublicationTransaction> {
  await writePublicationTransaction(path, transaction);
  return transaction;
}
