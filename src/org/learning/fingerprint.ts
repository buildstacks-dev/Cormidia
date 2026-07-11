// SystemFingerprint (docs/learning-loop/learning-loop-spec.md §6): a
// content-addressed snapshot of everything that shaped an episode's
// behavior. `fingerprint_id` is the hash of the canonical serialization, so
// identical configurations share one fingerprint, and control/treatment arms
// of an M3 experiment are two fingerprints differing only in the
// intervention under test.
//
// Capture-truthful deltas from the spec sketch, recorded like M1's:
//   - `gates_hash` and `permissions_hash` are null: gate rules and role
//     toolset shaping are CODE, versioned by `operon.commit`, until either
//     externalizes into config worth hashing separately.
//   - `budget_caps` carries what actually exists today — the app's monthly
//     cap and each role's per-turn cap — not the sketch's org-daily shape.
//   - `bundle_versions`/`bundle_lineage` default empty/"stable"; M5's
//     experiment arms inject the resolved manifest state (`options.bundle`)
//     — capture never fakes them (M1 precedent).

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { gitHeadOf } from "../../runtime/git.js";
import type { RoleConfig } from "../../runtime/types.js";
import { writeFileAtomic } from "../atomic.js";

export interface FingerprintModelEntry {
  runtime: string;
  model: string;
  effort: string;
}

export interface SystemFingerprint {
  fingerprint_id: string;
  operon: { version: string | null; commit: string | null };
  org: {
    commit: string | null;
    taste_hash: string | null;
    roles_hash: string | null;
    pipelines_hash: string | null;
    prompts_hash: string | null;
  };
  app: { name: string; commit: string | null; config_hash: string | null };
  bundle_versions: Record<string, string>;
  bundle_lineage: string;
  models: Record<string, FingerprintModelEntry>;
  gates_hash: null;
  permissions_hash: null;
  budget_caps: {
    app_usd_month: number | null;
    per_turn_usd_by_role: Record<string, number>;
  };
  env: { node: string; platform: string };
}

export interface ComputeFingerprintOptions {
  packageRoot: string;
  orgHome: string;
  app: { name: string; workdir?: string; budgetUsdMonth?: number };
  roles: Record<
    string,
    Pick<RoleConfig, "runtime" | "model" | "effort" | "maxTurnBudgetUsd">
  >;
  /** Injectable for deterministic tests; defaults to the live process. */
  env?: { node: string; platform: string };
  /** Resolved bundle versions + lineage for the arm this fingerprint
   *  describes (M5): the control arm carries the manifests' stable state,
   *  the treatment arm the same plus its candidate marker. Absent keeps
   *  the M2 empty/"stable" shape. */
  bundle?: { versions: Record<string, string>; lineage: string };
}

export async function computeSystemFingerprint(
  options: ComputeFingerprintOptions,
): Promise<SystemFingerprint> {
  const roleNames = Object.keys(options.roles).sort();
  const models: Record<string, FingerprintModelEntry> = {};
  const perTurn: Record<string, number> = {};
  for (const name of roleNames) {
    const role = options.roles[name]!;
    models[name] = { runtime: role.runtime, model: role.model, effort: role.effort };
    perTurn[name] = role.maxTurnBudgetUsd;
  }

  const [version, tasteHash, rolesHash, pipelinesHash, promptsHash, configHash] =
    await Promise.all([
      packageVersion(options.packageRoot),
      fileHash(join(options.orgHome, "TASTE.md")),
      fileHash(join(options.orgHome, "roles.yaml")),
      fileHash(join(options.orgHome, "pipelines.yaml")),
      treeHash(join(options.orgHome, "prompts")),
      options.app.workdir !== undefined
        ? fileHash(join(options.app.workdir, ".operon", "config.yaml"))
        : Promise.resolve(null),
    ]);

  const body: Omit<SystemFingerprint, "fingerprint_id"> = {
    operon: {
      version,
      // gitHeadOf reports a commit only when the directory IS a checkout —
      // an npm-installed package under an app's node_modules must read
      // null, never the app repo's HEAD (upward discovery).
      commit: gitHeadOf(options.packageRoot) ?? null,
    },
    org: {
      commit: gitHeadOf(options.orgHome) ?? null,
      taste_hash: tasteHash,
      roles_hash: rolesHash,
      pipelines_hash: pipelinesHash,
      prompts_hash: promptsHash,
    },
    app: {
      name: options.app.name,
      commit:
        options.app.workdir !== undefined ? (gitHeadOf(options.app.workdir) ?? null) : null,
      config_hash: configHash,
    },
    bundle_versions: options.bundle?.versions ?? {},
    bundle_lineage: options.bundle?.lineage ?? "stable",
    models,
    gates_hash: null,
    permissions_hash: null,
    budget_caps: {
      app_usd_month: options.app.budgetUsdMonth ?? null,
      per_turn_usd_by_role: perTurn,
    },
    env: options.env ?? { node: process.version, platform: process.platform },
  };

  return { fingerprint_id: `sys_${contentHash(body).slice(0, 12)}`, ...body };
}

/** Derive a sibling fingerprint that differs only in the bundle block —
 *  the M5 treatment arm. Reuses the base's file hashes instead of
 *  re-hashing the whole org for a one-field change. */
export function deriveFingerprintWithBundle(
  base: SystemFingerprint,
  bundle: { versions: Record<string, string>; lineage: string },
): SystemFingerprint {
  const { fingerprint_id: _id, ...body } = base;
  const next = {
    ...body,
    bundle_versions: { ...bundle.versions },
    bundle_lineage: bundle.lineage,
  };
  return { fingerprint_id: `sys_${contentHash(next).slice(0, 12)}`, ...next };
}

export function fingerprintsDir(stateHome: string): string {
  return join(stateHome, "learning", "fingerprints");
}

export function fingerprintPath(stateHome: string, fingerprintId: string): string {
  return join(fingerprintsDir(stateHome), `${fingerprintId}.json`);
}

/** Content-addressed store: writing the same configuration twice is a no-op
 *  by construction (same id, same bytes). Returns the fingerprint id. */
export async function storeFingerprint(
  stateHome: string,
  fingerprint: SystemFingerprint,
): Promise<string> {
  const path = fingerprintPath(stateHome, fingerprint.fingerprint_id);
  if (!existsSync(path)) {
    await mkdir(fingerprintsDir(stateHome), { recursive: true });
    await writeFileAtomic(path, JSON.stringify(fingerprint, null, 2) + "\n");
  }
  return fingerprint.fingerprint_id;
}

export async function readFingerprint(
  stateHome: string,
  fingerprintId: string,
): Promise<SystemFingerprint | undefined> {
  const path = fingerprintPath(stateHome, fingerprintId);
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8")) as SystemFingerprint;
}

/** Dotted paths of every leaf that differs between two fingerprints,
 *  `fingerprint_id` excluded (it differs by construction). This is how an
 *  experiment's control/treatment arms show a reviewer they "differ only in
 *  the intervention under test" (spec §6, §10) — software reports the exact
 *  delta; the intent judgment stays human. */
export function fingerprintDelta(a: SystemFingerprint, b: SystemFingerprint): string[] {
  const paths = new Set<string>();
  collectLeafDiffs(canonical(a), canonical(b), "", paths);
  paths.delete("fingerprint_id");
  return [...paths].sort();
}

function collectLeafDiffs(a: unknown, b: unknown, prefix: string, out: Set<string>): void {
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      collectLeafDiffs(a[key], b[key], prefix === "" ? key : `${prefix}.${key}`, out);
    }
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.add(prefix === "" ? "(root)" : prefix);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// input readers
// ---------------------------------------------------------------------------

/** Canonical serialization: keys sorted recursively, so the hash sees
 *  content, never a caller's object-literal insertion order (the injectable
 *  `env` would otherwise split one configuration into two ids). */
function contentHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(body)), "utf8").digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonical(record[key])]),
    );
  }
  return value;
}

async function packageVersion(packageRoot: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    ) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

async function fileHash(path: string): Promise<string | null> {
  try {
    return `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
  } catch {
    return null;
  }
}

/** One hash over every file under the directory (recursive — prompts nest
 *  per pipeline: `prompts/build/implement.md`), keyed by sorted relative
 *  path, so a renamed, moved, added, or edited prompt all change it. Null
 *  when the directory is absent. */
async function treeHash(dir: string): Promise<string | null> {
  if (!existsSync(dir)) return null;
  const files = (await readdir(dir, { withFileTypes: true, recursive: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(path.slice(dir.length + 1), "utf8");
    hash.update("\0");
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}
