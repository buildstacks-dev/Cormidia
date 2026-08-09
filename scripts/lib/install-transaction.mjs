import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { lstat, mkdir, readlink, rename, rm, symlink } from "node:fs/promises";

async function observe(path) {
  try {
    const info = await lstat(path);
    return {
      type: info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : "file",
      dev: info.dev,
      ino: info.ino,
      rawLink: info.isSymbolicLink() ? await readlink(path) : undefined,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { type: "absent" };
    throw error;
  }
}

function sameObservation(left, right) {
  return left.type === right.type && left.dev === right.dev && left.ino === right.ino && left.rawLink === right.rawLink;
}

async function assertObserved(path, expected) {
  const current = await observe(path);
  if (!sameObservation(current, expected)) {
    throw new Error(`install target changed after preflight; refusing transaction: ${path}`);
  }
}

/**
 * Replace a bounded path set with rollback on every ordinary failure.
 *
 * Every existing target is renamed aside only after its exact directory entry
 * is rechecked. The callback may promote staged paths or create symlinks only
 * at the declared targets. If it throws, generated entries are removed only
 * while their inode/link identity still matches this transaction, then every
 * prior entry is restored. A concurrent foreign replacement is preserved and
 * reported instead of being deleted to make rollback look clean.
 */
export async function transactionalReplace(targets, apply) {
  const describedTargets = targets.map((item) => (typeof item === "string" ? { target: item } : item));
  const uniqueTargets = [...new Set(describedTargets.map((item) => item.target))];
  if (uniqueTargets.length !== describedTargets.length) {
    throw new Error("install transaction target set contains duplicates");
  }
  const allowed = new Set(uniqueTargets);
  const token = `${process.pid}-${randomUUID()}`;
  const initial = new Map();
  const backups = new Map();
  const promoted = new Map();

  for (const item of describedTargets) initial.set(item.target, item.entry ?? (await observe(item.target)));

  const requireTarget = (target) => {
    if (!allowed.has(target)) throw new Error(`install transaction attempted an undeclared target: ${target}`);
  };

  try {
    for (const target of uniqueTargets) {
      const observed = initial.get(target);
      await assertObserved(target, observed);
      if (observed.type === "absent") continue;
      const backup = join(dirname(target), `.${basename(target)}.cormidia-backup-${token}`);
      if ((await observe(backup)).type !== "absent") throw new Error(`install backup path already exists: ${backup}`);
      await rename(target, backup);
      backups.set(target, backup);
    }

    const promotePath = async (source, target) => {
      requireTarget(target);
      if ((await observe(target)).type !== "absent") {
        throw new Error(`install target was recreated during transaction: ${target}`);
      }
      const sourceEntry = await observe(source);
      if (sourceEntry.type === "absent") throw new Error(`staged install artifact is absent: ${source}`);
      await mkdir(dirname(target), { recursive: true });
      await rename(source, target);
      promoted.set(target, sourceEntry);
    };

    const promoteSymlink = async (source, target, kind) => {
      requireTarget(target);
      await mkdir(dirname(target), { recursive: true });
      const temporary = join(dirname(target), `.${basename(target)}.cormidia-new-${token}`);
      try {
        await symlink(source, temporary, kind);
        await promotePath(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
    };

    await apply({ promotePath, promoteSymlink });
  } catch (error) {
    const rollbackErrors = [];
    for (const [target, created] of [...promoted.entries()].reverse()) {
      try {
        await assertObserved(target, created);
        await rm(target, { recursive: true, force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const [target, backup] of [...backups.entries()].reverse()) {
      try {
        if ((await observe(target)).type !== "absent") {
          throw new Error(`rollback target is occupied; prior artifact preserved at ${backup}: ${target}`);
        }
        await rename(backup, target);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      const detail = rollbackErrors.map((item) => (item instanceof Error ? item.message : String(item))).join("; ");
      throw new Error(`${error instanceof Error ? error.message : String(error)}; rollback incomplete: ${detail}`, {
        cause: error,
      });
    }
    throw error;
  }

  const cleanupErrors = [];
  for (const backup of backups.values()) {
    try {
      await rm(backup, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    const detail = cleanupErrors.map((item) => (item instanceof Error ? item.message : String(item))).join("; ");
    throw new Error(`install replacement completed, but owned backup cleanup failed: ${detail}`);
  }
}
