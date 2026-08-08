// CF-J22-APP / CF-J23-ADHOC (L2) — the two job journeys.
//
// J-22: a recurring APP-SCOPED job. Its evidence belongs to that app, in exactly
// one place, so the operator reading the app's history sees it alongside product
// work — and spend is attributed to the app rather than vanishing.
//
// J-23: a one-off UNSCOPED job in the active or default org. This is the
// convenience path, and its acceptance criteria are mostly about what is NOT
// required: no app, no registration, and no ticket/episode vocabulary in anything
// the operator has to read to act.

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseJobConfig } from "../../../src/jobs/config.js";
import { runJob } from "../../../src/jobs/runner.js";
import { readTurnRecords } from "../../../src/runtime/telemetry.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import {
  type JobWorkspace,
  makeJobWorkdir,
  operatorRole,
  ScriptedJobRuntime,
  tickingClock,
} from "../cf-b30/job-harness.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function scaffold(name: string): Promise<{ state: TempStateHome; work: JobWorkspace }> {
  const state = await makeTempStateHome({ name });
  const work = await makeJobWorkdir();
  cleanups.push(state.cleanup, work.cleanup);
  return { state, work };
}

const AUDIT = `
job: monthly-audit
app: billing-api
steps:
  - id: inventory
    objective: inventory the dependencies
    outputs:
      - path: outputs/inventory.json
        check: json
  - id: plan
    dependsOn: [inventory]
    objective: produce the upgrade plan
    outputs:
      - path: outputs/plan.md
        check: non_empty
`;

describe("CF-J22-APP (L2) recurring app-scoped job", () => {
  it("attributes every provider turn to the named app, never to the adhoc slot", async () => {
    const { state, work } = await scaffold("cf-j21");
    const runtime = new ScriptedJobRuntime(
      [{ writes: { "outputs/inventory.json": '{"direct":[]}' } }, { writes: { "outputs/plan.md": "plan" } }],
      work.workdir,
    );
    const result = await runJob({
      config: parseJobConfig(AUDIT, "job.yaml"),
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      runtimeFor: () => runtime,
      now: tickingClock(),
      env: {},
    });
    expect(result.status).toBe("completed");

    const rows = await readTurnRecords(state.stateHome);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.app === "billing-api")).toBe(true);
    expect(rows.some((row) => row.app === "adhoc")).toBe(false);
    // Attribution is what lets an operator see job spend next to product spend
    // for the same app instead of hunting a second ledger.
    expect(rows.every((row) => row.trigger === "manual")).toBe(true);
  });

  it("keeps the journal in exactly one canonical location, keyed by job id", async () => {
    const { state, work } = await scaffold("cf-j21-loc");
    const runtime = new ScriptedJobRuntime(
      [{ writes: { "outputs/inventory.json": "{}" } }, { writes: { "outputs/plan.md": "p" } }],
      work.workdir,
    );
    await runJob({
      config: parseJobConfig(AUDIT, "job.yaml"),
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      runtimeFor: () => runtime,
      now: tickingClock(),
      env: {},
    });

    // Exactly one job directory, and it is the job id — not the app, and not
    // both. Records discoverable in two places means `observe` has to search
    // both and the operator does not know where to look.
    const jobDirs = await readdir(join(state.stateHome, "jobs"));
    expect(jobDirs).toEqual(["monthly-audit"]);
    const journal = JSON.parse(
      await readFile(join(state.stateHome, "jobs", "monthly-audit", "journal.json"), "utf8"),
    ) as { app: string | null; job: string };
    expect(journal).toMatchObject({ job: "monthly-audit", app: "billing-api" });
  });

  it("re-running the recurring job next month resumes rather than repeating paid work", async () => {
    const { state, work } = await scaffold("cf-j21-rerun");
    const config = parseJobConfig(AUDIT, "job.yaml");
    const base = {
      config,
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      now: tickingClock(),
      env: {},
    };
    const first = new ScriptedJobRuntime(
      [{ writes: { "outputs/inventory.json": "{}" } }, { writes: { "outputs/plan.md": "p" } }],
      work.workdir,
    );
    expect((await runJob({ ...base, runtimeFor: () => first })).providerTurns).toBe(2);

    const second = await runJob({ ...base, runtimeFor: () => new ScriptedJobRuntime([], work.workdir) });
    expect(second).toMatchObject({ status: "completed", providerTurns: 0 });
    expect(await readTurnRecords(state.stateHome)).toHaveLength(2);
  });
});

describe("CF-J23-ADHOC (L2) one-off unscoped job in the default org", () => {
  const ONE_OFF = `
job: q3-strategy
steps:
  - id: framing
    objective: write the framing questions
    outputs:
      - path: outputs/framing.md
        check: non_empty
  - id: synthesize
    dependsOn: [framing]
    objective: synthesize the brief
    outputs:
      - path: outputs/brief.md
        check: non_empty
`;

  it("runs with no app registered and attributes spend to the adhoc slot", async () => {
    const { state, work } = await scaffold("cf-j22");
    const config = parseJobConfig(ONE_OFF, "job.yaml");
    expect(config.app).toBeNull();

    const runtime = new ScriptedJobRuntime(
      [{ writes: { "outputs/framing.md": "questions" } }, { writes: { "outputs/brief.md": "brief" } }],
      work.workdir,
    );
    const result = await runJob({
      config,
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      runtimeFor: () => runtime,
      now: tickingClock(),
      env: {},
    });
    expect(result).toMatchObject({ status: "completed", providerTurns: 2 });
    const rows = await readTurnRecords(state.stateHome);
    expect(rows.every((row) => row.app === "adhoc")).toBe(true);
  });

  it("keeps the deliverables in the operator's own working directory, not the state home", async () => {
    const { state, work } = await scaffold("cf-j22-artifacts");
    const runtime = new ScriptedJobRuntime(
      [{ writes: { "outputs/framing.md": "questions" } }, { writes: { "outputs/brief.md": "THE BRIEF" } }],
      work.workdir,
    );
    await runJob({
      config: parseJobConfig(ONE_OFF, "job.yaml"),
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      runtimeFor: () => runtime,
      now: tickingClock(),
      env: {},
    });
    // The artifacts are the job's product and the operator owns them.
    expect(await readFile(join(work.workdir, "outputs", "brief.md"), "utf8")).toBe("THE BRIEF");
    await expect(readFile(join(state.stateHome, "outputs", "brief.md"), "utf8")).rejects.toThrow();
  });

  it("survives the config being discarded after completion — artifacts and evidence remain", async () => {
    const { state, work } = await scaffold("cf-j22-discard");
    const runtime = new ScriptedJobRuntime(
      [{ writes: { "outputs/framing.md": "q" } }, { writes: { "outputs/brief.md": "b" } }],
      work.workdir,
    );
    await runJob({
      config: parseJobConfig(ONE_OFF, "job.yaml"),
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      runtimeFor: () => runtime,
      now: tickingClock(),
      env: {},
    });
    // "Ephemeral" describes the job definition, not its evidence: a one-off job
    // is thrown away and its record is still readable afterward.
    const journal = await readFile(join(state.stateHome, "jobs", "q3-strategy", "journal.json"), "utf8");
    expect(JSON.parse(journal)).toMatchObject({ job: "q3-strategy", app: null });
    expect(await readFile(join(work.workdir, "outputs", "brief.md"), "utf8")).toBe("b");
    expect(await readTurnRecords(state.stateHome)).toHaveLength(2);
  });

  it("failure messages are actionable without ticket, episode, pipeline, or app vocabulary", async () => {
    const { state, work } = await scaffold("cf-j22-messages");
    // The zero-Cormidia-knowledge path: an operator who has never seen a ticket
    // must be able to act on what a failed job tells them.
    const runtime = new ScriptedJobRuntime([{ writes: { "outputs/framing.md": "   " } }], work.workdir);
    const result = await runJob({
      config: parseJobConfig(ONE_OFF, "job.yaml"),
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      runtimeFor: () => runtime,
      now: tickingClock(),
      env: {},
    });
    expect(result.status).toBe("failed");

    const text = `${result.reasonCode ?? ""} ${result.summary ?? ""}`.toLowerCase();
    for (const jargon of ["ticket", "episode", "pipeline", "pass ", "verdict", "claim", "app "]) {
      expect(text, `leaked "${jargon.trim()}" into an operator-facing message`).not.toContain(jargon);
    }
    // And it does say the useful thing: which file, and what was wrong with it.
    expect(result.summary).toContain("outputs/framing.md");
    expect(result.summary).toContain("whitespace");
    expect(result.stoppedAtStepId).toBe("framing");
  });

  it("negative control: a drift refusal is also free of internal vocabulary", async () => {
    const { state, work } = await scaffold("cf-j22-drift-message");
    const base = {
      workdir: work.workdir,
      stateHome: state.stateHome,
      orgDir: state.stateHome,
      role: operatorRole(),
      now: tickingClock(),
      env: {},
    };
    const runtime = new ScriptedJobRuntime([{ writes: { "outputs/framing.md": "q" } }], work.workdir);
    await runJob({ ...base, config: parseJobConfig(ONE_OFF, "job.yaml"), runtimeFor: () => runtime }).catch(
      () => undefined,
    );
    await writeFile(join(work.workdir, "outputs", "framing.md"), "q", "utf8");

    const edited = parseJobConfig(ONE_OFF.replace("synthesize the brief", "synthesize a different brief"), "job.yaml");
    let caught: unknown;
    try {
      await runJob({ ...base, config: edited, runtimeFor: () => new ScriptedJobRuntime([], work.workdir) });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message.toLowerCase();
    for (const jargon of ["ticket", "episode", "pipeline", "verdict"]) {
      expect(message, `leaked "${jargon}"`).not.toContain(jargon);
    }
    // It names the drift and gives two concrete options.
    expect(message).toContain("config changed since its last run");
    expect(message).toContain("new job id");
  });
});
