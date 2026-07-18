import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GateFn, ToolAction } from "../runtime/types.js";
import { approvalLifecycleState, ApprovalStore } from "./approvals.js";
import { githubIssueCreateAction, type DeliveryFailureCause } from "./approval-delivery.js";
import type { TurnEvent } from "./journal.js";
import { canonicalJson, sha256 } from "./scheduler/model.js";

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
  const feedId = `planner_feed_${sha256(`${input.app}\0${input.event.key}\0${payloadHash}`).slice(7, 35)}`;
  const draft = groundedDraft(input.role, payload);
  const delivery = input.role === "sre" && incidentFilingRequired(payload) && input.repo !== undefined && input.gate !== undefined
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
    schema_version: 1,
    feed_id: feedId,
    app: input.app,
    event_kind: input.event.kind,
    event_key: input.event.key,
    source_payload_sha256: payloadHash,
    artifact_id: artifactId,
    created_at: input.now.toISOString(),
    consumed_by_planner: false,
    summary: `${input.role} feed from ${stringField(payload, "kind")}: ${stringField(payload, "summary")}`,
  };
  const artifactPath = join(input.stateHome, "standing-roles", input.app, "artifacts", `${artifactId}.json`);
  const feedPath = join(input.stateHome, "standing-roles", input.app, "planner-feeds", `${feedId}.json`);
  const artifactCreated = await writeOnce(artifactPath, artifact);
  const plannerFeedCreated = await writeOnce(feedPath, plannerFeed);
  return { artifact, plannerFeed, artifactCreated, plannerFeedCreated };
}

export async function readPlannerFeeds(stateHome: string, app: string): Promise<PlannerFeedRecord[]> {
  const dir = join(stateHome, "standing-roles", app, "planner-feeds");
  if (!existsSync(dir)) return [];
  const out: PlannerFeedRecord[] = [];
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()) {
    try {
      const value = JSON.parse(await readFile(join(dir, file), "utf8")) as PlannerFeedRecord;
      if (value.schema_version === 1 && value.app === app && typeof value.feed_id === "string") out.push(value);
    } catch { /* corrupt feeds remain visible in their durable location */ }
  }
  return out.sort((a, b) => a.feed_id.localeCompare(b.feed_id));
}

export function parkStandingRoleAction(gate: GateFn, action: ToolAction): { parked: boolean; reason: string } {
  const decision = gate(action);
  return { parked: !decision.allow && decision.escalate === true, reason: decision.allow ? "action allowed" : decision.reason };
}

export function verifyStandingRoleArtifact(artifact: StandingRoleArtifact, payload: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (artifact.app !== payload.app) errors.push("wrong_app");
  if (artifact.source_payload_sha256 !== sha256(canonicalJson(payload))) errors.push("source_payload_mismatch");
  if (!artifact.draft_only || artifact.outward_effects.length !== 0) errors.push("outward_effect");
  for (const fact of requiredFacts(artifact.role, payload)) if (!artifact.draft.includes(fact)) errors.push(`missing_fact:${fact}`);
  return errors;
}

function validateEvent(app: string, role: StandingRole, event: TurnEvent, now: Date): Record<string, unknown> {
  const payload = event.payload;
  if (payload.app !== app) throw new Error(`standing-role wrong app: expected ${app}`);
  if (payload.kind !== event.kind) throw new Error("standing-role event kind/payload mismatch");
  if (typeof payload.source !== "string" || payload.source.trim() === "") throw new Error("standing-role event provenance missing");
  const occurredAt = stringField(payload, "occurred_at");
  if (!Number.isFinite(Date.parse(occurredAt))) throw new Error("standing-role occurred_at invalid");
  const allowed = role === "sre" ? ["health-alert"] : role === "support" ? ["support-feedback"] : ["adoption-signal", "launch-calendar", "release-shipped"];
  if (!allowed.includes(event.kind)) throw new Error(`standing-role ${role} cannot consume ${event.kind}`);
  if (role === "marketing" && now.getTime() - Date.parse(occurredAt) > 30 * 24 * 60 * 60 * 1000) throw new Error("standing-role stale release/adoption source");
  return payload;
}

function groundedDraft(role: StandingRole, payload: Record<string, unknown>): string {
  if (role === "sre") return [
    "# Incident draft",
    `Service: ${stringField(payload, "service")}`,
    `Status: ${stringField(payload, "status")}`,
    `Severity: ${stringField(payload, "severity")}`,
    `Evidence: ${stringField(payload, "summary")}`,
    "Proposed production remediation is parked at the approval boundary; no deploy was executed.",
  ].join("\n");
  if (role === "support") return [
    "# Support digest and reply draft",
    `Channel: ${stringField(payload, "channel")}`,
    `Severity: ${stringField(payload, "severity")}`,
    `Feedback: ${stringField(payload, "summary")}`,
    "Reply draft only; no email, message, or ticket reply was sent.",
  ].join("\n");
  if (payload.kind === "adoption-signal") return [
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
  if (role === "sre") return [stringField(payload, "service"), stringField(payload, "status"), stringField(payload, "summary")];
  if (role === "support") return [stringField(payload, "channel"), stringField(payload, "summary")];
  return payload.kind === "adoption-signal"
    ? [stringField(payload, "metric"), stringField(payload, "direction"), String(payload.value), stringField(payload, "summary")]
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
      "## Operon source",
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
  const filingState: StandingRoleDelivery["filing_state"] = lifecycle === "pending"
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
    try { await link(temp, path); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  } finally { await rm(temp, { force: true }).catch(() => {}); }
}

function isStandingRole(value: string): value is StandingRole {
  return value === "sre" || value === "support" || value === "marketing";
}
