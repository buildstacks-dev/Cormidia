import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { ARTIFACT_ROOT, HARNESS_ROOT, assertArtifactPath } from "../fixtures/controlled-world.js";
import { loadValidationPolicy } from "../policy/load.js";

interface Lane {
  id: string;
  kind: "typecheck" | "vitest";
  targets?: string[];
}

interface LaneResult {
  id: string;
  status: "passed" | "failed";
  exitCode: number;
  durationMs: number;
  evidence: string;
  diagnostics?: string;
}

interface AssertionEvidence {
  lane: string;
  file: string;
  title: string;
  status: "passed" | "failed" | "skipped" | "pending" | "todo" | "unknown";
}

const lanes: Lane[] = [
  { id: "typecheck", kind: "typecheck" },
  { id: "layer_1_2_deterministic", kind: "vitest", targets: ["specs/layer-1", "specs/layer-2"] },
  { id: "layer_3_driver_preflight", kind: "vitest", targets: ["specs/layer-3"] },
  { id: "layer_4_runner_contract", kind: "vitest", targets: ["specs/layer-4"] },
  { id: "layer_5_accelerated_slice", kind: "vitest", targets: ["specs/layer-5"] },
];

const outputDir = assertArtifactPath(resolve(ARTIFACT_ROOT, "local-validation"));
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const policyPath = resolve(HARNESS_ROOT, "validation-policy.yaml");
const policy = await loadValidationPolicy(policyPath);
const policySource = await readFile(policyPath);
const packageSource = await readFile(resolve(HARNESS_ROOT, "package.json"), "utf8");
const packageManifest = JSON.parse(packageSource) as {
  packageManager: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const lockSource = await readFile(resolve(HARNESS_ROOT, "pnpm-lock.yaml"));
const harnessSourceSha256 = await hashHarnessSource();
const beforeInventory = await inventoryOutsideArtifactRoot();
const results: LaneResult[] = [];

for (const lane of lanes) {
  const started = Date.now();
  const evidencePath = resolve(outputDir, `${lane.id}.${lane.kind === "vitest" ? "json" : "log"}`);
  const execution =
    lane.kind === "typecheck"
      ? spawnSync(
          process.execPath,
          [
            resolve(HARNESS_ROOT, "node_modules", "typescript", "bin", "tsc"),
            "-p",
            resolve(HARNESS_ROOT, "tsconfig.json"),
            "--noEmit",
          ],
          { cwd: HARNESS_ROOT, encoding: "utf8", env: { ...process.env, CI: "true" } },
        )
      : spawnSync(
          process.execPath,
          [
            resolve(HARNESS_ROOT, "node_modules", "vitest", "vitest.mjs"),
            "run",
            "--config",
            resolve(HARNESS_ROOT, "vitest.config.ts"),
            "--reporter=json",
            `--outputFile=${evidencePath}`,
            ...(lane.targets ?? []),
          ],
          { cwd: HARNESS_ROOT, encoding: "utf8", env: { ...process.env, CI: "true" } },
        );
  const exitCode = execution.status ?? 1;
  let diagnostics: string | undefined;
  if (lane.kind === "typecheck") {
    await writeFile(
      evidencePath,
      [
        execution.stdout ?? "",
        execution.stderr ?? "",
        execution.error?.stack ?? execution.error?.message ?? "",
      ].filter((entry) => entry !== "").join("\n"),
      "utf8",
    );
  } else if (exitCode !== 0) {
    const diagnosticPath = resolve(outputDir, `${lane.id}.log`);
    await writeFile(
      diagnosticPath,
      [
        execution.stdout ?? "",
        execution.stderr ?? "",
        execution.error?.stack ?? execution.error?.message ?? "",
      ].filter((entry) => entry !== "").join("\n"),
      "utf8",
    );
    diagnostics = `./.artifacts/local-validation/${lane.id}.log`;
    if (!existsSync(evidencePath)) {
      await writeFile(
        evidencePath,
        `${JSON.stringify(
          {
            schema_version: 1,
            status: "runner_failed_before_structured_report",
            exit_code: exitCode,
            diagnostics,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
  }
  results.push({
    id: lane.id,
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
    durationMs: Date.now() - started,
    evidence: `./.artifacts/local-validation/${lane.id}.${lane.kind === "vitest" ? "json" : "log"}`,
    ...(diagnostics === undefined ? {} : { diagnostics }),
  });
}

const evidenceIntegrityStarted = Date.now();
const assertionEvidence = await readAssertionEvidence();
const evidenceIntegrityPath = resolve(outputDir, "structured_evidence_integrity.json");
await writeFile(
  evidenceIntegrityPath,
  `${JSON.stringify(
    {
      schema_version: 1,
      reports_expected: lanes.filter((lane) => lane.kind === "vitest").map((lane) => lane.id),
      reports_valid: assertionEvidence.errors.length === 0,
      errors: assertionEvidence.errors,
      assertion_counts: countAssertions(assertionEvidence.assertions),
      failures: assertionEvidence.assertions.filter((assertion) => assertion.status === "failed"),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
results.push({
  id: "structured_evidence_integrity",
  status: assertionEvidence.errors.length === 0 ? "passed" : "failed",
  exitCode: assertionEvidence.errors.length === 0 ? 0 : 1,
  durationMs: Date.now() - evidenceIntegrityStarted,
  evidence: "./.artifacts/local-validation/structured_evidence_integrity.json",
});

const confinementStarted = Date.now();
const afterInventory = await inventoryOutsideArtifactRoot();
const confinementChanges = compareInventories(beforeInventory, afterInventory);
const confinementEvidence = resolve(outputDir, "generated_output_confinement.json");
await writeFile(
  confinementEvidence,
  `${JSON.stringify(
    {
      schema_version: 1,
      authorized_output_root: ARTIFACT_ROOT,
      inspected_root: HARNESS_ROOT,
      changes_outside_authorized_root: confinementChanges,
      verdict: confinementChanges.length === 0 ? "passed" : "failed",
    },
    null,
    2,
  )}\n`,
  "utf8",
);
results.push({
  id: "generated_output_confinement",
  status: confinementChanges.length === 0 ? "passed" : "failed",
  exitCode: confinementChanges.length === 0 ? 0 : 1,
  durationMs: Date.now() - confinementStarted,
  evidence: "./.artifacts/local-validation/generated_output_confinement.json",
});

const failed = results.filter((result) => result.status === "failed");
const manifest = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  claim_scope: "local_non_spending_controlled_foundation",
  verdict:
    failed.length === 0
      ? "local_controlled_foundation_passed_with_required_external_gates_absent"
      : "local_controlled_foundation_failed",
  policy: {
    status: policy.status,
    sha256: createHash("sha256").update(policySource).digest("hex"),
  },
  source: {
    repository_head: readRevision(),
    harness_source_sha256: harnessSourceSha256,
    lockfile_sha256: createHash("sha256").update(lockSource).digest("hex"),
  },
  toolchain: {
    node: process.version,
    pnpm: commandVersion("pnpm", ["--version"]),
    git: commandVersion("git", ["--version"]),
    package: "operon-validation-harness@0.0.0",
    package_manager: packageManifest.packageManager,
    dependencies: packageManifest.dependencies,
    dev_dependencies: packageManifest.devDependencies,
  },
  target_identity: {
    kind: "isolated_local_controlled_world",
    external_target: null,
  },
  authorization: {
    applicable: false,
    record: null,
    reason: "local non-spending and non-mutating validation only",
  },
  spend: {
    ceiling_usd: 0,
    observed_usd: 0,
    billing_mode: "none",
  },
  case_ids: [
    "OPERON-CASE-WS-001",
    "OPERON-CASE-WS-002",
    "OPERON-CASE-WS-003",
    "OPERON-CASE-WS-004",
    "OPERON-CASE-WS-005",
    "OPERON-CASE-WS-006",
    "OPERON-CASE-DET-001",
    "OPERON-CASE-DET-002",
    "OPERON-CASE-DET-003",
    "OPERON-CASE-DET-004",
    "OPERON-CASE-OPS-001",
    "OPERON-CASE-OPS-002",
    "OPERON-L4-002-DET-001A",
    "OPERON-L4-002-DET-001B",
    "OPERON-L4-002-DET-002",
    "OPERON-L4-002-DET-003",
    "OPERON-L4-003-DET-002",
    "OPERON-L4-003-DET-003",
    "OPERON-L4-004-DET-001",
  ],
  deterministic_seeds: {
    assignment_property: 20260729,
    controlled_clock_start: "2026-01-01T00:00:00.000Z",
  },
  evidence_deposits: [
    "./.artifacts/operational/accelerated-90-day-production-composition.json",
    "./.artifacts/layer-4/OPERON-L4-002/preflight.json",
    "./.artifacts/layer-4/OPERON-L4-002/diagnostic-evidence-audit.json",
    "./.artifacts/layer-4/OPERON-L4-002/qualification/qualification-evidence-audit.json",
    "./.artifacts/layer-4/OPERON-L4-003/diagnostic-evidence-audit.json",
    "./.artifacts/layer-4/OPERON-L4-003/qualification/qualification-evidence-audit.json",
    "./.artifacts/layer-4/OPERON-L4-004/diagnostic-evidence-audit.json",
    "./.artifacts/layer-4/OPERON-L4-004/qualification/qualification-evidence-audit.json",
    "./.artifacts/layer-4/OPERON-L4-005/diagnostic-evidence-audit.json",
    "./.artifacts/layer-4/OPERON-L4-005/qualification/qualification-evidence-audit.json",
  ],
  reports: [
    "./traceability-report.md",
    "./residual-blocking-report.md",
  ],
  lanes: results,
  assertion_summary: countAssertions(assertionEvidence.assertions),
  blocking_failures: assertionEvidence.assertions.filter(
    (assertion) => assertion.status === "failed",
  ),
  known_blocking_defects: [
    {
      id: "TM-002",
      case_id: "OPERON-CASE-DET-001",
      summary:
        "production Pi masked-context writer follows a repository-controlled .pi symlink outside the worktree",
      production_modified: false,
    },
    {
      id: "TM-011",
      case_id: "OPERON-CASE-DET-004",
      summary:
        "concurrent approve and deny operations can persist contradictory decision log, grant, caller, and authoritative approval state",
      production_modified: false,
    },
  ],
  blocking_absent: [
    "real_live_sandbox_execution",
    "passing_live_provider_model_harness_qualification",
    "human_ratified_llm_quality_thresholds_beyond_OPERON-L4-001",
    "judge_meta_evaluation",
    "real_time_72_hour_production_shaped_soak",
    "additive_ci_integration",
    "comprehensive_risk_weighted_case_expansion",
    "attributable_threat_model_and_residual_risk_review",
    "full_contention_disaster_recovery_retention_suite",
  ],
  skips_and_waivers: {
    waivers: [],
    authorized_but_not_run: [],
  },
  uncertainty: [
    "local controlled seams cannot prove vendor, host scheduler, registry, CI, or publication behavior",
    "OPERON-L4-002 completed the full 10 x 3 provider campaign but failed the OPERON-EP-004 critical-case floor, so it does not qualify the model or final-artifact quality",
    "the immutable OPERON-L4-002 full-stage spend ledger has an incorrect embedded campaign ID; the correct limits were enforced, the audit fails attribution, and a deterministic detector prevents recurrence",
    "OPERON-L4-003 passed its EP004 diagnostic but stopped its full stage on an attributable EP003 missing-gate repair failure",
    "OPERON-L4-004 passed its EP003 diagnostic but stopped its full stage on an attributable EP004 initial-plan self-supersession repair failure",
    "OPERON-L4-005 passed its EP004 diagnostic but stopped its full stage on an attributable EP003 JavaScript-undefined then self-supersession repair failure; the candidate remains unqualified",
  ],
  out_of_scope: [
    "incumbent_equivalence_migration",
    "incumbent_replacement",
    "cutover",
  ],
  explicit_non_claims: {
    production_qualified: false,
    external_operations_executed: false,
    real_time_soak_satisfied: false,
    incumbent_replacement_authorized: false,
  },
};
await writeFile(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

for (const result of results) {
  process.stdout.write(
    `${result.status === "passed" ? "PASS" : "FAIL"} ${result.id} (${result.durationMs}ms)\n`,
  );
}
process.stdout.write(`Evidence: ${resolve(outputDir, "manifest.json")}\n`);
if (failed.length > 0) process.exitCode = 1;

function readRevision(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: resolve(HARNESS_ROOT, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unavailable";
  }
}

function commandVersion(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      cwd: HARNESS_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unavailable";
  }
}

async function hashHarnessSource(): Promise<string> {
  const hash = createHash("sha256");
  for (const path of await listHarnessEntries({ excludeNodeModules: true })) {
    const name = relative(HARNESS_ROOT, path).split("\\").join("/");
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      hash.update(`link\0${name}\0${await readlink(path)}\0`);
    } else if (metadata.isFile()) {
      hash.update(`file\0${name}\0`);
      hash.update(await readFile(path));
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}

async function inventoryOutsideArtifactRoot(): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  for (const path of await listHarnessEntries({ excludeNodeModules: false })) {
    const name = relative(HARNESS_ROOT, path).split("\\").join("/");
    const metadata = await lstat(path);
    entries.set(
      name,
      metadata.isSymbolicLink()
        ? `link:${await readlink(path)}:${metadata.mtimeMs}`
        : `file:${metadata.size}:${metadata.mtimeMs}`,
    );
  }
  return entries;
}

async function listHarnessEntries(options: { excludeNodeModules: boolean }): Promise<string[]> {
  const entries: string[] = [];
  await walk(HARNESS_ROOT);
  return entries.sort();

  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (path === ARTIFACT_ROOT) continue;
      if (options.excludeNodeModules && path === resolve(HARNESS_ROOT, "node_modules")) continue;
      if (entry.isDirectory()) await walk(path);
      else entries.push(path);
    }
  }
}

function compareInventories(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths]
    .filter((path) => before.get(path) !== after.get(path))
    .sort()
    .map((path) => {
      if (!before.has(path)) return `added:${path}`;
      if (!after.has(path)) return `removed:${path}`;
      return `modified:${path}`;
    });
}

async function readAssertionEvidence(): Promise<{
  assertions: AssertionEvidence[];
  errors: string[];
}> {
  const assertions: AssertionEvidence[] = [];
  const errors: string[] = [];
  for (const lane of lanes.filter((candidate) => candidate.kind === "vitest")) {
    const path = resolve(outputDir, `${lane.id}.json`);
    let report: unknown;
    try {
      report = JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch (error) {
      errors.push(`${lane.id}: unreadable JSON report: ${errorMessage(error)}`);
      continue;
    }
    if (!isRecord(report) || !Array.isArray(report.testResults)) {
      errors.push(`${lane.id}: report is missing testResults`);
      continue;
    }
    for (const [testIndex, testResultValue] of report.testResults.entries()) {
      if (!isRecord(testResultValue) || !Array.isArray(testResultValue.assertionResults)) {
        errors.push(`${lane.id}: testResults[${testIndex}] is malformed`);
        continue;
      }
      const file =
        typeof testResultValue.name === "string"
          ? relative(resolve(HARNESS_ROOT, ".."), testResultValue.name).split("\\").join("/")
          : "<unknown>";
      for (const [assertionIndex, assertionValue] of testResultValue.assertionResults.entries()) {
        if (
          !isRecord(assertionValue) ||
          typeof assertionValue.fullName !== "string" ||
          typeof assertionValue.status !== "string"
        ) {
          errors.push(
            `${lane.id}: testResults[${testIndex}].assertionResults[${assertionIndex}] is malformed`,
          );
          continue;
        }
        assertions.push({
          lane: lane.id,
          file,
          title: assertionValue.fullName,
          status: normalizeAssertionStatus(assertionValue.status),
        });
      }
    }
  }
  return { assertions, errors };
}

function countAssertions(assertions: AssertionEvidence[]): {
  total: number;
  passed: number;
  failed: number;
  skipped_or_other: number;
} {
  return {
    total: assertions.length,
    passed: assertions.filter((assertion) => assertion.status === "passed").length,
    failed: assertions.filter((assertion) => assertion.status === "failed").length,
    skipped_or_other: assertions.filter(
      (assertion) => assertion.status !== "passed" && assertion.status !== "failed",
    ).length,
  };
}

function normalizeAssertionStatus(status: string): AssertionEvidence["status"] {
  return status === "passed" ||
      status === "failed" ||
      status === "skipped" ||
      status === "pending" ||
      status === "todo"
    ? status
    : "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
