// HB-040 — CF-J10 / CF-SM-EVENT / CF-B13 event-inbox contract.
// F-PT-006 producer-partial-file and duplicate-identity/different-payload
// semantics remain deliberately absent and parked.

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dispatchTick } from "../../../src/org/dispatch.js";
import { EventStore, roleConsumedKey, type GitHubEventSource } from "../../../src/org/events.js";
import { releaseLock } from "../../../src/org/locks.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

const APP = "event-app";
const FILE = "feedback-001.json";
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

function appsYaml(channels = true): string {
  return [
    "schema_version: 1",
    "org:",
    "  name: event-org",
    "  max_concurrent_turns: 1",
    "defaults:",
    "  budget_usd_month: 1000",
    "apps:",
    `  ${APP}:`,
    "    repo: fixture/event-app",
    "    status: live",
    "    budget_usd_month: 1000",
    "    cadence: {}",
    ...(channels ? ["    channels:", "      support: [email]"] : []),
    "",
  ].join("\n");
}

function rolesYaml(roles: readonly ("planner" | "support")[]): string {
  const effectiveRoles = roles.length === 0 ? ["planner" as const] : roles;
  return [
    "defaults:",
    "  max_turn_budget_usd: 5",
    "roles:",
    ...effectiveRoles.flatMap((role) => [
      `  ${role}:`,
      "    runtime: claude",
      "    model: claude-scripted-model",
      "    effort: medium",
      "    delegation: {allow: []}",
      ...(roles.length === 0
        ? ["    triggers: []"]
        : ["    triggers:", "      - event: support-feedback"]),
      "    outputs: [notes]",
    ]),
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

async function makeWorld(
  roles: readonly ("planner" | "support")[] = ["planner", "support"],
  channels = true,
): Promise<TempOrgHome> {
  const home = await makeTempOrgHome({ name: "event-org" });
  homes.push(home);
  await writeFile(join(home.orgHome, "apps.yaml"), appsYaml(channels), "utf8");
  await writeFile(join(home.orgHome, "roles.yaml"), rolesYaml(roles), "utf8");
  const inbox = join(home.stateHome, "state", "events", "inbox");
  await mkdir(inbox, { recursive: true });
  await writeFile(join(inbox, FILE), JSON.stringify(validEvent()) + "\n", "utf8");
  return home;
}

async function tick(home: TempOrgHome, at: string, fault?: "after_child_spawn") {
  return dispatchTick({
    orgRoot: home.orgHome,
    runtimeHome: home.stateHome,
    eventSource: NO_GITHUB,
    now: () => new Date(at),
    spawn: async () => undefined,
    ...(fault === undefined
      ? {}
      : { schedulerFault: async (point: string) => { if (point === fault) throw new Error("seeded crash"); } }),
  });
}

async function unlock(home: TempOrgHome, role: string): Promise<void> {
  await releaseLock(home.stateHome, APP, role);
}

async function consumed(home: TempOrgHome): Promise<string[]> {
  return JSON.parse(await readFile(join(home.stateHome, "state", "events", "consumed.json"), "utf8")) as string[];
}

describe("HB-040 event inbox fan-out and state machine", () => {
  it("fans one event to every current subscriber across WIP-bounded ticks, then retires", async () => {
    const home = await makeWorld();
    const first = await tick(home, "2026-07-31T12:00:00.000Z");
    expect(first.spawned).toHaveLength(1);
    const firstRole = first.spawned[0]!.role;
    const secondRole = firstRole === "planner" ? "support" : "planner";
    expect(await consumed(home)).toContain(roleConsumedKey(FILE, firstRole));
    expect(await consumed(home)).not.toContain(FILE);

    await unlock(home, firstRole);
    const second = await tick(home, "2026-07-31T12:05:00.000Z");
    expect(second.spawned.map((turn) => turn.role)).toEqual([secondRole]);
    await unlock(home, secondRole);

    const retirement = await tick(home, "2026-07-31T12:10:00.000Z");
    expect(retirement.spawned).toEqual([]);
    expect(retirement.skipped.some((line) => line.includes("retired: all subscribers consumed"))).toBe(true);
    expect(await consumed(home)).toEqual([FILE]);
  });

  it("adds current subscribers to a pending event and stops removed subscribers blocking retirement", async () => {
    const added = await makeWorld(["support"]);
    const first = await tick(added, "2026-07-31T13:00:00.000Z");
    expect(first.spawned.map((turn) => turn.role)).toEqual(["support"]);
    await unlock(added, "support");
    await writeFile(join(added.orgHome, "roles.yaml"), rolesYaml(["planner", "support"]), "utf8");
    const inherited = await tick(added, "2026-07-31T13:05:00.000Z");
    expect(inherited.spawned.map((turn) => turn.role)).toEqual(["planner"]);

    const removed = await makeWorld(["planner", "support"]);
    const partial = await tick(removed, "2026-07-31T14:00:00.000Z");
    const handled = partial.spawned[0]!.role;
    await unlock(removed, handled);
    await writeFile(join(removed.orgHome, "roles.yaml"), rolesYaml([handled as "planner" | "support"]), "utf8");
    const converged = await tick(removed, "2026-07-31T14:05:00.000Z");
    expect(converged.skipped.some((line) => line.includes("retired: all subscribers consumed"))).toBe(true);
    expect(await consumed(removed)).toEqual([FILE]);
  });

  it("retains malformed, unknown-kind, no-subscriber, and channel-gated events loudly", async () => {
    const direct = await makeWorld([], false);
    const inbox = join(direct.stateHome, "state", "events", "inbox");
    await writeFile(join(inbox, FILE), "{not-json", "utf8");
    await writeFile(join(inbox, "future.json"), JSON.stringify(validEvent({ kind: "future-kind" })) + "\n", "utf8");
    const polled = await new EventStore(direct.stateHome).poll(
      { name: APP, repo: "fixture/event-app", status: "live", budgetUsdMonth: 1000, cadence: {} },
      NO_GITHUB,
    );
    expect(polled.errors.map((error) => error.code).sort()).toEqual([
      "malformed_company_event",
      "unknown_company_event_kind",
    ]);

    await writeFile(join(inbox, FILE), JSON.stringify(validEvent()) + "\n", "utf8");
    const noSubscriber = await tick(direct, "2026-07-31T15:00:00.000Z");
    expect(noSubscriber.skipped.some((line) => line.startsWith("no_subscriber:"))).toBe(true);
    expect(await consumed(direct)).not.toContain(FILE);

    const gated = await makeWorld(["support"], false);
    const gatedTick = await tick(gated, "2026-07-31T15:05:00.000Z");
    expect(gatedTick.spawned).toEqual([]);
    expect(gatedTick.skipped.some((line) => line.includes("support channel gate"))).toBe(true);
    expect(await consumed(gated)).not.toContain(FILE);
  });

  it("recovers a crash after durable spawn but before the per-role mark without refiring", async () => {
    const home = await makeWorld(["support"]);
    await expect(tick(home, "2026-07-31T16:00:00.000Z", "after_child_spawn")).rejects.toThrow("seeded crash");
    expect(await consumed(home)).not.toContain(roleConsumedKey(FILE, "support"));
    await unlock(home, "support");

    const recovered = await tick(home, "2026-07-31T16:05:00.000Z");
    expect(recovered.spawned).toEqual([]);
    expect(recovered.skipped.some((line) => line.includes("retired: all subscribers consumed"))).toBe(true);
    expect(await consumed(home)).toEqual([FILE]);
  });
});
