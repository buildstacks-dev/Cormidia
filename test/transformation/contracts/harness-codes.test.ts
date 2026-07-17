import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { classifyResultEvidence, type ResultDebtSpec } from "./harness.js";

// This pins the P1-06/ROOT-001 fix: classifyResultEvidence must surface the
// verifier's real, code-bearing error message, never collapse every distinct
// contract_evidence_*/release_attestation_* cause into the single opaque
// "invalid_contract_observation" sentinel (that collapse is what hid
// release_attestation_package_mismatch behind a meaningless diagnostic for a
// week). Fixtures live under the gitignored .eval-artifacts/ tree because
// verifyContractEvidence only accepts projection paths inside the repo root.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratchRoot = join(root, ".eval-artifacts");
mkdirSync(scratchRoot, { recursive: true });
const dir = mkdtempSync(join(scratchRoot, "harness-codes-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const spec: ResultDebtSpec = {
  id: "D-LIVE-01",
  expectedFailure: "provider_baseline_not_run",
  caseId: "quick/ignore-config/v1",
  campaign: "candidate-qualification.yaml",
  repetitionIds: ["clean-q1"],
};

function fixture(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

describe("classifyResultEvidence error-code propagation (P1-06 / ROOT-001)", () => {
  it("returns the verifier's real code, not the opaque sentinel, on a structurally invalid projection", () => {
    // Well-formed JSON with the wrong key set: verifyContractEvidence rejects it
    // at its root-shape check and throws the bare code contract_evidence_invalid_root.
    const path = fixture("invalid-root.json", JSON.stringify({ schema_version: 1, not_a_projection: true }));
    const result = classifyResultEvidence(path, spec, spec.expectedFailure);
    expect(result).toBe("contract_evidence_invalid_root");
    expect(result).not.toBe("invalid_contract_observation");
  });

  it("preserves the code-bearing message with its ':<detail>' suffix on malformed projection JSON", () => {
    // Unparseable bytes: the verifier throws contract_evidence_malformed_json:<path>.
    // The whole code+detail string must survive, proving distinct causes stay distinct.
    const path = fixture("malformed.json", "{ this is not json");
    const result = classifyResultEvidence(path, spec, spec.expectedFailure);
    expect(result.startsWith("contract_evidence_malformed_json:")).toBe(true);
    expect(result).not.toBe("invalid_contract_observation");
  });

  it("still returns the declared expectedFailure when the projection file is absent", () => {
    const path = join(dir, "does-not-exist.json");
    expect(classifyResultEvidence(path, spec, spec.expectedFailure)).toBe(spec.expectedFailure);
  });
});
