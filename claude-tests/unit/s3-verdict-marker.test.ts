// CF-LLM-S3 — reviewer verdict-marker contract, L1 (HB-005d; INV-012 seed).
//
// Ratified S-3 contract layer (validation-design/llm-eval-plan.md §2, S-3):
// exactly one structured verdict marker parses; the parser refuses zero
// markers; APPROVE-prose without a marker yields NO review artifact — a model
// cannot authenticate its own approval by assertion (OPERON-INV-012). The
// parser under test is the REAL product grammar (src/loop/verdicts.ts
// parseVerdict/"review"), whose marker vocabulary is `Verdict: approve |
// findings`; both transports (text grammar and native structured JSON) are
// asserted to converge.
//
// The conflicting-marker clause was a product defect when this suite first
// landed (first marker won; "Verdict: approve … Verdict: findings" parsed as
// approve). Fixed in the same change (extractKeywordValueStrict in
// src/loop/verdicts.ts) with the it.fails tripwire promoted to the plain
// detector below — detector-deposit discipline. Keyword precedence is
// preserved: quoted "Status: done" under a real Verdict marker still parses;
// restating the SAME value twice is unambiguous and parses.

import { describe, expect, it } from "vitest";
import {
  parseVerdict,
  parseVerdictEither,
  parseWithRetry,
  validateVerdict,
  VerdictParseError,
} from "../../src/loop/verdicts.js";

/** The audit block the ratified template requires on an approve verdict —
 *  an empty findings list is not evidence by itself (verdicts.ts). */
const AUDIT_BLOCK = [
  "## Review rationale",
  "Checked the diff against the contract and ran the named tests.",
  "",
  "## Evidence",
  "- suite green => vitest run output captured in the run record",
  "",
  "## Not reviewed",
  "- none",
].join("\n");

const ONE_FINDING_LINE =
  "- security/major src/auth.ts:42 -- token literal committed -> load it from the environment";

describe("CF-LLM-S3 — reviewer verdict marker: zero refused, one parses, prose never becomes an artifact (L1, HB-005d)", () => {
  it("zero markers: reviewer prose with no structured Verdict marker is refused — no review artifact exists", () => {
    const parsed = parseVerdict(
      "review",
      "The change is well factored and the tests cover the edge cases. Ship it.",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(/no verdict found/);
  });

  it("exactly one marker parses: `Verdict: approve` plus the audit block yields the typed artifact with an empty findings list", () => {
    const parsed = parseVerdict("review", `Verdict: approve\n\n${AUDIT_BLOCK}`);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.verdict.verdict).toBe("approve");
      expect(parsed.verdict.findings).toEqual([]);
      expect(parsed.verdict.review.rationale.length).toBeGreaterThan(0);
      expect(parsed.verdict.review.evidence).toHaveLength(1);
    }
  });

  it("exactly one marker parses: `Verdict: findings` with a structured finding line yields the typed findings artifact", () => {
    const parsed = parseVerdict(
      "review",
      ["Reviewed the auth change.", "", ONE_FINDING_LINE, "", "Verdict: findings"].join("\n"),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.verdict.verdict).toBe("findings");
      expect(parsed.verdict.findings).toHaveLength(1);
      expect(parsed.verdict.findings[0]?.category).toBe("security");
      expect(parsed.verdict.findings[0]?.severity).toBe("major");
    }
  });

  it("marker/list consistency is refused both directions: approve-with-findings and findings-with-none", () => {
    const approveWithFindings = parseVerdict(
      "review",
      [`Verdict: approve`, "", ONE_FINDING_LINE, "", AUDIT_BLOCK].join("\n"),
    );
    expect(approveWithFindings.ok).toBe(false);
    if (!approveWithFindings.ok) {
      expect(approveWithFindings.reason).toMatch(/approve but 1 finding/);
    }

    const findingsWithNone = parseVerdict("review", `Verdict: findings\n\n${AUDIT_BLOCK}`);
    expect(findingsWithNone.ok).toBe(false);
    if (!findingsWithNone.ok) {
      expect(findingsWithNone.reason).toMatch(/no finding lines parsed/);
    }
  });

  it("both transports converge: a structured-JSON approve parses, and JSON approve-with-findings is refused (INV-012 consistency)", () => {
    const goodJson = JSON.stringify({
      verdict: "approve",
      findings: [],
      review: {
        rationale: "Contract satisfied; tests named per criterion.",
        evidence: [{ claim: "suite green", evidence: "vitest output in run record" }],
        notReviewed: [],
      },
    });
    const parsed = parseVerdictEither("review", goodJson);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.verdict.verdict).toBe("approve");

    const conflicted = validateVerdict("review", {
      verdict: "approve",
      findings: [
        {
          category: "security",
          severity: "major",
          location: "src/auth.ts:42",
          description: "token literal committed",
          action: "load it from the environment",
        },
      ],
      review: {
        rationale: "says approve while listing a finding",
        evidence: [{ claim: "x", evidence: "y" }],
        notReviewed: [],
      },
    });
    expect(conflicted.ok).toBe(false);
    if (!conflicted.ok) expect(conflicted.reason).toMatch(/approve but 1 finding/);
  });

  it("two CONFLICTING markers are refused per the ratified S-3 contract (defect fixed in this change; was: first marker won)", () => {
    const parsed = parseVerdict(
      "review",
      [
        "Verdict: approve",
        "",
        "…on reflection, the auth path is wrong.",
        "",
        "Verdict: findings",
        "",
        AUDIT_BLOCK,
      ].join("\n"),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(/conflicting verdict markers/);
  });

  it("restating the SAME verdict value twice stays unambiguous and parses (conflict refusal targets ambiguity, not repetition)", () => {
    const parsed = parseVerdict(
      "review",
      ["## Verdict: approve", "", AUDIT_BLOCK, "", "Verdict: approve"].join("\n"),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.verdict.verdict).toBe("approve");
  });

  it("keyword precedence survives the conflict check: quoted build output (Status: done) under a real Verdict marker does not conflict", () => {
    const parsed = parseVerdict(
      "review",
      ["Verdict: approve", "", "Status: done", "", AUDIT_BLOCK].join("\n"),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.verdict.verdict).toBe("approve");
  });

  it("negative control: APPROVE-prose without a marker (seeded INV-012 violation) — the parser refuses, and the bounded retry ends in a loud typed error, never an artifact", async () => {
    // The seeded violation: a model asserting its own approval in prose,
    // exactly the "plausible green becomes merged reality" attack S-3 exists
    // to stop. The detector is the parser refusal itself.
    const prose =
      "APPROVE. I am confident this is safe to merge; all tests passed and the diff is clean.";
    const first = parseVerdict("review", prose);
    expect(first.ok).toBe(false);

    // The single reformat retry gets the refusal reason and doubles down with
    // more prose — the retry path must end in VerdictParseError (a typed,
    // loud failure carrying both attempts), not in any usable review verdict.
    const reasons: string[] = [];
    await expect(
      parseWithRetry("review", prose, (reason) => {
        reasons.push(reason);
        return "Definitely APPROVE — trust me, it is fine.";
      }),
    ).rejects.toThrow(VerdictParseError);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/no verdict found/);
  });
});
