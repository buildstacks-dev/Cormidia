// Traceability: CF-INV-014 · HB-149 · validation-design/invariants.md CORMIDIA-INV-014.
// L2 admission/bookkeeping sweep: every considered scheduler candidate stays
// visible through the exact four ratified adversarial seeds.

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dispatchTick } from "../../../src/org/dispatch.js";
import { EventStore, type GitHubEventSource } from "../../../src/org/events.js";
import { acquireLock } from "../../../src/org/locks.js";
import { SchedulerEvidenceStore, type SchedulerDecisionRecord } from "../../../src/org/scheduler/evidence.js";
import { schedulerIdentity } from "../../../src/org/scheduler/model.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

const NOW = new Date("2026-08-11T16:00:00.000Z");
const NO_EVENTS: GitHubEventSource = {
  ticketReady: async () => [],
  prOpened: async () => [],
  ciFailed: async () => [],
  releaseShipped: async () => [],
  openIssues: async () => [{ number: 149, title: "actionable scheduler work", labels: [] }],
};

class ConsideredWorkEvidenceViolation extends Error {}

type EvidenceRow = Pick<
  SchedulerDecisionRecord,
  "stage" | "outcome" | "classification" | "reason_code" | "episode_id" | "detail"
>;

function assertNamedEvidence(
  row: EvidenceRow,
  expected: {
    stage: SchedulerDecisionRecord["stage"];
    outcome: SchedulerDecisionRecord["outcome"];
    classification: SchedulerDecisionRecord["classification"];
    reason: SchedulerDecisionRecord["reason_code"];
  },
): void {
  if (
    row.stage !== expected.stage ||
    row.outcome !== expected.outcome ||
    row.classification !== expected.classification ||
    row.reason_code !== expected.reason ||
    row.episode_id === null
  ) {
    throw new ConsideredWorkEvidenceViolation(
      `expected ${expected.reason}, got ${row.reason_code ?? "unnamed"} (${row.stage}/${row.outcome})`,
    );
  }
}

function assertEventSweepRefusedWithoutMarks(consumed: readonly string[], eventKey: string): void {
  if (consumed.includes(eventKey)) {
    throw new ConsideredWorkEvidenceViolation(`event ${eventKey} retired without subscriber marks`);
  }
}

function assertFailureVocabularyRemainsDistinct(rows: readonly EvidenceRow[]): void {
  const reasons = new Set(rows.map((row) => row.reason_code));
  for (const reason of ["spawn_failure", "post_spawn_bookkeeping_failure"] as const) {
    if (!reasons.has(reason)) {
      throw new ConsideredWorkEvidenceViolation(`collapsed scheduler failure vocabulary omitted ${reason}`);
    }
  }
}

describe("CF-INV-014 — considered work never vanishes (L2, HB-149)", () => {
  const homes: TempOrgHome[] = [];

  afterEach(async () => {
    await Promise.all(homes.splice(0).map((home) => home.cleanup()));
  });

  async function world(
    input: { apps?: readonly string[]; role?: "sre" | "support"; trigger?: "schedule" | "event" } = {},
  ): Promise<TempOrgHome> {
    const apps = input.apps ?? ["app-a"];
    const role = input.role ?? "sre";
    const trigger = input.trigger ?? "schedule";
    const home = await makeTempOrgHome({ name: `inv-014-${homes.length}` });
    homes.push(home);
    await writeFile(
      join(home.orgHome, "apps.yaml"),
      [
        "schema_version: 1",
        "org:",
        "  name: inv-014-org",
        "  max_concurrent_turns: 1",
        "defaults:",
        "  budget_usd_month: 1000",
        "apps:",
        ...apps.flatMap((app) => [
          `  ${app}:`,
          `    repo: fixture/${app}`,
          "    status: live",
          "    cadence: {}",
          ...(trigger === "event" ? ["    channels:", "      support: [email]"] : []),
          "    release:",
          "      kind: deploy",
          "      owner: sre",
          "      trigger: command",
          "      command: ./deploy.sh",
        ]),
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(home.orgHome, "roles.yaml"),
      [
        "defaults:",
        "  max_turn_budget_usd: 5",
        "roles:",
        `  ${role}:`,
        "    runtime: claude",
        "    model: claude-scripted-model",
        "    effort: medium",
        "    delegation: {allow: []}",
        "    triggers:",
        trigger === "schedule" ? "      - schedule: hourly" : "      - event: support-feedback",
        "    outputs: [notes]",
        "",
      ].join("\n"),
      "utf8",
    );
    return home;
  }

  function evidence(home: TempOrgHome): SchedulerEvidenceStore {
    return new SchedulerEvidenceStore({
      stateHome: home.stateHome,
      orgName: "inv-014-org",
      orgHome: home.orgHome,
      schedulerId: schedulerIdentity("inv-014-org", home.orgHome),
    });
  }

  it("records every WIP-limited candidate with the named backpressure reason", async () => {
    const home = await world({ apps: ["app-a", "app-b"] });
    const tick = await dispatchTick({
      orgRoot: home.orgHome,
      runtimeHome: home.stateHome,
      now: () => NOW,
      eventSource: NO_EVENTS,
      spawn: async () => undefined,
    });

    expect(tick.spawned).toHaveLength(1);
    const limited = (await evidence(home).listDecisions()).find((row) => row.reason_code === "wip_limit");
    expect(limited).toBeDefined();
    expect(() =>
      assertNamedEvidence(limited!, {
        stage: "terminal",
        outcome: "blocked",
        classification: "blocked_backpressure",
        reason: "wip_limit",
      }),
    ).not.toThrow();
  });

  it("refuses to retire an event when the subscriber consumption marks are absent", async () => {
    const home = await world({ role: "support", trigger: "event" });
    const eventKey = "feedback-149.json";
    const inbox = join(home.stateHome, "state", "events", "inbox");
    await mkdir(inbox, { recursive: true });
    await writeFile(
      join(inbox, eventKey),
      `${JSON.stringify({
        kind: "support-feedback",
        id: "feedback-149",
        app: "app-a",
        occurred_at: NOW.toISOString(),
        source: "fixture",
        severity: "high",
        channel: "email",
        summary: "subscriber has not consumed this event",
      })}\n`,
      "utf8",
    );
    await acquireLock(home.stateHome, { app: "occupied", role: "sre", turnId: "existing-wip", now: NOW });

    const tick = await dispatchTick({
      orgRoot: home.orgHome,
      runtimeHome: home.stateHome,
      now: () => NOW,
      eventSource: NO_EVENTS,
      spawn: async () => {
        throw new Error("WIP-limited event must not spawn");
      },
    });
    const consumed = await new EventStore(home.stateHome).readConsumed();

    expect(tick.spawned).toEqual([]);
    expect(() => assertEventSweepRefusedWithoutMarks(consumed, eventKey)).not.toThrow();
    expect(
      (
        await new EventStore(home.stateHome).poll(
          {
            name: "app-a",
            repo: "fixture/app-a",
            status: "live",
            budgetUsdMonth: 1000,
            objectiveBudgetUsd: 1000,
            cadence: {},
          },
          NO_EVENTS,
        )
      ).events.map((event) => event.key),
    ).toContain(eventKey);
  });

  it("names spawn failure after the durable scheduler decision was committed", async () => {
    const home = await world();
    let attempted = false;
    await dispatchTick({
      orgRoot: home.orgHome,
      runtimeHome: home.stateHome,
      now: () => NOW,
      eventSource: NO_EVENTS,
      spawn: async () => {
        attempted = true;
        throw new Error("seeded spawn ENOENT");
      },
    });

    const failed = (await evidence(home).listDecisions()).find((row) => row.reason_code === "spawn_failure");
    expect(attempted).toBe(true);
    expect(failed?.detail).toBe("seeded spawn ENOENT");
    expect(() =>
      assertNamedEvidence(failed!, {
        stage: "terminal",
        outcome: "failed",
        classification: "blocked_error",
        reason: "spawn_failure",
      }),
    ).not.toThrow();
  });

  it("keeps post-spawn bookkeeping failure distinct while the child remains pending", async () => {
    const home = await world();
    const tick = await dispatchTick({
      orgRoot: home.orgHome,
      runtimeHome: home.stateHome,
      now: () => NOW,
      eventSource: NO_EVENTS,
      spawn: async () => undefined,
      schedulerFault: async (boundary) => {
        if (boundary === "post_spawn_bookkeeping") throw new Error("seeded schedule-state EIO");
      },
    });

    const pending = (await evidence(home).listDecisions()).find(
      (row) => row.reason_code === "post_spawn_bookkeeping_failure",
    );
    expect(tick.errors).toContain("app-a/sre: post-spawn bookkeeping failed: seeded schedule-state EIO");
    expect(() =>
      assertNamedEvidence(pending!, {
        stage: "spawned",
        outcome: null,
        classification: "pending",
        reason: "post_spawn_bookkeeping_failure",
      }),
    ).not.toThrow();
  });

  it("negative control: a collapsed failure vocabulary makes the invariant detector fire", () => {
    const collapsed = [
      {
        stage: "terminal",
        outcome: "failed",
        classification: "blocked_error",
        reason_code: "scheduler_state_failure",
        episode_id: "spawned-1",
        detail: "collapsed spawn failure",
      },
      {
        stage: "terminal",
        outcome: "failed",
        classification: "blocked_error",
        reason_code: "scheduler_state_failure",
        episode_id: "spawned-2",
        detail: "collapsed bookkeeping failure",
      },
    ] satisfies EvidenceRow[];

    expect(() => assertFailureVocabularyRemainsDistinct(collapsed)).toThrow(ConsideredWorkEvidenceViolation);
  });

  it("the real spawn and bookkeeping evidence passes the same distinct-vocabulary detector", async () => {
    const spawnHome = await world();
    await dispatchTick({
      orgRoot: spawnHome.orgHome,
      runtimeHome: spawnHome.stateHome,
      now: () => NOW,
      eventSource: NO_EVENTS,
      spawn: async () => {
        throw new Error("seeded spawn ENOENT");
      },
    });
    const bookkeepingHome = await world();
    await dispatchTick({
      orgRoot: bookkeepingHome.orgHome,
      runtimeHome: bookkeepingHome.stateHome,
      now: () => NOW,
      eventSource: NO_EVENTS,
      spawn: async () => undefined,
      schedulerFault: async (boundary) => {
        if (boundary === "post_spawn_bookkeeping") throw new Error("seeded schedule-state EIO");
      },
    });

    const rows = [...(await evidence(spawnHome).listDecisions()), ...(await evidence(bookkeepingHome).listDecisions())];
    expect(() => assertFailureVocabularyRemainsDistinct(rows)).not.toThrow();
  });
});
