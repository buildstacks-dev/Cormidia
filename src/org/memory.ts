// OKF memory bundles (docs/architecture.md §6).
//
// Memory is deliberately plain markdown + YAML frontmatter. Selection is
// deterministic and embedding-free: INDEX.md is always included, then active
// documents whose keywords overlap the task text, capped by bytes.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export type OkfType = "lesson" | "fact" | "procedure";
export type OkfStatus = "active" | "deprecated";

export type LoopTier = "T0" | "T1" | "T2" | "T3";
export type LoopStatus = "candidate" | "provisional" | "active" | "deprecated" | "archived";
export type LoopClaim = "authorized" | "validated";

/** The learning loop's governance block (docs/learning-loop/ spec §3).
 *  Known fields are validated; the WHOLE mapping — unknown keys included —
 *  is preserved verbatim through parse → serialize, because a validator that
 *  reconstructs only the fields it knows silently destroys governance
 *  metadata on every rewrite (the exact defect this extension fixes for the
 *  eight top-level fields). */
export interface OkfLoopBlock {
  id: string;
  tier: LoopTier;
  status: LoopStatus;
  scope: string;
  version: number;
  claim: LoopClaim;
  [key: string]: unknown;
}

export interface OkfFrontmatter {
  name: string;
  description: string;
  type: OkfType;
  keywords: string[];
  evidence: string[];
  status: OkfStatus;
  created: string;
  updated: string;
  /** Absent on legacy docs — they remain valid as `trust: legacy` seed. */
  loop?: OkfLoopBlock;
}

export interface OkfDocument {
  frontmatter: OkfFrontmatter;
  body: string;
  path?: string;
}

export interface MemoryBundle {
  dir: string;
  index: string;
  docs: OkfDocument[];
  /** Docs that could not be parsed/validated. A single malformed doc — an
   *  agent can author one — must never crash context assembly or the loop, so
   *  loadBundle skips it and records it here instead of throwing. */
  errors: MemoryLoadError[];
}

export interface MemoryLoadError {
  path: string;
  message: string;
}

export class OkfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OkfParseError";
  }
}

export class OkfValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OkfValidationError";
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseOkfDocument(raw: string, source = "<memory>"): OkfDocument {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (match === null) {
    throw new OkfParseError(`${source}: missing YAML frontmatter delimited by ---`);
  }
  const frontmatter = validateFrontmatter(parseYaml(match[1] ?? ""), source);
  return { frontmatter, body: match[2] ?? "" };
}

export async function loadBundle(dir: string): Promise<MemoryBundle> {
  const indexPath = join(dir, "INDEX.md");
  const index = existsSync(indexPath) ? await readFile(indexPath, "utf8") : "";
  if (!existsSync(dir)) return { dir, index, docs: [], errors: [] };

  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "INDEX.md")
    .map((entry) => entry.name)
    .sort();

  const docs: OkfDocument[] = [];
  const errors: MemoryLoadError[] = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    try {
      const parsed = parseOkfDocument(await readFile(path, "utf8"), path);
      docs.push({ ...parsed, path });
    } catch (error) {
      // A malformed OKF doc (e.g. an agent wrote the OKF headings but omitted
      // the YAML frontmatter) is skipped, not fatal — otherwise one bad doc in
      // a role/app memory dir wedges every turn that assembles context. IO and
      // other unexpected errors still propagate.
      if (error instanceof OkfParseError || error instanceof OkfValidationError) {
        errors.push({ path, message: error.message });
      } else {
        throw error;
      }
    }
  }
  return { dir, index, docs, errors };
}

export async function selectExcerpts(
  bundleDirs: readonly string[],
  taskText: string,
  capBytes = 16 * 1024,
): Promise<string[]> {
  const out: string[] = [];
  let remaining = Math.max(0, capBytes);
  const taskWords = signalWords(taskText);

  for (const dir of bundleDirs) {
    if (remaining <= 0) break;
    const bundle = await loadBundle(dir);
    for (const error of bundle.errors) {
      process.stderr.write(`operon: skipping malformed memory doc — ${error.message}\n`);
    }
    if (bundle.index.trim() !== "") {
      remaining = appendCapped(out, `## Memory INDEX (${basename(dir)})\n\n${bundle.index.trimEnd()}`, remaining);
    }
    for (const doc of bundle.docs) {
      if (remaining <= 0) break;
      if (doc.frontmatter.status !== "active") continue;
      if (!keywordOverlap(doc.frontmatter.keywords, taskWords, taskText)) continue;
      remaining = appendCapped(out, renderExcerpt(doc), remaining);
    }
  }

  return out;
}

export async function writeMemoryDoc(
  bundleDir: string,
  doc: OkfDocument,
  options: { now?: Date } = {},
): Promise<string> {
  const stamped = stampUpdated(doc, options.now ?? new Date());
  validateFrontmatter(stamped.frontmatter, stamped.frontmatter.name);
  const path = join(bundleDir, `${stamped.frontmatter.name}.md`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeOkfDocument(stamped), "utf8");
  await regenerateIndex(bundleDir);
  return path;
}

export async function deprecateMemoryDoc(
  bundleDir: string,
  name: string,
  options: { now?: Date } = {},
): Promise<string> {
  const path = join(bundleDir, `${name}.md`);
  const parsed = parseOkfDocument(await readFile(path, "utf8"), path);
  await writeMemoryDoc(
    bundleDir,
    {
      ...parsed,
      frontmatter: { ...parsed.frontmatter, status: "deprecated" },
    },
    options,
  );
  return path;
}

export async function deleteMemoryDoc(bundleDir: string, name: string): Promise<void> {
  await rm(join(bundleDir, `${name}.md`), { force: true });
  await regenerateIndex(bundleDir);
}

export async function regenerateIndex(bundleDir: string): Promise<string> {
  await mkdir(bundleDir, { recursive: true });
  const bundle = await loadBundle(bundleDir);
  const lines = bundle.docs
    .filter((doc) => doc.frontmatter.status !== "deprecated")
    .sort((a, b) => a.frontmatter.name.localeCompare(b.frontmatter.name))
    .map((doc) => `- ${doc.frontmatter.name}: ${doc.frontmatter.description}`);
  const content = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  await writeFile(join(bundleDir, "INDEX.md"), content, "utf8");
  return content;
}

export function serializeOkfDocument(doc: OkfDocument): string {
  const frontmatter = validateFrontmatter(doc.frontmatter, doc.frontmatter.name);
  return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n${doc.body.trimEnd()}\n`;
}

function validateFrontmatter(value: unknown, source: string): OkfFrontmatter {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new OkfValidationError(`${source}: frontmatter must be a mapping`);
  }
  const spec = value as Record<string, unknown>;
  const name = requireString(spec, "name", source);
  const description = requireString(spec, "description", source);
  const type = requireEnum(spec, "type", ["lesson", "fact", "procedure"] as const, source);
  const keywords = requireStringArray(spec, "keywords", source);
  const evidence = requireStringArray(spec, "evidence", source);
  const status = requireEnum(spec, "status", ["active", "deprecated"] as const, source);
  const created = requireDate(spec, "created", source);
  const updated = requireDate(spec, "updated", source);
  const base = { name, description, type, keywords, evidence, status, created, updated };
  if (spec["loop"] === undefined) return base;

  const loop = validateLoopBlock(spec["loop"], source);
  // Storage/status consistency (spec §3 table): a candidate, provisional, or
  // active concept keeps top-level `active`; deprecated/archived must carry
  // top-level `deprecated`. Rejecting the mismatch here means a half-updated
  // rewrite (e.g. deprecating the doc without touching its loop status)
  // fails loudly instead of silently corrupting governance state.
  const wantsDeprecated = loop.status === "deprecated" || loop.status === "archived";
  if (wantsDeprecated !== (status === "deprecated")) {
    throw new OkfValidationError(
      `${source}: top-level status "${status}" disagrees with loop.status "${loop.status}"`,
    );
  }
  return { ...base, loop };
}

const LOOP_SCOPE_RE = /^(org|roles\/[A-Za-z0-9._-]+|apps\/[A-Za-z0-9._-]+(\/roles\/[A-Za-z0-9._-]+)?)$/;

function validateLoopBlock(value: unknown, source: string): OkfLoopBlock {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new OkfValidationError(`${source}: frontmatter.loop must be a mapping`);
  }
  const spec = value as Record<string, unknown>;
  const id = spec["id"];
  if (typeof id !== "string" || id.trim() === "") {
    throw new OkfValidationError(`${source}: frontmatter.loop.id must be a non-empty string`);
  }
  requireLoopEnum(spec, "tier", ["T0", "T1", "T2", "T3"] as const, source);
  requireLoopEnum(
    spec,
    "status",
    ["candidate", "provisional", "active", "deprecated", "archived"] as const,
    source,
  );
  requireLoopEnum(spec, "claim", ["authorized", "validated"] as const, source);

  const scope = spec["scope"];
  if (typeof scope !== "string" || !LOOP_SCOPE_RE.test(scope)) {
    const reserved = typeof scope === "string" && /^(identities|accounts)\//.test(scope);
    throw new OkfValidationError(
      reserved
        ? `${source}: frontmatter.loop.scope "${scope}" is reserved for a future version (spec §2)`
        : `${source}: frontmatter.loop.scope must be org | roles/<role> | apps/<app> | apps/<app>/roles/<role>`,
    );
  }

  const version = spec["version"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new OkfValidationError(`${source}: frontmatter.loop.version must be a positive integer`);
  }
  const ttl = spec["ttl_days"];
  if (ttl !== undefined && ttl !== null && (typeof ttl !== "number" || ttl <= 0)) {
    throw new OkfValidationError(`${source}: frontmatter.loop.ttl_days must be a positive number`);
  }

  // Deep-copy the whole mapping: known fields validated above, unknown fields
  // preserved untouched (see OkfLoopBlock).
  return structuredClone(spec) as OkfLoopBlock;
}

function requireLoopEnum<const T extends readonly string[]>(
  spec: Record<string, unknown>,
  key: string,
  allowed: T,
  source: string,
): void {
  const value = spec[key];
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new OkfValidationError(
      `${source}: frontmatter.loop.${key} must be one of ${allowed.join(" | ")}`,
    );
  }
}

function requireString(spec: Record<string, unknown>, key: string, source: string): string {
  const value = spec[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new OkfValidationError(`${source}: frontmatter.${key} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(spec: Record<string, unknown>, key: string, source: string): string[] {
  const value = spec[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new OkfValidationError(`${source}: frontmatter.${key} must be a string array`);
  }
  return [...value] as string[];
}

function requireEnum<const T extends readonly string[]>(
  spec: Record<string, unknown>,
  key: string,
  allowed: T,
  source: string,
): T[number] {
  const value = spec[key];
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new OkfValidationError(`${source}: frontmatter.${key} must be one of ${allowed.join(" | ")}`);
  }
  return value as T[number];
}

function requireDate(spec: Record<string, unknown>, key: string, source: string): string {
  const value = requireString(spec, key, source);
  if (!DATE_RE.test(value)) {
    throw new OkfValidationError(`${source}: frontmatter.${key} must be YYYY-MM-DD`);
  }
  return value;
}

function stampUpdated(doc: OkfDocument, now: Date): OkfDocument {
  return {
    ...doc,
    frontmatter: {
      ...doc.frontmatter,
      updated: isoDate(now),
    },
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function signalWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? []).values());
}

function keywordOverlap(keywords: readonly string[], taskWords: Set<string>, taskText: string): boolean {
  const lowerTask = taskText.toLowerCase();
  return keywords.some((keyword) => {
    const lower = keyword.toLowerCase();
    return taskWords.has(lower) || lowerTask.includes(lower);
  });
}

function renderExcerpt(doc: OkfDocument): string {
  const lines = [
    `## Memory ${doc.frontmatter.name}`,
    `Description: ${doc.frontmatter.description}`,
    `Keywords: ${doc.frontmatter.keywords.join(", ")}`,
    `Evidence: ${doc.frontmatter.evidence.join("; ")}`,
    "",
    doc.body.trimEnd(),
  ];
  return lines.join("\n").trimEnd();
}

function appendCapped(out: string[], text: string, remaining: number): number {
  if (remaining <= 0) return 0;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= remaining) {
    out.push(text);
    return remaining - bytes;
  }
  out.push(truncateUtf8(text, remaining));
  return 0;
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const buf = Buffer.from(text, "utf8");
  return buf.subarray(0, maxBytes).toString("utf8");
}
