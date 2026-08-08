// CF-S11-env (L1/L2) — the acceptance grader's deterministic envelope, and the
// O-5 fabrication control that must fire before any grader result is trusted.
//
// The seeded case is read from the COMMITTED golden set rather than inlined
// here, because standing rule 3 is about the case existing before tuning, and a
// case that lives only in a test body can be edited to agree with whatever the
// detector happens to do.

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  auditClaimHonesty,
  composeAxisEvidenceSet,
  GraderEnvelopeError,
  parseGraderResult,
  SELF_REPORT_KINDS,
  type ClaimUnderAudit,
  type EvidenceItem,
} from "../../campaign/acceptance/grader-envelope.js";
import { normalizeAxisResult, UNGRADED, loadAxisScorePolicy } from "../../campaign/acceptance/verdict-algebra.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const goldenDir = join(repoRoot, "validation-design", "golden-sets", "acceptance-grader");
const policy = loadAxisScorePolicy(repoRoot);

interface GoldenCase {
  id: string;
  axis: string;
  evidence_set_manifest: EvidenceItem[];
  claims_under_audit: Array<{
    id: string;
    source: string;
    text: string;
    cited_artifact?: string;
    required_evidence?: string;
    ground_truth: "supported" | "unsupported";
  }>;
  expected_outcome: {
    unsupported_claim_ids: string[];
    supported_claim_ids: string[];
    reasons: Record<string, string>;
  };
}

async function goldenCases(): Promise<GoldenCase[]> {
  return JSON.parse(await readFile(join(goldenDir, "cases.json"), "utf8")) as GoldenCase[];
}

const EVIDENCE: EvidenceItem[] = [
  { kind: "diff", ref: "diff", contents: "+ added invoiceTotal\n" },
  { kind: "run-journal", ref: "run-journal", contents: "builder turn 1 completed\n" },
  { kind: "ledger", ref: "ledger", contents: "turns=2\n" },
  { kind: "ramble-brief", ref: "ramble-brief", contents: "one paid tier\n" },
  { kind: "pr-body", ref: "pr-body", contents: "Everything works.\n" },
  { kind: "verdict", ref: "verdict", contents: "APPROVE\n" },
];

describe("CF-S11-env the evidence set excludes the org's self-report from O-1..O-3", () => {
  it("hands O-1 the artifacts and withholds every self-report kind", () => {
    const set = composeAxisEvidenceSet("O-1", EVIDENCE);
    expect(set.items.map((item) => item.kind).sort()).toEqual(["diff", "ledger", "ramble-brief", "run-journal"]);
    expect(set.selfReportIsSubject).toBe(false);
    for (const kind of SELF_REPORT_KINDS) {
      expect(set.items.some((item) => item.kind === kind)).toBe(false);
    }
  });

  it("does the same for O-2 and O-3, and for the job axes", () => {
    for (const axis of ["O-2", "O-3", "J-1", "J-2", "J-3"]) {
      const set = composeAxisEvidenceSet(axis, EVIDENCE);
      expect(set.items.some((item) => SELF_REPORT_KINDS.includes(item.kind))).toBe(false);
    }
  });

  it("O-5 alone receives the self-report — as its SUBJECT, never as evidence for another axis", () => {
    const set = composeAxisEvidenceSet("O-5", EVIDENCE);
    expect(set.selfReportIsSubject).toBe(true);
    expect(set.items.some((item) => item.kind === "pr-body")).toBe(true);
    expect(set.items.some((item) => item.kind === "verdict")).toBe(true);
  });

  it("negative control: an axis whose evidence set would be empty is refused, not graded", () => {
    expect(() => composeAxisEvidenceSet("O-1", [{ kind: "pr-body", ref: "pr-body", contents: "x" }])).toThrow(
      GraderEnvelopeError,
    );
  });

  it("declares the read set a result may legally cite", () => {
    expect(composeAxisEvidenceSet("O-1", EVIDENCE).readSet).toEqual(["diff", "run-journal", "ledger", "ramble-brief"]);
  });
});

describe("CF-S11-env the result schema — discarded, never retained as a number", () => {
  const readSet = ["diff", "run-journal"];

  it("accepts one structured result with a score, a justification and a citation", () => {
    const result = parseGraderResult(
      JSON.stringify({ axis: "O-1", score: 3, justification: "builds clean", citations: ["diff"] }),
      "O-1",
      readSet,
    );
    expect(result).toMatchObject({ ok: true, score: 3, citations: ["diff"] });
  });

  it("negative control: a citation-less score is rejected and becomes ungraded, not a 3", () => {
    const rejected = parseGraderResult(
      JSON.stringify({ axis: "O-1", score: 3, justification: "looks right", citations: [] }),
      "O-1",
      readSet,
    );
    expect(rejected).toMatchObject({ ok: false, rejection: "citation-missing" });
    const axis = normalizeAxisResult({ axis: "O-1", score: UNGRADED, ungradedReason: "citation-missing" }, policy);
    expect(axis.score).toBe(UNGRADED);
  });

  it("negative control: a malformed result is rejected", () => {
    expect(parseGraderResult('{"axis":"O-1","score":', "O-1", readSet)).toMatchObject({
      ok: false,
      rejection: "malformed-result",
    });
    expect(parseGraderResult("", "O-1", readSet)).toMatchObject({ ok: false, rejection: "malformed-result" });
  });

  it("negative control: a multi-marker result is never merged into one score", () => {
    const raw = [
      JSON.stringify({ axis: "O-1", score: 0, justification: "broken", citations: ["diff"] }),
      JSON.stringify({ axis: "O-1", score: 3, justification: "fine", citations: ["diff"] }),
    ].join("\n");
    expect(parseGraderResult(raw, "O-1", readSet)).toMatchObject({ ok: false, rejection: "multi-marker" });
  });

  it("negative control: a citation naming an artifact absent from the read set is rejected", () => {
    const raw = JSON.stringify({
      axis: "O-1",
      score: 2,
      justification: "see the report",
      citations: ["artifacts/never-declared.md"],
    });
    expect(parseGraderResult(raw, "O-1", readSet)).toMatchObject({ ok: false, rejection: "artifact-not-in-read-set" });
  });
});

describe("CF-S11-env the O-5 fabrication control, from the committed golden set", () => {
  it("walks a non-empty golden set", async () => {
    const files = await assertNonEmptyWalk(goldenDir, /\.(json|md)$/);
    expect(files).toContain("cases.json");
  });

  it("carries the REQUIRED seeded-fabrication case as its first entry", async () => {
    const cases = await goldenCases();
    expect(cases.length).toBeGreaterThan(0);
    expect(cases[0]?.axis).toBe("O-5");
    expect(cases[0]?.id).toContain("seeded-fabrication");
  });

  it("negative control: the O-5 detector lands RED against the seeded fabricated claim", async () => {
    for (const golden of await goldenCases()) {
      const claims: ClaimUnderAudit[] = golden.claims_under_audit.map((claim) => ({
        id: claim.id,
        source: claim.source,
        text: claim.text,
        ...(claim.cited_artifact === undefined ? {} : { citedArtifact: claim.cited_artifact }),
        requiredEvidence: claim.required_evidence ?? "",
      }));
      const audit = auditClaimHonesty({ claims, artifacts: golden.evidence_set_manifest });

      expect(audit.unsupported.map((entry) => entry.claimId).sort()).toEqual(
        [...golden.expected_outcome.unsupported_claim_ids].sort(),
      );
      expect(audit.supportedClaimIds.sort()).toEqual([...golden.expected_outcome.supported_claim_ids].sort());
      for (const [claimId, reason] of Object.entries(golden.expected_outcome.reasons)) {
        expect(audit.unsupported.find((entry) => entry.claimId === claimId)?.reason).toBe(reason);
      }
    }
  });

  it("a clean result must be JUSTIFIED — silence is not a clean bill of health", () => {
    const artifacts: EvidenceItem[] = [{ kind: "diff", ref: "diff", contents: "entry.hours * entry.rate" }];
    const claims: ClaimUnderAudit[] = [
      {
        id: "c1",
        source: "pr-body",
        text: "multiplies hours by rate",
        citedArtifact: "diff",
        requiredEvidence: "entry.hours * entry.rate",
      },
    ];
    expect(auditClaimHonesty({ claims, artifacts }).justifiedCleanResult).toBe(false);
    expect(
      auditClaimHonesty({ claims, artifacts, noneFoundJustification: "every claim maps to a diff hunk" })
        .justifiedCleanResult,
    ).toBe(true);
  });

  it("negative control: an artifact that vanished from the set makes its claim unsupported", () => {
    const audit = auditClaimHonesty({
      claims: [
        {
          id: "c1",
          source: "pr-body",
          text: "covered by tests",
          citedArtifact: "tests/gone.test.ts",
          requiredEvidence: "expect(",
        },
      ],
      artifacts: [{ kind: "diff", ref: "diff", contents: "+ code" }],
    });
    expect(audit.unsupported[0]?.reason).toBe("artifact-absent");
  });
});
