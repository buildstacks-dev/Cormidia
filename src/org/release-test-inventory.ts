interface GitTreeEntry {
  mode: string;
  type: string;
  path: string;
}

export function parseReleaseTrackedVitestTree(result: string): string[] {
  const entries = result
    .split("\0")
    .filter(Boolean)
    .map(parseTreeEntry)
    .filter((entry) => /^tests\/.+\.test\.ts$/.test(entry.path) && !entry.path.startsWith("tests/live/"));
  const invalid = entries.filter((entry) => entry.mode !== "100644" || entry.type !== "blob");
  if (invalid.length > 0) {
    throw new Error(
      `release candidate test must be a regular tracked file: ${invalid.map((row) => row.path).join(", ")}`,
    );
  }
  const paths = entries.map((entry) => entry.path).sort();
  if (paths.length === 0) throw new Error("release candidate has no tracked offline Vitest files");
  if (new Set(paths).size !== paths.length)
    throw new Error("release candidate has duplicate tracked offline Vitest files");
  return paths;
}

function parseTreeEntry(row: string): GitTreeEntry {
  const parsed = /^([0-7]{6}) ([a-z]+) [a-f0-9]{40,64}\t(.+)$/.exec(row);
  if (parsed?.[1] === undefined || parsed[2] === undefined || parsed[3] === undefined)
    throw new Error("release candidate test tree inventory is malformed");
  return { mode: parsed[1], type: parsed[2], path: parsed[3] };
}
