// Publication transaction over the planning ledger (F-PT-039 / #386).
//
// This replaces the transactional half of the retired planning-coverage store.
// The revision chain it used to carry (`revision-<n>.json`, predecessor digests,
// orphan promotion) went with `--revise`: revisions existed to version a source
// DECOMPOSITION Cormidia derived from bytes it had pre-read, and there are no
// such revisions now. What survives — and is the whole point of this module —
// is the prepared→completed barrier that keeps GitHub issue creation
// at-most-once across a crash.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeLoopFileAtomic } from "../loop/durable.js";
import { stableHash } from "../loop/episode-plan.js";
import type {
  PlanningSourceTicketEvidence,
  PlanProvenance,
  PublishedTicket,
  TicketPlan,
} from "../loop/plan-tickets.js";
import { planningAppDir } from "./planning-artifact-path.js";
import {
  isPlanningPublicationLedger,
  type PlanningPublicationLedger,
  type PlanningTicketState,
} from "./planning-publication-ledger.js";

const PLANNED: PlanningTicketState = "planned";

export function planningLedgerPath(root: string, app: string, scopeId: string): string {
  return join(planningAppDir(root, app), "publication", `${scopeId}.json`);
}

export async function readPlanningLedger(
  root: string,
  app: string,
  scopeId: string,
): Promise<PlanningPublicationLedger | undefined> {
  const path = planningLedgerPath(root, app, scopeId);
  if (!existsSync(path)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`planning publication ledger is unreadable or corrupt at ${path}`, { cause: error });
  }
  if (!isPlanningPublicationLedger(value) || value.app !== app || value.scope_id !== scopeId) {
    throw new Error(`planning publication ledger is unreadable or corrupt at ${path}`);
  }
  return value;
}

/** Record an accepted TicketPlan as the publishable ledger for this scope.
 * A ledger with a prepared batch is never overwritten — recovering that batch
 * is the caller's obligation before any new planning work. */
export async function recordPlanningLedger(input: {
  root: string;
  app: string;
  scopeId: string;
  planningIntentHash: string;
  plan: TicketPlan;
  provenance: PlanProvenance;
  sourceEvidence?: PlanningSourceTicketEvidence;
  now: Date;
}): Promise<PlanningPublicationLedger> {
  const existing = await readPlanningLedger(input.root, input.app, input.scopeId);
  if (existing?.publication_batches.some((batch) => batch.status === "prepared") === true) {
    throw new Error("planning publication ledger has a prepared batch; recover it before recording a new plan");
  }
  const ledger: PlanningPublicationLedger = {
    schema_version: 1,
    kind: "planning-publication-ledger",
    app: input.app,
    scope_id: input.scopeId,
    planning_intent_hash: input.planningIntentHash,
    plan: input.plan,
    provenance: { ...input.provenance },
    source_evidence: input.sourceEvidence ?? null,
    tickets: input.plan.tickets.map((_, index) => ({
      identity: `${stableHash({ scope: input.scopeId, index, plan: stableHash(input.plan) }).slice(0, 20)}`,
      plan_index: index,
      state: PLANNED,
      issue_number: null,
      provenance: { ...input.provenance },
    })),
    publication_batches: [],
    updated_at: input.now.toISOString(),
  };
  await writeLedger(input.root, ledger);
  return ledger;
}

/** Select the next bounded batch of publishable tickets and durably mark it
 * prepared BEFORE any issue is created. An existing prepared batch is returned
 * as-is so a crashed run resumes the same batch instead of minting a second. */
export async function preparePlanningPublication(input: {
  root: string;
  app: string;
  scopeId: string;
  cap: number;
  now: Date;
}): Promise<{ ledger: PlanningPublicationLedger; indexes: number[] }> {
  const ledger = await readPlanningLedger(input.root, input.app, input.scopeId);
  if (ledger === undefined) throw new Error("planning publication ledger is missing");
  const pending = ledger.publication_batches.find((batch) => batch.status === "prepared");
  if (pending !== undefined) return { ledger, indexes: [...pending.indexes] };

  const admitted = new Set(
    ledger.tickets
      .filter((ticket) => ticket.state !== "planned" && ticket.state !== "superseded")
      .map((t) => t.plan_index),
  );
  const selected: number[] = [];
  for (const ticket of ledger.tickets
    .filter((entry) => entry.state === "planned")
    .sort((left, right) => left.plan_index - right.plan_index)) {
    if (selected.length >= input.cap) break;
    const planned = ledger.plan.tickets[ticket.plan_index];
    if (planned === undefined) throw new Error(`ledger ticket ${ticket.plan_index} has no plan entry`);
    if (planned.dependsOn.every((dependency) => admitted.has(dependency))) {
      selected.push(ticket.plan_index);
      admitted.add(ticket.plan_index);
    }
  }
  if (selected.length === 0) return { ledger, indexes: [] };
  ledger.publication_batches.push({
    batch_id: `batch-${ledger.publication_batches.length + 1}-${stableHash(selected).slice(0, 12)}`,
    indexes: selected,
    admission_cap: input.cap,
    status: "prepared",
    provenance: { ...ledger.provenance },
  });
  ledger.updated_at = input.now.toISOString();
  await writeLedger(input.root, ledger);
  return { ledger, indexes: selected };
}

/** Close the prepared batch with the issue numbers GitHub actually returned.
 * Completion is the final barrier: until this lands, a resumed run re-reads the
 * prepared batch rather than publishing again. */
export async function completePlanningPublication(input: {
  root: string;
  app: string;
  scopeId: string;
  published: readonly PublishedTicket[];
  now: Date;
}): Promise<PlanningPublicationLedger> {
  const ledger = await readPlanningLedger(input.root, input.app, input.scopeId);
  if (ledger === undefined) throw new Error("planning publication ledger is missing");
  const batch = ledger.publication_batches.find((candidate) => candidate.status === "prepared");
  if (batch === undefined) return ledger;
  const byIndex = new Map(input.published.map((ticket) => [ticket.index, ticket]));
  for (const index of batch.indexes) {
    const published = byIndex.get(index);
    if (published === undefined) throw new Error(`publication omitted prepared ticket ${index}`);
    const ticket = ledger.tickets.find((candidate) => candidate.plan_index === index);
    if (ticket === undefined) throw new Error(`prepared ticket ${index} is missing from the ledger`);
    ticket.state = "published";
    ticket.issue_number = published.issueNumber;
  }
  batch.status = "completed";
  ledger.updated_at = input.now.toISOString();
  await writeLedger(input.root, ledger);
  return ledger;
}

async function writeLedger(root: string, ledger: PlanningPublicationLedger): Promise<void> {
  await writeLoopFileAtomic(
    planningLedgerPath(root, ledger.app, ledger.scope_id),
    `${JSON.stringify(ledger, null, 2)}\n`,
  );
}
