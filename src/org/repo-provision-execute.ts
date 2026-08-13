// The journaled transaction for governed repository provisioning (#382).
//
// Five separately-resumable boundaries: resolve the repository into existence,
// build the bootstrap commit, wire the remote, push, install the canonical
// labels. This module owns the JOURNAL — each step records what became true —
// while the two steps with real hazards live next door: adoption evidence in
// `repo-provision-adopt.ts` (the only place a mistake makes a SECOND
// repository) and the git work in `repo-provision-git.ts` (the only place the
// operator's own checkout is at risk).
//
// A retry after a crash, a failed push, or a lost create response CONVERGES
// rather than duplicating, because every step asks GitHub and git what is
// already true instead of trusting a local flag. Nothing here force-pushes, and
// nothing here merges.

import { GhCliOps, type GhOps } from "../loop/github.js";
import { ProvisionAdoptionError, resolveRepository } from "./repo-provision-adopt.js";
import { CANONICAL_LABELS } from "../loop/plan-tickets.js";
import { buildBootstrapCommit, ProvisionGitRefusedError, pushBootstrapCommit } from "./repo-provision-git.js";
import {
  provisionJournalPath,
  provisionNextAction,
  readProvisionTransaction,
  writeProvisionTransaction,
  type ProvisionPhase,
  type RepositoryProvisionTransaction,
} from "./repo-provision-journal.js";
import type { RepositoryProvisionPreflight } from "./repo-provision.js";
import type { PublicationDurability } from "./git-publication-journal.js";

/** The exact GitHub surface provisioning needs. Narrowed so this module cannot
 *  quietly grow a sixth effect, and so a test supplies a double without
 *  reimplementing the whole client. */
export type ProvisionGhOps = Pick<GhOps, "readRepository" | "createRepository" | "ensureLabel" | "listLabels">;

export class ProvisionRefusedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProvisionRefusedError";
  }
}

export interface ExecuteRepositoryProvisionInput {
  preflight: RepositoryProvisionPreflight;
  stateHome: string;
  commitMessage: string;
  /** The command an operator would run to resume. Never the mutating command
   *  they already ran. */
  provisionCommand: string;
  verifyCommand: string;
  errorPrefix: string;
  now?: Date;
  gh?: ProvisionGhOps;
  /** Content id the operator reviewed in the preview. A mismatch means the
   *  target or the owned bytes moved in between: refuse, never proceed. */
  expectedContentId?: string;
  /** Deterministic crash injection for regression tests. A throw after the
   *  remote responded deliberately leaves the journal mid-phase so the next run
   *  must reconcile rather than repeat. */
  fault?: (boundary: "after_create" | "after_commit" | "after_push") => void | Promise<void>;
}

export async function executeRepositoryProvision(
  input: ExecuteRepositoryProvisionInput,
): Promise<RepositoryProvisionTransaction> {
  const { preflight } = input;
  if (preflight.blockers.length > 0) {
    throw new ProvisionRefusedError("provision_blocked", preflight.blockers.join("\n"));
  }
  const target = preflight.target;
  if (target === null) {
    throw new ProvisionRefusedError(
      "provision_unresolved_identity",
      `${input.errorPrefix}: the repository identity was never resolved — refusing before any GitHub call`,
    );
  }
  if (input.expectedContentId !== undefined && input.expectedContentId !== preflight.content_id) {
    throw new ProvisionRefusedError(
      "provision_stale_preview",
      `${input.errorPrefix}: the target or the owned content moved since the preview ` +
        `(${input.expectedContentId} -> ${preflight.content_id}) — preview again before executing`,
    );
  }

  const path = provisionJournalPath(input.stateHome, preflight.journal_scope, preflight.content_id);
  const now = (input.now ?? new Date()).toISOString();
  const existing = await readProvisionTransaction(path);
  let transaction = existing ?? initialTransaction(input, target.slug, now);
  if (existing === undefined) await writeProvisionTransaction(path, transaction);

  const gh = input.gh ?? new GhCliOps(target.slug);

  transaction = await ensureRepository(path, transaction, input, gh, now);
  await input.fault?.("after_create");
  transaction = await ensureCommit(path, transaction, input, now);
  await input.fault?.("after_commit");
  transaction = await ensurePushed(path, transaction, input, now);
  await input.fault?.("after_push");
  transaction = await ensureLabels(path, transaction, input, gh, now);

  return persist(path, advance(transaction, "complete", "reachable_at_remote", input, { now }));
}

/** Journal wrapper: resolve the repository into existence exactly once, then
 *  record HOW it came to exist. The adoption evidence rules live in
 *  repo-provision-adopt.ts. */
async function ensureRepository(
  path: string,
  transaction: RepositoryProvisionTransaction,
  input: ExecuteRepositoryProvisionInput,
  gh: ProvisionGhOps,
  now: string,
): Promise<RepositoryProvisionTransaction> {
  if (transaction.repository_origin !== null) return transaction;
  let origin: RepositoryProvisionTransaction["repository_origin"];
  try {
    origin = await resolveRepository(transaction, gh, input.errorPrefix);
  } catch (error) {
    // Re-typed so every refusal an operator can see carries one error shape and
    // one code vocabulary, whichever module raised it.
    if (error instanceof ProvisionAdoptionError) throw new ProvisionRefusedError(error.code, error.message);
    throw error;
  }
  return persist(
    path,
    advance({ ...transaction, repository_origin: origin }, "repository_created", "pending_publication", input, { now }),
  );
}

/** Journal wrapper: build the commit once, then record it. The git work itself
 *  lives in repo-provision-git.ts. */
async function ensureCommit(
  path: string,
  transaction: RepositoryProvisionTransaction,
  input: ExecuteRepositoryProvisionInput,
  now: string,
): Promise<RepositoryProvisionTransaction> {
  if (transaction.commit !== null) return transaction;
  const commit = buildBootstrapCommit(transaction, input.commitMessage, input.errorPrefix);
  return persist(path, advance({ ...transaction, commit }, "committed", "pending_publication", input, { now }));
}

/** Journal wrapper: push once, then record what actually reached the remote. */
async function ensurePushed(
  path: string,
  transaction: RepositoryProvisionTransaction,
  input: ExecuteRepositoryProvisionInput,
  now: string,
): Promise<RepositoryProvisionTransaction> {
  if (transaction.pushed_commit !== null) return transaction;
  const commit = transaction.commit;
  if (commit === null) throw new ProvisionRefusedError("provision_missing_commit", "no bootstrap commit");
  let pushed: string;
  try {
    pushed = pushBootstrapCommit(transaction, commit, input.errorPrefix);
  } catch (error) {
    // Re-typed so every refusal an operator can see carries one error shape and
    // one code vocabulary, whichever module raised it.
    if (error instanceof ProvisionGitRefusedError) throw new ProvisionRefusedError(error.code, error.message);
    throw error;
  }
  return persist(path, advance(transaction, "pushed", "pending_publication", input, { pushed, now }));
}

/** Install the canonical labels and CONFIRM them by reading back.
 *
 *  `ensureLabel` is `--force`, so re-running is idempotent and a half-installed
 *  set simply completes. The readback is what makes the transaction honest: a
 *  label whose create succeeded but whose definition drifted, or one that never
 *  landed, must not be recorded as installed. */
async function ensureLabels(
  path: string,
  transaction: RepositoryProvisionTransaction,
  input: ExecuteRepositoryProvisionInput,
  gh: ProvisionGhOps,
  now: string,
): Promise<RepositoryProvisionTransaction> {
  // Attempt EVERY label before judging. A per-label failure is collected rather
  // than thrown: stopping at the first one would leave a partial set AND hide
  // how partial it is, and the readback below is the real verdict anyway. This
  // is also what makes a half-installed set converge — the labels that landed
  // stay landed, and the next run only has the rest to do.
  const failures: string[] = [];
  for (const label of CANONICAL_LABELS) {
    try {
      await gh.ensureLabel({ name: label.name, color: label.color, description: label.description });
    } catch (error) {
      failures.push(`${label.name} (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`);
    }
  }
  let present: Map<string, { name: string; color: string; description: string }>;
  try {
    present = new Map((await gh.listLabels()).map((label) => [label.name, label]));
  } catch (error) {
    throw new ProvisionRefusedError(
      "provision_labels_unverified",
      `${input.errorPrefix}: could not read ${transaction.slug}'s labels back, so whether they installed is ` +
        `unknown — ${error instanceof Error ? error.message : String(error)}. The repository exists and the ` +
        `bootstrap commit is pushed; re-run \`${input.provisionCommand}\` once GitHub is reachable.`,
    );
  }
  const installed = CANONICAL_LABELS.filter((expected) => {
    const found = present.get(expected.name);
    return (
      found !== undefined &&
      found.color.toLowerCase() === expected.color.toLowerCase() &&
      found.description === expected.description
    );
  }).map((label) => label.name);

  if (installed.length !== CANONICAL_LABELS.length) {
    const missing = CANONICAL_LABELS.filter((label) => !installed.includes(label.name)).map((label) => label.name);
    throw new ProvisionRefusedError(
      "provision_labels_incomplete",
      `${input.errorPrefix}: ${missing.length} canonical label(s) are still missing or drifted on ` +
        `${transaction.slug} (${missing.join(", ")}) — the repository exists and the bootstrap commit is pushed, ` +
        `so re-run \`${input.provisionCommand}\` to finish; it resumes rather than recreating anything` +
        (failures.length > 0 ? `. Install errors: ${failures.join("; ")}` : ""),
    );
  }
  return persist(
    path,
    advance({ ...transaction, labels_installed: installed }, "labels_installed", "pending_publication", input, { now }),
  );
}

function initialTransaction(
  input: ExecuteRepositoryProvisionInput,
  slug: string,
  now: string,
): RepositoryProvisionTransaction {
  const { preflight } = input;
  return {
    schema_version: 1,
    kind: "repository-provision",
    content_id: preflight.content_id,
    idempotency_key: preflight.idempotency_key,
    scope: preflight.journal_scope,
    slug,
    root: preflight.source_root,
    visibility: "private",
    remote_name: preflight.remote_name,
    remote_url: preflight.remote_url,
    branch: preflight.push_branch,
    owned_paths: preflight.owned_paths.map((entry) => entry.path),
    phase: "planned",
    durability: "recorded_locally",
    repository_origin: null,
    commit: null,
    pushed_commit: null,
    labels_installed: [],
    next_action: provisionNextAction("recorded_locally", {
      slug,
      branch: preflight.push_branch,
      provisionCommand: input.provisionCommand,
      verifyCommand: input.verifyCommand,
    }),
    created_at: now,
    updated_at: now,
  };
}

function advance(
  transaction: RepositoryProvisionTransaction,
  phase: ProvisionPhase,
  durability: PublicationDurability,
  input: ExecuteRepositoryProvisionInput,
  detail: { pushed?: string | null; now: string },
): RepositoryProvisionTransaction {
  return {
    ...transaction,
    phase,
    durability,
    pushed_commit: detail.pushed ?? transaction.pushed_commit,
    next_action: provisionNextAction(durability, {
      slug: transaction.slug,
      branch: transaction.branch,
      provisionCommand: input.provisionCommand,
      verifyCommand: input.verifyCommand,
    }),
    updated_at: detail.now,
  };
}

async function persist(
  path: string,
  transaction: RepositoryProvisionTransaction,
): Promise<RepositoryProvisionTransaction> {
  await writeProvisionTransaction(path, transaction);
  return transaction;
}
