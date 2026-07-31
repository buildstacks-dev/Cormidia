import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadYamlFile, type CampaignManifest } from "../../scripts/eval/core.js";
import { releasePackageHash } from "../../scripts/eval/candidate-hash.js";
import {
  verifyAttestationIntegrity,
  verifyReleaseAttestation,
  type ReleaseAttestation,
} from "../../scripts/eval/release-attestation.js";

// P0-07 / ROOT-001 integrity/currency separation (docs/PURPOSE.md 2026-07-17).
//
// The committed Phase 6 attestation is bound to a candidate that pre-dates the
// legitimate Waves 0-4 src changes, so the LIVE `npm pack` no longer hashes to
// the qualified pin. This file pins BOTH halves of the ratified split against the
// real committed evidence + the current (moved) tree:
//
//   (a) evidence INTEGRITY is deterministic and green on intact evidence — this
//       is what makes the nine required contracts genuinely-green offline, and
//       it must stay green even though the product moved;
//   (b) product-CURRENCY is still enforced fail-closed at the release gate —
//       verifyReleaseAttestation, `eval:release-verify`, and `eval:attest-release`
//       all refuse the moved product. Decoupling did NOT drop currency.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const attestationRel = "research/evals/phase6-release-attestation.json";
const attestationPath = join(root, attestationRel);
const attestation = JSON.parse(readFileSync(attestationPath, "utf8")) as ReleaseAttestation;
const campaignId = attestation.campaigns[0]!.campaign_id;
const campaignPath = join(root, "research/evals/campaigns", campaignId, "campaign.yaml");
const campaign = loadYamlFile(campaignPath) as CampaignManifest;

const scratchRoot = join(root, ".eval-artifacts");
mkdirSync(scratchRoot, { recursive: true });
const dir = mkdtempSync(join(scratchRoot, "integrity-currency-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The current, real product-drift state: is the live package still the pin?
const liveReleaseHash = `sha256:${releasePackageHash(root)}`;
const productMoved = liveReleaseHash !== attestation.release_package_sha256;

describe("offline evidence INTEGRITY (deterministic; green on intact evidence)", () => {
  it("verifyAttestationIntegrity passes on the committed attestation against the current (moved) tree", () => {
    // This is the exact property that makes the nine required contracts green in
    // the offline suite: integrity never recomputes a live-product hash, so a
    // legitimate src change cannot redden it. If currency ever leaks back into
    // the integrity path, this assertion fails.
    const value = verifyAttestationIntegrity({ root, path: attestationPath, campaign });
    expect(value.release_package_sha256).toBe(attestation.release_package_sha256);
  });

  it("integrity is not weakened: it still throws on a torn attestation", () => {
    const torn = { ...attestation } as Record<string, unknown>;
    delete torn.promotion_paths_sha256;
    const path = join(dir, "torn.json");
    writeFileSync(path, `${JSON.stringify(torn, null, 2)}\n`);
    expect(() => verifyAttestationIntegrity({ root, path, campaign })).toThrow("release_attestation_invalid_keys");
  });

  it("integrity is not weakened: it still throws on a mis-bound (foreign) campaign", () => {
    const foreign = structuredClone(campaign);
    foreign.org_fingerprint = `sha256:${"f".repeat(64)}`;
    expect(() => verifyAttestationIntegrity({ root, path: attestationPath, campaign: foreign })).toThrow("release_attestation_candidate_mismatch");
  });
});

describe("release product-CURRENCY (fail-closed; refuses the moved product)", () => {
  it("verifyReleaseAttestation throws a currency code on the current moved product", () => {
    if (!productMoved) {
      // Post-requalification: the pin was refreshed to match the live product, so
      // currency now passes. The gate is still wired — it simply agrees.
      expect(() => verifyReleaseAttestation({ root, path: attestationPath, campaign })).not.toThrow();
      return;
    }
    expect(() => verifyReleaseAttestation({ root, path: attestationPath, campaign })).toThrow("release_attestation_package_mismatch");
  });

  it("`pnpm eval:release-verify` exits non-zero (fail-closed) on the moved product", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/eval/release-verify.ts"], { cwd: root, encoding: "utf8" });
    if (!productMoved) {
      expect(result.status).toBe(0);
      return;
    }
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("release_attestation_package_mismatch");
  });

  it("`pnpm eval:attest-release` refuses to MINT a fresh attestation for the moved product", () => {
    if (!productMoved) return;
    // Write to a scratch out path so a hypothetical success could never overwrite
    // the committed attestation. createReleaseAttestation throws before any write.
    const out = join(dir, "attest-probe.json");
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/eval/attest-release.ts", "--campaign", campaignPath, "--out", out], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("release_package_bytes_changed_after_qualification");
    expect(existsSync(out)).toBe(false);
  });
});
