import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdReport, parseReportArgs } from "../src/cli/report.js";
import { initOrgHome } from "../src/org/home.js";

const cleanups: string[] = [];
const DAY_MS = 24 * 60 * 60 * 1_000;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); while (cleanups.length) rmSync(cleanups.pop()!, { recursive: true, force: true }); });

describe("operon report CLI", () => {
  it("validates range/format arguments and --open", () => {
    expect(parseReportArgs(["--period", "7d", "--bucket", "day", "--json"]).query).toMatchObject({ period: "7d", bucket: "day" });
    expect(() => parseReportArgs(["--period", "quarter"])).toThrow("7d|30d|90d|1y|all");
    expect(() => parseReportArgs(["--open"])).toThrow("--open requires --html");
    expect(() => parseReportArgs(["--bogus"])).toThrow('unknown argument "--bogus"');
  });

  it("emits exhaustive stable JSON from a neutral home without mutating state", async () => {
    const rig = await fixture();
    const before = tree(rig.stateHome);
    const output = await capture(["--org-home", rig.orgHome, "--state-home", rig.stateHome, "--period", "7d", "--json"]);
    const report = JSON.parse(output) as Record<string, unknown>;
    expect(report).toMatchObject({ schema_version: 1, summary_only: false, scope: { kind: "org", app: null }, org: { name: "report-cli" } });
    expect((report["session_details"] as unknown[])).toHaveLength(1);
    expect(tree(rig.stateHome)).toEqual(before);
  });

  it("writes atomic portable HTML with strict CSP, escaped metadata, no L3, and exhaustive turn identity", async () => {
    const rig = await fixture();
    const target = join(rig.root, "out", "report.html");
    await capture(["--org-home", rig.orgHome, "--state-home", rig.stateHome, "--app", "alpha", "--period", "7d", "--html", target]);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(`${target}.tmp-${process.pid}`)).toBe(false);
    const html = readFileSync(target, "utf8");
    expect(html).toContain("Operon report");
    expect(html).toContain("Cross &lt;script&gt;window.__pwn=true&lt;/script&gt;");
    expect(html).toContain("model-&lt;img src=x&gt;");
    expect(html).not.toContain("SECRET-L3-PROMPT");
    expect(html).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(html).toMatch(/style-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(html).not.toContain("'unsafe-inline'");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain("@media print");
    expect(html).toContain("prefers-reduced-motion");
    expect((html.match(new RegExp(rig.inRangeLedgerId, "g")) ?? [])).toHaveLength(1);
  });

  it("summary-only is explicit in JSON and HTML", async () => {
    const rig = await fixture();
    const output = await capture(["--org-home", rig.orgHome, "--state-home", rig.stateHome, "--period", "7d", "--json", "--summary-only"]);
    const report = JSON.parse(output) as { summary_only: boolean; session_details: unknown[]; sessions: { items: unknown[] } };
    expect(report.summary_only).toBe(true);
    expect(report.session_details).toEqual([]);
    expect(report.sessions.items).toHaveLength(1);
  });

  it("keeps 7d windowing active across a UTC day boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2034-02-01T23:59:59.000Z"));
    const rig = await fixture();
    vi.setSystemTime(new Date("2034-02-02T00:00:01.000Z"));
    const output = await capture(["--org-home", rig.orgHome, "--state-home", rig.stateHome, "--period", "7d", "--json"]);
    const report = JSON.parse(output) as { session_details: unknown[] };
    const details = JSON.stringify(report.session_details);
    expect(report.session_details).toHaveLength(1);
    expect(details).toContain(rig.inRangeLedgerId);
    expect(details).not.toContain(rig.outOfRangeLedgerId);
  });

  it("rejects unknown apps and period/custom conflicts without a partial target", async () => {
    const rig = await fixture();
    const target = join(rig.root, "must-not-exist.html");
    await expect(capture(["--org-home", rig.orgHome, "--state-home", rig.stateHome, "--app", "missing", "--html", target])).rejects.toThrow("unknown registered app");
    expect(existsSync(target)).toBe(false);
    await expect(capture(["--org-home", rig.orgHome, "--state-home", rig.stateHome, "--period", "7d", "--since", "2026-07-01"])).rejects.toThrow("mutually exclusive");
  });
});

async function fixture(): Promise<{ root: string; orgHome: string; stateHome: string; inRangeLedgerId: string; outOfRangeLedgerId: string }> {
  const root = mkdtempSync(join(tmpdir(), "operon-report-cli-")); cleanups.push(root);
  const orgHome = join(root, "org"); const stateHome = join(root, "state");
  await initOrgHome({ target: orgHome, name: "report-cli", stateHome, homeDir: join(root, "home") });
  writeFileSync(join(orgHome, "apps.yaml"), `schema_version: 1\norg:\n  name: report-cli\n  max_concurrent_turns: 2\ndefaults:\n  budget_usd_month: 1000\napps:\n  alpha:\n    repo: owner/alpha\n    status: live\n    budget_usd_month: 100\n    cadence: {}\n    channels: {}\n`, "utf8");
  const { inRangeDay, outOfRangeDay } = fixtureDays();
  writeReportEvidence(stateHome, { day: inRangeDay, suffix: "1", model: "model-<img src=x>", objective: "Cross <script>window.__pwn=true</script>" });
  writeReportEvidence(stateHome, { day: outOfRangeDay, suffix: "out-of-range", model: "old-model", objective: "Outside the 7d window" });
  return { root, orgHome, stateHome, inRangeLedgerId: `ledger:${inRangeDay}:1`, outOfRangeLedgerId: `ledger:${outOfRangeDay}:1` };
}

function fixtureDays(now = new Date()): { inRangeDay: string; outOfRangeDay: string } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = (offset: number): string => new Date(today + offset * DAY_MS).toISOString().slice(0, 10);
  return { inRangeDay: day(-1), outOfRangeDay: day(-7) };
}

function writeReportEvidence(stateHome: string, evidence: { day: string; suffix: string; model: string; objective: string }): void {
  const runId = `run-${evidence.suffix}`; const traceId = `trace-${evidence.suffix}`; const taskId = `task-${evidence.suffix}`;
  write(stateHome, `telemetry/${evidence.day}.jsonl`, `${JSON.stringify({ at: `${evidence.day}T09:00:00.000Z`, role: "builder", runtime: "codex", model: evidence.model, status: "completed", tokensIn: 10, tokensOut: 2, costUsd: 0.2, usageQuality: "estimated", subagentTurns: 0, wallClockMs: 1000, escalations: 0, app: "alpha", runId, traceId, parentTaskId: taskId, pipeline: "build", pass: "implement", costEstimated: true })}\n`);
  write(stateHome, `runs/alpha/${runId}/envelope.json`, `${JSON.stringify({ schema_version: 1, run_id: runId, trace_id: traceId, parent_task_id: taskId, app: "alpha", pipeline: "build", pass: "implement", role: "builder", runtime: "codex", model: evidence.model, status: "completed", started_at: `${evidence.day}T08:00:00Z`, finished_at: `${evidence.day}T08:01:00Z`, usage: { tokens_in: 10, tokens_out: 2, cost_usd: 0.2, quality: "estimated", cost_estimated: true }, refs: { events: "events.jsonl", brief: "brief.md", prompt: "prompt.md", output: "output.md" } })}\n`);
  write(stateHome, `runs/alpha/${runId}/prompt.md`, "SECRET-L3-PROMPT");
  write(stateHome, `tasks/${taskId}/task.json`, `${JSON.stringify({ schemaVersion: 1, taskId, app: "alpha", objective: evidence.objective, promptRef: "prompt.md", promptSha256: "a".repeat(64), requiredStages: ["builder"], executionMode: "operon", fallbackEvents: [], status: "completed", startedAt: `${evidence.day}T08:00:00Z`, endedAt: `${evidence.day}T08:01:00Z`, refs: { tickets: [], traces: [traceId], branches: [], prs: [], reviews: [], deployments: [] } })}\n`);
  write(stateHome, `tasks/${taskId}/prompt.md`, "SECRET-L3-PROMPT");
}

async function capture(args: string[]): Promise<string> { const log = vi.spyOn(console, "log").mockImplementation(() => {}); try { await cmdReport(args); return log.mock.calls.map((call) => call.join(" ")).join("\n"); } finally { log.mockRestore(); } }
function write(root: string, relative: string, content: string): void { const path = join(root, relative); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content, "utf8"); }
function tree(root: string): string[] { const { readdirSync, statSync } = requireFs(); const out: string[] = []; const walk = (dir: string, prefix = "") => { if (!existsSync(dir)) return; for (const name of readdirSync(dir).sort()) { const path = join(dir, name); const rel = join(prefix, name); out.push(rel); if (statSync(path).isDirectory()) walk(path, rel); } }; walk(root); return out; }
function requireFs(): Pick<typeof import("node:fs"), "readdirSync" | "statSync"> { return { readdirSync: (path: string) => readDir(path), statSync: (path: string) => statPath(path) } as never; }
import { readdirSync as readDir, statSync as statPath } from "node:fs";
