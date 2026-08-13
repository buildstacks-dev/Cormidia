// The durable record of a repository provisioning (#382).
//
// Creating a repository is the one outward act in onboarding that a retry
// cannot simply repeat: a second attempt does not overwrite the first, it
// either fails or makes a SECOND repository. So the transaction is journaled
// by content identity and every step re-derives what is already true from
// GitHub and git rather than from a local success flag.
//
// The durability vocabulary is #388's, unchanged, because the question is the
// same one: does Cormidia's claim have evidence behind it? Provisioning reaches
// `reachable_at_remote` without passing through `pending_merge` — a brand-new
// repository's genesis commit has no default branch to open a pull request
// against, and nothing to review it away from.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeLoopFileAtomic } from "../loop/durable.js";
import { PUBLICATION_DURABILITY_STATES, type PublicationDurability } from "./git-publication-journal.js";

/** Where the transaction got to. Each boundary is separately resumable, and
 *  each is a fact about the remote rather than about this process. */
const PROVISION_PHASES = [
  "planned",
  "repository_created",
  "committed",
  "pushed",
  "labels_installed",
  "complete",
] as const;

export type ProvisionPhase = (typeof PROVISION_PHASES)[number];

/** How the repository came to exist. `adopted_*` records that this run did NOT
 *  create it, which is what keeps a duplicate from ever being made and what an
 *  operator needs to see in the journal. */
export type ProvisionRepositoryOrigin = "created" | "adopted_marker" | "adopted_empty" | "adopted_content";

export interface RepositoryProvisionTransaction {
  schema_version: 1;
  kind: "repository-provision";
  content_id: string;
  idempotency_key: string;
  /** Journal namespace — `org`, or `app-<name>`. */
  scope: string;
  slug: string;
  root: string;
  visibility: "private";
  remote_name: string;
  remote_url: string;
  branch: string;
  owned_paths: string[];
  phase: ProvisionPhase;
  durability: PublicationDurability;
  repository_origin: ProvisionRepositoryOrigin | null;
  commit: string | null;
  pushed_commit: string | null;
  /** Canonical labels confirmed present on the remote, by name. */
  labels_installed: string[];
  /** Exact next action for the operator. Never "run the command again". */
  next_action: string;
  created_at: string;
  updated_at: string;
}

export function provisionJournalPath(stateHome: string, scope: string, contentId: string): string {
  return join(stateHome, "provision", scope.replaceAll(/[^a-zA-Z0-9._-]+/g, "-"), `${contentId}.json`);
}

export async function writeProvisionTransaction(
  path: string,
  transaction: RepositoryProvisionTransaction,
): Promise<void> {
  await writeLoopFileAtomic(path, `${JSON.stringify(transaction, null, 2)}\n`);
}

/** Read a journal entry, or undefined when there is none.
 *
 *  A torn or tampered entry THROWS rather than reading as absent. Losing a
 *  provisioning transaction silently is precisely how a second repository gets
 *  created (INV-013: readers expose old valid, new valid, or a recognized
 *  intermediate — never garbage). */
export async function readProvisionTransaction(path: string): Promise<RepositoryProvisionTransaction | undefined> {
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
    throw new Error(`provision journal ${path} is not valid JSON: ${error instanceof Error ? error.message : ""}`);
  }
  return parseProvisionTransaction(parsed, path);
}

/** Every recorded provisioning for a scope, newest first. Answers "is there
 *  already a transaction in flight for this target?" without asking GitHub. */
export async function listProvisionTransactions(
  stateHome: string,
  scope: string,
): Promise<RepositoryProvisionTransaction[]> {
  const directory = dirname(provisionJournalPath(stateHome, scope, "x"));
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  const transactions: RepositoryProvisionTransaction[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const transaction = await readProvisionTransaction(join(directory, entry));
    if (transaction !== undefined) transactions.push(transaction);
  }
  return transactions.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

/** Parse, don't cast: everything crossing this trust boundary is validated and
 *  the type flows from the validator. */
export function parseProvisionTransaction(value: unknown, source: string): RepositoryProvisionTransaction {
  const record = asRecord(value, source);
  if (record["schema_version"] !== 1 || record["kind"] !== "repository-provision") {
    throw new Error(`provision journal ${source} is not a v1 repository-provision record`);
  }
  return {
    schema_version: 1,
    kind: "repository-provision",
    content_id: asString(record["content_id"], `${source}.content_id`),
    idempotency_key: asString(record["idempotency_key"], `${source}.idempotency_key`),
    scope: asString(record["scope"], `${source}.scope`),
    slug: asString(record["slug"], `${source}.slug`),
    root: asString(record["root"], `${source}.root`),
    visibility: "private",
    remote_name: asString(record["remote_name"], `${source}.remote_name`),
    remote_url: asString(record["remote_url"], `${source}.remote_url`),
    branch: asString(record["branch"], `${source}.branch`),
    owned_paths: asStringArray(record["owned_paths"], `${source}.owned_paths`),
    phase: asPhase(record["phase"], `${source}.phase`),
    durability: asDurability(record["durability"], `${source}.durability`),
    repository_origin: asOrigin(record["repository_origin"], `${source}.repository_origin`),
    commit: asNullableString(record["commit"], `${source}.commit`),
    pushed_commit: asNullableString(record["pushed_commit"], `${source}.pushed_commit`),
    labels_installed: asStringArray(record["labels_installed"], `${source}.labels_installed`),
    next_action: asString(record["next_action"], `${source}.next_action`),
    created_at: asString(record["created_at"], `${source}.created_at`),
    updated_at: asString(record["updated_at"], `${source}.updated_at`),
  };
}

/** The operator-facing sentence for a provisioning state. It always names a
 *  transition that is not the command they just ran. */
export function provisionNextAction(
  durability: PublicationDurability,
  detail: { slug: string; branch: string; provisionCommand: string; verifyCommand: string },
): string {
  if (durability === "recorded_locally") return `run \`${detail.provisionCommand}\` to create ${detail.slug}`;
  if (durability === "pending_publication") {
    return (
      `the provisioning transaction is incomplete — re-run \`${detail.provisionCommand}\` to resume it; ` +
      "it reconciles against what already exists and never creates a second repository"
    );
  }
  if (durability === "reachable_at_remote") {
    return (
      `none — ${detail.slug} exists privately with the bootstrap commit on ${detail.branch}; ` +
      `\`${detail.verifyCommand}\` re-proves it`
    );
  }
  return `${detail.slug} is not reachable — inspect the transaction before re-running`;
}

function isNotFound(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown, source: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`provision journal ${source} is not an object`);
  return value;
}

function asString(value: unknown, source: string): string {
  if (typeof value !== "string") throw new Error(`provision journal ${source} is not a string`);
  return value;
}

function asNullableString(value: unknown, source: string): string | null {
  if (value === null || value === undefined) return null;
  return asString(value, source);
}

function asStringArray(value: unknown, source: string): string[] {
  if (!Array.isArray(value)) throw new Error(`provision journal ${source} is not an array`);
  return value.map((entry, index) => asString(entry, `${source}[${index}]`));
}

function asPhase(value: unknown, source: string): ProvisionPhase {
  const phase = PROVISION_PHASES.find((candidate) => candidate === value);
  if (phase === undefined) {
    throw new Error(`provision journal ${source} is not a known phase: ${JSON.stringify(value)}`);
  }
  return phase;
}

function asDurability(value: unknown, source: string): PublicationDurability {
  const durability = PUBLICATION_DURABILITY_STATES.find((candidate) => candidate === value);
  if (durability === undefined) {
    throw new Error(`provision journal ${source} is not a known durability state: ${JSON.stringify(value)}`);
  }
  return durability;
}

function asOrigin(value: unknown, source: string): ProvisionRepositoryOrigin | null {
  if (value === null || value === undefined) return null;
  const origin = (["created", "adopted_marker", "adopted_empty", "adopted_content"] as const).find(
    (candidate) => candidate === value,
  );
  if (origin === undefined) {
    throw new Error(`provision journal ${source} is not a known repository origin: ${JSON.stringify(value)}`);
  }
  return origin;
}
