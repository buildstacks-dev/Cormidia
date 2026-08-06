import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  return execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

let gitRoot;
try {
  gitRoot = resolve(git(["rev-parse", "--show-toplevel"]));
} catch {
  process.exit(0);
}

if (gitRoot !== repoRoot) {
  process.exit(0);
}

git(["config", "--local", "core.hooksPath", ".githooks"]);
console.log("Configured core.hooksPath=.githooks");
