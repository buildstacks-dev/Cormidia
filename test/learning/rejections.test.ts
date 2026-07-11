// Rejection ledger + suppression windows (learning-loop M4, policy §13;
// milestone Done #4: a rejected candidate does not reappear inside the
// window unless evidence crosses the configured threshold).

import { appendFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { validateCandidateArtifact } from "../../src/org/learning/candidate.js";
import { defaultLearningPolicy } from "../../src/org/learning/policy.js";
import {
  appendRejection,
  checkSuppression,
  readRejections,
  rejectionsPath,
  suppressKeyFor,
} from "../../src/org/learning/rejections.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";
import { makeCandidate } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function orgFixture(): OrgHomeFixture {
  const fixture = makeOrgHome();
  cleanups.push(fixture.cleanup);
  return fixture;
}

const T0 = new Date("2026-07-11T10:00:00Z");
const days = (n: number) => new Date(T0.getTime() + n * 24 * 60 * 60 * 1000);

describe("rejection ledger", () => {
  it("suppresses a re-proposal inside the window and releases after it", async () => {
    const fixture = orgFixture();
    const policy = defaultLearningPolicy();
    const candidate = validateCandidateArtifact(makeCandidate());

    await appendRejection(fixture.root, {
      candidate,
      reason: "too broad",
      by: "human-operator",
      now: T0,
    });
    expect(await readRejections(fixture.root)).toHaveLength(1);

    // Same error_class, next day: suppressed (error_class is the key).
    const retry = validateCandidateArtifact(
      makeCandidate({ candidate_id: "cand_20260712_RETRY", content_hash: `sha256:${"ef".repeat(32)}` }),
    );
    expect(suppressKeyFor(retry)).toBe("review.rework_from_missing_tests");
    const inside = await checkSuppression(fixture.root, retry, policy, days(1));
    expect(inside.suppressed).toBe(true);
    expect(inside.evidenceNeeded).toBeGreaterThan(0);

    // Day 91: the 90-day window has passed.
    const outside = await checkSuppression(fixture.root, retry, policy, days(91));
    expect(outside.suppressed).toBe(false);
  });

  it("evidence at override_if_evidence_x times the rejected count overrides the window", async () => {
    const fixture = orgFixture();
    const policy = defaultLearningPolicy();
    // Rejected with 3 distinct evidence refs (1 episode + 1 event + 1 doc).
    const candidate = validateCandidateArtifact(makeCandidate());
    await appendRejection(fixture.root, { candidate, reason: "premature", by: "h", now: T0 });

    const strong = validateCandidateArtifact(
      makeCandidate({
        candidate_id: "cand_20260712_STRNG",
        episode_ids: ["ep_a_ticket_0001", "ep_a_ticket_0002", "ep_a_ticket_0003"],
        event_ids: ["evt_1", "evt_2"],
        evidence_refs: ["research/a.md"],
      }),
    );
    // 6 distinct refs >= 2x3 — the recurrence is exactly the signal the
    // rejection was wrong (policy §13 override_if_evidence_x).
    expect((await checkSuppression(fixture.root, strong, policy, days(1))).suppressed).toBe(false);

    const weak = validateCandidateArtifact(
      makeCandidate({
        candidate_id: "cand_20260712_WEAK1",
        episode_ids: ["ep_a_ticket_0001"],
        event_ids: [],
        evidence_refs: [],
      }),
    );
    expect((await checkSuppression(fixture.root, weak, policy, days(1))).suppressed).toBe(true);
  });

  it("candidates without an error_class suppress by content hash only", async () => {
    const fixture = orgFixture();
    const policy = defaultLearningPolicy();
    const anonymous = validateCandidateArtifact(
      makeCandidate({ candidate_id: "cand_20260711_NOCLS", error_class: undefined }),
    );
    expect(suppressKeyFor(anonymous)).toBe(anonymous.content_hash);
    await appendRejection(fixture.root, { candidate: anonymous, reason: "nope", by: "h", now: T0 });

    const reworded = validateCandidateArtifact(
      makeCandidate({
        candidate_id: "cand_20260712_OTHER",
        error_class: undefined,
        content_hash: `sha256:${"12".repeat(32)}`,
      }),
    );
    expect((await checkSuppression(fixture.root, reworded, policy, days(1))).suppressed).toBe(false);
  });

  it("drops a torn tail line and stays loud on mid-file corruption", async () => {
    const fixture = orgFixture();
    const candidate = validateCandidateArtifact(makeCandidate());
    await appendRejection(fixture.root, { candidate, reason: "r", by: "h", now: T0 });
    appendFileSync(rejectionsPath(fixture.root), '{"torn":', "utf8");
    expect(await readRejections(fixture.root)).toHaveLength(1);

    appendFileSync(rejectionsPath(fixture.root), '\n{"ok":true}\n', "utf8");
    await expect(readRejections(fixture.root)).rejects.toThrow(/corruption/);
  });
});
