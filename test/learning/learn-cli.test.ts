// Tests the `operon learn` subcommand (src/cli/learn.ts) end-to-end against
// a real initialized org home and populated state-home run records: report
// totals, human observation emit (flags and --file), show-by-id disposition
// tracing, episode inspection, and the M1 done-criterion that two submitted
// observations are each traceable by id. Non-TTY, so emit's interactive lane
// is exercised via its required-flags error. Temp dirs only; no network.

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cmdLearn } from "../../src/cli/learn.js";
import { initOrgHome } from "../../src/org/home.js";
import { runPaths } from "../../src/runtime/runlog/paths.js";

const ROOT = mkdtempSync(join(tmpdir(), "operon-learn-cli-"));
const ORG_HOME = join(ROOT, "org");
const STATE_HOME = join(ROOT, "state");
const RUN_ID = "20260711-060000-build-implement";
const EPISODE = "ep_alpha_ticket_0007";
const HOME_FLAGS = ["--org-home", ORG_HOME, "--state-home", STATE_HOME];

beforeAll(async () => {
  await initOrgHome({
    target: ORG_HOME,
    name: "learn-test",
    stateHome: STATE_HOME,
    homeDir: join(ROOT, "home"),
  });
  // Register one app so stage stamping and episode→app derivation resolve.
  writeFileSync(
    join(ORG_HOME, "apps.yaml"),
    [
      "schema_version: 1",
      "org: { name: learn-test, max_concurrent_turns: 2 }",
      "defaults: { budget_usd_month: 1000 }",
      "apps:",
      "  alpha:",
      "    repo: owner/alpha",
      "    status: live",
      "",
    ].join("\n"),
  );

  const rp = runPaths(STATE_HOME, "alpha", RUN_ID);
  await mkdir(rp.dir, { recursive: true });
  writeFileSync(
    rp.envelope,
    JSON.stringify({
      schema_version: 1,
      run_id: RUN_ID,
      trace_id: "turn-alpha-7",
      app: "alpha",
      ticket: "#7",
      pipeline: "build",
      pass: "implement",
      role: "builder",
      status: "completed",
      started_at: "2026-07-11T06:00:00.000Z",
      finished_at: "2026-07-11T06:10:00.000Z",
      gate_results: [
        { gate: "test", status: "passed", detail: "212 passing" },
        { gate: "lint", status: "failed", detail: "2 errors" },
      ],
      refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
    }) + "\n",
  );
  writeFileSync(
    rp.events,
    JSON.stringify({
      trace_id: "turn-alpha-7",
      span_id: "implement",
      app: "alpha",
      pipeline: "build",
      pass: "implement",
      role: "builder",
      ts: "2026-07-11T06:09:00.000Z",
      event: "verdict.recorded",
      severity: "info",
      detail: { kind: "build", complexity: "M" },
    }) + "\n",
  );
});

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

function captureLogs(): { logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    logs.push(parts.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    errors.push(parts.join(" "));
  });
  return { logs, errors };
}

afterEach(() => vi.restoreAllMocks());

describe("operon learn", () => {
  it("report captures runs and prints totals plus the episode section", async () => {
    const { logs } = captureLogs();
    expect(await cmdLearn(["report", ...HOME_FLAGS])).toBe(0);
    const text = logs.join("\n");
    expect(text).toContain("nothing activates yet");
    expect(text).toContain("gate_verdict: 2");
    expect(text).toContain("pass_verdict: 1");
    expect(text).toContain("episode_opened: 1");
    expect(text).toContain("Episodes: 1 (1 open, 0 closed)");
    // The ticket has no merge evidence yet: open, no outcome totals.
    expect(text).toContain(`${EPISODE} — build_ticket open; 4 event(s)`);
    expect(text).toContain("gate.lint: 1");
  });

  it("two human observations are each traceable by id (M1 done-criterion 3)", async () => {
    const first = captureLogs();
    expect(
      await cmdLearn([
        "emit",
        "--episode",
        EPISODE,
        "--observation",
        "Reviewer approved without exercising the built browser entry.",
        "--cause",
        "No browser smoke gate exists for UI apps.",
        "--intervention",
        "Add a browser smoke quality gate.",
        ...HOME_FLAGS,
      ]),
    ).toBe(0);
    const firstId = extractEventId(first.logs);
    vi.restoreAllMocks();

    const artifact = join(ROOT, "observation.json");
    writeFileSync(
      artifact,
      JSON.stringify({
        episode_id: EPISODE,
        observation: "Fix pass repeated the same failing lint remediation twice.",
        artifacts: ["runs/alpha/20260711-060000-build-implement"],
      }),
    );
    const second = captureLogs();
    expect(await cmdLearn(["emit", "--file", artifact, ...HOME_FLAGS])).toBe(0);
    const secondId = extractEventId(second.logs);
    expect(secondId).not.toBe(firstId);
    vi.restoreAllMocks();

    for (const id of [firstId, secondId]) {
      const { logs } = captureLogs();
      expect(await cmdLearn(["show", id, ...HOME_FLAGS])).toBe(0);
      const text = logs.join("\n");
      expect(text).toContain(`"event_id": "${id}"`);
      expect(text).toContain(`"episode_id": "${EPISODE}"`);
      expect(text).toContain('"emitter": "human"');
      expect(text).toContain("disposition: captured (M1)");
      vi.restoreAllMocks();
    }
  });

  it("keeps the three human-input fields separate on the stored event", async () => {
    const { logs } = captureLogs();
    await cmdLearn(["report", "--json", ...HOME_FLAGS]);
    const data = JSON.parse(logs.join("\n")) as {
      human_observations: string[];
      totals: { by_type: Array<[string, number]> };
    };
    expect(data.human_observations.length).toBe(2);

    vi.restoreAllMocks();
    const shown = captureLogs();
    await cmdLearn(["show", data.human_observations[0]!, ...HOME_FLAGS]);
    const event = JSON.parse(shown.logs.join("\n").split("\nstored at:")[0]!) as {
      payload: Record<string, unknown>;
    };
    expect(event.payload["observation"]).toContain("built browser entry");
    expect(event.payload["cause_hypothesis_text"]).toContain("browser smoke gate");
    expect(event.payload["suggested_intervention"]).toContain("quality gate");
  });

  it("inspect renders the record header, turns, gates, verdicts, and human observations", async () => {
    const { logs } = captureLogs();
    expect(await cmdLearn(["inspect", EPISODE, ...HOME_FLAGS])).toBe(0);
    const text = logs.join("\n");
    expect(text).toContain(`Episode ${EPISODE} — build_ticket, open`);
    expect(text).toContain("Source: github_issue alpha#7");
    expect(text).toContain("turn-alpha-7 — role builder; passes build/implement");
    expect(text).toContain("[pass] test");
    expect(text).toContain("[fail] lint");
    expect(text).toContain("build/implement: kind=build complexity=M");
    expect(text).toContain("Human observations:");
    expect(text).toContain("cause hypothesis: No browser smoke gate exists");
  });

  it("inspect renders outcome and replay capsule once the ticket closes; late outcomes fold in", async () => {
    // Merge evidence arrives via the loop's ticket claim state.
    mkdirSync(join(STATE_HOME, "tickets", "alpha"), { recursive: true });
    writeFileSync(
      join(STATE_HOME, "tickets", "alpha", "7.json"),
      JSON.stringify({ claims: 1, outcomes: ["claim 1: ended merged (PR #12)"] }, null, 2) + "\n",
    );

    const late = captureLogs();
    expect(
      await cmdLearn([
        "emit",
        "--late-outcome",
        "escaped_defect",
        "--ref",
        "alpha#9",
        "--episode",
        EPISODE,
        "--note",
        "regression a week later",
        ...HOME_FLAGS,
      ]),
    ).toBe(0);
    const lateText = late.logs.join("\n");
    expect(lateText).toContain("recorded late outcome evt_late_");
    vi.restoreAllMocks();

    const { logs } = captureLogs();
    expect(await cmdLearn(["inspect", EPISODE, ...HOME_FLAGS])).toBe(0);
    const text = logs.join("\n");
    expect(text).toContain(`Episode ${EPISODE} — build_ticket, closed`);
    expect(text).toContain("completed yes; merged yes; release disposition merged");
    expect(text).toContain("Artifacts: pull-request-12");
    expect(text).toContain("github_merge #12 (irreversible)");
    expect(text).toContain("Replay capsule: replay_alpha_ticket_0007 — non_replayable");
    expect(text).toContain("missing for trusted replay:");
    expect(text).toContain("seed_commit");
    expect(text).toContain("Late outcomes:");
    expect(text).toContain("escaped_defect alpha#9");
    expect(text).toContain("regression a week later");
  });

  it("show traces a late outcome to its episode disposition", async () => {
    // Self-sufficient: recreate the merge evidence and the (idempotent,
    // deterministic-id) late outcome so this test survives isolation.
    mkdirSync(join(STATE_HOME, "tickets", "alpha"), { recursive: true });
    writeFileSync(
      join(STATE_HOME, "tickets", "alpha", "7.json"),
      JSON.stringify({ claims: 1, outcomes: ["claim 1: ended merged (PR #12)"] }, null, 2) + "\n",
    );
    const setup = captureLogs();
    expect(
      await cmdLearn([
        "emit",
        "--late-outcome",
        "escaped_defect",
        "--ref",
        "alpha#9",
        "--episode",
        EPISODE,
        ...HOME_FLAGS,
      ]),
    ).toBe(0);
    vi.restoreAllMocks();
    void setup;

    const events = captureLogs();
    await cmdLearn(["report", "--json", ...HOME_FLAGS]);
    vi.restoreAllMocks();
    const data = JSON.parse(events.logs.join("\n")) as {
      episodes: Array<{ episode_id: string; status: string; cost_usd?: number }>;
    };
    const closed = data.episodes.find((episode) => episode.episode_id === EPISODE);
    expect(closed?.status).toBe("closed");

    const { logs } = captureLogs();
    expect(await cmdLearn(["show", "evt_late_" + lateOutcomeHash(), ...HOME_FLAGS])).toBe(0);
    expect(logs.join("\n")).toContain(`folded into ${EPISODE}'s record`);
  });

  it("emit rejects flags from the other lane instead of silently dropping them", async () => {
    await expect(
      cmdLearn([
        "emit",
        "--late-outcome",
        "escaped_defect",
        "--ref",
        "alpha#9",
        "--episode",
        EPISODE,
        "--observation",
        "this would be lost",
        ...HOME_FLAGS,
      ]),
    ).rejects.toThrow(/observation lane/);
    await expect(
      cmdLearn([
        "emit",
        "--episode",
        EPISODE,
        "--observation",
        "x",
        "--note",
        "this would be lost",
        ...HOME_FLAGS,
      ]),
    ).rejects.toThrow(/only apply with --late-outcome/);
  });

  it("inspect falls back to the event view for an episode with no projected record", async () => {
    const emitOut = captureLogs();
    expect(
      await cmdLearn([
        "emit",
        "--episode",
        "ep_alpha_ticket_0099",
        "--app",
        "alpha",
        "--observation",
        "observed outside any captured run",
        ...HOME_FLAGS,
      ]),
    ).toBe(0);
    vi.restoreAllMocks();
    void emitOut;

    const { logs } = captureLogs();
    expect(await cmdLearn(["inspect", "ep_alpha_ticket_0099", ...HOME_FLAGS])).toBe(0);
    const text = logs.join("\n");
    expect(text).toContain("no projected record");
    expect(text).toContain("observed outside any captured run");
  });

  it("inspect and show exit 1 with guidance for unknown ids", async () => {
    const inspectOut = captureLogs();
    expect(await cmdLearn(["inspect", "ep_alpha_ticket_9999", ...HOME_FLAGS])).toBe(1);
    expect(inspectOut.errors.join("\n")).toContain("operon learn report");
    vi.restoreAllMocks();

    const showOut = captureLogs();
    expect(await cmdLearn(["show", "cand_20260711_nope", ...HOME_FLAGS])).toBe(1);
    expect(showOut.errors.join("\n")).toContain("candidate storage lands with M4");
  });

  it("emit requires --episode/--observation outside a terminal and derives the app", async () => {
    await expect(cmdLearn(["emit", ...HOME_FLAGS])).rejects.toThrow(/outside an interactive/);
    await expect(
      cmdLearn([
        "emit",
        "--episode",
        "ep_unregistered_ticket_0001",
        "--observation",
        "x",
        ...HOME_FLAGS,
      ]),
    ).rejects.toThrow(/--app <name>/);
  });

  it("rejects an unknown subcommand with usage guidance", async () => {
    await expect(cmdLearn(["distill", ...HOME_FLAGS])).rejects.toThrow(/expected a subcommand/);
  });
});

describe("operon learn — M3 experiment substrate", () => {
  it("fixture drafts a sanitized eval fixture and validation must be independent", async () => {
    // Merge evidence (idempotent with the earlier tests) closes the episode
    // so the capsule carries an observed outcome to draft from.
    mkdirSync(join(STATE_HOME, "tickets", "alpha"), { recursive: true });
    writeFileSync(
      join(STATE_HOME, "tickets", "alpha", "7.json"),
      JSON.stringify({ claims: 1, outcomes: ["claim 1: ended merged (PR #12)"] }, null, 2) + "\n",
    );

    const draft = captureLogs();
    expect(
      await cmdLearn([
        "fixture",
        EPISODE,
        "--set",
        "roles/builder/standard-tickets",
        ...HOME_FLAGS,
      ]),
    ).toBe(0);
    const draftText = draft.logs.join("\n");
    expect(draftText).toContain(
      "drafted evals/roles/builder/standard-tickets/replay_alpha_ticket_0007 (by human-operator)",
    );
    expect(draftText).toContain("not yet trusted — missing: independent_validation");
    vi.restoreAllMocks();

    // The drafter cannot validate their own draft.
    await expect(
      cmdLearn([
        "fixture",
        EPISODE,
        "--set",
        "roles/builder/standard-tickets",
        "--validate",
        "--by",
        "human-operator",
        ...HOME_FLAGS,
      ]),
    ).rejects.toThrow(/must be independent/);

    const trust = captureLogs();
    expect(
      await cmdLearn([
        "fixture",
        EPISODE,
        "--set",
        "roles/builder/standard-tickets",
        "--validate",
        "--by",
        "reviewer-2",
        ...HOME_FLAGS,
      ]),
    ).toBe(0);
    expect(trust.logs.join("\n")).toContain("validated by reviewer-2");

    const fixtureOnDisk = JSON.parse(
      readFileSync(
        join(
          ORG_HOME,
          "learning",
          "evals",
          "roles",
          "builder",
          "standard-tickets",
          "replay_alpha_ticket_0007.json",
        ),
        "utf8",
      ),
    ) as { expected_outcome: { merged: boolean }; validated_by: string; sanitized: boolean };
    expect(fixtureOnDisk.expected_outcome.merged).toBe(true);
    expect(fixtureOnDisk.validated_by).toBe("reviewer-2");
    expect(fixtureOnDisk.sanitized).toBe(true);
  });

  it("show traces experiments, eval results, and interventions to disposition", async () => {
    const [{ declareExperiment }, { computeEvalResult, decideExperiment }, { writeInterventionRecord }] =
      await Promise.all([
        import("../../src/org/learning/experiment.js"),
        import("../../src/org/learning/eval-result.js"),
        import("../../src/org/learning/intervention.js"),
      ]);
    const { makeExperiment, makeIntervention } = await import("./helpers.js");

    const declared = await declareExperiment(makeExperiment(), { orgHome: ORG_HOME });
    const shownDeclared = captureLogs();
    expect(await cmdLearn(["show", declared.record.experiment_id, ...HOME_FLAGS])).toBe(0);
    expect(shownDeclared.logs.join("\n")).toContain("disposition: declared — no results yet");
    vi.restoreAllMocks();

    const result = computeEvalResult({
      experiment: declared.record,
      trials: [
        {
          pair: 1,
          control: { review_cycles: 3, merge_success: 1, cost_usd: 11 },
          treatment: { review_cycles: 1, merge_success: 1, cost_usd: 11 },
        },
      ],
      graderRef: "evals/roles/builder/standard-tickets/grader",
      costUsd: 0,
      decidedBy: "human-operator",
      decidedAt: "2026-07-11T14:00:00.000Z",
    });
    await decideExperiment(ORG_HOME, result);

    const shownDecided = captureLogs();
    expect(await cmdLearn(["show", declared.record.experiment_id, ...HOME_FLAGS])).toBe(0);
    expect(shownDecided.logs.join("\n")).toContain(`disposition: decided by ${result.eval_id}`);
    vi.restoreAllMocks();

    const shownEval = captureLogs();
    expect(await cmdLearn(["show", result.eval_id, ...HOME_FLAGS])).toBe(0);
    expect(shownEval.logs.join("\n")).toContain(
      "disposition: verdict improved for exp_builder-test-mapping_01",
    );
    vi.restoreAllMocks();

    await writeInterventionRecord(ORG_HOME, makeIntervention());
    const shownIntervention = captureLogs();
    expect(await cmdLearn(["show", "int_20260711_01JKLM", ...HOME_FLAGS])).toBe(0);
    expect(shownIntervention.logs.join("\n")).toContain(
      "disposition: published ticket; chain complete",
    );
  });

  it("report renders experiments with verdicts and interventions with unproven claims", async () => {
    const { writeInterventionRecord } = await import("../../src/org/learning/intervention.js");
    const { makeIntervention } = await import("./helpers.js");
    // An activated concept whose claim was authorized, never validated — the
    // report must say so (M3 done-criterion 2's reporting half).
    await writeInterventionRecord(
      ORG_HOME,
      makeIntervention({
        intervention_id: "int_20260711_02QRST",
        destination: "okf_concept",
        status: "active",
        publish: {
          kind: "bundle_version",
          ref: "org@2026.07.11-1",
          commit: null,
          published_at: "2026-07-11T15:00:00.000Z",
        },
        activation: { activated_at: "2026-07-11T15:00:00.000Z", claim: "authorized" },
      }),
    );

    const { logs } = captureLogs();
    expect(await cmdLearn(["report", ...HOME_FLAGS])).toBe(0);
    const text = logs.join("\n");
    expect(text).toContain("Experiments: 1");
    expect(text).toContain("exp_builder-test-mapping_01 — build_ticket, decided → eval_");
    expect(text).toContain("(improved)");
    expect(text).toContain("Interventions: 2");
    expect(text).toContain("int_20260711_01JKLM — ticket, published");
    expect(text).toContain(
      "int_20260711_02QRST — okf_concept, active; claim authorized (unproven); " +
        "chain INCOMPLETE (missing approval_ref, affected_episodes)",
    );

    vi.restoreAllMocks();
    const json = captureLogs();
    expect(await cmdLearn(["report", "--json", ...HOME_FLAGS])).toBe(0);
    const data = JSON.parse(json.logs.join("\n")) as {
      experiments: Array<{ experiment_id: string; verdict?: string }>;
      interventions: Array<{ intervention_id: string; claim_display?: string; chain_gaps: string[] }>;
    };
    expect(data.experiments[0]).toMatchObject({
      experiment_id: "exp_builder-test-mapping_01",
      verdict: "improved",
    });
    expect(
      data.interventions.find((i) => i.intervention_id === "int_20260711_02QRST"),
    ).toMatchObject({
      claim_display: "authorized (unproven)",
      chain_gaps: ["approval_ref", "affected_episodes"],
    });
  });
});

function extractEventId(logs: string[]): string {
  const match = /recorded (evt_[A-Za-z0-9_-]+) against/.exec(logs.join("\n"));
  if (match === null) throw new Error(`no event id in: ${logs.join("\n")}`);
  return match[1]!;
}

/** Deterministic late-outcome id: sha256(episode\nkind\nref) prefix, the
 *  same derivation recordLateOutcome uses. */
function lateOutcomeHash(): string {
  return createHash("sha256")
    .update(`${EPISODE}\nescaped_defect\nalpha#9`, "utf8")
    .digest("hex")
    .slice(0, 12);
}
