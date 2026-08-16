// Traceability: CF-B13 · CF-C-B13 · CF-J10-I · CF-SM-EVENT-L/I · HB-040 · HB-P3 · contracts/B-13-event-inbox.md §2 + §6; case-catalog.md §2 event machine; boundary-map.md B-13.

// HB-P3 — F-PT-006 (owner ruling 2026-08-12): EXACTLY ONE FIRING PER REAL-WORLD
// EVENT. Duplicate deliveries collapse to one; the dedup identity is derived
// from the payload CONTENT, never from the delivery filename and never from a
// producer-supplied id.
//
// The three clauses this suite pins, and the seeded control for each:
//   (1) two deliveries of the same content fire ONCE      — control: a
//       filename-keyed identity (the pre-ruling behavior) fires TWICE.
//   (2) two payloads that differ are two events           — control: keying on
//       the producer's own `id` field collapses them into one, losing an event.
//   (3) a legacy filename mark still suppresses its file  — control: dropping
//       the legacy check re-fires an already-consumed event after upgrade.
// Clause (4), producer atomicity: a partial file is retained and fires exactly
// once when the complete bytes land — no temp-file+rename obligation.
//
// The seeded controls run the ORACLE against a deliberately wrong identity
// function, so each assertion is proven to fail before it is allowed to pass;
// none of them derives its expected value from the shipped implementation.

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dispatchTick } from "../../../src/org/dispatch.js";
import { EventStore, inboxEventKey, type GitHubEventSource } from "../../../src/org/events.js";
import { sha256, stableJson } from "../../../src/org/lifecycle.js";
import { readLock, releaseLock } from "../../../src/org/locks.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

const APP = "event-app";
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

function appsYaml(): string {
  return [
    "schema_version: 1",
    "org:",
    "  name: event-org",
    "  max_concurrent_turns: 4",
    "defaults:",
    "  budget_usd_month: 1000",
    "apps:",
    `  ${APP}:`,
    "    repo: fixture/event-app",
    "    status: live",
    "    budget_usd_month: 1000",
    "    cadence: {}",
    "    channels:",
    "      support: [email]",
    "",
  ].join("\n");
}

function rolesYaml(): string {
  return [
    "defaults:",
    "  max_turn_budget_usd: 5",
    "roles:",
    "  support:",
    "    runtime: claude",
    "    model: claude-scripted-model",
    "    effort: medium",
    "    delegation: {allow: []}",
    "    triggers:",
    "      - event: support-feedback",
    "    outputs: [notes]",
    "",
  ].join("\n");
}

function validEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "support-feedback",
    id: "feedback-001",
    app: APP,
    occurred_at: "2026-07-31T12:00:00.000Z",
    source: "fixture",
    severity: "high",
    channel: "email",
    summary: "Customer cannot complete checkout",
    ...overrides,
  };
}

async function makeWorld(): Promise<TempOrgHome> {
  const home = await makeTempOrgHome({ name: "event-org" });
  homes.push(home);
  await writeFile(join(home.orgHome, "apps.yaml"), appsYaml(), "utf8");
  await writeFile(join(home.orgHome, "roles.yaml"), rolesYaml(), "utf8");
  await mkdir(join(home.stateHome, "state", "events", "inbox"), { recursive: true });
  return home;
}

async function drop(home: TempOrgHome, file: string, body: string): Promise<void> {
  await writeFile(join(home.stateHome, "state", "events", "inbox", file), body, "utf8");
}

async function tick(home: TempOrgHome, at: string) {
  return dispatchTick({
    orgRoot: home.orgHome,
    runtimeHome: home.stateHome,
    eventSource: NO_GITHUB,
    now: () => new Date(at),
    spawn: async () => undefined,
  });
}

async function unlock(home: TempOrgHome): Promise<void> {
  const lock = await readLock(home.stateHome, APP, "support");
  await releaseLock(home.stateHome, APP, "support", lock);
}

const appEntry = {
  name: APP,
  repo: "fixture/event-app",
  status: "live" as const,
  budgetUsdMonth: 1000,
  objectiveBudgetUsd: 1000,
  cadence: {},
};

/** The generic one-firing oracle, parameterized by the identity function under
 *  test. Returns how many DISTINCT events a sweep of the inbox produced. */
function distinctEvents(
  payloads: readonly Record<string, unknown>[],
  identity: (p: Record<string, unknown>) => string,
): number {
  return new Set(payloads.map(identity)).size;
}

/** SEEDED VIOLATION (1): the pre-ruling identity — key on the delivery. */
const filenameIdentity = (payload: Record<string, unknown>): string => String(payload["filename"] ?? "");
/** SEEDED VIOLATION (2): a producer-supplied id, the rejected alternative. */
const producerIdIdentity = (payload: Record<string, unknown>): string => `event:${String(payload["id"] ?? "")}`;

describe("CF-B13 — content-derived event identity (HB-P3, F-PT-006 ratified 2026-08-12)", () => {
  it("clause 1: two deliveries of the same event content fire exactly ONCE, and the collapse is reported", async () => {
    const home = await makeWorld();
    const body = `${JSON.stringify(validEvent())}\n`;
    await drop(home, "alert-a.json", body);
    // Same event, re-delivered under a different name and different byte
    // formatting (pretty-printed, keys reordered) — still ONE real-world event.
    const reordered = { summary: "Customer cannot complete checkout", ...validEvent() };
    await drop(home, "alert-b.json", `${JSON.stringify(reordered, null, 2)}\n`);

    const first = await tick(home, "2026-08-12T09:00:00.000Z");
    expect(first.spawned).toHaveLength(1);
    expect(
      first.skipped.filter((line) => line.startsWith("duplicate_delivery:") && line.includes("alert-b.json")),
    ).toHaveLength(1);

    // And it stays one firing across ticks: the second file never becomes a
    // turn of its own once the identity is consumed.
    await unlock(home);
    const second = await tick(home, "2026-08-12T09:05:00.000Z");
    expect(second.spawned).toEqual([]);
  });

  it("clause 1 — SEEDED VIOLATION: a filename-keyed identity fires twice for one real-world event", () => {
    const payloads = [
      { ...validEvent(), filename: "alert-a.json" },
      { ...validEvent(), filename: "alert-b.json" },
    ];
    // The oracle under the seeded (pre-ruling) identity: two firings — the
    // exact defect the ruling forbids. Under the ratified identity: one.
    expect(distinctEvents(payloads, filenameIdentity)).toBe(2);
    expect(distinctEvents(payloads, inboxEventKey)).toBe(1);
  });

  it("clause 2: two payloads that differ are two events, so same-identity-two-payloads cannot arise", async () => {
    const home = await makeWorld();
    // Same producer-supplied `id`, genuinely different content: under the
    // ratified rule these are two events and BOTH must be delivered.
    await drop(home, "alert-a.json", `${JSON.stringify(validEvent())}\n`);
    await drop(home, "alert-b.json", `${JSON.stringify(validEvent({ summary: "Checkout now returns HTTP 500" }))}\n`);

    const polled = await new EventStore(home.stateHome).poll(appEntry, NO_GITHUB);
    expect(polled.collapsed).toEqual([]);
    expect(polled.events).toHaveLength(2);
    expect(new Set(polled.events.map((event) => event.key)).size).toBe(2);
  });

  it("clause 2 — SEEDED VIOLATION: a producer-supplied id collapses two distinct events into one, losing one", () => {
    const payloads = [validEvent(), validEvent({ summary: "Checkout now returns HTTP 500" })];
    // The rejected alternative silently drops the second event...
    expect(distinctEvents(payloads, producerIdIdentity)).toBe(1);
    // ...while content identity keeps both, which is why the contract owes no
    // "same identity, two payloads" resolution rule at all.
    expect(distinctEvents(payloads, inboxEventKey)).toBe(2);
  });

  it("clause 3: a legacy filename mark written before the ruling still suppresses its own file", async () => {
    const home = await makeWorld();
    await drop(home, "alert-a.json", `${JSON.stringify(validEvent())}\n`);
    // Pre-upgrade durable state: consumed.json holds the FILENAME.
    const store = new EventStore(home.stateHome);
    await store.markConsumed(["alert-a.json"]);

    const polled = await store.poll(appEntry, NO_GITHUB);
    expect(polled.events).toEqual([]);
    expect(polled.collapsed).toEqual([]);
  });

  it("clause 3 — SEEDED VIOLATION: ignoring the legacy mark re-fires an already-consumed event after upgrade", async () => {
    const home = await makeWorld();
    const payload = validEvent();
    await drop(home, "alert-a.json", `${JSON.stringify(payload)}\n`);
    const store = new EventStore(home.stateHome);
    await store.markConsumed(["alert-a.json"]);

    // Seed the violation by asking the store what it would do with ONLY the
    // new-style marks — i.e. a migration that forgot the legacy branch.
    const withoutLegacyMark = await store.readInbox(APP, new Set([inboxEventKey(payload)]));
    const ignoringBothMarks = await store.readInbox(APP, new Set());
    expect(withoutLegacyMark.events).toEqual([]); // new-style mark alone suppresses
    expect(ignoringBothMarks.events).toHaveLength(1); // detector fires: the event comes back
  });

  it("clause 4: a partial file is retained, never dropped, and fires exactly once when the complete bytes land", async () => {
    const home = await makeWorld();
    const complete = `${JSON.stringify(validEvent())}\n`;
    // A producer writing without temp-file+rename: the dispatcher sees a torn file.
    await drop(home, "alert-a.json", complete.slice(0, 40));

    const store = new EventStore(home.stateHome);
    const torn = await store.poll(appEntry, NO_GITHUB);
    expect(torn.events).toEqual([]);
    expect(torn.errors.map((error) => error.code)).toEqual(["malformed_company_event"]);

    // The producer finishes the write. One firing, no duplicate from the
    // earlier torn read — producers owe no atomicity (B-13 §6).
    await drop(home, "alert-a.json", complete);
    const settled = await tick(home, "2026-08-12T10:00:00.000Z");
    expect(settled.spawned).toHaveLength(1);
    await unlock(home);
    const again = await tick(home, "2026-08-12T10:05:00.000Z");
    expect(again.spawned).toEqual([]);
  });

  it("the identity function itself: canonical over key order and whitespace, and blind to the transport filename", () => {
    const a = validEvent();
    const b = { summary: "Customer cannot complete checkout", ...validEvent() };
    expect(inboxEventKey(a)).toBe(inboxEventKey(b));
    // `filename` is transport, added by readInbox — it must not enter identity.
    expect(inboxEventKey({ ...a, filename: "alert-a.json" })).toBe(inboxEventKey(a));
    // Content genuinely differing must differ.
    expect(inboxEventKey(validEvent({ severity: "low" }))).not.toBe(inboxEventKey(a));
    // The shape is the documented one, computed independently of the module.
    expect(inboxEventKey(a)).toBe(`event:${sha256(stableJson(a))}`);
    // A per-role mark can never be impersonated by the key (the "::" reservation).
    expect(inboxEventKey(a)).not.toContain("::");
  });
});
