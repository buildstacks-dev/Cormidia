import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

function inside(root, candidate) {
  const relation = relative(root, candidate);
  return relation !== "" && !isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${sep}`);
}

async function repoRegularPath(repoRoot, reviewedPath) {
  if (
    typeof reviewedPath !== "string" ||
    reviewedPath.length === 0 ||
    isAbsolute(reviewedPath) ||
    reviewedPath.includes("\\") ||
    reviewedPath.includes("\0")
  ) {
    throw new Error(`reviewed source path is unsafe: ${String(reviewedPath)}`);
  }
  const root = resolve(repoRoot);
  const target = resolve(root, reviewedPath);
  if (!inside(root, target)) throw new Error(`reviewed source path escapes the repository: ${reviewedPath}`);
  const rootEntry = await lstat(root);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw new Error("reviewed source repository root must be one real directory");
  }
  let current = root;
  const components = relative(root, target).split(sep);
  for (const [index, component] of components.entries()) {
    current = resolve(current, component);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new Error(`reviewed source path crosses a symlink: ${reviewedPath}`);
    const final = index === components.length - 1;
    if ((!final && !entry.isDirectory()) || (final && !entry.isFile())) {
      throw new Error(`reviewed source path must resolve to one regular file: ${reviewedPath}`);
    }
  }
  const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(root), realpath(target)]);
  if (!inside(canonicalRoot, canonicalTarget)) {
    throw new Error(`reviewed source real path escapes the repository: ${reviewedPath}`);
  }
  return canonicalTarget;
}

export async function readRepoRegularText(repoRoot, reviewedPath) {
  return readFile(await repoRegularPath(repoRoot, reviewedPath), "utf8");
}

export async function readRepoRegularBytes(repoRoot, reviewedPath) {
  return readFile(await repoRegularPath(repoRoot, reviewedPath));
}
