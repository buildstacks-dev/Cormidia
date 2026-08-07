#!/usr/bin/env node

// Source-backed local launcher for the `cormidia-job` binary. `pnpm link:local`
// puts a symlink to the pre-ESM guard in `src/cormidia-job-local.cjs` on PATH;
// that guard imports this file, so the next `cormidia-job` invocation reads the
// latest TypeScript source without a rebuild or relink. The packaged binary
// takes the other path entirely: src/cormidia-job.cjs -> dist/jobs/main.js.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../src/jobs/main.ts", import.meta.url));
const tsxLoader = createRequire(import.meta.url).resolve("tsx");
const child = spawn(process.execPath, ["--import", tsxLoader, entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

// Keep the source-backed wrapper transparent for foreground commands. A job
// graph runs steps to completion and owns its own interrupt handling; killing
// only this wrapper would orphan the real runner mid-step or report a
// misleading signal exit after the journal had already closed cleanly.
const forward = (signal) => {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
};
const onSigint = () => forward("SIGINT");
const onSigterm = () => forward("SIGTERM");
process.on("SIGINT", onSigint);
process.on("SIGTERM", onSigterm);

child.on("error", (error) => {
  console.error(`cormidia-job local launcher: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
