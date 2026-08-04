// HB-006 — policy loader + artifact-location pin (Layer 1).
//
// Parses validation-design/validation-policy.yaml (the ratified harness
// contract, tighten-only) into a typed structure the harness can rely on, and
// exposes the audit surfaces policy-pin.test.ts pins per commit:
//
//   - loadValidationPolicy(repoRoot)  — parse + shape-check; missing relied-on
//     fields throw PolicyLoadError; unknown extra fields are tolerated (and
//     preserved on `raw`).
//   - resolveArtifacts / missingArtifacts — every `artifacts:` path must
//     resolve relative to the policy file's directory; a directory artifact
//     that exists but is empty is NOT green (no green by absence).
//   - auditRatifiedPins — the human-ratified constants of 2026-07-31: design
//     status, blocked findings F-PT-006/F-PT-008, and the L3 spend bounds.
//     Changing any of these is a human policy edit; drift goes red so a human
//     looks.
//   - auditCoreChecksWorkflow — pins the per-commit CI lane shape
//     (policy `ci.rule`: removing a gate in CI without a policy change is a
//     policy violation).
//   - auditVitestConfigs — pins lane separation (L3 live lane never runs per
//     commit) and passWithNoTests=false (no green by absence).
//
// All audit functions return a list of violations (empty = compliant) so the
// negative controls in policy-pin.test.ts can prove each detector fires on a
// seeded violation (policy `harness_self_tests`: a detector that has never
// fired is an assumption).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";

/** Policy file location, relative to the repo root. */
export const POLICY_RELATIVE_PATH = "validation-design/validation-policy.yaml";

export class PolicyLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyLoadError";
  }
}

// ---------------------------------------------------------------------------
// Typed shape — only the fields the harness relies on are required; every
// interface carries an index signature so unknown extra fields pass through.
// ---------------------------------------------------------------------------

export interface ProtectedPath {
  readonly path: string;
  readonly rule: string;
  readonly [extra: string]: unknown;
}

/** L3/L5 obligation rows vary in shape; only `id` is load-bearing here. */
export interface ObligationRow {
  readonly id: string;
  readonly [extra: string]: unknown;
}

export interface SpendBound {
  readonly scope: string;
  readonly max_provider_turns: number;
  readonly max_equiv_usd: number;
  readonly [extra: string]: unknown;
}

export interface SpendPolicy {
  readonly pre_merge_adapter_campaign: SpendBound;
  readonly release_campaign: SpendBound;
  readonly on_ceiling_exhaustion: string;
  readonly [extra: string]: unknown;
}

export interface LayerCommon {
  readonly status: string;
  readonly [extra: string]: unknown;
}

export interface L3Layer {
  readonly status: string;
  readonly obligations: readonly ObligationRow[];
  readonly spend_policy: SpendPolicy;
  readonly [extra: string]: unknown;
}

export interface L5Layer {
  readonly status: string;
  readonly obligations: readonly ObligationRow[];
  readonly [extra: string]: unknown;
}

export interface Layers {
  readonly L1_invariant_contract: LayerCommon;
  readonly L2_hermetic: LayerCommon;
  readonly L3_live_sandbox: L3Layer;
  readonly L4_eval: LayerCommon;
  readonly L5_ops: L5Layer;
  readonly [extra: string]: unknown;
}

export interface VerdictSemantics {
  readonly completeness: readonly string[];
  readonly verdict: readonly string[];
  readonly rules: readonly string[];
  readonly [extra: string]: unknown;
}

export interface CiBlock {
  readonly host: string;
  readonly per_commit: readonly string[];
  readonly per_commit_gate_class: string;
  readonly per_commit_enforcement_status: string;
  readonly rule: string;
  readonly [extra: string]: unknown;
}

export interface ProposedRegisterItem {
  readonly id: number;
  readonly decision_status: string;
  readonly value: string;
  readonly [extra: string]: unknown;
}

export interface ProposedRegister {
  readonly items: readonly ProposedRegisterItem[];
  readonly [extra: string]: unknown;
}

export interface OpenFinding {
  readonly id: string;
  readonly status: string;
  readonly subject: string;
  readonly [extra: string]: unknown;
}

export interface ValidationPolicy {
  readonly schema_version: number;
  readonly scope: string;
  readonly design_status: string;
  readonly artifacts: Readonly<Record<string, string>>;
  readonly implementation_root: string;
  readonly protected_paths: readonly ProtectedPath[];
  readonly layers: Layers;
  readonly verdict_semantics: VerdictSemantics;
  readonly ci: CiBlock;
  readonly proposed_register: ProposedRegister;
  readonly open_findings: readonly OpenFinding[];
  readonly case_sourcing: readonly string[];
  readonly harness_self_tests: readonly string[];
  /** Absolute path of the parsed policy file. */
  readonly policyPath: string;
  /** Absolute directory `artifacts:` paths resolve against (the policy file's dir). */
  readonly designRoot: string;
  /** Absolute repo root the loader was pointed at. */
  readonly repoRoot: string;
  /** Full parsed document — unknown extra fields tolerated and preserved. */
  readonly raw: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Runtime narrowing helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function reqField(obj: Record<string, unknown>, where: string, key: string): unknown {
  const value = obj[key];
  if (value === undefined || value === null) {
    throw new PolicyLoadError(`missing relied-on field: ${where}${key}`);
  }
  return value;
}

function reqString(obj: Record<string, unknown>, where: string, key: string): string {
  const value = reqField(obj, where, key);
  if (!isString(value)) {
    throw new PolicyLoadError(`relied-on field ${where}${key} must be a string`);
  }
  return value;
}

function reqNumber(obj: Record<string, unknown>, where: string, key: string): number {
  const value = reqField(obj, where, key);
  if (!isNumber(value)) {
    throw new PolicyLoadError(`relied-on field ${where}${key} must be a finite number`);
  }
  return value;
}

function reqRecord(
  obj: Record<string, unknown>,
  where: string,
  key: string,
): Record<string, unknown> {
  const value = reqField(obj, where, key);
  if (!isRecord(value)) {
    throw new PolicyLoadError(`relied-on field ${where}${key} must be a mapping`);
  }
  return value;
}

function reqArray(obj: Record<string, unknown>, where: string, key: string): unknown[] {
  const value = reqField(obj, where, key);
  if (!Array.isArray(value)) {
    throw new PolicyLoadError(`relied-on field ${where}${key} must be a sequence`);
  }
  return value;
}

function reqStringArray(obj: Record<string, unknown>, where: string, key: string): string[] {
  const value = reqArray(obj, where, key);
  if (!isStringArray(value)) {
    throw new PolicyLoadError(`relied-on field ${where}${key} must be a sequence of strings`);
  }
  return value;
}

function obligationRows(
  obj: Record<string, unknown>,
  where: string,
): readonly ObligationRow[] {
  return reqArray(obj, where, "obligations").map((entry, i) => {
    if (!isRecord(entry)) {
      throw new PolicyLoadError(`${where}obligations[${i}] must be a mapping`);
    }
    const id = reqString(entry, `${where}obligations[${i}].`, "id");
    return { ...entry, id };
  });
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadValidationPolicy(repoRoot: string): ValidationPolicy {
  const absRoot = resolve(repoRoot);
  const policyPath = join(absRoot, POLICY_RELATIVE_PATH);

  let text: string;
  try {
    text = readFileSync(policyPath, "utf8");
  } catch (cause) {
    throw new PolicyLoadError(
      `cannot read validation policy at ${policyPath}: ${String(cause)}`,
    );
  }

  let doc: unknown;
  try {
    doc = parse(text);
  } catch (cause) {
    throw new PolicyLoadError(
      `validation policy at ${policyPath} is not parseable YAML: ${String(cause)}`,
    );
  }
  if (!isRecord(doc)) {
    throw new PolicyLoadError(
      `validation policy at ${policyPath} did not parse to a YAML mapping`,
    );
  }

  const schema_version = reqNumber(doc, "", "schema_version");
  const scope = reqString(doc, "", "scope");
  const design_status = reqString(doc, "", "design_status");

  const artifactsRaw = reqRecord(doc, "", "artifacts");
  const artifacts: Record<string, string> = {};
  for (const [key, value] of Object.entries(artifactsRaw)) {
    if (!isString(value) || value.length === 0) {
      throw new PolicyLoadError(`artifacts.${key} must be a non-empty path string`);
    }
    artifacts[key] = value;
  }
  if (Object.keys(artifacts).length === 0) {
    throw new PolicyLoadError(
      "artifacts: must list at least one artifact (an empty registry would pin nothing)",
    );
  }

  const implementation_root = reqString(doc, "", "implementation_root");

  const protected_paths: readonly ProtectedPath[] = reqArray(
    doc,
    "",
    "protected_paths",
  ).map((entry, i) => {
    if (!isRecord(entry)) {
      throw new PolicyLoadError(`protected_paths[${i}] must be a mapping`);
    }
    const path = reqString(entry, `protected_paths[${i}].`, "path");
    const rule = reqString(entry, `protected_paths[${i}].`, "rule");
    return { ...entry, path, rule };
  });

  const layersRaw = reqRecord(doc, "", "layers");
  const layerCommon = (key: string): LayerCommon => {
    const layer = reqRecord(layersRaw, "layers.", key);
    const status = reqString(layer, `layers.${key}.`, "status");
    return { ...layer, status };
  };

  const l3Raw = reqRecord(layersRaw, "layers.", "L3_live_sandbox");
  const l3Where = "layers.L3_live_sandbox.";
  const spendRaw = reqRecord(l3Raw, l3Where, "spend_policy");
  const spendWhere = `${l3Where}spend_policy.`;
  const spendBound = (key: string): SpendBound => {
    const bound = reqRecord(spendRaw, spendWhere, key);
    const where = `${spendWhere}${key}.`;
    return {
      ...bound,
      scope: reqString(bound, where, "scope"),
      max_provider_turns: reqNumber(bound, where, "max_provider_turns"),
      max_equiv_usd: reqNumber(bound, where, "max_equiv_usd"),
    };
  };
  const spend_policy: SpendPolicy = {
    ...spendRaw,
    pre_merge_adapter_campaign: spendBound("pre_merge_adapter_campaign"),
    release_campaign: spendBound("release_campaign"),
    on_ceiling_exhaustion: reqString(spendRaw, spendWhere, "on_ceiling_exhaustion"),
  };
  const L3_live_sandbox: L3Layer = {
    ...l3Raw,
    status: reqString(l3Raw, l3Where, "status"),
    obligations: obligationRows(l3Raw, l3Where),
    spend_policy,
  };

  const l5Raw = reqRecord(layersRaw, "layers.", "L5_ops");
  const L5_ops: L5Layer = {
    ...l5Raw,
    status: reqString(l5Raw, "layers.L5_ops.", "status"),
    obligations: obligationRows(l5Raw, "layers.L5_ops."),
  };

  const layers: Layers = {
    ...layersRaw,
    L1_invariant_contract: layerCommon("L1_invariant_contract"),
    L2_hermetic: layerCommon("L2_hermetic"),
    L3_live_sandbox,
    L4_eval: layerCommon("L4_eval"),
    L5_ops,
  };

  const vsRaw = reqRecord(doc, "", "verdict_semantics");
  const verdict_semantics: VerdictSemantics = {
    ...vsRaw,
    completeness: reqStringArray(vsRaw, "verdict_semantics.", "completeness"),
    verdict: reqStringArray(vsRaw, "verdict_semantics.", "verdict"),
    rules: reqStringArray(vsRaw, "verdict_semantics.", "rules"),
  };

  const ciRaw = reqRecord(doc, "", "ci");
  const ci: CiBlock = {
    ...ciRaw,
    host: reqString(ciRaw, "ci.", "host"),
    per_commit: reqStringArray(ciRaw, "ci.", "per_commit"),
    per_commit_gate_class: reqString(ciRaw, "ci.", "per_commit_gate_class"),
    per_commit_enforcement_status: reqString(ciRaw, "ci.", "per_commit_enforcement_status"),
    rule: reqString(ciRaw, "ci.", "rule"),
  };

  const prRaw = reqRecord(doc, "", "proposed_register");
  const items: readonly ProposedRegisterItem[] = reqArray(
    prRaw,
    "proposed_register.",
    "items",
  ).map((entry, i) => {
    if (!isRecord(entry)) {
      throw new PolicyLoadError(`proposed_register.items[${i}] must be a mapping`);
    }
    return {
      ...entry,
      id: reqNumber(entry, `proposed_register.items[${i}].`, "id"),
      decision_status: reqString(entry, `proposed_register.items[${i}].`, "decision_status"),
      value: reqString(entry, `proposed_register.items[${i}].`, "value"),
    };
  });
  const proposed_register: ProposedRegister = { ...prRaw, items };

  const open_findings: readonly OpenFinding[] = reqArray(doc, "", "open_findings").map(
    (entry, i) => {
      if (!isRecord(entry)) {
        throw new PolicyLoadError(`open_findings[${i}] must be a mapping`);
      }
      return {
        ...entry,
        id: reqString(entry, `open_findings[${i}].`, "id"),
        status: reqString(entry, `open_findings[${i}].`, "status"),
        subject: reqString(entry, `open_findings[${i}].`, "subject"),
      };
    },
  );

  const case_sourcing = reqStringArray(doc, "", "case_sourcing");
  const harness_self_tests = reqStringArray(doc, "", "harness_self_tests");

  return {
    schema_version,
    scope,
    design_status,
    artifacts,
    implementation_root,
    protected_paths,
    layers,
    verdict_semantics,
    ci,
    proposed_register,
    open_findings,
    case_sourcing,
    harness_self_tests,
    policyPath,
    designRoot: dirname(policyPath),
    repoRoot: absRoot,
    raw: doc,
  };
}

// ---------------------------------------------------------------------------
// Artifact-location pin
// ---------------------------------------------------------------------------

export interface ArtifactStatus {
  readonly key: string;
  readonly relPath: string;
  readonly absPath: string;
  /** "empty-dir": exists but pins nothing — treated as a violation. */
  readonly kind: "file" | "dir" | "missing" | "empty-dir";
}

export function resolveArtifacts(policy: ValidationPolicy): ArtifactStatus[] {
  return Object.entries(policy.artifacts).map(([key, relPath]) => {
    const absPath = resolve(policy.designRoot, relPath);
    const stat = statSync(absPath, { throwIfNoEntry: false });
    let kind: ArtifactStatus["kind"];
    if (stat === undefined) {
      kind = "missing";
    } else if (stat.isDirectory()) {
      kind = readdirSync(absPath).length === 0 ? "empty-dir" : "dir";
    } else {
      kind = "file";
    }
    return { key, relPath, absPath, kind };
  });
}

/**
 * Artifacts whose policy-declared path no longer resolves (moved/removed
 * without a policy update), plus directory artifacts that exist but are empty
 * (no green by absence). Empty result = every artifact pin holds.
 */
export function missingArtifacts(policy: ValidationPolicy): string[] {
  return resolveArtifacts(policy)
    .filter((a) => a.kind === "missing" || a.kind === "empty-dir")
    .map(
      (a) =>
        `${a.key}: ${a.relPath} (${
          a.kind === "missing" ? "does not exist" : "exists but is an empty directory"
        })`,
    );
}

// ---------------------------------------------------------------------------
// Ratified-constant pins (human-ratified 2026-07-31)
// ---------------------------------------------------------------------------

export const RATIFIED_PINS = {
  design_status: "ratified",
  /** Open-blocked findings — flipping either requires human ratification evidence. */
  blocked_findings: ["F-PT-006", "F-PT-008"],
  blocked_status: "open-blocked-contract",
  /** Spend bounds — hard bounds raisable only by a human policy edit. */
  pre_merge_adapter_campaign: { max_provider_turns: 2, max_equiv_usd: 5 },
  release_campaign: { max_provider_turns: 24, max_equiv_usd: 100 },
  hb007_decisions: [
    { id: 1, decision_status: "adjusted-ratified", value: "GitHub retry budget: 3 total attempts per operation with jittered exponential backoff and an injectable clock" },
    { id: 2, decision_status: "adjusted-ratified", value: "liveness identity: PID + process-start identity + nonce, so PID reuse cannot impersonate the holder" },
    { id: 3, decision_status: "adjusted-ratified", value: "descendant cleanup: owned process group/session; TERM, bounded grace, then KILL; prove no owned descendants remain" },
    { id: 4, decision_status: "ratified", value: "preview->execute exact-hash comparison on depended-on surfaces" },
    { id: 5, decision_status: "ratified", value: "index.lock wait <=30s, never delete/steal a foreign lock" },
    { id: 6, decision_status: "ratified", value: "hooks-disabled managed clones (core.hooksPath empty)" },
    { id: 7, decision_status: "adjusted-ratified", value: "explicit default gate caps: setup/tests 5min, lint 2min, e2e 10min; 15min is the CI core-job ceiling, not a per-gate default" },
    { id: 8, decision_status: "ratified", value: "candidate-mutation detection: candidate HEAD + tracked/decision-relevant diff + governed generated paths" },
    { id: 13, decision_status: "ratified", value: "CI per-commit wall-clock target 5min (reported optimization target only; no verdict effect)" },
  ],
} as const;

export function auditRatifiedPins(policy: ValidationPolicy): string[] {
  const violations: string[] = [];

  if (policy.design_status !== RATIFIED_PINS.design_status) {
    violations.push(
      `design_status is "${policy.design_status}" — the pinned ratified status is ` +
        `"${RATIFIED_PINS.design_status}"; a status change requires human ratification evidence`,
    );
  }

  for (const id of RATIFIED_PINS.blocked_findings) {
    const finding = policy.open_findings.find((f) => f.id === id);
    if (finding === undefined) {
      violations.push(
        `finding ${id} vanished from open_findings — blocked findings may not be ` +
          `dropped without human ratification evidence`,
      );
    } else if (finding.status !== RATIFIED_PINS.blocked_status) {
      violations.push(
        `finding ${id} status is "${finding.status}" — pinned as ` +
          `"${RATIFIED_PINS.blocked_status}"; flipping it requires human ratification evidence`,
      );
    }
  }

  const spend = policy.layers.L3_live_sandbox.spend_policy;
  const checkBound = (
    label: string,
    bound: SpendBound,
    pin: { max_provider_turns: number; max_equiv_usd: number },
  ): void => {
    if (
      bound.max_provider_turns !== pin.max_provider_turns ||
      bound.max_equiv_usd !== pin.max_equiv_usd
    ) {
      violations.push(
        `${label} spend bound is ${bound.max_provider_turns} turns / $${bound.max_equiv_usd} — ` +
          `ratified 2026-07-31 as ${pin.max_provider_turns} turns / $${pin.max_equiv_usd}; ` +
          `changing it requires a human policy edit`,
      );
    }
  };
  checkBound(
    "pre_merge_adapter_campaign",
    spend.pre_merge_adapter_campaign,
    RATIFIED_PINS.pre_merge_adapter_campaign,
  );
  checkBound("release_campaign", spend.release_campaign, RATIFIED_PINS.release_campaign);

  for (const pin of RATIFIED_PINS.hb007_decisions) {
    const item = policy.proposed_register.items.find((candidate) => candidate.id === pin.id);
    if (item === undefined) {
      violations.push(`HB-007 decision item ${pin.id} vanished from proposed_register`);
      continue;
    }
    if (item.decision_status !== pin.decision_status || item.value !== pin.value) {
      violations.push(
        `HB-007 decision item ${pin.id} drifted from the human-ratified outcome; ` +
          `changing it requires a new human policy decision`,
      );
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// CI-lane pin (.github/workflows/core-checks.yml)
// ---------------------------------------------------------------------------

function jobSteps(job: Record<string, unknown>): Record<string, unknown>[] {
  const raw = job["steps"];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord);
}

function stepRun(step: Record<string, unknown>): string {
  const run = step["run"];
  return isString(run) ? run : "";
}

function stepName(step: Record<string, unknown>): string {
  const name = step["name"];
  return isString(name) ? name : "";
}

/** True when any line of `run` invokes exactly `command` (args allowed, no suffix fusion: "pnpm test" never matches "pnpm test:live"). */
function runsCommand(run: string, command: string): boolean {
  return run.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed === command || trimmed.startsWith(`${command} `);
  });
}

function jobAllowsFailure(job: Record<string, unknown>): boolean {
  const jobLevel = job["continue-on-error"];
  if (jobLevel !== undefined && jobLevel !== false) return true;
  return jobSteps(job).some((step) => {
    const value = step["continue-on-error"];
    return value !== undefined && value !== false;
  });
}

/**
 * Pins the per-commit CI lane shape (policy `ci`): typecheck+build+test in the
 * core job, and a pinned, checksum-verified, fail-closed gitleaks job with a
 * canary negative-control step. Returns violations; empty = no drift.
 */
export function auditCoreChecksWorkflow(workflowSource: string): string[] {
  const violations: string[] = [];

  let doc: unknown;
  try {
    doc = parse(workflowSource);
  } catch (cause) {
    return [`workflow is not parseable YAML: ${String(cause)}`];
  }
  if (!isRecord(doc)) return ["workflow did not parse to a YAML mapping"];

  const on = doc["on"];
  if (!isRecord(on) || !("push" in on) || !("pull_request" in on)) {
    violations.push(
      "per-commit triggers drifted: `on:` must include both push and pull_request",
    );
  }

  const jobs = doc["jobs"];
  if (!isRecord(jobs)) {
    violations.push("workflow has no jobs mapping");
    return violations;
  }

  const core = jobs["core"];
  if (!isRecord(core)) {
    violations.push("per-commit `core` job is missing");
  } else {
    const runs = jobSteps(core).map(stepRun);
    for (const command of ["pnpm typecheck", "pnpm build", "pnpm test"]) {
      if (!runs.some((run) => runsCommand(run, command))) {
        violations.push(
          `core job no longer runs \`${command}\` (per-commit L1/L2 lane drift; policy ci.per_commit)`,
        );
      }
    }
    if (jobAllowsFailure(core)) {
      violations.push("core job is not fail-closed (continue-on-error set)");
    }
  }

  const gitleaks = jobs["gitleaks"];
  if (!isRecord(gitleaks)) {
    violations.push(
      "gitleaks secret-hygiene job is missing (policy L5_ops → secret-hygiene; ci.per_commit)",
    );
    return violations;
  }

  const env = gitleaks["env"];
  const version = isRecord(env) ? env["GITLEAKS_VERSION"] : undefined;
  if (version === undefined) {
    violations.push("gitleaks version pin (GITLEAKS_VERSION env) is missing");
  } else if (!/^\d+\.\d+\.\d+$/.test(String(version))) {
    violations.push(
      `GITLEAKS_VERSION "${String(version)}" is not an exact semver version pin`,
    );
  }
  const sha = isRecord(env) ? env["GITLEAKS_SHA256"] : undefined;
  if (!isString(sha) || !/^[0-9a-f]{64}$/.test(sha)) {
    violations.push("GITLEAKS_SHA256 checksum pin is missing or malformed");
  }

  const steps = jobSteps(gitleaks);
  const runs = steps.map(stepRun);
  if (!runs.some((run) => run.includes("sha256sum -c"))) {
    violations.push(
      "gitleaks download is not checksum-verified (no `sha256sum -c` step)",
    );
  }

  const canary = steps.find(
    (step) => /canary/i.test(stepName(step)) || /canary/i.test(stepRun(step)),
  );
  if (canary === undefined) {
    violations.push(
      "gitleaks canary negative-control step is missing (a detector that has never fired is an assumption)",
    );
  } else if (!stepRun(canary).includes("exit 1")) {
    violations.push(
      "gitleaks canary step has no failure path (`exit 1`) when the scanner fails to fire",
    );
  }

  const scan = runs.find(
    (run) => run.includes("gitleaks detect") && run.includes("--config .gitleaks.toml"),
  );
  if (scan === undefined) {
    violations.push(
      "repository gitleaks scan with the pinned config (`--config .gitleaks.toml`) is missing",
    );
  } else if (scan.includes("|| true")) {
    violations.push("gitleaks scan swallows failures (`|| true`) — must be fail-closed");
  }

  if (jobAllowsFailure(gitleaks)) {
    violations.push("gitleaks job is not fail-closed (continue-on-error set)");
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Vitest-config pin (lane separation + no green by absence)
// ---------------------------------------------------------------------------

function testBlock(config: unknown): Record<string, unknown> | undefined {
  if (!isRecord(config)) return undefined;
  const test = config["test"];
  return isRecord(test) ? test : undefined;
}

/**
 * Pins the two vitest configs: the default (per-commit) config must exclude
 * the L3 live lane and keep passWithNoTests exactly false; the live config
 * must include only tests/live/** specs. Returns violations.
 */
export function auditVitestConfigs(defaultConfig: unknown, liveConfig: unknown): string[] {
  const violations: string[] = [];

  const defaultTest = testBlock(defaultConfig);
  if (defaultTest === undefined) {
    violations.push("default vitest config has no test block");
  } else {
    const exclude = defaultTest["exclude"];
    if (!isStringArray(exclude) || !exclude.includes("tests/live/**")) {
      violations.push(
        "default vitest config no longer excludes tests/live/** — the L3 lane would run per commit",
      );
    }
    if (defaultTest["passWithNoTests"] !== false) {
      violations.push(
        "default vitest config passWithNoTests must be exactly false (no green by absence)",
      );
    }
    const include = defaultTest["include"];
    if (!isStringArray(include) || include.length === 0) {
      violations.push("default vitest config include is missing or empty");
    } else if (!include.every((pattern) => pattern.startsWith("tests/"))) {
      violations.push(
        "default vitest config include reaches outside tests/ (policy implementation_root)",
      );
    }
  }

  const liveTest = testBlock(liveConfig);
  if (liveTest === undefined) {
    violations.push("live vitest config has no test block");
  } else {
    const include = liveTest["include"];
    if (!isStringArray(include) || include.length === 0) {
      violations.push("live vitest config include is missing or empty");
    } else if (!include.every((pattern) => pattern.startsWith("tests/live/"))) {
      violations.push(
        "live vitest config include reaches outside tests/live/ — the live lane must include only live specs",
      );
    }
  }

  return violations;
}
