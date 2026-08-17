// Traceability: CF-B13 · CF-C-B13 · CF-J10-I · CF-SM-EVENT-L/I · HB-P3 · F-PT-006.
// Red-capable controls for the ID-blind identity and its durable-state migration.
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dispatchTick } from "../../../src/org/dispatch.js";
import { EventStore, inboxEventKey, roleConsumedKey, type GitHubEventSource } from "../../../src/org/events.js";
import { sha256, stableJson } from "../../../src/org/lifecycle.js";
import { SchedulerEvidenceStore } from "../../../src/org/scheduler/evidence.js";
import { schedulerIdentity } from "../../../src/org/scheduler/model.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

const APP = "event-app";
const ROLE = "support";
const NO_GITHUB: GitHubEventSource = {
  ticketReady: async () => [],
  prOpened: async () => [],
  ciFailed: async () => [],
  releaseShipped: async () => [],
};
const homes: TempOrgHome[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => home.cleanup()));
});

function event(id: string): Record<string, unknown> {
  return {
    kind: "support-feedback",
    id,
    app: APP,
    occurred_at: "2026-07-31T12:00:00.000Z",
    source: "fixture",
    severity: "high",
    channel: "email",
    summary: "Customer cannot complete checkout",
  };
}

function v2Key(payload: Record<string, unknown>): string {
  const { filename: _filename, id: _id, ...content } = payload;
  return `event:${sha256(stableJson(content))}`;
}

function v1Key(payload: Record<string, unknown>): string {
  const { filename: _filename, ...content } = payload;
  return `event:${sha256(stableJson(content))}`;
}

async function makeWorld(roles: readonly string[] = [ROLE]): Promise<TempOrgHome> {
  const home = await makeTempOrgHome({ name: "event-org" });
  homes.push(home);
  await writeFile(
    join(home.orgHome, "apps.yaml"),
    [
      "schema_version: 1",
      "org: {name: event-org, max_concurrent_turns: 4}",
      "defaults: {budget_usd_month: 1000}",
      "apps:",
      `  ${APP}:`,
      "    repo: fixture/event-app",
      "    status: live",
      "    budget_usd_month: 1000",
      "    cadence: {}",
      "    channels: {support: [email]}",
      "",
    ].join("\n"),
    "utf8",
  );
  const roleRows = roles.flatMap((role) => [
    `  ${role}:`,
    "    runtime: claude",
    "    model: claude-scripted-model",
    "    effort: medium",
    "    delegation: {allow: []}",
    "    triggers: [{event: support-feedback}]",
    "    outputs: [notes]",
  ]);
  await writeFile(
    join(home.orgHome, "roles.yaml"),
    ["defaults: {max_turn_budget_usd: 5}", "roles:", ...roleRows, ""].join("\n"),
    "utf8",
  );
  await mkdir(join(home.stateHome, "state", "events", "inbox"), { recursive: true });
  return home;
}

async function drop(home: TempOrgHome, file: string, payload: Record<string, unknown>): Promise<void> {
  await writeFile(join(home.stateHome, "state", "events", "inbox", file), `${JSON.stringify(payload)}\n`, "utf8");
}

const appEntry = {
  name: APP,
  repo: "fixture/event-app",
  status: "live" as const,
  budgetUsdMonth: 1000,
  objectiveBudgetUsd: 1000,
  cadence: {},
};

interface Placement {
  markedFile: string;
  markedId: string;
  peerFile: string;
  peerId: string;
}

const placements: Placement[] = [
  {
    markedFile: "alert-a.json",
    markedId: "old-a",
    peerFile: "alert-z.json",
    peerId: "fresh-z",
  },
  {
    markedFile: "alert-z.json",
    markedId: "old-z",
    peerFile: "alert-a.json",
    peerId: "fresh-a",
  },
];

type AliasKind = "v1 content key" | "legacy filename";
const aliasKinds: AliasKind[] = ["v1 content key", "legacy filename"];

function alias(kind: AliasKind, placement: Placement): string {
  return kind === "v1 content key" ? v1Key(event(placement.markedId)) : placement.markedFile;
}

async function populatedWorld(placement: Placement): Promise<TempOrgHome> {
  const home = await makeWorld();
  await drop(home, placement.markedFile, event(placement.markedId));
  await drop(home, placement.peerFile, event(placement.peerId));
  return home;
}

async function seedSpawnEvidence(home: TempOrgHome, eventKey: string, at: Date): Promise<SchedulerEvidenceStore> {
  const evidence = new SchedulerEvidenceStore({
    stateHome: home.stateHome,
    orgName: "event-org",
    orgHome: home.orgHome,
    schedulerId: schedulerIdentity("event-org", home.orgHome),
  });
  const invocation = await evidence.beginInvocation(at);
  const decision = await evidence.claimDecision({
    invocationId: invocation.invocation_id,
    cadenceWindow: invocation.cadence_window,
    app: APP,
    role: ROLE,
    triggerKind: "event",
    trigger: "support-feedback",
    eventKey,
    now: at,
  });
  await evidence.advanceDecision(decision.record.decision_id, "spawned", at);
  return evidence;
}

describe("F-PT-006 option 1 — ID-blind identity migration", () => {
  it("collapses a retry whose producer minted a fresh id", async () => {
    const home = await makeWorld();
    const first = event("delivery-001");
    const retry = event("delivery-002");
    await drop(home, "alert-a.json", first);
    await drop(home, "alert-b.json", retry);

    const polled = await new EventStore(home.stateHome).poll(appEntry, NO_GITHUB);
    expect(inboxEventKey(first)).toBe(v2Key(first));
    expect(inboxEventKey(retry)).toBe(v2Key(first));
    expect(polled.events.map((item) => item.key)).toEqual([v2Key(first)]);
    expect(polled.collapsed.map((item) => item.file)).toEqual(["alert-b.json"]);
    expect(polled.events[0]?.payload["id"]).toBe("delivery-001");

    const downstream = await dispatchTick({
      orgRoot: home.orgHome,
      runtimeHome: home.stateHome,
      eventSource: NO_GITHUB,
      now: () => new Date("2026-08-12T08:55:00.000Z"),
      spawn: async () => undefined,
      dryRun: true,
    });
    expect(downstream.spawned[0]?.event).toMatchObject({ key: v2Key(first), payload: { id: "delivery-001" } });
    expect(downstream.spawned[0]?.event).not.toHaveProperty("migrationAliases");
  });

  it("keeps unknown fields and nested ids identity-bearing while stripping only top-level id and filename", () => {
    const base = event("delivery-001");
    expect(inboxEventKey({ ...base, extension: { id: "nested-a" } })).not.toBe(
      inboxEventKey({ ...base, extension: { id: "nested-b" } }),
    );
    expect(inboxEventKey({ ...base, vendor_fact: "a" })).not.toBe(inboxEventKey({ ...base, vendor_fact: "b" }));
  });

  it("keeps top-level id required even though identity excludes it", async () => {
    const home = await makeWorld();
    const { id: _id, ...missingId } = event("delivery-001");
    await drop(home, "missing-id.json", missingId);
    const polled = await new EventStore(home.stateHome).poll(appEntry, NO_GITHUB);
    expect([polled.events.length, polled.errors[0]?.code]).toEqual([0, "malformed_company_event"]);
  });

  it("unions mixed filename/v1 per-role marks across fresh-id duplicates and retires canonically", async () => {
    const home = await makeWorld([ROLE, "planner"]);
    const first = event("old-a");
    const peer = event("fresh-z");
    await drop(home, "alert-a.json", first);
    await drop(home, "alert-z.json", peer);
    const store = new EventStore(home.stateHome);
    await store.markConsumed([roleConsumedKey("alert-a.json", ROLE), roleConsumedKey(v1Key(peer), "planner")]);

    const result = await dispatchTick({
      orgRoot: home.orgHome,
      runtimeHome: home.stateHome,
      eventSource: NO_GITHUB,
      now: () => new Date("2026-08-12T09:00:00.000Z"),
      spawn: async () => undefined,
    });
    expect(result.spawned).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(await store.readConsumed()).toEqual([v2Key(first)]);
  });

  for (const kind of aliasKinds) {
    for (const placement of placements) {
      it(`migrates a bare ${kind} for the whole duplicate group from ${placement.markedFile}`, async () => {
        const home = await populatedWorld(placement);
        const store = new EventStore(home.stateHome);
        const oldMark = alias(kind, placement);
        await store.markConsumed([oldMark]);

        const polled = await store.poll(appEntry, NO_GITHUB);
        expect(polled.events).toEqual([]);
        expect(await store.readConsumed()).toContain(v2Key(event(placement.markedId)));
        expect(await store.readConsumed()).not.toContain(oldMark);
      });

      it(`migrates a per-role ${kind} before dispatch from ${placement.markedFile}`, async () => {
        const home = await populatedWorld(placement);
        const store = new EventStore(home.stateHome);
        const oldMark = roleConsumedKey(alias(kind, placement), ROLE);
        await store.markConsumed([oldMark]);

        const result = await dispatchTick({
          orgRoot: home.orgHome,
          runtimeHome: home.stateHome,
          eventSource: NO_GITHUB,
          now: () => new Date("2026-08-12T09:00:00.000Z"),
          spawn: async () => undefined,
        });
        expect(result.spawned).toEqual([]);
        expect(await store.readConsumed()).toContain(v2Key(event(placement.markedId)));
        expect(await store.readConsumed()).not.toContain(oldMark);
      });
    }

    it(`recovers crash-window scheduler evidence under the ${kind} alias without mutating dry-run`, async () => {
      const placement: Placement = {
        markedFile: "alert-z.json",
        markedId: "old-z",
        peerFile: "alert-a.json",
        peerId: "fresh-a",
      };
      const home = await populatedWorld(placement);
      const store = new EventStore(home.stateHome);
      const oldKey = alias(kind, placement);
      const firstAt = new Date("2026-08-12T09:00:00.000Z");
      const evidence = await seedSpawnEvidence(home, oldKey, firstAt);
      const listDecisions = evidence.listDecisions.bind(evidence);
      let evidenceReads = 0;
      evidence.listDecisions = async () => {
        evidenceReads += 1;
        return listDecisions();
      };
      expect(await evidence.hasSpawnedEvent([v2Key(event(placement.markedId)), oldKey], ROLE)).toBe(true);
      expect(evidenceReads).toBe(1);

      const preview = await dispatchTick({
        orgRoot: home.orgHome,
        runtimeHome: home.stateHome,
        eventSource: NO_GITHUB,
        now: () => firstAt,
        spawn: async () => undefined,
        dryRun: true,
      });
      expect(preview.spawned).toEqual([]);
      expect(await store.readConsumed()).toEqual([]);

      const reconciled = await dispatchTick({
        orgRoot: home.orgHome,
        runtimeHome: home.stateHome,
        eventSource: NO_GITHUB,
        now: () => new Date("2026-08-12T09:05:00.000Z"),
        spawn: async () => undefined,
      });
      expect(reconciled.spawned).toEqual([]);
      expect(reconciled.errors).toEqual([]);
      expect(await store.readConsumed()).toEqual([v2Key(event(placement.markedId))]);
    });
  }
});
