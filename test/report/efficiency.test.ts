import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executePipeline } from "../../src/loop/pipeline.js";
import {
  efficiencyEpisodeDir,
  finalizeEpisode,
  type AdmissionFactor,
  type AuthorizedPass,
} from "../../src/loop/efficiency.js";
import { buildReport } from "../../src/report/project.js";
import { renderReportHtml } from "../../src/report/render-html.js";
import { renderReportTerminal } from "../../src/report/render-terminal.js";
import type { AppsFile } from "../../src/org/apps.js";
import type { PipelineConfig } from "../../src/loop/pipelines.js";
import type { RoleConfig, Runtime, TurnResult } from "../../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";

const ROLE: RoleConfig = {
  name: "reviewer",
  runtime: "claude",
  model: "claude-test",
  effort: "high",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 5,
};
const PIPELINE: PipelineConfig = {
  name: "review",
  mechanical: false,
  passes: [{ id: "verify", role: ROLE.name, template: "review.md" }],
};
const FACTOR: AdmissionFactor = {
  kind: "evidence_quality",
  evidence: "independent verification is required",
  policy_rule: "independent_review",
};
const PASS: AuthorizedPass = {
  pipeline: "review",
  pass: "verify",
  role: ROLE.name,
  runtime: ROLE.runtime,
  model: ROLE.model,
  effort: ROLE.effort,
  factor_rules: [FACTOR.policy_rule],
};
const APPS: AppsFile = {
  org: { name: "fixture-org", maxConcurrentTurns: 1 },
  defaults: { budgetUsdMonth: 100 },
  apps: [{ name: "fixture", repo: "example/fixture", status: "live", budgetUsdMonth: 100, cadence: {} }],
};

describe("efficiency reporting", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("B-MET-02 and B-RPT-01 classify repeated fingerprints and expose identical report facts", async () => {
    home = makeOrgHome();
    const episodeId = "episode:report";
    await runReview(home.root, episodeId, "trace-1", new Date("2026-07-13T01:00:00.000Z"), completeResult());
    await runReview(home.root, episodeId, "trace-2", new Date("2026-07-13T01:01:00.000Z"), completeResult());
    await finalizeEpisode({
      root: home.root,
      episodeId,
      status: "completed",
      reason: "independent verification complete",
      now: new Date("2026-07-13T01:02:00.000Z"),
    });

    const report = await buildReport({
      orgName: APPS.org.name,
      stateHome: home.root,
      appsFile: APPS,
      query: { app: "fixture", period: "all" },
      now: new Date("2026-07-13T02:00:00.000Z"),
    });
    expect(report.efficiency.metrics).toMatchObject({
      terminal_integrity: { status: "valid", numerator: 1, denominator: 1, value: 1 },
      execution_step_terminal_integrity: { status: "valid", numerator: 2, denominator: 2, value: 1 },
      ledger_coverage: { status: "valid", numerator: 2, denominator: 2, value: 1 },
      productive_pass_ratio: { status: "valid", numerator: 1, denominator: 2, value: 0.5 },
    });
    expect(report.efficiency.repeated_work_cost_usd).toBeCloseTo(0.1, 10);
    expect(report.efficiency.episodes[0]).toMatchObject({
      elapsed_time_ms: 120_000,
      active_time_ms: 2,
      human_wait_ms: 119_998,
    });
    expect(report.efficiency.issues.repeated_provider_step_ids).toHaveLength(1);
    expect(report.efficiency.context_by_category.map((row) => row.category)).toEqual([
      "brief",
      "execution",
      "template",
    ]);
    const terminal = renderReportTerminal(report);
    const html = renderReportHtml(report);
    expect(terminal).toContain("ledger_coverage  2/2 · valid · 100.0%");
    expect(terminal).toContain("route quick -> quick -> quick");
    expect(terminal).toContain("repeated_work_cost_usd  $0.10");
    expect(html).toContain("Efficiency and invariant evidence");
    expect(html).toContain("2 / 2");
    expect(html).toContain("episode:report");
    expect(html).toContain("repeated_provider_step_ids");
    const embedded = JSON.parse(html.match(/<script id="report-data" type="application\/json">([^<]+)<\/script>/)?.[1] ?? "null") as typeof report;
    expect(embedded.efficiency).toEqual(report.efficiency);
  });

  it("B-MET-04 keeps partial/estimated usage out of an exact efficiency sample", async () => {
    home = makeOrgHome();
    const episodeId = "episode:partial";
    await runReview(
      home.root,
      episodeId,
      "trace-partial",
      new Date("2026-07-13T01:00:00.000Z"),
      completeResult({ quality: "partial", costEstimated: true, tokensIn: 0, tokensOut: 0, costUsd: 0 }),
    );
    await finalizeEpisode({
      root: home.root,
      episodeId,
      status: "completed",
      reason: "provider returned partial accounting",
      now: new Date("2026-07-13T01:01:00.000Z"),
    });
    const report = await buildReport({
      orgName: APPS.org.name,
      stateHome: home.root,
      appsFile: APPS,
      query: { app: "fixture", period: "all" },
      now: new Date("2026-07-13T02:00:00.000Z"),
    });
    // Token and cost totals stay null: nonqualifying usage must never enter an
    // exact efficiency sample. Repeated-work cost is a different question — the
    // episode has one durable provider step and it is not a repeat, so "no
    // repeated work" is proven evidence, not a missing measurement (#92).
    expect(report.efficiency.episodes[0]).toMatchObject({
      input_tokens: null,
      output_tokens: null,
      equivalent_cost_usd: null,
      repeated_work_cost_usd: 0,
      issues: ["nonqualifying_usage_quality"],
    });
    expect(report.efficiency.episodes[0]!.repeated_work.repeated_steps).toEqual([]);
    expect(report.efficiency.episodes[0]!.repeated_work.missing_inputs).toEqual([]);
    expect(report.efficiency.issues.partial_or_unavailable_provider_turn_ids).toHaveLength(1);
    expect(report.efficiency.repeated_work_cost_usd).toBe(0);
  });

  it("B-RPT-02 is byte-for-byte read-only and performs no implicit reconciliation", async () => {
    home = makeOrgHome();
    await runReview(home.root, "episode:readonly", "trace", new Date("2026-07-13T01:00:00.000Z"), completeResult());
    const before = await treeFingerprint(home.root);
    await buildReport({
      orgName: APPS.org.name,
      stateHome: home.root,
      appsFile: APPS,
      query: { period: "all" },
      now: new Date("2026-07-13T02:00:00.000Z"),
    });
    expect(await treeFingerprint(home.root)).toBe(before);
  });

  it("names corrupt, duplicated, symlinked, and invalidly referenced evidence", async () => {
    home = makeOrgHome();
    const episodeId = "episode:diagnostics";
    await runReview(
      home.root,
      episodeId,
      "trace-diagnostics",
      new Date("2026-07-13T01:00:00.000Z"),
      completeResult(),
    );
    const episodeDir = efficiencyEpisodeDir(home.root, episodeId);
    const stepsDir = join(episodeDir, "steps");
    const [stepFile] = (await readdir(stepsDir)).filter((file) => file.endsWith(".json"));
    await writeFile(join(stepsDir, "duplicate.json"), await readFile(join(stepsDir, stepFile!), "utf8"), "utf8");

    const corruptDir = join(home.root, "efficiency", "episodes", "corrupt-route");
    await mkdir(corruptDir, { recursive: true });
    await writeFile(join(corruptDir, "route.json"), "{not-json", "utf8");
    await symlink(join(home.root, "runs"), join(home.root, "efficiency", "episodes", "symlink-episode"));

    const [runId] = await readdir(join(home.root, "runs", "fixture"));
    const envelopePath = join(home.root, "runs", "fixture", runId!, "envelope.json");
    const envelope = JSON.parse(await readFile(envelopePath, "utf8")) as { refs: { context_manifest?: string } };
    envelope.refs.context_manifest = "../context-manifest.json";
    await writeFile(envelopePath, `${JSON.stringify(envelope)}\n`, "utf8");

    const report = await buildReport({
      orgName: APPS.org.name,
      stateHome: home.root,
      appsFile: APPS,
      query: { period: "all" },
      now: new Date("2026-07-13T02:00:00.000Z"),
    });
    expect(report.efficiency.issues.invalid_context_manifest_run_ids).toEqual([
      `fixture/${runId}`,
    ]);
    expect(report.efficiency.issues.duplicate_provider_turn_ids).toHaveLength(1);
    expect(report.efficiency.issues.duplicate_execution_step_ids).toHaveLength(1);
    expect(report.efficiency.issues.corrupt_evidence_files).toEqual(expect.arrayContaining([
      expect.stringContaining("corrupt-route/route.json"),
      expect.stringContaining("symlink-episode/invalid_or_symlinked_episode_entry"),
    ]));
    expect(report.efficiency.metrics.ledger_coverage.status).toBe("invalid_measurement");
  });
});

async function runReview(
  root: string,
  episodeId: string,
  traceId: string,
  at: Date,
  result: TurnResult,
): Promise<void> {
  const prompts = join(root, "prompts");
  await mkdir(prompts, { recursive: true });
  await writeFile(join(prompts, "review.md"), "Review independently.\n", "utf8");
  let call = 0;
  const runtime: Runtime = { kind: "claude", runTurn: async () => ({ ...result, session: { runtime: "claude", id: `session-${++call}` } }) };
  await executePipeline({
    pipeline: PIPELINE,
    selection: { tier: "quick" },
    roles: { reviewer: ROLE },
    runtimeFor: () => runtime,
    briefFor: () => "same commit and criteria",
    promptsDir: prompts,
    context: { taste: [], memoryExcerpts: [] },
    workdir: root,
    hooks: { gate: () => ({ allow: true }) },
    runlog: { root, app: "fixture", traceId },
    episode: {
      id: episodeId,
      route: "quick",
      policyVersion: "test/v1",
      factors: [FACTOR],
      authorizedPasses: [PASS],
      finalize: false,
    },
    clock: advancingClock(at),
  });
}

function completeResult(usage: Partial<TurnResult["usage"]> = {}): TurnResult {
  return {
    status: "completed",
    summary: "approved",
    artifacts: [{ kind: "review", ref: "commit:abc", summary: "independent approval" }],
    session: { runtime: "claude", id: "session" },
    usage: {
      tokensIn: 10,
      tokensOut: 2,
      costUsd: 0.1,
      subagentTurns: 0,
      wallClockMs: 100,
      quality: "complete",
      ...usage,
    },
    escalations: [],
  };
}

function advancingClock(start: Date): () => Date {
  let milliseconds = start.getTime();
  return () => new Date(milliseconds++);
}

async function treeFingerprint(root: string): Promise<string> {
  const hash = createHash("sha256");
  const walk = async (dir: string): Promise<void> => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        hash.update(relative(root, path));
        hash.update(await readFile(path));
      }
    }
  };
  await walk(root);
  return hash.digest("hex");
}
