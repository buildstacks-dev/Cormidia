// Tests the CandidateArtifact contract and the conditional experiment gate
// (src/org/learning/candidate.ts; design §9.1). M3 done-criterion 2: a
// candidate with claims_efficacy: true cannot proceed without a declared
// experiment; a T0 fact proceeds and is reported as authorized/unproven.

import { describe, expect, it } from "vitest";
import {
  assertCandidateCanProceed,
  claimAfterEval,
  experimentRequirement,
  validateCandidateArtifact,
} from "../../src/org/learning/candidate.js";
import { validateExperimentRecord } from "../../src/org/learning/experiment.js";
import { makeCandidate, makeExperiment } from "./helpers.js";

const EXPERIMENT = validateExperimentRecord(makeExperiment());

describe("validateCandidateArtifact", () => {
  it("accepts the spec-shaped candidate", () => {
    const candidate = validateCandidateArtifact(makeCandidate());
    expect(candidate.candidate_id).toBe("cand_20260711_01JGHI");
    expect(candidate.claims_efficacy).toBe(false);
  });

  it("rejects invalid and reserved scopes with the spec §2 grammar", () => {
    expect(() => validateCandidateArtifact(makeCandidate({ proposed_scope: "everything" }))).toThrow(
      /proposed_scope must be org \| roles/,
    );
    expect(() =>
      validateCandidateArtifact(makeCandidate({ proposed_scope: "identities/alice" })),
    ).toThrow(/reserved for a future version/);
  });

  it("rejects a malformed content hash", () => {
    expect(() => validateCandidateArtifact(makeCandidate({ content_hash: "sha256:short" }))).toThrow(
      /content_hash/,
    );
  });
});

describe("experimentRequirement (design §9.1 table)", () => {
  it("claims_efficacy requires an experiment regardless of tier", () => {
    expect(experimentRequirement({ claims_efficacy: true, proposed_tier: "T0" })).toEqual({
      required: true,
      reason: "claims_efficacy",
    });
  });

  it("T2/T3 activation requires one; T0/T1 facts do not", () => {
    expect(experimentRequirement({ claims_efficacy: false, proposed_tier: "T2" }).required).toBe(true);
    expect(experimentRequirement({ claims_efficacy: false, proposed_tier: "T3" }).required).toBe(true);
    expect(experimentRequirement({ claims_efficacy: false, proposed_tier: "T0" }).required).toBe(false);
    expect(experimentRequirement({ claims_efficacy: false, proposed_tier: "T1" }).required).toBe(false);
  });
});

describe("assertCandidateCanProceed (done-criterion 2)", () => {
  it("claims_efficacy without a declared experiment cannot proceed", () => {
    const candidate = validateCandidateArtifact(makeCandidate({ claims_efficacy: true }));
    expect(() => assertCandidateCanProceed(candidate)).toThrow(
      /claims efficacy but declares no experiment/,
    );
  });

  it("an efficacy claim is never waivable — not even by a human", () => {
    const candidate = validateCandidateArtifact(
      makeCandidate({ claims_efficacy: true, proposed_tier: "T2" }),
    );
    expect(() =>
      assertCandidateCanProceed(candidate, { humanWaiver: "we are in a hurry" }),
    ).toThrow(/never waivable/);
  });

  it("claims_efficacy with its declared experiment proceeds as experiment-pending", () => {
    const candidate = validateCandidateArtifact(
      makeCandidate({ claims_efficacy: true, experiment_ref: EXPERIMENT.experiment_id }),
    );
    expect(assertCandidateCanProceed(candidate, { experiment: EXPERIMENT })).toEqual({
      claim: "authorized",
      verdict_when_untried: null,
      reported_as: "experiment pending",
      waiver: null,
    });
  });

  it("a T0 fact proceeds and is reported as authorized/unproven", () => {
    const candidate = validateCandidateArtifact(makeCandidate({ proposed_tier: "T0" }));
    expect(assertCandidateCanProceed(candidate)).toEqual({
      claim: "authorized",
      verdict_when_untried: "not_evaluatable",
      reported_as: "authorized (unproven)",
      waiver: null,
    });
  });

  it("T2 without an experiment refuses, and proceeds only on an explicit human waiver", () => {
    const candidate = validateCandidateArtifact(makeCandidate({ proposed_tier: "T2" }));
    expect(() => assertCandidateCanProceed(candidate)).toThrow(/tier T2 activation/);
    expect(() => assertCandidateCanProceed(candidate, { humanWaiver: "  " })).toThrow(
      /must say why/,
    );
    expect(
      assertCandidateCanProceed(candidate, {
        humanWaiver: "one-line config fact; replay cannot exercise it; reviewed manually",
      }),
    ).toMatchObject({ claim: "authorized", reported_as: "waived (human)" });
  });

  it("a borrowed experiment proves nothing — candidate_ref must match", () => {
    const candidate = validateCandidateArtifact(
      makeCandidate({
        candidate_id: "cand_other",
        claims_efficacy: true,
        experiment_ref: EXPERIMENT.experiment_id,
      }),
    );
    expect(() => assertCandidateCanProceed(candidate, { experiment: EXPERIMENT })).toThrow(
      /binds to one candidate/,
    );
  });

  it("a dangling experiment_ref must be resolved before the gate", () => {
    const candidate = validateCandidateArtifact(
      makeCandidate({ experiment_ref: "exp_missing" }),
    );
    expect(() => assertCandidateCanProceed(candidate)).toThrow(/was not resolved/);
  });

  it("the candidate itself must record the linkage — a supplied experiment cannot stand in", () => {
    // A pass justified by an experiment the candidate never names would be
    // unverifiable on any later re-check of the stored record.
    const candidate = validateCandidateArtifact(
      makeCandidate({ claims_efficacy: true, experiment_ref: null }),
    );
    expect(() => assertCandidateCanProceed(candidate, { experiment: EXPERIMENT })).toThrow(
      /must name its experiment/,
    );
  });

  it("rejects dot-only scope segments (path traversal is a grammar error)", () => {
    expect(() =>
      validateCandidateArtifact(makeCandidate({ proposed_scope: "apps/.." })),
    ).toThrow(/proposed_scope must be/);
    expect(() =>
      validateCandidateArtifact(makeCandidate({ proposed_scope: "roles/../experiments" })),
    ).toThrow(/proposed_scope must be/);
  });
});

describe("claimAfterEval — the one legal upgrade path", () => {
  it("only a completed experiment with verdict improved produces validated", () => {
    expect(claimAfterEval("improved")).toBe("validated");
    expect(claimAfterEval("regressed")).toBe("authorized");
    expect(claimAfterEval("inconclusive")).toBe("authorized");
    expect(claimAfterEval("not_evaluatable")).toBe("authorized");
  });
});
