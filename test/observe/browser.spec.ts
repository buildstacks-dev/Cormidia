import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import type { AppsFile } from "../../src/org/apps.js";
import type { GhIssue } from "../../src/loop/github.js";
import type { GitHubReadResult, ObserveGitHubSource } from "../../src/observe/github-source.js";
import { ObserveService } from "../../src/observe/live-source.js";
import { startObserveServer, type StartedObserveServer } from "../../src/observe/server.js";
import { ReportService } from "../../src/report/service.js";
import { buildReport } from "../../src/report/project.js";
import { renderReportHtml } from "../../src/report/render-html.js";

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
  write(stateHome, "runs/alpha/run-2/envelope.json", `${JSON.stringify({
    schema_version: 1,
    run_id: "run-2",
    trace_id: "trace-2",
    parent_task_id: "task-2",
    app: "alpha",
    ticket: "#2",
    pipeline: "review",
    pass: "historical-review",
    role: "reviewer",
    runtime: "claude",
    model: "claude-opus-4-1",
    effort: "high",
    status: "completed",
    started_at: "2026-07-11T10:00:00.000Z",
    finished_at: "2026-07-11T10:02:00.000Z",
    wall_clock_ms: 120_000,
    usage: { tokens_in: 20, tokens_out: 10, cost_usd: 0.3, quality: "complete" },
    previews: { output: "Historical review complete" },
    refs: { events: "events.jsonl", brief: "brief.md", prompt: "prompt.md", output: "output.md", session_log: "session.log" },
  }, null, 2)}\n`);
  write(stateHome, "runs/alpha/run-2/events.jsonl", `${JSON.stringify({
    trace_id: "trace-2", span_id: "historical-review", app: "alpha", ticket: "#2", pipeline: "review", pass: "historical-review", role: "reviewer", model: "claude-opus-4-1",
    ts: "2026-07-11T10:01:00.000Z", event: "review.completed", severity: "info", detail: { findings: 0 },
  })}\n`);
  write(stateHome, "tasks/task-2/task.json", `${JSON.stringify({
    schemaVersion: 1, taskId: "task-2", app: "alpha", objective: "Earlier completed delivery", promptRef: "prompt.md", promptSha256: "b".repeat(64),
    requiredStages: ["reviewer"], executionMode: "operon", fallbackEvents: [], status: "completed", startedAt: "2026-07-11T09:55:00.000Z", endedAt: "2026-07-11T10:03:00.000Z",
    refs: { tickets: ["#2"], traces: ["trace-2"], branches: [], prs: [], reviews: [], deployments: [] },
  }, null, 2)}\n`);
  write(stateHome, "tasks/task-2/prompt.md", "Earlier outer prompt\n");
  write(stateHome, "runs/beta/run-collision/envelope.json", `${JSON.stringify({
    schema_version: 1, run_id: "run-collision", trace_id: "trace-2", app: "beta", pipeline: "build", pass: "beta-collision", role: "builder",
    runtime: "codex", model: "gpt-5.5", status: "completed", started_at: "2026-07-10T10:00:00.000Z", finished_at: "2026-07-10T10:01:00.000Z",
    wall_clock_ms: 60_000, usage: { tokens_in: 10, tokens_out: 5, cost_usd: 9.99, quality: "complete" },
    refs: { events: "events.jsonl", brief: "brief.md", prompt: "prompt.md", output: "output.md", session_log: "session.log" },
  }, null, 2)}\n`);
  write(stateHome, "telemetry/2026-07-12.jsonl", [
    { at: "2026-07-12T12:00:00.000Z", role: "builder", runtime: "codex", model: "gpt-5.5<script>window.__operonInjected=true</script>", status: "completed", tokensIn: 10, tokensOut: 5, costUsd: 0.1, usageQuality: "partial", subagentTurns: 0, wallClockMs: 1000, escalations: 0, app: "alpha", runId: "run-1", traceId: "trace-1", parentTaskId: "task-1", pipeline: "build", pass: "implement", costEstimated: true },
    { at: "2026-07-11T10:02:00.000Z", role: "reviewer", runtime: "claude", model: "claude-opus-4-1", status: "completed", tokensIn: 20, tokensOut: 10, costUsd: 0.3, usageQuality: "complete", subagentTurns: 0, wallClockMs: 120000, escalations: 0, app: "alpha", runId: "run-2", traceId: "trace-2", parentTaskId: "task-2", pipeline: "review", pass: "historical-review" },
  ].map((row) => JSON.stringify(row)).join("\n") + "\n");
  write(stateHome, "state/events/inbox/health.json", `${JSON.stringify({
    id: "evt-1", kind: "health-alert", app: "alpha", occurred_at: "2026-07-12T09:00:00Z", source: "monitoring",
  })}\n`);
  write(stateHome, "state/events/inbox/feedback.json", `${JSON.stringify({ id: "evt-2", kind: "support-feedback", app: "alpha" })}\n`);
  write(stateHome, "state/events/inbox/hostile.json", `${JSON.stringify({ kind: "<img src=x onerror=alert(1)>", app: "alpha" })}\n`);
  write(stateHome, "state/events/inbox/broken.json", "{not-json");
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
  server = await startObserveServer({ service, stateHome, port: 0, reportService: new ReportService({ orgName: "fixture-org", stateHome, appsFile: appsFile(), clock: () => new Date("2026-07-12T12:00:00.000Z") }) });
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
  await expect(page.locator("#session-selector")).toHaveValue("");
  await expect(page.locator("#session-selector option")).toHaveCount(4);
  await expect(page.locator("#session-selector")).toContainText("task-1");
  await expect(page.locator("#session-selector")).toContainText("task-2");
  await expect(page.locator("#session-selector")).toContainText("beta");
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

  await page.locator("#session-selector").selectOption("task:task-2");
  await expect(page).toHaveURL(/session=task%3Atask-2/);
  await expect(page.locator("#session-mode")).toHaveText("historical");
  await expect(page.locator("#activity-title")).toHaveText("Historical activity");
  await expect(page.locator(".trace-node")).toHaveCount(1);
  await expect(page.locator(".trace-node")).toContainText("historical-review");
  await expect(page.locator("#activity")).toContainText("review.completed");
  await expect(page.locator("#activity")).not.toContainText("tool.called");
  await expect(page.locator("#history")).toContainText("task-2");
  await expect(page.locator("#history")).not.toContainText("task-1");
  await expect(page.locator("#totals")).toContainText("$0.30");
  await page.reload();
  await expect(page.locator("#session-selector")).toHaveValue("task:task-2");

  await page.locator("#session-selector").selectOption("");
  await expect(page).not.toHaveURL(/session=/);
  await expect(page.locator("#session-mode")).toHaveText("live");
  await expect(page.locator(".trace-node")).toHaveCount(3);

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

test("navigates to Reports, preserves URL controls, renders exhaustive safe sessions, exports, and prints without external requests", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).hostname !== "127.0.0.1") external.push(request.url()); });
  const url = new URL(server.url); url.pathname = "/reports";
  await page.goto(url.toString());
  await expect(page.getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#status")).toContainText("Snapshot generated");
  await expect(page.locator("#report section").first()).toContainText("Data quality");
  await expect(page.locator(".session")).toHaveCount(3); // two settled tasks plus one envelope-only beta trace
  await page.locator(".session").first().click();
  await expect(page.locator(".session").first()).toContainText("provider_turn");
  await expect(page.locator("body")).toContainText("gpt-5.5<script>window.__operonInjected=true</script>");
  expect(await page.evaluate(() => (window as unknown as { __operonInjected?: boolean }).__operonInjected)).toBeUndefined();
  await page.locator("#app").selectOption("alpha");
  await page.locator("#period").selectOption("7d");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page).toHaveURL(/app=alpha/);
  await expect(page).toHaveURL(/period=7d/);
  await expect(page.locator("#json-export")).toHaveAttribute("href", /export\.json\?app=alpha/);
  await expect(page.locator("#html-export")).toHaveAttribute("href", /export\.html\?app=alpha/);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).not.toBe("none");
  await page.emulateMedia({ media: "print" });
  expect(await page.locator("#controls").evaluate((element) => getComputedStyle(element).display)).toBe("none");
  expect(external).toEqual([]);
});

test("Reports honors reduced motion and remains responsive at 360px", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 780 });
  const url = new URL(server.url); url.pathname = "/reports";
  await page.goto(url.toString());
  await expect(page.locator("#status")).toContainText("Snapshot generated");
  const widths = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: innerWidth }));
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
});

test("generated portable org 7d/90d/1y and app reports work at desktop, 360px, reduced motion, and print with no network", async ({ page }) => {
  const generated: string[] = [];
  for (const period of ["7d", "90d", "1y"] as const) {
    const report = await buildReport({ orgName: "fixture-org", stateHome, appsFile: appsFile(), now: new Date("2026-07-12T12:00:00Z"), query: { period } });
    const path = join(root, `portable-org-${period}.html`);
    writeFileSync(path, renderReportHtml(report), "utf8");
    generated.push(path);
  }
  const appReport = await buildReport({ orgName: "fixture-org", stateHome, appsFile: appsFile(), now: new Date("2026-07-12T12:00:00Z"), query: { app: "alpha", period: "90d" } });
  const appPath = join(root, "portable-alpha-90d.html");
  writeFileSync(appPath, renderReportHtml(appReport), "utf8");
  generated.push(appPath);

  const external: string[] = [];
  page.on("request", (request) => { if (!request.url().startsWith("file:")) external.push(request.url()); });
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const path of generated) {
    await page.goto(`file://${path}`);
    await expect(page.getByText("OPERON REPORTS")).toBeVisible();
    await expect(page.locator(".quality")).toBeVisible();
    await expect(page.getByText("Accessible trend data table")).toBeVisible();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`file://${appPath}`);
  await expect(page.locator("#session-filter")).toBeVisible();
  const widths = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: innerWidth }));
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
  await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
  expect(await page.locator("#session-filter").evaluate((element) => getComputedStyle(element).display)).toBe("none");
  expect(external).toEqual([]);
});


test.describe("timestamps are timezone-explicit and machine-readable", () => {
  test.use({ timezoneId: "America/Los_Angeles", locale: "en-US" });

  test("states the display zone, renders zone-tagged <time>, and offers a URL-persisted UTC toggle", async ({ page }) => {
    await page.goto(server.url);
    await expect(page.locator("#connection")).toHaveText("live");

    // The active zone is rendered TEXT, not a tooltip, so it is screen-reader
    // reachable.
    await expect(page.locator("#timezone")).toHaveText(
      /^Times shown in America\/Los_Angeles \(P[DS]T, UTC[+-]\d{2}:\d{2}\) · source and tooltips UTC$/,
    );

    // Every rendered instant carries a visible zone token and a canonical
    // machine-readable UTC datetime.
    const texts = await page.$$eval("time", (elements) => elements.map((element) => element.textContent ?? ""));
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text).toMatch(/(?:\b[A-Z]{2,5}\b|UTC[+-]\d{2}:\d{2})$/);
    const stamps = await page.$$eval("time", (elements) => elements.map((element) => element.getAttribute("datetime")));
    for (const value of stamps) expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    await expect(page.locator('time[datetime="2026-07-12T11:59:59.000Z"]').first()).toBeVisible();

    // The exact value pins that local digits are really localized, not a
    // constant 'UTC' suffix bolted onto browser-local time.
    await expect(page.locator("#activity time").first()).toHaveText("7/12/2026, 4:59:59 AM PDT");

    // Exact UTC is always reachable per row, without the toggle.
    const titled = await page.$$eval("time", (elements) =>
      elements.every((element) => (element.getAttribute("title") ?? "").includes((element.getAttribute("datetime") ?? "").replace("T", " ").slice(0, 19) + " UTC")));
    expect(titled).toBe(true);

    const before = await page.$$eval("#activity time", (elements) => elements.map((element) => element.getAttribute("datetime")));
    await page.locator("#tz-toggle").click();
    await expect(page.locator("#tz-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/tz=utc/);
    await expect(page.locator("#activity time").first()).toHaveText("2026-07-12 11:59:59 UTC");
    await expect(page.locator("#timezone")).toContainText("Times shown in UTC");
    // datetime is byte-identical across the toggle: it is the source instant,
    // never a re-render of what is displayed.
    const after = await page.$$eval("#activity time", (elements) => elements.map((element) => element.getAttribute("datetime")));
    expect(after).toEqual(before);

    await page.reload();
    await expect(page.locator("#tz-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#activity time").first()).toHaveText("2026-07-12 11:59:59 UTC");
  });

  test("applies the same policy to every section and to Reports", async ({ page }) => {
    await page.goto(server.url);
    await expect(page.locator("#connection")).toHaveText("live");
    for (const selector of ["#activity-history time", "#activity time", "#sources time", "#identity time"]) {
      expect(await page.locator(selector).count(), selector).toBeGreaterThan(0);
    }
    // An <option> cannot host a child element, so the zone token goes in the
    // label and the canonical UTC instant in the title.
    const option = page.locator('#session-selector option[value="task:task-1"]');
    await expect(option).toHaveText(/(?:\b[A-Z]{2,5}\b|UTC[+-]\d{2}:\d{2})$/);
    await expect(option).toHaveAttribute("title", "2026-07-12T11:00:00.000Z");

    await clickClear(page.locator(".trace-node").filter({ hasText: "implement" }).first());
    await expect(page.locator("#drawer")).toBeVisible();
    expect(await page.locator("#drawer time").count()).toBeGreaterThan(0);
    await page.keyboard.press("Escape");

    const reports = new URL(server.url);
    reports.pathname = "/reports";
    await page.goto(reports.toString());
    await expect(page.locator("#status")).toContainText("Snapshot generated");
    const reportStamps = await page.$$eval("header time, #report-main time", (elements) =>
      elements.map((element) => ({ text: element.textContent ?? "", value: element.getAttribute("datetime") })));
    expect(reportStamps.length).toBeGreaterThan(0);
    for (const entry of reportStamps) {
      expect(entry.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(entry.text).toMatch(/(?:\b[A-Z]{2,5}\b|UTC[+-]\d{2}:\d{2})$/);
    }
    await expect(page.locator("#timezone")).toContainText("America/Los_Angeles");
  });
});

test.describe("daylight-saving boundaries are resolved per instant", () => {
  test.use({ timezoneId: "America/Los_Angeles", locale: "en-US" });

  // A separate state home and server: adding these runs to the shared fixture
  // would break its exact option/trace-node counts.
  let dstRoot: string;
  let dstService: ObserveService;
  let dstServer: StartedObserveServer;

  test.beforeAll(async () => {
    dstRoot = mkdtempSync(join(tmpdir(), "operon-observe-dst-"));
    const home = join(dstRoot, "state");
    const events = [
      // Spring forward: 01:59 PST then 03:00 PDT.
      { ts: "2026-03-08T09:59:00.000Z", event: "pass.started" },
      { ts: "2026-03-08T10:00:00.000Z", event: "gate.passed" },
      // Fall back: both land on local wall clock 1:00:00 AM.
      { ts: "2026-11-01T08:00:00.000Z", event: "gate.started" },
      { ts: "2026-11-01T09:00:00.000Z", event: "pass.completed" },
    ];
    write(home, "runs/alpha/dst-1/envelope.json", `${JSON.stringify({
      schema_version: 1, run_id: "dst-1", trace_id: "dst-trace", app: "alpha", pipeline: "build", pass: "implement",
      role: "builder", runtime: "codex", model: "gpt-5.5", status: "completed", started_at: "2026-03-08T09:00:00.000Z",
      finished_at: "2026-11-01T09:30:00.000Z", wall_clock_ms: 1000,
      usage: { tokens_in: 1, tokens_out: 1, cost_usd: 0.1, quality: "complete" },
      refs: { events: "events.jsonl", brief: "brief.md", prompt: "prompt.md", output: "output.md", session_log: "session.log" },
    }, null, 2)}\n`);
    write(home, "runs/alpha/dst-1/events.jsonl", events.map((entry) => JSON.stringify({
      trace_id: "dst-trace", span_id: "implement", app: "alpha", pipeline: "build", pass: "implement", role: "builder",
      severity: "info", ...entry,
    })).join("\n") + "\n");
    dstService = new ObserveService({
      orgName: "dst-org", stateHome: home, appsFile: appsFile(), githubSource: new MutableGitHub(),
      reconcileMs: 60_000, githubPollMs: 60_000, heartbeatMs: 60_000, watchFiles: false,
      clock: () => new Date("2026-12-01T12:00:00.000Z"),
    });
    await dstService.start();
    dstServer = await startObserveServer({ service: dstService, stateHome: home, port: 0 });
  });

  test.afterAll(async () => {
    await dstService.stop();
    if (dstServer.server.listening) await dstServer.close();
    rmSync(dstRoot, { recursive: true, force: true });
  });

  test("renders each instant with its own offset across both DST transitions", async ({ page }) => {
    await page.goto(dstServer.url);
    await expect(page.locator("#connection")).toHaveText("live");
    const rows = await page.$$eval("#activity time", (elements) =>
      elements.map((element) => ({ text: element.textContent ?? "", value: element.getAttribute("datetime") })));
    const byInstant = new Map(rows.map((entry) => [entry.value, entry.text]));

    // A cached single offset renders these identically — indistinguishable to
    // an operator reading an incident timeline.
    expect(byInstant.get("2026-03-08T09:59:00.000Z")).toBe("3/8/2026, 1:59:00 AM PST");
    expect(byInstant.get("2026-03-08T10:00:00.000Z")).toBe("3/8/2026, 3:00:00 AM PDT");

    const fallBack = ["2026-11-01T08:00:00.000Z", "2026-11-01T09:00:00.000Z"].map((key) => byInstant.get(key));
    expect(fallBack[0]).not.toBe(fallBack[1]);
    expect(fallBack.map((text) => /(PDT|PST)/.exec(text ?? "")?.[1])).toEqual(["PDT", "PST"]);
  });
});

test("groups repeated attention conditions by cause and expands to occurrences", async ({ page }) => {
  await page.goto(server.url);
  await expect(page.locator("#connection")).toHaveText("live");
  const usage = page.locator('#attention details[data-group^="attention-group:usage_incomplete"]');
  await expect(usage).toHaveCount(1);
  // Severity is a WORD, not only a border colour.
  await expect(usage.locator("summary")).toContainText("warning");
  await expect(usage.locator("summary")).toContainText(/\d+ occurrence/);
  await expect(page.locator("#attention-count")).toContainText("group(s)");
  await expect(page.locator("#attention-count")).toContainText("most severe first");

  // Closed by default; native <details> gives keyboard expansion and
  // aria-expanded with no custom JS.
  await expect(usage).not.toHaveAttribute("open", /.*/);
  const order = await page.$$eval("#attention article, #attention details", (elements) =>
    elements.map((element) => (element as HTMLElement).dataset["group"]));
  await usage.locator("summary").evaluate((element) => element.scrollIntoView({ block: "center" }));
  await usage.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(usage).toHaveAttribute("open", /.*/);
  await expect(usage.locator("ol li").first()).toContainText("runs/alpha/run-1/");

  // A re-render must not collapse an expanded group.
  await service.refreshGithubNow();
  await page.waitForTimeout(200);
  await expect(usage).toHaveAttribute("open", /.*/);
  await expect(usage.locator("ol li").first()).toBeVisible();

  // The client renders in the projection's declared order and never re-sorts.
  const reordered = await page.$$eval("#attention article, #attention details", (elements) =>
    elements.map((element) => (element as HTMLElement).dataset["group"]));
  expect(reordered).toEqual(order);
  const serverOrder = await page.evaluate(async () => {
    const token = new URL(location.href).searchParams.get("token") ?? "";
    const response = await fetch("/api/v1/snapshot?token=" + encodeURIComponent(token), { cache: "no-store" });
    return ((await response.json()) as { attention_groups: Array<{ id: string }> }).attention_groups.map((group) => group.id);
  });
  expect(order).toEqual(serverOrder.filter((id) => order.includes(id)));
});

test("separates recorded activity from pending intake and navigates by real session identity", async ({ page }) => {
  const methods: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET") methods.push(request.method()); });
  await page.goto(server.url);
  await expect(page.locator("#connection")).toHaveText("live");

  // Pending intake is a <ul>, not an <ol>: it is explicitly not a sequence.
  await expect(page.locator("ul#pending-intake")).toBeVisible();
  await expect(page.locator("#pending-intake")).toContainText("Service health alert");
  await expect(page.locator("#pending-intake")).toContainText("Company event file drop");
  // A corrupt file still shows a received time, labelled as discovered.
  await expect(page.locator("#pending-intake")).toContainText("discovered");
  await expect(page.locator("#pending-intake-scope")).toContainText("pending");
  // The unmapped hostile kind reaches the DOM as text, never as markup.
  await expect(page.locator("#pending-intake")).toContainText("<img src=x onerror=alert(1)>");
  expect(await page.locator("#pending-intake img").count()).toBe(0);

  await expect(page.locator("#activity-history-scope")).toContainText("Newest first");
  await clickClear(page.locator("#order-toggle"));
  await expect(page).toHaveURL(/order=chronological/);
  await expect(page.locator("#activity-history-scope")).toContainText("Oldest first");
  await expect(page.locator("#order-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("#activity-history-scope")).toContainText("Oldest first");
  await clickClear(page.locator("#order-toggle"));

  const link = page.locator("#activity-history .session-link:not([disabled])").first();
  if (await link.count() > 0) {
    await clickClear(link);
    await expect(page).toHaveURL(/session=/);
    await expect(page.locator("#session-mode")).toHaveText("historical");
    // Pending intake is org-wide and cannot belong to a session.
    await expect(page.locator("#pending-intake")).toContainText("org-wide and not part of this session");
    await page.locator("#session-selector").selectOption("");
  }
  expect(methods).toEqual([]);
});

test("labels activity ordering, filters by typed facets, groups by real identity, and explains follow state", async ({ page }) => {
  await page.goto(server.url);
  await expect(page.locator("#connection")).toHaveText("live");
  await expect(page.locator("#activity-scope")).toContainText("newest first");
  await expect(page.locator("#activity-scope")).toContainText("same timestamp");

  const keys = await page.$$eval("#activity li", (elements) => elements.map((element) => (element as HTMLElement).dataset["orderKey"]));
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.every((value) => value !== undefined)).toBe(true);
  expect([...keys]).toEqual([...keys].sort().reverse());

  // Filters live in URL state and survive a reload.
  await page.locator("#event-kind-filter").selectOption("tool");
  await expect(page).toHaveURL(/ev=tool/);
  await expect(page.locator("#activity li")).toHaveCount(1);
  await expect(page.locator("#activity")).toContainText("tool.called");
  await page.reload();
  await expect(page.locator("#activity li")).toHaveCount(1);
  await page.locator("#outcome-filter").selectOption("failure");
  await expect(page).toHaveURL(/outcome=failure/);
  await expect(page.locator("#activity li")).toHaveCount(0);
  await page.locator("#outcome-filter").selectOption("");
  await page.locator("#event-kind-filter").selectOption("");

  // Grouping never drops or duplicates an entry.
  const flat = await page.$$eval("#activity li", (elements) => elements.map((element) => (element as HTMLElement).dataset["entryId"]));
  for (const mode of ["trace", "pass"]) {
    await page.locator("#group-mode").selectOption(mode);
    await expect(page).toHaveURL(new RegExp("group=" + mode));
    const grouped = await page.$$eval("#activity li", (elements) => elements.map((element) => (element as HTMLElement).dataset["entryId"]));
    expect([...grouped].sort()).toEqual([...flat].sort());
    expect(await page.locator("#activity section[data-group-key]").count()).toBeGreaterThan(0);
  }
  await page.locator("#group-mode").selectOption("none");

  // Graph <-> activity focus, keyed on the real pass id.
  const node = page.locator(".trace-node").filter({ hasText: "implement" }).first();
  await clickClear(node);
  await expect(page).toHaveURL(/pass=pass%3Aalpha%3Arun-1/);
  await expect(node).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator('#activity li[data-focused="true"]').first()).toBeVisible();
  // `?pass=` FILTERS the stream — it does not merely highlight rows that happen
  // to fall inside the page — and the badge names the facet each filter applies
  // to (status/trace/pass filter the PASS; kind/outcome filter the EVENT).
  await expect(page.locator("#activity-scope")).toContainText("pass=pass:alpha:run-1 (pass)");
  await expect(page.locator("#pass-filter")).toHaveValue("pass:alpha:run-1");
  const passScoped = await page.$$eval("#activity li", (elements) => elements.map((element) => (element as HTMLElement).dataset["passId"]));
  expect(passScoped.length).toBeGreaterThan(0);
  expect([...new Set(passScoped)]).toEqual(["pass:alpha:run-1"]);
  await clickClear(page.locator('#activity li[data-pass-id="pass:alpha:run-1"] button[data-target-pass]').first());
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset["passId"])).toBe("pass:alpha:run-1");

  // The trace filter narrows on (app, trace_id) via the projection's composite
  // trace identity, and survives a reload like every other filter.
  await page.locator("#pass-filter").selectOption("");
  const traceValue = await page.locator("#trace-filter option").nth(1).getAttribute("value");
  await page.locator("#trace-filter").selectOption(traceValue!);
  await expect(page).toHaveURL(new RegExp("trace=" + encodeURIComponent(traceValue!).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await expect(page.locator("#activity-scope")).toContainText("trace=" + traceValue + " (pass)");
  await page.reload();
  await expect(page.locator("#trace-filter")).toHaveValue(traceValue!);
  await clickClear(page.locator("#clear-filters"));
  await expect(page.locator("#trace-filter")).toHaveValue("");
  await expect(page.locator("#pass-filter")).toHaveValue("");

  // Follow vs paused is stated in words and in the button's disabled state.
  await expect(page.locator("#activity-follow")).toHaveText("following live");
  await expect(page.locator("#resume-stream")).toBeDisabled();
  await expect(page.locator("#activity-follow-help")).not.toBeEmpty();
  // The fixture has few events, so constrain the viewport of the list to make
  // it genuinely scrollable. scrollTop === 5 (not >= 10) must already read as
  // paused: any movement away from the newest entry is a pause.
  await page.locator("#activity").evaluate((element) => {
    element.style.maxHeight = "40px";
    element.scrollTop = 5;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(page.locator("#activity-follow")).toContainText("paused");
  await expect(page.locator("#resume-stream")).toBeEnabled();
  await expect(page.locator("#activity-follow")).toHaveText("paused - 0 new since paused");
  // The list itself is NOT an aria-live region: replaceChildren rebuilds it
  // wholesale every snapshot, so a live list re-announces every visible entry.
  // The follow pill is the single live region and carries the completeness fact.
  await expect(page.locator("#activity")).not.toHaveAttribute("aria-live", /.*/);
  await expect(page.locator("#activity-follow")).toHaveAttribute("aria-live", "polite");

  // Entries that arrive WHILE paused are counted — the pill's whole reason to
  // exist. Two new durable events land and reach the client over SSE.
  write(stateHome, "runs/alpha/run-1/events.jsonl", [
    JSON.stringify({
      trace_id: "trace-1", span_id: "implement", app: "alpha", ticket: "#1", pipeline: "build", pass: "implement", role: "builder", model: "gpt-5.5",
      ts: "2026-07-12T11:59:59.000Z", event: "tool.called", severity: "info", detail: { tool: "bash", duration_ms: 10, success: true, args_hash: "a".repeat(16) },
    }),
    JSON.stringify({
      trace_id: "trace-1", span_id: "implement", app: "alpha", ticket: "#1", pipeline: "build", pass: "implement", role: "builder", model: "gpt-5.5",
      ts: "2026-07-12T11:59:59.500Z", event: "pass.heartbeat", severity: "info", detail: {},
    }),
    JSON.stringify({
      trace_id: "trace-1", span_id: "implement", app: "alpha", ticket: "#1", pipeline: "build", pass: "implement", role: "builder", model: "gpt-5.5",
      ts: "2026-07-12T11:59:59.900Z", event: "gate.passed", severity: "info", detail: { gate: "typecheck" },
    }),
  ].join("\n") + "\n");
  await service.reconcileNow();
  await expect(page.locator("#activity-follow")).toHaveText("paused - 2 new since paused");

  await clickClear(page.locator("#resume-stream"));
  await expect(page.locator("#activity-follow")).toHaveText("following live");
  expect(await page.locator("#activity").evaluate((element) => element.scrollTop)).toBe(0);
});

// Every capped collection must DECLARE its cap. The caps are driven down from
// the URL here rather than by building a 45-trace fixture: `more` is the same
// state the Show more control writes, so this exercises the real disclosure and
// paging path at a size the shared fixture can express.
test("discloses every capped section instead of silently slicing, and keeps focus with the pager", async ({ page }) => {
  const capped = new URL(server.url);
  capped.searchParams.set("more", "graph=1,history=1,activity=1");
  await page.goto(capped.toString());
  await expect(page.locator("#connection")).toHaveText("live");

  // Execution graph: the badge previously printed the PRE-cap total beside a
  // silently sliced list, asserting a count the section did not render.
  const graphTotal = await page.locator("#graph .trace").count();
  expect(graphTotal).toBe(1);
  await expect(page.locator("#graph-scope")).toContainText("showing 1 of ");
  await expect(page.locator("#graph")).toHaveAttribute("aria-describedby", "graph-scope");
  const graphMore = page.locator('#graph [data-more-key="graph"]');
  await expect(graphMore).toHaveAttribute("aria-label", "Show more execution graph traces");
  await graphMore.focus();
  await page.keyboard.press("Enter");
  // Paging must not throw a keyboard operator back to <body>: render() destroys
  // the button that was just activated, so focus is restored explicitly.
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
  expect(await page.locator("#graph .trace").count()).toBeGreaterThan(1);
  await expect(page.locator("#graph-scope")).not.toContainText("showing 1 of ");

  // Historical replay / completion integrity: this section had no scope element
  // in the markup at all, so a dropped integrity row was indistinguishable from
  // a clean run.
  await expect(page.locator("#history-scope")).toContainText("showing 1 of ");
  await expect(page.locator("#history")).toHaveAttribute("aria-describedby", "history-scope");
  await expect(page.locator("#history .history-row")).toHaveCount(1);
  const historyMore = page.locator('#history [data-more-key="history"]');
  await expect(historyMore).toHaveAttribute("aria-label", "Show more completion integrity records");
  await historyMore.focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
  expect(await page.locator("#history .history-row").count()).toBeGreaterThan(1);

  // Paging is part of the shared view, so a handed-over link reproduces it.
  await expect(page).toHaveURL(/more=/);
  const shared = page.url();
  await page.goto(shared);
  expect(await page.locator("#history .history-row").count()).toBeGreaterThan(1);

  // Every Show more names its own section rather than repeating a bare label.
  const labels = await page.$$eval("[data-more-key]", (elements) => elements.map((element) => element.getAttribute("aria-label")));
  expect(new Set(labels).size).toBe(labels.length);
});

/** The global header is `position: sticky`, so an element the browser scrolls
 *  flush to the top edge sits underneath it. Centre the target first — this is
 *  what a real operator's scroll does, and it keeps these assertions about
 *  behaviour rather than about layout luck. */
async function clickClear(locator: import("@playwright/test").Locator): Promise<void> {
  await locator.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await locator.click();
}

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
    apps: [
      { name: "alpha", repo: "owner/alpha", status: "live", budgetUsdMonth: 1000, cadence: {}, channels: {} },
      { name: "beta", repo: "owner/beta", status: "paused", budgetUsdMonth: 1000, cadence: {}, channels: {} },
    ],
  };
}

function write(base: string, relative: string, content: string): void {
  const path = join(base, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}
