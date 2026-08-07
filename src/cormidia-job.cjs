#!/usr/bin/env node

// Launcher for the `cormidia-job` binary. Mirrors src/cormidia.cjs: an absolute
// CommonJS entry reaches the cwd guard before any ESM resolution, so a removed
// working directory becomes an actionable error instead of a module-loader stack.
let cwdAvailable = true;
try {
  process.cwd();
} catch {
  cwdAvailable = false;
}

if (!cwdAvailable) {
  process.stderr.write(
    "cormidia-job: cannot resolve the current working directory (it may have been removed) — cd to an existing directory and retry\n",
  );
  process.exitCode = 1;
} else {
  const { realpathSync } = require("node:fs");
  const { dirname, join } = require("node:path");
  const { pathToFileURL } = require("node:url");
  const entry = join(dirname(realpathSync(__filename)), "..", "dist", "jobs", "main.js");

  import(pathToFileURL(entry).href).catch((error) => {
    process.stderr.write(`cormidia-job launcher: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
