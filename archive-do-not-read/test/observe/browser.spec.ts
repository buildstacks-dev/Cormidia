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
    // The routing reason carries a hostile payload: it must reach the DOM as
    // literal TEXT, verbatim and un-truncated, and must never execute.
    trace_plan: { required_passes: ["implement"], skipped_passes: [{ pass: "security", reason: "quick tier routing <script>window.__operonGraphInjected=true</script>" }] },
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
  // LOAD-BEARING COLLISION: `trace-2` exists in BOTH alpha and beta. It is the
  // only case that catches a graph, badge, cost, or history row keyed on the
  // bare `trace_id` instead of the composite `TraceView.id` (invariant 3). Do
  // not de-duplicate these ids.
  //
  // run-collision also carries envelope usage with NO matching telemetry row, so
  // it pins "an unsettled provider turn never renders as $0.00" (invariant 4).
  write(stateHome, "runs/beta/run-collision/envelope.json", `${JSON.stringify({
    schema_version: 1, run_id: "run-collision", trace_id: "trace-2", app: "beta", pipeline: "build", pass: "beta-collision", role: "builder",
    runtime: "codex", model: "gpt-5.5", status: "completed", started_at: "2026-07-10T10:00:00.000Z", finished_at: "2026-07-10T10:01:00.000Z",
    wall_clock_ms: 60_000, usage: { tokens_in: 10, tokens_out: 5, cost_usd: 9.99, quality: "complete" },
    refs: { events: "events.jsonl", brief: "brief.md", prompt: "prompt.md", output: "output.md", session_log: "session.log" },
  }, null, 2)}\n`);
  // An ALL-MECHANICAL trace: every pass invoked no provider, so its cost is an
  // AUTHORITATIVE zero ($0.00) and must never render as "unavailable". Paired
  // with run-collision above, the two pin both directions of invariant 4.
  write(stateHome, "runs/beta/run-mech/envelope.json", `${JSON.stringify({
    schema_version: 1, run_id: "run-mech", trace_id: "trace-mech", app: "beta", pipeline: "build", pass: "setup", role: "builder",
    runtime: "codex", model: "gpt-5.5", status: "completed", started_at: "2026-07-09T10:00:00.000Z", finished_at: "2026-07-09T10:00:30.000Z",
    wall_clock_ms: 30_000, usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0, quality: "none" },
    refs: { events: "events.jsonl", brief: "brief.md", prompt: "prompt.md", output: "output.md", session_log: "session.log" },
  }, null, 2)}\n`);
  // A trace claimed by a parent task through its recorded refs.traces ALONE:
  // the envelope carries NO parent_task_id, so `parent_session_id` is null and
  // the only evidence of the correlation is task-3's own refs. Reading just
  // parent_session_id reported this row as "not in the current window" while its
  // claiming session sat in the Session control (#96).
  write(stateHome, "runs/alpha/run-3/envelope.json", `${JSON.stringify({
    schema_version: 1, run_id: "run-3", trace_id: "trace-3", app: "alpha", pipeline: "build", pass: "implement", role: "builder",
    runtime: "codex", model: "gpt-5.5", status: "completed", started_at: "2026-07-08T10:00:00.000Z", finished_at: "2026-07-08T10:01:00.000Z",
    wall_clock_ms: 60_000, usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0, quality: "none" },
    refs: { events: "events.jsonl", brief: "brief.md", prompt: "prompt.md", output: "output.md", session_log: "session.log" },
  }, null, 2)}\n`);
  write(stateHome, "tasks/task-3/task.json", `${JSON.stringify({
    schemaVersion: 1, taskId: "task-3", app: "alpha", objective: "Claims its trace by reference only", promptRef: "prompt.md", promptSha256: "c".repeat(64),
    requiredStages: ["builder"], executionMode: "operon", fallbackEvents: [], status: "completed", startedAt: "2026-07-08T09:55:00.000Z", endedAt: "2026-07-08T10:02:00.000Z",
    refs: { tickets: [], traces: ["trace-3"], branches: [], prs: [], reviews: [], deployments: [] },
  }, null, 2)}\n`);
  write(stateHome, "tasks/task-3/prompt.md", "Reference-claimed outer prompt\n");
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
  // Live org + task-1 + task-2 + task-3 (which claims trace-3 by reference
  // only) + two standalone beta traces (trace-2 collision and the
  // all-mechanical trace-mech).
  await expect(page.locator("#session-selector option")).toHaveCount(6);
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
  // One node per observed pass across the five recorded traces.
  await expect(page.locator(".trace-node")).toHaveCount(4);

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
  await expect(page.locator(".session")).toHaveCount(5); // two settled tasks plus three envelope-only traces (two beta, one alpha)
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
  await expect(page.locator("#pending-intake-scope")).toContainText("waiting");
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

// #95 — a trace is a first-class, visible, selectable, linkable thing. The
// campaign defect was that the graph knew its traces and showed no boundaries at
// all: the trace id existed only in an aria-label.
test("gives every trace a visible boundary, a legend, an actionable node, and an honest manifest", async ({ page }) => {
  await page.goto(server.url);
  await expect(page.locator("#connection")).toHaveText("live");

  // --- Boundary header. The id must be in VISIBLE TEXT, not only in an
  // attribute: a sighted operator reading the graph could not see it before.
  const alphaOne = page.locator('#graph .trace-group[data-trace-id="trace:alpha:trace-1"]');
  await expect(alphaOne).toHaveCount(1);
  const head = alphaOne.locator(".trace-head");
  await expect(head).toContainText("trace-1");
  await expect(head).toContainText("build");
  await expect(head.locator('time[datetime="2026-07-12T11:30:00.000Z"]')).toHaveCount(1);
  await expect(head.locator(".pill")).toContainText("running");
  // A running trace has no measurable duration and never borrows the clock.
  await expect(head).toContainText("Trace not finished");
  await expect(head).toContainText("1 observed · 1 skipped · 0 not observed");

  // --- Invariant 3: `trace-2` exists in both apps and must render as two
  // distinct groups. Anything keyed on the bare trace id merges them.
  await expect(page.locator('#graph .trace-group[data-trace-id="trace:alpha:trace-2"]')).toHaveCount(1);
  await expect(page.locator('#graph .trace-group[data-trace-id="trace:beta:trace-2"]')).toHaveCount(1);

  // --- Cost per trace, both directions of invariant 4. beta/run-collision has
  // envelope usage but no settled ledger row; beta/run-mech invoked no provider.
  await expect(page.locator('#graph .trace-group[data-trace-id="trace:beta:trace-2"] .trace-head')).toContainText("unavailable (1 turn)");
  await expect(page.locator('#graph .trace-group[data-trace-id="trace:beta:trace-2"] .trace-head')).not.toContainText("$0.00");
  await expect(page.locator('#graph .trace-group[data-trace-id="trace:beta:trace-mech"] .trace-head')).toContainText("$0.00");

  // --- Legacy trace: no manifest, therefore NO fabricated expected stages.
  const legacy = page.locator('#graph .trace-group[data-trace-id="trace:beta:trace-2"]');
  await expect(legacy.locator(".trace-node.not_observed")).toHaveCount(0);
  await expect(legacy).toContainText("Trace manifest not recorded — expected stages unknown");

  // --- Skipped routing branch: the state in words AND the verbatim reason,
  // rendered as text. An innerHTML implementation executes nothing visible for a
  // <script> inserted this way but STRIPS the literal characters, so assert the
  // literal text is PRESENT rather than only that the flag is unset.
  const skipped = alphaOne.locator(".trace-node.skipped");
  await expect(skipped).toHaveCount(1);
  await expect(skipped).toContainText("skipped by routing");
  await expect(skipped).toContainText("quick tier routing <script>window.__operonGraphInjected=true</script>");
  expect(await page.evaluate(() => (window as unknown as { __operonGraphInjected?: boolean }).__operonGraphInjected)).toBeUndefined();

  // --- Legend: keyboard reachable, and every row states its meaning in WORDS.
  await page.locator("#graph-search").focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("SUMMARY");
  expect(await page.evaluate(() => document.activeElement?.closest("details")?.id)).toBe("graph-legend");
  // Native <details> gives keyboard expansion and aria-expanded with no custom
  // JS; the rows must be readable text once open, not a tooltip.
  await page.keyboard.press("Enter");
  await expect(page.locator("#graph-legend")).toHaveAttribute("open", /.*/);
  const legendRows = await page.$$eval("#graph-legend li[data-legend-state]", (elements) =>
    elements.map((element) => ({ state: element.getAttribute("data-legend-state"), text: (element as HTMLElement).innerText.trim() })));
  expect(legendRows.length).toBeGreaterThan(0);
  // A row whose only content is a coloured swatch teaches nothing (invariant 7).
  for (const entry of legendRows) expect(entry.text, entry.state ?? "").toContain(entry.state!.replace(/_/g, " "));
  await expect(page.locator("#graph-legend")).toContainText("→");
  await expect(page.locator("#graph-legend")).toContainText("skipped by routing");

  // --- Clicking a pass node is a real, persistent, linkable selection.
  await clickClear(page.locator('#graph [data-pass-id="pass:alpha:run-1"]'));
  await expect(page.locator("#drawer")).toBeVisible();
  await expect(page.locator("#drawer-title")).toHaveText("Pass inspection");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/pass=pass%3Aalpha%3Arun-1/);
  await expect(page.locator("#pass-filter")).toHaveValue("pass:alpha:run-1");
  await expect(page.locator('#graph [aria-current="true"][data-pass-id]')).toHaveCount(1);
  await expect(page.locator('#graph .trace-group[data-trace-id="trace:alpha:trace-1"]')).toHaveAttribute("data-selected", "true");
  const focused = await page.$$eval('#activity li[data-focused="true"]', (elements) =>
    elements.map((element) => (element as HTMLElement).dataset["passId"]));
  expect(focused.length).toBeGreaterThan(0);
  expect([...new Set(focused)]).toEqual(["pass:alpha:run-1"]);

  // A re-render driven by SSE must not forget the selection…
  github.issue.labels = ["op:ready", "p1"];
  await service.refreshGithubNow();
  await page.waitForTimeout(200);
  await expect(page.locator('#graph [aria-current="true"][data-pass-id]')).toHaveCount(1);
  // …and the selection lives in the URL ONLY: no client store (invariant 1).
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(await page.evaluate(() => document.cookie)).toBe("");
  const selectedUrl = page.url();
  await page.goto(selectedUrl);
  await expect(page.locator('#graph [aria-current="true"][data-pass-id]')).toHaveCount(1);

  // --- Trace-level action reuses the landed ?trace= filter on COMPOSITE
  // identity. Writing the bare trace_id would fail to resolve and the badge
  // would read 'selected trace is not in the current window'.
  await clickClear(page.locator('#graph .trace-group[data-trace-id="trace:alpha:trace-1"] [data-trace-filter]'));
  await expect(page).toHaveURL(/trace=trace%3Aalpha%3Atrace-1/);
  await expect(page.locator("#trace-filter")).toHaveValue("trace:alpha:trace-1");
  await expect(page.locator("#activity-scope")).not.toContainText("selected trace is not in the current window");
  const traceScoped = await page.$$eval("#activity li", (elements) => elements.map((element) => (element as HTMLElement).dataset["passId"]));
  expect(traceScoped.length).toBeGreaterThan(0);
  expect(traceScoped.every((value) => value!.startsWith("pass:alpha:"))).toBe(true);
});

test("discloses trace search against the honest total and keeps it in URL state", async ({ page }) => {
  const requests: string[] = [];
  const capped = new URL(server.url);
  capped.searchParams.set("more", "graph=1");
  await page.goto(capped.toString());
  await expect(page.locator("#connection")).toHaveText("live");
  page.on("request", (request) => { if (!request.url().includes("/api/v1/events")) requests.push(request.url()); });

  await expect(page.locator("#graph .trace-group")).toHaveCount(1);
  await expect(page.locator("#graph-scope")).toContainText("showing 1 of 5");
  await expect(page.locator("#graph")).toHaveAttribute("aria-describedby", /graph-scope/);
  await expect(page.locator('#graph [data-more-key="graph"]')).toHaveAttribute("aria-label", "Show more execution graph traces");

  await page.locator("#graph-search").fill("collision");
  await expect(page.locator("#graph .trace-group")).toHaveCount(1);
  await expect(page.locator('#graph .trace-group[data-trace-id="trace:beta:trace-2"]')).toHaveCount(1);
  await expect(page).toHaveURL(/gq=collision/);
  // The denominator stays the projection's honest total. 'showing 1 of 1' with
  // no recorded count would tell the operator only one trace exists.
  await expect(page.locator("#graph-scope")).toContainText("5 recorded");
  await expect(page.locator("#graph-scope")).toContainText("graph search=collision");
  // A search is pure client-side narrowing over data already delivered.
  expect(requests).toEqual([]);

  const shared = page.url();
  await page.goto(shared);
  await expect(page.locator("#graph .trace-group")).toHaveCount(1);
  await expect(page.locator("#graph-search")).toHaveValue("collision");
  await expect(page.locator('#graph .trace-group[data-trace-id="trace:beta:trace-2"]')).toHaveCount(1);
});

// Two lists live inside the "Recorded sessions and completion integrity"
// section. They are independent collections and must hold independent paging
// keys: a shared key couples their caps, makes `?more=` unable to express them
// separately, and — because the pager's focus is restored by key — sends
// keyboard focus into whichever list renders first.
test("recorded sessions and integrity records page independently", async ({ page }) => {
  const capped = new URL(server.url);
  capped.searchParams.set("more", "history-index=1,history=1");
  await page.goto(capped.toString());
  await expect(page.locator("#connection")).toHaveText("live");

  await expect(page.locator("#history-index .history-row")).toHaveCount(1);
  await expect(page.locator("#history .history-row")).toHaveCount(1);

  // Distinct keys and distinct accessible names. A single key here is exactly
  // what makes cross-section focus restoration possible.
  const indexPager = page.locator('#history-index [data-more-key="history-index"]');
  const recordPager = page.locator('#history [data-more-key="history"]');
  await expect(indexPager).toHaveAttribute("aria-label", "Show more recorded sessions");
  await expect(recordPager).toHaveAttribute("aria-label", "Show more completion integrity records");
  expect(await page.locator('#history-index [data-more-key="history"]').count()).toBe(0);
  expect(await page.locator('#history [data-more-key="history-index"]').count()).toBe(0);

  // Paging the index leaves the integrity list exactly where it was.
  await clickClear(indexPager);
  expect(await page.locator("#history-index .history-row").count()).toBeGreaterThan(1);
  await expect(page.locator("#history .history-row")).toHaveCount(1);
  await expect(recordPager).toHaveCount(1);

  // The URL carries both caps separately, so the link reproduces this view.
  const more = new URL(page.url()).searchParams.get("more") ?? "";
  expect(more).toContain("history=1");
  expect(more).toContain("history-index=31");

  // Focus stayed inside the section the operator was paging.
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest("#history-index") !== null)).toBe(true);
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest("#history") !== null)).toBe(false);

  // And paging the integrity list back does not re-collapse or re-expand the index.
  const indexRows = await page.locator("#history-index .history-row").count();
  await clickClear(recordPager);
  expect(await page.locator("#history .history-row").count()).toBeGreaterThan(1);
  await expect(page.locator("#history-index .history-row")).toHaveCount(indexRows);
});

// A trace whose ONLY evidence of a parent is that task's recorded refs.traces.
// It is not itself selectable, so it must navigate to — and be marked as part
// of — the session that claims it, rather than claiming to be out of window.
test("a trace claimed only by refs.traces navigates to its claiming session", async ({ page }) => {
  await page.goto(server.url);
  await expect(page.locator("#connection")).toHaveText("live");

  const row = page.locator('#history-index [data-row-id="trace:alpha:trace-3"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("part of recorded session task:task-3");
  await expect(row).not.toContainText("not in the current window");
  await expect(row).toHaveAttribute("data-session-id", "task:task-3");

  // The recorded-activity row for the same trace resolves the same way.
  await expect(page.locator("#activity-history")).not.toContainText("trace:alpha:trace-3 not selectable");
  await expect(page.locator('#activity-history [data-session-target="task:task-3"]')).toHaveCount(1);

  // Activating it selects the claiming session, and the row then reports itself
  // as a member of that session — in text, not by colour alone.
  await clickClear(row);
  await expect(page.locator("#session-selector")).toHaveValue("task:task-3");
  await expect(row).toHaveAttribute("data-session-member", "true");
  await expect(row).toContainText("in the selected session");
  // aria-current still marks exactly one row: the session's own.
  await expect(page.locator('#history-index .history-row[aria-current="true"]')).toHaveCount(1);
  await expect(page.locator('#history-index .history-row[aria-current="true"]')).toHaveAttribute("data-row-id", "task:task-3");
  // Focus was restored to the row that was activated, not to another row
  // sharing its session id.
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset["rowId"])).toBe("trace:alpha:trace-3");
});

// A deliberate scope NARROWING is not truncation. The scope kind and the
// session detail say what was excluded and why; only the display cap and the
// projection's delivery limit may claim records were withheld. Quoting the
// org-wide trace total as the denominator turned every narrowing into an
// affirmative false claim — "showing 1 of 4" with no pager, for a section that
// withheld nothing.
test("a narrowed section discloses its own collection, never a wider one", async ({ page }) => {
  const scoped = new URL(server.url);
  scoped.searchParams.set("session", "trace:beta:trace-mech");
  await page.goto(scoped.toString());
  await expect(page.locator("#connection")).toHaveText("live");

  await expect(page.locator("#graph .trace-group")).toHaveCount(1);
  await expect(page.locator("#graph-scope")).toHaveAttribute("data-scope-kind", "single_trace");
  await expect(page.locator("#graph-scope")).toContainText("1 shown");
  await expect(page.locator("#graph-scope")).not.toContainText("of 4");
  await expect(page.locator("#graph-scope")).not.toContainText("showing 1 of");
  // No pager, because nothing was withheld — the disclosure and the controls
  // must tell the same story.
  await expect(page.locator('#graph [data-more-key="graph"]')).toHaveCount(0);

  // The app filter narrows this section too, and its denominator follows.
  await page.goto(server.url);
  await page.locator("#app-filter").selectOption("beta");
  await expect(page.locator("#graph-scope")).toContainText("2 shown");
  await expect(page.locator("#graph-scope")).not.toContainText("of 4");
});

// "This trace only" must ADMIT only that trace. Membership is proved by real
// identity; a null parent_task_id is the absence of a correlation, never a
// match against a trace session's (non-existent) task id.
test("a single-trace session admits only that trace's recorded activity", async ({ page }) => {
  await page.goto(server.url);
  await expect(page.locator("#connection")).toHaveText("live");
  // Both beta traces are ticketless, so both are recorded-activity rows, and
  // both carry a null parent_task_id — the pair the old predicate conflated.
  const liveRows = await page.$$eval("#activity-history li", (elements) => elements.length);
  expect(liveRows).toBeGreaterThan(1);

  const scoped = new URL(server.url);
  scoped.searchParams.set("session", "trace:beta:trace-mech");
  await page.goto(scoped.toString());
  await expect(page.locator("#activity-history-scope")).toHaveAttribute("data-scope-kind", "single_trace");
  await expect(page.locator("#activity-history-scope")).toContainText("This trace only");
  await expect(page.locator("#activity-history li")).toHaveCount(1);
  await expect(page.locator("#activity-history")).not.toContainText("beta-collision");
});

// #96 — a recorded session is a snapshot, not an animated replay, and each row
// must be a real control that changes scope.
test("turns recorded sessions into two-way navigation without replay language", async ({ page }) => {
  await page.goto(server.url);
  await expect(page.locator("#connection")).toHaveText("live");

  await expect(page.locator("#history-title")).toHaveText("Recorded sessions and completion integrity");
  await expect(page.locator("#history-title")).not.toContainText(/replay/i);
  await expect(page.locator("#identity")).not.toContainText(/replay/i);
  await expect(page.locator("#identity")).toContainText("updated");
  const explanation = page.locator("#history-title").locator("xpath=../following-sibling::p[1]");
  await expect(explanation).toContainText("recorded snapshot");
  await expect(explanation).toContainText("No intermediate state is reconstructed");
  await expect(explanation).toContainText("Session control");

  // Every row is either a real control or states why it is not one.
  const rows = await page.$$eval("#history-index .history-row", (elements) => elements.map((element) => ({
    tag: element.tagName,
    session: (element as HTMLElement).dataset["sessionId"] ?? null,
    row: (element as HTMLElement).dataset["rowId"] ?? null,
    notSelectable: (element as HTMLElement).dataset["notSelectable"] ?? null,
    text: (element as HTMLElement).innerText.trim(),
  })));
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    if (row.session) expect(row.tag).toBe("BUTTON");
    else { expect(row.notSelectable).toBe("true"); expect(row.text.length).toBeGreaterThan(0); }
  }
  // A trace CLAIMED by a parent task navigates to the parent session: its own
  // composite id is not a selectable session and would be silently reset.
  const claimed = rows.find((row) => row.row === "trace:alpha:trace-1")!;
  expect(claimed.session).toBe("task:task-1");
  expect(claimed.text).toContain("part of recorded session task:task-1");

  // Declared fields are actually rendered, and cost goes through the ONE renderer.
  const betaRow = page.locator('#history-index [data-row-id="trace:beta:trace-2"]');
  await expect(betaRow.locator("time[datetime]")).toHaveCount(1);
  await expect(betaRow).toContainText("1 passes");
  await expect(betaRow).toContainText("unavailable (1 turn)");
  await expect(page.locator('#history-index [data-row-id="trace:beta:trace-mech"]')).toContainText("$0.00");
  await expect(page.locator('#history-index [data-row-id="trace:alpha:trace-1"]')).toContainText("Trace not finished");

  // Row -> dropdown, on the composite identity. With alpha also carrying
  // `trace-2`, a bare-id implementation selects the wrong app's session.
  await clickClear(page.locator('#history-index [data-session-id="trace:beta:trace-2"]'));
  await expect(page.locator("#session-selector")).toHaveValue("trace:beta:trace-2");
  await expect(page.locator("#session-mode")).toHaveText("historical");
  // selectSession() is reused, not forked: its filter reset comes along.
  await expect(page.locator("#trace-filter")).toHaveValue("");
  await expect(page.locator("#pass-filter")).toHaveValue("");
  const graphApps = await page.$$eval("#graph .trace-group", (elements) => elements.map((element) => (element as HTMLElement).dataset["traceId"]));
  expect(graphApps).toEqual(["trace:beta:trace-2"]);
  // Focus lands on the replacement control rather than at <body>.
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset["sessionId"])).toBe("trace:beta:trace-2");

  // Dropdown -> row. aria-current is DERIVED from state, so an SSE re-render
  // cannot drop it, and it must not steal focus or scroll.
  await page.locator("#session-selector").selectOption("task:task-2");
  await expect(page.locator('#history-index .history-row[aria-current="true"]')).toHaveCount(1);
  await expect(page.locator('#history-index .history-row[aria-current="true"]')).toHaveAttribute("data-row-id", "task:task-2");
  const before = await page.evaluate(() => ({
    scroll: document.documentElement.scrollTop,
    active: (document.activeElement as HTMLElement | null)?.tagName ?? null,
  }));
  github.issue.labels = ["op:ready", "p1"];
  await service.refreshGithubNow();
  await page.waitForTimeout(250);
  await expect(page.locator('#history-index .history-row[aria-current="true"]')).toHaveCount(1);
  await expect(page.locator('#history-index .history-row[aria-current="true"]')).toHaveAttribute("data-row-id", "task:task-2");
  expect(await page.evaluate(() => ({
    scroll: document.documentElement.scrollTop,
    active: (document.activeElement as HTMLElement | null)?.tagName ?? null,
  }))).toEqual(before);

  await page.locator("#session-selector").selectOption("");
  await expect(page.locator('#history-index .history-row[aria-current="true"]')).toHaveCount(0);

  // Search is over STRUCTURED IDENTITY only. Indexing a parent task's objective
  // would let free text imply a relationship the projection never recorded.
  const total = rows.length;
  await page.locator("#history-search").fill("beta");
  await expect(page).toHaveURL(/hq=beta/);
  await expect(page.locator("#history-index-scope")).toContainText(`${total} recorded`);
  await expect(page.locator("#history-index-scope")).toContainText("matching");
  const matchedRows = await page.$$eval("#history-index .history-row", (elements) => elements.map((element) => (element as HTMLElement).dataset["rowId"]));
  expect(matchedRows.every((value) => value!.includes("beta"))).toBe(true);

  await page.locator("#history-search").fill("observed slice");
  await expect(page.locator("#history-index-scope")).toContainText(`showing 0 of 0 matching · ${total} recorded`);
  await page.locator("#history-search").fill("task-1");
  expect(await page.locator("#history-index .history-row").count()).toBeGreaterThan(0);

  await page.locator("#history-search").fill("");
  await expect(page.locator("#history-index-scope")).toContainText(`${total} shown`);
});

// A ?session= naming a record outside the delivered window KEEPS the selection
// and reports an empty projection for it. It must NOT fall back to Live org: a
// historical view may only return to live when the operator picks "Live org"
// (invariant 15), and this is the same out-of-window handling the trace and
// pass filters already apply through syncOptionPairs.
test("keeps a session that left the window selected, and states why it is empty", async ({ page }) => {
  const ghost = new URL(server.url);
  ghost.searchParams.set("session", "trace:alpha:ghost");
  await page.goto(ghost.toString());
  await expect(page.locator("#connection")).toHaveText("live");

  // Still historical, still the selected value, and the URL still means what it
  // said — the selection was not silently widened to the whole org.
  await expect(page.locator("#session-mode")).toHaveText("historical");
  await expect(page.locator("#session-selector")).toHaveValue("trace:alpha:ghost");
  await expect(page.locator("#session-selector")).toContainText("not in current window");
  expect(new URL(page.url()).searchParams.get("session")).toBe("trace:alpha:ghost");

  await expect(page.locator("#history-index-scope-reason")).toContainText("not in the delivered window");
  await expect(page.locator("#history-index-scope-reason")).toContainText('until you choose "Live org"');
  await expect(page.locator("#scope-statement")).toContainText("trace:alpha:ghost (not in the delivered window)");

  // An undelivered scope has no recorded aggregate. It reports "unavailable",
  // never $0.00: an authoritative zero for records that were simply not
  // delivered is the none/unavailable conflation invariant 4 forbids.
  await expect(page.locator("#totals")).toContainText("unavailable");
  await expect(page.locator("#totals")).not.toContainText("$0.00");

  // Only the operator's own choice returns to live.
  await page.locator("#session-selector").selectOption("");
  await expect(page.locator("#session-mode")).toHaveText("live");
  expect(new URL(page.url()).searchParams.get("session")).toBe(null);
  await expect(page.locator("#history-index-scope-reason")).toBeHidden();
});

// #98 — the required end-to-end switch between Live org and a historical trace,
// asserting several sections' scope labels at once including ones that stay
// app-wide.
const SCOPE_KINDS = ["live_app_wide", "filtered_app_wide", "parent_task_session", "single_trace", "app_wide_context"];

test("switches between Live org and a historical trace with every section stating its scope", async ({ page }) => {
  await page.goto(server.url);
  await expect(page.locator("#connection")).toHaveText("live");

  const badges = async () => page.$$eval("#main [data-scope-kind], header [data-scope-kind]", (elements) =>
    elements.map((element) => ({ id: element.id, kind: element.getAttribute("data-scope-kind"), text: (element as HTMLElement).textContent?.trim() ?? "" })));

  const live = await badges();
  expect(live.length).toBeGreaterThanOrEqual(9);
  for (const badge of live) {
    expect(SCOPE_KINDS, badge.id).toContain(badge.kind!);
    expect(badge.text.length, badge.id).toBeGreaterThan(0);
    expect(badge.kind, badge.id).toBe("live_app_wide");
  }
  const liveApps = await page.locator("#apps").innerText();
  const liveSources = await page.locator("#sources").innerText();

  // The scope statement always states apps, range, filters and trace scope.
  await expect(page.locator("#totals")).toHaveAttribute("aria-describedby", "scope-statement");
  await expect(page.locator("#scope-statement")).toContainText("apps: alpha, beta");
  await expect(page.locator("#scope-statement")).toContainText("time range: all recorded through");
  // Both filter classes are named explicitly. Asserting a bare "filters: none"
  // was satisfied by the substring of either segment, so it could not tell an
  // undeclared snapshot filter from a genuinely unfiltered view.
  await expect(page.locator("#scope-statement")).toContainText("snapshot filters: none");
  await expect(page.locator("#scope-statement")).toContainText("display filters: none");
  await expect(page.locator("#scope-statement")).toContainText("trace: none");
  expect(await page.locator("#scope-statement time[datetime]").count()).toBe(1);

  // A filter alone is app-wide-but-filtered, not a session.
  await page.locator("#app-filter").selectOption("alpha");
  await expect(page.locator("#graph-scope")).toHaveAttribute("data-scope-kind", "filtered_app_wide");
  await page.locator("#app-filter").selectOption("");
  await expect(page.locator("#graph-scope")).toHaveAttribute("data-scope-kind", "live_app_wide");

  // --- Switch to a historical trace.
  await page.locator("#session-selector").selectOption("trace:beta:trace-2");
  await expect(page).toHaveURL(/session=trace%3Abeta%3Atrace-2/);
  await expect(page.locator("#session-mode")).toHaveText("historical");
  for (const id of ["graph-scope", "activity-scope", "history-scope", "attention-count", "delivery-scope", "activity-history-scope"]) {
    await expect(page.locator(`#${id}`), id).toHaveAttribute("data-scope-kind", "single_trace");
  }
  // Sections that are legitimately app-wide or current-time are LABELLED, never
  // silently rescoped or falsified (invariant 14).
  for (const id of ["apps-scope", "sources-scope", "pending-intake-scope", "history-index-scope"]) {
    await expect(page.locator(`#${id}`), id).toHaveAttribute("data-scope-kind", "app_wide_context");
    await expect(page.locator(`#${id}-reason`), id).not.toBeEmpty();
  }
  // Byte-identical: filtering, blanking, or restamping source health would each
  // imply an org-wide point-in-time snapshot that does not exist.
  expect(await page.locator("#sources").innerText()).toBe(liveSources);
  // The app card keeps its month-to-date figure for an app with real spend.
  await expect(page.locator("#apps")).toContainText("month-to-date · app-wide");
  await expect(page.locator("#apps")).toContainText("$0.40");
  expect(liveApps).toContain("$0.40");
  // An unsettled provider turn is 'unavailable', never $0.00 and never the
  // envelope amount (#89, invariant 4).
  await expect(page.locator("#totals")).toContainText("unavailable (1 turn)");
  await expect(page.locator("#totals")).not.toContainText("$9.99");
  // An empty historical delivery projection is STATED, not implied six times.
  await expect(page.locator("#delivery .delivery-column")).toHaveCount(0);
  await expect(page.locator("#delivery .empty")).toHaveCount(1);
  await expect(page.locator("#delivery")).toContainText("no correlated GitHub tickets");

  // Invariant 15: a fresh snapshot must not jump the view back to live.
  github.issue.labels = ["op:building", "p1"];
  await service.refreshGithubNow();
  await page.waitForTimeout(250);
  await expect(page.locator("#session-mode")).toHaveText("historical");
  await expect(page.locator("#graph-scope")).toHaveAttribute("data-scope-kind", "single_trace");
  await expect(page.locator("#apps-scope")).toHaveAttribute("data-scope-kind", "app_wide_context");

  await page.reload();
  await expect(page.locator("#session-selector")).toHaveValue("trace:beta:trace-2");
  await expect(page.locator("#session-mode")).toHaveText("historical");
  await expect(page.locator("#graph-scope")).toHaveAttribute("data-scope-kind", "single_trace");

  // A parent-task session is its own kind, and a filter under it is still named.
  const both = new URL(server.url);
  both.searchParams.set("app", "alpha");
  both.searchParams.set("role", "builder");
  both.searchParams.set("session", "task:task-1");
  await page.goto(both.toString());
  await expect(page.locator("#graph-scope")).toHaveAttribute("data-scope-kind", "parent_task_session");
  // Session kind wins over filters, but the filters are NOT discarded.
  await expect(page.locator("#graph-scope")).toContainText("app=alpha (pass)");
  // `apps` is the SERVER's post-snapshot-filter list, so under a client-side
  // app filter it still names every delivered app — and the statement says so
  // rather than implying the totals were narrowed. Asserting "apps: alpha"
  // passed vacuously against "apps: alpha, beta"; this pins the whole segment.
  await expect(page.locator("#scope-statement")).toContainText("apps: alpha, beta");
  await expect(page.locator("#scope-statement")).toContainText("snapshot filters: none");
  await expect(page.locator("#scope-statement")).toContainText(
    "display filters: app=alpha (pass), role=builder (pass) (narrow the sections below, not these totals)",
  );
  await expect(page.locator("#scope-statement")).toContainText("trace: parent task task-1");

  // Back to Live org.
  await page.locator("#session-selector").selectOption("");
  await expect(page).not.toHaveURL(/session=/);
  await expect(page.locator("#session-mode")).toHaveText("live");
  // Every badge is either scope-derived and names the narrowing, or declares
  // itself app-wide WITH a stated reason. 'unaffected' is not an escape hatch.
  for (const badge of await badges()) {
    if (badge.kind === "app_wide_context") await expect(page.locator(`#${badge.id}-reason`), badge.id).not.toBeEmpty();
    else { expect(badge.kind, badge.id).toBe("filtered_app_wide"); expect(badge.text, badge.id).toContain("app=alpha"); }
  }
  await page.locator("#clear-filters").click();
  for (const badge of await badges()) expect(badge.kind, badge.id).toBe("live_app_wide");
});

test("keeps every scope badge and reason readable at 360px with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 720 });
  const historical = new URL(server.url);
  historical.searchParams.set("session", "trace:beta:trace-2");
  await page.goto(historical.toString());
  await expect(page.locator("#connection")).toHaveText("live");
  await expect(page.locator("#session-mode")).toHaveText("historical");

  // The badges and reason lines are the longest strings on the page; a missing
  // overflow-wrap or min-width:0 pushes the whole document wide.
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  for (const badge of await page.locator("[data-scope-kind]").all()) await expect(badge).toBeVisible();
  for (const reason of await page.locator("[data-scope-reason]").all()) await expect(reason).toBeVisible();
  // A long node row scrolls inside its OWN container, not by widening the page.
  const overflow = await page.$$eval(".trace-group ol.trace", (elements) => elements.map((element) => getComputedStyle(element).overflowX));
  expect(overflow.length).toBeGreaterThan(0);
  for (const value of overflow) expect(value).toBe("auto");
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

// A SERVER-SIDE snapshot filter (operon observe --ticket 1) narrows what the
// projection delivers, so the header totals genuinely cover less. The statement
// must declare it: reading only the client dropdowns printed "filters: none"
// over a snapshot already narrowed to one ticket — an affirmative denial of a
// narrowing that had occurred (#98, invariant 8).
test.describe("a snapshot narrowed by a server-side filter", () => {
  let filteredService: ObserveService;
  let filteredServer: StartedObserveServer;

  test.beforeAll(async () => {
    filteredService = new ObserveService({
      orgName: "fixture-org",
      stateHome,
      appsFile: appsFile(),
      filters: { ticket: 1 },
      reconcileMs: 60_000,
      githubPollMs: 60_000,
      heartbeatMs: 500,
      watchFiles: false,
      clock: () => new Date("2026-07-12T12:00:00.000Z"),
    });
    await filteredService.start();
    filteredServer = await startObserveServer({ service: filteredService, stateHome, port: 0 });
  });

  test.afterAll(async () => {
    await filteredService.stop();
    if (filteredServer.server.listening) await filteredServer.close();
  });

  test("declares the snapshot filter it was delivered under", async ({ page }) => {
    await page.goto(filteredServer.url);
    await expect(page.locator("#connection")).toHaveText("live");

    // The fact the projection recorded, surfaced verbatim rather than re-derived.
    await expect(page.locator("#scope-statement")).toContainText("snapshot filters: ticket=1");
    await expect(page.locator("#scope-statement")).not.toContainText("snapshot filters: none");
    // The client dropdowns are untouched, and are reported as their own class.
    await expect(page.locator("#scope-statement")).toContainText("display filters: none");

    // The narrowing is real: passes for other tickets were never delivered.
    const tickets = await page.evaluate(async () => {
      const response = await fetch("/api/v1/snapshot" + location.search, { cache: "no-store" });
      const snapshot = await response.json() as { passes: Array<{ ticket: string | null }> };
      return snapshot.passes.map((pass) => pass.ticket);
    });
    expect(tickets.length).toBeGreaterThan(0);
    expect([...new Set(tickets)]).toEqual(["#1"]);
  });
});

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
