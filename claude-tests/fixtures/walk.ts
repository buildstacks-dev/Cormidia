// fixtures/walk.ts — the non-empty-walk assertion every sweep must use.
//
// "No green by absence" (claude-tests/README.md rule 4; policy
// harness_self_tests): a sweep that iterates files it discovered on disk must
// prove the discovery found something, or a renamed/moved directory silently
// turns the whole sweep into a vacuous pass. `assertNonEmptyWalk` is that
// proof: it throws `EmptyWalkError` on a missing directory, an empty walk, or
// a pattern that matched nothing — an absent tree is an empty walk, never an
// ignorable one.

import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export class EmptyWalkError extends Error {
  constructor(
    readonly dir: string,
    readonly reason: "missing-directory" | "no-files" | "pattern-matched-nothing",
    readonly pattern?: RegExp,
  ) {
    super(
      reason === "missing-directory"
        ? `empty walk: directory does not exist: ${dir}`
        : reason === "no-files"
          ? `empty walk: no files under ${dir}`
          : `empty walk: no files under ${dir} match ${String(pattern)}`,
    );
    this.name = "EmptyWalkError";
  }
}

/** Recursively list every regular file under `dir`, as sorted paths relative
 *  to `dir` (always `/`-separated so patterns are platform-stable). Symlinks
 *  are listed but never followed as directories. When `pattern` is given only
 *  matching relative paths are returned. Returns [] rather than throwing —
 *  the throwing entry point is `assertNonEmptyWalk`. */
export async function walkFiles(dir: string, pattern?: RegExp): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new EmptyWalkError(dir, "missing-directory");
    }
    throw error;
  }
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
  return pattern === undefined ? files : files.filter((file) => pattern.test(file));
}

/** The sweep guard: returns the (non-empty) relative file list, or throws
 *  `EmptyWalkError`. Every fixture/corpus sweep starts here so a sweep can
 *  never silently pass over nothing. */
export async function assertNonEmptyWalk(dir: string, pattern?: RegExp): Promise<string[]> {
  const all = await walkFiles(dir);
  if (all.length === 0) throw new EmptyWalkError(dir, "no-files");
  if (pattern === undefined) return all;
  const matched = all.filter((file) => pattern.test(file));
  if (matched.length === 0) throw new EmptyWalkError(dir, "pattern-matched-nothing", pattern);
  return matched;
}
