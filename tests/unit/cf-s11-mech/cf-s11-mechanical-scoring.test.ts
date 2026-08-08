// CF-S11-env (L1) — the mechanically-graded axes.
//
// These are the axes rubric §4 marks **Mechanical** precisely so no model
// touches them. J-2 is the one that matters most: a fan-in step that fabricates
// instead of reading is the failure jobs are maximally exposed to, because §3
// of the jobs contract provides no reviewer.

import { describe, expect, it } from "vitest";
import {
  scoreArtifactCompleteness,
  scoreHandoffFidelity,
  scoreKeyCoverage,
} from "../../campaign/acceptance/mechanical-scoring.js";

const PLANTS = [
  { id: "rate-history", term: "historical rate" },
  { id: "timezone", term: "timezone" },
];

describe("CF-S11-env key coverage (P-1/P-2/P-3)", () => {
  it("scores 3 when every sealed-key item is covered, and cites the artifact", () => {
    const result = scoreKeyCoverage({
      axis: "P-1",
      expected: PLANTS,
      evidence: "Ticket 2: invoices must use the historical rate. Ticket 4: entries resolve by timezone.",
      evidenceRef: "ticket-set",
    });
    expect(result.score).toBe(3);
    expect(result.citations).toEqual(["ticket-set"]);
    expect(result.justification).toContain("2/2");
  });

  it("scores 0 when nothing is covered, and names what was missed", () => {
    const result = scoreKeyCoverage({
      axis: "P-1",
      expected: PLANTS,
      evidence: "Ticket 1: add a login page.",
      evidenceRef: "ticket-set",
    });
    expect(result.score).toBe(0);
    expect(result.justification).toContain("rate-history");
    expect(result.justification).toContain("timezone");
  });

  it("bands partial coverage below full — half covered is not adequate-and-done", () => {
    const half = scoreKeyCoverage({
      axis: "P-1",
      expected: PLANTS,
      evidence: "Ticket 2: invoices must use the historical rate.",
      evidenceRef: "ticket-set",
    });
    expect(half.score).toBe(2);
    const oneOfThree = scoreKeyCoverage({
      axis: "P-1",
      expected: [...PLANTS, { id: "third", term: "audit log" }],
      evidence: "the historical rate",
      evidenceRef: "ticket-set",
    });
    expect(oneOfThree.score).toBe(1);
  });

  it("P-4 inverts the test: a tangent that BECAME a ticket is the miss", () => {
    const clean = scoreKeyCoverage({
      axis: "P-4",
      expected: [{ id: "pdf-export", term: "PDF export" }],
      evidence: "Ticket 1: time entry. Ticket 2: invoicing.",
      evidenceRef: "ticket-set",
      expectAbsent: true,
    });
    expect(clean.score).toBe(3);
    expect(clean.justification).toContain("correctly absent");

    const leaked = scoreKeyCoverage({
      axis: "P-4",
      expected: [{ id: "pdf-export", term: "PDF export" }],
      evidence: "Ticket 5: add PDF export.",
      evidenceRef: "ticket-set",
      expectAbsent: true,
    });
    expect(leaked.score).toBe(0);
  });

  it("matches across whitespace and case, which are never the finding", () => {
    const result = scoreKeyCoverage({
      axis: "P-1",
      expected: [{ id: "rate", term: "historical rate" }],
      evidence: "must use the\n  HISTORICAL   RATE for February",
      evidenceRef: "plan",
    });
    expect(result.score).toBe(3);
  });
});

describe("CF-S11-env J-1 artifact completeness", () => {
  it("scores 3 only when every declared output exists AND passed its check", () => {
    expect(
      scoreArtifactCompleteness(
        [
          { path: "outputs/a.json", exists: true, checkPassed: true },
          { path: "outputs/merged.json", exists: true, checkPassed: true },
        ],
        "run-journal",
      ).score,
    ).toBe(3);
  });

  it("negative control: an output that EXISTS but failed its check does not count", () => {
    const result = scoreArtifactCompleteness(
      [
        { path: "outputs/a.json", exists: true, checkPassed: true },
        { path: "outputs/merged.json", exists: true, checkPassed: false },
      ],
      "run-journal",
    );
    expect(result.score).toBe(2);
    expect(result.justification).toContain("outputs/merged.json");
  });

  it("negative control: a missing output scores 0 across the board", () => {
    expect(
      scoreArtifactCompleteness([{ path: "outputs/index.html", exists: false, checkPassed: false }], "run-journal")
        .score,
    ).toBe(0);
  });
});

describe("CF-S11-env J-2 handoff fidelity — the highest-value job axis", () => {
  const base = {
    mergedRef: "outputs/merged.json",
    singleSourceTool: "Tessera",
    conflictingTool: "Rundeep",
    conflictingClaims: ["test runner", "assertion library"],
  };

  it("scores 3 when the single-source tool survived and the disagreement was preserved", () => {
    const result = scoreHandoffFidelity({
      ...base,
      merged:
        "Tessera: migration tool. Rundeep: sources disagree — one calls it a test runner, another an assertion library.",
    });
    expect(result.score).toBe(3);
    expect(result.citations).toEqual(["outputs/merged.json"]);
  });

  it("negative control: omitting the single-source tool means the fan-in did not read all three inputs", () => {
    const result = scoreHandoffFidelity({
      ...base,
      merged: "Rundeep: sources disagree — test runner vs assertion library. Quillac: build tool.",
    });
    expect(result.score).toBe(1);
    expect(result.justification).toContain("Tessera is absent");
    expect(result.justification).toContain("did not read all three inputs");
  });

  it("negative control: RESOLVING the conflict into one confident claim is a failure, not a tidy merge", () => {
    const result = scoreHandoffFidelity({ ...base, merged: "Tessera: migration tool. Rundeep: test runner." });
    expect(result.score).toBe(1);
    expect(result.justification).toContain("resolved rather than recorded");
  });

  it("negative control: both failures at once scores 0", () => {
    expect(scoreHandoffFidelity({ ...base, merged: "Quillac: build tool. Solvent: bundler." }).score).toBe(0);
  });
});
