import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONTINUATION_STAGES, reconcileContinuation, runContinuation } from "../../scripts/eval/continuation-harness.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("CONTINUATION-MATRIX-001 exhaustive durable artifact boundaries", () => {
  for (const boundary of CONTINUATION_STAGES) {
    it(`interrupt after ${boundary} resumes at the next legal boundary without repeating productive work`, () => {
      const root = mkdtempSync(join(tmpdir(), `operon-cont-${boundary}-`)); roots.push(root);
      const interrupted = runContinuation(root, { interruptAfter: boundary });
      expect(interrupted.journal.status).toBe("interrupted");
      const resumed = runContinuation(root);
      expect(resumed.journal.status).toBe("completed");
      expect(resumed.repeated_valid_productive_passes).toBe(0);
      expect(new Set(resumed.journal.stages.map((record) => record.stage))).toEqual(new Set(CONTINUATION_STAGES));
      expect(reconcileContinuation(root).stages).toHaveLength(CONTINUATION_STAGES.length);
    });
  }
  it("near-miss invalidation reruns only the changed stage and downstream work with a durable reason", () => {
    const root = mkdtempSync(join(tmpdir(), "operon-cont-invalidate-")); roots.push(root);
    runContinuation(root);
    const rerun = runContinuation(root, { invalidate: { stage: "commit", reason: "implementation commit no longer reachable" } });
    expect(rerun.executed).toEqual(["commit", "push", "gates", "pr", "review_finding", "approval", "release"]);
    expect(rerun.reused).toEqual(["route", "contract"]);
    expect(rerun.journal.status).toBe("completed");
  });
  for (const stop of ["cap_stop", "cancelled", "crash", "provider_timeout"] as const) {
    it(`${stop} preserves completed artifacts and an executable next step`, () => {
      const root = mkdtempSync(join(tmpdir(), `operon-cont-${stop}-`)); roots.push(root);
      const stopped = runContinuation(root, { stop });
      expect(stopped.journal.status).toBe(stop);
      expect(stopped.journal.stop_evidence).toMatchObject({ kind: stop, next_step: "resume:contract" });
      expect(runContinuation(root).journal.status).toBe("completed");
    });
  }
  it("honest failure rejects invalidation without a reason", () => {
    const root = mkdtempSync(join(tmpdir(), "operon-cont-failure-")); roots.push(root);
    runContinuation(root);
    expect(() => runContinuation(root, { invalidate: { stage: "gates", reason: "" } })).toThrow("invalidation_reason_required");
  });
});
