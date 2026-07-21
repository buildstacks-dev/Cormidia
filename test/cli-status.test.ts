// Tests runlog status reading/formatting and the status CLI wrapper.
// Covers newest-first ordering, limit handling, corrupt envelope surfacing,
// in-progress run skipping, estimated-cost display, and documented columns.
// Uses makeOrgHome to seed local run records; no network, auth, real org state,
// or live clock is required.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cmdStatus } from "../src/cli/status.js";
import { githubIssueCreateAction } from "../src/org/approval-delivery.js";
import { ApprovalStore } from "../src/org/approvals.js";
import { formatStatusRows, readStatusRows } from "../src/runtime/runlog/status.js";
import { makeOrgHome } from "./fixtures/orgHome.js";
import { writeTicketClaimState } from "../src/loop/rehydrate.js";

function env(runId: string, started: string, status: string, errorCode?: string): unknown {
  return {
    schema_version: 1,
    run_id: runId,
    trace_id: "turn",
    app: "alpha",
    pipeline: "build",
    pass: runId.includes("2") ? "review" : "implement",
    role: "builder",
    status,
    started_at: started,
    finished_at: started,
    wall_clock_ms: 1200,
    usage: { tokens_in: 10, tokens_out: 5, cost_usd: 0.02 },
    ...(errorCode !== undefined ? { error_code: errorCode } : {}),
    refs: { events: "events.jsonl", brief: "brief.md", output: "output.md", session_log: "session.log" },
  };
}

describe("runlog status", () => {
  it("reads newest-first, keeps infra failure distinct, and applies limit", async () => {
    const home = makeOrgHome({
      runs: {
        records: {
          alpha: {
            run1: { envelope: env("run1", "2026-07-04T10:00:00Z", "completed"), events: [] },
            run2: {
              envelope: env("run2", "2026-07-04T11:00:00Z", "failed", "error_turn_failed"),
              events: [{ event: "escalation.raised" }],
            },
          },
        },
      },
    });
    try {
      const rows = await readStatusRows(home.root, { app: "alpha", limit: 1 });
      expect(rows.map((row) => row.runId)).toEqual(["run2"]);
      expect(rows[0]?.status).toBe("failed(error_turn_failed)");
      expect(rows[0]?.escalations).toBe(1);
      expect(formatStatusRows(rows)).toContain("PIPE/PASS");
    } finally {
      home.cleanup();
    }
  });

  it("puts a terminal diagnostic directly below the status table", async () => {
    const blocked = env("run1", "2026-07-04T10:00:00Z", "blocked") as Record<string, unknown>;
    blocked["terminal_reason"] = "The implementation is blocked: duplicated mapping key in roles.yaml";
    const home = makeOrgHome({
      runs: {
        records: {
          alpha: { run1: { envelope: blocked, events: [] } },
        },
      },
    });
    try {
      const text = formatStatusRows(await readStatusRows(home.root));
      expect(text).toContain("TERMINAL ATTENTION");
      expect(text).toContain(
        "run1 build/implement blocked — The implementation is blocked: duplicated mapping key in roles.yaml",
      );
    } finally {
      home.cleanup();
    }
  });

  it("surfaces a corrupt envelope as a visible row but skips an in-progress run", async () => {
    const home = makeOrgHome({
      runs: {
        records: {
          alpha: { good1: { envelope: env("good1", "2026-07-04T10:00:00Z", "completed"), events: [] } },
        },
      },
    });
    try {
      // A crashed turn left a torn envelope.json.
      const corruptDir = home.paths.runDir("alpha", "corrupt2");
      mkdirSync(corruptDir, { recursive: true });
      writeFileSync(join(corruptDir, "envelope.json"), '{"run_id":"corrupt2", tr', "utf8");
      // A turn still in flight has a run dir but no envelope yet.
      mkdirSync(home.paths.runDir("alpha", "inflight3"), { recursive: true });

      const rows = await readStatusRows(home.root, { app: "alpha" });
      const byId = new Map(rows.map((row) => [row.runId, row]));

      // The good run is present, the corrupt run is SURFACED (not dropped),
      // and the in-progress run is quietly skipped.
      expect(byId.has("good1")).toBe(true);
      expect(byId.get("corrupt2")?.status).toBe("corrupt(envelope)");
      expect(byId.has("inflight3")).toBe(false);
    } finally {
      home.cleanup();
    }
  });

  it("marks an estimated (codex) cost with ~ and leaves a real cost unmarked", async () => {
    const estimated = env("run1", "2026-07-04T10:00:00Z", "completed") as Record<string, unknown>;
    (estimated["usage"] as Record<string, unknown>) = {
      tokens_in: 100,
      tokens_out: 5,
      cost_usd: 3.21,
      cost_estimated: true,
    };
    const home = makeOrgHome({
      runs: {
        records: {
          alpha: {
            run1: { envelope: estimated, events: [] },
            run2: { envelope: env("run2", "2026-07-04T09:00:00Z", "completed"), events: [] },
          },
        },
      },
    });
    try {
      const rows = await readStatusRows(home.root, { app: "alpha" });
      const byId = new Map(rows.map((row) => [row.runId, row]));
      expect(byId.get("run1")?.costEstimated).toBe(true);
      expect(byId.get("run2")?.costEstimated).toBe(false);
      const text = formatStatusRows(rows);
      expect(text).toContain("~$3.21");
      expect(text).toContain(" $0.02");
      expect(text).not.toContain("~$0.02");
    } finally {
      home.cleanup();
    }
  });

  it("labels partial and unavailable usage instead of presenting zero as free", async () => {
    const partial = env("run1", "2026-07-04T10:00:00Z", "cancelled") as Record<string, unknown>;
    partial["usage"] = { tokens_in: 50, tokens_out: 5, cost_usd: 0.2, quality: "partial" };
    const unavailable = env("run2", "2026-07-04T09:00:00Z", "timed_out") as Record<string, unknown>;
    unavailable["usage"] = { tokens_in: 0, tokens_out: 0, cost_usd: 0, quality: "unavailable" };
    const home = makeOrgHome({
      runs: { records: { alpha: { run1: { envelope: partial, events: [] }, run2: { envelope: unavailable, events: [] } } } },
    });
    try {
      const text = formatStatusRows(await readStatusRows(home.root));
      expect(text).toContain("$0.20 partial");
      expect(text).toContain("unavailable");
      expect(text).not.toContain("$0.00");
    } finally {
      home.cleanup();
    }
  });

  it("CLI prints documented columns", async () => {
    const home = makeOrgHome({
      runs: { records: { alpha: { run1: { envelope: env("run1", "2026-07-04T10:00:00Z", "completed"), events: [] } } } },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await cmdStatus(["--home", home.root, "--app", "alpha"]);
      expect(code).toBe(0);
      const out = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(out).toContain("RUN ID");
      expect(out).toContain("build/implement");
    } finally {
      log.mockRestore();
      home.cleanup();
    }
  });

  it("CLI surfaces durable approval execution attempts and next action", async () => {
    const home = makeOrgHome({ approvals: true, runs: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const now = new Date("2026-07-18T12:00:00Z");
      const store = new ApprovalStore(home.root, { idSource: () => "status-delivery-1" });
      const pending = await store.raise({
        app: "alpha",
        role: "sre",
        rule: "external-publishing",
        action: githubIssueCreateAction({ repo: "o/a", title: "Incident", body: "source", labels: ["op:incident"], idempotency_key: "incident:status:test" }),
        now,
      });
      await store.decide(pending.id, { decision: "approved", now });
      await store.beginExecution(pending.id, "orchestrator/dispatch", now);
      await store.finishExecution({ id: pending.id, state: "ambiguous", actor: "orchestrator/dispatch", result: "response unknown", failureCause: "ambiguous_remote_response", now });
      expect(await cmdStatus(["--home", home.root, "--app", "alpha"])).toBe(0);
      const text = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(text).toContain("APPROVAL DELIVERY");
      expect(text).toContain("status-delivery-1 alpha ambiguous attempt=1");
      expect(text).toContain("actor=orchestrator/dispatch");
      expect(text).toContain("result=response unknown cause=ambiguous_remote_response next=reconcile");
      expect(text).toContain("at=2026-07-18T12:00:00.000Z");
    } finally { log.mockRestore(); home.cleanup(); }
  });

  it("CLI explains a claim recovery stop and prints the exact next command", async () => {
    const home = makeOrgHome({ runs: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      writeTicketClaimState(home.root, "alpha", 7, {
        claims: 3,
        outcomes: [],
        claimAllowance: 3,
        events: [{
          at: "2026-07-18T12:00:00Z",
          kind: "automatic_recovery",
          claimNumber: 3,
          detail: "post-provider ambiguity; explicit re-arm required",
          repeatedCostUsd: 0,
        }],
      });
      expect(await cmdStatus(["--home", home.root, "--app", "alpha"])).toBe(0);
      const text = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(text).toContain("CLAIM RECOVERY");
      expect(text).toContain("alpha#7 automatic_recovery claims=3 allowance=3");
      expect(text).toContain("operon loop rearm --app alpha --ticket 7");
      expect(text).toContain("--from-allowance 3 --to-allowance 4");
    } finally {
      log.mockRestore();
      home.cleanup();
    }
  });
});
