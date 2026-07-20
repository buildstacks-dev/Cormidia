import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { BaseRevision } from "../../loop/default-branch.js";
import type { JsonValue } from "../../loop/episode-plan.js";
import { gitSnapshotOf } from "../../runtime/git.js";
import { worktreeFingerprint } from "../../loop/efficiency.js";

const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;
const MAX_CHANGED_PATHS = 256;
const MAX_SCRIPT_NAMES = 128;
const MAX_PACKAGE_BYTES = 256 * 1024;
const MAX_FACT_STRING = 512;

export interface RepositoryInspection {
  repositoryFacts: Record<string, JsonValue>;
  changeFacts: Record<string, JsonValue>;
}

/**
 * Token-free, bounded repository inspection. It records hashes, structured
 * git metadata, path inventory, and declared command names; it never reads
 * arbitrary source prose or classifies safety from keywords.
 */
export function inspectEpisodeRepository(input: {
  workdir: string;
  baseRevision: BaseRevision;
}): RepositoryInspection {
  const workdir = realpathSync(input.workdir);
  if (!statSync(workdir).isDirectory()) throw new Error(`repository inspection: ${workdir} is not a directory`);
  const snapshot = gitSnapshotOf(workdir);
  if (snapshot === undefined) {
    throw new Error(`repository inspection: ${workdir} is not an exact git checkout root`);
  }
  verifyCommit(workdir, input.baseRevision.ref);
  const trackedRaw = gitBuffer(workdir, ["ls-files", "-z"]);
  const tracked = splitNul(trackedRaw.toString("utf8")).sort();
  const statusRaw = gitBuffer(workdir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const changesRaw = gitBuffer(workdir, [
    "diff",
    "--name-status",
    "-z",
    "--no-renames",
    input.baseRevision.ref,
    "--",
  ]);
  const untrackedRaw = gitBuffer(workdir, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const trackedChanges = parseNameStatus(changesRaw.toString("utf8"));
  const untracked = splitNul(untrackedRaw.toString("utf8"))
    .map((path) => ({ status: "untracked", path }))
    .sort(comparePathFact);
  const changes = [...trackedChanges, ...untracked].sort(comparePathFact);
  const packageFacts = inspectPackageManifest(workdir);

  return {
    repositoryFacts: {
      checkout: basename(workdir),
      head: snapshot.head,
      branch: snapshot.branch,
      baseRef: input.baseRevision.ref,
      defaultBranch: input.baseRevision.defaultBranch,
      worktreeFingerprint: worktreeFingerprint(workdir) ?? null,
      trackedFileCount: tracked.length,
      trackedInventorySha256: sha256(trackedRaw),
      trackedExtensions: extensionCounts(tracked),
      manifests: manifestPresence(workdir),
      package: packageFacts,
    },
    changeFacts: {
      dirty: statusRaw.length > 0,
      changedPathCount: changes.length,
      changedPathsTruncated: changes.length > MAX_CHANGED_PATHS,
      changedPaths: changes.slice(0, MAX_CHANGED_PATHS),
      changeInventorySha256: sha256(Buffer.concat([changesRaw, untrackedRaw])),
    },
  };
}

function inspectPackageManifest(workdir: string): JsonValue {
  const path = join(workdir, "package.json");
  if (!existsSync(path)) return null;
  if (statSync(path).size > MAX_PACKAGE_BYTES) return { status: "oversize" };
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { status: "invalid_json" };
  }
  if (!isRecord(value)) return { status: "invalid_shape" };
  const scripts = isRecord(value["scripts"])
    ? Object.keys(value["scripts"])
        .map((name) => name.slice(0, MAX_FACT_STRING))
        .sort()
        .slice(0, MAX_SCRIPT_NAMES)
    : [];
  return {
    status: "valid",
    ...(typeof value["packageManager"] === "string"
      ? { packageManager: value["packageManager"].slice(0, MAX_FACT_STRING) }
      : {}),
    scriptNames: scripts,
    scriptNamesTruncated:
      isRecord(value["scripts"]) && Object.keys(value["scripts"]).length > MAX_SCRIPT_NAMES,
  };
}

function manifestPresence(workdir: string): Record<string, JsonValue> {
  const manifests = [
    "package.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "package-lock.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "requirements.txt",
    "Gemfile",
  ];
  return Object.fromEntries(manifests.map((file) => [file, existsSync(join(workdir, file))]));
}

function extensionCounts(paths: readonly string[]): Record<string, JsonValue> {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const extension = extname(path).toLowerCase() || "(none)";
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function parseNameStatus(value: string): Array<{ status: string; path: string }> {
  const fields = splitNul(value);
  const result: Array<{ status: string; path: string }> = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (status === undefined || path === undefined) {
      throw new Error("repository inspection: malformed git name-status output");
    }
    result.push({ status, path });
  }
  return result;
}

function verifyCommit(workdir: string, ref: string): void {
  gitBuffer(workdir, ["rev-parse", "--verify", `${ref}^{commit}`]);
}

function gitBuffer(workdir: string, args: readonly string[]): Buffer {
  return execFileSync("git", [...args], {
    cwd: workdir,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
}

function splitNul(value: string): string[] {
  return value.split("\0").filter((entry) => entry.length > 0);
}

function comparePathFact(
  left: { status: string; path: string },
  right: { status: string; path: string },
): number {
  return left.path.localeCompare(right.path) || left.status.localeCompare(right.status);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
