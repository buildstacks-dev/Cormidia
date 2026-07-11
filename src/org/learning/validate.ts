// Shared field validators for the M3 contract records (ExperimentRecord,
// InterventionRecord, EvalResult, EvalFixture, CandidateArtifact). Each
// throws a plain Error with a "learning: <source>." prefix so a malformed
// record names its file and field, matching the OKF validator's style
// (src/org/memory.ts) without importing it — these records are JSON
// contracts, not frontmatter.

export function requireRecord(value: unknown, source: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`learning: ${source} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function requireString(
  spec: Record<string, unknown>,
  key: string,
  source: string,
): string {
  const value = spec[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`learning: ${source}.${key} must be a non-empty string`);
  }
  return value;
}

export function optionalString(
  spec: Record<string, unknown>,
  key: string,
  source: string,
): string | null {
  const value = spec[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`learning: ${source}.${key} must be a non-empty string or null`);
  }
  return value;
}

export function requireEnum<const T extends readonly string[]>(
  spec: Record<string, unknown>,
  key: string,
  allowed: T,
  source: string,
): T[number] {
  const value = spec[key];
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`learning: ${source}.${key} must be one of ${allowed.join(" | ")}`);
  }
  return value as T[number];
}

export function requireBoolean(
  spec: Record<string, unknown>,
  key: string,
  source: string,
): boolean {
  const value = spec[key];
  if (typeof value !== "boolean") {
    throw new Error(`learning: ${source}.${key} must be a boolean`);
  }
  return value;
}

export function requireFiniteNumber(
  spec: Record<string, unknown>,
  key: string,
  source: string,
): number {
  const value = spec[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`learning: ${source}.${key} must be a finite number`);
  }
  return value;
}

export function requireNonNegativeNumber(
  spec: Record<string, unknown>,
  key: string,
  source: string,
): number {
  const value = requireFiniteNumber(spec, key, source);
  if (value < 0) throw new Error(`learning: ${source}.${key} must be >= 0`);
  return value;
}

export function requirePositiveInt(
  spec: Record<string, unknown>,
  key: string,
  source: string,
): number {
  const value = spec[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`learning: ${source}.${key} must be a positive integer`);
  }
  return value;
}

export function requireStringArray(
  spec: Record<string, unknown>,
  key: string,
  source: string,
): string[] {
  const value = spec[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`learning: ${source}.${key} must be a string array`);
  }
  return [...value] as string[];
}

/** `sha256:<64 hex>` content refs — candidate.content_hash and
 *  intervention.reviewed_content_hash must accept the SAME grammar (M4 binds
 *  one to the other), so both validate through this one check. */
export function requireSha256Ref(
  spec: Record<string, unknown>,
  key: string,
  source: string,
): string {
  const value = requireString(spec, key, source);
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error(`learning: ${source}.${key} must be "sha256:<64 hex>"`);
  }
  return value;
}

/** Ids carry their kind as a prefix (`exp_`, `int_`, `eval_`, `cand_`) —
 *  `learn show` routes on it, and a mislabeled id would trace to nothing. */
export function requirePrefixedId(
  spec: Record<string, unknown>,
  key: string,
  prefix: string,
  source: string,
): string {
  const value = requireString(spec, key, source);
  if (!value.startsWith(prefix)) {
    throw new Error(`learning: ${source}.${key} must start with "${prefix}"`);
  }
  return value;
}
