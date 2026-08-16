import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { QUALIFICATION_HOST_POLICY_PATH } from "./qualification-host-policy.js";
import {
  LEGACY_VALIDATION_POLICY_PATH,
  loadReleasePolicyAuthority,
  VALIDATION_MODEL_PATHS,
  type ReleasePolicyAuthority,
} from "./release-policy-authority.js";

const execFile = promisify(execFileCallback);
const COMMIT = /^[a-f0-9]{40}$/;
const AUTHORITY_PATHS = [
  QUALIFICATION_HOST_POLICY_PATH,
  LEGACY_VALIDATION_POLICY_PATH,
  ...VALIDATION_MODEL_PATHS,
] as const;
const RETIRED_ROOT_AUTHORITY_PATHS = [
  "validation-design/case-catalog.yaml",
  "validation-design/case-catalog-generator.awk",
] as const;
const GENERATED_VIEW_PATHS = [
  "validation-design/case-catalog.md",
  "validation-design/harness-backlog.md",
  "validation-design/owner-briefing.md",
  "validation-design/owner-backlog.md",
  "validation-design/planned-trace.md",
] as const;
const AUTHORITY_PATH_SET: ReadonlySet<string> = new Set(AUTHORITY_PATHS);
const TRACKED_CONTROL_PATHS = [...AUTHORITY_PATHS, ...RETIRED_ROOT_AUTHORITY_PATHS, ...GENERATED_VIEW_PATHS] as const;
const TRACKED_CONTROL_PATH_SET: ReadonlySet<string> = new Set(TRACKED_CONTROL_PATHS);
const MODEL_PATH_SET: ReadonlySet<string> = new Set(VALIDATION_MODEL_PATHS);
interface TreeEntry {
  mode: string;
  type: string;
  path: string;
}

export async function loadReleasePolicyAuthorityFromGit(
  repo: string,
  candidateCommit: string,
  validateModel: (productRevision: string) => Promise<void>,
): Promise<ReleasePolicyAuthority> {
  revision(candidateCommit, "release policy candidate");
  const [productRevision, tracked, modelEntries] = await Promise.all([
    latestProductRevision(repo, candidateCommit),
    trackedAuthorityEntries(repo, candidateCommit),
    trackedTreeEntries(repo, candidateCommit, ["validation-design/model"]),
  ]);
  const modelPaths = modelEntries.map((entry) => entry.path);
  const hostEntry = tracked.get(QUALIFICATION_HOST_POLICY_PATH);
  if (hostEntry !== undefined) assertRegularAuthorityEntry(hostEntry);
  if (modelPaths.some((path) => MODEL_PATH_SET.has(path))) {
    const retired = RETIRED_ROOT_AUTHORITY_PATHS.filter((path) => tracked.has(path));
    if (retired.length > 0) throw new Error(`release checked-model dual authority is forbidden: ${retired.join(", ")}`);
    for (const entry of modelEntries) assertRegularAuthorityEntry(entry);
    if (VALIDATION_MODEL_PATHS.every((path) => modelPaths.includes(path))) {
      for (const path of GENERATED_VIEW_PATHS) {
        const view = tracked.get(path);
        if (view === undefined) throw new Error(`release checked model is missing generated view ${path}`);
        assertRegularAuthorityEntry(view);
      }
    }
  } else {
    const legacyEntry = tracked.get(LEGACY_VALIDATION_POLICY_PATH);
    if (legacyEntry !== undefined) assertRegularAuthorityEntry(legacyEntry);
  }
  return loadReleasePolicyAuthority({
    candidateCommit,
    productRevision,
    modelPaths,
    legacyPresent: tracked.has(LEGACY_VALIDATION_POLICY_PATH),
    validateModel,
    read: async (path) => {
      if (!AUTHORITY_PATH_SET.has(path)) throw new Error(`release policy requested unexpected path ${path}`);
      return tracked.has(path) ? gitFile(repo, candidateCommit, path) : null;
    },
  });
}

async function latestProductRevision(repo: string, candidate: string): Promise<string> {
  let current = candidate;
  for (;;) {
    const row = await gitText(repo, ["rev-list", "--parents", "-n", "1", current]);
    const revisions = row.trim().split(/\s+/).filter(Boolean);
    if (revisions[0] !== current) throw new Error("release product-revision walk returned an unexpected commit");
    const parent = revisions[1];
    if (parent === undefined) return current;
    revision(parent, "release policy product-revision parent");
    const changed = await gitText(repo, ["diff", "--no-renames", "--name-only", "-z", parent, current], false);
    const productPaths = changed
      .split("\0")
      .filter(Boolean)
      .filter((path) => path !== "validation-design" && !path.startsWith("validation-design/"));
    if (productPaths.length > 0) return current;
    current = parent;
  }
}

async function trackedAuthorityEntries(repo: string, candidate: string): Promise<Map<string, TreeEntry>> {
  const entries = await trackedTreeEntries(repo, candidate, TRACKED_CONTROL_PATHS);
  if (entries.some((entry) => !TRACKED_CONTROL_PATH_SET.has(entry.path)))
    throw new Error("release policy tree walk returned a path outside the closed authority-control set");
  return new Map(entries.map((entry) => [entry.path, entry]));
}

async function trackedTreeEntries(repo: string, candidate: string, paths: readonly string[]): Promise<TreeEntry[]> {
  const output = await gitText(repo, ["ls-tree", "-r", "-z", candidate, "--", ...paths], false);
  return output
    .split("\0")
    .filter(Boolean)
    .map((row) => {
      const parsed = /^([0-7]{6}) ([a-z]+) [a-f0-9]{40,64}\t(.+)$/.exec(row);
      if (parsed?.[1] === undefined || parsed[2] === undefined || parsed[3] === undefined)
        throw new Error("release policy tree walk returned a malformed entry");
      return { mode: parsed[1], type: parsed[2], path: parsed[3] };
    });
}

function assertRegularAuthorityEntry(entry: TreeEntry): void {
  if (entry.mode !== "100644" || entry.type !== "blob")
    throw new Error(`release policy authority ${entry.path} must be a regular tracked file`);
}

async function gitFile(repo: string, candidate: string, path: string): Promise<Buffer> {
  try {
    const result = await execFile("git", ["-C", repo, "show", `${candidate}:${path}`], {
      encoding: "buffer",
      maxBuffer: 50 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    throw new Error(`release candidate is missing tracked input ${path}`, { cause: error });
  }
}

async function gitText(repo: string, args: string[], trim = true): Promise<string> {
  try {
    const result = await execFile("git", ["-C", repo, ...args], {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
    return trim ? result.stdout.trim() : result.stdout;
  } catch (error) {
    throw new Error(`release policy git ${args[0] ?? "command"} failed`, { cause: error });
  }
}

function revision(value: string, name: string): void {
  if (!COMMIT.test(value)) throw new Error(`${name} must be an exact commit`);
}
