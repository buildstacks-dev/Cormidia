// CF-INV-011 — observe snapshot/SSE carries no verbatim L3 and no secret:
// L1 projection guardrail (HB-016, FLOOR — non-discretionary).
//
// OPERON-INV-011 adversarial seed (d) (validation-design/invariants.md):
// "SSE stream carrying L3 content"; journey J-15
// (contracts/journey-acceptance.md): "Given any snapshot/SSE/export, then no
// L3 content and no secret-pattern match crosses the boundary."
//
// The guard under test is the REAL `projectObserveSnapshot`
// (src/observe/project.ts) — the pure projection whose output is exactly
// what the snapshot route serves and the SSE stream replays (B-12: the
// projection is the single orderer/source; the server adds no fields). So a
// clean projection here IS the cheapest falsifying layer for the snapshot
// and SSE cells; the live loopback server belongs to B-12's own family.
//
// Seeds are planted in every free-text input field whose content originates
// in L3/model/tool text: pass previews, verdict summary, terminal reason,
// gate detail, session transcript note, run-event detail, parent-task
// objective and completion criteria, approval reason and execution result,
// and the GitHub issue title.
//
// Layer: 1 (pure function over constructed input, zero I/O, zero tokens).

import { describe, expect, it } from "vitest";
import { projectObserveSnapshot } from "../../../src/observe/project.js";
import type { ObserveProjectionInput } from "../../../src/observe/types.js";
import type { StatusRow } from "../../../src/runtime/runlog/status.js";
import type { RunlogEvent } from "../../../src/runtime/runlog/events.js";
import type { ParentTaskRecord } from "../../../src/org/parent-task.js";
import type { ApprovalItem } from "../../../src/org/approvals.js";
import type { SyntheticSecret } from "../../fixtures/synthetic-secret.js";
import {
  detectSecretEgressInJson,
  makeAllSeeds,
  SecretEgressViolation,
} from "./secret-egress-detector.js";

const NOW = new Date("2026-07-31T12:00:00.000Z");
const APP = "cf-inv-011-app";
const RUN_ID = "20260731-115900-build-implement";
/** A unique sentinel proving full L3 text never crosses (only a bounded,
 *  scrubbed preview may). */
const L3_TAIL_MARKER = "L3-TAIL-MARKER-cf-inv-011-must-never-cross";

function seededInput(seeds: readonly SyntheticSecret[]): ObserveProjectionInput {
  const [aws, ghToken, sk, slack, npm, jwt, pem, generic] = seeds;
  if (!aws || !ghToken || !sk || !slack || !npm || !jwt || !pem || !generic) {
    throw new Error("expected all 8 synthetic seed kinds");
  }
  // A long L3 excerpt: secret up front, unique marker beyond the 240-char
  // preview bound — the projection must scrub the one and truncate the other.
  const longL3Excerpt = `session output begins ${jwt.value} ${"lorem ipsum ".repeat(40)}${L3_TAIL_MARKER}`;

  const row: StatusRow = {
    runId: RUN_ID,
    app: APP,
    ticket: "#12",
    traceId: "trace-cf-inv-011",
    pipeline: "build",
    pass: "implement",
    role: "builder",
    runtime: "claude",
    model: "claude-scripted-model",
    status: "completed",
    durationMs: 60_000,
    tokensIn: 1000,
    tokensOut: 200,
    costUsd: 0.5,
    costEstimated: false,
    usageQuality: "complete",
    escalations: 0,
    toolCalls: 1,
    startedAt: "2026-07-31T11:59:00.000Z",
    verdictSummary: `verdict prose citing ${ghToken.value} from the diff`,
    terminalReason: `stopped after ${aws.value} appeared in stderr`,
    previews: {
      output: longL3Excerpt,
      brief: `brief mentions ${sk.value} inline`,
      prompt: `prompt carries ${pem.value}`,
    },
    gateResults: [
      { gate: "security-scan", status: "failed", detail: `matched ${slack.value} in worktree` },
    ],
    session: {
      runtime: "claude",
      id: "session-1",
      transcript: "provider_session",
      transcript_note: `resume ref leaked ${npm.value}`,
    },
    refs: { events: "events.jsonl", brief: "brief.md", prompt: "prompt.md", output: "output.md" },
  };

  const event: RunlogEvent = {
    trace_id: "trace-cf-inv-011",
    span_id: "span-1",
    app: APP,
    pipeline: "build",
    pass: "implement",
    role: "builder",
    ts: "2026-07-31T11:59:30.000Z",
    event: "gate.failed",
    severity: "error",
    detail: { gate: "security-scan", stderr: `gate stderr with ${generic.value}` },
  };

  const task: ParentTaskRecord = {
    schemaVersion: 1,
    taskId: "task-cf-inv-011",
    app: APP,
    objective: `ship the connector configured via ${generic.value}`,
    completionCriteria: `works with ${sk.value} rotated`,
    promptRef: "prompt.md",
    promptSha256: "0".repeat(64),
    requiredStages: ["build"],
    executionMode: "operon",
    fallbackEvents: [],
    status: "running",
    startedAt: "2026-07-31T11:58:00.000Z",
    refs: { tickets: [], traces: [], branches: [], prs: [], reviews: [], deployments: [] },
  };

  const approval: ApprovalItem = {
    id: "appr-cf-inv-011",
    app: APP,
    role: "sre",
    rule: "deploy",
    action: { tool: "Bash", input: { command: "deploy" }, description: "deploy" },
    raisedAt: "2026-07-31T11:57:00.000Z",
    status: "approved",
    decidedAt: "2026-07-31T11:58:00.000Z",
    reason: `approved despite ${slack.value} in the log`,
    execution: {
      state: "failed",
      executor: "orchestrator-command",
      idempotencyKey: "idem-1",
      attempts: 1,
      result: `stderr tail: ${aws.value}`,
      nextAction: "none",
    },
  };

  return {
    now: NOW,
    cursor: "0",
    filters: {},
    org_name: "cf-inv-011-org",
    state_home: "/tmp/synthetic-state-home",
    max_concurrent_turns: 2,
    apps: [
      {
        name: APP,
        repo: "operon-double/sandbox-observe",
        status: "live",
        budgetUsdMonth: 100,
        cadence: {},
      },
    ],
    passes: [{ row, events: [event], artifacts: {} }],
    corrupt_runs: [],
    parent_tasks: [task],
    parent_task_prompts: { "task-cf-inv-011": true },
    corrupt_tasks: [],
    approvals: [{ item: approval }],
    ledger: [],
    invocations: [],
    schedule: {},
    locks: [],
    inbox: [],
    github: [
      {
        app: APP,
        repo: "operon-double/sandbox-observe",
        issues: [
          {
            number: 12,
            title: `Rotate ${ghToken.value} before launch`,
            body: "Depends-on: #11",
            labels: ["op:ready"],
            state: "OPEN",
          },
        ],
        pull_requests: [],
        observed_at: "2026-07-31T11:59:50.000Z",
      },
    ],
    source_health: [],
  };
}

describe("CF-INV-011 — observe snapshot/SSE projection carries no secret and no verbatim L3 (L1, HB-016)", () => {
  it("the full snapshot JSON is clean of every seeded kind and of any canonical-pattern match", () => {
    const seeds = makeAllSeeds();
    const snapshot = projectObserveSnapshot(seededInput(seeds));
    const json = JSON.stringify(snapshot);

    // JSON-aware scan: every string key and value independently, so schema
    // vocabulary ("state_token") cannot mask — or be mistaken for — a leak.
    detectSecretEgressInJson("observe snapshot JSON", json, seeds);
    // Non-vacuous: the seeded fields actually flowed through the scrub (the
    // named markers are present), rather than being dropped wholesale.
    expect(json).toContain("[REDACTED:jwt]");
    expect(json).toContain("[REDACTED:github-token]");
    expect(json).toContain("[REDACTED:aws-access-key-id]");
    expect(json).toContain("[REDACTED:generic-assignment]");
  });

  it("L3 excerpts stay bounded previews: long output text is truncated below the L3 tail and scrubbed", () => {
    const seeds = makeAllSeeds();
    const snapshot = projectObserveSnapshot(seededInput(seeds));
    const pass = snapshot.passes.find((p) => p.run_id === RUN_ID);
    expect(pass).toBeDefined();

    const output = pass!.previews["output"];
    expect(output).toBeDefined();
    // Bounded (projection preview cap is 240 chars including the ellipsis)
    // and scrubbed — never the whole L3 body.
    expect(output!.length).toBeLessThanOrEqual(240);
    expect(output).toContain("[REDACTED:jwt]");
    expect(JSON.stringify(snapshot)).not.toContain(L3_TAIL_MARKER);
  });

  it("scrub coverage reaches every seeded projection field (verdict, reason, gate detail, session note, task, approval, issue title)", () => {
    const seeds = makeAllSeeds();
    const snapshot = projectObserveSnapshot(seededInput(seeds));
    const pass = snapshot.passes.find((p) => p.run_id === RUN_ID);
    expect(pass?.verdict_summary).toContain("[REDACTED:github-token]");
    expect(pass?.terminal_reason).toContain("[REDACTED:aws-access-key-id]");
    expect(pass?.gates[0]?.detail).toContain("[REDACTED:slack-token]");
    expect(pass?.session?.transcript_note).toContain("[REDACTED:npm-token]");
    const task = snapshot.parent_tasks.find((t) => t.task_id === "task-cf-inv-011");
    expect(task?.objective).toContain("[REDACTED:generic-assignment]");
    const approval = snapshot.approvals.find((a) => a.approval_id === "appr-cf-inv-011");
    expect(approval?.reason).toContain("[REDACTED:slack-token]");
    expect(approval?.execution_result).toContain("[REDACTED:aws-access-key-id]");
  });

  it("negative control: the same seeded input serialized WITHOUT the projection (bypassing the guardrail) makes the detector FIRE", () => {
    const seeds = makeAllSeeds();
    const bypassed = JSON.stringify(seededInput(seeds));
    expect(() => detectSecretEgressInJson("unprojected input", bypassed, seeds)).toThrow(
      SecretEgressViolation,
    );
  });
});
