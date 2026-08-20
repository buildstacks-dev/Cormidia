#!/usr/bin/env node

// Pre-commit variant of the validation-authority drift gate (#480).
//
// The checked-model gate binds its attestation to an exact committed product
// revision, so scripts/check-catalog-drift.mjs (via the public compiler)
// refuses any uncommitted path outside validation-design/. At pre-commit time
// the staged paths are by definition uncommitted, so the strict gate can never
// pass for an ordinary product commit. This wrapper runs the unchanged strict
// gate exactly when its precondition holds — clean product tree; a
// validation-design/ overlay is allowed — and otherwise defers loudly to CI,
// where `pnpm check` runs the strict gate against the committed tree. It must
// never replace the strict gate anywhere else: `pnpm check` and CI invoke
// scripts/check-catalog-drift.mjs directly.

import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DESIGN_ROOT = "validation-design";

function gitPaths(root, args) {
  const output = execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return output.length === 0 ? [] : output.split("\0").filter(Boolean);
}

function dirtyProductPaths(root) {
  return [
    ...gitPaths(root, ["diff", "--no-renames", "--name-only", "-z"]),
    ...gitPaths(root, ["diff", "--cached", "--no-renames", "--name-only", "-z"]),
    ...gitPaths(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ].filter((path) => path !== DESIGN_ROOT && !path.startsWith(`${DESIGN_ROOT}/`));
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error("usage: precommit-drift-gate.mjs [root]");
  const root = resolve(args[0] ?? process.cwd());
  const dirty = [...new Set(dirtyProductPaths(root))].sort();
  if (dirty.length > 0) {
    const shown = dirty.slice(0, 10).join(", ") + (dirty.length > 10 ? `, +${dirty.length - 10} more` : "");
    process.stdout.write(
      "Catalog drift gate deferred to CI: the public compiler cannot bind a source revision " +
        `to a dirty product tree (uncommitted: ${shown}). ` +
        "CI runs the strict gate (pnpm check) against the committed tree.\n",
    );
    return 0;
  }
  const checker = join(dirname(fileURLToPath(import.meta.url)), "check-catalog-drift.mjs");
  const result = spawnSync(process.execPath, [checker, root], { stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  return result.status ?? 1;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
