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
// (scopes `org` and `roles/<role>`) and an app repo's `.cormidia/learning/`
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
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { writeFileAtomic } from "../atomic.js";
import {
  isValidLoopScope,
  loadBundle,
  parseOkfDocument,
  serializeOkfDocument,
  type LoopStatus,
  type OkfDocument,
} from "../memory.js";
import type { LearningPolicy } from "./policy.js";
import { definedProps } from "../../runtime/optional-properties.js";

// ---------------------------------------------------------------------------
// roots and scope mapping
// ---------------------------------------------------------------------------

type LearningRootKind = "org" | "app";

export interface LearningRoot {
  kind: LearningRootKind;
  /** The `learning/` directory itself (org home) or `.cormidia/learning/`
   *  (app repo). */
  dir: string;
}

export function orgLearningRoot(orgHome: string): LearningRoot {
  return { kind: "org", dir: join(orgHome, "learning") };
}

export function appLearningRoot(appWorkdir: string): LearningRoot {
  return { kind: "app", dir: join(appWorkdir, ".cormidia", "learning") };
}

/** Which root a scope's concepts live in (spec §1): `org` and `roles/<role>`
 *  in the org home; `apps/<app>` and deeper in the app repo. */
export function rootKindForScope(scope: string): LearningRootKind {
  return scope.startsWith("apps/") ? "app" : "org";
}

/** The scope's budget-share key (policy §13 `context_budget.shares`) — ONE
 *  owner for the scope-shape mapping, shared by the resolver's budgeting and
 *  the publisher's bundle-size validation so the two can never disagree. */
export function scopeShareKey(scope: string): "org" | "role" | "app" | "app_role" {
  if (scope === "org") return "org";
  if (scope.startsWith("roles/")) return "role";
  return scope.includes("/roles/") ? "app_role" : "app";
}

/** The app segment of an `apps/<app>[/roles/<role>]` scope. */
export function scopeApp(scope: string): string | undefined {
  return scope.startsWith("apps/") ? scope.split("/")[1] : undefined;
}

/** Concept names become filenames (`<name>.md`); a separator or traversal
 *  segment would let a quarantine write escape into bundle/ — the exact
 *  surface the placement table protects. */
export function assertSafeConceptName(name: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || /^\.+$/.test(name)) {
    throw new Error(
      `learning: concept name "${name}" must be a plain filename segment ` + `([A-Za-z0-9._-], no path separators)`,
    );
  }
  return name;
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

type ConceptPlacement = "candidates" | "quarantine" | "bundle";

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

interface LoadedConcept {
  doc: OkfDocument;
  /** Path the doc was loaded from. */
  path: string;
}

/** Governed concepts in one directory. Default is LOUD — unlike
 *  agent-writable memory trees, everything under quarantine/ and bundle/ went
 *  through the publisher or a human, so a broken file is corruption, not
 *  noise. The RESOLVER passes `onError: "skip-warn"` instead: one typo'd
 *  file in a governed dir must degrade that file (loud stderr warning, same
 *  contract as loadBundle's memory-doc handling) rather than wedge context
 *  assembly for every turn org-wide. */
export async function loadConceptDir(
  dir: string,
  placement: ConceptPlacement,
  options: { onError?: "throw" | "skip-warn" } = {},
): Promise<LoadedConcept[]> {
  const onError = options.onError ?? "throw";
  const bundle = await loadBundle(dir);
  if (bundle.errors.length > 0) {
    if (onError === "throw") {
      const first = bundle.errors[0]!;
      throw new Error(`learning: ${first.path}: ${first.message}`);
    }
    for (const error of bundle.errors) {
      process.stderr.write(`cormidia: skipping malformed governed concept — ${error.message}\n`);
    }
  }
  const out: LoadedConcept[] = [];
  for (const doc of bundle.docs) {
    try {
      out.push({
        doc: assertConceptPlacement(doc, placement),
        path: doc.path ?? join(dir, `${doc.frontmatter.name}.md`),
      });
    } catch (error) {
      if (onError === "throw") throw error;
      process.stderr.write(`cormidia: skipping misplaced governed concept — ${(error as Error).message}\n`);
    }
  }
  return out;
}

/** Find one concept by `loop.id` across a root's bundle scope dirs. */
async function findBundleConcept(root: LearningRoot, conceptId: string): Promise<LoadedConcept | undefined> {
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
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
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

interface ManifestHistoryEntry {
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

/** Live-canary trial state (M5, design §8.4). Present exactly while a canary
 *  is running. `concepts` — the ids the canary version introduced — is what
 *  derives the stable set deterministically from one bundle directory:
 *  stable lineage = active bundle minus these ids; canary lineage = the full
 *  bundle. Spec delta: the §8 sketch carries only the bare `canary` pointer,
 *  which cannot answer "which concepts are on trial" without mtime
 *  archaeology (the manifest-history `concepts` precedent from M4). */
export interface ManifestCanaryMeta {
  version: string;
  started_at: string;
  window_hours: number;
  fraction: number;
  tier: string;
  intervention_ref: string;
  concepts: string[];
}

export interface LearningManifest {
  schema_version: 1;
  bundle_version: string;
  stable: string;
  canary: string | null;
  canary_meta: ManifestCanaryMeta | null;
  history: ManifestHistoryEntry[];
}

function manifestPath(root: LearningRoot): string {
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
  const canary = typeof spec["canary"] === "string" ? spec["canary"] : null;
  let canaryMeta: ManifestCanaryMeta | null = null;
  const rawMeta = spec["canary_meta"];
  if (rawMeta !== undefined && rawMeta !== null) {
    if (typeof rawMeta !== "object" || Array.isArray(rawMeta)) {
      throw new Error(`learning: ${path}: canary_meta must be a mapping`);
    }
    const meta = rawMeta as Record<string, unknown>;
    const version = meta["version"];
    const startedAt = meta["started_at"];
    const windowHours = meta["window_hours"];
    const fraction = meta["fraction"];
    const tier = meta["tier"];
    const interventionRef = meta["intervention_ref"];
    const metaConcepts = meta["concepts"];
    if (
      typeof version !== "string" ||
      typeof startedAt !== "string" ||
      typeof windowHours !== "number" ||
      typeof fraction !== "number" ||
      typeof tier !== "string" ||
      typeof interventionRef !== "string" ||
      !Array.isArray(metaConcepts)
    ) {
      throw new Error(
        `learning: ${path}: canary_meta needs version, started_at, window_hours, fraction, ` +
          `tier, intervention_ref, and concepts`,
      );
    }
    canaryMeta = {
      version,
      started_at: startedAt,
      window_hours: windowHours,
      fraction,
      tier,
      intervention_ref: interventionRef,
      concepts: metaConcepts.map(String),
    };
  }
  // The pointer and the trial state travel together — one without the other
  // is a corrupt manifest, not a recoverable ambiguity.
  if ((canary === null) !== (canaryMeta === null)) {
    throw new Error(
      `learning: ${path}: canary and canary_meta must be set together — ` +
        `a canary pointer without its trial metadata (or vice versa) is unresolvable`,
    );
  }
  if (canaryMeta !== null && canaryMeta.version !== canary) {
    throw new Error(`learning: ${path}: canary_meta.version must equal the canary pointer`);
  }
  return {
    schema_version: 1,
    bundle_version: bundleVersion,
    stable,
    canary,
    canary_meta: canaryMeta,
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

interface CutVersionInput {
  approvalRef?: string;
  concepts: string[];
  note?: string;
  now?: Date;
}

/** Append one history entry and advance bundle_version + stable. Idempotent
 *  by approval ref: a re-run for an approval that already cut returns the
 *  existing entry (crash-resume, spec §14 step 4). Refuses while a canary
 *  runs: `stable` doubles as the trial's control pointer (design §8.4), so
 *  a mid-trial publish/disable/rollback would silently contaminate the
 *  population under measurement — the trial must close first. A publish
 *  refused here resumes cleanly from its journal after the canary closes. */
export async function cutManifestVersion(root: LearningRoot, input: CutVersionInput): Promise<ManifestHistoryEntry> {
  const now = input.now ?? new Date();
  const manifest = (await readManifest(root)) ?? {
    schema_version: 1 as const,
    bundle_version: "0",
    stable: "0",
    canary: null,
    canary_meta: null,
    history: [],
  };
  if (input.approvalRef !== undefined) {
    const existing = manifest.history.find((entry) => entry.approval_ref === input.approvalRef);
    if (existing !== undefined) return existing;
  }
  if (manifest.canary !== null) {
    throw new Error(
      `learning: ${manifestPath(root)} has an active canary (${manifest.canary}) — ` +
        `a version cut mid-trial would corrupt the trial population; ` +
        `\`cormidia learn canary promote|stop --root ${root.kind}\` first`,
    );
  }
  const entry: ManifestHistoryEntry = {
    version: nextVersion(manifest.history, now),
    commit: null,
    promoted: now.toISOString(),
    approval_ref: input.approvalRef ?? null,
    concepts: [...input.concepts],
    ...definedProps({ note: input.note }),
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

interface DisableResult {
  conceptId: string;
  path: string;
  version: string;
}

/** Deprecate a loaded concept file in place (loop.status + top-level status
 *  together, loop block byte-preserved) — the one shape `disable` and
 *  `rollback` both write. */
async function deprecateInPlace(found: LoadedConcept): Promise<void> {
  const loop = found.doc.frontmatter.loop!;
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
  // Guard BEFORE the mutation: a refusal that has already deprecated the
  // file would remove content from both trial arms while reporting
  // "refused" (adversarial-verify finding).
  await assertNoActiveCanary(root, "disable a concept");
  const found = await findBundleConcept(root, conceptId);
  if (found === undefined) return undefined;
  const loop = found.doc.frontmatter.loop!;
  if (loop.status !== "active") {
    throw new Error(`learning: ${conceptId} is already "${loop.status}" — nothing to disable`);
  }
  await deprecateInPlace(found);
  const cut = await cutManifestVersion(root, {
    concepts: [conceptId],
    note: `disable ${conceptId}`,
    ...definedProps({ now: options.now }),
  });
  return { conceptId, path: found.path, version: cut.version };
}

interface RollbackResult {
  revertedVersion: string;
  newVersion: string;
  deactivated: string[];
}

/** Revert the latest version cut: deprecate every concept that cut
 *  activated, then cut a new version recording the rollback. History stays
 *  append-only — a rollback is a new entry, never an erased one. */
export async function rollbackRoot(root: LearningRoot, options: { now?: Date } = {}): Promise<RollbackResult> {
  // Guard BEFORE deprecating anything: mid-trial the latest cut IS the
  // canary version, and a half-applied rollback would strip the trial's
  // own concepts while status still reports a live trial.
  await assertNoActiveCanary(root, "roll back a version cut");
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
  // One walk of the bundle, then O(1) lookups — a cut can name many concepts.
  const byId = new Map<string, LoadedConcept>();
  for (const dir of await listBundleScopeDirs(root)) {
    for (const concept of await loadConceptDir(dir, "bundle")) {
      byId.set(concept.doc.frontmatter.loop!.id, concept);
    }
  }
  const deactivated: string[] = [];
  for (const conceptId of last.concepts) {
    const found = byId.get(conceptId);
    if (found === undefined || found.doc.frontmatter.loop?.status !== "active") continue;
    await deprecateInPlace(found);
    deactivated.push(conceptId);
  }
  if (deactivated.length === 0) {
    // Rolling back a cut whose concepts are no longer active (typically a
    // disable cut) would change nothing while blocking future rollbacks —
    // refuse loudly instead of recording a no-op that reads as success.
    throw new Error(
      `learning: the latest cut (${last.version}${last.note !== undefined ? `, "${last.note}"` : ""}) ` +
        `has no still-active concepts — nothing to roll back; ` +
        `use \`cormidia learn disable <concept-id>\` for individual concepts`,
    );
  }
  const cut = await cutManifestVersion(root, {
    concepts: deactivated,
    note: `rollback of ${last.version}`,
    ...definedProps({ now: options.now }),
  });
  return { revertedVersion: last.version, newVersion: cut.version, deactivated };
}

// ---------------------------------------------------------------------------
// canary lifecycle on the manifest (M5, design §8.4; policy gating lives in
// canary.ts — these functions own only the manifest mechanics)
// ---------------------------------------------------------------------------

interface StartCanaryInput {
  /** The bundle version under trial — must be the latest cut. */
  version: string;
  windowHours: number;
  fraction: number;
  tier: string;
  interventionRef: string;
  now?: Date;
}

/** Re-point the manifest for a live trial: `stable` returns to the cut
 *  before `version`, `canary` points at `version`. No new cut — starting a
 *  trial changes exposure, not content; history already records the publish. */
export async function startCanaryOnManifest(root: LearningRoot, input: StartCanaryInput): Promise<LearningManifest> {
  const manifest = await readManifest(root);
  if (manifest === null || manifest.history.length === 0) {
    throw new Error(`learning: ${manifestPath(root)} has no version cuts — nothing to canary`);
  }
  if (manifest.canary !== null) {
    throw new Error(
      `learning: ${manifestPath(root)} already has an active canary (${manifest.canary}) — ` +
        `one trial per root; promote or stop it first`,
    );
  }
  const index = manifest.history.findIndex((entry) => entry.version === input.version);
  if (index === -1) {
    throw new Error(`learning: ${manifestPath(root)} has no cut ${input.version}`);
  }
  if (index !== manifest.history.length - 1) {
    throw new Error(
      `learning: ${input.version} is not the latest cut in ${manifestPath(root)} — ` +
        `later cuts already build on it; re-publish the candidate to trial it`,
    );
  }
  const entry = manifest.history[index]!;
  const previous = index > 0 ? manifest.history[index - 1]!.version : "0";
  const now = input.now ?? new Date();
  const next: LearningManifest = {
    ...manifest,
    stable: previous,
    canary: input.version,
    canary_meta: {
      version: input.version,
      started_at: now.toISOString(),
      window_hours: input.windowHours,
      fraction: input.fraction,
      tier: input.tier,
      intervention_ref: input.interventionRef,
      concepts: [...entry.concepts],
    },
  };
  await writeManifest(root, next);
  return next;
}

export interface CanaryCloseResult {
  version: string;
  newVersion: string;
  meta: ManifestCanaryMeta;
  /** stop only: concepts the close deprecated (still-active trial ids). */
  deactivated: string[];
}

/** Promote the running canary: its concepts join the stable lineage. One
 *  atomic manifest write appends the promote cut and clears the trial. */
export async function promoteCanaryOnManifest(
  root: LearningRoot,
  options: { now?: Date } = {},
): Promise<CanaryCloseResult> {
  const { manifest, meta } = await requireActiveCanary(root);
  const now = options.now ?? new Date();
  const entry: ManifestHistoryEntry = {
    version: nextVersion(manifest.history, now),
    commit: null,
    promoted: now.toISOString(),
    approval_ref: null,
    concepts: [...meta.concepts],
    note: `promote canary ${meta.version}`,
  };
  const next: LearningManifest = {
    ...manifest,
    bundle_version: entry.version,
    stable: entry.version,
    canary: null,
    canary_meta: null,
    history: [...manifest.history, entry],
  };
  await writeManifest(root, next);
  return { version: meta.version, newVersion: entry.version, meta, deactivated: [] };
}

/** Stop the running canary: deprecate its still-active concepts (the same
 *  shape as rollback), record the stop as an append-only cut, clear the
 *  trial. Concepts are deprecated BEFORE the manifest write so a crash
 *  between the two fails safe — the trial content is already inert. */
export async function stopCanaryOnManifest(
  root: LearningRoot,
  options: { now?: Date } = {},
): Promise<CanaryCloseResult> {
  const { manifest, meta } = await requireActiveCanary(root);
  const byId = new Map<string, LoadedConcept>();
  for (const dir of await listBundleScopeDirs(root)) {
    for (const concept of await loadConceptDir(dir, "bundle")) {
      byId.set(concept.doc.frontmatter.loop!.id, concept);
    }
  }
  const deactivated: string[] = [];
  for (const conceptId of meta.concepts) {
    const found = byId.get(conceptId);
    if (found === undefined || found.doc.frontmatter.loop?.status !== "active") continue;
    await deprecateInPlace(found);
    deactivated.push(conceptId);
  }
  const now = options.now ?? new Date();
  const entry: ManifestHistoryEntry = {
    version: nextVersion(manifest.history, now),
    commit: null,
    promoted: now.toISOString(),
    approval_ref: null,
    concepts: deactivated,
    note: `stop canary ${meta.version}`,
  };
  const next: LearningManifest = {
    ...manifest,
    bundle_version: entry.version,
    stable: entry.version,
    canary: null,
    canary_meta: null,
    history: [...manifest.history, entry],
  };
  await writeManifest(root, next);
  return { version: meta.version, newVersion: entry.version, meta, deactivated };
}

/** Shared mid-trial write guard: the version pointers double as the trial's
 *  control/treatment boundary (design §8.4), so bundle mutations wait for
 *  promote/stop. Called BEFORE any file is touched. */
async function assertNoActiveCanary(root: LearningRoot, action: string): Promise<void> {
  const manifest = await readManifest(root);
  if (manifest !== null && manifest.canary !== null) {
    throw new Error(
      `learning: ${manifestPath(root)} has an active canary (${manifest.canary}) — ` +
        `cannot ${action} mid-trial; \`cormidia learn canary promote|stop --root ${root.kind}\` first`,
    );
  }
}

async function requireActiveCanary(
  root: LearningRoot,
): Promise<{ manifest: LearningManifest; meta: ManifestCanaryMeta }> {
  const manifest = await readManifest(root);
  if (manifest === null || manifest.canary === null || manifest.canary_meta === null) {
    throw new Error(`learning: ${manifestPath(root)} has no active canary`);
  }
  return { manifest, meta: manifest.canary_meta };
}

// ---------------------------------------------------------------------------
// quarantine authoring — the human urgent lane (design §7, §10.1)
// ---------------------------------------------------------------------------

interface WriteProvisionalInput {
  doc: OkfDocument;
  policy: LearningPolicy;
}

/** Validate and write a human-authored provisional concept into
 *  quarantine/. Enforces the placement rules plus the policy TTL cap. */
export async function writeProvisionalConcept(root: LearningRoot, input: WriteProvisionalInput): Promise<string> {
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
    throw new Error(`learning: scope "${loop.scope}" belongs in the ${rootKindForScope(loop.scope)} root`);
  }
  const dir = quarantineDir(root);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${assertSafeConceptName(doc.frontmatter.name)}.md`);
  await writeFileAtomic(path, serializeOkfDocument(doc));
  return path;
}

// ---------------------------------------------------------------------------
// publish-time render (the publisher writes; spec §14 step 3)
// ---------------------------------------------------------------------------

interface ActivatedConcept {
  conceptId: string;
  name: string;
  scope: string;
  path: string;
  /** The exact bytes written — what final_diff_hash binds (spec §14). */
  bytes: string;
}

/** Render (do not yet write) the activated form of a candidate concept:
 *  loop.status candidate -> active, everything else byte-preserved. Pure so
 *  the publisher can hash the result for the approval binding BEFORE any
 *  write happens, and write the identical bytes after approval. */
export async function renderActivatedConcept(sourcePath: string): Promise<ActivatedConcept> {
  const doc = parseOkfDocument(await readFile(sourcePath, "utf8"), sourcePath);
  assertConceptPlacement({ ...doc, path: sourcePath }, "candidates");
  const loop = doc.frontmatter.loop!;
  const activated: OkfDocument = {
    ...doc,
    frontmatter: { ...doc.frontmatter, status: "active", loop: { ...loop, status: "active" } },
  };
  return {
    conceptId: loop.id,
    name: assertSafeConceptName(doc.frontmatter.name),
    scope: loop.scope,
    path: sourcePath,
    bytes: serializeOkfDocument(activated),
  };
}

/** TTL base is the `created` date (spec §3): quarantine concepts are
 *  short-lived by construction, and `updated` would let a touch extend
 *  life. ONE owner — the resolver enforces it and the CLI prints it. */
export function provisionalExpiry(doc: OkfDocument): Date {
  const loop = doc.frontmatter.loop!;
  const ttlDays = typeof loop["ttl_days"] === "number" ? loop["ttl_days"] : 0;
  const created = new Date(`${doc.frontmatter.created}T00:00:00Z`);
  return new Date(created.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}
