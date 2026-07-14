import { randomBytes } from "node:crypto";
import { link, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Crash-safe immutable/replace write for loop-owned evidence. */
export async function writeLoopFileAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, contents, "utf8");
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

/** Atomically publish an immutable file. The fully-written temporary inode is
 * linked into place with O_EXCL semantics, so concurrent first writers can
 * never observe a partial target or replace the winner. */
export async function writeLoopFileOnce(path: string, contents: string): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, contents, "utf8");
    try {
      await link(tmp, path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}
