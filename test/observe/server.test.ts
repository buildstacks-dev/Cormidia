import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppsFile } from "../../src/org/apps.js";
import { ObserveService } from "../../src/observe/live-source.js";
import { startObserveServer, type StartedObserveServer } from "../../src/observe/server.js";
import type { GitHubReadResult, ObserveGitHubSource } from "../../src/observe/github-source.js";
import { ReportService } from "../../src/report/service.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

describe("observer server integration", () => {
  it("binds an ephemeral loopback port and protects every browser/API surface with strict headers", async () => {
    const rig = await startRig();
    expect(rig.started.host).toBe("127.0.0.1");
    expect(rig.started.port).toBeGreaterThan(0);

    const denied = await fetch(`${rig.base}/api/v1/snapshot`);
    expect(denied.status).toBe(401);
    const snapshotResponse = await authFetch(rig, "/api/v1/snapshot");
    expect(snapshotResponse.status).toBe(200);
    expect(snapshotResponse.headers.get("cache-control")).toContain("no-store");
    expect(snapshotResponse.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(snapshotResponse.headers.get("referrer-policy")).toBe("no-referrer");
    expect(snapshotResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(snapshotResponse.headers.get("x-frame-options")).toBe("DENY");
    const snapshot = await snapshotResponse.json() as Record<string, unknown>;
    expect(snapshot["schema_version"]).toBe(1);

    const health = await authFetch(rig, "/healthz");
    expect(await health.json()).toMatchObject({ status: "ok", read_only: true });
    const mutation = await fetch(`${rig.base}/api/v1/snapshot?token=${encodeURIComponent(rig.started.token)}`, { method: "POST" });
    expect(mutation.status).toBe(405);
    expect(await mutation.json()).toMatchObject({ read_only: true });
    expect((rig.started.server.address() as { address: string }).address).toBe("127.0.0.1");
  });

  it("never preloads raw L3, serves allowlisted evidence deliberately, and rejects traversal/symlink escapes", async () => {
    const rig = await startRig({ prompt: "<script>raw prompt</script>\nSECRET-ONLY-IN-L3\n" });
    const snapshotText = await (await authFetch(rig, "/api/v1/snapshot")).text();
    expect(snapshotText).not.toContain("SECRET-ONLY-IN-L3");
    const artifact = await authFetch(rig, "/api/v1/artifacts/alpha/run-1/prompt");
    expect(artifact.status).toBe(200);
    expect(artifact.headers.get("content-type")).toContain("text/plain");
    expect(artifact.headers.get("cache-control")).toContain("no-store");
    expect(await artifact.text()).toContain("SECRET-ONLY-IN-L3");
    expect(await authFetch(rig, "/api/v1/artifacts/alpha/run-1/unknown")).toMatchObject({ status: 404 });
    expect((await authFetch(rig, "/api/v1/artifacts/alpha/%2e%2e/prompt")).status).toBeGreaterThanOrEqual(400);

    const outside = join(rig.root, "outside");
    write(outside, "prompt.md", "escaped");
    symlinkSync(outside, join(rig.stateHome, "runs", "alpha", "escape"));
    const symlink = await authFetch(rig, "/api/v1/artifacts/alpha/escape/prompt");
    expect(symlink.status).toBe(403);
    expect(await symlink.json()).toMatchObject({ error: "symlink_escape" });
  });

  it("orders SSE updates, replays on reconnect, and requests resync when the cursor expires", async () => {
    const rig = await startRig({ replayLimit: 1 });
    const firstAbort = new AbortController();
    const first = await fetch(`${rig.base}/api/v1/events?token=${encodeURIComponent(rig.started.token)}`, { signal: firstAbort.signal });
    expect(first.status).toBe(200);
    const firstReader = first.body!.getReader();
    const initial = await readEvent(firstReader, "snapshot");
    expect(initial.id).toBe("0");

    writeEnvelope(rig.stateHome, { status: "running", last_seen_at: "2026-07-12T11:59:59.000Z" });
    await rig.service.reconcileNow();
    const update1 = await readEvent(firstReader, "entity.upsert");
    expect(update1.id).toBe("1");
    expect(update1.data).toContain('"entity_id":"snapshot"');
    firstAbort.abort();

    const replayAbort = new AbortController();
    const replay = await fetch(`${rig.base}/api/v1/events?token=${encodeURIComponent(rig.started.token)}&cursor=0`, { signal: replayAbort.signal });
    const replayEvent = await readEvent(replay.body!.getReader(), "entity.upsert");
    expect(replayEvent.id).toBe("1");
    replayAbort.abort();

    writeEnvelope(rig.stateHome, { status: "completed", finished_at: "2026-07-12T12:01:00.000Z", wall_clock_ms: 61_000 });
    await rig.service.reconcileNow();
    const resyncAbort = new AbortController();
    const resync = await fetch(`${rig.base}/api/v1/events?token=${encodeURIComponent(rig.started.token)}&cursor=0`, { signal: resyncAbort.signal });
    const resyncEvent = await readEvent(resync.body!.getReader(), "resync");
    expect(resyncEvent.id).toBe("2");
    resyncAbort.abort();
  });

  it("surfaces torn/corrupt/finalization-lag evidence and observer shutdown does not touch a running envelope", async () => {
    const rig = await startRig();
    writeEnvelope(rig.stateHome, { status: "running", last_seen_at: "2026-07-12T11:00:00.000Z" });
    writeFileSync(join(rig.stateHome, "runs", "alpha", "run-1", "events.jsonl"), '{"event":"pass.started"}\n{"event":', "utf8");
    await rig.service.reconcileNow();
    let snapshot = rig.service.snapshot();
    expect(snapshot.passes[0]?.liveness).toBe("stalled");
    expect(snapshot.attention.some((item) => item.kind === "corrupt_run")).toBe(false); // torn trailing append is retried

    writeFileSync(join(rig.stateHome, "runs", "alpha", "run-1", "events.jsonl"), 'not-json\n{"event":"pass.started","trace_id":"trace-1","span_id":"implement","app":"alpha","pipeline":"build","pass":"implement","role":"builder","ts":"2026-07-12T11:00:00Z","severity":"info"}\n', "utf8");
    await rig.service.reconcileNow();
    snapshot = rig.service.snapshot();
    expect(snapshot.attention.some((item) => item.kind === "corrupt_run")).toBe(true);

    await rig.service.stop();
    await rig.started.close();
    const envelope = JSON.parse(readFileSync(join(rig.stateHome, "runs", "alpha", "run-1", "envelope.json"), "utf8")) as { status: string };
    expect(envelope.status).toBe("running");
  });

  it("recovers repaired envelopes and applies a late ledger settlement exactly once", async () => {
    const rig = await startRig();
    writeFileSync(join(rig.stateHome, "runs", "alpha", "run-1", "envelope.json"), "{torn", "utf8");
    await rig.service.reconcileNow();
    expect(rig.service.snapshot().attention.some((item) => item.kind === "corrupt_run")).toBe(true);

    writeEnvelope(rig.stateHome, {
      status: "completed",
      finished_at: "2026-07-12T12:01:00.000Z",
      wall_clock_ms: 61_000,
      usage: { tokens_in: 10, tokens_out: 5, cost_usd: 0.1, quality: "partial" },
    });
    await rig.service.reconcileNow();
    expect(rig.service.snapshot().passes).toHaveLength(1);
    expect(rig.service.snapshot().passes[0]?.usage).toMatchObject({ settled: false, quality: "partial" });

    write(rig.stateHome, "telemetry/2026-07-12.jsonl", `${JSON.stringify({
      at: "2026-07-12T12:01:01.000Z", role: "builder", runtime: "codex", model: "gpt-5.5", status: "completed",
      tokensIn: 12, tokensOut: 6, costUsd: 0.2, usageQuality: "estimated", subagentTurns: 0, wallClockMs: 61_000,
      escalations: 0, app: "alpha", runId: "run-1", traceId: "trace-1", pipeline: "build", pass: "implement", costEstimated: true,
    })}\n`);
    await rig.service.reconcileNow();
    expect(rig.service.snapshot().passes).toHaveLength(1);
    expect(rig.service.snapshot().passes[0]?.usage).toMatchObject({ settled: true, quality: "estimated", tokens_in: 12, cost_usd: 0.2 });
  });

  it("mints process-local capabilities that are invalid for another observer", async () => {
    const rig = await startRig();
    const second = await startObserveServer({ service: rig.service, stateHome: rig.stateHome, port: 0 });
    try {
      expect(second.token).not.toBe(rig.started.token);
      expect((await fetch(`http://127.0.0.1:${second.port}/healthz?token=${encodeURIComponent(rig.started.token)}`)).status).toBe(401);
      expect((await fetch(`http://127.0.0.1:${second.port}/healthz?token=${encodeURIComponent(second.token)}`)).status).toBe(200);
    } finally {
      await second.close();
    }
  });

  it("serves lazy Reports routes under the same capability without exposing L3 or writing exports", async () => {
    const rig = await startRig({ prompt: "REPORT-MUST-NOT-CONTAIN-L3" });
    expect(rig.reportService.projectionCount()).toBe(0);
    expect((await fetch(`${rig.base}/reports`)).status).toBe(401);
    const page = await authFetch(rig, "/reports");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Operon Reports");
    expect(rig.reportService.projectionCount()).toBe(0);
    write(rig.stateHome, "telemetry/2026-07-12.jsonl", `${JSON.stringify({ at: "2026-07-12T11:31:01.000Z", role: "builder", runtime: "codex", model: "gpt-5.5", status: "completed", tokensIn: 10, tokensOut: 5, costUsd: 0.1, usageQuality: "complete", subagentTurns: 0, wallClockMs: 60_000, escalations: 0, app: "alpha", runId: "run-1", traceId: "trace-1", pipeline: "build", pass: "implement" })}\n`);
    const summaryResponse = await authFetch(rig, "/api/v1/reports/summary?period=7d&refresh=1");
    expect(summaryResponse.status).toBe(200);
    expect(rig.reportService.projectionCount()).toBe(1);
    expect(summaryResponse.headers.get("cache-control")).toContain("no-store");
    const summary = await summaryResponse.json() as { headline: { provider_turns: number }; session_details: unknown[] };
    expect(summary.headline.provider_turns).toBe(1);
    expect(summary.session_details).toEqual([]);
    const sessions = await (await authFetch(rig, "/api/v1/reports/sessions?period=7d&limit=10")).json() as { items: Array<{ summary: { id: string } }> };
    expect(sessions.items[0]?.summary.id).toBe("trace:alpha:trace-1");
    const detail = await authFetch(rig, `/api/v1/reports/sessions/${encodeURIComponent("trace:alpha:trace-1")}?period=7d`);
    expect(detail.status).toBe(200);
    const html = await authFetch(rig, "/api/v1/reports/export.html?period=7d");
    expect(html.headers.get("content-disposition")).toContain("operon-report.html");
    expect(await html.text()).not.toContain("REPORT-MUST-NOT-CONTAIN-L3");
    const json = await authFetch(rig, "/api/v1/reports/export.json?period=7d&summary_only=1");
    expect((await json.json() as { summary_only: boolean }).summary_only).toBe(true);
    expect(existsSync(join(rig.stateHome, "operon-report.html"))).toBe(false);
    expect((await authFetch(rig, "/api/v1/reports/summary?period=bad")).status).toBe(400);
    expect((await authFetch(rig, "/api/v1/reports/summary?app=missing")).status).toBe(400);
    expect((await authFetch(rig, "/api/v1/reports/sessions/not-there?period=7d")).status).toBe(404);
    expect((await authFetch(rig, "/api/v1/reports/sessions?period=7d&cursor=bad")).status).toBe(400);
  });

  it("fails closed for app-scoped report service and asks paging clients to resync after source drift", async () => {
    const rig = await startRig({ reportAppScope: "alpha" });
    write(rig.stateHome, "telemetry/2026-07-12.jsonl", [
      { at: "2026-07-12T10:00:00.000Z", role: "builder", runtime: "codex", model: "m", status: "completed", tokensIn: 1, tokensOut: 1, costUsd: 0.1, usageQuality: "complete", subagentTurns: 0, wallClockMs: 1, escalations: 0, app: "alpha", runId: "orphan-a", pipeline: "build", pass: "a" },
      { at: "2026-07-12T10:01:00.000Z", role: "builder", runtime: "codex", model: "m", status: "completed", tokensIn: 1, tokensOut: 1, costUsd: 0.1, usageQuality: "complete", subagentTurns: 0, wallClockMs: 1, escalations: 0, app: "alpha", runId: "orphan-b", pipeline: "build", pass: "b" },
    ].map(JSON.stringify).join("\n") + "\n");
    expect((await authFetch(rig, "/api/v1/reports/summary?app=beta&period=7d")).status).toBe(403);
    const first = await (await authFetch(rig, "/api/v1/reports/sessions?period=7d&limit=1&refresh=1")).json() as { next_cursor: string };
    expect(first.next_cursor).toBeTruthy();
    writeFileSync(join(rig.stateHome, "telemetry", "2026-07-12.jsonl"), `${readFileSync(join(rig.stateHome, "telemetry", "2026-07-12.jsonl"), "utf8")}${JSON.stringify({ at: "2026-07-12T10:02:00.000Z", role: "builder", runtime: "codex", model: "m", status: "completed", tokensIn: 1, tokensOut: 1, costUsd: 0.1, usageQuality: "complete", subagentTurns: 0, wallClockMs: 1, escalations: 0, app: "alpha", runId: "orphan-c", pipeline: "build", pass: "c" })}\n`);
    expect((await authFetch(rig, `/api/v1/reports/sessions?period=7d&limit=1&cursor=${encodeURIComponent(first.next_cursor)}`)).status).toBe(409);
  });

  it("keeps the last GitHub projection while that source degrades, then recovers independently", async () => {
    const github = new FlakyGitHub();
    const rig = await startRig({ githubSource: github });
    expect(rig.service.snapshot().delivery[0]?.state).toBe("ready");

    github.failed = true;
    await rig.service.refreshGithubNow();
    expect(rig.service.snapshot().sources.find((source) => source.id === "github")?.status).toBe("unavailable");
    expect(rig.service.snapshot().delivery[0]?.state).toBe("ready");

    github.failed = false;
    github.labels = ["op:building"];
    await rig.service.refreshGithubNow();
    expect(rig.service.snapshot().sources.find((source) => source.id === "github")?.status).toBe("healthy");
    expect(rig.service.snapshot().delivery[0]?.state).toBe("building");
  });
});

interface Rig {
  root: string;
  stateHome: string;
  service: ObserveService;
  started: StartedObserveServer;
  base: string;
  cleanup: () => Promise<void>;
  reportService: ReportService;
}

async function startRig(options: { prompt?: string; replayLimit?: number; githubSource?: ObserveGitHubSource; reportAppScope?: string } = {}): Promise<Rig> {
  const root = mkdtempSync(join(tmpdir(), "operon-observe-server-"));
  const stateHome = join(root, "state");
  writeEnvelope(stateHome, { status: "completed", finished_at: "2026-07-12T11:31:00.000Z", wall_clock_ms: 60_000 });
  write(stateHome, "runs/alpha/run-1/events.jsonl", "");
  write(stateHome, "runs/alpha/run-1/brief.md", "Exact brief\n");
  write(stateHome, "runs/alpha/run-1/prompt.md", options.prompt ?? "Exact prompt\n");
  write(stateHome, "runs/alpha/run-1/output.md", "Exact output\n");
  write(stateHome, "runs/alpha/run-1/session.log", "activity only\n");
  const service = new ObserveService({
    orgName: "fixture-org",
    stateHome,
    appsFile: appsFile(),
    githubSource: options.githubSource ?? new FakeGitHub(),
    reconcileMs: 60_000,
    githubPollMs: 60_000,
    heartbeatMs: 60_000,
    replayLimit: options.replayLimit ?? 8,
    watchFiles: false,
    clock: () => new Date("2026-07-12T12:00:00.000Z"),
  });
  await service.start();
  const reportService = new ReportService({ orgName: "fixture-org", stateHome, appsFile: appsFile(), clock: () => new Date("2026-07-12T12:00:00.000Z"), ...(options.reportAppScope !== undefined ? { appScope: options.reportAppScope } : {}) });
  const started = await startObserveServer({
    service,
    stateHome,
    port: 0,
    reportService,
  });
  let closed = false;
  const cleanup = async (): Promise<void> => {
    if (closed) {
      rmSync(root, { recursive: true, force: true });
      return;
    }
    closed = true;
    await service.stop();
    if (started.server.listening) await started.close();
    rmSync(root, { recursive: true, force: true });
  };
  cleanups.push(cleanup);
  return { root, stateHome, service, started, base: `http://127.0.0.1:${started.port}`, cleanup, reportService };
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

class FakeGitHub implements ObserveGitHubSource {
  async read(_apps: AppsFile["apps"], now: Date): Promise<GitHubReadResult> {
    return {
      apps: [{ app: "alpha", repo: "owner/alpha", issues: [], pull_requests: [], observed_at: now.toISOString() }],
      health: { id: "github", status: "healthy", observed_at: now.toISOString(), last_success_at: now.toISOString(), detail: "fixture" },
    };
  }
}

class FlakyGitHub implements ObserveGitHubSource {
  failed = false;
  labels = ["op:ready"];

  async read(_apps: AppsFile["apps"], now: Date): Promise<GitHubReadResult> {
    if (this.failed) {
      return {
        apps: [{ app: "alpha", repo: "owner/alpha", issues: [], pull_requests: [], observed_at: now.toISOString(), error: "offline" }],
        health: { id: "github", status: "unavailable", observed_at: now.toISOString(), last_success_at: null, detail: "offline" },
      };
    }
    return {
      apps: [{
        app: "alpha", repo: "owner/alpha", observed_at: now.toISOString(), pull_requests: [],
        issues: [{ number: 1, title: "Issue", body: "", labels: [...this.labels], state: "OPEN" }],
      }],
      health: { id: "github", status: "healthy", observed_at: now.toISOString(), last_success_at: now.toISOString(), detail: "ok" },
    };
  }
}

function writeEnvelope(stateHome: string, patch: Record<string, unknown>): void {
  const path = join(stateHome, "runs", "alpha", "run-1", "envelope.json");
  let current: Record<string, unknown> = {};
  try { current = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; } catch { /* initial write */ }
  write(stateHome, "runs/alpha/run-1/envelope.json", `${JSON.stringify({
    schema_version: 1,
    run_id: "run-1",
    trace_id: "trace-1",
    app: "alpha",
    ticket: "#1",
    pipeline: "build",
    pass: "implement",
    role: "builder",
    runtime: "codex",
    model: "gpt-5.5",
    effort: "high",
    status: "completed",
    started_at: "2026-07-12T11:30:00.000Z",
    usage: { tokens_in: 10, tokens_out: 5, cost_usd: 0.1, quality: "complete" },
    previews: { output: "bounded preview" },
    refs: { events: "events.jsonl", brief: "brief.md", prompt: "prompt.md", output: "output.md", session_log: "session.log" },
    ...current,
    ...patch,
  }, null, 2)}\n`);
}

function write(root: string, relative: string, content: string): void {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function authFetch(rig: Rig, path: string): Promise<Response> {
  const separator = path.includes("?") ? "&" : "?";
  return fetch(`${rig.base}${path}${separator}token=${encodeURIComponent(rig.started.token)}`);
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>, name: string): Promise<{ id: string; data: string }> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const result = await reader.read();
    if (result.done) throw new Error(`SSE ended before ${name}`);
    buffer += decoder.decode(result.value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      if (block.includes(`event: ${name}`)) {
        return {
          id: /^id: (.+)$/m.exec(block)?.[1] ?? "",
          data: /^data: (.+)$/m.exec(block)?.[1] ?? "",
        };
      }
    }
  }
  throw new Error(`timed out waiting for SSE ${name}`);
}
