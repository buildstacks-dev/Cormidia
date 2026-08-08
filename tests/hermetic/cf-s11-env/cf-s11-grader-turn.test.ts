// CF-S11-env / CF-B29-* (L2) — grading as a Cormidia-invoked turn.
//
// The mechanism is the point. INV-ACC-7a's adversarial seed (d) is "a provider
// SDK imported by the campaign runner for 'just the grading'", so grading goes
// through `cormidia run-role` like any other turn — spawned, audited, settled.
// The scripted binary double gives real spawn semantics with no tokens.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TurnAssignment } from "../../../src/runtime/types.js";
import { createCliDriver } from "../../campaign/acceptance/cli-driver.js";
import { composeAxisEvidenceSet, type EvidenceItem } from "../../campaign/acceptance/grader-envelope.js";
import type { AssignedAxisGrader } from "../../campaign/acceptance/grader-independence.js";
import { renderGraderPrompt, runGraderTurn } from "../../campaign/acceptance/grader-turn.js";
import { extractSealedKey } from "../../campaign/acceptance/sealed-key.js";
import {
  makeCormidiaBinaryDouble,
  type ScriptedCliResponse,
} from "../../fixtures/acceptance/cormidia-binary-double.js";
import { makeAcceptanceCampaignFixture } from "../../fixtures/acceptance/campaign-fixture.js";

const cleanups: Array<() => Promise<void>> = [];
const codexSol: TurnAssignment = { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" };

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const EVIDENCE: EvidenceItem[] = [
  { kind: "diff", ref: "diff", contents: "+ invoiceTotal uses the rate effective on the entry date\n" },
  { kind: "run-journal", ref: "run-journal", contents: "builder turn 1 completed\n" },
];

const RESOLUTION: AssignedAxisGrader = {
  axis: "O-1",
  status: "assigned",
  grader: { id: "gpt-5.6-sol-xhigh", assignment: codexSol },
  graderFamily: "openai",
  appliedDisjointnessFamilies: ["anthropic"],
  appliedReadTurnIds: ["build"],
};

async function harness(responses: ScriptedCliResponse[]) {
  const double = await makeCormidiaBinaryDouble(responses);
  const fixture = await makeAcceptanceCampaignFixture({ kinds: ["greenfield"] });
  cleanups.push(double.cleanup, fixture.cleanup);
  // A plain temp dir: the driver only needs a realpath-able checkout root, and
  // a temp git repo per test is needless CI contention.
  const checkout = await mkdtemp(join(tmpdir(), "cormidia-checkout-"));
  cleanups.push(async () => {
    await rm(checkout, { recursive: true, force: true });
  });
  await fixture.writeEvidence("diff.patch", "no plants here\n");
  const driver = await createCliDriver({
    cormidiaPath: double.cormidiaPath,
    cormidiaJobPath: double.cormidiaJobPath,
    checkoutRoot: checkout,
  });
  const scenario = fixture.scenario("greenfield");
  const key = extractSealedKey({
    scenarioId: scenario.id,
    scenarioKind: scenario.scenarioKind,
    scenarioMarkdown: scenario.markdown,
  });
  return { double, driver, fixture, key };
}

function graderTurnInput(bits: Awaited<ReturnType<typeof harness>>, axis = "O-1") {
  return {
    driver: bits.driver,
    scenarioId: "S-ACC-1",
    appName: "acc-1-timetracker",
    turnId: "turn-grade-1",
    resolution: { ...RESOLUTION, axis },
    evidence: composeAxisEvidenceSet(axis, EVIDENCE),
    rubricExcerpt: "O-1: the stated objective exists, builds from a clean clone, and starts.",
    keys: [bits.key],
    reachableRoots: [bits.fixture.evidenceDir],
    templateDir: join(bits.fixture.reportDir, "grader-templates"),
  };
}

describe("CF-S11-env the grader runs through cormidia run-role", () => {
  it("spawns fixed-mode run-role and records the independently admitted tuple", async () => {
    const bits = await harness([
      {
        whenArgvIncludes: "run-role",
        stdout:
          "preparing turn...\n" +
          JSON.stringify({
            axis: "O-1",
            score: 3,
            justification: "builds clean from a fresh clone",
            citations: ["diff"],
          }) +
          "\n",
      },
    ]);
    const row = await runGraderTurn(graderTurnInput(bits));

    expect(row.score).toBe(3);
    expect(row.citations).toEqual(["diff"]);
    expect(row.grader).toEqual(codexSol);
    expect(row.appliedDisjointnessFamilies).toEqual(["anthropic"]);

    const argv = (await bits.double.invocations())[0]?.argv ?? [];
    expect(argv[0]).toBe("run-role");
    expect(argv).toContain("acceptance-grader");
    expect(argv).not.toContain("--assignment");
  });

  it("writes the rendered template and hands run-role its path", async () => {
    const bits = await harness([
      {
        whenArgvIncludes: "run-role",
        stdout: `${JSON.stringify({ axis: "O-1", score: 2, justification: "starts", citations: ["diff"] })}\n`,
      },
    ]);
    await runGraderTurn(graderTurnInput(bits));
    const argv = (await bits.double.invocations())[0]?.argv ?? [];
    const templatePath = argv[argv.indexOf("--template") + 1] as string;
    const template = await readFile(templatePath, "utf8");
    expect(template).toContain("Acceptance grading — axis O-1");
    expect(template).toContain("Every citation must be one of: diff, run-journal");
  });

  it("O-5's prompt is adversarial by construction and says finding none must be justified", () => {
    const prompt = renderGraderPrompt(composeAxisEvidenceSet("O-5", EVIDENCE), "O-5: claim honesty.");
    expect(prompt).toContain("adversarial by construction");
    expect(prompt).toContain("Finding none is a VALID result");
    expect(renderGraderPrompt(composeAxisEvidenceSet("O-1", EVIDENCE), "O-1")).not.toContain("adversarial");
  });
});

describe("CF-S11-env a bad grader result is an outcome, a leak is a refusal", () => {
  it("negative control: a citation-less result becomes ungraded, never a retained number", async () => {
    const bits = await harness([
      {
        whenArgvIncludes: "run-role",
        stdout: `${JSON.stringify({ axis: "O-1", score: 3, justification: "looks fine", citations: [] })}\n`,
      },
    ]);
    const row = await runGraderTurn(graderTurnInput(bits));
    expect(row.score).toBe("ungraded");
    expect(row.ungradedReason).toBe("citation-missing");
    expect(row.justification).toBeNull();
  });

  it("negative control: a citation outside the read set becomes ungraded", async () => {
    const bits = await harness([
      {
        whenArgvIncludes: "run-role",
        stdout: `${JSON.stringify({ axis: "O-1", score: 3, justification: "see the report", citations: ["invented.md"] })}\n`,
      },
    ]);
    expect((await runGraderTurn(graderTurnInput(bits))).ungradedReason).toBe("artifact-not-in-read-set");
  });

  it("negative control: a non-zero run-role exit becomes ungraded rather than crashing the campaign", async () => {
    const bits = await harness([{ whenArgvIncludes: "run-role", exitCode: 1, stderr: "gate denied\n" }]);
    const row = await runGraderTurn(graderTurnInput(bits));
    expect(row.score).toBe("ungraded");
    expect(row.ungradedReason).toBe("malformed-result");
  });

  it("negative control: a leaked plant REFUSES the turn — no provider is ever spawned", async () => {
    const bits = await harness([{ whenArgvIncludes: "run-role", stdout: "{}\n" }]);
    const scenario = bits.fixture.scenario("greenfield");
    const leaked = [
      ...EVIDENCE,
      { kind: "run-journal" as const, ref: "leak", contents: scenario.plants.contradiction[0] ?? "" },
    ];
    await expect(
      runGraderTurn({ ...graderTurnInput(bits), evidence: composeAxisEvidenceSet("O-1", leaked) }),
    ).rejects.toThrow(/is reachable via assembly/);
    expect(await bits.double.invocations()).toEqual([]);
  });
});
