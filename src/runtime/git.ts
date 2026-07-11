// Best-effort git HEAD resolution for capture surfaces (learning-loop
// spec §6-§7): the ONE helper both the pass executor's replay-seed stamp
// (src/loop/pipeline.ts) and the SystemFingerprint's commit fields
// (src/org/learning/fingerprint.ts) use, so their truthfulness rules cannot
// drift apart.
//
// Truthful means: a commit is reported only when `dir` IS a checkout — git's
// upward repository discovery would otherwise attribute an enclosing repo's
// HEAD to a non-git directory nested inside it (an npm-installed package
// under an app's node_modules would fingerprint the APP's commit as
// operon's). One spawn resolves both the toplevel and HEAD; a timeout keeps
// a wedged filesystem from blocking the event loop; failures of any kind
// read as "unknown", never as an error.

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

export function gitHeadOf(dir: string): string | undefined {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel", "HEAD"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
      .toString()
      .trim()
      .split("\n");
    const [toplevel, head] = out;
    if (toplevel === undefined || head === undefined) return undefined;
    // realpath both sides: macOS tempdirs reach /private/tmp via symlink.
    if (realpathSync(toplevel) !== realpathSync(dir)) return undefined;
    return head;
  } catch {
    return undefined;
  }
}
