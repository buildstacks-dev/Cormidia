import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executePipeline } from "../../src/loop/pipeline.js";
import { getPipeline, loadPipelines } from "../../src/loop/pipelines.js";
import { ApprovalStore } from "../../src/org/approvals.js";
import { executeApprovedDeliveries } from "../../src/org/approval-delivery.js";
import { composeGate } from "../../src/org/gate-compose.js";
import { loadRoles } from "../../src/org/roles.js";
import {
  commitPlannerFeedConsumption,
  maintainPlannerFeedRetention,
  parkStandingRoleAction,
  plannerFeedId,
  plannerFeedSourceIdentity,
  persistStandingRoleOutcome,
  preparePlannerFeedBatch,
  readPlannerFeeds,
  verifyStandingRoleArtifact,
  type StandingRole,
  type StandingRoleArtifact,
} from "../../src/org/standing-roles.js";
import { defaultGate } from "../../src/runtime/gate.js";
import { FakeRuntime } from "../../src/runtime/testing/fakeRuntime.js";
import type { TurnResult } from "../../src/runtime/types.js";
import { grade as gradeStandingRoles } from "../../eval/graders/standing-roles.js";
import { makeAppRepo, makeOrgHome } from "../fixtures/orgHome.js";
import { FakeGhOps } from "../support/fakeGhOps.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PROMPTS = join(ROOT, "prompts");
const events = {
  sre: { kind: "health-alert", id: "health-1", app: "service", occurred_at: "2026-07-12T00:00:00Z", source: "fixture", severity: "critical", service: "web", status: "down", summary: "/health returned 500 three times" },
  support: { kind: "support-feedback", id: "feedback-1", app: "service", occurred_at: "2026-07-12T00:01:00Z", source: "fixture", severity: "medium", channel: "email", summary: "Users cannot distinguish a transient health failure" },
  marketing: { kind: "adoption-signal", id: "adoption-1", app: "service", occurred_at: "2026-07-12T00:02:00Z", source: "fixture", metric: "weekly_checks", direction: "up", value: 42, summary: "Health checks doubled after release" },
} as const;

describe("STANDING-ROLES-001 deterministic production paths", () => {
  it("runs ordinary FakeRuntime passes, persists grounded drafts and all three Planner feeds, and parks deploy work", async () => {
    const home = makeOrgHome({ state: true, approvals: true, runs: { apps: ["service"] } });
    const app = makeAppRepo({ config: { schema_version: 1, name: "service" }, taste: true });
    try {
      const result = await executeAll(home.root, app.root);
      expect(result.artifacts.map((artifact) => artifact.role).sort()).toEqual(["marketing", "sre", "support"]);
      expect(result.artifacts.every((artifact) => verifyStandingRoleArtifact(artifact, eventFor(artifact.role).payload).length === 0)).toBe(true);
      expect(result.artifacts.every((artifact) => artifact.draft_only && artifact.outward_effects.length === 0)).toBe(true);
      expect(await readPlannerFeeds(home.root, "service")).toHaveLength(3);
      expect(result.providerTurns).toBe(3);
      expect(result.providerSettlements).toBe(3);

      const approvals = new ApprovalStore(home.root, { idSource: () => "phase5-deploy" });
      const parked = parkStandingRoleAction(
        composeGate(defaultGate, approvals, { app: "service", role: "sre", turnId: "standing-sre", orgHome: ROOT, now: () => new Date("2026-07-12T01:00:00Z") }),
        { tool: "bash", input: { command: "kubectl apply -f prod.yaml" } },
      );
      expect(parked).toMatchObject({ parked: true });
      expect(await approvals.listPending()).toHaveLength(1);

      const evidence = makeEvidence({ rolesGrounded: 3, plannerFeeds: 3, inventedClaims: 0, outwardEffects: 0, deployParked: parked.parked });
      try { expect(gradeStandingRoles(evidence)).toBe(true); } finally { rmSync(evidence, { recursive: true, force: true }); }
    } finally { app.cleanup(); home.cleanup(); }
  });

  it("is idempotent across retries and keeps app/event attribution isolated", async () => {
    const home = makeOrgHome({ state: true });
    try {
      const first = await persistOne(home.root, "sre", "provider grounded summary");
      const retry = await persistOne(home.root, "sre", "provider grounded summary");
      expect(first).toMatchObject({ artifactCreated: true, plannerFeedCreated: true });
      expect(retry).toMatchObject({ artifactCreated: false, plannerFeedCreated: false });
      expect(await readPlannerFeeds(home.root, "service")).toHaveLength(1);
      await expect(persistStandingRoleOutcome({ stateHome: home.root, app: "other", role: "sre", event: eventFor("sre"), providerSummary: "x", now: new Date("2026-07-12T01:00:00Z") })).rejects.toThrow("wrong app");
      await expect(persistStandingRoleOutcome({ stateHome: home.root, app: "service", role: "support", event: eventFor("sre"), providerSummary: "x", now: new Date("2026-07-12T01:00:00Z") })).rejects.toThrow("cannot consume");
      await expect(persistStandingRoleOutcome({ stateHome: home.root, app: "service", role: "marketing", event: eventFor("marketing"), providerSummary: "x", now: new Date("2026-09-12T01:00:00Z") })).rejects.toThrow("stale");
      await expect(persistStandingRoleOutcome({ stateHome: home.root, app: "service", role: "support", event: { ...eventFor("support"), payload: { ...eventFor("support").payload, source: "" } }, providerSummary: "x", now: new Date("2026-07-12T01:00:00Z") })).rejects.toThrow("provenance missing");
      await expect(persistStandingRoleOutcome({ stateHome: home.root, app: "service", role: "support", event: { ...eventFor("support"), payload: { ...eventFor("support").payload, kind: "adoption-signal" } }, providerSummary: "x", now: new Date("2026-07-12T01:00:00Z") })).rejects.toThrow("kind/payload mismatch");
    } finally { home.cleanup(); }
  });

  it("binds feed identity to the producing role and advances supersession/consumption crash-safely (#109)", async () => {
    const home = makeOrgHome({ state: true });
    const sourceA = plannerFeedSourceIdentity({
      app: "service",
      role: "support",
      eventKind: "shared-event",
      eventKey: "shared.json",
      eventSource: "file-drop-inbox",
    });
    const sourceB = plannerFeedSourceIdentity({
      app: "service",
      role: "marketing",
      eventKind: "shared-event",
      eventKey: "shared.json",
      eventSource: "file-drop-inbox",
    });
    expect(sourceA).not.toBe(sourceB);
    const sharedPayloadHash = "sha256:shared-payload";
    expect(new Set([
      plannerFeedId(sourceA, sharedPayloadHash),
      plannerFeedId(sourceB, sharedPayloadHash),
    ])).toHaveLength(2);
    try {
      await persistSupportFeed(home.root, "feedback.json", "first version", new Date("2026-07-12T01:00:00Z"));
      await persistSupportFeed(home.root, "feedback.json", "corrected version", new Date("2026-07-12T01:01:00Z"));
      expect((await readPlannerFeeds(home.root, "service")).map((feed) => feed.status).sort()).toEqual([
        "pending",
        "superseded",
      ]);

      const firstBatch = await preparePlannerFeedBatch({
        stateHome: home.root,
        app: "service",
        turnId: "groom-1",
        now: new Date("2026-07-12T01:02:00Z"),
      });
      expect(firstBatch.selected).toHaveLength(1);
      expect(firstBatch.selected[0]?.summary).toContain("corrected version");
      // Crash-before-consume: no receipt means the same evidence remains pending.
      const retryBatch = await preparePlannerFeedBatch({
        stateHome: home.root,
        app: "service",
        turnId: "groom-2",
        now: new Date("2026-07-12T01:03:00Z"),
      });
      expect(retryBatch.selected.map((feed) => feed.feed_id)).toEqual(
        firstBatch.selected.map((feed) => feed.feed_id),
      );
      await commitPlannerFeedConsumption({
        stateHome: home.root,
        app: "service",
        turnId: "groom-2",
        batch: retryBatch,
        now: new Date("2026-07-12T01:04:00Z"),
      });
      // Duplicate receipt/reconciliation is idempotent.
      await commitPlannerFeedConsumption({
        stateHome: home.root,
        app: "service",
        turnId: "groom-2",
        batch: retryBatch,
        now: new Date("2026-07-12T01:05:00Z"),
      });
      const consumed = (await readPlannerFeeds(home.root, "service")).find((feed) => feed.status === "consumed");
      expect(consumed?.lifecycle).toMatchObject({ consumed_by_turn: "groom-2", consumption_id: retryBatch.manifest.batch_id });
      const next = await preparePlannerFeedBatch({
        stateHome: home.root,
        app: "service",
        turnId: "groom-3",
        now: new Date("2026-07-12T01:06:00Z"),
      });
      expect(next.selected).toEqual([]);
      expect(next.manifest.entries).toEqual([]);
    } finally {
      home.cleanup();
    }
  });

  it("bounds prompt bytes while retaining deferred pending evidence", async () => {
    const home = makeOrgHome({ state: true });
    try {
      for (let index = 0; index < 3; index += 1) {
        await persistSupportFeed(
          home.root,
          `feedback-${index}.json`,
          `${index}:${"x".repeat(5_000)}`,
          new Date(`2026-07-12T01:0${index}:00Z`),
        );
      }
      const batch = await preparePlannerFeedBatch({
        stateHome: home.root,
        app: "service",
        turnId: "bounded-groom",
        now: new Date("2026-07-12T02:00:00Z"),
        budgetBytes: 4_500,
        maxFeeds: 2,
      });
      expect(batch.manifest.included_bytes).toBeLessThanOrEqual(4_500);
      expect(batch.manifest.included_bytes).toBe(
        batch.manifest.entries.reduce((sum, entry) => sum + entry.prompt_bytes, 0),
      );
      expect(batch.manifest.entries.some((entry) => entry.inclusion === "truncated")).toBe(true);
      expect(batch.deferred.length).toBeGreaterThan(0);
      expect((await readPlannerFeeds(home.root, "service")).filter((feed) => feed.status === "pending")).toHaveLength(3);
    } finally {
      home.cleanup();
    }
  });

  it("expires and prunes only terminal feeds while preserving unconsumed evidence", async () => {
    const home = makeOrgHome({ state: true });
    try {
      await persistSupportFeed(home.root, "old.json", "consume me", new Date("2026-07-01T00:00:00Z"));
      await persistSupportFeed(home.root, "pending.json", "keep me", new Date("2026-07-01T00:01:00Z"));
      const batch = await preparePlannerFeedBatch({
        stateHome: home.root,
        app: "service",
        turnId: "groom-old",
        now: new Date("2026-07-01T00:02:00Z"),
        maxFeeds: 1,
      });
      await commitPlannerFeedConsumption({
        stateHome: home.root,
        app: "service",
        turnId: "groom-old",
        batch,
        now: new Date("2026-07-01T00:03:00Z"),
      });
      const expired = await maintainPlannerFeedRetention(
        home.root,
        "service",
        new Date("2026-07-02T00:00:00Z"),
        { terminalRetentionMs: 0, expiredRetentionMs: 86_400_000 },
      );
      expect(expired).toMatchObject({ expired: 1, pendingKept: 1 });
      expect((await readPlannerFeeds(home.root, "service")).map((feed) => feed.status).sort()).toEqual(["expired", "pending"]);
      const pruned = await maintainPlannerFeedRetention(
        home.root,
        "service",
        new Date("2026-07-03T00:00:00Z"),
        { terminalRetentionMs: 0, expiredRetentionMs: 0 },
      );
      expect(pruned.pruned).toBe(1);
      expect((await readPlannerFeeds(home.root, "service")).map((feed) => feed.status)).toEqual(["pending"]);
    } finally {
      home.cleanup();
    }
  });

  it("queues one source-linked SRE incident, then records filing acknowledgement through the fake GitHub boundary", async () => {
    const home = makeOrgHome({ state: true, approvals: true });
    const now = new Date("2026-07-12T01:00:00Z");
    const event = eventFor("sre");
    const store = new ApprovalStore(home.root, { idSource: () => "sre-incident-approval" });
    const gate = composeGate(defaultGate, store, {
      app: "service",
      role: "sre",
      turnId: "standing-sre",
      ticketRef: `event:${event.key}`,
      orgHome: ROOT,
      now: () => now,
    });
    try {
      const first = await persistStandingRoleOutcome({
        stateHome: home.root,
        app: "service",
        role: "sre",
        event,
        providerSummary: "analysis complete",
        now,
        repo: "fixture/service",
        gate,
      });
      const retry = await persistStandingRoleOutcome({
        stateHome: home.root,
        app: "service",
        role: "sre",
        event,
        providerSummary: "analysis complete",
        now,
        repo: "fixture/service",
        gate,
      });
      expect(first?.artifact.delivery).toMatchObject({
        analysis_state: "complete",
        filing_state: "pending_approval",
        approval_id: "sre-incident-approval",
        required_label: "op:incident",
        source_event_key: "sre.json",
      });
      expect(retry).toMatchObject({ artifactCreated: false, plannerFeedCreated: false });
      const pending = await store.listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        role: "sre",
        rule: "external-publishing",
        ticketRef: "event:sre.json",
        classification: { rule: "external-publishing" },
      });
      expect(JSON.stringify(pending[0]!.classification)).not.toContain("health returned 500");
      expect(JSON.stringify(pending[0]!.action.input)).toContain("Event: sre.json");

      await store.decide(pending[0]!.id, { decision: "approved", reason: "file incident", now });
      const gh = new FakeGhOps({ repo: "fixture/service" });
      const outcomes = await executeApprovedDeliveries({
        stateHome: home.root,
        appsFile: {
          org: { name: "fixture", maxConcurrentTurns: 2 },
          defaults: { budgetUsdMonth: 100 },
          apps: [{ name: "service", repo: "fixture/service", status: "live", budgetUsdMonth: 100, cadence: {} }],
        },
        ghFor: () => gh,
        now: () => now,
      });
      expect(outcomes).toEqual([expect.objectContaining({ status: "executed", remoteRef: "#1" })]);
      const issues = await gh.listIssues({ labels: ["op:incident"], state: "all" });
      expect(issues).toHaveLength(1);
      expect(issues[0]!.body).toContain("Payload SHA-256:");
      expect((await store.show(pending[0]!.id)).item.execution).toMatchObject({ state: "executed", result: "remote action acknowledged" });
    } finally { home.cleanup(); }
  });

  it("surfaces a flat gate denial separately from completed SRE analysis", async () => {
    const home = makeOrgHome({ state: true, approvals: true });
    try {
      const persisted = await persistStandingRoleOutcome({
        stateHome: home.root,
        app: "service",
        role: "sre",
        event: eventFor("sre"),
        providerSummary: "analysis complete",
        now: new Date("2026-07-12T01:00:00Z"),
        repo: "fixture/service",
        gate: () => ({ allow: false, reason: "sandbox delivery is denied by policy", escalate: false }),
      });
      expect(persisted?.artifact.delivery).toMatchObject({
        analysis_state: "complete",
        filing_state: "gate_denied",
        failure_cause: "gate_denied",
        reason: "sandbox delivery is denied by policy",
      });
      expect(await new ApprovalStore(home.root).listPending()).toHaveLength(0);
    } finally { home.cleanup(); }
  });

  it("hidden evidence rejects invented or mismatched claims instead of trusting provider prose", async () => {
    const home = makeOrgHome({ state: true });
    try {
      const persisted = await persistOne(home.root, "marketing", "Invented claim: ten million customers");
      expect(persisted).toBeDefined();
      expect(persisted!.artifact.draft).not.toContain("ten million");
      const mutant = { ...persisted!.artifact, draft: "Invented launch claim" };
      expect(verifyStandingRoleArtifact(mutant, eventFor("marketing").payload)).toEqual(expect.arrayContaining([expect.stringContaining("missing_fact") ]));
      const evidence = makeEvidence({ rolesGrounded: 3, plannerFeeds: 3, inventedClaims: 1, outwardEffects: 0, deployParked: true });
      try { expect(gradeStandingRoles(evidence)).toBe(false); } finally { rmSync(evidence, { recursive: true, force: true }); }
    } finally { home.cleanup(); }
  });
});

async function executeAll(stateHome: string, appRoot: string): Promise<{ artifacts: StandingRoleArtifact[]; providerTurns: number; providerSettlements: number }> {
  const rolesFile = await loadRoles(join(ROOT, "roles.yaml"));
  const roles = Object.fromEntries(rolesFile.roles.map((role) => [role.name, role]));
  const pipelines = await loadPipelines(join(ROOT, "pipelines.yaml"), { roleNames: rolesFile.roles.map((role) => role.name), promptsDir: PROMPTS });
  const artifacts: StandingRoleArtifact[] = [];
  for (const [role, pipelineName] of [["sre", "sre-incident"], ["support", "support-digest"], ["marketing", "ci-sweep"]] as const) {
    const result = turnResult(`${role} provider draft grounded in fixture`);
    const fake = new FakeRuntime([{ result }]);
    const execution = await executePipeline({
      pipeline: getPipeline(pipelines, pipelineName),
      selection: { tier: "standard" },
      roles,
      runtimeFor: () => fake,
      briefFor: () => `fixture ${role} event ${JSON.stringify(events[role])}`,
      promptsDir: PROMPTS,
      context: { taste: [], memoryExcerpts: [] },
      workdir: appRoot,
      hooks: { gate: () => ({ allow: true }) },
      runlog: { root: stateHome, app: "service", traceId: `standing-${role}` },
      telemetry: { orgDir: stateHome, trigger: "event" },
      clock: () => new Date("2026-07-12T01:00:00Z"),
    });
    expect(execution.aborted).toBe(false);
    const persisted = await persistOne(stateHome, role, execution.passes[0]!.result.summary);
    artifacts.push(persisted!.artifact);
  }
  const rows = readdirSync(join(stateHome, "telemetry")).flatMap((file) => readFileSync(join(stateHome, "telemetry", file), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { providerTurnId?: string }));
  return { artifacts, providerTurns: new Set(rows.map((row) => row.providerTurnId).filter(Boolean)).size, providerSettlements: rows.filter((row) => row.providerTurnId !== undefined).length };
}

function persistOne(stateHome: string, role: StandingRole, providerSummary: string) {
  return persistStandingRoleOutcome({ stateHome, app: "service", role, event: eventFor(role), providerSummary, now: new Date("2026-07-12T01:00:00Z") });
}

function persistSupportFeed(stateHome: string, key: string, summary: string, now: Date) {
  const base = eventFor("support");
  return persistStandingRoleOutcome({
    stateHome,
    app: "service",
    role: "support",
    event: {
      ...base,
      key,
      payload: { ...base.payload, id: key, filename: key, summary },
    },
    providerSummary: `provider: ${summary}`,
    now,
  });
}

function eventFor(role: StandingRole) {
  return { kind: events[role].kind, key: `${role}.json`, source: "file-drop-inbox" as const, payload: { ...events[role], filename: `${role}.json` } };
}

function turnResult(summary: string): TurnResult {
  return { status: "completed", summary, artifacts: [], session: { runtime: "claude", id: summary }, usage: { tokensIn: 10, tokensOut: 2, costUsd: 0.01, subagentTurns: 0, wallClockMs: 1 }, escalations: [] };
}

function makeEvidence(input: { rolesGrounded: number; plannerFeeds: number; inventedClaims: number; outwardEffects: number; deployParked: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), "operon-standing-evidence-"));
  writeFileSync(join(dir, "grader-evidence.json"), `${JSON.stringify({ roles_grounded: input.rolesGrounded, planner_feeds: input.plannerFeeds, invented_claims: input.inventedClaims, outward_effects: input.outwardEffects, deploy_parked: input.deployParked })}\n`);
  return dir;
}
