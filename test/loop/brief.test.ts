// Tests brief assembly in src/loop/brief.ts.
// Covers non-negotiable ticket/criteria preservation, spec excerpting, resolved
// finding and attempt summarization, active/gate material retention, stable
// output, and token estimation.
// Uses local markdown fixtures and inline inputs only; no network, auth, real
// org state, or wall-clock time is required.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assembleBrief,
  estimateTokens,
  type BriefInput,
} from "../../src/loop/brief.js";

const PRD = readFileSync(
  fileURLToPath(new URL("../fixtures/briefs/prd.md", import.meta.url)),
  "utf8",
);

const CRITERIA = [
  "- [ ] ingest covers all 50 states plus DC",
  "- [ ] a failing state pipeline never blocks the others",
  "- [ ] each record carries FIPS code and last-verified timestamp",
];

const TICKET = {
  title: "Issue #12 — US-states dataset extension: ingest all states",
  body: [
    "Goal: extend ingest to every US state per the PRD.",
    "",
    "Acceptance criteria:",
    ...CRITERIA,
  ].join("\n"),
};

function fullInput(): BriefInput {
  return {
    ticket: { ...TICKET },
    specs: [{ title: "prd.md", content: PRD }],
    contract: "**Files:** src/ingest.ts\n**Approach:** poll registry weekly.",
    findings: [
      {
        // Oldest, resolved, deliberately long: summarizing it must be the
        // FIRST reduction and must visibly shrink the brief.
        text:
          "testing/major src/ingest.ts:40 -- scheduler retry loop had no backoff and hammered the registry " +
          "endpoint on failure; fixed by exponential backoff with jitter capped at ten minutes per state " +
          "pipeline so a single flaky state cannot starve the shared worker pool " +
          "x".repeat(600),
        severity: "major",
        resolved: true,
      },
      { text: "style/minor src/ingest.ts:12 -- rename fetchAll", severity: "minor", resolved: true },
      {
        text: "architecture/critical src/ingest.ts:88 -- per-state failure isolation missing",
        severity: "critical",
        resolved: false,
      },
      { text: "testing/minor test/ingest.test.ts:5 -- no DC case", severity: "minor", resolved: false },
    ],
    attempts: [
      "Attempt one hit a registry schema mismatch and was reverted.\nDetails: " + "y".repeat(400),
      "Attempt two: schema adapter added; ingest green for 12 states.",
    ],
    maxAttempts: 3,
    memory: ["Lesson: state registries rate-limit aggressively; batch polls."],
    repo: "Test command: pnpm test. Build: pnpm build.",
  };
}

describe("assembleBrief", () => {
  it("ticket and acceptance criteria stay verbatim at any budget", () => {
    for (const budgetTokens of [50, 200, 100000]) {
      const out = assembleBrief(fullInput(), { budgetTokens });
      expect(out).toContain(TICKET.title);
      for (const criterion of CRITERIA) expect(out).toContain(criterion);
    }
  });

  it("spec excerpted by heading match when over budget, whole doc when it fits", () => {
    const roomy = assembleBrief(fullInput(), { budgetTokens: 100000 });
    expect(roomy).toContain("Billing integration"); // whole doc, unrelated section included
    expect(roomy).not.toContain("excerpted from");

    const tight = assembleBrief(fullInput(), { budgetTokens: 300 });
    expect(tight).toContain('excerpted from "prd.md" by heading match');
    // Matching sections survive (ticket says "US-states dataset", "ingest").
    expect(tight).toContain("## US-states dataset extension");
    expect(tight).toContain("registry weekly and diff against the last snapshot");
    // Non-matching section bodies are gone.
    expect(tight).not.toContain("metering service batches");
    expect(tight).not.toContain("WCAG 2.2 AA");
  });

  it("oldest resolved findings summarized first, active findings verbatim", () => {
    const input = fullInput();
    const fullTokens = estimateTokens(assembleBrief(input, { budgetTokens: 100000 }));
    // Summarizing the (long) oldest resolved finding alone frees enough.
    const out = assembleBrief(fullInput(), { budgetTokens: fullTokens - 80 });

    expect(out).toContain("- [resolved, summarized] testing/major src/ingest.ts:40");
    expect(out).not.toContain("xxxx"); // the long tail is gone
    // The newer resolved finding was NOT summarized (oldest went first).
    expect(out).toContain("- [resolved] style/minor src/ingest.ts:12 -- rename fetchAll");
    // Active findings verbatim, severity-sorted: critical before minor.
    const critical = out.indexOf("[active critical] architecture/critical");
    const minor = out.indexOf("[active minor] testing/minor");
    expect(critical).toBeGreaterThan(-1);
    expect(minor).toBeGreaterThan(critical);
  });

  it("criteria intact under a 200-token budget", () => {
    const out = assembleBrief(fullInput(), { budgetTokens: 200 });
    for (const criterion of CRITERIA) expect(out).toContain(criterion);
    // Every reduction was applied trying to fit…
    expect(out).toContain("[resolved, summarized]");
    expect(out).toContain("excerpted from");
    // …but never-summarize material is not negotiable.
    expect(out).toContain(TICKET.title);
  });

  it("history: latest attempt verbatim, older summarized, attempt N of M", () => {
    const input = fullInput();
    const fullTokens = estimateTokens(assembleBrief(input, { budgetTokens: 100000 }));
    // Force reductions past findings (2 resolved) into attempts.
    const out = assembleBrief(fullInput(), { budgetTokens: fullTokens - 300 });

    expect(out).toContain("attempt 1 of 3 (summarized):");
    expect(out).not.toContain("yyyy");
    expect(out).toContain("attempt 2 of 3:\nAttempt two: schema adapter added");
  });

  it("gate output stays verbatim even under a tight budget", () => {
    const input = fullInput();
    input.gateOutput = "FAIL test/ingest.test.ts\nAssertionError: expected 51 states, got 12";
    const out = assembleBrief(input, { budgetTokens: 100 });
    expect(out).toContain("Gate output (verbatim):");
    expect(out).toContain("AssertionError: expected 51 states, got 12");
  });

  it("byte-identical output for identical inputs", () => {
    const a = assembleBrief(fullInput(), { budgetTokens: 400 });
    const b = assembleBrief(fullInput(), { budgetTokens: 400 });
    expect(a).toBe(b);
    const roomyA = assembleBrief(fullInput(), { budgetTokens: 100000 });
    const roomyB = assembleBrief(fullInput(), { budgetTokens: 100000 });
    expect(roomyA).toBe(roomyB);
  });

  it("estimateTokens uses the len/4 heuristic", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});
