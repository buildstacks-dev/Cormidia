// L2 structured events (build plan M2.6; docs/loop.md §9): correlation ids
// on every line, tool.called without raw args, subagent span nesting,
// torn-append tolerance, infra-vs-merit code separation.

import { appendFileSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createEventWriter,
  readEvents,
  reconstructSpanTree,
} from "../src/runtime/runlog/events.js";
import { runPaths } from "../src/runtime/runlog/paths.js";
import { makeOrgHome } from "./fixtures/orgHome.js";
import { FakeClock } from "./fixtures/fakeClock.js";

const RUN_ID = "20260705-093015-build-implement";
const CTX = {
  runId: RUN_ID,
  trace_id: "turn-8k2f",
  span_id: "implement",
  app: "civic",
  ticket: "#42",
  pipeline: "build",
  pass: "implement",
  role: "builder",
  model: "gpt-5.5",
};

function withHome<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const fixture = makeOrgHome({ runs: { apps: ["civic"] } });
  return fn(fixture.root).finally(() => fixture.cleanup());
}

function makeClock(): FakeClock {
  return new FakeClock(new Date(Date.UTC(2026, 6, 5, 9, 30, 15)));
}

describe("event writer", () => {
  it("one JSON line per event, correlation ids + identity on every line", () =>
    withHome(async (root) => {
      const clock = makeClock();
      const writer = createEventWriter(root, CTX, () => clock.now());
      await writer.append({ type: "pass.started" });
      clock.advance(1000);
      await writer.append({ type: "gate.passed", detail: { gate: "tests" } });

      const raw = readFileSync(runPaths(root, "civic", RUN_ID).events, "utf8");
      const lines = raw.trim().split("\n");
      expect(lines.length).toBe(2);
      for (const line of lines) {
        const event = JSON.parse(line);
        expect(event.trace_id).toBe("turn-8k2f");
        expect(event.span_id).toBe("implement");
        expect(event.app).toBe("civic");
        expect(event.ticket).toBe("#42");
        expect(event.pipeline).toBe("build");
        expect(event.role).toBe("builder");
        expect(event.model).toBe("gpt-5.5");
        expect(event.ts).toMatch(/^2026-07-05T09:30:1[56]/);
        expect(event.severity).toBe("info");
      }
    }));

  it("tool.called never contains raw args — name/duration/success + hash only", () =>
    withHome(async (root) => {
      const writer = createEventWriter(root, CTX, () => makeClock().now());
      const secretArgs = { command: "curl -H 'x-api-key: sk-" + "a1".repeat(20) + "'" };
      await writer.toolCalled({ tool: "bash", durationMs: 420, success: true, args: secretArgs });

      const raw = readFileSync(runPaths(root, "civic", RUN_ID).events, "utf8");
      expect(raw).not.toContain("curl");
      expect(raw).not.toContain("sk-a1");

      const [event] = await readEvents(root, "civic", RUN_ID);
      expect(event?.event).toBe("tool.called");
      expect(event?.detail).toEqual({
        tool: "bash",
        duration_ms: 420,
        success: true,
        args_hash: expect.stringMatching(/^[0-9a-f]{16}$/) as unknown as string,
      });
    }));

  it("string detail fields pass through the secret scrubber", () =>
    withHome(async (root) => {
      const writer = createEventWriter(root, CTX, () => makeClock().now());
      await writer.append({
        type: "gate.failed",
        severity: "error",
        detail: { gate: "security", hit: `found ghp_${"A2".repeat(18)} in diff` },
      });
      const [event] = await readEvents(root, "civic", RUN_ID);
      expect(event?.detail?.hit).toContain("[REDACTED:github-token]");
    }));

  it("span tree nests subagent spans under the parent pass", () =>
    withHome(async (root) => {
      const clock = makeClock();
      const writer = createEventWriter(root, CTX, () => clock.now());
      await writer.append({ type: "pass.started" });
      await writer.append({
        type: "subagent.started",
        spanId: "implement/sub-1",
        parentSpanId: "implement",
      });
      await writer.toolCalled({
        tool: "bash",
        durationMs: 10,
        success: true,
        spanId: "implement/sub-1",
        parentSpanId: "implement",
      });
      await writer.append({
        type: "subagent.completed",
        spanId: "implement/sub-1",
        parentSpanId: "implement",
      });
      await writer.append({ type: "pass.completed" });

      const tree = reconstructSpanTree(await readEvents(root, "civic", RUN_ID));
      expect(tree.length).toBe(1);
      expect(tree[0]?.spanId).toBe("implement");
      expect(tree[0]?.events.map((e) => e.event)).toEqual(["pass.started", "pass.completed"]);
      expect(tree[0]?.children.length).toBe(1);
      expect(tree[0]?.children[0]?.spanId).toBe("implement/sub-1");
      expect(tree[0]?.children[0]?.events.map((e) => e.event)).toEqual([
        "subagent.started",
        "tool.called",
        "subagent.completed",
      ]);
    }));

  it("malformed trailing line tolerated; malformed mid-file throws", () =>
    withHome(async (root) => {
      const writer = createEventWriter(root, CTX, () => makeClock().now());
      await writer.append({ type: "pass.started" });
      await writer.append({ type: "pass.completed" });

      const path = runPaths(root, "civic", RUN_ID).events;
      appendFileSync(path, '{"event":"gate.sta'); // torn append, no newline
      const events = await readEvents(root, "civic", RUN_ID);
      expect(events.map((e) => e.event)).toEqual(["pass.started", "pass.completed"]);

      // Corruption in the middle is NOT tolerated.
      const good = readFileSync(path, "utf8").split("\n")[0];
      const corrupted = ["not json at all", good].join("\n") + "\n";
      const { writeFileSync } = await import("node:fs");
      writeFileSync(path, corrupted);
      await expect(readEvents(root, "civic", RUN_ID)).rejects.toThrow(/malformed mid-file/);
    }));

  it("infra and merit outcomes carry distinct codes", () =>
    withHome(async (root) => {
      const writer = createEventWriter(root, CTX, () => makeClock().now());
      // Infra: the pass errored — error_code present.
      await writer.append({
        type: "pass.failed",
        severity: "error",
        errorCode: "error_max_budget_usd",
      });
      // Merit: the pass concluded findings — an outcome, never an error_code.
      await writer.append({
        type: "verdict.recorded",
        detail: { verdict: "findings", findings: 3 },
      });

      const [infra, merit] = await readEvents(root, "civic", RUN_ID);
      expect(infra?.error_code).toBe("error_max_budget_usd");
      expect(merit?.error_code).toBeUndefined();
      expect(merit?.detail?.verdict).toBe("findings");
    }));
});
