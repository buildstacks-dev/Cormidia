import { lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { MIGRATION } from "./migration-contract.mjs";

export async function lstatIfExists(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function diagnosticPath(path) {
  const relation = relative(MIGRATION.repoRoot, resolve(path)).replaceAll("\\", "/");
  return relation || ".";
}

function assertInsideRepo(path) {
  const resolved = resolve(path);
  const relation = relative(MIGRATION.repoRoot, resolved);
  if (relation === "" || relation === ".." || relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error(`migration output target escapes the repository: ${diagnosticPath(path)}`);
  }
  return resolved;
}

async function assertDirectoryChain(target) {
  const directories = [];
  let current = dirname(target);
  for (;;) {
    directories.push(current);
    if (current === MIGRATION.repoRoot) break;
    const parent = dirname(current);
    if (parent === current) throw new Error(`migration target has no repository ancestor: ${diagnosticPath(target)}`);
    current = parent;
  }
  for (const directory of directories.reverse()) {
    const entry = await lstatIfExists(directory);
    if (entry !== null && (!entry.isDirectory() || entry.isSymbolicLink())) {
      throw new Error(`migration output ancestor must be a real directory: ${diagnosticPath(directory)}`);
    }
  }
}

export async function retiredRootPresence() {
  const present = [];
  for (const name of MIGRATION.retiredRootNames) {
    if ((await lstatIfExists(join(MIGRATION.designRoot, name))) !== null) present.push(name);
  }
  return present;
}

export async function preflightWriteTargets(targets) {
  const resolvedTargets = [];
  for (const target of targets) {
    const resolved = assertInsideRepo(target);
    if (resolvedTargets.includes(resolved))
      throw new Error(`duplicate migration output target: ${diagnosticPath(resolved)}`);
    resolvedTargets.push(resolved);
    await assertDirectoryChain(resolved);
    const entry = await lstatIfExists(resolved);
    if (entry !== null && (!entry.isFile() || entry.isSymbolicLink())) {
      throw new Error(`migration output target must be absent or a regular file: ${diagnosticPath(resolved)}`);
    }
  }
  const retired = await retiredRootPresence();
  if (retired.length > 0) throw new Error(`retired root authority remains present: ${retired.join(", ")}`);
  const modelRoot = join(MIGRATION.designRoot, "model");
  const modelEntry = await lstatIfExists(modelRoot);
  if (modelEntry !== null) {
    if (!modelEntry.isDirectory() || modelEntry.isSymbolicLink()) {
      throw new Error("validation-design/model must be absent or a real directory");
    }
    const entries = await readdir(modelRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!MIGRATION.modelNames.includes(entry.name)) {
        throw new Error(`unexpected pre-existing model entry: ${entry.name}`);
      }
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error(`pre-existing model entry must be a regular file: ${entry.name}`);
      }
    }
  }
}

// Each replacement is atomic. A process failure between renames leaves a
// partial bundle, which the exact inventory/drift gates reject and a rerun repairs.
export async function writeArtifactsSafely(artifacts) {
  const targets = artifacts.map((artifact) => artifact.path);
  await preflightWriteTargets(targets);
  for (const target of targets) await mkdir(dirname(target), { recursive: true });
  await preflightWriteTargets(targets);

  const staged = [];
  try {
    for (const [index, artifact] of artifacts.entries()) {
      const temporary = `${artifact.path}.migration-${process.pid}-${index}.tmp`;
      if ((await lstatIfExists(temporary)) !== null)
        throw new Error(`migration staging target exists: ${diagnosticPath(temporary)}`);
      await writeFile(temporary, artifact.content, { encoding: "utf8", flag: "wx" });
      staged.push({ temporary, target: artifact.path });
    }
    for (const artifact of staged) await rename(artifact.temporary, artifact.target);
  } finally {
    await Promise.all(staged.map((artifact) => rm(artifact.temporary, { force: true })));
  }
}
