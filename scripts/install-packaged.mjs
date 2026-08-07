#!/usr/bin/env node

// Install THIS checkout the way a real user installs Cormidia, then prove the
// result no longer reads the checkout.
//
// `pnpm link:local` is the dev loop: symlinks into src/, run through tsx, so
// the installed command is whatever the working tree currently says. That is
// the right default for development and the wrong thing to test a release
// against — it exercises TypeScript sources that `npm install -g cormidia`
// never ships and never runs.
//
// This script takes the packaged path end to end: build -> npm pack ->
// global install of the tarball -> link both skills from the INSTALLED root.
// The verification step is the point: it resolves each binary through PATH and
// fails if either one still resolves inside this checkout.
//
// Dev-only; deliberately NOT in package.json `files`. The shipped counterpart
// a user runs after `npm install -g cormidia` is scripts/link-skills.mjs.
//
//   node scripts/install-packaged.mjs [--dry-run] [--replace-source-links]

import { execFile as execFileCallback } from "node:child_process";
import { lstat, mkdtemp, readlink, rm, unlink } from "node:fs/promises";
import { delimiter, join, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const BINARIES = ["cormidia", "cormidia-job"];

const flags = new Set(process.argv.slice(2).filter((arg) => arg !== "--"));
const dryRun = flags.has("--dry-run");
const replaceSourceLinks = flags.has("--replace-source-links");
for (const flag of flags) {
  if (flag !== "--dry-run" && flag !== "--replace-source-links") {
    fail(`unknown flag: ${flag} (accepts --dry-run, --replace-source-links)`);
  }
}

const globalBin = join((await run("npm", ["prefix", "-g"])).trim(), "bin");
const globalRoot = (await run("npm", ["root", "-g"])).trim();
const installedRoot = join(globalRoot, "cormidia");

console.log(`checkout:      ${packageRoot}`);
console.log(`npm global bin: ${globalBin}`);
console.log(`install target: ${installedRoot}`);

// ---------------------------------------------------------------------------
// Preflight: a source-backed link earlier in PATH silently defeats the whole
// exercise — the packaged binaries install fine and never get invoked. Fail
// closed rather than reporting a pass that measured the checkout.
// ---------------------------------------------------------------------------
const pathDirs = (process.env.PATH ?? "")
  .split(delimiter)
  .filter(Boolean)
  .map((dir) => resolve(dir));
const shadowing = [];
for (const name of BINARIES) {
  for (const dir of pathDirs) {
    const candidate = join(dir, name);
    if (!existsSync(candidate)) continue;
    if (dir === resolve(globalBin)) break; // npm's own entry wins — nothing shadows it
    shadowing.push({ name, path: candidate, ownedByCheckout: await pointsIntoCheckout(candidate) });
    break;
  }
}

if (shadowing.length > 0) {
  console.log("");
  for (const entry of shadowing) {
    const owner = entry.ownedByCheckout ? "this checkout" : "something else";
    console.log(`shadowing ${entry.name}: ${entry.path} (owned by ${owner})`);
  }
  const foreign = shadowing.filter((entry) => !entry.ownedByCheckout);
  if (foreign.length > 0) {
    fail(
      `refusing to replace paths this checkout does not own: ${foreign.map((entry) => entry.path).join(", ")} — ` +
        "remove them yourself, or put the npm global bin earlier in PATH",
    );
  }
  if (!replaceSourceLinks) {
    fail(
      `${shadowing.map((entry) => entry.path).join(", ")} would shadow the packaged install — ` +
        "re-run with --replace-source-links to remove these source-backed links (pnpm link:local restores them)",
    );
  }
}

if (dryRun) {
  console.log("");
  console.log("--dry-run: would build, pack, install the tarball globally, link both skills, and verify.");
  if (shadowing.length > 0) {
    console.log(`--dry-run: would remove ${shadowing.length} source-backed link(s) first.`);
  }
  process.exit(0);
}

for (const entry of shadowing) {
  await unlink(entry.path);
  console.log(`removed source-backed link: ${entry.path}`);
}

// ---------------------------------------------------------------------------
// Build, pack, install.
// ---------------------------------------------------------------------------
const staging = await mkdtemp(join(tmpdir(), "cormidia-packaged-install-"));
try {
  console.log("\nbuilding…");
  await run("pnpm", ["build"], { cwd: packageRoot });

  // --ignore-scripts: `prepack` would re-run the build just completed above,
  // and `prepare` writes to stdout, which corrupts --json output.
  console.log("packing…");
  const packed = await run("npm", ["pack", "--pack-destination", staging, "--json", "--ignore-scripts"], {
    cwd: packageRoot,
  });
  const tarball = join(staging, parsePackJson(packed)[0].filename);

  console.log(`installing ${tarball} globally…`);
  await run("npm", ["install", "-g", "--no-audit", "--no-fund", tarball]);

  console.log("linking skills from the installed package root…");
  await run(process.execPath, [join(installedRoot, "scripts", "link-skills.mjs")]);
} finally {
  await rm(staging, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Verify independence. This is the assertion the whole script exists for.
// ---------------------------------------------------------------------------
console.log("");
for (const name of BINARIES) {
  const resolved = (
    await run("node", [
      "-e",
      `process.stdout.write(require("node:fs").realpathSync(process.argv[1]))`,
      join(globalBin, name),
    ])
  ).trim();
  if (resolved.startsWith(resolve(packageRoot) + sep)) {
    fail(`${name} still resolves into the checkout: ${resolved}`);
  }
  console.log(`${name} -> ${resolved}`);
}

const version = (await run(join(globalBin, "cormidia"), ["--version"])).trim();
await run(join(globalBin, "cormidia-job"), ["--help"]);
console.log(`\ncormidia@${version} installed independently of ${packageRoot}`);
console.log(
  "Both binaries and both skills now come from the packaged install. `pnpm link:local` returns to the dev loop.",
);

/** `npm pack --json` prints its array after any lifecycle-script chatter that
 *  slipped onto stdout. Parse from the first `[` so a noisy hook cannot turn a
 *  successful pack into a JSON syntax error. */
function parsePackJson(stdout) {
  const start = stdout.indexOf("[");
  if (start === -1) throw new Error(`npm pack --json produced no JSON array:\n${stdout}`);
  return JSON.parse(stdout.slice(start));
}

async function pointsIntoCheckout(path) {
  try {
    const info = await lstat(path);
    if (!info.isSymbolicLink()) return false;
    const target = resolve(join(path, ".."), await readlink(path));
    return target === resolve(packageRoot) || target.startsWith(resolve(packageRoot) + sep);
  } catch {
    return false;
  }
}

async function run(command, args, options = {}) {
  const { stdout } = await execFile(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  return stdout;
}

function fail(message) {
  console.error(`cormidia install-packaged: ${message}`);
  process.exit(1);
}
