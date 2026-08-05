// CF-HARNESS-RQ/CURRENCY/ATTEST/JUDGE/RELEASE — RQ-1's deterministic
// assurance root. Every family below includes a seeded red control.

import { afterEach, describe, expect, it } from "vitest";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  RELEASE_DETERMINISTIC_CHECKS,
  assessReleaseQualification,
  canonicalJson,
  compositeGradeKey,
  createReleaseAttestation,
  createReleaseAttestationFromCommit,
  createReleaseManifest,
  createReleaseTagMessage,
  digestJson,
  evaluateDeterministicAdmission,
  evaluateL4Evidence,
  evaluateTriggeredCampaignEvidence,
  parseReleaseTagMessage,
  releaseRepositorySnapshot,
  releaseSubjectDigest,
  sha256,
  validateEvidenceOnlyChangedPaths,
  validateReleaseCommitLineage,
  validateReleaseManifest,
  validateReleaseQualificationReport,
  validateReleaseRepositoryState,
  verifyReleasePacket,
  type DeterministicEvidenceV1,
  type EvaluatorDebtDispositionV1,
  type EvidenceChangeDispositionV1,
  type L4ReleaseEvidenceV1,
  type ReleaseActionV1,
  type ReleaseLaneResultV1,
  type ReleaseManifestBodyV1,
  type ReleaseManifestV1,
  type ReleaseCampaignEvidenceV1,
  type ReleaseObligationV1,
  type ReleaseQualificationReportV1,
} from "../../../src/org/release-evidence.js";

const execFile = promisify(execFileCallback);
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("RQ-1 manifest and deterministic-first admission", () => {
  it("binds the closed manifest to exact subject bytes", () => {
    const manifest = fixtureManifest();
    expect(manifest.qualification_id).toBe(digestJson(withoutQualificationId(manifest)));
    expect(manifest.obligations.every((item) => item.subject_digest === releaseSubjectDigest(manifest))).toBe(true);

    const producerOnlyChange = withoutQualificationId(manifest);
    producerOnlyChange.toolchain.node = "26.4.1";
    producerOnlyChange.inputs.tools = digestJson(producerOnlyChange.toolchain);
    expect(releaseSubjectDigest(producerOnlyChange)).toBe(releaseSubjectDigest(manifest));
    expect(createReleaseManifest(producerOnlyChange).qualification_id).not.toBe(manifest.qualification_id);
  });

  it("negative control: rejects unknown input, pending human reference, and stale assignment bytes", () => {
    const body = fixtureBody();
    expect(() => createReleaseManifest({ ...body, invented_threshold: 0.95 } as ReleaseManifestBodyV1)).toThrow(/unknown/);
    const pending = structuredClone(body) as unknown as Record<string, unknown>;
    ((pending["l4"] as ReleaseManifestBodyV1["l4"]).references[0] as unknown as Record<string, unknown>)["human_validation"] = "pending";
    expect(() => createReleaseManifest(pending as unknown as ReleaseManifestBodyV1)).toThrow(/not human validated/);
    const stale = structuredClone(fixtureManifest());
    stale.inputs.assignments = "f".repeat(64);
    expect(() => validateReleaseManifest(stale)).toThrow(/assignment inventory|release subject digest|qualification_id/);
  });

  it("negative control: recomputes candidate inputs and refuses an unratified threat model", async () => {
    const repo = await mkdtemp(join(tmpdir(), "rq1-repository-")); roots.push(repo);
    const cases = repositoryGoldenCases("pending");
    await writeRepositoryFixture(repo, cases, false, "0".repeat(40));
    await git(repo, ["init", "-q"]); await git(repo, ["config", "user.email", "fixture@example.test"]); await git(repo, ["config", "user.name", "Fixture"]);
    await git(repo, ["add", "."]); await git(repo, ["commit", "-qm", "source references"]);
    const sourceCommit = (await git(repo, ["rev-parse", "HEAD"])).trim();
    await writeRepositoryFixture(repo, repositoryGoldenCases("validated"), true, sourceCommit, cases);
    await git(repo, ["add", "."]); await git(repo, ["commit", "-qm", "ratified inputs"]);
    const candidate = (await git(repo, ["rev-parse", "HEAD"])).trim();
    const snapshot = await releaseRepositorySnapshot(repo, candidate);
    const manifestLike = {
      candidate_commit: candidate,
      inputs: snapshot.inputs,
      assignments: snapshot.assignments,
      threat_model: snapshot.threat_model,
      l4: { references: snapshot.golden_references },
    } as unknown as ReleaseManifestBodyV1;
    await expect(validateReleaseRepositoryState(repo, manifestLike)).resolves.toBeUndefined();
    const forged = structuredClone(manifestLike);
    forged.inputs.policy = "f".repeat(64);
    await expect(validateReleaseRepositoryState(repo, forged)).rejects.toThrow(/policy.*caller-supplied/);

    const statusPath = join(repo, "validation-design", "threat-model-status.yaml");
    await writeFile(statusPath, threatStatus(false, "0".repeat(64)), "utf8");
    await git(repo, ["add", "."]); await git(repo, ["commit", "-qm", "withdraw threat ratification"]);
    const blocked = (await git(repo, ["rev-parse", "HEAD"])).trim();
    await expect(releaseRepositorySnapshot(repo, blocked)).rejects.toThrow(/threat model is not human-authored/);
  });

  it("admits every exact deterministic check and preserves the one ratified skip", () => {
    const manifest = fixtureManifest();
    const result = evaluateDeterministicAdmission(manifest, deterministicEvidence(manifest));
    expect(result).toMatchObject({ completeness: "complete", verdict: "pass", violation_ids: [] });
  });

  it("negative control: unlisted skip, missing CI, and stale subject cannot become green", () => {
    const manifest = fixtureManifest();
    const unlisted = deterministicEvidence(manifest);
    unlisted.checks[0]!.skipped_case_ids.push("not-ratified");
    expect(evaluateDeterministicAdmission(manifest, unlisted)).toMatchObject({ verdict: "fail" });

    const missing = deterministicEvidence(manifest);
    missing.checks = missing.checks.filter((item) => item.id !== "core-checks");
    expect(evaluateDeterministicAdmission(manifest, missing)).toMatchObject({ completeness: "incomplete", verdict: "inconclusive" });

    const stale = deterministicEvidence(manifest);
    stale.checks[0]!.subject_digest = "f".repeat(64);
    expect(evaluateDeterministicAdmission(manifest, stale)).toMatchObject({ completeness: "incomplete", verdict: "inconclusive" });
  });
});

describe("RQ-1 L4 pairing and calibrated-judge admission", () => {
  it("keeps complete bootstrap observations inconclusive without a ratified decision rule", () => {
    const manifest = fixtureManifest();
    const result = evaluateL4Evidence(manifest, l4Evidence(manifest));
    expect(result).toMatchObject({ completeness: "complete", verdict: "inconclusive", decision_status: "proposed" });
  });

  it("negative control: refuses an automatic score from an advisory judge", () => {
    const manifest = fixtureManifest();
    const evidence = l4Evidence(manifest);
    evidence.observations[0]!.automatic_score_used = true;
    expect(evaluateL4Evidence(manifest, evidence).violation_ids.some((item) => item.includes("uncalibrated_judge_score"))).toBe(true);
  });

  it("negative control: composite grading identity prevents false reuse and requires one primary", () => {
    const manifest = fixtureManifest();
    const pairing = manifest.l4.pairings[0]!;
    pairing.attempt_ids = ["attempt-1", "attempt-2"];
    const repaired = createReleaseManifest(withoutQualificationIdAndRebind(manifest));
    const evidence = l4Evidence(repaired);
    const first = evidence.observations.find((item) => item.pairing_id === pairing.id && item.attempt_id === "attempt-1")!;
    const second = evidence.observations.find((item) => item.pairing_id === pairing.id && item.attempt_id === "attempt-2")!;
    second.output_sha256 = first.output_sha256;
    second.grading_key = first.grading_key;
    expect(evaluateL4Evidence(repaired, evidence).violation_ids.some((item) => item.includes("duplicate_grade_execution"))).toBe(true);
    second.grade_reused_from = `${first.pairing_id}::${first.case_id}::${first.attempt_id}`;
    expect(evaluateL4Evidence(repaired, evidence).violation_ids.some((item) => item.includes("duplicate_grade_execution"))).toBe(false);

    expect(compositeGradeKey({
      output_sha256: first.output_sha256,
      case_digest: repaired.l4.references[0]!.case_digest,
      context_digest: digestJson({ case_digest: repaired.l4.references[0]!.case_digest, prompt_input_digest: repaired.inputs.prompts }),
      rubric_digest: repaired.l4.pairings[0]!.rubric_digest,
      reference_digest: repaired.l4.references[0]!.reference_digest,
      grader_digest: repaired.l4.pairings[0]!.grader_digest,
    })).not.toBe(compositeGradeKey({
      output_sha256: first.output_sha256,
      case_digest: repaired.l4.references[0]!.case_digest,
      context_digest: digestJson({ case_digest: repaired.l4.references[0]!.case_digest, prompt_input_digest: "f".repeat(64) }),
      rubric_digest: repaired.l4.pairings[0]!.rubric_digest,
      reference_digest: repaired.l4.references[0]!.reference_digest,
      grader_digest: repaired.l4.pairings[0]!.grader_digest,
    }));
  });
});

describe("RQ-1 completeness, evaluator debt, and attestation", () => {
  it("derives L3/L5 lane results from exact schema-validated campaign reports", () => {
    const manifest = fixtureManifest();
    const results = evaluateTriggeredCampaignEvidence(manifest, campaignEvidence(manifest));
    expect(results).toMatchObject([
      { obligation_id: "RQ-L3", completeness: "complete", verdict: "pass" },
      { obligation_id: "RQ-L5", completeness: "complete", verdict: "pass" },
    ]);
  });

  it("negative control: a stale target cannot become an L3 pass and malformed campaign truth is refused", () => {
    const manifest = fixtureManifest();
    const stale = campaignEvidence(manifest);
    stale.campaigns[0]!.report.target.commit = "f".repeat(40);
    expect(evaluateTriggeredCampaignEvidence(manifest, stale)[0]).toMatchObject({
      completeness: "incomplete", verdict: "inconclusive",
    });
    const malformed = campaignEvidence(manifest);
    malformed.campaigns[0]!.report.coverage.missing_case_ids = ["invented-missing"];
    expect(() => evaluateTriggeredCampaignEvidence(manifest, malformed)).toThrow(/required minus collected/);
  });

  it("qualifies only after exact evaluator debt disposition while preserving L4 inconclusive", () => {
    const { manifest, results, debt, report } = qualifiedFixture();
    expect(report.outcome).toEqual({ completeness: "complete", verdict: "pass", qualification: "qualified", blocker_ids: [] });
    expect(report.lane_results.find((item) => item.lane === "L4")?.verdict).toBe("inconclusive");
    expect(() => validateReleaseQualificationReport(report, manifest)).not.toThrow();

    const noDebt = assessReleaseQualification({ manifest, laneResults: results, debtDispositions: [], generatedAt: report.generated_at });
    expect(noDebt.outcome).toMatchObject({ verdict: "inconclusive", qualification: "needs_human_disposition" });
    expect(debt.evidence_sha256).toBe(results.find((item) => item.lane === "L4")?.evidence_sha256);
  });

  it("negative control: forged incomplete pass and product-failure debt are rejected", () => {
    const { manifest, results, debt, report } = qualifiedFixture();
    const forged = structuredClone(report);
    forged.lane_results[0]!.completeness = "incomplete";
    forged.lane_results[0]!.verdict = "pass";
    expect(() => validateReleaseQualificationReport(forged, manifest)).toThrow(/incomplete.*inconclusive|pass requires complete/);

    const productFailure = structuredClone(results);
    const l3 = productFailure.find((item) => item.lane === "L3")!;
    l3.verdict = "fail";
    l3.violation_ids = ["guardrail-bypass"];
    const attempt = assessReleaseQualification({ manifest, laneResults: productFailure, debtDispositions: [debt], generatedAt: report.generated_at });
    expect(attempt.outcome).toMatchObject({ verdict: "fail", qualification: "not_qualified" });

    const incompleteEval = structuredClone(results);
    const l4 = incompleteEval.find((item) => item.lane === "L4")!;
    l4.completeness = "incomplete";
    const incompleteAttempt = assessReleaseQualification({ manifest, laneResults: incompleteEval, debtDispositions: [debt], generatedAt: report.generated_at });
    expect(incompleteAttempt.outcome).toMatchObject({ completeness: "incomplete", verdict: "inconclusive", qualification: "needs_human_disposition" });
  });

  it("admits only an exact human-dispositioned evaluator-only producer repair", () => {
    const { manifest, results, debt, report } = qualifiedFixture();
    const drifted = structuredClone(results);
    const prior = "0".repeat(64);
    const priorEvidence = l4Evidence(manifest);
    priorEvidence.qualification_id = "f".repeat(64);
    priorEvidence.producer_digest = prior;
    const l4 = evaluateL4Evidence(manifest, priorEvidence);
    expect(l4).toMatchObject({
      subject_digest: releaseSubjectDigest(manifest),
      producer_digest: prior,
      reason_codes: expect.arrayContaining(["prior_qualification_id"]),
    });
    drifted.splice(drifted.findIndex((item) => item.lane === "L4"), 1, l4);
    debt.evidence_sha256 = l4.evidence_sha256;
    const disposition: EvidenceChangeDispositionV1 = {
      disposition_id: "CHANGE-L4-FIXTURE",
      obligation_id: l4.obligation_id,
      candidate_commit: manifest.candidate_commit,
      prior_producer_digest: prior,
      current_producer_digest: manifest.obligations.find((item) => item.id === l4.obligation_id)!.producer_digest,
      decision: "unaffected",
      defect_id: "fixture-evaluator-defect",
      changed_files: [{ path: "tests/eval-runner/eval-runner.ts", prior_sha256: "1".repeat(64), current_sha256: "2".repeat(64) }],
      detector_case_ids: ["CF-HARNESS-CURRENCY"],
      decided_by: "fixture-human",
      decided_at: "2026-08-05T01:30:00.000Z",
    };
    expect(assessReleaseQualification({
      manifest, laneResults: drifted, debtDispositions: [debt],
      evidenceChangeDispositions: [disposition], generatedAt: report.generated_at,
    }).outcome).toMatchObject({ qualification: "qualified", completeness: "complete" });
    expect(assessReleaseQualification({
      manifest, laneResults: drifted, debtDispositions: [debt], generatedAt: report.generated_at,
    }).outcome).toMatchObject({ qualification: "needs_human_disposition" });
  });

  it("negative control: evaluator-change disposition cannot excuse a build producer or missing detector", () => {
    const { manifest, results, report } = qualifiedFixture();
    const deterministic = results.find((item) => item.lane === "deterministic")!;
    deterministic.producer_digest = "0".repeat(64);
    const disposition: EvidenceChangeDispositionV1 = {
      disposition_id: "CHANGE-BUILD-FORGE",
      obligation_id: deterministic.obligation_id,
      candidate_commit: manifest.candidate_commit,
      prior_producer_digest: deterministic.producer_digest,
      current_producer_digest: manifest.obligations.find((item) => item.id === deterministic.obligation_id)!.producer_digest,
      decision: "unaffected",
      defect_id: "claimed-build-change",
      changed_files: [{ path: "src/org/release-evidence.ts", prior_sha256: "1".repeat(64), current_sha256: "2".repeat(64) }],
      detector_case_ids: ["CF-HARNESS-CURRENCY"],
      decided_by: "fixture-human",
      decided_at: "2026-08-05T01:30:00.000Z",
    };
    expect(assessReleaseQualification({
      manifest, laneResults: results, debtDispositions: [],
      evidenceChangeDispositions: [disposition], generatedAt: report.generated_at,
    }).outcome.blocker_ids).toContain(`stale_producer:${deterministic.obligation_id}`);
    disposition.detector_case_ids = [];
    expect(() => assessReleaseQualification({
      manifest, laneResults: results, debtDispositions: [],
      evidenceChangeDispositions: [disposition], generatedAt: report.generated_at,
    })).toThrow(/requires detector evidence/);
  });

  it("negative control: evidence-only containment rejects path escape", () => {
    const manifest = fixtureManifest();
    expect(() => validateEvidenceOnlyChangedPaths(manifest.package.version, manifest.qualification_id, ["src/org/release-evidence.ts"])).toThrow(/outside evidence namespace/);
    expect(() => validateEvidenceOnlyChangedPaths(manifest.package.version, manifest.qualification_id, [`release-evidence/${manifest.package.version}/${manifest.qualification_id}/../escape`])).toThrow(/contained relative path/);
  });

  it("verifies exact packet, package, annotated approval, and tamper refusal", async () => {
    const { manifest, report } = qualifiedFixture();
    const root = await mkdtemp(join(tmpdir(), "rq1-packet-")); roots.push(root);
    const packet = join(root, "release-evidence", manifest.package.version, manifest.qualification_id);
    await mkdir(packet, { recursive: true });
    const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
    const reportBytes = `${JSON.stringify(report, null, 2)}\n`;
    const evidenceBytes = {
      "campaign-index.json": `${JSON.stringify(campaignEvidence(manifest), null, 2)}\n`,
      "deterministic-results.json": `${JSON.stringify(deterministicEvidence(manifest), null, 2)}\n`,
      "l4-results.json": `${JSON.stringify(l4Evidence(manifest), null, 2)}\n`,
      "qualification-report.json": reportBytes,
      "release-manifest.json": manifestBytes,
    };
    await Promise.all(Object.entries(evidenceBytes).map(([path, bytes]) => writeFile(join(packet, path), bytes, "utf8")));
    const packetFiles = Object.entries(evidenceBytes).map(([path, bytes]) => ({
      path, size: Buffer.byteLength(bytes), sha256: sha256(bytes),
    }));
    const action: ReleaseActionV1 = { kind: "npm_publish", package_name: "cormidia", version: "0.1.2", tag: "v0.1.2", dist_tag: "latest", registry: "https://registry.npmjs.org" };
    const releaseCommit = "b".repeat(40);
    const attestation = createReleaseAttestation({
      manifest, report, releaseCommit, tag: action.tag,
      changedPaths: packetFiles.map((item) => `release-evidence/${manifest.package.version}/${manifest.qualification_id}/${item.path}`),
      packetFiles, releaseAction: action, createdAt: "2026-08-05T02:00:00.000Z",
    });
    const approval = {
      schema_version: 1 as const, contract_id: "RQ-1" as const, decision: "approved" as const,
      approved_by: "bikramgupta", approved_at: "2026-08-05T02:01:00.000Z",
      attestation_sha256: digestJson(attestation), release_action_sha256: attestation.release_action_sha256,
    };
    const envelope = parseReleaseTagMessage(createReleaseTagMessage(attestation, approval));
    expect(() => validateReleaseCommitLineage(manifest, attestation, packetFiles.map((item) => `release-evidence/${manifest.package.version}/${manifest.qualification_id}/${item.path}`))).not.toThrow();
    expect(() => validateReleaseCommitLineage(manifest, attestation, [...packetFiles.map((item) => `release-evidence/${manifest.package.version}/${manifest.qualification_id}/${item.path}`), "README.md"])).toThrow(/outside evidence namespace/);
    await expect(verifyReleasePacket({ packetDir: packet, currentCommit: releaseCommit, currentTag: action.tag, currentPackage: manifest.package, attestation: envelope.attestation, approval: envelope.approval })).resolves.toMatchObject({ report: { outcome: { qualification: "qualified" } } });

    await writeFile(join(packet, "qualification-report.json"), `${reportBytes} `, "utf8");
    await expect(verifyReleasePacket({ packetDir: packet, currentCommit: releaseCommit, currentTag: action.tag, currentPackage: manifest.package, attestation, approval })).rejects.toThrow(/hash mismatch/);
    await writeFile(join(packet, "qualification-report.json"), reportBytes, "utf8");
    const forgedDeterministic = deterministicEvidence(manifest);
    forgedDeterministic.checks = forgedDeterministic.checks.filter((item) => item.id !== "core-checks");
    await writeFile(join(packet, "deterministic-results.json"), `${JSON.stringify(forgedDeterministic, null, 2)}\n`, "utf8");
    await expect(verifyReleasePacket({ packetDir: packet, currentCommit: releaseCommit, currentTag: action.tag, currentPackage: manifest.package, attestation, approval })).rejects.toThrow(/do not derive from the packet evidence|hash mismatch/);
    await writeFile(join(packet, "deterministic-results.json"), evidenceBytes["deterministic-results.json"], "utf8");
    const changedPackage = structuredClone(manifest.package); changedPackage.tarball_sha256 = "f".repeat(64);
    await expect(verifyReleasePacket({ packetDir: packet, currentCommit: releaseCommit, currentTag: action.tag, currentPackage: changedPackage, attestation, approval })).rejects.toThrow(/package bytes differ/);
  });

  it("negative control: tampered tag approval cannot verify", () => {
    const { manifest, report } = qualifiedFixture();
    const action: ReleaseActionV1 = { kind: "npm_publish", package_name: "cormidia", version: "0.1.2", tag: "v0.1.2", dist_tag: "latest", registry: "https://registry.npmjs.org" };
    const attestation = createReleaseAttestation({
      manifest, report, releaseCommit: "b".repeat(40), tag: action.tag,
      changedPaths: [
        `release-evidence/${manifest.package.version}/${manifest.qualification_id}/campaign-index.json`,
        `release-evidence/${manifest.package.version}/${manifest.qualification_id}/deterministic-results.json`,
        `release-evidence/${manifest.package.version}/${manifest.qualification_id}/l4-results.json`,
        `release-evidence/${manifest.package.version}/${manifest.qualification_id}/qualification-report.json`,
        `release-evidence/${manifest.package.version}/${manifest.qualification_id}/release-manifest.json`,
      ],
      packetFiles: [
        { path: "campaign-index.json", size: 1, sha256: "a".repeat(64) },
        { path: "deterministic-results.json", size: 1, sha256: "b".repeat(64) },
        { path: "l4-results.json", size: 1, sha256: "e".repeat(64) },
        { path: "qualification-report.json", size: 1, sha256: "c".repeat(64) },
        { path: "release-manifest.json", size: 1, sha256: "d".repeat(64) },
      ],
      releaseAction: action, createdAt: "2026-08-05T02:00:00.000Z",
    });
    const approval = {
      schema_version: 1 as const, contract_id: "RQ-1" as const, decision: "approved" as const,
      approved_by: "bikramgupta", approved_at: "2026-08-05T02:01:00.000Z",
      attestation_sha256: "f".repeat(64), release_action_sha256: attestation.release_action_sha256,
    };
    expect(() => createReleaseTagMessage(attestation, approval)).toThrow(/not bound/);
    expect(() => createReleaseAttestation({
      manifest, report, releaseCommit: "b".repeat(40), tag: action.tag,
      changedPaths: [
        `release-evidence/${manifest.package.version}/${manifest.qualification_id}/campaign-index.json`,
        `release-evidence/${manifest.package.version}/${manifest.qualification_id}/deterministic-results.json`,
        `release-evidence/${manifest.package.version}/${manifest.qualification_id}/l4-results.json`,
        `release-evidence/${manifest.package.version}/${manifest.qualification_id}/qualification-report.json`,
        `release-evidence/${manifest.package.version}/${manifest.qualification_id}/release-manifest.json`,
      ],
      packetFiles: [
        { path: "campaign-index.json", size: 1, sha256: "a".repeat(64) },
        { path: "deterministic-results.json", size: 1, sha256: "b".repeat(64) },
        { path: "l4-results.json", size: 1, sha256: "e".repeat(64) },
        { path: "qualification-report.json", size: 1, sha256: "c".repeat(64) },
        { path: "release-manifest.json", size: 1, sha256: "d".repeat(64) },
      ],
      releaseAction: { ...action, dist_tag: "next" }, createdAt: "2026-08-05T02:00:00.000Z",
    })).toThrow(/supported latest/);
  });

  it("derives the B-17 tag attestation from the exact evidence-only merge and rejects an extra changed path", async () => {
    const repo = await mkdtemp(join(tmpdir(), "rq1-b17-")); roots.push(repo);
    const sourceCases = repositoryGoldenCases("pending");
    await writeRepositoryFixture(repo, sourceCases, false, "0".repeat(40));
    await git(repo, ["init", "-q"]);
    await git(repo, ["config", "user.email", "fixture@example.test"]);
    await git(repo, ["config", "user.name", "Fixture"]);
    await git(repo, ["add", "."]); await git(repo, ["commit", "-qm", "source references"]);
    const sourceCommit = (await git(repo, ["rev-parse", "HEAD"])).trim();
    await writeRepositoryFixture(repo, repositoryGoldenCases("validated"), true, sourceCommit, sourceCases);
    await git(repo, ["add", "."]); await git(repo, ["commit", "-qm", "candidate"]);
    const candidate = (await git(repo, ["rev-parse", "HEAD"])).trim();
    const manifest = await repositoryFixtureManifest(repo, candidate);
    const report = qualifiedReportFor(manifest);
    const packet = join(repo, "release-evidence", manifest.package.version, manifest.qualification_id);
    await mkdir(packet, { recursive: true });
    await writeFile(join(packet, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(join(packet, "qualification-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(join(packet, "deterministic-results.json"), `${JSON.stringify(deterministicEvidence(manifest), null, 2)}\n`, "utf8");
    await writeFile(join(packet, "l4-results.json"), `${JSON.stringify(l4Evidence(manifest), null, 2)}\n`, "utf8");
    await writeFile(join(packet, "campaign-index.json"), `${JSON.stringify(campaignEvidence(manifest), null, 2)}\n`, "utf8");
    await git(repo, ["add", "."]); await git(repo, ["commit", "-qm", "evidence only"]);
    const releaseCommit = (await git(repo, ["rev-parse", "HEAD"])).trim();
    const handoff = await createReleaseAttestationFromCommit({
      repo, releaseCommit, tag: "v0.1.2",
    });
    expect(handoff.attestation).toMatchObject({
      prepared_commit: candidate,
      release_commit: releaseCommit,
      tag: "v0.1.2",
      packet_files: [
        { path: "campaign-index.json" },
        { path: "deterministic-results.json" },
        { path: "l4-results.json" },
        { path: "qualification-report.json" },
        { path: "release-manifest.json" },
      ],
    });
    expect(await createReleaseAttestationFromCommit({ repo, releaseCommit, tag: "v0.1.2" })).toEqual(handoff);

    await writeFile(join(repo, "README.md"), "not evidence\n", "utf8");
    await git(repo, ["add", "README.md"]); await git(repo, ["commit", "-qm", "seeded path escape"]);
    const changedRelease = (await git(repo, ["rev-parse", "HEAD"])).trim();
    await expect(createReleaseAttestationFromCommit({
      repo, releaseCommit: changedRelease, tag: "v0.1.2",
    })).rejects.toThrow(/outside evidence namespace/);
  });
});

function fixtureManifest(): ReleaseManifestV1 { return createReleaseManifest(fixtureBody()); }

function fixtureBody(): ReleaseManifestBodyV1 {
  const l4: ReleaseManifestBodyV1["l4"] = {
    mode: "bootstrap",
    sites: ["reviewer", "planner", "validation-designer"],
    references: [
      reference("REV-001", "reviewer", "1"),
      reference("PLAN-001", "planner", "2"),
      reference("VAL-001", "validation-designer", "3"),
    ],
    pairings: [
      pairing("PAIR-REV", "reviewer", "review", "fixture", "reviewer/codex/model/medium", "REV-001", "4"),
      pairing("PAIR-PLAN", "planner", "plan", "planner/codex/model/medium", "human", "PLAN-001", "5"),
      pairing("PAIR-VAL", "validation-designer", "validation-design", "validation-designer/codex/model/medium", "human", "VAL-001", "6"),
    ],
  };
  const packageManifest = {
    name: "cormidia", version: "0.1.2", filename: "cormidia-0.1.2.tgz",
    tarball_sha256: "7".repeat(64), tarball_integrity: `sha512-${Buffer.alloc(64, 8).toString("base64")}`,
    files: [{ path: "package.json", size: 123, sha256: "9".repeat(64) }],
  };
  const assignments = [
    { assignment_id: "planner:fixed", role: "planner", source: "fixed" as const, runtime: "claude", model: "fixture-planner", efforts: ["xhigh"] },
    { assignment_id: "reviewer:fixed", role: "reviewer", source: "fixed" as const, runtime: "claude", model: "fixture-reviewer", efforts: ["xhigh"] },
    { assignment_id: "validation-designer:fixed", role: "validation-designer", source: "fixed" as const, runtime: "codex", model: "fixture-validation", efforts: ["high"] },
  ];
  const toolchain = {
    node: "26.4.0", pnpm: "11.10.0", typescript: "5.9.3", vitest: "3.2.6",
    claude_agent_sdk: "0.3.201", pi_coding_agent: "0.80.7", openai_codex: "0.144.4",
    platform: "darwin", architecture: "arm64",
  };
  const inputs = {
    policy: "a".repeat(64), dependency_lock: "b".repeat(64), prompts: "c".repeat(64),
    roles: "d".repeat(64), pipelines: "e".repeat(64), taste: "f".repeat(64),
    golden_sets: "1".repeat(64), assignments: digestJson(assignments), tools: digestJson(toolchain),
  };
  const threatModel = {
    artifact_sha256: "4".repeat(64), status_sha256: "5".repeat(64), human_authored: true as const, human_reviewed: true as const,
    covered_surfaces: Array.from({ length: 10 }, (_, index) => `TM-${String(index + 1).padStart(2, "0")}`),
    abuse_case_ids: ["ABUSE-001"],
  };
  const triggeredCampaigns: ReleaseManifestBodyV1["triggered_campaigns"] = [
    {
      obligation_id: "RQ-L3", campaign_id: "release-l3-fixture", lane: "L3",
      campaign_kind: "release", trigger: "human_authorized_release_qualification",
      apps: ["Cormidia"], scopes: ["supported-adapters"], tuples: ["fixture-adapter"],
      required_case_ids: ["L3-RELEASE-FIXTURE"], max_provider_turns: 24, max_equiv_usd: 100,
      decision_status: "ratified",
    },
    {
      obligation_id: "RQ-L5", campaign_id: "release-l5-fixture", lane: "L5",
      campaign_kind: "soak", trigger: "human_authorized_release_qualification",
      apps: ["Cormidia"], scopes: ["seven-day-soak"], tuples: [],
      required_case_ids: ["L5-SOAK-FIXTURE"], max_provider_turns: 24, max_equiv_usd: 15,
      decision_status: "ratified",
    },
  ];
  const body: ReleaseManifestBodyV1 = {
    schema_version: 1, contract_id: "RQ-1", prepared_at: "2026-08-05T01:00:00.000Z",
    repository: "cormidia/Cormidia", candidate_commit: "a".repeat(40), clean_tracked_tree: true, package: packageManifest,
    inputs, assignments, toolchain,
    human_authorization: { authorized_by: "bikramgupta", authorized_at: "2026-08-05T00:59:00.000Z", purpose: "fixture qualification", approval_ref: "fixture:approval" },
    threat_model: threatModel,
    deterministic: { required_checks: [...RELEASE_DETERMINISTIC_CHECKS], allowed_test_skips: ["BLOCKED:F-PT-EXAMPLE"], producer_digest: "6".repeat(64) },
    l4,
    triggered_campaigns: triggeredCampaigns,
    ceilings: { l3_premerge: { max_provider_turns: 2, max_equiv_usd: 5 }, l3_release: { max_provider_turns: 24, max_equiv_usd: 100 }, l4: { max_provider_turns: 20, max_equiv_usd: 40, max_tokens: 100_000, authorization_ref: "fixture:l4-envelope" }, l5: { max_provider_turns: 24, max_equiv_usd: 15 } },
    retry_policy: { merit_failures: "never", github_total_attempts: 3, ambiguous_writes: "single_shot_then_reconcile", provider_retry: "predeclared_typed_infrastructure_only", unknown_partial_usage: "debit_full_reservation" },
    obligations: [],
  };
  const subject = releaseSubjectDigest(body);
  body.obligations = [
    obligation("RQ-DET", "deterministic", "build", false, subject, "6"),
    obligation("RQ-L3", "L3", "product", false, subject, "7"),
    obligation("RQ-L4", "L4", "evaluator_evidence", true, subject, "8"),
    obligation("RQ-L5", "L5", "safety", false, subject, "9"),
  ];
  return body;
}

function reference(caseId: string, site: "reviewer" | "planner" | "validation-designer", seed: string) {
  return { case_id: caseId, site, path: `validation-design/golden-sets/${site}/cases.json`, case_digest: seed.repeat(64), reference_digest: String(Number(seed) + 3).repeat(64), human_validation: "validated" as const, validated_by: "bikramgupta", validated_on: "2026-08-04", source_commit: "a".repeat(40) };
}

function pairing(id: string, site: "reviewer" | "planner" | "validation-designer", operation: string, producer: string, evaluator: string, caseId: string, seed: string) {
  return { id, site, operation, arm: "bootstrap" as const, producer_tuple: producer, evaluator_tuple: evaluator, rubric_version: "v1", rubric_digest: seed.repeat(64), grader_digest: String(Number(seed) + 1).repeat(64), evaluator_status: "human_review" as const, decision_rule_digest: null, case_ids: [caseId], attempt_ids: ["attempt-1"] };
}

function obligation(id: string, lane: "deterministic" | "L3" | "L4" | "L5", claimClass: ReleaseObligationV1["claim_class"], debtEligible: boolean, subject: string, producerSeed: string): ReleaseObligationV1 {
  return { id, lane, required: true, claim_class: claimClass, debt_eligible: debtEligible, subject_digest: subject, producer_digest: producerSeed.repeat(64) };
}

function deterministicEvidence(manifest: ReleaseManifestV1): DeterministicEvidenceV1 {
  return {
    schema_version: 1, qualification_id: manifest.qualification_id,
    checks: RELEASE_DETERMINISTIC_CHECKS.map((id) => ({
      id, status: "pass", candidate_commit: manifest.candidate_commit,
      subject_digest: releaseSubjectDigest(manifest), producer_digest: manifest.deterministic.producer_digest,
      evidence_ref: `ci:${id}`, skipped_case_ids: id === "pnpm-test" ? ["BLOCKED:F-PT-EXAMPLE"] : [],
    })),
  };
}

function l4Evidence(manifest: ReleaseManifestV1): L4ReleaseEvidenceV1 {
  const observations = manifest.l4.pairings.flatMap((pairing) => pairing.case_ids.flatMap((caseId) => pairing.attempt_ids.map((attemptId) => {
    const reference = manifest.l4.references.find((item) => item.case_id === caseId)!;
    const outputSha = sha256(`${pairing.id}:${caseId}:${attemptId}`);
    return {
      pairing_id: pairing.id, case_id: caseId, attempt_id: attemptId,
      output_sha256: outputSha,
      grading_key: compositeGradeKey({ output_sha256: outputSha, case_digest: reference.case_digest, context_digest: digestJson({ case_digest: reference.case_digest, prompt_input_digest: manifest.inputs.prompts }), rubric_digest: pairing.rubric_digest, reference_digest: reference.reference_digest, grader_digest: pairing.grader_digest }),
      grade_reused_from: null, automatic_score_used: false, outcome: "match" as const,
      evidence_ref: `campaign:l4#${pairing.id}:${caseId}:${attemptId}`,
    };
  })));
  const obligation = manifest.obligations.find((item) => item.lane === "L4")!;
  return {
    schema_version: 1,
    qualification_id: manifest.qualification_id,
    subject_digest: obligation.subject_digest,
    producer_digest: obligation.producer_digest,
    observations,
  };
}

function campaignEvidence(manifest: ReleaseManifestV1): ReleaseCampaignEvidenceV1 {
  return {
    schema_version: 1,
    qualification_id: manifest.qualification_id,
    campaigns: manifest.triggered_campaigns.map((declared) => {
      const obligation = manifest.obligations.find((item) => item.id === declared.obligation_id)!;
      return {
        obligation_id: declared.obligation_id,
        producer_digest: obligation.producer_digest,
        report: {
          schema_version: 1,
          campaign_id: declared.campaign_id,
          lane: declared.lane,
          campaign_kind: declared.campaign_kind,
          trigger: declared.trigger,
          status: "completed" as const,
          started_at: "2026-08-05T01:00:00.000Z",
          finished_at: "2026-08-05T02:00:00.000Z",
          policy: { path: "/fixture/validation-policy.yaml", sha256: manifest.inputs.policy },
          target: {
            commit: manifest.candidate_commit,
            apps: [...declared.apps],
            scopes: [...declared.scopes],
            tuples: [...declared.tuples],
          },
          spend: {
            max_provider_turns: declared.max_provider_turns,
            max_equiv_usd: declared.max_equiv_usd,
            observed_provider_turns: 1,
            observed_equiv_usd: 1,
            ceiling_exhausted: false,
          },
          coverage: {
            required_case_ids: [...declared.required_case_ids],
            collected_case_ids: [...declared.required_case_ids],
            missing_case_ids: [],
          },
          outcome: {
            completeness: "complete" as const,
            verdict: "pass" as const,
            decision_status: declared.decision_status,
            violation_ids: [],
            reason_codes: [],
          },
          evidence_refs: [`fixture:${declared.campaign_id}`],
        },
      };
    }),
  };
}

function qualifiedFixture(): { manifest: ReleaseManifestV1; results: ReleaseLaneResultV1[]; debt: EvaluatorDebtDispositionV1; report: ReleaseQualificationReportV1 } {
  const manifest = fixtureManifest();
  const deterministic = evaluateDeterministicAdmission(manifest, deterministicEvidence(manifest));
  const l4 = evaluateL4Evidence(manifest, l4Evidence(manifest));
  const results = [deterministic, ...evaluateTriggeredCampaignEvidence(manifest, campaignEvidence(manifest)), l4];
  const debt: EvaluatorDebtDispositionV1 = {
    debt_id: "DEBT-L4-BOOTSTRAP", obligation_id: l4.obligation_id, evidence_sha256: l4.evidence_sha256,
    candidate_commit: manifest.candidate_commit, consequence: "No automatic statistical quality claim", owner: "Cormidia product owner",
    invalidation_trigger: "Any affected L4 subject or decision-rule change", accepted_by: "bikramgupta", accepted_at: "2026-08-05T01:30:00.000Z", decision: "accepted",
  };
  const report = assessReleaseQualification({ manifest, laneResults: results, debtDispositions: [debt], generatedAt: "2026-08-05T01:31:00.000Z" });
  return { manifest, results, debt, report };
}

async function repositoryFixtureManifest(repo: string, candidate: string): Promise<ReleaseManifestV1> {
  const snapshot = await releaseRepositorySnapshot(repo, candidate);
  const body = fixtureBody();
  body.candidate_commit = candidate;
  body.inputs = snapshot.inputs;
  body.assignments = snapshot.assignments;
  body.toolchain = snapshot.toolchain;
  body.threat_model = snapshot.threat_model;
  body.l4.references = snapshot.golden_references;
  body.l4.pairings = snapshot.golden_references.map((item, index) => pairing(
    `PAIR-${index + 1}`,
    item.site,
    item.site === "reviewer" ? "review" : item.site === "planner" ? "plan" : "validation-design",
    `${item.site}/fixture/model/high`,
    "human",
    item.case_id,
    String(index + 1),
  ));
  const subject = releaseSubjectDigest({ ...body, qualification_id: "0".repeat(64) });
  body.obligations = body.obligations.map((item) => ({ ...item, subject_digest: subject }));
  return createReleaseManifest(body);
}

function qualifiedReportFor(manifest: ReleaseManifestV1): ReleaseQualificationReportV1 {
  const deterministic = evaluateDeterministicAdmission(manifest, deterministicEvidence(manifest));
  const l4 = evaluateL4Evidence(manifest, l4Evidence(manifest));
  const results = [deterministic, ...evaluateTriggeredCampaignEvidence(manifest, campaignEvidence(manifest)), l4];
  const debt: EvaluatorDebtDispositionV1 = {
    debt_id: "DEBT-L4-REPOSITORY", obligation_id: l4.obligation_id,
    evidence_sha256: l4.evidence_sha256, candidate_commit: manifest.candidate_commit,
    consequence: "Bootstrap quality remains advisory", owner: "fixture owner",
    invalidation_trigger: "Any L4 evidence change", accepted_by: "fixture-human",
    accepted_at: "2026-08-05T02:30:00.000Z", decision: "accepted",
  };
  return assessReleaseQualification({
    manifest, laneResults: results, debtDispositions: [debt], generatedAt: "2026-08-05T02:31:00.000Z",
  });
}

function withoutQualificationId(manifest: ReleaseManifestV1): ReleaseManifestBodyV1 {
  const copy = structuredClone(manifest) as ReleaseManifestV1;
  const { qualification_id: _, ...body } = copy;
  return body;
}

function withoutQualificationIdAndRebind(manifest: ReleaseManifestV1): ReleaseManifestBodyV1 {
  const body = withoutQualificationId(manifest);
  const subject = releaseSubjectDigest(body);
  body.obligations = body.obligations.map((item) => ({ ...item, subject_digest: subject }));
  return body;
}

function repositoryGoldenCases(status: "pending" | "validated"): Array<Record<string, unknown>> {
  return [
    ["GS-REV-FIXTURE", "reviewer", { verdict: "REJECT", rubric_anchors: ["reject defect"] }],
    ["GS-PLAN-FIXTURE", "planner", { rubric_anchors: ["complete accounting"] }],
    ["GS-VAL-FIXTURE", "validation-designer", { rubric_anchors: ["cheapest layer"] }],
  ].map(([id, site, expected]) => ({
    schema_version: 1, id, site, sub_site: "fixture", case_class: "fixture", prompt: `Prompt for ${id}`,
    expected, token_reservation: 100,
    provenance: {
      author: "Fixture agent", authored_at: "2026-08-04", source_refs: ["fixture"],
      human_validation: status,
      ...(status === "validated" ? { validated_by: "fixture-human" } : {}),
    },
  }));
}

async function writeRepositoryFixture(
  repo: string,
  cases: Array<Record<string, unknown>>,
  threatRatified: boolean,
  sourceCommit: string,
  sourceCases: Array<Record<string, unknown>> = cases,
): Promise<void> {
  const validation = join(repo, "validation-design");
  await mkdir(join(repo, "prompts"), { recursive: true });
  await mkdir(join(validation, "golden-sets", "reviewer"), { recursive: true });
  await mkdir(join(validation, "golden-sets", "planner"), { recursive: true });
  await mkdir(join(validation, "golden-sets", "validation-designer"), { recursive: true });
  await writeFile(join(validation, "validation-policy.yaml"), "schema_version: 1\n", "utf8");
  await writeFile(join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  await writeFile(join(repo, "prompts", "fixture.md"), "fixture prompt\n", "utf8");
  await writeFile(join(repo, "roles.yaml"), "roles:\n  planner:\n    runtime: claude\n    model: fixture\n    effort: high\n", "utf8");
  await writeFile(join(repo, "pipelines.yaml"), "pipelines: {}\n", "utf8");
  await writeFile(join(repo, "TASTE.md"), "# Fixture taste\n", "utf8");
  await writeFile(join(repo, "package.json"), `${JSON.stringify({
    packageManager: "pnpm@11.10.0", engines: { node: ">=26" },
    dependencies: { "@anthropic-ai/claude-agent-sdk": "0.3.201", "@earendil-works/pi-coding-agent": "0.80.7", "@openai/codex": "0.144.4" },
    devDependencies: { typescript: "5.9.3", vitest: "3.2.6" },
  }, null, 2)}\n`, "utf8");
  for (const [packagePath, version] of [
    ["typescript", "5.9.3"], ["vitest", "3.2.6"],
    ["@anthropic-ai/claude-agent-sdk", "0.3.201"],
    ["@earendil-works/pi-coding-agent", "0.80.7"], ["@openai/codex", "0.144.4"],
  ]) {
    const path = join(repo, "node_modules", ...packagePath!.split("/"));
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "package.json"), `${JSON.stringify({ version })}\n`, "utf8");
  }
  for (const site of ["reviewer", "planner", "validation-designer"] as const) {
    await writeFile(join(validation, "golden-sets", site, "cases.json"), `${JSON.stringify(cases.filter((item) => item.site === site), null, 2)}\n`, "utf8");
  }
  const records = sourceCases.map((item) => ({
    case_id: item.id,
    path: `validation-design/golden-sets/${item.site}/cases.json`,
    source_case_digest: digestJson(item),
    result: "confirm",
  })).sort((left, right) => String(left.case_id).localeCompare(String(right.case_id)));
  await writeFile(join(validation, "golden-sets", "human-validation.json"), `${JSON.stringify({
    schema_version: 1, validation_kind: "RQ-1-golden-reference-review", validated_by: "fixture-human",
    validated_on: "2026-08-04", source_commit: sourceCommit, human_statement: "Fixture confirmation", recorded_by: "Fixture recorder", records,
  }, null, 2)}\n`, "utf8");
  const threatArtifact = "# Human-authored fixture threat model\n";
  await writeFile(join(validation, "threat-model.md"), threatArtifact, "utf8");
  await writeFile(join(validation, "threat-model-status.yaml"), threatStatus(threatRatified, sha256(threatArtifact)), "utf8");
}

function threatStatus(ratified: boolean, artifactSha: string): string {
  return [
    "schema_version: 1",
    `status: ${ratified ? "ratified" : "awaiting_human_author"}`,
    `human_authored: ${ratified}`,
    `human_reviewed: ${ratified}`,
    "artifact: threat-model.md",
    `artifact_sha256: ${ratified ? artifactSha : "null"}`,
    `author: ${ratified ? "fixture-author" : "null"}`,
    `authored_at: ${ratified ? "2026-08-04T20:00:00.000Z" : "null"}`,
    `reviewer: ${ratified ? "fixture-reviewer" : "null"}`,
    `reviewed_at: ${ratified ? "2026-08-04T21:00:00.000Z" : "null"}`,
    `covered_surfaces: ${ratified ? `[${Array.from({ length: 10 }, (_, index) => `TM-${String(index + 1).padStart(2, "0")}`).join(", ")}]` : "[]"}`,
    `abuse_case_ids: ${ratified ? "[ABUSE-001]" : "[]"}`,
    `release_gating_acknowledged: ${ratified}`,
    "",
  ].join("\n");
}

async function git(repo: string, args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", repo, ...args], { encoding: "utf8" });
  return result.stdout;
}
