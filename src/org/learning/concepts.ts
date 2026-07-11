// Governed concept storage (docs/learning-loop/learning-loop-spec.md §3, §8):
// candidates/, quarantine/, and bundle/ under each learning root, plus the
// per-root manifest with version cuts.
//
// Storage location is the primary defense (spec §3): an unreviewed candidate
// is not merely marked non-active — it lives physically outside every
// directory the resolver reads. This module owns the placement table
// (directory ↔ loop.status agreement) and the only mutations M4 allows on
// governed concepts: publish-time moves (publisher.ts calls in), disable, and
// rollback of the latest version cut.
//
// Two learning roots exist (spec §1): the committed org home's `learning/`
// (scopes `org` and `roles/<role>`) and an app repo's `.operon/learning/`
// (scopes `apps/<app>` and `apps/<app>/roles/<role>`). Everything here takes
// a LearningRoot so the two trees cannot drift.
//
// Spec deltas, recorded M1-M3-style:
//   - `schema_version` on the manifest (EpisodeRecord precedent).
//   - Manifest history entries carry the touched `concepts` ids and a `note`,
//     so `rollback` is deterministic (revert the latest cut's concepts)
//     instead of guessing from file mtimes.
//   - Provisional concepts must carry `loop.author` (the human who wrote
//     them) — spec §3 requires a human author for quarantine but the sketch
//     had no field recording one.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  isValidLoopScope,
  loadBundle,
  parseOkfDocument,
  serializeOkfDocument,
  type LoopStatus,
  type OkfDocument,
} from "../memory.js";
import { writeFileAtomic } from "../atomic.js";
import type { LearningPolicy } from "./policy.js";

// ---------------------------------------------------------------------------
// roots and scope mapping
// ---------------------------------------------------------------------------

export type LearningRootKind = "org" | "app";

export interface LearningRoot {
  kind: LearningRootKind;
  /** The `learning/` directory itself (org home) or `.operon/learning/`
   *  (app repo). */
  dir: string;
}

export function orgLearningRoot(orgHome: string): LearningRoot {
  return { kind: "org", dir: join(orgHome, "learning") };
}

export function appLearningRoot(appWorkdir: string): LearningRoot {
  return { kind: "app", dir: join(appWorkdir, ".operon", "learning") };
}

/** Which root a scope's concepts live in (spec §1): `org` and `roles/<role>`
 *  in the org home; `apps/<app>` and deeper in the app repo. */
export function rootKindForScope(scope: string): LearningRootKind {
  return scope.startsWith("apps/") ? "app" : "org";
}

export function candidatesDir(root: LearningRoot): string {
  return join(root.dir, "candidates");
}

export function quarantineDir(root: LearningRoot): string {
  return join(root.dir, "quarantine");
}

export function bundleDir(root: LearningRoot): string {
  return join(root.dir, "bundle");
}

/** `bundle/<scope>` — scope `org` maps to `bundle/org/`, `roles/<r>` to
 *  `bundle/roles/<r>/`, app scopes to `bundle/apps/<a>[/roles/<r>]/`. The
 *  scope grammar (isValidLoopScope) already forbids traversal segments. */
export function bundleScopeDir(root: LearningRoot, scope: string): string {
  if (!isValidLoopScope(scope)) {
    throw new Error(`learning: "${scope}" is not a valid V1 scope (spec §2)`);
  }
  if (rootKindForScope(scope) !== root.kind) {
    throw new Error(
      `learning: scope "${scope}" lives in the ${rootKindForScope(scope)} learning root, ` +
        `not the ${root.kind} root`,
    );
  }
  return join(bundleDir(root), scope);
}

export function proposalsDir(root: LearningRoot, kind: "skills" | "protocol" | "gates"): string {
  return join(root.dir, "proposals", kind);
}

// ---------------------------------------------------------------------------
// placement: directory ↔ loop.status agreement (spec §3 table)
// ---------------------------------------------------------------------------

export type ConceptPlacement = "candidates" | "quarantine" | "bundle";

const PLACEMENT_STATUS: Record<ConceptPlacement, LoopStatus[]> = {
  candidates: ["candidate"],
  quarantine: ["provisional"],
  bundle: ["active", "deprecated"],
};

/** Rejects a concept whose `loop` block disagrees with where it physically
 *  lives — a half-moved file must fail loudly, never resolve. Returns the
 *  document so callers can chain. */
export function assertConceptPlacement(doc: OkfDocument, placement: ConceptPlacement): OkfDocument {
  const source = doc.path ?? doc.frontmatter.name;
  const loop = doc.frontmatter.loop;
  if (loop === undefined) {
    throw new Error(
      `learning: ${source}: governed concept has no loop block — legacy docs belong in memory/**, ` +
        `not learning/${placement}/`,
    );
  }
  if (!PLACEMENT_STATUS[placement].includes(loop.status)) {
    throw new Error(
      `learning: ${source}: loop.status "${loop.status}" cannot live in ${placement}/ ` +
        `(allowed: ${PLACEMENT_STATUS[placement].join(" | ")}; spec §3)`,
    );
  }
  if (placement === "quarantine") {
    const author = loop["author"];
    if (typeof author !== "string" || author.trim() === "") {
      throw new Error(
        `learning: ${source}: provisional concepts require a human author (loop.author) — ` +
          `quarantine is the human urgent lane, never an agent write path (design §7)`,
      );
    }
    if (typeof loop["ttl_days"] !== "number") {
      throw new Error(`learning: ${source}: provisional concepts require loop.ttl_days`);
    }
  }
  return doc;
}

export interface LoadedConcept {
  doc: OkfDocument;
  /** Path the doc was loaded from. */
  path: string;
}

/** Governed concepts in one directory. Malformed docs are LOUD here — unlike
 *  agent-writable memory trees, everything under quarantine/ and bundle/ went
 *  through the publisher or a human, so a broken file is corruption, not
 *  noise. Docs that fail OKF parsing or placement throw with their path. */
export async function loadConceptDir(
  dir: string,
  placement: ConceptPlacement,
): Promise<LoadedConcept[]> {
  const bundle = await loadBundle(dir);
  if (bundle.errors.length > 0) {
    const first = bundle.errors[0]!;
    throw new Error(`learning: ${first.path}: ${first.message}`);
  }
  return bundle.docs.map((doc) => ({
    doc: assertConceptPlacement(doc, placement),
    path: doc.path ?? join(dir, `${doc.frontmatter.name}.md`),
  }));
}

/** Find one concept by `loop.id` across a root's bundle scope dirs. */
export async function findBundleConcept(
  root: LearningRoot,
  conceptId: string,
): Promise<LoadedConcept | undefined> {
  for (const dir of await listBundleScopeDirs(root)) {
    for (const concept of await loadConceptDir(dir, "bundle")) {
      if (concept.doc.frontmatter.loop?.id === conceptId) return concept;
    }
  }
  return undefined;
}

/** Every existing `bundle/<scope>` directory in a root, sorted. */
export async function listBundleScopeDirs(root: LearningRoot): Promise<string[]> {
  const base = bundleDir(root);
  if (!existsSync(base)) return [];
  const dirs: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    if (entries.some((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "INDEX.md")) {
      dirs.push(dir);
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(join(dir, entry.name));
    }
  };
  await walk(base);
  return dirs;
}

// ---------------------------------------------------------------------------
// manifest and version cuts (spec §8)
// ---------------------------------------------------------------------------

export interface ManifestHistoryEntry {
  version: string;
  /** Git commit of the cut. Null at publish time — committing the org home
   *  is the human's act, after the publisher writes. */
  commit: string | null;
  promoted: string;
  approval_ref: string | null;
  /** loop ids touched by this cut — what rollback reverts. */
  concepts: string[];
  note?: string;
}

export interface LearningManifest {
  schema_version: 1;
  bundle_version: string;
  stable: string;
  canary: string | null;
  history: ManifestHistoryEntry[];
}

export function manifestPath(root: LearningRoot): string {
  return join(root.dir, "manifest.yaml");
}

export async function readManifest(root: LearningRoot): Promise<LearningManifest | null> {
  const path = manifestPath(root);
  if (!existsSync(path)) return null;
  const raw = parseYaml(await readFile(path, "utf8")) as unknown;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`learning: ${path} must be a YAML mapping`);
  }
  const spec = raw as Record<string, unknown>;
  if (spec["schema_version"] !== 1) {
    throw new Error(`learning: ${path}: schema_version must be 1`);
  }
  const history = spec["history"];
  if (!Array.isArray(history)) throw new Error(`learning: ${path}: history must be a list`);
  const entries: ManifestHistoryEntry[] = history.map((entry, i) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`learning: ${path}: history[${i}] must be a mapping`);
    }
    const e = entry as Record<string, unknown>;
    const version = e["version"];
    const promoted = e["promoted"];
    if (typeof version !== "string" || typeof promoted !== "string") {
      throw new Error(`learning: ${path}: history[${i}] needs string version and promoted`);
    }
    const concepts = e["concepts"];
    return {
      version,
      commit: typeof e["commit"] === "string" ? e["commit"] : null,
      promoted,
      approval_ref: typeof e["approval_ref"] === "string" ? e["approval_ref"] : null,
      concepts: Array.isArray(concepts) ? concepts.map(String) : [],
      ...(typeof e["note"] === "string" ? { note: e["note"] } : {}),
    };
  });
  const bundleVersion = spec["bundle_version"];
  const stable = spec["stable"];
  if (typeof bundleVersion !== "string" || typeof stable !== "string") {
    throw new Error(`learning: ${path}: bundle_version and stable must be strings`);
  }
  return {
    schema_version: 1,
    bundle_version: bundleVersion,
    stable,
    canary: typeof spec["canary"] === "string" ? spec["canary"] : null,
    history: entries,
  };
}

async function writeManifest(root: LearningRoot, manifest: LearningManifest): Promise<void> {
  await mkdir(root.dir, { recursive: true });
  await writeFileAtomic(manifestPath(root), stringifyYaml(manifest));
}

/** `YYYY.MM.DD-N`, N increasing within the day across the whole history —
 *  version strings are unique per root by construction. */
function nextVersion(history: ManifestHistoryEntry[], now: Date): string {
  const day = now.toISOString().slice(0, 10).replaceAll("-", ".");
  const taken = history
    .filter((entry) => entry.version.startsWith(`${day}-`))
    .map((entry) => Number(entry.version.slice(day.length + 1)))
    .filter((n) => Number.isInteger(n));
  const n = taken.length === 0 ? 1 : Math.max(...taken) + 1;
  return `${day}-${n}`;
}

export interface CutVersionInput {
  approvalRef?: string;
  concepts: string[];
  note?: string;
  now?: Date;
}

/** Append one history entry and advance bundle_version + stable. Idempotent
 *  by approval ref: a re-run for an approval that already cut returns the
 *  existing entry (crash-resume, spec §14 step 4). */
export async function cutManifestVersion(
  root: LearningRoot,
  input: CutVersionInput,
): Promise<ManifestHistoryEntry> {
  const now = input.now ?? new Date();
  const manifest = (await readManifest(root)) ?? {
    schema_version: 1 as const,
    bundle_version: "0",
    stable: "0",
    canary: null,
    history: [],
  };
  if (input.approvalRef !== undefined) {
    const existing = manifest.history.find((entry) => entry.approval_ref === input.approvalRef);
    if (existing !== undefined) return existing;
  }
  const entry: ManifestHistoryEntry = {
    version: nextVersion(manifest.history, now),
    commit: null,
    promoted: now.toISOString(),
    approval_ref: input.approvalRef ?? null,
    concepts: [...input.concepts],
    ...(input.note !== undefined ? { note: input.note } : {}),
  };
  manifest.history.push(entry);
  manifest.bundle_version = entry.version;
  manifest.stable = entry.version;
  await writeManifest(root, manifest);
  return entry;
}

// ---------------------------------------------------------------------------
// disable and rollback (spec §16 Resolver.disable/rollback; milestone M4)
// ---------------------------------------------------------------------------

export interface DisableResult {
  conceptId: string;
  path: string;
  version: string;
}

/** Deprecate one active concept in place. Takes effect for every
 *  subsequently resolved turn immediately (the resolver requires
 *  `loop.status: active`); in-flight turns keep their pin because resolve
 *  runs once at turn start. Returns undefined when the id is not in this
 *  root. */
export async function disableConcept(
  root: LearningRoot,
  conceptId: string,
  options: { now?: Date } = {},
): Promise<DisableResult | undefined> {
  const found = await findBundleConcept(root, conceptId);
  if (found === undefined) return undefined;
  const loop = found.doc.frontmatter.loop!;
  if (loop.status !== "active") {
    throw new Error(`learning: ${conceptId} is already "${loop.status}" — nothing to disable`);
  }
  const next: OkfDocument = {
    ...found.doc,
    frontmatter: {
      ...found.doc.frontmatter,
      status: "deprecated",
      loop: { ...loop, status: "deprecated" },
    },
  };
  await writeFileAtomic(found.path, serializeOkfDocument(next));
  const cut = await cutManifestVersion(root, {
    concepts: [conceptId],
    note: `disable ${conceptId}`,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  return { conceptId, path: found.path, version: cut.version };
}

export interface RollbackResult {
  revertedVersion: string;
  newVersion: string;
  deactivated: string[];
}

/** Revert the latest version cut: deprecate every concept that cut
 *  activated, then cut a new version recording the rollback. History stays
 *  append-only — a rollback is a new entry, never an erased one. */
export async function rollbackRoot(
  root: LearningRoot,
  options: { now?: Date } = {},
): Promise<RollbackResult> {
  const manifest = await readManifest(root);
  const last = manifest?.history.at(-1);
  if (manifest === null || last === undefined) {
    throw new Error(`learning: ${manifestPath(root)} has no version cuts to roll back`);
  }
  if (last.note?.startsWith("rollback of ") === true) {
    throw new Error(
      `learning: the latest cut (${last.version}) is already a rollback — ` +
        `re-publish through the candidate path instead of rolling back twice`,
    );
  }
  const deactivated: string[] = [];
  for (const conceptId of last.concepts) {
    const found = await findBundleConcept(root, conceptId);
    if (found === undefined || found.doc.frontmatter.loop?.status !== "active") continue;
    const loop = found.doc.frontmatter.loop;
    await writeFileAtomic(
      found.path,
      serializeOkfDocument({
        ...found.doc,
        frontmatter: {
          ...found.doc.frontmatter,
          status: "deprecated",
          loop: { ...loop, status: "deprecated" },
        },
      }),
    );
    deactivated.push(conceptId);
  }
  const cut = await cutManifestVersion(root, {
    concepts: deactivated,
    note: `rollback of ${last.version}`,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  return { revertedVersion: last.version, newVersion: cut.version, deactivated };
}

// ---------------------------------------------------------------------------
// quarantine authoring — the human urgent lane (design §7, §10.1)
// ---------------------------------------------------------------------------

export interface WriteProvisionalInput {
  doc: OkfDocument;
  policy: LearningPolicy;
}

/** Validate and write a human-authored provisional concept into
 *  quarantine/. Enforces the placement rules plus the policy TTL cap. */
export async function writeProvisionalConcept(
  root: LearningRoot,
  input: WriteProvisionalInput,
): Promise<string> {
  const doc = assertConceptPlacement(input.doc, "quarantine");
  const loop = doc.frontmatter.loop!;
  const ttl = loop["ttl_days"];
  if (typeof ttl !== "number" || ttl <= 0 || ttl > input.policy.quarantine.max_ttl_days) {
    throw new Error(
      `learning: provisional TTL must be 1..${input.policy.quarantine.max_ttl_days} days ` +
        `(policy §13), got ${String(ttl)}`,
    );
  }
  if (rootKindForScope(loop.scope) !== root.kind) {
    throw new Error(
      `learning: scope "${loop.scope}" belongs in the ${rootKindForScope(loop.scope)} root`,
    );
  }
  const dir = quarantineDir(root);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${doc.frontmatter.name}.md`);
  await writeFileAtomic(path, serializeOkfDocument(doc));
  return path;
}

// ---------------------------------------------------------------------------
// publish-time move (called by publisher.ts only)
// ---------------------------------------------------------------------------

export interface ActivateConceptInput {
  /** The candidate concept file (candidates/<candidate_id>.md). */
  sourcePath: string;
  root: LearningRoot;
  now?: Date;
}

export interface ActivatedConcept {
  conceptId: string;
  path: string;
  /** The exact bytes written — what final_diff_hash binds (spec §14). */
  bytes: string;
}

/** Render (do not yet write) the activated form of a candidate concept:
 *  loop.status candidate -> active, everything else byte-preserved. Pure so
 *  the publisher can hash the result for the approval binding BEFORE any
 *  write happens, and write the identical bytes after approval. */
export async function renderActivatedConcept(sourcePath: string): Promise<ActivatedConcept & { name: string; scope: string }> {
  const doc = parseOkfDocument(await readFile(sourcePath, "utf8"), sourcePath);
  assertConceptPlacement({ ...doc, path: sourcePath }, "candidates");
  const loop = doc.frontmatter.loop!;
  const activated: OkfDocument = {
    ...doc,
    frontmatter: { ...doc.frontmatter, status: "active", loop: { ...loop, status: "active" } },
  };
  const bytes = serializeOkfDocument(activated);
  return {
    conceptId: loop.id,
    name: doc.frontmatter.name,
    scope: loop.scope,
    path: sourcePath,
    bytes,
  };
}

/** Move the concept into its bundle scope dir with the pre-rendered bytes.
 *  Idempotent: destination already carrying the bytes counts as done; the
 *  source file is removed either way. */
export async function commitActivatedConcept(
  root: LearningRoot,
  activated: { name: string; scope: string; bytes: string; path: string },
): Promise<string> {
  const dir = bundleScopeDir(root, activated.scope);
  await mkdir(dir, { recursive: true });
  const dest = join(dir, `${basename(activated.name)}.md`);
  if (!existsSync(dest) || (await readFile(dest, "utf8")) !== activated.bytes) {
    await writeFileAtomic(dest, activated.bytes);
  }
  await rm(activated.path, { force: true });
  return dest;
}
