// Compatibility readers for the forked engine's active binding artifacts
// (compatibility-policy record §3a): `learning_publish` approval items and
// `<state home>/learning/publish-journal/*.json`. Read-only and
// `unknown`-first: the kernel path never raises a `learning_publish` item,
// never migrates one into a kernel authorization, and never rewrites a
// journal — it only needs to know whether the fork already completed a
// publish for a candidate (terminal; never redone) or left one mid-flight on
// a root (the canary start gate).

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ApprovalItem, ApprovalStore } from "../approvals.js";
import { sanitizeIdSegment } from "../learning/events.js";

export const LEGACY_PUBLISH_TOOL = "learning_publish";

export interface LegacyPublishBinding {
  readonly kind: typeof LEGACY_PUBLISH_TOOL;
  readonly candidate_id: string;
  readonly candidate_hash: string;
  readonly verdict_hash: string;
  readonly destination: string;
  readonly tier: string;
  readonly scope: string;
  readonly base_manifest_version: string;
  readonly final_diff_hash: string;
  readonly waivers: readonly string[];
}

function text(spec: object, key: string): string | undefined {
  const value: unknown = Reflect.get(spec, key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The forked binding an approval item carries, when it is a legacy learning publish. */
export function legacyPublishBindingOf(item: ApprovalItem): LegacyPublishBinding | undefined {
  if (item.action.tool !== LEGACY_PUBLISH_TOOL) return undefined;
  const input = item.action.input;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  if (Reflect.get(input, "kind") !== LEGACY_PUBLISH_TOOL) return undefined;
  const fields = [
    "candidate_id",
    "candidate_hash",
    "verdict_hash",
    "destination",
    "tier",
    "scope",
    "base_manifest_version",
    "final_diff_hash",
  ] as const;
  const values: Partial<Record<(typeof fields)[number], string>> = {};
  for (const field of fields) {
    const value = text(input, field);
    if (value === undefined) return undefined;
    values[field] = value;
  }
  const waivers: unknown = Reflect.get(input, "waivers");
  if (!Array.isArray(waivers) || waivers.some((entry) => typeof entry !== "string")) return undefined;
  return {
    kind: LEGACY_PUBLISH_TOOL,
    candidate_id: values.candidate_id ?? "",
    candidate_hash: values.candidate_hash ?? "",
    verdict_hash: values.verdict_hash ?? "",
    destination: values.destination ?? "",
    tier: values.tier ?? "",
    scope: values.scope ?? "",
    base_manifest_version: values.base_manifest_version ?? "",
    final_diff_hash: values.final_diff_hash ?? "",
    waivers: waivers.filter((entry): entry is string => typeof entry === "string"),
  };
}

/** Newest legacy learning_publish item for a candidate in the given queue. */
export async function findLegacyPublishItem(
  store: ApprovalStore,
  candidateId: string,
  queue: "pending" | "decided",
): Promise<ApprovalItem | undefined> {
  const items = queue === "pending" ? await store.listPending() : await store.listDecidedReadOnly();
  return items.filter((item) => legacyPublishBindingOf(item)?.candidate_id === candidateId).at(-1);
}

export interface LegacyPublishJournal {
  readonly journal_id: string;
  readonly candidate_id: string;
  readonly destination: string;
  readonly scope: string;
  readonly approval_ref: string | null;
  readonly manifest_version?: string;
  readonly intervention_id?: string;
  readonly done_at?: string;
}

function journalDir(stateHome: string): string {
  return join(stateHome, "learning", "publish-journal");
}

function parseJournal(raw: string, path: string): LegacyPublishJournal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`learning-loop: legacy publish journal ${path} is not JSON`);
  }
  if (parsed === null || typeof parsed !== "object") throw new Error(`learning-loop: ${path} must be an object`);
  const journalId = text(parsed, "journal_id");
  const candidateId = text(parsed, "candidate_id");
  const destination = text(parsed, "destination");
  const scope = text(parsed, "scope");
  if (journalId === undefined || candidateId === undefined || destination === undefined || scope === undefined) {
    throw new Error(`learning-loop: ${path} is not a forked publish journal`);
  }
  const approvalRef = text(parsed, "approval_ref") ?? null;
  const manifestVersion = text(parsed, "manifest_version");
  const interventionId = text(parsed, "intervention_id");
  const doneAt = text(parsed, "done_at");
  return {
    journal_id: journalId,
    candidate_id: candidateId,
    destination,
    scope,
    approval_ref: approvalRef,
    ...(manifestVersion !== undefined ? { manifest_version: manifestVersion } : {}),
    ...(interventionId !== undefined ? { intervention_id: interventionId } : {}),
    ...(doneAt !== undefined ? { done_at: doneAt } : {}),
  };
}

export async function readLegacyPublishJournal(
  stateHome: string,
  journalId: string,
): Promise<LegacyPublishJournal | undefined> {
  const path = join(journalDir(stateHome), `${sanitizeIdSegment(journalId)}.json`);
  if (!existsSync(path)) return undefined;
  return parseJournal(await readFile(path, "utf8"), path);
}

/** Forked OKF publish journals on a root kind that never reached `done_at`
 *  — the canary start gate's "mid-transaction" check, preserved. */
export async function listInFlightLegacyJournals(stateHome: string, rootKind: "org" | "app"): Promise<string[]> {
  const dir = journalDir(stateHome);
  if (!existsSync(dir)) return [];
  const ids: string[] = [];
  for (const name of (await readdir(dir)).filter((entry) => entry.endsWith(".json")).sort()) {
    let journal: LegacyPublishJournal;
    try {
      journal = parseJournal(await readFile(join(dir, name), "utf8"), join(dir, name));
    } catch {
      continue; // a torn legacy journal is history; it cannot resume on the kernel path
    }
    const kind = journal.scope.startsWith("apps/") ? "app" : "org";
    if (journal.done_at === undefined && journal.destination === "okf_concept" && kind === rootKind) {
      ids.push(journal.journal_id);
    }
  }
  return ids;
}
