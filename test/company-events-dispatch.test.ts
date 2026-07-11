// Tests company-lifecycle file-drop routing on the real dispatch path.
// Covers Support/Marketing/Planner/SRE fan-out, malformed payload reporting,
// no-subscriber skips, and channel-presence gating.
// Uses temp inboxes and synthetic apps.yaml with repo-local roles.yaml; no
// network, auth, real org state, or live clock is required.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dispatchTick } from "../src/org/dispatch.js";
import { EventStore, type GitHubEventSource } from "../src/org/events.js";
import { releaseLock } from "../src/org/locks.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

const REAL_ROLES = fileURLToPath(new URL("../roles.yaml", import.meta.url));

const SUPPORT_FEEDBACK = {
  kind: "support-feedback",
  id: "feedback-001",
  app: "alpha",
  occurred_at: "2026-07-06T12:00:00Z",
  source: "fixture",
  severity: "medium",
  channel: "email",
  summary: "User cannot tell whether /health failure is transient.",
};

const ADOPTION_SIGNAL = {
  kind: "adoption-signal",
  id: "adoption-001",
  app: "alpha",
  occurred_at: "2026-07-06T12:00:00Z",
  source: "fixture",
  metric: "weekly_active_checks",
  direction: "up",
  value: 42,
  summary: "Health endpoint checks doubled after the last release.",
};

const HEALTH_ALERT = {
  kind: "health-alert",
  id: "health-001",
  app: "alpha",
  occurred_at: "2026-07-06T12:00:00Z",
  source: "fixture",
  severity: "critical",
  service: "web",
  status: "down",
  summary: "/health returned 500 for three consecutive checks.",
};

const LAUNCH_CALENDAR = {
  kind: "launch-calendar",
  id: "launch-001",
  app: "alpha",
  occurred_at: "2026-07-06T12:00:00Z",
  source: "fixture",
  date: "2026-07-20",
  milestone: "sandbox gamma smoke",
  summary: "Prepare draft release notes after the smoke passes.",
};

function emptySource(): GitHubEventSource {
  return {
    ticketReady: async () => [],
    prOpened: async () => [],
    ciFailed: async () => [],
    releaseShipped: async () => [],
  };
}

function appsYaml(withChannels: boolean): string {
  const channels = withChannels
    ? `    channels:
      support: ["email"]
      marketing: ["blog"]
`
    : "";
  return `schema_version: 1
org:
  name: test
  max_concurrent_turns: 20
defaults:
  budget_usd_month: 1000
apps:
  alpha:
    repo: owner/repo
    status: live
${channels}`;
}

async function runDispatch(opts: {
  inbox: Record<string, unknown>;
  withChannels?: boolean;
  rolesYaml?: string;
  now?: string;
}) {
  const home = makeOrgHome({ state: { eventsInbox: opts.inbox }, approvals: true });
  const appsPath = join(home.root, "apps.yaml");
  writeFileSync(appsPath, appsYaml(opts.withChannels ?? true), "utf8");
  let rolesPath = REAL_ROLES;
  if (opts.rolesYaml !== undefined) {
    rolesPath = join(home.root, "roles.yaml");
    writeFileSync(rolesPath, opts.rolesYaml, "utf8");
  }
  try {
    return await dispatchTick({
      runtimeHome: home.root,
      appsPath,
      rolesPath,
      now: () => new Date(opts.now ?? "2026-07-06T10:00:00Z"),
      eventSource: emptySource(),
      dryRun: true,
    });
  } finally {
    home.cleanup();
  }
}

/** Event-trigger turns as `role:kind`, sorted — schedule turns filtered out. */
function eventTurns(result: Awaited<ReturnType<typeof runDispatch>>): string[] {
  return result.spawned
    .filter((turn) => turn.triggerKind === "event")
    .map((turn) => `${turn.role}:${turn.trigger}`)
    .sort();
}

describe("company-lifecycle event routing (GAP B)", () => {
  it("support-feedback reaches Support digest and Planner groom", async () => {
    const result = await runDispatch({ inbox: { "sf.json": SUPPORT_FEEDBACK } });
    expect(eventTurns(result)).toEqual(["planner:support-feedback", "support:support-feedback"]);
  });

  it("adoption-signal reaches Marketing sweep and Planner groom", async () => {
    const result = await runDispatch({ inbox: { "as.json": ADOPTION_SIGNAL } });
    expect(eventTurns(result)).toEqual(["marketing:adoption-signal", "planner:adoption-signal"]);
  });

  it("health-alert reaches only SRE", async () => {
    const result = await runDispatch({ inbox: { "ha.json": HEALTH_ALERT } });
    expect(eventTurns(result)).toEqual(["sre:health-alert"]);
  });

  it("launch-calendar reaches only Marketing", async () => {
    const result = await runDispatch({ inbox: { "lc.json": LAUNCH_CALENDAR } });
    expect(eventTurns(result)).toEqual(["marketing:launch-calendar"]);
  });

  it("a malformed inbox payload surfaces loudly, never silently dropped", async () => {
    const result = await runDispatch({ inbox: { "bad.json": { kind: "health-alert" } } });
    expect(result.errors.some((e) => e.includes("alert-webhook") && e.includes("inbox bad.json:"))).toBe(
      true,
    );
    expect(eventTurns(result)).toEqual([]);
  });

  it("an event kind with no subscriber is recorded, not lost", async () => {
    const rolesYaml = `roles:
  planner:
    runtime: claude
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - event: support-feedback
    outputs: []
`;
    const result = await runDispatch({ inbox: { "health.json": HEALTH_ALERT }, rolesYaml });
    expect(eventTurns(result)).toEqual([]);
    expect(result.skipped).toContain("alpha: event health-alert (health.json) has no subscriber");
  });
});

describe("multi-subscriber fan-out under WIP limits (issue #25)", () => {
  const TWO_SUBSCRIBERS = `roles:
  planner:
    runtime: claude
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - event: support-feedback
    outputs: []
  support:
    runtime: claude
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - event: support-feedback
    outputs: []
`;

  function fanoutHome(withChannels: boolean, maxConcurrent: number) {
    const home = makeOrgHome({
      state: { eventsInbox: { "sf.json": SUPPORT_FEEDBACK } },
      approvals: true,
    });
    const appsPath = join(home.root, "apps.yaml");
    writeFileSync(
      appsPath,
      appsYaml(withChannels).replace("max_concurrent_turns: 20", `max_concurrent_turns: ${maxConcurrent}`),
      "utf8",
    );
    const rolesPath = join(home.root, "roles.yaml");
    writeFileSync(rolesPath, TWO_SUBSCRIBERS, "utf8");
    return { home, appsPath, rolesPath };
  }

  it("one event reaches both subscribers when the WIP limit splits them across ticks", async () => {
    const { home, appsPath, rolesPath } = fanoutHome(true, 1);
    const spawned: string[] = [];
    const tick = () =>
      dispatchTick({
        runtimeHome: home.root,
        appsPath,
        rolesPath,
        now: () => new Date("2026-07-06T10:00:00Z"),
        eventSource: emptySource(),
        spawn: async ({ role }) => {
          spawned.push(role);
        },
      });
    const store = new EventStore(home.root);
    try {
      await tick();
      expect(spawned).toHaveLength(1);
      // The event must NOT be fully retired: its co-subscriber has not run.
      expect(await store.readConsumed()).not.toContain("sf.json");

      await releaseLock(home.root, "alpha", spawned[0]!); // first turn completes
      await tick();
      expect(spawned).toHaveLength(2);
      expect([...spawned].sort()).toEqual(["planner", "support"]);
      // Both subscribers have run: now the bare key retires the event.
      expect(await store.readConsumed()).toContain("sf.json");

      await releaseLock(home.root, "alpha", spawned[1]!);
      await tick();
      expect(spawned).toHaveLength(2); // no re-fire for either role
    } finally {
      home.cleanup();
    }
  });

  it("a channel-gated co-subscriber is not starved by an earlier spawn", async () => {
    const { home, appsPath, rolesPath } = fanoutHome(false, 20);
    const spawned: string[] = [];
    const tick = () =>
      dispatchTick({
        runtimeHome: home.root,
        appsPath,
        rolesPath,
        now: () => new Date("2026-07-06T10:00:00Z"),
        eventSource: emptySource(),
        spawn: async ({ role }) => {
          spawned.push(role);
        },
      });
    const store = new EventStore(home.root);
    try {
      const first = await tick();
      // Planner (not gated) spawns; Support is channel-gated with a reason.
      expect(spawned).toEqual(["planner"]);
      expect(first.skipped.join("\n")).toContain("support channel gate");
      // The event stays live for the gated subscriber.
      expect(await store.readConsumed()).not.toContain("sf.json");

      await releaseLock(home.root, "alpha", "planner");
      const second = await tick();
      // Planner does not re-fire; Support stays observably gated.
      expect(spawned).toEqual(["planner"]);
      expect(second.skipped.join("\n")).toContain("support channel gate");

      // The app grows a support channel: the waiting event now reaches Support.
      writeFileSync(appsPath, appsYaml(true).replace("max_concurrent_turns: 20", "max_concurrent_turns: 20"), "utf8");
      await tick();
      expect(spawned).toEqual(["planner", "support"]);
      expect(await store.readConsumed()).toContain("sf.json");
    } finally {
      home.cleanup();
    }
  });

  it("a single-subscriber event retires on its first spawn", async () => {
    const home = makeOrgHome({
      state: { eventsInbox: { "ha.json": HEALTH_ALERT } },
      approvals: true,
    });
    const appsPath = join(home.root, "apps.yaml");
    writeFileSync(appsPath, appsYaml(true), "utf8");
    const spawned: string[] = [];
    const store = new EventStore(home.root);
    try {
      await dispatchTick({
        runtimeHome: home.root,
        appsPath,
        rolesPath: REAL_ROLES,
        now: () => new Date("2026-07-06T10:00:00Z"),
        eventSource: emptySource(),
        spawn: async ({ role }) => {
          spawned.push(role);
        },
      });
      expect(spawned).toContain("sre");
      expect(await store.readConsumed()).toContain("ha.json");
    } finally {
      home.cleanup();
    }
  });
});

describe("channel-presence gating (GAP E)", () => {
  it("a channel-less live app skips Support and Marketing with an observable reason", async () => {
    const result = await runDispatch({
      inbox: { "sf.json": SUPPORT_FEEDBACK, "as.json": ADOPTION_SIGNAL },
      withChannels: false,
    });
    const skipped = result.skipped.join("\n");
    // Support and Marketing are gated (schedule AND event) with a stated reason.
    expect(skipped).toContain("support channel gate");
    expect(skipped).toContain("marketing channel gate");
    // Neither audience role produced a turn...
    const roles = eventTurns(result);
    expect(roles).not.toContain("support:support-feedback");
    expect(roles).not.toContain("marketing:adoption-signal");
    // ...but Planner (not channel-gated) still grooms both signals.
    expect(roles).toEqual(["planner:adoption-signal", "planner:support-feedback"]);
  });

  it("an app that declares channels still fires Support and Marketing", async () => {
    const result = await runDispatch({
      inbox: { "sf.json": SUPPORT_FEEDBACK, "as.json": ADOPTION_SIGNAL },
      withChannels: true,
    });
    const roles = eventTurns(result);
    expect(roles).toContain("support:support-feedback");
    expect(roles).toContain("marketing:adoption-signal");
    // No channel-gate skip lines when the channels are present.
    expect(result.skipped.join("\n")).not.toContain("channel gate");
  });
});
