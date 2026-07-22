// Tests typed verdict parsing, validation, and retry logic in src/loop/verdicts.ts.
// Covers lenient review/build/contract formats, strict malformed-line failures,
// category/severity/complexity validation, one-shot reformat retry, structured
// schema validation, null optional fields, and TurnRequest schema compatibility.
// Uses inline verdict text and objects only; no filesystem state, network, auth,
// or wall-clock time is required.

import { describe, expect, it } from "vitest";
import type { TurnRequest } from "../src/runtime/types.js";
import {
  CONTRACT_COMPLEXITIES,
  FINDING_CATEGORIES,
  parseVerdict,
  parseWithRetry,
  validateVerdict,
  VERDICT_SCHEMAS,
  VerdictParseError,
  type BuildVerdict,
  type ContractVerdict,
  type ReviewVerdict,
} from "../src/loop/verdicts.js";

function expectOk<T extends { ok: boolean }>(
  result: T,
): asserts result is Extract<T, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected ok parse, got failure: ${(result as { reason?: string }).reason}`);
  }
}

function expectFail<T extends { ok: boolean }>(
  result: T,
): asserts result is Extract<T, { ok: false }> {
  expect(result.ok).toBe(false);
}

const REVIEW_AUDIT = [
  "## Review rationale",
  "The diff and named tests satisfy the ticket.",
  "## Evidence",
  "- acceptance criteria => parser regression test passes against the changed path",
  "## Not reviewed",
  "- None.",
].join("\n");

function approvedReviewText(verdict = "Verdict: approve", prefix = ""): string {
  return [prefix, verdict, REVIEW_AUDIT].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// review parser
// ---------------------------------------------------------------------------

describe("review verdict parser", () => {
  it("parses ASCII delimiters (-- and ->)", () => {
    const r = parseVerdict(
      "review",
      [
        "- security/major src/auth.ts:42 -- token logged on failure -> redact before logging",
        "Verdict: findings",
      ].join("\n"),
    );
    expectOk(r);
    expect(r.verdict.findings).toEqual([
      {
        category: "security",
        severity: "major",
        location: "src/auth.ts:42",
        description: "token logged on failure",
        action: "redact before logging",
      },
    ]);
    expect(r.verdict.verdict).toBe("findings");
  });

  it("parses unicode delimiters (— and →)", () => {
    const r = parseVerdict(
      "review",
      [
        "- architecture/minor src/loop/brief.ts:10 — duplicated budget rule → extract the shared helper",
        "Verdict: findings",
      ].join("\n"),
    );
    expectOk(r);
    expect(r.verdict.findings[0]).toMatchObject({
      category: "architecture",
      severity: "minor",
      location: "src/loop/brief.ts:10",
      description: "duplicated budget rule",
      action: "extract the shared helper",
    });
  });

  it("parses mixed delimiters (— with ->)", () => {
    const r = parseVerdict(
      "review",
      ["- testing/major test/a.test.ts:5 — missing negative case -> add a rejection test", "Verdict: findings"].join(
        "\n",
      ),
    );
    expectOk(r);
    expect(r.verdict.findings).toHaveLength(1);
  });

  it("normalizes category and severity case", () => {
    const r = parseVerdict(
      "review",
      ["- Security/MAJOR src/a.ts:1 -- x -> y", "Verdict: findings"].join("\n"),
    );
    expectOk(r);
    expect(r.verdict.findings[0]).toMatchObject({ category: "security", severity: "major" });
  });

  it("approve with no findings parses", () => {
    const r = parseVerdict("review", approvedReviewText("Verdict: approve", "All criteria hold."));
    expectOk(r);
    expect(r.verdict).toMatchObject({
      verdict: "approve",
      findings: [],
      review: {
        rationale: "The diff and named tests satisfy the ticket.",
        evidence: [{
          claim: "acceptance criteria",
          evidence: "parser regression test passes against the changed path",
        }],
        notReviewed: [],
      },
    });
  });

  it("accepts backticked verdict values (the templates' own typesetting)", () => {
    const r = parseVerdict("review", approvedReviewText("Verdict: `approve`"));
    expectOk(r);
    expect(r.verdict.verdict).toBe("approve");
  });

  it("accepts the predecessor's three formats plus the bare line", () => {
    for (const text of [
      "## Verdict\napprove",
      "## Verdict: approve",
      "**Verdict:** approve",
      "Verdict: approve",
    ]) {
      const r = parseVerdict("review", approvedReviewText(text));
      expectOk(r);
      expect(r.verdict.verdict).toBe("approve");
    }
  });

  it("prose bullets with slashes are not findings", () => {
    const r = parseVerdict(
      "review",
      approvedReviewText(
        "Verdict: approve",
        ["- src/loop/verdicts.ts looks fine", "- docs/loop.md matches"].join("\n"),
      ),
    );
    expectOk(r);
    expect(r.verdict).toMatchObject({ verdict: "approve", findings: [] });
  });

  it("rejects an unexplained approval with no auditable evidence", () => {
    const r = parseVerdict("review", "Verdict: approve");
    expectFail(r);
    expect(r.reason).toContain("review audit incomplete");
  });

  it("perf category is rejected with redirect guidance (M2.2 decision: no perf category)", () => {
    expect(FINDING_CATEGORIES).not.toContain("perf");
    const r = parseVerdict(
      "review",
      ["- perf/major src/db.ts:9 -- table scan per request -> add an index", "Verdict: findings"].join("\n"),
    );
    expectFail(r);
    expect(r.reason).toContain('unknown category "perf"');
    expect(r.reason).toContain("architecture");
    expect(r.reason).toContain("prompts/review/perf.md");
  });

  it("unknown category returns a typed failure naming the allowed set", () => {
    const r = parseVerdict(
      "review",
      ["- vibes/major src/a.ts:1 -- x -> y", "Verdict: findings"].join("\n"),
    );
    expectFail(r);
    expect(r.reason).toContain('unknown category "vibes"');
    expect(r.reason).toContain("architecture, testing, security, style, scope");
  });

  it("unknown severity returns a typed failure", () => {
    const r = parseVerdict(
      "review",
      ["- security/high src/a.ts:1 -- x -> y", "Verdict: findings"].join("\n"),
    );
    expectFail(r);
    expect(r.reason).toContain('unknown severity "high"');
  });

  it("finding-like malformed line fails loudly instead of silently dropping", () => {
    // Known severity after the slash, but no action arrow — a near-miss the
    // predecessor would have silently dropped.
    const r = parseVerdict(
      "review",
      ["- security/major src/a.ts:1 -- token logged", "Verdict: findings"].join("\n"),
    );
    expectFail(r);
    expect(r.reason).toContain("malformed finding line");
  });

  it("approve with findings present is a typed failure", () => {
    const r = parseVerdict(
      "review",
      ["- style/minor src/a.ts:1 -- x -> y", "Verdict: approve"].join("\n"),
    );
    expectFail(r);
    expect(r.reason).toContain("approve");
  });

  it("findings verdict with no parseable findings is a typed failure", () => {
    const r = parseVerdict("review", "Some prose about problems.\n\nVerdict: findings");
    expectFail(r);
    expect(r.reason).toContain("no finding lines parsed");
  });

  it("missing verdict line returns a typed marker, no throw", () => {
    const r = parseVerdict("review", "- security/major src/a.ts:1 -- x -> y");
    expectFail(r);
    expect(r.kind).toBe("review");
    expect(r.reason).toContain("no verdict found");
  });
});

// ---------------------------------------------------------------------------
// build parser — three status formats (predecessor parity) + the bare line
// ---------------------------------------------------------------------------

describe("build verdict parser", () => {
  it("parses `## Status` with the value on the next line", () => {
    const r = parseVerdict("build", "## Status\ndone");
    expectOk(r);
    expect(r.verdict).toEqual({ status: "done" });
  });

  it("parses `## Status` with a blank line before the value", () => {
    const r = parseVerdict("build", "## Status\n\ndone");
    expectOk(r);
    expect(r.verdict.status).toBe("done");
  });

  it("parses inline `## Status: done`", () => {
    const r = parseVerdict("build", "## Status: done");
    expectOk(r);
    expect(r.verdict.status).toBe("done");
  });

  it("parses bold `**Status:** done`", () => {
    const r = parseVerdict("build", "Suite green.\n\n**Status:** done");
    expectOk(r);
    expect(r.verdict.status).toBe("done");
  });

  it("parses a bare `Verdict: done` line (the templates' own phrasing)", () => {
    const r = parseVerdict("build", "Full suite exit 0.\n\nVerdict: done");
    expectOk(r);
    expect(r.verdict.status).toBe("done");
  });

  it("captures fix-pass resolution lines: fixed and rebutted, unicode dash tolerated", () => {
    const r = parseVerdict(
      "build",
      [
        "- fixed src/a.ts:12 -- commit abc1234, regression in test/a.test.ts",
        "- rebutted ci.yml:4 — documented behavior, see docs/deploy.md",
        "",
        "Verdict: done",
      ].join("\n"),
    );
    expectOk(r);
    expect(r.verdict.resolutions).toEqual([
      { outcome: "fixed", location: "src/a.ts:12", note: "commit abc1234, regression in test/a.test.ts" },
      { outcome: "rebutted", location: "ci.yml:4", note: "documented behavior, see docs/deploy.md" },
    ]);
  });

  it("a verdict without resolution lines carries no resolutions key (legacy outputs)", () => {
    const r = parseVerdict("build", "Verdict: done");
    expectOk(r);
    expect("resolutions" in r.verdict).toBe(false);
  });

  it("captures a full four-part blocked entry verbatim, multi-line error included", () => {
    const text = [
      "Status: blocked",
      "",
      "**Error:**",
      "FAIL test/a.test.ts",
      "  expected 1 to be 2",
      "**Attempted:** pinned the fixture clock",
      "**Result:** same failure",
      "**Assessment:** criterion contradicts the fixture design; needs Planner rework",
    ].join("\n");
    const r = parseVerdict("build", text);
    expectOk(r);
    expect(r.verdict.status).toBe("blocked");
    expect(r.verdict.blockedEntry).toEqual({
      error: "FAIL test/a.test.ts\n  expected 1 to be 2",
      attempted: "pinned the fixture clock",
      result: "same failure",
      assessment: "criterion contradicts the fixture design; needs Planner rework",
    });
  });

  it("blocked without any entry parses — demanding evidence is caller policy", () => {
    const r = parseVerdict("build", "**Status:** blocked");
    expectOk(r);
    expect(r.verdict).toEqual({ status: "blocked" });
  });

  it("blocked with a partial entry fails naming the missing parts", () => {
    const r = parseVerdict(
      "build",
      ["Status: blocked", "**Error:** it broke", "**Attempted:** a fix"].join("\n"),
    );
    expectFail(r);
    expect(r.reason).toContain("**Result:**");
    expect(r.reason).toContain("**Assessment:**");
  });

  it("unknown status value fails with the allowed set", () => {
    const r = parseVerdict("build", "Status: shipped");
    expectFail(r);
    expect(r.reason).toContain('status "shipped" not recognized');
    expect(r.reason).toContain("done | blocked");
  });

  it("missing status returns a typed marker, no throw", () => {
    const r = parseVerdict("build", "I finished everything and it works great.");
    expectFail(r);
    expect(r.kind).toBe("build");
    expect(r.reason).toContain("no status found");
  });
});

// ---------------------------------------------------------------------------
// contract parser
// ---------------------------------------------------------------------------

const TEMPLATE_CONTRACT = [
  "## Implementation contract",
  "",
  "**Files:**",
  "- src/loop/verdicts.ts",
  "- test/verdicts.test.ts",
  "**Approach:** Add the lenient parser mirroring the predecessor grammar.",
  "**Tests:**",
  "- AC1 -> parses ASCII delimiters; retry once",
  "**Risks:** Tests: 12 passed lines inside sections must not split them.",
  "**Complexity:** low",
].join("\n");

describe("contract verdict parser", () => {
  it("parses the template-shaped contract", () => {
    const r = parseVerdict("contract", TEMPLATE_CONTRACT);
    expectOk(r);
    expect(r.verdict.files).toEqual(["src/loop/verdicts.ts", "test/verdicts.test.ts"]);
    expect(r.verdict.approach).toContain("lenient parser");
    expect(r.verdict.tests).toEqual([
      { criterionId: "AC1", tests: ["parses ASCII delimiters", "retry once"] },
    ]);
    expect(r.verdict.risks).toContain("must not split");
    expect(r.verdict.complexity).toBe("low");
  });

  it("accepts heading-form sections", () => {
    const text = [
      "## Files",
      "src/a.ts",
      "## Approach",
      "Do the thing.",
      "## Tests",
      "AC1 → named test",
      "## Risks",
      "none",
      "## Complexity",
      "Medium",
    ].join("\n");
    const r = parseVerdict("contract", text);
    expectOk(r);
    expect(r.verdict.files).toEqual(["src/a.ts"]);
    expect(r.verdict.complexity).toBe("medium");
  });

  it("missing sections fail, naming each", () => {
    const r = parseVerdict("contract", "**Files:**\n- src/a.ts\n**Complexity:** low");
    expectFail(r);
    expect(r.reason).toContain("Approach");
    expect(r.reason).toContain("Tests");
    expect(r.reason).toContain("Risks");
  });

  it("an empty files section fails", () => {
    const text = TEMPLATE_CONTRACT.replace(
      "- src/loop/verdicts.ts\n- test/verdicts.test.ts\n",
      "",
    );
    const r = parseVerdict("contract", text);
    expectFail(r);
    // With no files listed, the Files section is empty → reported missing.
    expect(r.reason).toMatch(/Files/);
  });

  it("unknown complexity fails with the allowed set", () => {
    const r = parseVerdict("contract", TEMPLATE_CONTRACT.replace("**Complexity:** low", "**Complexity:** gnarly"));
    expectFail(r);
    expect(r.reason).toContain("gnarly");
    expect(r.reason).toContain(CONTRACT_COMPLEXITIES.join(" | "));
  });

  it("rejects duplicate criterion ids and mappings without named tests", () => {
    const duplicate = TEMPLATE_CONTRACT.replace(
      "- AC1 -> parses ASCII delimiters; retry once",
      "- AC1 -> first test\n- AC1 -> second test",
    );
    expectFail(parseVerdict("contract", duplicate));
    expectFail(validateVerdict("contract", {
      files: ["src/a.ts"],
      approach: "x",
      tests: [{ criterionId: "AC1", tests: [""] }],
      risks: "none",
      complexity: "low",
    }));
  });
});

// ---------------------------------------------------------------------------
// parseWithRetry — exactly one reformat, then loud typed failure
// ---------------------------------------------------------------------------

describe("parseWithRetry", () => {
  it("returns the verdict without calling reformat when the first parse succeeds", async () => {
    const calls: string[] = [];
    const verdict = await parseWithRetry("build", "Status: done", (reason) => {
      calls.push(reason);
      return "unused";
    });
    expect(verdict).toEqual({ status: "done" });
    expect(calls).toHaveLength(0);
  });

  it("retries exactly once, passing the failure reason, and returns the reformatted verdict", async () => {
    const calls: string[] = [];
    const verdict = await parseWithRetry("review", "looks good to me!", (reason) => {
      calls.push(reason);
      return approvedReviewText();
    });
    expect(verdict).toMatchObject({ verdict: "approve", findings: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("no verdict found");
  });

  it("fails loudly with VerdictParseError after the single retry", async () => {
    const calls: string[] = [];
    const attempt = parseWithRetry("build", "all good", (reason) => {
      calls.push(reason);
      return "still prose";
    });
    await expect(attempt).rejects.toThrow(VerdictParseError);
    await expect(attempt).rejects.toThrow(/build verdict unparseable after 2 attempt/);
    expect(calls).toHaveLength(1);
  });

  it("the error carries kind and both attempts verbatim", async () => {
    const err = await parseWithRetry("review", "first text", () => "second text").catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(VerdictParseError);
    const vpe = err as VerdictParseError;
    expect(vpe.name).toBe("VerdictParseError");
    expect(vpe.kind).toBe("review");
    expect(vpe.attempts.map((a) => a.text)).toEqual(["first text", "second text"]);
    expect(vpe.attempts[0]!.reason).toContain("no verdict found");
  });
});

// ---------------------------------------------------------------------------
// schemas — self-describing shapes + the same validation both transports use
// ---------------------------------------------------------------------------

describe("verdict schemas", () => {
  const contractSample: ContractVerdict = {
    files: ["src/a.ts"],
    approach: "Small change.",
    tests: [{ criterionId: "AC1", tests: ["criterion parser test"] }],
    risks: "none",
    complexity: "low",
  };
  const buildDone: BuildVerdict = { status: "done" };
  const buildBlocked: BuildVerdict = {
    status: "blocked",
    blockedEntry: { error: "FAIL", attempted: "a fix", result: "same", assessment: "spec bug" },
  };
  const reviewSample: ReviewVerdict = {
    verdict: "findings",
    findings: [
      {
        category: "security",
        severity: "critical",
        location: "src/auth.ts:1",
        description: "x",
        action: "y",
      },
    ],
    review: {
      rationale: "The changed authentication path leaks a token.",
      evidence: [{ claim: "failure logging", evidence: "src/auth.ts:1 emits the token" }],
      notReviewed: ["unrelated authorization paths"],
    },
  };

  it("schemas validate a sample of each verdict kind", () => {
    expectOk(validateVerdict("contract", contractSample));
    expectOk(validateVerdict("build", buildDone));
    expectOk(validateVerdict("build", buildBlocked));
    expectOk(validateVerdict("review", reviewSample));
    expectOk(validateVerdict("review", {
      verdict: "approve",
      findings: [],
      review: {
        rationale: "All acceptance criteria have concrete evidence.",
        evidence: [{ claim: "AC1", evidence: "named test passes" }],
        notReviewed: [],
      },
    }));
  });

  it("accepts an explicit null on an optional field (native strict-output convention)", () => {
    // OpenAI/Codex strict structured outputs must emit every property, so a
    // 'done' build verdict carries blockedEntry: null. Null on an OPTIONAL
    // field is treated as absent — the round-trip from strict mode is lossless.
    expectOk(validateVerdict("build", { status: "done", blockedEntry: null }));
  });

  it("still rejects a null on a REQUIRED field", () => {
    const r = validateVerdict("build", { status: null });
    expectFail(r);
    expect(r.reason).toContain("status");
  });

  it("rejects a bad category enum value", () => {
    const r = validateVerdict("review", {
      verdict: "findings",
      findings: [{ ...reviewSample.findings[0]!, category: "perf" }],
      review: reviewSample.review,
    });
    expectFail(r);
    expect(r.reason).toContain("architecture | testing | security | style | scope");
  });

  it("rejects missing required keys", () => {
    const r = validateVerdict("contract", { files: ["src/a.ts"], approach: "x" });
    expectFail(r);
    expect(r.reason).toContain("tests: required");
    expect(r.reason).toContain("complexity: required");
  });

  it("rejects unknown keys (additionalProperties: false)", () => {
    const r = validateVerdict("build", { status: "done", vibe: "great" });
    expectFail(r);
    expect(r.reason).toContain("vibe: unknown key");
  });

  // ISSUE-016 residual: `fix/fix` is a registered operation whose verdictKind is
  // `build`, and prompts/build/fix.md REQUIRES one disposition per finding. The
  // build schema is what a structured-output runtime is handed, so a schema that
  // cannot express `resolutions` makes the fix pass unable to report the only
  // output that distinguishes it from `build/implement`.
  it("accepts the fix pass's structured resolutions on a build verdict", () => {
    const r = validateVerdict("build", {
      status: "done",
      blockedEntry: null,
      resolutions: [
        { outcome: "fixed", location: "src/a.ts:12", note: "commit abc1234, test/a.test.ts" },
        { outcome: "rebutted", location: "ci.yml:4", note: "documented in docs/deploy.md" },
      ],
    });
    expectOk(r);
    expect(r.verdict).toMatchObject({
      resolutions: [
        { outcome: "fixed", location: "src/a.ts:12" },
        { outcome: "rebutted", location: "ci.yml:4" },
      ],
    });
  });

  it("drops the strict-output nulls so no consumer dereferences one", () => {
    // Codex strict mode must emit every property, so an absent optional field
    // arrives as null. Passing that null through made `resolutions !== undefined`
    // true with a non-array value — the fix pass's comment renderer then threw
    // a raw TypeError, the ISSUE-016 failure shape.
    const r = validateVerdict("build", { status: "done", blockedEntry: null, resolutions: null });
    expectOk(r);
    expect(r.verdict).toEqual({ status: "done" });
    expect("resolutions" in r.verdict).toBe(false);
    expect("blockedEntry" in r.verdict).toBe(false);

    const review = validateVerdict("review", {
      verdict: "findings",
      findings: [{ ...reviewSample.findings[0]!, location: "src/auth.ts:1" }],
      review: { rationale: "r", evidence: [{ claim: "c", evidence: "e" }], notReviewed: [] },
    });
    expectOk(review);
    expect(review.verdict).toEqual({
      verdict: "findings",
      findings: reviewSample.findings,
      review: { rationale: "r", evidence: [{ claim: "c", evidence: "e" }], notReviewed: [] },
    });
  });

  it("keeps a null on a REQUIRED field a failure, never a silent drop", () => {
    // Adversarial near-miss for the normalizer: dropping nulls must not become
    // a way to satisfy a required key.
    const r = validateVerdict("build", { status: null, resolutions: null });
    expectFail(r);
    expect(r.reason).toContain("status");
  });

  it("round-trips the text grammar's resolutions through the structured schema", () => {
    // The two ingestion paths must agree: whatever parseVerdict extracts from
    // the documented line grammar has to survive validateVerdict unchanged.
    const parsed = parseVerdict(
      "build",
      [
        "- fixed src/a.ts:12 -- commit abc1234, regression in test/a.test.ts",
        "- rebutted ci.yml:4 — documented behavior, see docs/deploy.md",
        "",
        "Verdict: done",
      ].join("\n"),
    );
    expectOk(parsed);
    const revalidated = validateVerdict("build", parsed.verdict);
    expectOk(revalidated);
    expect(revalidated.verdict).toEqual(parsed.verdict);
  });

  it("still rejects a malformed resolution entry rather than accepting any array", () => {
    // Adversarial near-miss: declaring `resolutions` must not become a hole in
    // additionalProperties:false, and outcome stays a closed enum.
    const unknownOutcome = validateVerdict("build", {
      status: "done",
      resolutions: [{ outcome: "waived", location: "src/a.ts:1", note: "n" }],
    });
    expectFail(unknownOutcome);
    expect(unknownOutcome.reason).toContain("fixed | rebutted");

    const extraKey = validateVerdict("build", {
      status: "done",
      resolutions: [{ outcome: "fixed", location: "src/a.ts:1", note: "n", severity: "minor" }],
    });
    expectFail(extraKey);
    expect(extraKey.reason).toContain("severity: unknown key");

    const missingNote = validateVerdict("build", {
      status: "done",
      resolutions: [{ outcome: "fixed", location: "src/a.ts:1" }],
    });
    expectFail(missingNote);
    expect(missingNote.reason).toContain("note: required");

    const emptyLocation = validateVerdict("build", {
      status: "done",
      resolutions: [{ outcome: "fixed", location: "   ", note: "n" }],
    });
    expectFail(emptyLocation);
    expect(emptyLocation.reason).toContain("non-whitespace");
  });

  it("rejects an empty files list (minItems)", () => {
    const r = validateVerdict("contract", { ...contractSample, files: [] });
    expectFail(r);
    expect(r.reason).toContain("at least 1 item");
  });

  it("enforces the approve/findings consistency rule on structured output too", () => {
    const approveWithFindings = {
      verdict: "approve",
      findings: reviewSample.findings,
      review: reviewSample.review,
    };
    expectFail(validateVerdict("review", approveWithFindings));
    expectFail(validateVerdict("review", {
      verdict: "findings",
      findings: [],
      review: reviewSample.review,
    }));
  });

  it("schemas plug into TurnRequest.verdictSchema (M1.4 reconciliation surface)", () => {
    // Compile-time: VerdictSchema must satisfy Record<string, unknown>.
    const req: Pick<TurnRequest, "verdictSchema"> = {
      verdictSchema: VERDICT_SCHEMAS.review,
    };
    expect(req.verdictSchema).toBe(VERDICT_SCHEMAS.review);
    expect(VERDICT_SCHEMAS.contract["title"]).toBe("ContractVerdict");
    expect(VERDICT_SCHEMAS.build["title"]).toBe("BuildVerdict");
  });
});
