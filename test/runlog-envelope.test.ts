// Tests the L1 run envelope lifecycle in src/runtime/runlog/envelope.ts.
// Covers start/update/finalize/read behavior, usage merging, preview redaction,
// L3 references, terminal-state protection, and invalid-envelope rejection.
// Uses temp runlog directories with explicit clocks; no network, auth, real org
// state, or live wall clock is required.

import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  finalizeRun,
  readEnvelope,
  startRun,
  updateEnvelope,
} from "../src/runtime/runlog/envelope.js";
import { runPaths } from "../src/runtime/runlog/paths.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

const T0 = new Date(Date.UTC(2026, 6, 5, 9, 30, 15));
const RUN_ID = "20260705-093015-build-implement";

const META = {
  runId: RUN_ID,
  traceId: "turn-8k2f",
  app: "civic",
  ticket: "#42",
  pipeline: "build",
  pass: "implement",
  role: "builder",
  runtime: "codex" as const,
  model: "gpt-5.5",
  effort: "high" as const,
  workdir: "/tmp/civic",
  gitBranch: "op/42",
};

function withHome<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const fixture = makeOrgHome({ runs: { apps: ["civic"] } });
  return fn(fixture.root).finally(() => fixture.cleanup());
}

describe("envelope lifecycle", () => {
  it("startRun writes a running envelope with ids and L3 references", () =>
    withHome(async (root) => {
      await startRun(root, META, T0);
      const env = await readEnvelope(root, "civic", RUN_ID);

      expect(env.status).toBe("running");
      expect(env.run_id).toBe(RUN_ID);
      expect(env.trace_id).toBe("turn-8k2f");
      expect(env.pipeline).toBe("build");
      expect(env.pass).toBe("implement");
      expect(env).toMatchObject({
        runtime: "codex",
        model: "gpt-5.5",
        effort: "high",
        workdir: "/tmp/civic",
        git_branch: "op/42",
      });
      expect("plan_version" in env).toBe(false);
      expect("plan_step_id" in env).toBe(false);
      expect("assignment_source" in env).toBe(false);
      expect("assignment_candidate_id" in env).toBe(false);
      expect("selection_reason" in env).toBe(false);
      expect("resolved_capabilities" in env).toBe(false);
      expect(env.started_at).toBe(T0.toISOString());
      expect(env.refs).toEqual({
        events: "events.jsonl",
        brief: "brief.md",
        prompt: "prompt.md",
        output: "output.md",
        session_log: "session.log",
      });
    }));

  it("startRun persists plan and atomic assignment evidence", () =>
    withHome(async (root) => {
      const capabilities = ["workspace_write", "structured_output"];
      await startRun(
        root,
        {
          ...META,
          episodeId: "episode-7",
          planVersion: 3,
          planStepId: "implement",
          assignmentSource: "episode_planner",
          assignmentCandidateId: "builder-codex-sol",
          selectionReason: `Strong code reasoning; ignore sk-${"a1".repeat(20)}.`,
          resolvedCapabilities: capabilities,
        },
        T0,
      );
      capabilities.push("caller_mutation");

      const env = await readEnvelope(root, "civic", RUN_ID);
      expect(env).toMatchObject({
        episode_id: "episode-7",
        plan_version: 3,
        plan_step_id: "implement",
        assignment_source: "episode_planner",
        assignment_candidate_id: "builder-codex-sol",
        resolved_capabilities: ["workspace_write", "structured_output"],
      });
      expect(env.selection_reason).toContain("[REDACTED:sk-api-key]");
      expect(env.selection_reason).not.toContain("sk-a1a1");
    }));

  it("heartbeat patches stamp last_seen_at without touching anything else", () =>
    withHome(async (root) => {
      await startRun(root, META, T0);
      await updateEnvelope(root, "civic", RUN_ID, { lastSeenAt: "2026-07-05T09:31:00.000Z" });

      const env = await readEnvelope(root, "civic", RUN_ID);
      expect(env.last_seen_at).toBe("2026-07-05T09:31:00.000Z");
      expect(env.status).toBe("running");
    }));

  it("finalize drops the session_log ref when the sink never wrote the file", () =>
    withHome(async (root) => {
      await startRun(root, META, T0);
      await finalizeRun(root, "civic", RUN_ID, { status: "completed" }, T0);

      const env = await readEnvelope(root, "civic", RUN_ID);
      // A ref is a promise (telemetry doc Defect C): a terminal envelope must
      // never reference a file that does not exist.
      expect(env.refs).toEqual({
        events: "events.jsonl",
        brief: "brief.md",
        prompt: "prompt.md",
        output: "output.md",
      });
      expect(JSON.stringify(env)).not.toContain("session_log");
    }));

  it("finalize keeps the session_log ref when the file exists", () =>
    withHome(async (root) => {
      await startRun(root, META, T0);
      writeFileSync(runPaths(root, "civic", RUN_ID).sessionLog, "[tool_use] bash\n", "utf8");
      await finalizeRun(root, "civic", RUN_ID, { status: "completed" }, T0);

      const env = await readEnvelope(root, "civic", RUN_ID);
      expect(env.refs.session_log).toBe("session.log");
    }));

  it("update merges without clobbering earlier patches", () =>
    withHome(async (root) => {
      await startRun(root, META, T0);
      await updateEnvelope(root, "civic", RUN_ID, {
        usage: { tokens_in: 100, tokens_out: 40, cost_usd: 0.02, cache_read_tokens: 10, cache_write_tokens: 5 },
        tool_counts: { bash: 2 },
      });
      await updateEnvelope(root, "civic", RUN_ID, {
        gate_results: [{ gate: "tests", status: "passed" }],
        tool_counts: { bash: 5, read: 3 },
      });

      const env = await readEnvelope(root, "civic", RUN_ID);
      expect(env.usage).toEqual({
        tokens_in: 100,
        tokens_out: 40,
        cost_usd: 0.02,
        cache_read_tokens: 10,
        cache_write_tokens: 5,
      });
      expect(env.gate_results).toEqual([{ gate: "tests", status: "passed" }]);
      expect(env.tool_counts).toEqual({ bash: 5, read: 3 });
      expect(env.status).toBe("running");
      expect(env.started_at).toBe(T0.toISOString()); // untouched
    }));

  it("checkpoints provider session evidence and redacted artifacts", () =>
    withHome(async (root) => {
      await startRun(root, META, T0);
      await updateEnvelope(root, "civic", RUN_ID, {
        session: {
          runtime: "codex",
          id: "thread-123",
          native_ref: "codex://threads/thread-123",
          transcript: "native_task",
          transcript_note: "Open the native task.",
        },
        artifacts: [
          {
            kind: "note",
            ref: `key-sk-${"a1".repeat(20)}`,
            summary: `secret sk-${"b2".repeat(20)}`,
          },
        ],
      });

      const env = await readEnvelope(root, "civic", RUN_ID);
      expect(env.session).toMatchObject({ id: "thread-123", transcript: "native_task" });
      expect(env.artifacts?.[0]?.ref).toContain("[REDACTED:sk-api-key]");
      expect(env.artifacts?.[0]?.summary).toContain("[REDACTED:sk-api-key]");
    }));

  it("previews are truncated (~120) and scrubbed via redact", () =>
    withHome(async (root) => {
      await startRun(root, META, T0);
      await updateEnvelope(root, "civic", RUN_ID, {
        previews: {
          task: "line one\nline two " + "x".repeat(300),
          output: `key sk-${"a1".repeat(20)} leaked`,
        },
      });

      const env = await readEnvelope(root, "civic", RUN_ID);
      expect(env.previews?.task?.length).toBe(120);
      expect(env.previews?.task).toContain("line one line two"); // newlines collapsed
      expect(env.previews?.task?.endsWith("…")).toBe(true);
      expect(env.previews?.output).toContain("[REDACTED:sk-api-key]");
      expect(env.previews?.output).not.toContain("sk-a1a1");
    }));

  it("finalize sets terminal status + timings, references L3 and never inlines content", () =>
    withHome(async (root) => {
      await startRun(root, META, T0);
      // A real brief exists on disk — its content must never enter L1.
      const briefContent = "[ticket]\nUNIQUE-BRIEF-MARKER do not inline\n";
      writeFileSync(runPaths(root, "civic", RUN_ID).brief, briefContent);
      writeFileSync(runPaths(root, "civic", RUN_ID).sessionLog, "SESSION-MARKER\n");

      const t1 = new Date(T0.getTime() + 90_000);
      await finalizeRun(
        root,
        "civic",
        RUN_ID,
        { status: "completed", verdictSummary: "done — all criteria green\nsecond line" },
        t1,
      );

      const env = await readEnvelope(root, "civic", RUN_ID);
      expect(env.status).toBe("completed");
      expect(env.finished_at).toBe(t1.toISOString());
      expect(env.wall_clock_ms).toBe(90_000);
      expect(env.verdict_summary).toBe("done — all criteria green second line");

      const raw = readFileSync(runPaths(root, "civic", RUN_ID).envelope, "utf8");
      expect(raw).toContain('"brief": "brief.md"'); // reference…
      expect(raw).not.toContain("UNIQUE-BRIEF-MARKER"); // …never content
      expect(raw).not.toContain("SESSION-MARKER");
    }));

  it("infra failure carries error_code; update after finalize throws", () =>
    withHome(async (root) => {
      await startRun(root, META, T0);
      await finalizeRun(
        root,
        "civic",
        RUN_ID,
        { status: "failed", errorCode: "error_max_budget_usd" },
        new Date(T0.getTime() + 1000),
      );

      const env = await readEnvelope(root, "civic", RUN_ID);
      expect(env.status).toBe("failed");
      expect(env.error_code).toBe("error_max_budget_usd");

      await expect(
        updateEnvelope(root, "civic", RUN_ID, { tool_counts: { bash: 1 } }),
      ).rejects.toThrow(/already failed/);
      await expect(
        finalizeRun(root, "civic", RUN_ID, { status: "completed" }, T0),
      ).rejects.toThrow(/double finalize/);
    }));

  it("readEnvelope round-trips typed fields and rejects non-envelopes", () =>
    withHome(async (root) => {
      const written = await startRun(root, META, T0);
      const read = await readEnvelope(root, "civic", RUN_ID);
      expect(read).toEqual(written);

      writeFileSync(runPaths(root, "civic", RUN_ID).envelope, '{"not": "an envelope"}');
      await expect(readEnvelope(root, "civic", RUN_ID)).rejects.toThrow(/not a valid v1 envelope/);
    }));
});
