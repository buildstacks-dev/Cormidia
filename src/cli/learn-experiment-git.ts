import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { gitIn } from "../org/learning/replay.js";

export function ensureSeedClone(repoSlug: string, repoDir: string): void {
  if (existsSync(join(repoDir, ".git"))) {
    try {
      gitIn(repoDir, "fetch", "origin");
    } catch (error) {
      process.stderr.write(
        `learn experiment: fetch failed (continuing with the local clone): ` +
          `${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    return;
  }
  mkdirSync(dirname(repoDir), { recursive: true });
  gitIn(dirname(repoDir), "clone", `https://github.com/${repoSlug}.git`, repoDir);
}

export function ensureCommit(repoDir: string, repoSlug: string, commit: string): void {
  try {
    gitIn(repoDir, "cat-file", "-e", `${commit}^{commit}`);
    return;
  } catch {
    // Fetch an older or pruned seed directly before refusing the replay.
  }
  try {
    gitIn(repoDir, "fetch", "origin", commit);
    gitIn(repoDir, "cat-file", "-e", `${commit}^{commit}`);
  } catch {
    throw new Error(
      `learn experiment run: seed commit ${commit} is not reachable in ${repoSlug} — ` +
        "the fixture's starting state no longer exists; re-draft from a fresh episode",
    );
  }
}
