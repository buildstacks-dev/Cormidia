#!/usr/bin/env node

// Source-backed local launcher shim for `cormidia-job`. Mirrors
// src/cormidia-local.cjs: `process.cwd()` must be the first runtime-sensitive
// operation, because an ESM import can resolve packages before application
// code runs — too late to turn a removed working directory into an actionable
// Cormidia error. An absolute CommonJS entry reaches this guard without ESM
// resolution.
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
  const launcher = join(dirname(realpathSync(__filename)), "..", "scripts", "cormidia-job-local.mjs");

  import(pathToFileURL(launcher).href).catch((error) => {
    process.stderr.write(`cormidia-job local launcher: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
