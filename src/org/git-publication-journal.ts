// The durable half of a committed-configuration publication (#388, #389):
// typed durability states and the journal that makes a retry converge.
//
// The bug this replaces was a vocabulary bug as much as a plumbing bug.
// `app-created-and-registered`, `promoted`, and `recorded` are terminal
// claims — they say the org's configuration IS this now. A working-tree write
// cannot support that claim while the remote still says otherwise, and INV-008
// is explicit that no observable state claims more than its evidence. So the
// claim is split into the states below, and only ONE of them is terminal.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeLoopFileAtomic } from "../loop/durable.js";

/** Durability, from weakest to terminal. `reachable_at_remote` is the only
 *  state a command may describe as done. */
export const PUBLICATION_DURABILITY_STATES = [
  /** No remote exists. Recorded here, and Cormidia claims nothing beyond this
   *  working tree — the explicit local-only contract, never a silent one. */
  "local_only",
  /** Written locally; no publication has been attempted. */
  "recorded_locally",
  /** A publication transaction exists but has not reached the remote. */
  "pending_publication",
  /** On the remote, awaiting human review/merge. */
  "pending_merge",
  /** The exact bytes are reachable from the resolved remote default branch. */
  "reachable_at_remote",
] as const;

export type PublicationDurability = (typeof PUBLICATION_DURABILITY_STATES)[number];

/** Where the transaction got to. Distinct from durability: `pushed` is a fact
 *  about git, `pending_merge` is a claim about org truth. */
const PUBLICATION_PHASES = ["planned", "committed", "pushed", "pull_request_open", "complete"] as const;

export type PublicationPhase = (typeof PUBLICATION_PHASES)[number];

export interface PublicationTransaction {
  schema_version: 1;
  kind: "git-publication";
  /** Content-bound: same scope + base + bytes means the same transaction. */
  content_id: string;
  /** Journal namespace — `org` for an org home, `app:<name>` for an app repo. */
  scope: string;
  /** Which committed surface this publishes; the inventory's id. */
  surface: string;
  root: string;
  origin_url: string;
  github_slug: string | null;
  base: { ref: string; default_branch: string; commit: string };
  branch: string;
  owned_paths: string[];
  changed_paths: string[];
  phase: PublicationPhase;
  durability: PublicationDurability;
  commit: string | null;
  pushed_commit: string | null;
  pull_request: { number: number; url: string | null } | null;
  /** Exact next action for the operator. Never "run the command again". */
  next_action: string;
  created_at: string;
  updated_at: string;
}

export function publicationJournalPath(stateHome: string, scope: string, contentId: string): string {
  return join(stateHome, "publication", scope.replaceAll(/[^a-zA-Z0-9._-]+/g, "-"), `${contentId}.json`);
}

export async function writePublicationTransaction(path: string, transaction: PublicationTransaction): Promise<void> {
  await writeLoopFileAtomic(path, `${JSON.stringify(transaction, null, 2)}\n`);
}

/** Read a journal entry, or undefined when there is none.
 *
 *  A torn or tampered entry throws rather than being treated as absent: losing
 *  a transaction silently is how a second publication opens a duplicate pull
 *  request (INV-013 — readers expose old valid, new valid, or a recognized
 *  intermediate, never garbage). */
export async function readPublicationTransaction(path: string): Promise<PublicationTransaction | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`publication journal ${path} is not valid JSON: ${error instanceof Error ? error.message : ""}`);
  }
  return parsePublicationTransaction(parsed, path);
}

/** Every recorded transaction for a scope, newest first, optionally narrowed
 *  to one surface. Used to answer "is there already a publication in flight for
 *  this change?" without re-deriving it from the remote. */
export async function listPublicationTransactions(
  stateHome: string,
  scope: string,
  surface?: string,
): Promise<PublicationTransaction[]> {
  const directory = dirname(publicationJournalPath(stateHome, scope, "x"));
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  const transactions: PublicationTransaction[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const transaction = await readPublicationTransaction(join(directory, entry));
    if (transaction !== undefined && (surface === undefined || transaction.surface === surface)) {
      transactions.push(transaction);
    }
  }
  return transactions.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

/** Parse, don't cast: everything crossing this trust boundary is validated and
 *  the type flows from the validator. */
export function parsePublicationTransaction(value: unknown, source: string): PublicationTransaction {
  const record = asRecord(value, source);
  if (record["schema_version"] !== 1 || record["kind"] !== "git-publication") {
    throw new Error(`publication journal ${source} is not a v1 git-publication record`);
  }
  const base = asRecord(record["base"], `${source}.base`);
  const pullRequest = record["pull_request"];
  return {
    schema_version: 1,
    kind: "git-publication",
    content_id: asString(record["content_id"], `${source}.content_id`),
    scope: asString(record["scope"], `${source}.scope`),
    surface: asString(record["surface"], `${source}.surface`),
    root: asString(record["root"], `${source}.root`),
    origin_url: asString(record["origin_url"], `${source}.origin_url`),
    github_slug: asNullableString(record["github_slug"], `${source}.github_slug`),
    base: {
      ref: asString(base["ref"], `${source}.base.ref`),
      default_branch: asString(base["default_branch"], `${source}.base.default_branch`),
      commit: asString(base["commit"], `${source}.base.commit`),
    },
    branch: asString(record["branch"], `${source}.branch`),
    owned_paths: asStringArray(record["owned_paths"], `${source}.owned_paths`),
    changed_paths: asStringArray(record["changed_paths"], `${source}.changed_paths`),
    phase: asPhase(record["phase"], `${source}.phase`),
    durability: asDurability(record["durability"], `${source}.durability`),
    commit: asNullableString(record["commit"], `${source}.commit`),
    pushed_commit: asNullableString(record["pushed_commit"], `${source}.pushed_commit`),
    pull_request: pullRequest === null || pullRequest === undefined ? null : asPullRequest(pullRequest, source),
    next_action: asString(record["next_action"], `${source}.next_action`),
    created_at: asString(record["created_at"], `${source}.created_at`),
    updated_at: asString(record["updated_at"], `${source}.updated_at`),
  };
}

/** The operator-facing sentence for a durability state. It must always name a
 *  transition that is not the command they just ran (#389's remediation loop). */
export function publicationNextAction(
  durability: PublicationDurability,
  detail: { branch: string; defaultBranch: string; pullRequestUrl?: string | null; publishCommand: string },
): string {
  if (durability === "local_only") {
    return "org home has no configured remote — this change is local-only; configure a remote to make it recoverable";
  }
  if (durability === "recorded_locally") return `run \`${detail.publishCommand}\` to publish it for review`;
  if (durability === "pending_publication") {
    return `the publication transaction is incomplete — re-run \`${detail.publishCommand}\` to resume it`;
  }
  if (durability === "pending_merge") {
    const where = detail.pullRequestUrl ?? `branch ${detail.branch}`;
    return `review and merge ${where} into ${detail.defaultBranch}; the change is not org truth until it lands`;
  }
  return "none — the change is reachable from the remote default branch";
}

/** ENOENT, narrowed instead of asserted. */
function isNotFound(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown, source: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`publication journal ${source} is not an object`);
  return value;
}

function asString(value: unknown, source: string): string {
  if (typeof value !== "string") throw new Error(`publication journal ${source} is not a string`);
  return value;
}

function asNullableString(value: unknown, source: string): string | null {
  if (value === null || value === undefined) return null;
  return asString(value, source);
}

function asStringArray(value: unknown, source: string): string[] {
  if (!Array.isArray(value)) throw new Error(`publication journal ${source} is not an array`);
  return value.map((entry, index) => asString(entry, `${source}[${index}]`));
}

function asPhase(value: unknown, source: string): PublicationPhase {
  const phase = PUBLICATION_PHASES.find((candidate) => candidate === value);
  if (phase === undefined) {
    throw new Error(`publication journal ${source} is not a known phase: ${JSON.stringify(value)}`);
  }
  return phase;
}

function asDurability(value: unknown, source: string): PublicationDurability {
  const durability = PUBLICATION_DURABILITY_STATES.find((candidate) => candidate === value);
  if (durability === undefined) {
    throw new Error(`publication journal ${source} is not a known durability state: ${JSON.stringify(value)}`);
  }
  return durability;
}

function asPullRequest(value: unknown, source: string): { number: number; url: string | null } {
  const record = asRecord(value, `${source}.pull_request`);
  const number = record["number"];
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`publication journal ${source}.pull_request.number is not a positive integer`);
  }
  return { number, url: asNullableString(record["url"], `${source}.pull_request.url`) };
}
