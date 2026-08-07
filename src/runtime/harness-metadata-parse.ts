// Shape validation for `harness-metadata.json` (#332).
//
// The file is edited by two very different authors: a human transcribing a
// vendor rate card, and `scripts/harness-freshness.mjs` proposing a fetched
// delta. Both are fallible in the same direction — a dropped field or a string
// where a number belongs — and the failure mode is silent under-costing, which
// the per-turn budget cap then fails to catch. So every field is checked at
// load and a violation throws with its exact path, rather than degrading.
//
// Split out of `harness-metadata.ts` to keep both modules inside the size
// ratchet; the two are one concern read together.

/** USD per million tokens. Which fields exist is declared per harness by
 *  `pricing.fields` and validated here — an adapter never reads a field its
 *  harness does not publish. */
export interface ModelPrice {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
  readonly cacheReadPerMTok?: number;
  readonly cacheWritePerMTok?: number;
}

interface PriceRow {
  /** Longest matching id PREFIX wins, so effort-suffixed ids price correctly. */
  readonly prefix: string;
  /** How the row is spelled on the vendor's own page, for the probe's reader. */
  readonly docIds: readonly string[];
  readonly price: ModelPrice;
}

interface PriceFallback {
  readonly price: ModelPrice;
  readonly rationale: string;
  readonly suffixRules: readonly { readonly suffix: string; readonly price: ModelPrice }[];
}

/** A published surcharge band, e.g. GPT-5.6's long-context multipliers. */
interface PriceModifier {
  readonly kind: "long_context";
  readonly prefix: string;
  readonly thresholdTokens: number;
  readonly inputMultiplier: number;
  readonly outputMultiplier: number;
}

interface DocSource {
  readonly kind: "doc";
  readonly url: string;
  readonly evidence: string;
  /** SHA-256 of the fetched body the committed figures were transcribed from.
   *  `null` means never observed by the probe — reported as a first
   *  observation, never as freshness. */
  readonly contentDigest: string | null;
}

interface HarnessPricing {
  readonly unit: "usd_per_million_tokens";
  readonly fields: readonly string[];
  readonly source: DocSource;
  readonly rationale: string;
  readonly rows: readonly PriceRow[];
  readonly fallback: PriceFallback;
  readonly modifiers: readonly PriceModifier[];
}

interface HarnessRoster {
  readonly source: DocSource;
  readonly pattern: string;
  readonly models: readonly string[];
  readonly note: string;
}

interface VersionSource {
  readonly id: string;
  readonly kind: "npm" | "github_release" | "manual";
  readonly package?: string;
  readonly repo?: string;
  readonly url?: string;
  readonly reason?: string;
}

interface HarnessUpstream {
  readonly references: readonly string[];
  readonly versionSources: readonly VersionSource[];
  readonly observed: Readonly<
    Record<string, { readonly version: string; readonly recordedAt: string; readonly evidence: string }>
  >;
}

export interface HarnessMetadataEntry {
  readonly upstream: HarnessUpstream;
  /** `null` when the harness reports real spend and Cormidia asserts no table. */
  readonly pricing: HarnessPricing | null;
  readonly pricingNote: string | null;
  /** `null` when the harness enumerates its own roster locally. */
  readonly roster: HarnessRoster | null;
  readonly rosterNote: string | null;
}

const SCHEMA_VERSION = 1;

function fail(where: string, why: string): never {
  throw new Error(`harness-metadata.json is invalid at ${where}: ${why}`);
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(where, "expected an object");
  return value as Record<string, unknown>;
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string" || value === "") fail(where, "expected a non-empty string");
  return value;
}

function textOrNull(value: unknown, where: string): string | null {
  return value === null || value === undefined ? null : text(value, where);
}

function list(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(where, "expected an array");
  return value;
}

function texts(value: unknown, where: string): string[] {
  return list(value, where).map((item, index) => text(item, `${where}[${index}]`));
}

function price(value: unknown, fields: readonly string[], where: string): ModelPrice {
  const entry = record(value, where);
  const present = Object.keys(entry).sort().join(",");
  const declared = [...fields].sort().join(",");
  if (present !== declared) fail(where, `price fields must be exactly [${declared}], found [${present}]`);
  for (const [field, amount] of Object.entries(entry)) {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      fail(`${where}.${field}`, "expected a finite non-negative number");
    }
  }
  return entry as unknown as ModelPrice;
}

function docSource(value: unknown, where: string): DocSource {
  const entry = record(value, where);
  if (entry.kind !== "doc") fail(`${where}.kind`, 'expected "doc"');
  return {
    kind: "doc",
    url: text(entry.url, `${where}.url`),
    evidence: text(entry.evidence, `${where}.evidence`),
    contentDigest: textOrNull(entry.contentDigest, `${where}.contentDigest`),
  };
}

function positive(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(where, "expected a positive number");
  return value;
}

function modifier(value: unknown, where: string): PriceModifier {
  const entry = record(value, where);
  if (entry.kind !== "long_context") fail(`${where}.kind`, 'expected "long_context"');
  return {
    kind: "long_context",
    prefix: text(entry.prefix, `${where}.prefix`),
    thresholdTokens: positive(entry.thresholdTokens, `${where}.thresholdTokens`),
    inputMultiplier: positive(entry.inputMultiplier, `${where}.inputMultiplier`),
    outputMultiplier: positive(entry.outputMultiplier, `${where}.outputMultiplier`),
  };
}

function pricing(value: unknown, where: string): HarnessPricing | null {
  if (value === null) return null;
  const entry = record(value, where);
  if (entry.unit !== "usd_per_million_tokens") fail(`${where}.unit`, 'expected "usd_per_million_tokens"');
  const fields = texts(entry.fields, `${where}.fields`);
  if (fields.length === 0) fail(`${where}.fields`, "expected at least one price field");
  const fallback = record(entry.fallback, `${where}.fallback`);
  return {
    unit: "usd_per_million_tokens",
    fields,
    source: docSource(entry.source, `${where}.source`),
    rationale: text(entry.rationale, `${where}.rationale`),
    rows: list(entry.rows, `${where}.rows`).map((row, index) => {
      const at = `${where}.rows[${index}]`;
      const parsed = record(row, at);
      return {
        prefix: text(parsed.prefix, `${at}.prefix`),
        docIds: texts(parsed.docIds, `${at}.docIds`),
        price: price(parsed.price, fields, `${at}.price`),
      };
    }),
    fallback: {
      price: price(fallback.price, fields, `${where}.fallback.price`),
      rationale: text(fallback.rationale, `${where}.fallback.rationale`),
      suffixRules: list(fallback.suffixRules, `${where}.fallback.suffixRules`).map((rule, index) => {
        const at = `${where}.fallback.suffixRules[${index}]`;
        const parsed = record(rule, at);
        return { suffix: text(parsed.suffix, `${at}.suffix`), price: price(parsed.price, fields, `${at}.price`) };
      }),
    },
    modifiers: list(entry.modifiers, `${where}.modifiers`).map((item, index) =>
      modifier(item, `${where}.modifiers[${index}]`),
    ),
  };
}

function roster(value: unknown, where: string): HarnessRoster | null {
  if (value === null) return null;
  const entry = record(value, where);
  const models = texts(entry.models, `${where}.models`);
  if (models.length === 0) fail(`${where}.models`, "a published roster may not be empty");
  return {
    source: docSource(entry.source, `${where}.source`),
    pattern: text(entry.pattern, `${where}.pattern`),
    models,
    note: text(entry.note, `${where}.note`),
  };
}

function upstream(value: unknown, where: string): HarnessUpstream {
  const entry = record(value, where);
  const sources = list(entry.versionSources, `${where}.versionSources`).map((source, index) => {
    const at = `${where}.versionSources[${index}]`;
    const parsed = record(source, at);
    const kind = text(parsed.kind, `${at}.kind`);
    if (kind !== "npm" && kind !== "github_release" && kind !== "manual") fail(`${at}.kind`, `unknown kind ${kind}`);
    if (kind === "npm") text(parsed.package, `${at}.package`);
    if (kind === "github_release") text(parsed.repo, `${at}.repo`);
    if (kind === "manual") text(parsed.reason, `${at}.reason`);
    return { ...parsed, id: text(parsed.id, `${at}.id`), kind } as VersionSource;
  });
  if (sources.length === 0) fail(`${where}.versionSources`, "every harness declares at least one version source");
  const observed: Record<string, { version: string; recordedAt: string; evidence: string }> = {};
  for (const [id, seen] of Object.entries(record(entry.observed, `${where}.observed`))) {
    const at = `${where}.observed.${id}`;
    if (!sources.some((source) => source.id === id)) fail(at, "observation for an undeclared version source");
    const parsed = record(seen, at);
    observed[id] = {
      version: text(parsed.version, `${at}.version`),
      recordedAt: text(parsed.recordedAt, `${at}.recordedAt`),
      evidence: text(parsed.evidence, `${at}.evidence`),
    };
  }
  return { references: texts(entry.references, `${where}.references`), versionSources: sources, observed };
}

/** Validate one harness's entry out of the whole document. */
export function parseHarnessMetadataEntry(document: unknown, runtime: string): HarnessMetadataEntry {
  const root = record(document, "$");
  if (root.schemaVersion !== SCHEMA_VERSION) fail("$.schemaVersion", `expected ${SCHEMA_VERSION}`);
  const where = `$.harnesses.${runtime}`;
  const entry = record(record(root.harnesses, "$.harnesses")[runtime], where);
  return {
    upstream: upstream(entry.upstream, `${where}.upstream`),
    pricing: pricing(entry.pricing, `${where}.pricing`),
    pricingNote: textOrNull(entry.pricingNote, `${where}.pricingNote`),
    roster: roster(entry.roster, `${where}.roster`),
    rosterNote: textOrNull(entry.rosterNote, `${where}.rosterNote`),
  };
}
