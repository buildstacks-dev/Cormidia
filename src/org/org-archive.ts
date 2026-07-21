// Org retirement: enumerate discoverable orgs, and archive one before
// removing its local state (ENH-001).
//
// Retiring an org used to be hand-moving directories nobody could enumerate:
// `~/.operon/config` is the only record of the active org, each org's state
// home is discoverable only by listing `~/.operon`, and once the pointer is
// gone nothing points at the org home at all. That made the operation most
// likely to lose data the one with the least protection.
//
// The rules here follow `app reset` and `scheduler uninstall`:
//   - non-mutating plan by default;
//   - mutation requires `--execute` AND an exact `--confirm <org>` token;
//   - nothing is removed that was not first archived and verified byte-for-byte;
//   - the org home (usually a git repo / human checkout) and every GitHub
//     repository are reported as left intact, never touched.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { loadApps } from "./apps.js";
import { resolveActiveOrgSelection, writeActiveOrgPointer } from "./home.js";
import {
  LIFECYCLE_SCHEMA_VERSION,
  assertDirectoryNoSymlink,
  assertRegularFile,
  sha256,
  stableJson,
  writeLifecycleFileAtomic,
  type LifecycleBlocker,
} from "./lifecycle.js";

export const ORG_ARCHIVE_SCHEMA_VERSION = LIFECYCLE_SCHEMA_VERSION;

/** Written into each state home so the org home stays discoverable after the
 * active pointer moves on. Its absence is exactly the orphan condition
 * ENH-001 asks `doctor` to surface. */
export const ORG_BACKLINK_FILE = "org-home.json";

/** Entries under the pointer's parent that are Operon's own, not an org. */
const NON_ORG_ENTRIES = new Set(["archives", "questionnaire", "config"]);

export interface OrgBacklink {
  schema_version: typeof ORG_ARCHIVE_SCHEMA_VERSION;
  kind: "org-home-backlink";
  org_home: string;
  recorded_at: string;
}

export function orgBacklinkPath(stateHome: string): string {
  return join(resolve(stateHome), ORG_BACKLINK_FILE);
}

/** Record which org home owns this state home. Idempotent and never
 * destructive: an existing backlink to the same org home is left alone. */
export async function recordOrgBacklink(
  stateHome: string,
  orgHome: string,
  now: Date = new Date(),
): Promise<void> {
  const path = orgBacklinkPath(stateHome);
  const backlink: OrgBacklink = {
    schema_version: ORG_ARCHIVE_SCHEMA_VERSION,
    kind: "org-home-backlink",
    org_home: resolve(orgHome),
    recorded_at: now.toISOString(),
  };
  await mkdir(dirname(path), { recursive: true });
  await writeLifecycleFileAtomic(path, `${stableJson(backlink).trimEnd()}\n`);
}

export async function readOrgBacklink(stateHome: string): Promise<string | undefined> {
  const path = orgBacklinkPath(stateHome);
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<OrgBacklink>;
    return typeof value.org_home === "string" ? value.org_home : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// org list
// ---------------------------------------------------------------------------

export interface DiscoveredOrg {
  name: string;
  stateHome: string;
  /** Resolved from the active pointer or the state home's backlink. */
  orgHome: string | null;
  /** True when the org home is recorded but no longer present on disk. */
  orgHomeMissing: boolean;
  active: boolean;
  /** No resolvable org home: hand-retired, or created before backlinks. */
  orphan: boolean;
  appCount: number | null;
  footprintBytes: number;
  fileCount: number;
  /** Newest mtime under the state home, or null for an empty tree. */
  lastActivityAt: string | null;
  /** False when footprint/activity were deliberately not measured. */
  usageMeasured: boolean;
}

export interface ListOrgsOptions {
  /** Defaults to the active-pointer path (`~/.operon/config`). */
  pointerPath: string;
  /**
   * Walk each state home to measure footprint and last activity. Defaults to
   * true (`org list` reports both). A caller that only needs identity — such
   * as doctor's orphan check — passes false so enumeration stays O(orgs)
   * instead of O(every file in every state home).
   */
  includeUsage?: boolean;
}

/**
 * Enumerate every org discoverable from the pointer's parent directory.
 * Read-only: it opens no repository, contacts no remote, and writes nothing.
 */
export async function listOrgs(options: ListOrgsOptions): Promise<DiscoveredOrg[]> {
  const pointerPath = resolve(options.pointerPath);
  const root = dirname(pointerPath);
  // Not `pointer.state_home` raw: a pointer that records only an org home
  // still selects a state home, and reading it raw made the active org look
  // inactive to every surface here.
  const pointer = await resolveActiveOrgSelection(pointerPath);
  const activeStateHome = pointer.stateHome === undefined ? undefined : resolve(pointer.stateHome);
  const candidates = new Map<string, string>();
  if (existsSync(root)) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || NON_ORG_ENTRIES.has(entry.name)) continue;
      candidates.set(resolve(join(root, entry.name)), entry.name);
    }
  }
  // An org whose state home lives outside the default root is still active.
  if (activeStateHome !== undefined && !candidates.has(activeStateHome)) {
    candidates.set(activeStateHome, basenameOf(activeStateHome));
  }

  const discovered: DiscoveredOrg[] = [];
  for (const [stateHome, name] of [...candidates.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const active = stateHome === activeStateHome;
    const recorded = active && pointer.orgHome !== undefined
      ? resolve(pointer.orgHome)
      : await readOrgBacklink(stateHome);
    const usage = options.includeUsage === false
      ? { bytes: 0, files: 0, newestMtime: null }
      : await treeUsage(stateHome);
    discovered.push({
      name,
      stateHome,
      orgHome: recorded ?? null,
      orgHomeMissing: recorded !== undefined && !existsSync(recorded),
      active,
      orphan: recorded === undefined,
      appCount: recorded === undefined ? null : await appCount(recorded),
      footprintBytes: usage.bytes,
      fileCount: usage.files,
      lastActivityAt: usage.newestMtime === null ? null : usage.newestMtime.toISOString(),
      usageMeasured: options.includeUsage !== false,
    });
  }
  return discovered;
}

// ---------------------------------------------------------------------------
// org archive
// ---------------------------------------------------------------------------

export interface OrgArchivePlan {
  schema_version: typeof ORG_ARCHIVE_SCHEMA_VERSION;
  kind: "org-archive-plan";
  org: DiscoveredOrg;
  archiveRoot: string;
  archiveId: string;
  archivePath: string;
  /** Paths this operation will remove, after the archive verifies. */
  removes: string[];
  /** Paths deliberately left as they are, with the reason. */
  leavesIntact: Array<{ path: string; reason: string }>;
  /** True when the active pointer will be cleared. */
  clearsActivePointer: boolean;
  blockers: LifecycleBlocker[];
  executed: boolean;
}

export interface PlanOrgArchiveOptions {
  pointerPath: string;
  org: string;
  /** Archive parent. Must be outside the archived state home. */
  archiveRoot?: string;
  now?: Date;
}

export async function planOrgArchive(options: PlanOrgArchiveOptions): Promise<OrgArchivePlan> {
  const pointerPath = resolve(options.pointerPath);
  const archiveRoot = resolve(options.archiveRoot ?? join(dirname(pointerPath), "archives"));
  const orgs = await listOrgs({ pointerPath });
  const org = orgs.find((entry) => entry.name === options.org);
  if (org === undefined) {
    // Re-running a retirement is the ordinary case, not a typo: say which it
    // is. An org with no state home left and an archive on disk is finished.
    const prior = join(archiveRoot, `${safeSegment(options.org)}-org-latest.json`);
    throw new Error(
      `org archive: unknown org ${JSON.stringify(options.org)}; ` +
        `operon org list shows: ${orgs.map((entry) => entry.name).join(", ") || "none"}` +
        (existsSync(prior)
          ? `. It has no local state home left and was already archived; see ${prior}`
          : ""),
    );
  }
  if (isInside(archiveRoot, org.stateHome)) {
    throw new Error("org archive: --archive-root must be outside the archived state home");
  }
  const { archiveId, archivePath } = allocateArchivePath(archiveRoot, archiveBaseId(org));

  const blockers: LifecycleBlocker[] = [];
  for (const blocker of await activeWorkBlockers(org.stateHome)) blockers.push(blocker);

  return {
    schema_version: ORG_ARCHIVE_SCHEMA_VERSION,
    kind: "org-archive-plan",
    org,
    archiveRoot,
    archiveId,
    archivePath,
    removes: [org.stateHome],
    leavesIntact: [
      ...(org.orgHome === null
        ? []
        : [{
            path: org.orgHome,
            reason:
              "org home: committed configuration, usually a git repository and often a human checkout",
          }]),
      {
        path: "GitHub repositories, branches, and open tickets",
        reason: "never touched by a local retirement; retire them deliberately and separately",
      },
    ],
    clearsActivePointer: org.active,
    blockers,
    executed: false,
  };
}

export interface ExecuteOrgArchiveOptions extends PlanOrgArchiveOptions {
  confirm: string;
}

export interface OrgArchiveResult {
  plan: OrgArchivePlan;
  archivePath: string;
  manifestSha256: string;
}

/**
 * Archive the org's state home, verify every archived byte, and only then
 * remove it. A verification failure leaves the state home untouched.
 */
export async function executeOrgArchive(
  options: ExecuteOrgArchiveOptions,
): Promise<OrgArchiveResult> {
  const plan = await planOrgArchive(options);
  if (options.confirm !== plan.org.name) {
    throw new Error(
      `org archive: --confirm must be exactly ${JSON.stringify(plan.org.name)}`,
    );
  }
  if (plan.blockers.length > 0) {
    throw new Error(
      `org archive: execution blocked — ${plan.blockers.map((blocker) => blocker.code).join("; ")}`,
    );
  }

  await mkdir(plan.archiveRoot, { recursive: true });
  // Re-allocate now that the archive root exists: the plan's id was chosen
  // against whatever was on disk when it was previewed, and the same org
  // archived twice from the same paths hashes to the same base id.
  const { archiveId, archivePath } = allocateArchivePath(
    plan.archiveRoot,
    archiveBaseId(plan.org),
  );
  const staged = `${archivePath}.partial`;
  await rm(staged, { recursive: true, force: true });
  await mkdir(staged, { recursive: true });
  let manifestSha256: string;
  try {
    await cp(plan.org.stateHome, join(staged, "state"), {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    });
    // Copy the ratified org configuration for reference. The org home itself
    // is left where it is; this is a snapshot, not a move.
    if (plan.org.orgHome !== null && existsSync(plan.org.orgHome)) {
      for (const rel of ["TASTE.md", "roles.yaml", "apps.yaml", "pipelines.yaml", "AUTHORITY.md"]) {
        const source = join(plan.org.orgHome, rel);
        if (existsSync(source)) await cp(source, join(staged, "org", rel), { force: true });
      }
    }
    const files = await fileDigests(staged);
    const manifest = stableJson({
      schema_version: ORG_ARCHIVE_SCHEMA_VERSION,
      kind: "org-archive",
      archive_id: archiveId,
      org: plan.org.name,
      org_home: plan.org.orgHome,
      state_home: plan.org.stateHome,
      archived_at: (options.now ?? new Date()).toISOString(),
      left_intact: plan.leavesIntact,
      files,
    });
    await writeFile(join(staged, "manifest.json"), manifest, "utf8");
    manifestSha256 = sha256(manifest);

    // Prove the archive reproduces the state home before anything is removed.
    await assertArchiveCoversStateHome(plan.org.stateHome, join(staged, "state"));
    try {
      await rename(staged, archivePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOTEMPTY" || code === "EEXIST" || code === "EPERM") {
        throw new Error(
          `org archive: ${archivePath} already exists, so nothing was archived or removed and ` +
            `${plan.org.stateHome} is untouched; move or delete that archive directory, or ` +
            "re-run with --archive-root <path> to archive somewhere else",
        );
      }
      throw error;
    }
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }

  await rm(plan.org.stateHome, { recursive: true, force: true });
  if (plan.clearsActivePointer) {
    await rm(resolve(options.pointerPath), { force: true });
  }
  await writeLifecycleFileAtomic(
    join(plan.archiveRoot, `${safeSegment(plan.org.name)}-org-latest.json`),
    stableJson({
      schema_version: ORG_ARCHIVE_SCHEMA_VERSION,
      kind: "org-archive-latest",
      org: plan.org.name,
      archive_id: archiveId,
      archive_path: archivePath,
      manifest_sha256: manifestSha256,
    }),
  );
  return {
    plan: { ...plan, archiveId, archivePath, executed: true },
    archivePath,
    manifestSha256,
  };
}

/** Re-point the pointer at another discoverable org, used by tests and by an
 * operator recovering after archiving the active org. */
export async function selectDiscoveredOrg(
  pointerPath: string,
  org: DiscoveredOrg,
): Promise<void> {
  if (org.orgHome === null) throw new Error(`org: ${org.name} has no recorded org home`);
  await writeActiveOrgPointer(pointerPath, org.orgHome, org.stateHome);
}

export function formatOrgArchivePlan(plan: OrgArchivePlan): string {
  const lines = [
    `${plan.executed ? "Org archived" : "Org archive plan"}: ${plan.org.name}`,
    `  state home:  ${plan.org.stateHome} (${formatBytes(plan.org.footprintBytes)}, ${plan.org.fileCount} files)`,
    `  org home:    ${plan.org.orgHome ?? "unknown — no backlink recorded (orphan state home)"}`,
    `  apps:        ${plan.org.appCount ?? "unknown"}`,
    `  last active: ${plan.org.lastActivityAt ?? "never"}`,
    `  archive:     ${plan.archivePath}`,
  ];
  for (const removal of plan.removes) lines.push(`  removes:     ${removal}`);
  for (const intact of plan.leavesIntact) {
    lines.push(`  left intact: ${intact.path} — ${intact.reason}`);
  }
  if (plan.clearsActivePointer) {
    lines.push("  clears the active org pointer; select another org with `operon org use <path>`");
  }
  for (const blocker of plan.blockers) {
    lines.push(`  BLOCKED ${blocker.code}: ${blocker.ids.join(", ")}`);
    lines.push(`    ${blocker.remediation}`);
  }
  if (!plan.executed) {
    lines.push(
      plan.blockers.length > 0
        ? "  Nothing was archived or removed."
        : "  Nothing was archived or removed. To execute: " +
          `operon org archive ${plan.org.name} --execute --confirm ${plan.org.name}`,
    );
  }
  return lines.join("\n");
}

export function formatOrgList(orgs: readonly DiscoveredOrg[]): string {
  if (orgs.length === 0) return "No orgs discovered.";
  const lines = ["ORG                  STATE                                          APPS  FOOTPRINT  LAST ACTIVITY"];
  for (const org of orgs) {
    lines.push(
      `${(org.active ? `* ${org.name}` : `  ${org.name}`).padEnd(21)}` +
        `${org.stateHome.padEnd(47)}` +
        `${String(org.appCount ?? "?").padStart(4)}  ` +
        `${formatBytes(org.footprintBytes).padStart(9)}  ` +
        `${org.lastActivityAt ?? "never"}`,
    );
    if (org.orphan) {
      lines.push("      orphan: no org home recorded; `operon org archive` can still retire it");
    } else if (org.orgHomeMissing) {
      lines.push(`      org home missing: ${org.orgHome}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/** Conditions under which archiving would destroy live or undecided work. */
async function activeWorkBlockers(stateHome: string): Promise<LifecycleBlocker[]> {
  const blockers: LifecycleBlocker[] = [];
  const locks = await listFiles(join(stateHome, "locks"), (name) => name.endsWith(".lock"));
  if (locks.length > 0) {
    blockers.push({
      code: "active_lock",
      ids: locks,
      forceEligible: false,
      remediation:
        "a role turn holds a lock in this org; let it finish or clear the lock before retiring the org",
    });
  }
  const pending = await listFiles(join(stateHome, "approvals", "pending"), (name) =>
    name.endsWith(".json"),
  );
  if (pending.length > 0) {
    blockers.push({
      code: "pending_approval",
      ids: pending,
      forceEligible: false,
      remediation:
        "decide every pending critical-operation approval with `operon approvals review` first",
    });
  }
  const transactions = await listFiles(join(stateHome, "lifecycle", "transactions"), (name) =>
    name.endsWith(".json"),
  );
  if (transactions.length > 0) {
    blockers.push({
      code: "active_journal",
      ids: transactions,
      forceEligible: false,
      remediation:
        "an interrupted lifecycle transaction is recorded; re-run that command to finish or roll it back",
    });
  }
  return blockers;
}

async function listFiles(dir: string, accept: (name: string) => boolean): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && accept(entry.name))
    .map((entry) => join(dir, entry.name))
    .sort();
}

interface TreeUsage {
  bytes: number;
  files: number;
  newestMtime: Date | null;
}

async function treeUsage(root: string): Promise<TreeUsage> {
  const usage: TreeUsage = { bytes: 0, files: 0, newestMtime: null };
  if (!existsSync(root)) return usage;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const info = await stat(path);
        usage.bytes += info.size;
        usage.files += 1;
        if (usage.newestMtime === null || info.mtime > usage.newestMtime) {
          usage.newestMtime = info.mtime;
        }
      } catch {
        // A file that vanished mid-walk contributes nothing; it is also not
        // something this read-only enumeration should fail over.
      }
    }
  }
  return usage;
}

async function appCount(orgHome: string): Promise<number | null> {
  const path = join(orgHome, "apps.yaml");
  if (!existsSync(path)) return null;
  try {
    return (await loadApps(path)).apps.length;
  } catch {
    return null;
  }
}

async function fileDigests(
  root: string,
): Promise<Array<{ path: string; bytes: number; sha256: string }>> {
  const entries: Array<{ path: string; bytes: number; sha256: string }> = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) {
        const content = await readFile(path);
        entries.push({
          path: relative(root, path),
          bytes: content.byteLength,
          sha256: createHash("sha256").update(content).digest("hex"),
        });
      }
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The "refuse to destroy anything it cannot first archive" check. Every
 * regular file under the state home must exist in the archive with identical
 * bytes; anything unreadable, missed, or altered aborts before removal.
 */
async function assertArchiveCoversStateHome(
  stateHome: string,
  archivedState: string,
): Promise<void> {
  const source = new Map((await fileDigests(stateHome)).map((entry) => [entry.path, entry]));
  const archived = new Map((await fileDigests(archivedState)).map((entry) => [entry.path, entry]));
  const missing: string[] = [];
  for (const [path, entry] of source) {
    const copied = archived.get(path);
    if (copied === undefined || copied.sha256 !== entry.sha256 || copied.bytes !== entry.bytes) {
      missing.push(path);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `org archive: ${missing.length} file(s) are not faithfully archived, so nothing was removed: ` +
        `${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}`,
    );
  }
}

export async function readOrgArchiveManifest(
  archivePath: string,
): Promise<Record<string, unknown>> {
  const target = await assertDirectoryNoSymlink(resolve(archivePath), "org archive");
  const manifestPath = join(target, "manifest.json");
  await assertRegularFile(manifestPath, "org archive manifest");
  return JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
}

/** Content identity of the retirement: same org, same paths, same base id. */
function archiveBaseId(org: Pick<DiscoveredOrg, "name" | "stateHome" | "orgHome">): string {
  return `${safeSegment(org.name)}-org-archive-${sha256(
    stableJson({ name: org.name, stateHome: org.stateHome, orgHome: org.orgHome }),
  ).slice(0, 16)}`;
}

/**
 * The base id is deterministic, so archiving the same org from the same paths
 * twice — routine once a state home has been recreated — targets a directory
 * that already holds the first archive. Renaming onto it failed with a raw
 * `ENOTEMPTY` and no remediation. Later retirements get a numbered sibling
 * instead; the earlier archive is never written into or replaced.
 */
function allocateArchivePath(
  archiveRoot: string,
  baseId: string,
): { archiveId: string; archivePath: string } {
  for (let attempt = 1; attempt <= 999; attempt++) {
    const archiveId = attempt === 1 ? baseId : `${baseId}-${attempt}`;
    const archivePath = join(archiveRoot, archiveId);
    if (!existsSync(archivePath)) return { archiveId, archivePath };
  }
  throw new Error(
    `org archive: ${join(archiveRoot, baseId)} and its 998 numbered siblings all exist; ` +
      "move that archive history aside, or re-run with --archive-root <path>",
  );
}

/**
 * Where the terminal audit row of a command that removes its own audit target
 * goes. `org archive --execute` deletes the state home its invocation is
 * journaling to, and writing the terminal row back into that path recreated
 * `<state>/invocations/` and `<state>/state/invocation-journal` — so the org
 * `org list` and `doctor` had just been told was retired came back as an
 * orphan on the very next command.
 *
 * Dropping the row instead would trade one defect for another: every command
 * is audited. The row belongs in a ledger that outlives the org, and the
 * retirement's own durable home is the archive root, outside every state home
 * by construction (`planOrgArchive` refuses an archive root inside the tree it
 * archives).
 */
export function orgRetirementLedgerHome(archiveRoot: string): string {
  return join(resolve(archiveRoot), "retirement-ledger");
}

function safeSegment(value: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "org";
}

function basenameOf(path: string): string {
  const parts = resolve(path).split(sep);
  return parts[parts.length - 1] ?? "org";
}

function isInside(candidate: string, ancestor: string): boolean {
  const rel = relative(ancestor, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(sep));
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)}${units[unit]}`;
}
