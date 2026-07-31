import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadYamlFile, validateCampaign, type CampaignManifest } from "./core.js";
import { verifyReleaseAttestation, type ReleaseAttestation } from "./release-attestation.js";

// The fail-closed release product-CURRENCY gate. Unlike the offline dev suite —
// which asserts evidence INTEGRITY only and is green whenever the committed
// evidence is intact — this command recomputes the live product identity and
// refuses when the built tree no longer matches the qualified pin
// (docs/PURPOSE.md 2026-07-17). It never repairs or mutates anything: it loads
// the committed attestation and its committed campaign(s) and runs the full
// verifyReleaseAttestation. A moved, rebuilt, or fabricated product exits
// non-zero. This is the gate that stands in for the (now decoupled) per-commit
// currency check; it is invoked at release time (see the release-currency job in
// .github/workflows/efficiency-qualification.yml), not on every push.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_ATTESTATION_PATH = "research/evals/phase6-release-attestation.json";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function options(name: string): string[] {
  return process.argv.flatMap((value, index) => (value === name && process.argv[index + 1] ? [process.argv[index + 1]!] : []));
}

function loadCampaign(path: string): CampaignManifest {
  const value = loadYamlFile(path);
  const errors = validateCampaign(value);
  if (errors.length > 0) throw new Error(`release_verify_invalid_campaign:${path}:${errors.join(";")}`);
  return value as CampaignManifest;
}

try {
  const attestationRel = option("--attestation") ?? DEFAULT_ATTESTATION_PATH;
  const attestationPath = resolve(root, attestationRel);
  if (!existsSync(attestationPath)) throw new Error(`release_verify_attestation_missing:${attestationRel}`);
  const attestation = JSON.parse(readFileSync(attestationPath, "utf8")) as ReleaseAttestation;

  // Campaign paths: explicit --campaign flags, else derive one per campaign the
  // attestation lists (research/evals/campaigns/<id>/campaign.yaml).
  const explicit = options("--campaign").map((path) => resolve(path));
  const campaignPaths = explicit.length > 0
    ? explicit
    : (Array.isArray(attestation.campaigns) ? attestation.campaigns : []).map((entry) => resolve(root, "research/evals/campaigns", entry.campaign_id, "campaign.yaml"));
  if (campaignPaths.length === 0) throw new Error("release_verify_no_campaigns");

  for (const campaignPath of campaignPaths) {
    if (!existsSync(campaignPath)) throw new Error(`release_verify_campaign_missing:${campaignPath}`);
    const campaign = loadCampaign(campaignPath);
    // Fail-closed: throws (e.g. release_attestation_package_mismatch) when the
    // live product no longer matches the qualified pin.
    verifyReleaseAttestation({ root, path: attestationPath, campaign });
  }

  console.log(JSON.stringify({
    schema_version: 1,
    result: "release-currency-verified",
    attestation: attestationRel,
    campaigns: campaignPaths.map((path) => resolve(path).slice(root.length + 1)),
  }, null, 2));
} catch (error) {
  console.error(`release currency gate FAILED (fail-closed): ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
