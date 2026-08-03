// hermetic/cf-j01 support — temp lifecycle worlds + full-tree snapshot oracle
// for the destructive-lifecycle families (HB-015: CF-J01-*, CF-C-OPLIFE).
//
// Everything here is TEMP-FS ONLY: worlds live under mkdtemp roots, the org
// home is built by the REAL product init transaction (initOrgHome), and no
// path ever reaches the operator checkout or the real ~/.cormidia. Snapshots
// walk through fixtures/walk.ts so a sweep over a moved/renamed tree can
// never pass vacuously (claude-tests/README.md rule 4); every world root
// carries a sentinel file so "empty world" is impossible by construction.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initOrgHome } from "../../../src/org/home.js";
import { assertNonEmptyWalk, walkFiles } from "../../fixtures/walk.js";

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Relative path -> content sha256 for every regular file under root. */
export type TreeSnapshot = Map<string, string>;

export interface SnapshotDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

/** Snapshot a tree that MUST contain at least one file (non-empty walk — a
 *  missing/renamed root throws instead of snapshotting nothing). */
export async function snapshotTree(root: string): Promise<TreeSnapshot> {
  const files = await assertNonEmptyWalk(root);
  const snapshot: TreeSnapshot = new Map();
  for (const rel of files) {
    snapshot.set(rel, sha256Hex(await readFile(join(root, rel))));
  }
  return snapshot;
}

/** Snapshot a tree that may legitimately hold no files yet (e.g. an absent
 *  init target). Distinct name so the default stays the guarded walk. */
export async function snapshotTreeAllowEmpty(root: string): Promise<TreeSnapshot> {
  let files: string[];
  try {
    files = await walkFiles(root);
  } catch {
    return new Map();
  }
  const snapshot: TreeSnapshot = new Map();
  for (const rel of files) {
    snapshot.set(rel, sha256Hex(await readFile(join(root, rel))));
  }
  return snapshot;
}

export function diffSnapshots(before: TreeSnapshot, after: TreeSnapshot): SnapshotDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [rel, hash] of after) {
    const prior = before.get(rel);
    if (prior === undefined) added.push(rel);
    else if (prior !== hash) changed.push(rel);
  }
  for (const rel of before.keys()) {
    if (!after.has(rel)) removed.push(rel);
  }
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

export function diffIsEmpty(diff: SnapshotDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}

export function diffPaths(diff: SnapshotDiff): string[] {
  return [...diff.added, ...diff.removed, ...diff.changed].sort();
}

/** A world for org init/use cases: a temp root with reserved (absent) org and
 *  state homes, a fake $HOME, and a sentinel so root walks are never empty. */
export interface InitWorld {
  root: string;
  target: string;
  stateHome: string;
  homeDir: string;
  pointerPath: string;
  cleanup(): Promise<void>;
}

export async function makeInitWorld(): Promise<InitWorld> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-cf-j01-"));
  await writeFile(join(root, "sentinel.txt"), "world sentinel — walks are never empty\n", "utf8");
  return {
    root,
    target: join(root, "org"),
    stateHome: join(root, "state"),
    homeDir: join(root, "home"),
    pointerPath: join(root, "home", ".cormidia", "config"),
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Build a COMPLETE org at the world's target via the real init transaction. */
export async function initWorldOrg(world: InitWorld, name = "cf-j01-org"): Promise<void> {
  await initOrgHome({
    target: world.target,
    name,
    stateHome: world.stateHome,
    homeDir: world.homeDir,
    pointerPath: world.pointerPath,
  });
}

/** A legacy org for upgrade cases: complete org built by the real init, then
 *  aged — TASTE.md and AUTHORITY.md removed, schema_version stripped from
 *  apps.yaml, and roles.yaml stamped with a human-ratified marker byte
 *  sequence so "ratified surfaces never replaced" is byte-checkable. */
export interface UpgradeWorld extends InitWorld {
  orgHome: string;
  archiveRoot: string;
  /** apps.yaml bytes as the legacy org held them (pre-upgrade truth). */
  originalAppsYaml: string;
  /** roles.yaml bytes carrying the human marker (must never be replaced). */
  ratifiedRolesYaml: string;
}

export const HUMAN_RATIFIED_MARKER = "# human-ratified marker: cf-j01 upgrade world\n";

export async function makeUpgradeWorld(name = "cf-j01-legacy"): Promise<UpgradeWorld> {
  const world = await makeInitWorld();
  await initWorldOrg(world, name);
  const orgHome = world.target;
  await rm(join(orgHome, "TASTE.md"));
  await rm(join(orgHome, "AUTHORITY.md"));
  const withSchema = await readFile(join(orgHome, "apps.yaml"), "utf8");
  const originalAppsYaml = withSchema.replace(/^schema_version:.*\n/m, "");
  await writeFile(join(orgHome, "apps.yaml"), originalAppsYaml, "utf8");
  const roles = await readFile(join(orgHome, "roles.yaml"), "utf8");
  const ratifiedRolesYaml = `${HUMAN_RATIFIED_MARKER}${roles}`;
  await writeFile(join(orgHome, "roles.yaml"), ratifiedRolesYaml, "utf8");
  return {
    ...world,
    orgHome,
    archiveRoot: join(world.root, "archives"),
    originalAppsYaml,
    ratifiedRolesYaml,
  };
}

/** Repo root, resolved from this spec's location — never process.cwd(). */
export const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

/** Kill-point scenario driving the REAL executeOrgUpgrade in a subprocess,
 *  with the product's in-memory fault hook bridged onto kp() markers so the
 *  harness can SIGKILL exactly at a named journaled step (B-07/B-15). */
export const UPGRADE_KILL_SCENARIO = `
import { executeOrgUpgrade } from ${JSON.stringify(join(REPO_ROOT, "src/org/org-upgrade.js"))};
await kp("start");
await executeOrgUpgrade({
  orgHome: process.env.CF_ORG_HOME!,
  stateHome: process.env.CF_STATE_HOME!,
  archiveRoot: process.env.CF_ARCHIVE_ROOT!,
  authorityChoice: "conservative",
  fault: async (point) => { await kp(point); },
});
await kp("done");
`;

export function upgradeKillEnv(world: UpgradeWorld): Record<string, string> {
  return {
    CF_ORG_HOME: world.orgHome,
    CF_STATE_HOME: world.stateHome,
    CF_ARCHIVE_ROOT: world.archiveRoot,
  };
}
