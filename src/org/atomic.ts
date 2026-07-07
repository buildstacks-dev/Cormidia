// Atomic single-file writes for the org-layer state stores (journal, lock
// heartbeat, event dedup, schedule). Write to a uniquely-named temp sibling,
// then rename over the target: a reader — or a crash/SIGKILL landing mid-write
// — never sees a truncated file, so one ill-timed write can never corrupt a
// state store and wedge the whole dispatcher. Mirrors the tmp+rename
// discipline in src/runtime/runlog/envelope.ts; kept in src/org so the
// one-way import rule (src/org -> src/loop -> src/runtime) is not bent.

import { randomBytes } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

/** Atomically replace `path` with `contents`. The temp name carries a random
 *  suffix so two concurrent writers to the same target never share a temp
 *  file (rename stays last-writer-wins, which is these stores' semantics). */
export async function writeFileAtomic(path: string, contents: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, contents, "utf8");
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}
