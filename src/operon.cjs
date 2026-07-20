#!/usr/bin/env node

// `process.cwd()` must be the first runtime-sensitive operation. An ESM import
// can resolve packages before application code runs, which is too late to turn
// a removed working directory into an actionable Operon error. An absolute
// CommonJS entry reaches this guard without ESM resolution.
let cwdAvailable = true;
try {
  process.cwd();
} catch {
  cwdAvailable = false;
}

if (!cwdAvailable) {
  process.stderr.write(
    "operon: cannot resolve the current working directory (it may have been removed) — cd to an existing directory and retry\n",
  );
  process.exitCode = 1;
} else {
  const { realpathSync } = require("node:fs");
  const { dirname, join } = require("node:path");
  const { pathToFileURL } = require("node:url");
  const entry = join(dirname(realpathSync(__filename)), "..", "dist", "cli.js");

  import(pathToFileURL(entry).href).catch((error) => {
    process.stderr.write(`operon launcher: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
