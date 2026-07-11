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
//   - `bundle_versions` stays empty and `bundle_lineage` "stable" until M4
//     introduces manifests; capture never fakes them (M1 precedent).

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
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

  const body: Omit<SystemFingerprint, "fingerprint_id"> = {
    operon: {
      version: await packageVersion(options.packageRoot),
      commit: gitHead(options.packageRoot),
    },
    org: {
      commit: gitHead(options.orgHome),
      taste_hash: await fileHash(join(options.orgHome, "TASTE.md")),
      roles_hash: await fileHash(join(options.orgHome, "roles.yaml")),
      pipelines_hash: await fileHash(join(options.orgHome, "pipelines.yaml")),
      prompts_hash: await treeHash(join(options.orgHome, "prompts")),
    },
    app: {
      name: options.app.name,
      commit: options.app.workdir !== undefined ? gitHead(options.app.workdir) : null,
      config_hash:
        options.app.workdir !== undefined
          ? await fileHash(join(options.app.workdir, ".operon", "config.yaml"))
          : null,
    },
    bundle_versions: {},
    bundle_lineage: "stable",
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

// ---------------------------------------------------------------------------
// input readers
// ---------------------------------------------------------------------------

function contentHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body), "utf8").digest("hex");
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

function gitHead(dir: string): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: dir, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
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
