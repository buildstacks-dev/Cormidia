// .operon/policy.yaml schema, loader, tier resolution (build plan M4.2;
// docs/loop.md §5 table + defaults, §4 tiering axes).
//
// Risk tiering is a pure, provable function: the app's policy maps
// changed-file globs → risk tiers → gate sets, plus the review-dimension
// globs (§4) and the remediation attempt cap. This module owns the risk-tier
// vocabulary (low|medium|high) that src/loop/pipelines.ts deliberately left
// as plain strings.
//
// Port notes (predecessor gate engine, `orchestrator/gates.py`):
// - Glob semantics are fnmatch-style: `*` and `?`, with `*` matching across
//   `/` (so `*.md` matches `docs/a/b.md`, and `**` is equivalent to `*`).
//   The default template's patterns keep their exact predecessor meaning.
// - Per file: tiers are checked high → low, first match wins; a file
//   matching no glob is **medium** (§4: tiering makes the loop cheaper,
//   never less safe). Across files: highest tier wins. An empty diff
//   resolves low (predecessor parity — fold seed).
// - Dropped: the predecessor's silent gate-set fallback for a missing tier
//   (`["tests", "completeness"]`) — loop.md §1 drops silent best-effort, so
//   an incomplete `gates` mapping fails at load time instead.
// - `review-freshness` is deliberately NOT a configurable gate: it always
//   runs regardless of tier (§5 table), enforced by the gate orchestrator
//   (M4.5). Listing it in policy is rejected so nobody believes omitting it
//   disables it.
//
// Parsing mirrors src/org/roles.ts / src/loop/pipelines.ts: yaml.parse +
// explicit field checks, descriptive errors carrying path + location,
// unknown keys rejected loudly.

import { readFile } from "node:fs/promises";
import { parse } from "yaml";

/** Risk tier (changed-file globs in `.operon/policy.yaml`) selects only
 * deterministic gates. `op:tier-*` is retained as metadata for historical
 * readers; live provider-step selection comes from the accepted EpisodePlan. */
export type RiskTier = "low" | "medium" | "high";
/** Ascending severity — resolveTier folds with "highest wins". */
export const RISK_TIERS: RiskTier[] = ["low", "medium", "high"];

/** Gates a policy may schedule per tier (docs/loop.md §5 table).
 *  `review-freshness` is absent by design — see the header note. */
export type GateName = "tests" | "lint" | "e2e" | "security" | "completeness";
export const GATE_NAMES: GateName[] = ["tests", "lint", "e2e", "security", "completeness"];

export const DEFAULT_MAX_ATTEMPTS = 3;

export interface RemediationPolicy {
  /** Bounded fix re-dispatches after a gate failure before the ticket goes
   *  `op:returned` (docs/loop.md §5; default 3). Persistence of the counter
   *  is the caller's job — this is the configured cap. */
  maxAttempts: number;
}

export interface Policy {
  /** Changed-file globs per tier. Checked high → low per file; a file
   *  matching no glob is medium. */
  riskTiers: Record<RiskTier, string[]>;
  /** Gate set per resolved tier (ordered — gates run in list order). */
  gates: Record<RiskTier, GateName[]>;
  /** Review-dimension globs (§4): pipelines.yaml `only_on.dimension_globs`
   *  references these keys; a diff matching a dimension's globs selects the
   *  conditional review pass (wired live in M6.2). */
  dimensionGlobs: Record<string, string[]>;
  remediation: RemediationPolicy;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const TOP_KEYS = ["schema_version", "risk_tiers", "gates", "dimension_globs", "remediation"];

export async function loadPolicy(path: string): Promise<Policy> {
  const raw = parse(await readFile(path, "utf8")) as unknown;
  const err = (msg: string) => new Error(`${path}: ${msg}`);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw err("not a YAML mapping");
  }
  const spec = raw as Record<string, unknown>;

  for (const key of Object.keys(spec)) {
    if (!TOP_KEYS.includes(key)) {
      throw err(`unknown key "${key}" (allowed: ${TOP_KEYS.join(", ")})`);
    }
  }

  if (spec["schema_version"] !== undefined && spec["schema_version"] !== 1) {
    throw err(`unsupported schema_version ${String(spec["schema_version"])} (expected 1)`);
  }

  return {
    riskTiers: parseRiskTiers(spec["risk_tiers"], err),
    gates: parseGates(spec["gates"], err),
    dimensionGlobs: parseDimensionGlobs(spec["dimension_globs"], err),
    remediation: parseRemediation(spec["remediation"], err),
  };
}

function parseRiskTiers(
  raw: unknown,
  err: (msg: string) => Error,
): Record<RiskTier, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw err(`"risk_tiers" must be a mapping of tier → glob list`);
  }
  const spec = raw as Record<string, unknown>;
  for (const key of Object.keys(spec)) {
    if (!RISK_TIERS.includes(key as RiskTier)) {
      throw err(`risk_tiers: unknown tier "${key}" (allowed: ${RISK_TIERS.join(", ")})`);
    }
  }
  const tiers = { low: [] as string[], medium: [] as string[], high: [] as string[] };
  for (const tier of RISK_TIERS) {
    const globs = spec[tier];
    if (globs === undefined) continue; // absent tier = no globs at that tier
    tiers[tier] = parseGlobList(globs, `risk_tiers.${tier}`, err);
  }
  return tiers;
}

function parseGates(raw: unknown, err: (msg: string) => Error): Record<RiskTier, GateName[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw err(`"gates" must be a mapping of tier → gate list`);
  }
  const spec = raw as Record<string, unknown>;
  for (const key of Object.keys(spec)) {
    if (!RISK_TIERS.includes(key as RiskTier)) {
      throw err(`gates: unknown tier "${key}" (allowed: ${RISK_TIERS.join(", ")})`);
    }
  }
  const gates = {} as Record<RiskTier, GateName[]>;
  for (const tier of RISK_TIERS) {
    const list = spec[tier];
    // No silent per-tier fallback (see header note): every tier needs an
    // explicit, non-empty gate set.
    if (!Array.isArray(list) || list.length === 0) {
      throw err(`gates.${tier}: required — a non-empty list of gates`);
    }
    for (const gate of list) {
      if (gate === "review-freshness") {
        throw err(
          `gates.${tier}: "review-freshness" is not configurable — ` +
            `it always runs regardless of tier (docs/loop.md §5)`,
        );
      }
      if (!GATE_NAMES.includes(gate as GateName)) {
        throw err(
          `gates.${tier}: unknown gate "${String(gate)}" (allowed: ${GATE_NAMES.join(", ")})`,
        );
      }
    }
    gates[tier] = list as GateName[];
  }
  return gates;
}

function parseDimensionGlobs(
  raw: unknown,
  err: (msg: string) => Error,
): Record<string, string[]> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw err(`"dimension_globs" must be a mapping of dimension → glob list`);
  }
  const spec = raw as Record<string, unknown>;
  const dims: Record<string, string[]> = {};
  for (const [name, globs] of Object.entries(spec)) {
    dims[name] = parseGlobList(globs, `dimension_globs.${name}`, err);
  }
  return dims;
}

function parseGlobList(raw: unknown, where: string, err: (msg: string) => Error): string[] {
  if (!Array.isArray(raw)) throw err(`${where}: must be a list of globs`);
  for (const glob of raw) {
    if (typeof glob !== "string" || glob.length === 0) {
      throw err(`${where}: globs must be non-empty strings (got ${JSON.stringify(glob)})`);
    }
  }
  return raw as string[];
}

function parseRemediation(raw: unknown, err: (msg: string) => Error): RemediationPolicy {
  if (raw === undefined) return { maxAttempts: DEFAULT_MAX_ATTEMPTS };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw err(`"remediation" must be a mapping`);
  }
  const spec = raw as Record<string, unknown>;
  for (const key of Object.keys(spec)) {
    if (key !== "max_attempts") {
      throw err(`remediation: unknown key "${key}" (allowed: max_attempts)`);
    }
  }
  const max = spec["max_attempts"];
  if (max === undefined) return { maxAttempts: DEFAULT_MAX_ATTEMPTS };
  if (typeof max !== "number" || !Number.isInteger(max) || max < 1) {
    throw err(`remediation.max_attempts must be a positive integer (got ${JSON.stringify(max)})`);
  }
  return { maxAttempts: max };
}

// ---------------------------------------------------------------------------
// Tier resolution — pure functions over a loaded Policy
// ---------------------------------------------------------------------------

/** Highest risk tier among the changed files; a file matching no glob is
 *  medium; an empty diff resolves low (predecessor parity). Paths are
 *  repo-relative POSIX paths, as `git diff --name-only` emits them. */
export function resolveTier(policy: Policy, changedFiles: string[]): RiskTier {
  let highest: RiskTier = "low";
  for (const file of changedFiles) {
    const tier = classifyFile(policy, file);
    if (RISK_TIERS.indexOf(tier) > RISK_TIERS.indexOf(highest)) highest = tier;
    if (highest === "high") break; // can't go higher
  }
  return highest;
}

function classifyFile(policy: Policy, file: string): RiskTier {
  // Check high first: a file matching both `db/**` (high) and `*.md` (low)
  // is high.
  for (let i = RISK_TIERS.length - 1; i >= 0; i--) {
    const tier = RISK_TIERS[i]!;
    if (policy.riskTiers[tier].some((glob) => globMatch(glob, file))) return tier;
  }
  return "medium"; // unmatched → medium
}

/** The gate set the resolved tier schedules, in run order (a copy — callers
 *  can't mutate the policy). `review-freshness` is not in any set: the gate
 *  orchestrator (M4.5) always appends it. */
export function gatesForTier(policy: Policy, tier: RiskTier): GateName[] {
  return [...policy.gates[tier]];
}

/** Extra, content-aware inputs for {@link matchedDimensions}. */
export interface DimensionMatchContext {
  /** Repo-relative `package.json` paths whose diff actually touched a
   *  dependency or run-script key (see {@link packageJsonTouchesSecurityKeys}).
   *  When provided, a `package.json` path counts toward a dimension only if it
   *  is in this set — a bare metadata or test-glob edit does NOT trip a
   *  content-blind glob like `dimension_globs.security`'s `package.json` entry
   *  (L1-05). Omitting the field (the default) preserves the historical
   *  path-only behavior for callers that cannot inspect content. */
  dependencyRelevantPackageJson?: ReadonlySet<string>;
}

/** Dimension keys (policy declaration order) whose globs match any changed
 *  file — what pipelines.ts `PassSelection.dimensions` expects (§4 review
 *  dimensions; wired live in M6.2).
 *
 *  `package.json` is content-gated when `context.dependencyRelevantPackageJson`
 *  is supplied: the file is a genuine security signal only when its
 *  dependency or run-script keys change, so widening a test glob no longer
 *  over-escalates standard → deep (L1-05). Lock files (`pnpm-lock.yaml`) stay
 *  path-matched — they change only as a consequence of a dependency change. */
export function matchedDimensions(
  policy: Policy,
  changedFiles: string[],
  context: DimensionMatchContext = {},
): string[] {
  const relevant = context.dependencyRelevantPackageJson;
  const counts = (file: string): boolean =>
    relevant === undefined || !isPackageJson(file) || relevant.has(file);
  return Object.entries(policy.dimensionGlobs)
    .filter(([, globs]) => changedFiles.some((f) => counts(f) && globs.some((g) => globMatch(g, f))))
    .map(([name]) => name);
}

function isPackageJson(path: string): boolean {
  return path === "package.json" || path.endsWith("/package.json");
}

// ---------------------------------------------------------------------------
// package.json content predicate (L1-05) — a targeted, minimal check; NOT a
// general content-DSL. `package.json` is listed under `dimension_globs.security`
// so that a dependency/supply-chain or build/run-script change escalates
// review; a metadata or test-glob edit should not.
// ---------------------------------------------------------------------------

/** The package.json keys whose change signals real dependency/supply-chain or
 *  build/run-script risk — the only edits that should trip the security
 *  review dimension. */
export const SECURITY_RELEVANT_PACKAGE_JSON_KEYS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "scripts",
] as const;

/** Whether a package.json edit changed any dependency or run-script key.
 *  `before`/`after` are the raw file contents at the base ref and the
 *  worktree HEAD. An absent side (a newly added or deleted file) counts as
 *  empty; an unparseable side errs toward escalation ("tiering makes the loop
 *  cheaper, never less safe" — when we cannot tell, we treat it as risky).
 *  Key order is ignored, so a purely cosmetic re-sort is not a change. */
export function packageJsonTouchesSecurityKeys(
  before: string | undefined,
  after: string | undefined,
): boolean {
  const beforeObj = parsePackageJsonObject(before);
  const afterObj = parsePackageJsonObject(after);
  if (beforeObj === undefined || afterObj === undefined) return true; // cannot compare → escalate
  return SECURITY_RELEVANT_PACKAGE_JSON_KEYS.some(
    (key) => canonicalJson(beforeObj[key]) !== canonicalJson(afterObj[key]),
  );
}

/** Parse package.json content. An absent/blank side is an empty object (there
 *  are simply no keys to compare). A present-but-malformed or non-object side
 *  is `undefined`, which callers read as "cannot compare". */
function parsePackageJsonObject(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined || raw.trim() === "") return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Order-insensitive canonical serialization for value equality. */
function canonicalJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

// ---------------------------------------------------------------------------
// fnmatch-style glob matching (see port notes in the header)
// ---------------------------------------------------------------------------

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/;

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (const ch of glob) {
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else if (REGEX_SPECIALS.test(ch)) re += `\\${ch}`;
    else re += ch;
  }
  return new RegExp(`^${re}$`);
}

function globMatch(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path);
}
