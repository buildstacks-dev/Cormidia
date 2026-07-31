import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { hashFile, validateResult } from "../../../scripts/eval/core.js";
import { verifyContractEvidence } from "../../../scripts/eval/contract-evidence.js";
import { fixtureResult } from "./harness.js";

// D-003 fix: the near-miss and honest-failure intents that used to be asserted
// 20 times against the harness's OWN classifier now live here, ONCE, asserted
// against the real product boundary (verifyContractEvidence). These prove the
// product refuses unbound / corrupt / foreign evidence by naming the exact code
// contract-evidence.ts actually throws — codes verified by running this file.
//
// Fixtures live under the gitignored .eval-artifacts/ tree because
// verifyContractEvidence only accepts projection paths inside the repo root
// (repositoryRelative() rejects anything outside it).
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratchRoot = join(root, ".eval-artifacts");
mkdirSync(scratchRoot, { recursive: true });
const dir = mkdtempSync(join(scratchRoot, "product-boundary-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const NEAR_MISS_CASE = "quick/ignore-config/v1";

/** A structurally complete projection (all 17 keys, `schema_version: 1`) mapped
 * to the real D-LIVE-01 contract/case. Individual refs are placeholders the
 * caller overrides to isolate one specific product refusal. */
function completeProjection(overrides: Record<string, unknown>): Record<string, unknown> {
  const zero = `sha256:${"0".repeat(64)}`;
  return {
    schema_version: 1,
    contract_id: "D-LIVE-01",
    campaign_id: "unbound-local",
    campaign_sha256: zero,
    candidate: { commit: "local", package_sha256: zero, suite_sha256: zero, release_package_sha256: zero, executable_suite_sha256: zero },
    org_fingerprint: zero,
    system_fingerprint: zero,
    case_id: NEAR_MISS_CASE,
    repetition_ids: ["clean-q1"],
    prepared_manifest: { path: "research/evals/does-not-exist.yaml", sha256: zero },
    qualification: { path: "x", sha256: zero },
    report: { path: "x", sha256: zero },
    archive_receipt: { path: "x", sha256: zero },
    archive_manifest: { path: "x", sha256: zero },
    github_evidence: { path: "x", sha256: zero },
    github_idempotence: { path: "x", sha256: zero },
    release_attestation: { path: "x", sha256: zero },
    ...overrides,
  };
}

function writeFixture(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

describe("contract promotion product boundary (D-003)", () => {
  it("accepts a complete, individually valid, locally-authored result value", () => {
    // The value itself is well-formed — validateResult (the product's per-result
    // validator) returns no errors. Acceptance here is exactly why the value ALONE
    // must not be promotable: the boundary tests below refuse it regardless.
    expect(validateResult(fixtureResult(NEAR_MISS_CASE))).toEqual([]);
  });

  it("refuses a complete but unbound locally-authored result presented as promotion evidence", () => {
    // Author the complete result locally, then present it as the projection's
    // prepared campaign manifest with its TRUE hash (so the binding passes the
    // hash gate). The product still refuses: a raw result is not a qualified
    // campaign, so validateCampaign rejects it.
    const resultPath = writeFixture("local-result.json", JSON.stringify(fixtureResult(NEAR_MISS_CASE)));
    const projectionPath = writeFixture(
      "unbound-projection.json",
      JSON.stringify(completeProjection({
        prepared_manifest: { path: relative(root, resultPath).replaceAll("\\", "/"), sha256: `sha256:${hashFile(resultPath)}` },
      })),
    );
    expect(() => verifyContractEvidence(root, projectionPath, { contractId: "D-LIVE-01", caseId: NEAR_MISS_CASE, repetitionIds: ["clean-q1"] }))
      .toThrow(/^contract_evidence_invalid_campaign(:|$)/);
  });

  it("refuses genuine committed evidence presented for a different contract", () => {
    // The real, fully-bound D-LIVE-01 projection cannot be repurposed as evidence
    // for another contract — the product's mapping check rejects it. This fires
    // before the release-attestation step, so it is independent of the mid-wave
    // package-hash drift the positive cases surface.
    expect(() => verifyContractEvidence(
      root,
      join(root, "research/evals/contracts/D-LIVE-01.json"),
      { contractId: "E-LIVE-01", caseId: NEAR_MISS_CASE, repetitionIds: ["clean-q1"] },
    )).toThrow("contract_evidence_mapping_mismatch");
  });

  it("rejects corrupt or foreign referenced evidence by its real hash-binding code", () => {
    // A structurally complete, correctly-mapped projection whose prepared_manifest
    // references a foreign file whose bytes do not hash to the claimed digest.
    const projectionPath = writeFixture(
      "foreign-projection.json",
      JSON.stringify(completeProjection({
        prepared_manifest: { path: "research/evals/contracts/D-LIVE-01.json", sha256: `sha256:${"b".repeat(64)}` },
      })),
    );
    expect(() => verifyContractEvidence(root, projectionPath, { contractId: "D-LIVE-01", caseId: NEAR_MISS_CASE, repetitionIds: ["clean-q1"] }))
      .toThrow(/^contract_evidence_file_hash_mismatch(:|$)/);
  });
});
