// CF-INV-011 — the portable HTML report carries no secret and no L3: L2
// composition on a temp state home (HB-016, FLOOR).
//
// CORMIDIA-INV-011 adversarial seed (b) (validation-design/invariants.md):
// "secret in output → portable HTML report". B-12 contract §2: "portable
// HTML carries no L3, no external requests, hash-restricted CSP (INV-011)";
// journey J-15: no secret-pattern match crosses any export.
//
// Composition under test: the REAL report pipeline end to end — durable
// state written by the REAL writers (`startRun`/`updateEnvelope`/
// `finalizeRun`, `toRecord`+`recordTurn`), read back by REAL `buildReport`
// (src/report/project.ts → ledger-source/detail-source/sessions) and
// rendered by REAL `renderReportHtml` (src/report/render-html.ts). Seeds
// enter at every source: envelope free-text, ledger selection reason, the
// parent-task record (planted raw on disk — detail-source's read-time
// re-scrub is the guardrail for records written under an older pattern
// list), and verbatim L3 files that the report must never read at all.
//
// Layer: 2 (real temp home, real modules; no network, no tokens).

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { finalizeRun, startRun, updateEnvelope } from "../../../src/runtime/runlog/envelope.js";
import { runPaths } from "../../../src/runtime/runlog/paths.js";
import { recordTurn, toRecord } from "../../../src/runtime/telemetry.js";
import type { RoleConfig, TurnResult } from "../../../src/runtime/types.js";
import type { AppsFile } from "../../../src/org/apps.js";
import { buildReport } from "../../../src/report/project.js";
import { renderReportHtml } from "../../../src/report/render-html.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";
import { makeSyntheticSecret, type SyntheticSecret } from "../../fixtures/synthetic-secret.js";
import {
  detectSecretEgress,
  makeAllSeeds,
  SecretEgressViolation,
} from "../../unit/cf-inv-011/secret-egress-detector.js";

const APP = "cf-inv-011-app";
const RUN_ID = "20260731-120000-build-implement";
const TASK_ID = "task-cf-inv-011";
const NOW = new Date("2026-07-31T12:00:00.000Z");
const SETTLE_AT = new Date("2026-07-31T12:06:00.000Z");
const REPORT_NOW = new Date("2026-07-31T18:00:00.000Z");
/** Unique sentinel: present ONLY in L3 files; must never reach the report. */
const L3_MARKER = "L3-VERBATIM-MARKER-cf-inv-011-report-must-not-read";

function seedByKind(seeds: readonly SyntheticSecret[], kind: SyntheticSecret["kind"]): SyntheticSecret {
  const seed = seeds.find((candidate) => candidate.kind === kind);
  if (seed === undefined) throw new Error(`missing seed kind ${kind}`);
  return seed;
}

const BUILDER_ROLE: RoleConfig = {
  name: "builder",
  runtime: "claude",
  model: "claude-scripted-model",
  effort: "medium",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 5,
};

function appsFile(): AppsFile {
  return {
    org: { name: "cf-inv-011-org", maxConcurrentTurns: 2 },
    defaults: { budgetUsdMonth: 100 },
    apps: [
      {
        name: APP,
        repo: "cormidia-double/sandbox-report",
        status: "live",
        budgetUsdMonth: 100,
        cadence: {},
      },
    ],
  };
}

/** Seed the whole durable substrate the report reads. */
async function seedStateHome(state: TempStateHome, seeds: readonly SyntheticSecret[]): Promise<void> {
  const aws = seedByKind(seeds, "aws-access-key-id");
  const ghToken = seedByKind(seeds, "github-token");
  const sk = seedByKind(seeds, "sk-api-key");
  const slack = seedByKind(seeds, "slack-token");
  const npm = seedByKind(seeds, "npm-token");
  const jwt = seedByKind(seeds, "jwt");
  const pem = seedByKind(seeds, "pem-private-key");
  const generic = seedByKind(seeds, "generic-assignment");

  // Envelope through the real writers (write-time scrub).
  await startRun(
    state.stateHome,
    {
      runId: RUN_ID,
      traceId: "trace-cf-inv-011",
      parentTaskId: TASK_ID,
      app: APP,
      pipeline: "build",
      pass: "implement",
      role: "builder",
      runtime: "claude",
      model: "claude-scripted-model",
      selectionReason: `assigned because staging exports ${generic.value}`,
    },
    NOW,
  );
  await updateEnvelope(state.stateHome, APP, RUN_ID, {
    previews: { output: `output cites ${jwt.value}`, brief: `brief cites ${sk.value}` },
  });
  await finalizeRun(
    state.stateHome,
    APP,
    RUN_ID,
    { status: "completed", verdictSummary: `looks good apart from ${ghToken.value}`, reason: `note ${aws.value}` },
    SETTLE_AT,
  );

  // Verbatim L3 — the permitted boundary. The report must never read these.
  const paths = runPaths(state.stateHome, APP, RUN_ID);
  await writeFile(paths.output, `${L3_MARKER}\n${seeds.map((s) => s.value).join("\n")}\n`, "utf8");
  await writeFile(paths.brief, `${L3_MARKER}\n${pem.value}\n`, "utf8");
  await writeFile(paths.sessionLog, `${L3_MARKER}\n${slack.value}\n`, "utf8");

  // Parent task planted RAW on disk: records can predate the current pattern
  // list, so the report's read-time re-scrub (detail-source.ts) is the
  // guardrail this leg tests.
  await mkdir(join(state.stateHome, "tasks", TASK_ID), { recursive: true });
  await writeFile(
    join(state.stateHome, "tasks", TASK_ID, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      taskId: TASK_ID,
      app: APP,
      objective: `ship the connector configured via ${generic.value}`,
      completionCriteria: "connector suite green",
      promptRef: "prompt.md",
      promptSha256: "0".repeat(64),
      requiredStages: ["build"],
      executionMode: "cormidia_loop",
      fallbackEvents: [],
      status: "completed",
      startedAt: "2026-07-31T11:58:00.000Z",
      endedAt: "2026-07-31T12:07:00.000Z",
      resultSummary: `done; rotated ${npm.value}`,
      refs: { tickets: [], traces: [], branches: [], prs: [], reviews: [], deployments: [] },
    }),
    "utf8",
  );

  // Ledger row through the real derivation (toRecord scrubs the selection
  // reason) and the real append.
  const result: TurnResult = {
    status: "completed",
    summary: "implemented",
    artifacts: [],
    session: { runtime: "claude", id: "session-1" },
    usage: { tokensIn: 1000, tokensOut: 200, costUsd: 0.5, subagentTurns: 0, wallClockMs: 360_000 },
    escalations: [],
  };
  await recordTurn(
    state.stateHome,
    toRecord(BUILDER_ROLE, result, SETTLE_AT, {
      app: APP,
      runId: RUN_ID,
      providerTurnId: "ptid-cf-inv-011",
      parentTaskId: TASK_ID,
      pipeline: "build",
      pass: "implement",
      traceId: "trace-cf-inv-011",
      selectionReason: `assigned because staging exports ${generic.value}`,
    }),
  );
}

describe("CF-INV-011 — portable HTML report carries no secret and no L3 (L2, HB-016)", () => {
  let state: TempStateHome;

  afterEach(async () => {
    await state.cleanup();
  });

  it("the rendered HTML (including its embedded JSON data blob) is clean of every seeded kind and any canonical-pattern match", async () => {
    state = await makeTempStateHome({ name: "cf-inv-011-report" });
    const seeds = makeAllSeeds();
    await seedStateHome(state, seeds);
    await assertNonEmptyWalk(state.path("telemetry"), /\.jsonl$/); // the substrate materialized

    const report = await buildReport({
      orgName: "cf-inv-011-org",
      stateHome: state.stateHome,
      appsFile: appsFile(),
      now: REPORT_NOW,
    });
    const html = renderReportHtml(report);

    // Whole-document scan — markup, prose, and the embedded JSON blob alike.
    detectSecretEgress("portable report HTML", html, seeds);

    // Non-vacuous: the seeded session actually surfaced, with its scrubbed
    // objective (read-time re-scrub of the raw task record).
    expect(report.session_details.length).toBeGreaterThan(0);
    expect(html).toContain("[REDACTED:generic-assignment]");
  });

  it("verbatim L3 never reaches the report: the L3 sentinel is absent from snapshot and HTML", async () => {
    state = await makeTempStateHome({ name: "cf-inv-011-report-l3" });
    const seeds = makeAllSeeds();
    await seedStateHome(state, seeds);

    const report = await buildReport({
      orgName: "cf-inv-011-org",
      stateHome: state.stateHome,
      appsFile: appsFile(),
      now: REPORT_NOW,
    });
    expect(JSON.stringify(report)).not.toContain(L3_MARKER);
    expect(renderReportHtml(report)).not.toContain(L3_MARKER);
  });

  it("negative control: a report object carrying one leaked string (weakened pipeline) renders HTML the detector FIRES on", async () => {
    state = await makeTempStateHome({ name: "cf-inv-011-report-neg" });
    const seeds = makeAllSeeds();
    await seedStateHome(state, seeds);

    const report = await buildReport({
      orgName: "cf-inv-011-org",
      stateHome: state.stateHome,
      appsFile: appsFile(),
      now: REPORT_NOW,
    });
    // The bypass: what the pipeline would emit if one read path lost its
    // scrub. Test-side mutation only — never src.
    const leak = makeSyntheticSecret("github-token");
    report.quality.notices.push(`ledger note: ${leak.value}`);

    const html = renderReportHtml(report);
    expect(() => detectSecretEgress("weakened report HTML", html, [leak])).toThrow(
      SecretEgressViolation,
    );
    expect(() => detectSecretEgress("weakened report HTML", html, [leak])).toThrow(/github-token/);
  });
});
