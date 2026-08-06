import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GateFn, ToolAction } from "../runtime/types.js";
import { approvalLifecycleState, ApprovalStore } from "./approvals.js";
import { githubIssueCreateAction, type DeliveryFailureCause } from "./approval-delivery.js";
import type { TurnEvent } from "./journal.js";
import { canonicalJson, sha256 } from "./scheduler/model.js";
import { writeFileAtomic } from "./atomic.js";

export type StandingRole = "sre" | "support" | "marketing";

export interface StandingRoleArtifact {
  schema_version: 1;
  artifact_id: string;
  app: string;
  role: StandingRole;
  event_kind: string;
  event_key: string;
  source: TurnEvent["source"];
  source_payload_sha256: string;
  occurred_at: string;
  created_at: string;
  draft_only: true;
  outward_effects: [];
  approval_state: "not_requested" | "parked";
  draft: string;
  provider_summary_sha256: string;
  /** Analysis and filing are distinct facts. The draft can be complete while
   * the content-bound incident action is still awaiting approval/execution. */
  delivery?: StandingRoleDelivery;
}

export interface StandingRoleDelivery {
  kind: "github_issue";
  analysis_state: "complete";
  filing_state: "pending_approval" | "ready" | "executing" | "filed" | "failed" | "ambiguous" | "gate_denied";
  repo: string;
  required_label: "op:incident";
  source_event_key: string;
  idempotency_key: string;
  approval_id?: string;
  failure_cause?: DeliveryFailureCause;
  reason?: string;
}

export interface PlannerFeedRecord {
  schema_version: 2;
  feed_id: string;
  app: string;
  producer_role: StandingRole | "legacy-unknown";
  event_kind: string;
  event_key: string;
  event_source: TurnEvent["source"];
  source_identity_sha256: string;
  source_payload_sha256: string;
  artifact_id: string;
  created_at: string;
  status: "pending" | "consumed" | "superseded" | "expired";
  lifecycle: {
    consumed_at?: string;
    consumed_by_turn?: string;
    consumption_id?: string;
    superseded_at?: string;
    superseded_by?: string;
    expired_at?: string;
    expired_from?: "consumed" | "superseded";
  };
  summary: string;
}

interface LegacyPlannerFeedRecord {
  schema_version: 1;
  feed_id: string;
  app: string;
  event_kind: string;
  event_key: string;
  source_payload_sha256: string;
  artifact_id: string;
  created_at: string;
  consumed_by_planner: false;
  summary: string;
}

export interface PlannerFeedBatchEntry {
  feed_id: string;
  producer_role: StandingRole | "legacy-unknown";
  source_identity_sha256: string;
  source_payload_sha256: string;
  summary: string;
  source_bytes: number;
  included_bytes: number;
  prompt_bytes: number;
  inclusion: "full" | "truncated" | "excluded";
  selection: "selected" | "excluded";
  consumption: "pending" | "consumed";
  reason: string | null;
}

export interface PlannerFeedBatchManifest {
  schema_version: 1;
  kind: "planner-feed-input-manifest";
  app: string;
  turn_id: string;
  batch_id: string;
  budget_bytes: number;
  included_bytes: number;
  max_feeds: number;
  entries: PlannerFeedBatchEntry[];
}

export interface PlannerFeedBatch {
  manifest: PlannerFeedBatchManifest;
  selected: PlannerFeedRecord[];
  deferred: PlannerFeedRecord[];
}

interface PlannerFeedConsumptionReceipt {
  schema_version: 1;
  kind: "planner-feed-consumption";
  consumption_id: string;
  app: string;
  turn_id: string;
  feed_ids: string[];
  consumed_at: string;
}

export const PLANNER_FEED_PROMPT_BUDGET_BYTES = 16 * 1024;
export const PLANNER_FEED_BATCH_MAX = 32;
export const PLANNER_FEED_ITEM_MAX_BYTES = 4 * 1024;
const DEFAULT_TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface StandingRolePersistResult {
  artifact: StandingRoleArtifact;
  plannerFeed: PlannerFeedRecord;
  artifactCreated: boolean;
  plannerFeedCreated: boolean;
}

export async function persistStandingRoleOutcome(input: {
  stateHome: string;
  app: string;
  role: string;
  event: TurnEvent;
  providerSummary: string;
  now: Date;
  repo?: string;
  gate?: GateFn;
}): Promise<StandingRolePersistResult | undefined> {
  if (!isStandingRole(input.role)) return undefined;
  const payload = validateEvent(input.app, input.role, input.event, input.now);
  const payloadHash = sha256(canonicalJson(payload));
  const artifactId = `standing_${sha256(`${input.app}\0${input.role}\0${input.event.key}\0${payloadHash}`).slice(7, 35)}`;
  const sourceIdentityHash = plannerFeedSourceIdentity({
    app: input.app,
    role: input.role,
    eventKind: input.event.kind,
    eventKey: input.event.key,
    eventSource: input.event.source,
  });
  const feedId = plannerFeedId(sourceIdentityHash, payloadHash);
  const draft = groundedDraft(input.role, payload);
  const delivery =
    input.role === "sre" && incidentFilingRequired(payload) && input.repo !== undefined && input.gate !== undefined
      ? await queueIncidentFiling({
          stateHome: input.stateHome,
          app: input.app,
          repo: input.repo,
          event: input.event,
          payload,
          payloadHash,
          artifactId,
          draft,
          gate: input.gate,
        })
      : undefined;
  const artifact: StandingRoleArtifact = {
    schema_version: 1,
    artifact_id: artifactId,
    app: input.app,
    role: input.role,
    event_kind: input.event.kind,
    event_key: input.event.key,
    source: input.event.source,
    source_payload_sha256: payloadHash,
    occurred_at: stringField(payload, "occurred_at"),
    created_at: input.now.toISOString(),
    draft_only: true,
    outward_effects: [],
    approval_state: input.role === "sre" && deployShaped(payload) ? "parked" : "not_requested",
    draft,
    provider_summary_sha256: sha256(input.providerSummary),
    ...(delivery !== undefined ? { delivery } : {}),
  };
  const plannerFeed: PlannerFeedRecord = {
    schema_version: 2,
    feed_id: feedId,
    app: input.app,
    producer_role: input.role,
    event_kind: input.event.kind,
    event_key: input.event.key,
    event_source: input.event.source,
    source_identity_sha256: sourceIdentityHash,
    source_payload_sha256: payloadHash,
    artifact_id: artifactId,
    created_at: input.now.toISOString(),
    status: "pending",
    lifecycle: {},
    summary: `${input.role} feed from ${stringField(payload, "kind")}: ${stringField(payload, "summary")}`,
  };
  const artifactPath = join(input.stateHome, "standing-roles", input.app, "artifacts", `${artifactId}.json`);
  const feedPath = join(input.stateHome, "standing-roles", input.app, "planner-feeds", `${feedId}.json`);
  const artifactCreated = await writeOnce(artifactPath, artifact);
  const plannerFeedCreated = await writeOnce(feedPath, plannerFeed);
  if (plannerFeedCreated) {
    await reconcilePlannerFeedSupersession(input.stateHome, input.app, input.now, feedId);
  }
  const persistedPlannerFeed = plannerFeedCreated
    ? plannerFeed
    : normalizePlannerFeed(JSON.parse(await readFile(feedPath, "utf8")) as PlannerFeedRecord | LegacyPlannerFeedRecord);
  return { artifact, plannerFeed: persistedPlannerFeed, artifactCreated, plannerFeedCreated };
}

export async function readPlannerFeeds(stateHome: string, app: string): Promise<PlannerFeedRecord[]> {
  return readPlannerFeedFiles(stateHome, app);
}

export function plannerFeedSourceIdentity(input: {
  app: string;
  role: StandingRole;
  eventKind: string;
  eventKey: string;
  eventSource: TurnEvent["source"];
}): string {
  return sha256(`${input.app}\0${input.role}\0${input.eventSource}\0${input.eventKind}\0${input.eventKey}`);
}

export function plannerFeedId(sourceIdentitySha256: string, payloadSha256: string): string {
  return `planner_feed_${sha256(`${sourceIdentitySha256}\0${payloadSha256}`).slice(7, 35)}`;
}

export async function preparePlannerFeedBatch(input: {
  stateHome: string;
  app: string;
  turnId: string;
  now: Date;
  budgetBytes?: number;
  maxFeeds?: number;
}): Promise<PlannerFeedBatch> {
  await reconcilePlannerFeedConsumptionReceipts(input.stateHome, input.app);
  await reconcilePlannerFeedSupersession(input.stateHome, input.app, input.now);
  await maintainPlannerFeedRetention(input.stateHome, input.app, input.now);
  const budgetBytes = input.budgetBytes ?? PLANNER_FEED_PROMPT_BUDGET_BYTES;
  const maxFeeds = input.maxFeeds ?? PLANNER_FEED_BATCH_MAX;
  if (!Number.isInteger(budgetBytes) || budgetBytes < 1) throw new Error("planner feeds: budget must be positive");
  if (!Number.isInteger(maxFeeds) || maxFeeds < 1) throw new Error("planner feeds: maxFeeds must be positive");
  const pending = (await readPlannerFeedFiles(input.stateHome, input.app))
    .filter((feed) => feed.status === "pending")
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.feed_id.localeCompare(b.feed_id));
  const selected: PlannerFeedRecord[] = [];
  const deferred: PlannerFeedRecord[] = [];
  const entries: PlannerFeedBatchEntry[] = [];
  let remaining = budgetBytes;
  for (const feed of pending) {
    const sourceBytes = Buffer.byteLength(feed.summary);
    const lineOverhead = Buffer.byteLength(`- ${feed.feed_id}: \n`);
    const itemCap = Math.min(PLANNER_FEED_ITEM_MAX_BYTES, Math.max(0, remaining - lineOverhead));
    if (selected.length >= maxFeeds || itemCap < 1) {
      deferred.push(feed);
      entries.push(batchEntry(feed, sourceBytes, "", "excluded", "excluded", "batch count or byte budget exhausted"));
      continue;
    }
    const rendered = truncateUtf8(feed.summary, itemCap);
    const includedBytes = Buffer.byteLength(rendered);
    if (includedBytes < 1) {
      deferred.push(feed);
      entries.push(batchEntry(feed, sourceBytes, "", "excluded", "excluded", "no prompt bytes remained"));
      continue;
    }
    remaining -= includedBytes + lineOverhead;
    selected.push(feed);
    entries.push(
      batchEntry(
        feed,
        sourceBytes,
        rendered,
        "selected",
        includedBytes < sourceBytes ? "truncated" : "full",
        includedBytes < sourceBytes ? `summary truncated to ${includedBytes} bytes` : null,
      ),
    );
  }
  const includedBytes = budgetBytes - remaining;
  const selectedIdentity = entries
    .filter((entry) => entry.selection === "selected")
    .map((entry) => ({
      feed_id: entry.feed_id,
      source_payload_sha256: entry.source_payload_sha256,
      included_bytes: entry.included_bytes,
    }));
  const batchId = `planner_feed_batch_${sha256(canonicalJson({ app: input.app, turn_id: input.turnId, selected: selectedIdentity })).slice(7, 35)}`;
  return {
    manifest: {
      schema_version: 1,
      kind: "planner-feed-input-manifest",
      app: input.app,
      turn_id: input.turnId,
      batch_id: batchId,
      budget_bytes: budgetBytes,
      included_bytes: includedBytes,
      max_feeds: maxFeeds,
      entries,
    },
    selected,
    deferred,
  };
}

export function consumedPlannerFeedBatchManifest(manifest: PlannerFeedBatchManifest): PlannerFeedBatchManifest {
  return {
    ...manifest,
    entries: manifest.entries.map((entry) => ({
      ...entry,
      consumption: entry.selection === "selected" ? "consumed" : "pending",
    })),
  };
}

export function plannerFeedBatchManifestJson(manifest: PlannerFeedBatchManifest): string {
  return `${canonicalJson(manifest)}\n`;
}

export async function commitPlannerFeedConsumption(input: {
  stateHome: string;
  app: string;
  turnId: string;
  batch: PlannerFeedBatch;
  now: Date;
}): Promise<void> {
  if (input.batch.selected.length === 0) return;
  const receipt: PlannerFeedConsumptionReceipt = {
    schema_version: 1,
    kind: "planner-feed-consumption",
    consumption_id: input.batch.manifest.batch_id,
    app: input.app,
    turn_id: input.turnId,
    feed_ids: input.batch.selected.map((feed) => feed.feed_id).sort(),
    consumed_at: input.now.toISOString(),
  };
  await writeOnce(plannerFeedConsumptionPath(input.stateHome, input.app, receipt.consumption_id), receipt);
  await reconcilePlannerFeedConsumptionReceipts(input.stateHome, input.app);
}

export async function maintainPlannerFeedRetention(
  stateHome: string,
  app: string,
  now: Date,
  options: { terminalRetentionMs?: number; expiredRetentionMs?: number } = {},
): Promise<{ expired: number; pruned: number; pendingKept: number }> {
  const terminalRetentionMs = options.terminalRetentionMs ?? DEFAULT_TERMINAL_RETENTION_MS;
  const expiredRetentionMs = options.expiredRetentionMs ?? DEFAULT_EXPIRED_RETENTION_MS;
  if (terminalRetentionMs < 0 || expiredRetentionMs < 0)
    throw new Error("planner feeds: retention windows cannot be negative");
  let expired = 0;
  let pruned = 0;
  let pendingKept = 0;
  for (const feed of await readPlannerFeedFiles(stateHome, app)) {
    const path = plannerFeedPath(stateHome, app, feed.feed_id);
    if (feed.status === "pending") {
      pendingKept += 1;
      continue;
    }
    if (feed.status === "expired") {
      const at = feed.lifecycle.expired_at;
      if (at !== undefined && now.getTime() - Date.parse(at) >= expiredRetentionMs) {
        await rm(path, { force: true });
        pruned += 1;
      }
      continue;
    }
    const terminalAt = feed.status === "consumed" ? feed.lifecycle.consumed_at : feed.lifecycle.superseded_at;
    if (terminalAt !== undefined && now.getTime() - Date.parse(terminalAt) >= terminalRetentionMs) {
      const next: PlannerFeedRecord = {
        ...feed,
        status: "expired",
        lifecycle: {
          ...feed.lifecycle,
          expired_at: now.toISOString(),
          expired_from: feed.status,
        },
      };
      await writeFileAtomic(path, `${canonicalJson(next)}\n`);
      expired += 1;
    }
  }
  await pruneOrphanedPlannerFeedReceipts(stateHome, app);
  return { expired, pruned, pendingKept };
}

async function readPlannerFeedFiles(stateHome: string, app: string): Promise<PlannerFeedRecord[]> {
  const dir = join(stateHome, "standing-roles", app, "planner-feeds");
  if (!existsSync(dir)) return [];
  const out: PlannerFeedRecord[] = [];
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()) {
    try {
      const value = JSON.parse(await readFile(join(dir, file), "utf8")) as PlannerFeedRecord | LegacyPlannerFeedRecord;
      const normalized = normalizePlannerFeed(value);
      if (normalized.app === app && typeof normalized.feed_id === "string") out.push(normalized);
    } catch {
      /* corrupt feeds remain visible in their durable location */
    }
  }
  return out.sort((a, b) => a.feed_id.localeCompare(b.feed_id));
}

async function reconcilePlannerFeedSupersession(
  stateHome: string,
  app: string,
  now: Date,
  preferredFeedId?: string,
): Promise<void> {
  const pending = (await readPlannerFeedFiles(stateHome, app)).filter((feed) => feed.status === "pending");
  const bySource = new Map<string, PlannerFeedRecord[]>();
  for (const feed of pending) {
    const group = bySource.get(feed.source_identity_sha256) ?? [];
    group.push(feed);
    bySource.set(feed.source_identity_sha256, group);
  }
  for (const group of bySource.values()) {
    if (group.length < 2) continue;
    const winner =
      group.find((feed) => feed.feed_id === preferredFeedId) ??
      [...group].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.feed_id.localeCompare(b.feed_id)).at(-1)!;
    for (const feed of group) {
      if (feed.feed_id === winner.feed_id) continue;
      const superseded: PlannerFeedRecord = {
        ...feed,
        status: "superseded",
        lifecycle: {
          ...feed.lifecycle,
          superseded_at: now.toISOString(),
          superseded_by: winner.feed_id,
        },
      };
      await writeFileAtomic(plannerFeedPath(stateHome, app, feed.feed_id), `${canonicalJson(superseded)}\n`);
    }
  }
}

async function reconcilePlannerFeedConsumptionReceipts(stateHome: string, app: string): Promise<void> {
  const dir = plannerFeedConsumptionDir(stateHome, app);
  if (!existsSync(dir)) return;
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()) {
    let receipt: PlannerFeedConsumptionReceipt;
    try {
      receipt = JSON.parse(await readFile(join(dir, file), "utf8")) as PlannerFeedConsumptionReceipt;
      if (receipt.schema_version !== 1 || receipt.kind !== "planner-feed-consumption" || receipt.app !== app) continue;
    } catch {
      continue;
    }
    for (const feedId of receipt.feed_ids) {
      const path = plannerFeedPath(stateHome, app, feedId);
      if (!existsSync(path)) continue;
      let feed: PlannerFeedRecord;
      try {
        feed = normalizePlannerFeed(
          JSON.parse(await readFile(path, "utf8")) as PlannerFeedRecord | LegacyPlannerFeedRecord,
        );
      } catch {
        continue;
      }
      if (feed.status === "consumed" || feed.status === "expired") continue;
      const consumed: PlannerFeedRecord = {
        ...feed,
        status: "consumed",
        lifecycle: {
          ...feed.lifecycle,
          consumed_at: receipt.consumed_at,
          consumed_by_turn: receipt.turn_id,
          consumption_id: receipt.consumption_id,
        },
      };
      await writeFileAtomic(path, `${canonicalJson(consumed)}\n`);
    }
  }
}

function normalizePlannerFeed(value: PlannerFeedRecord | LegacyPlannerFeedRecord): PlannerFeedRecord {
  if (value.schema_version === 2) {
    if (
      typeof value.feed_id !== "string" ||
      typeof value.app !== "string" ||
      !["pending", "consumed", "superseded", "expired"].includes(value.status)
    ) {
      throw new Error("invalid v2 planner feed");
    }
    return value;
  }
  if (value.schema_version !== 1 || typeof value.feed_id !== "string" || typeof value.app !== "string") {
    throw new Error("invalid legacy planner feed");
  }
  const inferred = /^(sre|support|marketing) feed\b/.exec(value.summary)?.[1];
  const producerRole =
    inferred === "sre" || inferred === "support" || inferred === "marketing" ? inferred : "legacy-unknown";
  return {
    schema_version: 2,
    feed_id: value.feed_id,
    app: value.app,
    producer_role: producerRole,
    event_kind: value.event_kind,
    event_key: value.event_key,
    event_source: "file-drop-inbox",
    source_identity_sha256: sha256(`${value.app}\0${producerRole}\0legacy\0${value.event_kind}\0${value.event_key}`),
    source_payload_sha256: value.source_payload_sha256,
    artifact_id: value.artifact_id,
    created_at: value.created_at,
    status: "pending",
    lifecycle: {},
    summary: value.summary,
  };
}

function batchEntry(
  feed: PlannerFeedRecord,
  sourceBytes: number,
  summary: string,
  selection: PlannerFeedBatchEntry["selection"],
  inclusion: PlannerFeedBatchEntry["inclusion"],
  reason: string | null,
): PlannerFeedBatchEntry {
  return {
    feed_id: feed.feed_id,
    producer_role: feed.producer_role,
    source_identity_sha256: feed.source_identity_sha256,
    source_payload_sha256: feed.source_payload_sha256,
    summary,
    source_bytes: sourceBytes,
    included_bytes: Buffer.byteLength(summary),
    prompt_bytes: selection === "selected" ? Buffer.byteLength(`- ${feed.feed_id}: ${summary}\n`) : 0,
    inclusion,
    selection,
    consumption: "pending",
    reason,
  };
}

async function pruneOrphanedPlannerFeedReceipts(stateHome: string, app: string): Promise<void> {
  const dir = plannerFeedConsumptionDir(stateHome, app);
  if (!existsSync(dir)) return;
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()) {
    const path = join(dir, file);
    try {
      const receipt = JSON.parse(await readFile(path, "utf8")) as PlannerFeedConsumptionReceipt;
      if (receipt.feed_ids.every((feedId) => !existsSync(plannerFeedPath(stateHome, app, feedId)))) {
        await rm(path, { force: true });
      }
    } catch {
      // Corrupt lifecycle evidence fails safe and stays visible.
    }
  }
}

function plannerFeedPath(stateHome: string, app: string, feedId: string): string {
  return join(stateHome, "standing-roles", app, "planner-feeds", `${feedId}.json`);
}

function plannerFeedConsumptionDir(stateHome: string, app: string): string {
  return join(stateHome, "standing-roles", app, "planner-feed-consumptions");
}

function plannerFeedConsumptionPath(stateHome: string, app: string, consumptionId: string): string {
  return join(plannerFeedConsumptionDir(stateHome, app), `${consumptionId}.json`);
}

function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text);
  if (bytes.byteLength <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
    } catch {
      end -= 1;
    }
  }
  return "";
}

export function parkStandingRoleAction(gate: GateFn, action: ToolAction): { parked: boolean; reason: string } {
  const decision = gate(action);
  return {
    parked: !decision.allow && decision.escalate === true,
    reason: decision.allow ? "action allowed" : decision.reason,
  };
}

export function verifyStandingRoleArtifact(artifact: StandingRoleArtifact, payload: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (artifact.app !== payload.app) errors.push("wrong_app");
  if (artifact.source_payload_sha256 !== sha256(canonicalJson(payload))) errors.push("source_payload_mismatch");
  if (!artifact.draft_only || artifact.outward_effects.length !== 0) errors.push("outward_effect");
  for (const fact of requiredFacts(artifact.role, payload))
    if (!artifact.draft.includes(fact)) errors.push(`missing_fact:${fact}`);
  return errors;
}

function validateEvent(app: string, role: StandingRole, event: TurnEvent, now: Date): Record<string, unknown> {
  const payload = event.payload;
  if (payload.app !== app) throw new Error(`standing-role wrong app: expected ${app}`);
  if (payload.kind !== event.kind) throw new Error("standing-role event kind/payload mismatch");
  if (typeof payload.source !== "string" || payload.source.trim() === "")
    throw new Error("standing-role event provenance missing");
  const occurredAt = stringField(payload, "occurred_at");
  if (!Number.isFinite(Date.parse(occurredAt))) throw new Error("standing-role occurred_at invalid");
  const allowed =
    role === "sre"
      ? ["health-alert"]
      : role === "support"
        ? ["support-feedback"]
        : ["adoption-signal", "launch-calendar", "release-shipped"];
  if (!allowed.includes(event.kind)) throw new Error(`standing-role ${role} cannot consume ${event.kind}`);
  if (role === "marketing" && now.getTime() - Date.parse(occurredAt) > 30 * 24 * 60 * 60 * 1000)
    throw new Error("standing-role stale release/adoption source");
  return payload;
}

function groundedDraft(role: StandingRole, payload: Record<string, unknown>): string {
  if (role === "sre")
    return [
      "# Incident draft",
      `Service: ${stringField(payload, "service")}`,
      `Status: ${stringField(payload, "status")}`,
      `Severity: ${stringField(payload, "severity")}`,
      `Evidence: ${stringField(payload, "summary")}`,
      "Proposed production remediation is parked at the approval boundary; no deploy was executed.",
    ].join("\n");
  if (role === "support")
    return [
      "# Support digest and reply draft",
      `Channel: ${stringField(payload, "channel")}`,
      `Severity: ${stringField(payload, "severity")}`,
      `Feedback: ${stringField(payload, "summary")}`,
      "Reply draft only; no email, message, or ticket reply was sent.",
    ].join("\n");
  if (payload.kind === "adoption-signal")
    return [
      "# Marketing adoption draft",
      `Metric: ${stringField(payload, "metric")}`,
      `Direction: ${stringField(payload, "direction")}`,
      `Value: ${String(payload.value)}`,
      `Evidence: ${stringField(payload, "summary")}`,
      "Draft only; nothing was published.",
    ].join("\n");
  return [
    "# Marketing launch draft",
    `Milestone: ${String(payload.milestone ?? payload.tag ?? "")}`,
    `Evidence: ${stringField(payload, "summary")}`,
    "Draft only; nothing was published.",
  ].join("\n");
}

function requiredFacts(role: StandingRole, payload: Record<string, unknown>): string[] {
  if (role === "sre")
    return [stringField(payload, "service"), stringField(payload, "status"), stringField(payload, "summary")];
  if (role === "support") return [stringField(payload, "channel"), stringField(payload, "summary")];
  return payload.kind === "adoption-signal"
    ? [
        stringField(payload, "metric"),
        stringField(payload, "direction"),
        String(payload.value),
        stringField(payload, "summary"),
      ]
    : [String(payload.milestone ?? payload.tag ?? ""), stringField(payload, "summary")];
}

function deployShaped(payload: Record<string, unknown>): boolean {
  return payload.kind === "health-alert" && (payload.status === "down" || payload.severity === "critical");
}

function incidentFilingRequired(payload: Record<string, unknown>): boolean {
  return deployShaped(payload);
}

async function queueIncidentFiling(input: {
  stateHome: string;
  app: string;
  repo: string;
  event: TurnEvent;
  payload: Record<string, unknown>;
  payloadHash: string;
  artifactId: string;
  draft: string;
  gate: GateFn;
}): Promise<StandingRoleDelivery> {
  const idempotencyKey = `incident:${sha256(`${input.app}\0${input.event.key}\0${input.payloadHash}`).slice(7, 47)}`;
  const ticketRef = `event:${input.event.key}`;
  const action = githubIssueCreateAction({
    repo: input.repo,
    title: `Incident: ${stringField(input.payload, "service")} ${stringField(input.payload, "status")}`,
    body: [
      input.draft,
      "",
      "## Cormidia source",
      `Event: ${input.event.key}`,
      `Payload SHA-256: ${input.payloadHash}`,
      `Artifact: ${input.artifactId}`,
    ].join("\n"),
    labels: ["op:incident"],
    idempotency_key: idempotencyKey,
  });
  const store = new ApprovalStore(input.stateHome);
  let item = await store.findEquivalent({
    app: input.app,
    role: "sre",
    rule: "external-publishing",
    action,
    ticketRef,
  });
  let reason: string | undefined;
  if (item === undefined) {
    const decision = input.gate(action);
    reason = decision.allow ? undefined : decision.reason;
    item = await store.findEquivalent({
      app: input.app,
      role: "sre",
      rule: "external-publishing",
      action,
      ticketRef,
    });
    // The composed gate normally records the escalation. Keep this helper
    // fail-closed if a custom hook denies without persisting one.
    if (item === undefined && !decision.allow) {
      return {
        kind: "github_issue",
        analysis_state: "complete",
        filing_state: "gate_denied",
        repo: input.repo,
        required_label: "op:incident",
        source_event_key: input.event.key,
        idempotency_key: idempotencyKey,
        failure_cause: "gate_denied",
        reason: decision.reason,
      };
    }
    if (item === undefined) {
      throw new Error("incident delivery gate allowed without a durable action record");
    }
  }
  const lifecycle = approvalLifecycleState(item);
  const filingState: StandingRoleDelivery["filing_state"] =
    lifecycle === "pending"
      ? "pending_approval"
      : lifecycle === "approved"
        ? "ready"
        : lifecycle === "executed"
          ? "filed"
          : lifecycle === "denied"
            ? "gate_denied"
            : lifecycle;
  return {
    kind: "github_issue",
    analysis_state: "complete",
    filing_state: filingState,
    repo: input.repo,
    required_label: "op:incident",
    source_event_key: input.event.key,
    idempotency_key: idempotencyKey,
    approval_id: item.id,
    ...(filingState === "gate_denied" ? { failure_cause: "gate_denied" as const } : {}),
    ...(reason !== undefined || item.reason !== undefined ? { reason: reason ?? item.reason! } : {}),
  };
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`standing-role missing ${key}`);
  return value;
}

async function writeOnce(path: string, value: unknown): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });
  if (existsSync(path)) return false;
  const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temp, canonicalJson(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      await link(temp, path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

function isStandingRole(value: string): value is StandingRole {
  return value === "sre" || value === "support" || value === "marketing";
}
