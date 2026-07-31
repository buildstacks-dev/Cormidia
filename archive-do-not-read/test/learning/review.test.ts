// Reviewer verdict schema + fail-closed review (learning-loop M4, spec §15).

import { afterEach, describe, expect, it } from "vitest";
import {
  listReviewerVerdicts,
  readReviewerVerdict,
  reviewDisposition,
  reviewerVerdictHash,
  validateReviewerVerdict,
  writeReviewerVerdict,
} from "../../src/org/learning/review.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";
import { makeReviewerVerdict } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function orgFixture(): OrgHomeFixture {
  const fixture = makeOrgHome();
  cleanups.push(fixture.cleanup);
  return fixture;
}

describe("validateReviewerVerdict", () => {
  it("accepts the spec shape and rejects bad enums, scopes, and rubric scores", () => {
    expect(() => validateReviewerVerdict(makeReviewerVerdict())).not.toThrow();
    expect(() => validateReviewerVerdict(makeReviewerVerdict({ verdict: "maybe" }))).toThrow(
      /verdict must be one of/,
    );
    expect(() =>
      validateReviewerVerdict(makeReviewerVerdict({ proposed_scope: "identities/anna" })),
    ).toThrow(/reserved for a future version/);
    expect(() =>
      validateReviewerVerdict(
        makeReviewerVerdict({
          rubric: { ...(makeReviewerVerdict()["rubric"] as object), correctness: 7 },
        }),
      ),
    ).toThrow(/integer 0-5/);
    expect(() =>
      validateReviewerVerdict(
        makeReviewerVerdict({
          rubric: { ...(makeReviewerVerdict()["rubric"] as object), injection_screen: "dirty" },
        }),
      ),
    ).toThrow(/injection_screen/);
    expect(() => validateReviewerVerdict(makeReviewerVerdict({ reviewed_by: "" }))).toThrow(
      /reviewed_by/,
    );
  });
});

describe("reviewDisposition (fail-closed)", () => {
  it("maps verdict words, and a non-clean injection screen escalates regardless", () => {
    const verdict = (word: string, screen = "clean") =>
      validateReviewerVerdict(
        makeReviewerVerdict({
          verdict: word,
          rubric: { ...(makeReviewerVerdict()["rubric"] as object), injection_screen: screen },
        }),
      );
    expect(reviewDisposition(verdict("approve"))).toBe("proceed");
    expect(reviewDisposition(verdict("revise"))).toBe("revise");
    expect(reviewDisposition(verdict("reject"))).toBe("reject");
    expect(reviewDisposition(verdict("escalate"))).toBe("escalate");
    // Spec §15: non-clean screens escalate — even an "approve".
    expect(reviewDisposition(verdict("approve", "suspicious"))).toBe("escalate");
    expect(reviewDisposition(verdict("approve", "flagged"))).toBe("escalate");
  });
});

describe("storage", () => {
  it("round-trips verdicts, lists them, and hashes stored bytes", async () => {
    const fixture = orgFixture();
    await writeReviewerVerdict(fixture.root, makeReviewerVerdict());
    const read = await readReviewerVerdict(fixture.root, "cand_20260711_01JGHI");
    expect(read?.verdict).toBe("approve");
    expect(await listReviewerVerdicts(fixture.root)).toHaveLength(1);

    const hash = await reviewerVerdictHash(fixture.root, "cand_20260711_01JGHI");
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);

    // Re-reviewing changes the hash — the approval binding notices.
    await writeReviewerVerdict(
      fixture.root,
      makeReviewerVerdict({ rationale: "changed my mind after a second episode" }),
    );
    expect(await reviewerVerdictHash(fixture.root, "cand_20260711_01JGHI")).not.toBe(hash);
  });

  it("a missing verdict reads undefined and its hash throws (fail closed)", async () => {
    const fixture = orgFixture();
    expect(await readReviewerVerdict(fixture.root, "cand_20260711_none")).toBeUndefined();
    await expect(reviewerVerdictHash(fixture.root, "cand_20260711_none")).rejects.toThrow(
      /fails closed/,
    );
  });
});
