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

  it("CLI surfaces the latest durable EpisodePlan revision refusal reason", async () => {
    const episodeId = "ticket:alpha:#7";
    const home = makeOrgHome({
      runs: true,
      efficiency: { episodes: { [episodeId]: {} } },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      writeFileSync(
        join(home.paths.efficiencyEpisodeDir(episodeId), "replan-journal.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          episodeId,
          maxRevisions: 2,
          records: [{
            trigger: {
              id: "execution-refusal",
              kind: "failed_gate",
              planVersion: 1,
              detectedAt: "2026-07-19T20:12:00.000Z",
              summary: "quality gates failed",
              evidenceRefs: ["plan-execution:gate"],
              affectedStepIds: ["gates"],
            },
            triggerSha256: "a".repeat(64),
            status: "rejected",
            requestedAt: "2026-07-19T20:12:00.000Z",
            resolvedAt: "2026-07-19T20:12:01.000Z",
            revisionVersion: null,
            reason: "revision proposal rejected: delivery budget has no remaining provider turn",
          }],
          createdAt: "2026-07-19T20:12:00.000Z",
          updatedAt: "2026-07-19T20:12:01.000Z",
        }, null, 2)}\n`,
        "utf8",
      );

      expect(await cmdStatus(["--home", home.root, "--app", "alpha"])).toBe(0);
      const text = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(text).toContain("EPISODE REPLANS");
      expect(text).toContain("alpha ticket:alpha:#7 rejected failed_gate revision=-");
      expect(text).toContain(
        "reason=revision proposal rejected: delivery budget has no remaining provider turn",
      );
    } finally {
      log.mockRestore();
      home.cleanup();
    }
  });
  // ENH-010: the reviewer's durable verdict is the most expensive judgment the
  // org buys. "approve, no findings" is indistinguishable from a reviewer that
  // did nothing unless its rationale and evidence reach the default surface.
  it("surfaces a structured review verdict's rationale and scope, not just its label", async () => {
    const verdict = JSON.stringify({
      verdict: "approve",
      findings: [],
      review: {
        rationale: "Verified the delivered revision 03e6e75 against AC1-AC5.",
        evidence: [
          { claim: "AC3 non-vacuous test_command", evidence: "mutating the built HTML makes it throw" },
          { claim: "full suite", evidence: "7 passed, 0 failed (exit 0)" },
        ],
        notReviewed: ["/blog", "deploy"],
      },
    });
    const home = makeOrgHome({
      runs: {
        records: {
          alpha: {
            verify: {
              envelope: {
                ...(env("verify", "2026-07-21T04:44:00Z", "completed") as Record<string, unknown>),
                role: "reviewer",
                pass: "verify",
                verdict_summary: verdict,
              },
              events: [],
            },
          },
        },
      },
    });
    try {
      const rows = await readStatusRows(home.root, { app: "alpha" });
      expect(rows[0]?.verdictDigest).toMatchObject({
        kind: "review",
        headline: "review approve — 0 finding(s), 2 evidence item(s), 2 area(s) not reviewed",
        rationale: "Verified the delivered revision 03e6e75 against AC1-AC5.",
        notReviewed: ["/blog", "deploy"],
      });
      // The raw durable record is untouched and still authoritative.
      expect(rows[0]?.verdictSummary).toBe(verdict);

      const text = formatStatusRows(rows);
      expect(text).toContain("VERDICTS");
      expect(text).toContain("build/verify (reviewer) — review approve — 0 finding(s)");
      expect(text).toContain("rationale: Verified the delivered revision 03e6e75 against AC1-AC5.");
      expect(text).toContain("AC3 non-vacuous test_command => mutating the built HTML makes it throw");
      expect(text).toContain("not reviewed: /blog; deploy");
      // An approving pass is not terminal, so it must not be reported as one.
      expect(text).not.toContain("TERMINAL ATTENTION");
    } finally {
      home.cleanup();
    }
  });

  it("leaves a prose verdict and a non-verdict envelope entirely alone", async () => {
    // Adversarial near-miss: the digest is a projection of a STRUCTURED verdict.
    // Prose verdicts and arbitrary JSON must not be reshaped or invented.
    const home = makeOrgHome({
      runs: {
        records: {
          alpha: {
            prose: {
              envelope: {
                ...(env("prose", "2026-07-21T04:00:00Z", "completed") as Record<string, unknown>),
                verdict_summary: "Verdict: done",
              },
              events: [],
            },
            other: {
              envelope: {
                ...(env("other", "2026-07-21T03:00:00Z", "completed") as Record<string, unknown>),
                verdict_summary: JSON.stringify({ candidates: [] }),
              },
              events: [],
            },
            none: { envelope: env("none", "2026-07-21T02:00:00Z", "completed"), events: [] },
          },
        },
      },
    });
    try {
      const rows = await readStatusRows(home.root, { app: "alpha" });
      for (const row of rows) expect(row.verdictDigest).toBeUndefined();
      expect(formatStatusRows(rows)).not.toContain("VERDICTS");
    } finally {
      home.cleanup();
    }
  });
});
