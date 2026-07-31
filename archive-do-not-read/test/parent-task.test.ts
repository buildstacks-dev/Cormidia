// Parent delegated-task ledger and telemetry integration.
// Covers exact-prompt preservation, repository/native-task provenance,
// fallback integrity, terminal result references, CLI onboarding, and the
// rule that manual fallback/Reviewer bypass can never read as Operon E2E.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  beginParentTask,
  finishParentTask,
  markParentTaskFallback,
  readParentTask,
  readParentTaskPrompt,
} from "../src/org/parent-task.js";
import { cmdTask } from "../src/cli/task.js";
import { cmdTelemetry } from "../src/cli/telemetry.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

describe("parent delegated-task ledger", () => {
  it("preserves the exact prompt, native task link, repository identity, fallback, and result refs", async () => {
    const home = makeOrgHome();
    const prompt = "Build the requested outcome.\n\nDo not stop at a draft.\n";
    try {
      const begun = await beginParentTask({
        stateHome: home.root,
        taskId: "019f52a4-c8e6",
        originalPrompt: prompt,
        app: "buildstacks.dev",
        workdir: process.cwd(),
        harness: "codex",
        nativeTaskId: "019f52a4-c8e6",
        nativeRef: "codex://threads/019f52a4-c8e6",
        now: new Date("2026-07-11T19:26:00Z"),
      });
      expect(begun).toMatchObject({
        status: "running",
        executionMode: "operon",
        source: { harness: "codex", nativeRef: "codex://threads/019f52a4-c8e6" },
        repository: { workdir: process.cwd() },
      });
      expect(begun.promptSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(await readParentTaskPrompt(home.root, begun.taskId)).toBe(prompt);

      await markParentTaskFallback({
        stateHome: home.root,
        taskId: begun.taskId,
        reason: "Builder stopped; implementation continued in outer Codex",
        actor: "operator",
        now: new Date("2026-07-11T19:43:00Z"),
      });
      const finished = await finishParentTask({
        stateHome: home.root,
        taskId: begun.taskId,
        status: "completed",
        resultSummary: "PR opened; Operon Reviewer bypassed",
        refs: { tickets: ["#26", "#27", "#28"], prs: ["#29"] },
        completionState: {
          implementation: "complete",
          ci: "green",
          operonReview: "bypassed",
          humanReview: "awaiting",
          pr: "open",
          issuesCloseOnMerge: ["#26", "#27", "#28"],
        },
        now: new Date("2026-07-11T19:51:40Z"),
      });
      expect(finished).toMatchObject({
        status: "completed",
        executionMode: "mixed",
        resultSummary: "PR opened; Operon Reviewer bypassed",
        refs: { tickets: ["#26", "#27", "#28"], prs: ["#29"] },
      });
      await expect(markParentTaskFallback({
        stateHome: home.root,
        taskId: begun.taskId,
        reason: "too late",
      })).rejects.toThrow(/already completed/);
    } finally {
      home.cleanup();
    }
  });

  it("task CLI begins from a prompt file and prints the environment link", async () => {
    const home = makeOrgHome();
    const promptFile = join(home.root, "outer-prompt.md");
    writeFileSync(promptFile, "Exact outer request\n", "utf8");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await cmdTask([
        "begin",
        "--id", "outer-1",
        "--prompt-file", promptFile,
        "--harness", "codex",
        "--native-task-id", "thread-1",
        "--org-home", process.cwd(),
        "--state-home", home.root,
      ]);
      expect(code).toBe(0);
      expect(log.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
        "export OPERON_PARENT_TASK_ID='outer-1'",
      );
      expect(await readParentTaskPrompt(home.root, "outer-1")).toBe("Exact outer request\n");
      expect((await readParentTask(home.root, "outer-1")).source?.nativeRef).toBe(
        "codex://threads/thread-1",
      );
      expect((await readParentTask(home.root, "outer-1")).charter).toMatchObject({
        profile: "conservative",
        version: "legacy-conservative/v1",
      });
    } finally {
      log.mockRestore();
      home.cleanup();
    }
  });
});

describe("parent task telemetry integrity", () => {
  it("shows the exact prompt reference and refuses E2E-complete after fallback and Reviewer bypass", async () => {
    const home = makeOrgHome({
      runs: {
        records: {
          alpha: {
            plan1: {
              envelope: envelope("plan1", "planner", "plan", "outer-telemetry"),
              events: [],
            },
            build1: {
              envelope: envelope("build1", "builder", "build", "outer-telemetry"),
              events: [],
            },
          },
        },
      },
    });
    try {
      await beginParentTask({
        stateHome: home.root,
        taskId: "outer-telemetry",
        originalPrompt: "Ship the complete feature, including independent review.\n",
        app: "alpha",
        harness: "codex",
        nativeTaskId: "outer-telemetry",
        nativeRef: "codex://threads/outer-telemetry",
        now: new Date("2026-07-11T19:00:00Z"),
      });
      await markParentTaskFallback({
        stateHome: home.root,
        taskId: "outer-telemetry",
        reason: "implementation finished outside Operon",
      });
      await finishParentTask({
        stateHome: home.root,
        taskId: "outer-telemetry",
        status: "completed",
        refs: { tickets: ["#26"], prs: ["#29"] },
        completionState: {
          implementation: "complete",
          ci: "green",
          operonReview: "bypassed",
          humanReview: "awaiting",
          pr: "open",
          issuesCloseOnMerge: ["#26"],
        },
      });

      const jsonLog = vi.spyOn(console, "log").mockImplementation(() => {});
      await cmdTelemetry(["--org-home", home.root, "--state-home", home.root, "--json"]);
      const data = JSON.parse(jsonLog.mock.calls.map((call) => call.join(" ")).join("\n")) as {
        parent_tasks: Array<Record<string, unknown>>;
        completion_integrity: Record<string, unknown>;
      };
      jsonLog.mockRestore();
      expect(data.parent_tasks[0]).toMatchObject({
        task_id: "outer-telemetry",
        execution_mode: "mixed",
        required_stages: ["planner", "builder", "reviewer"],
        observed_stages: ["planner", "builder"],
        missing_required_stages: ["reviewer"],
        operon_end_to_end_complete: false,
        original_prompt: { ref: "prompt.md" },
      });
      expect(data.completion_integrity).toMatchObject({
        manual_fallback: "present",
        reviewer_pass: "missing",
        pr_state: "open",
      });

      const target = join(home.root, "parent-report.html");
      const htmlLog = vi.spyOn(console, "log").mockImplementation(() => {});
      await cmdTelemetry(["--org-home", home.root, "--state-home", home.root, "--html", target]);
      htmlLog.mockRestore();
      const html = readFileSync(target, "utf8");
      expect(html).toContain("Exact original operator prompt");
      expect(html).toContain("Operon end-to-end complete?</dt><dd>no");
      expect(html).toContain("implementation finished outside Operon");
      expect(html).toContain("implementation complete; CI green; Operon review bypassed; human review awaiting; PR open; issues close on merge #26");
      expect(readFileSync(join(home.root, "parent-report.evidence", "tasks", "outer-telemetry", "prompt.md"), "utf8")).toBe(
        "Ship the complete feature, including independent review.\n",
      );
    } finally {
      vi.restoreAllMocks();
      home.cleanup();
    }
  });
});

function envelope(runId: string, role: string, pipeline: string, parentTaskId: string): unknown {
  return {
    schema_version: 1,
    run_id: runId,
    trace_id: `${runId}-trace`,
    parent_task_id: parentTaskId,
    app: "alpha",
    pipeline,
    pass: pipeline,
    role,
    runtime: "codex",
    model: "gpt-5.5",
    effort: "high",
    status: "completed",
    started_at: "2026-07-11T19:10:00Z",
    finished_at: "2026-07-11T19:11:00Z",
    wall_clock_ms: 60_000,
    usage: { tokens_in: 10, tokens_out: 5, cost_usd: 0.1, quality: "estimated" },
    trace_plan: { required_passes: [pipeline], skipped_passes: [] },
    refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
  };
}
