import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import type { AppsFile } from "../../src/org/apps.js";
import type { GhIssue } from "../../src/loop/github.js";
import type { GitHubReadResult, ObserveGitHubSource } from "../../src/observe/github-source.js";
import { ObserveService } from "../../src/observe/live-source.js";
import { startObserveServer, type StartedObserveServer } from "../../src/observe/server.js";

let root: string;
let stateHome: string;
let service: ObserveService;
let server: StartedObserveServer;
let github: MutableGitHub;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "operon-observe-browser-"));
  stateHome = join(root, "state");
  write(stateHome, "runs/alpha/run-1/envelope.json", `${JSON.stringify({
    schema_version: 1,
    run_id: "run-1",
    trace_id: "trace-1",
    parent_task_id: "task-1",
    app: "alpha",
    ticket: "#1",
    pipeline: "build",
    pass: "implement",
    role: "builder",
    runtime: "codex",
    model: "gpt-5.5",
    effort: "high",
    status: "running",
    started_at: "2026-07-12T11:30:00.000Z",
    last_seen_at: "2026-07-12T11:59:59.000Z",
    usage: { tokens_in: 10, tokens_out: 5, cost_usd: 0.1, quality: "partial", cost_estimated: true },
    previews: { output: "<script>window.__operonInjected=true</script>" },
    trace_plan: { required_passes: ["implement"], skipped_passes: [{ pass: "security", reason: "quick tier routing" }] },
    refs: { events: "events.jsonl", brief: "brief.md", prompt: "prompt.md", output: "output.md", session_log: "session.log" },
  }, null, 2)}\n`);
  write(stateHome, "runs/alpha/run-1/events.jsonl", `${JSON.stringify({
    trace_id: "trace-1", span_id: "implement", app: "alpha", ticket: "#1", pipeline: "build", pass: "implement", role: "builder", model: "gpt-5.5",
    ts: "2026-07-12T11:59:59.000Z", event: "tool.called", severity: "info", detail: { tool: "bash", duration_ms: 10, success: true, args_hash: "a".repeat(16) },
  })}\n`);
  write(stateHome, "runs/alpha/run-1/brief.md", "Exact brief\n");
  write(stateHome, "runs/alpha/run-1/prompt.md", "Exact prompt\n");
  write(stateHome, "runs/alpha/run-1/output.md", "Exact output\n");
  write(stateHome, "runs/alpha/run-1/session.log", "activity log only\n");
  write(stateHome, "tasks/task-1/task.json", `${JSON.stringify({
    schemaVersion: 1, taskId: "task-1", app: "alpha", objective: "Deliver the observed slice", promptRef: "prompt.md", promptSha256: "a".repeat(64),
    requiredStages: ["builder", "reviewer"], executionMode: "operon", fallbackEvents: [], status: "running", startedAt: "2026-07-12T11:00:00.000Z",
    refs: { tickets: ["#1"], traces: ["trace-1"], branches: [], prs: [], reviews: [], deployments: [] },
  }, null, 2)}\n`);
  write(stateHome, "tasks/task-1/prompt.md", "Exact outer prompt\n");
  github = new MutableGitHub();
  service = new ObserveService({
    orgName: "fixture-org",
    stateHome,
    appsFile: appsFile(),
    githubSource: github,
    reconcileMs: 60_000,
    githubPollMs: 60_000,
    heartbeatMs: 500,
    watchFiles: false,
    clock: () => new Date("2026-07-12T12:00:00.000Z"),
  });
  await service.start();
  server = await startObserveServer({ service, stateHome, port: 0 });
});

test.afterAll(async () => {
  await service.stop();
  if (server.server.listening) await server.close();
  rmSync(root, { recursive: true, force: true });
});

test("renders live overview safely, supports keyboard inspection, artifacts, filters, and SSE movement", async ({ page, context }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") external.push(request.url());
  });
  await page.goto(server.url);
  await expect(page.getByText("READ ONLY")).toBeVisible();
  await expect(page.locator("#connection")).toHaveText("live");
  await expect(page.getByText("fixture-org", { exact: false })).toBeVisible();
  await expect(page.locator(".ticket")).toHaveCount(1);
  await expect(page.locator(".delivery-column").filter({ hasText: "Ready" }).locator(".ticket")).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { __operonInjected?: boolean }).__operonInjected)).toBeUndefined();

  const passNode = page.locator(".trace-node").filter({ hasText: "implement" }).first();
  await passNode.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#drawer")).toBeVisible();
  await expect(page.getByText("Activity log—not transcript", { exact: true })).toBeVisible();
  await expect(page.getByText("<script>window.__operonInjected=true</script>", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Exact prompt" }).click();
  await expect(page.locator("#artifact-content")).toContainText("Exact prompt");
  await page.locator("#artifact-dialog form button").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#drawer")).toBeHidden();

  await page.locator("#app-filter").selectOption("alpha");
  await expect(page).toHaveURL(/app=alpha/);
  await page.reload();
  await expect(page.locator("#app-filter")).toHaveValue("alpha");

  github.issue.labels = ["op:building", "p1"];
  await service.refreshGithubNow();
  await expect(page.locator(".ticket")).toHaveCount(1);
  await expect(page.locator(".delivery-column").filter({ hasText: "Building" }).locator(".ticket")).toHaveCount(1);
  await expect(page.locator(".delivery-column").filter({ hasText: "Ready" }).locator(".ticket")).toHaveCount(0);

  await page.route("**/api/v1/events*", (route) => route.abort());
  service.disconnectClients();
  await expect(page.locator("#connection")).toHaveText("reconnecting");
  await page.unroute("**/api/v1/events*");
  await expect(page.locator("#connection")).toHaveText("live", { timeout: 5_000 });
  await expect(page.locator(".ticket")).toHaveCount(1);
  expect(external).toEqual([]);
});

test("honors reduced motion and remains page-width responsive at 360px", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(server.url);
  await expect(page.locator("#connection")).toHaveText("live");
  const animation = await page.locator(".trace-node.running.live").evaluate((element) => getComputedStyle(element, "::after").animationName);
  expect(animation).toBe("none");
  const widths = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: window.innerWidth }));
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
  await expect(page.locator(".delivery-board")).toBeVisible();
});

class MutableGitHub implements ObserveGitHubSource {
  issue: GhIssue = {
    number: 1,
    title: "<img src=x onerror=window.__operonInjected=true> Safe ticket",
    body: "## Goal\nShip safely",
    labels: ["op:ready", "p1"],
    state: "OPEN",
    url: "https://github.com/owner/alpha/issues/1",
  };

  async read(_apps: AppsFile["apps"], now: Date): Promise<GitHubReadResult> {
    return {
      apps: [{ app: "alpha", repo: "owner/alpha", issues: [{ ...this.issue, labels: [...this.issue.labels] }], pull_requests: [], observed_at: now.toISOString() }],
      health: { id: "github", status: "healthy", observed_at: now.toISOString(), last_success_at: now.toISOString(), detail: "fixture" },
    };
  }
}

function appsFile(): AppsFile {
  return {
    org: { name: "fixture-org", maxConcurrentTurns: 2 },
    defaults: { budgetUsdMonth: 1000 },
    apps: [{ name: "alpha", repo: "owner/alpha", status: "live", budgetUsdMonth: 1000, cadence: {}, channels: {} }],
  };
}

function write(base: string, relative: string, content: string): void {
  const path = join(base, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}
