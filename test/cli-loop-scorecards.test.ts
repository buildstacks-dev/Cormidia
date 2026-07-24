// Tests loop scorecard persistence used by the manual loop CLI path.
// Covers writing builder review-cycle rows, replay dedupe by turn id, and
// no-op behavior when the loop returns no events.
// makeOrgHome is only a disposable scorecard filesystem; no network, auth,
// real org state, or wall-clock time is required.

import { describe, expect, it } from "vitest";
import {
  createLoopGateForRole,
  loopDriverExitCode,
  loopInvocationOutcome,
  persistLoopScorecards,
} from "../src/cli/loop.js";
import type { LoopDriverResult } from "../src/loop/driver.js";
import { ApprovalStore } from "../src/org/approvals.js";
import { readScorecards } from "../src/org/scorecards.js";
import type { ScorecardEvent as LoopScorecardEvent } from "../src/loop/types.js";
import type { RoleConfig } from "../src/runtime/types.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

describe("manual loop terminal-refusal projection", () => {
  it("returns exit 1 and records a distinct invocation outcome", () => {
    const result: LoopDriverResult = {
      lines: ["ERROR #1 terminal episode"],
      items: [],
      scorecardEvents: [],
      terminalEpisodeRefusals: [{
        issueNumber: 1,
        episodeId: "ticket:alpha:#1",
        status: "interrupted",
        reason: "#1 returned for human triage",
      }],
    };

    expect(loopDriverExitCode(result)).toBe(1);
    expect(loopInvocationOutcome(result)).toBe(
      "terminal-episode-refused: #1=ticket:alpha:#1 " +
        "(interrupted: #1 returned for human triage); repaired to op:returned",
    );
    const idle: LoopDriverResult = { lines: [], items: [], scorecardEvents: [] };
    expect(loopDriverExitCode(idle)).toBe(0);
    expect(loopInvocationOutcome(idle)).toBe("no-ready-tickets");
  });

  it("reports dry-run ready selection as would-claim, distinct from an empty queue", () => {
    const ready: LoopDriverResult = {
      lines: ["#1 Ready: ready -> claim"],
      items: [],
      scorecardEvents: [],
      itemsPreviewed: 1,
    };
    const empty: LoopDriverResult = {
      lines: [],
      items: [],
      scorecardEvents: [],
      itemsPreviewed: 0,
    };
    expect(loopInvocationOutcome(ready, true)).toBe("would-claim: 1");
    expect(loopInvocationOutcome(empty, true)).toBe("no-ready-tickets");
  });

  it("keeps a durable plan-revision refusal reason on the ordinary loop outcome", () => {
    const result: LoopDriverResult = {
      lines: [],
      scorecardEvents: [],
      items: [{
        issueNumber: 7,
        ticketRef: "#7",
        title: "Fix the parser",
        body: "## Acceptance Criteria\n- [ ] parser works",
        targetRepo: "fixture/repo",
        labels: ["op:returned"],
        phase: "returned",
        tier: "standard",
        cycles: 0,
        remediationAttempts: 0,
        gateResults: [],
        findings: [],
        episodeReplan: {
          kind: "failed_gate",
          status: "rejected",
          revisionVersion: null,
          reason: "revision proposal rejected: delivery budget has no remaining provider turn",
        },
      }],
    };

    expect(loopInvocationOutcome(result)).toBe(
      "#7=returned [replan rejected: failed_gate — " +
        "revision proposal rejected: delivery budget has no remaining provider turn]",
    );
  });
});

// Regression: `operon loop` used to drop every scorecard event the driver
// returned, so `operon retro` was blind to the real build loop. Persisting them
// (mirroring the autonomous dispatch path) is what makes retro see loop passes.
describe("persistLoopScorecards", () => {
  it("writes builder-attributed review_cycles rows readable by readScorecards", async () => {
    const home = makeOrgHome();
    try {
      const events: LoopScorecardEvent[] = [
        { type: "review_cycles", turnId: "loop-delta-1", ticketRef: "#7", value: 0 },
        { type: "review_cycles", turnId: "loop-delta-1", ticketRef: "#8", value: 1 },
      ];

      const appended = await persistLoopScorecards(
        home.root,
        "operon-sandbox-delta",
        events,
        new Date("2026-07-06T12:00:00Z"),
      );
      expect(appended).toBe(2);

      const rows = await readScorecards(home.root, "operon-sandbox-delta", "builder");
      expect(rows.map((row) => ({ type: row.type, ticketRef: row.ticketRef, value: row.value }))).toEqual([
        { type: "review_cycles", ticketRef: "#7", value: 0 },
        { type: "review_cycles", ticketRef: "#8", value: 1 },
      ]);
    } finally {
      home.cleanup();
    }
  });

  it("dedupes a replayed tick and returns zero new rows", async () => {
    const home = makeOrgHome();
    try {
      const events: LoopScorecardEvent[] = [
        { type: "review_cycles", turnId: "loop-delta-1", ticketRef: "#7", value: 0 },
      ];
      const first = await persistLoopScorecards(home.root, "operon-sandbox-delta", events);
      const second = await persistLoopScorecards(home.root, "operon-sandbox-delta", events);
      expect(first).toBe(1);
      expect(second).toBe(0);
      expect(await readScorecards(home.root, "operon-sandbox-delta", "builder")).toHaveLength(1);
    } finally {
      home.cleanup();
    }
  });

  it("no events is a no-op", async () => {
    const home = makeOrgHome();
    try {
      expect(await persistLoopScorecards(home.root, "operon-sandbox-delta", [])).toBe(0);
    } finally {
      home.cleanup();
    }
  });
});

describe("createLoopGateForRole", () => {
  it("raises a durable, role-attributed approval for a manual-loop critical action", async () => {
    const home = makeOrgHome();
    const builder: RoleConfig = {
      name: "builder",
      runtime: "codex",
      model: "gpt-5.5",
      effort: "high",
      delegation: { allow: [] },
      triggers: [],
      outputs: ["pr"],
      maxTurnBudgetUsd: 30,
    };
    try {
      const gate = createLoopGateForRole(home.root, "buildstacks.dev", "loop-turn-2")(builder);
      const decision = gate({ tool: "bash", input: { command: "cat .env" } });
      expect(decision).toMatchObject({ allow: false, escalate: true });

      const pending = await new ApprovalStore(home.root).listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        app: "buildstacks.dev",
        role: "builder",
        turnId: "loop-turn-2",
        rule: "secrets-or-auth",
        status: "pending",
      });
    } finally {
      home.cleanup();
    }
  });
});
