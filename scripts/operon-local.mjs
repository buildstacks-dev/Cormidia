#!/usr/bin/env node

// Source-backed local launcher. `pnpm link:local` puts a symlink to this file
// on PATH, so the next `operon` invocation reads the latest TypeScript source
// without a rebuild or relink.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tsxLoader = createRequire(import.meta.url).resolve("tsx");
const child = spawn(process.execPath, ["--import", tsxLoader, cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

// Keep the source-backed wrapper transparent for foreground commands. In
// particular, `operon observe` owns graceful SIGINT/SIGTERM shutdown; killing
// only this wrapper would orphan the real CLI child or report a misleading
// signal exit even after the observer closed cleanly.
const forward = (signal) => {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
};
const onSigint = () => forward("SIGINT");
const onSigterm = () => forward("SIGTERM");
process.on("SIGINT", onSigint);
process.on("SIGTERM", onSigterm);

child.on("error", (error) => {
  console.error(`operon local launcher: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
