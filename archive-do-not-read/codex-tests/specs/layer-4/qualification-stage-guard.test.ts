import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ARTIFACT_ROOT, HARNESS_ROOT } from "../../src/fixtures/controlled-world.js";

const command = resolve(
  HARNESS_ROOT,
  "src",
  "cli",
  "run-episode-planner-campaign.ts",
);
const qualificationRoot = resolve(
  ARTIFACT_ROOT,
  "layer-4",
  "OPERON-L4-002",
  "qualification",
);
const protectedEvidence = [
  resolve(qualificationRoot, "spend-ledger.json"),
  resolve(qualificationRoot, "campaign-report.json"),
];

describe("OPERON-L4-002 full qualification guard", () => {
  it("verifies the exact candidate, diagnostic, corpus, and authorization without a provider turn", () => {
    const before = evidenceHashes();
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", command, "--stage", "qualification"],
      { cwd: HARNESS_ROOT, encoding: "utf8" },
    );

    expect([0, 2]).toContain(result.status);
    const preflight = JSON.parse(result.stdout) as {
      campaign_id: string;
      mode: string;
      authorization: { status: string };
      corpus: { cases: number; runs_per_case: number };
      prompt: {
        composition: string;
        overlay_sha256: string | null;
        protected_prompt_modified: boolean;
      };
      diagnostic_evidence: {
        passed: boolean;
      } | null;
      spend: {
        aggregate_ceiling_usd: number;
        per_turn_ceiling_usd: number;
      };
      external_effects_authorized: boolean;
    };
    expect(preflight).toMatchObject({
      campaign_id: "OPERON-L4-002",
      mode: "preflight_only",
      authorization: { status: "human_authorized" },
      corpus: { cases: 10, runs_per_case: 3 },
      prompt: {
        composition: "protected_base_plus_diagnostic_candidate_overlay",
        protected_prompt_modified: false,
      },
      diagnostic_evidence: { passed: true },
      spend: {
        aggregate_ceiling_usd: 60,
        per_turn_ceiling_usd: 5,
      },
      external_effects_authorized: false,
    });
    expect(preflight.prompt.overlay_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidenceHashes()).toEqual(before);
  });

  it("refuses a mismatched execution authorization before creating spend or result evidence", () => {
    const before = evidenceHashes();
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        command,
        "--stage",
        "qualification",
        "--execute",
        "--authorization",
        "OPERON-L4-001",
      ],
      { cwd: HARNESS_ROOT, encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "provider execution requires --authorization OPERON-L4-002",
    );
    expect(evidenceHashes()).toEqual(before);
  });
});

describe("OPERON-L4-003 full qualification guard", () => {
  const root = resolve(
    ARTIFACT_ROOT,
    "layer-4",
    "OPERON-L4-003",
    "qualification",
  );
  const terminalEvidence = [
    resolve(root, "spend-ledger.json"),
    resolve(root, "campaign-report.json"),
  ];

  it("binds the corrected diagnostic audit and delegated $60 ceiling", () => {
    const before = hashes(terminalEvidence);
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        command,
        "--stage",
        "qualification",
        "--campaign",
        "OPERON-L4-003",
      ],
      { cwd: HARNESS_ROOT, encoding: "utf8" },
    );

    expect([0, 2]).toContain(result.status);
    expect(JSON.parse(result.stdout)).toMatchObject({
      campaign_id: "OPERON-L4-003",
      mode: "preflight_only",
      authorization: { status: "human_authorized_by_delegation" },
      diagnostic_evidence: { passed: true },
      spend: {
        aggregate_ceiling_usd: 60,
        per_turn_ceiling_usd: 5,
      },
      external_effects_authorized: false,
    });
    expect(hashes(terminalEvidence)).toEqual(before);
  });

  it("refuses a mismatched execution identity before provider admission", () => {
    const before = hashes(terminalEvidence);
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        command,
        "--stage",
        "qualification",
        "--campaign",
        "OPERON-L4-003",
        "--execute",
        "--authorization",
        "OPERON-L4-002",
      ],
      { cwd: HARNESS_ROOT, encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "provider execution requires --authorization OPERON-L4-003",
    );
    expect(hashes(terminalEvidence)).toEqual(before);
  });
});

describe("OPERON-L4-005 full qualification guard", () => {
  const root = resolve(
    ARTIFACT_ROOT,
    "layer-4",
    "OPERON-L4-005",
    "qualification",
  );
  const terminalEvidence = [
    resolve(root, "spend-ledger.json"),
    resolve(root, "campaign-report.json"),
  ];

  it("binds the audited diagnostic and delegated $60 ceiling", () => {
    const before = hashes(terminalEvidence);
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        command,
        "--stage",
        "qualification",
        "--campaign",
        "OPERON-L4-005",
      ],
      { cwd: HARNESS_ROOT, encoding: "utf8" },
    );

    expect([0, 2]).toContain(result.status);
    expect(JSON.parse(result.stdout)).toMatchObject({
      campaign_id: "OPERON-L4-005",
      mode: "preflight_only",
      authorization: { status: "human_authorized_by_delegation" },
      diagnostic_evidence: { passed: true },
      spend: {
        aggregate_ceiling_usd: 60,
        per_turn_ceiling_usd: 5,
      },
      external_effects_authorized: false,
    });
    expect(hashes(terminalEvidence)).toEqual(before);
  });
});

function evidenceHashes(): Array<string | null> {
  return hashes(protectedEvidence);
}

function hashes(paths: string[]): Array<string | null> {
  return paths.map((path) =>
    existsSync(path)
      ? createHash("sha256").update(readFileSync(path)).digest("hex")
      : null,
  );
}
