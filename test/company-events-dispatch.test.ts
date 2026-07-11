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

function appsYaml(withChannels: boolean, maxConcurrent = 20): string {
  const channels = withChannels
    ? `    channels:
      support: ["email"]
      marketing: ["blog"]
`
    : "";
  return `schema_version: 1
org:
  name: test
  max_concurrent_turns: ${maxConcurrent}
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
  function roleYaml(name: string, event: string): string {
    return `  ${name}:
    runtime: claude
    model: m
    effort: high
    delegation: {allow: []}
    triggers:
      - event: ${event}
    outputs: []
`;
  }
  const TWO_SUBSCRIBERS = `roles:\n${roleYaml("planner", "support-feedback")}${roleYaml("support", "support-feedback")}`;

  /** Multi-tick fan-out harness: real dispatchTick + EventStore + locks with
   *  only the spawn call injected. `tick()` accepts option overrides. */
  function fanoutHome(opts: {
    withChannels: boolean;
    maxConcurrent?: number;
    inbox?: Record<string, unknown>;
    rolesYaml?: string;
  }) {
    const home = makeOrgHome({
      state: { eventsInbox: opts.inbox ?? { "sf.json": SUPPORT_FEEDBACK } },
      approvals: true,
    });
    const appsPath = join(home.root, "apps.yaml");
    writeFileSync(appsPath, appsYaml(opts.withChannels, opts.maxConcurrent ?? 20), "utf8");
    const rolesPath = join(home.root, "roles.yaml");
    writeFileSync(rolesPath, opts.rolesYaml ?? TWO_SUBSCRIBERS, "utf8");
    const spawned: string[] = [];
    const tick = (overrides: Parameters<typeof dispatchTick>[0] = {}) =>
      dispatchTick({
        runtimeHome: home.root,
        appsPath,
        rolesPath,
        now: () => new Date("2026-07-06T10:00:00Z"),
        eventSource: emptySource(),
        spawn: async ({ role }) => {
          spawned.push(role);
        },
        ...overrides,
      });
    return { home, appsPath, rolesPath, spawned, tick, store: new EventStore(home.root) };
  }

  it("one event reaches both subscribers when the WIP limit splits them across ticks", async () => {
    const f = fanoutHome({ withChannels: true, maxConcurrent: 1 });
    try {
      await f.tick();
      expect(f.spawned).toHaveLength(1);
      // The event must NOT be retired: its co-subscriber has not run.
      expect(await f.store.readConsumed()).not.toContain("sf.json");

      await releaseLock(f.home.root, "alpha", f.spawned[0]!); // first turn completes
      await f.tick();
      expect(f.spawned).toHaveLength(2);
      expect([...f.spawned].sort()).toEqual(["planner", "support"]);

      await releaseLock(f.home.root, "alpha", f.spawned[1]!);
      // Both subscribers hold marks: the next tick's sweep retires the event
      // (bare key written, per-role marks pruned) and neither role re-fires.
      const third = await f.tick();
      expect(f.spawned).toHaveLength(2);
      expect(third.skipped.join("\n")).toContain("(sf.json) retired");
      const consumed = await f.store.readConsumed();
      expect(consumed).toContain("sf.json");
      expect(consumed.filter((key) => key.includes("::role::"))).toEqual([]);
    } finally {
      f.home.cleanup();
    }
  });

  it("a channel-gated co-subscriber is not starved by an earlier spawn", async () => {
    const f = fanoutHome({ withChannels: false });
    try {
      const first = await f.tick();
      // Planner (not gated) spawns; Support is channel-gated with a reason.
      expect(f.spawned).toEqual(["planner"]);
      expect(first.skipped.join("\n")).toContain("support channel gate");
      expect(await f.store.readConsumed()).not.toContain("sf.json");

      await releaseLock(f.home.root, "alpha", "planner");
      const second = await f.tick();
      // Planner does not re-fire; Support stays observably gated; no retire.
      expect(f.spawned).toEqual(["planner"]);
      expect(second.skipped.join("\n")).toContain("support channel gate");
      expect(await f.store.readConsumed()).not.toContain("sf.json");

      // The app grows a support channel: the waiting event now reaches Support.
      writeFileSync(f.appsPath, appsYaml(true), "utf8");
      await f.tick();
      expect(f.spawned).toEqual(["planner", "support"]);
      await releaseLock(f.home.root, "alpha", "support");
      await f.tick(); // sweep retires once both marks exist
      expect(await f.store.readConsumed()).toContain("sf.json");
    } finally {
      f.home.cleanup();
    }
  });

  it("a subscriber removed mid-fan-out cannot strand the event live forever", async () => {
    const f = fanoutHome({ withChannels: true, maxConcurrent: 1 });
    try {
      await f.tick();
      expect(f.spawned).toHaveLength(1);
      await releaseLock(f.home.root, "alpha", f.spawned[0]!);

      // The OTHER subscriber is removed from roles.yaml before it ever runs.
      writeFileSync(f.rolesPath, `roles:\n${roleYaml(f.spawned[0]!, "support-feedback")}`, "utf8");

      // Dry-run computes retirement but must not write state.
      await f.tick({ dryRun: true });
      expect(await f.store.readConsumed()).not.toContain("sf.json");

      // The real tick's sweep sees every CURRENT subscriber consumed → retire.
      const swept = await f.tick();
      expect(f.spawned).toHaveLength(1); // no re-fire
      expect(swept.skipped.join("\n")).toContain("(sf.json) retired");
      expect(await f.store.readConsumed()).toContain("sf.json");
    } finally {
      f.home.cleanup();
    }
  });

  it("a single-subscriber event retires on the tick after its spawn", async () => {
    const f = fanoutHome({
      withChannels: true,
      inbox: { "ha.json": HEALTH_ALERT },
      rolesYaml: `roles:\n${roleYaml("sre", "health-alert")}`,
    });
    try {
      await f.tick();
      expect(f.spawned).toEqual(["sre"]);
      await releaseLock(f.home.root, "alpha", "sre");
      await f.tick();
      expect(f.spawned).toEqual(["sre"]); // no re-fire
      expect(await f.store.readConsumed()).toContain("ha.json");
    } finally {
      f.home.cleanup();
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
