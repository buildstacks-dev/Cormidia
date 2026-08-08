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
// EVERY interfering path is classified BEFORE anything is mutated. An earlier
// version checked binaries up front but left skills to the shipped linker,
// which refuses what it does not own — so a checkout-owned skill link aborted
// the run *after* the binary link had been removed and the global install had
// landed, stranding the operator half-migrated. Detection is complete first;
// mutation happens only once the whole plan is known to be executable.
//
// Dev-only; deliberately NOT in package.json `files`. The shipped counterpart
// a user runs after `npm install -g cormidia` is scripts/link-skills.mjs.
//
//   node scripts/install-packaged.mjs [--dry-run] [--replace-source-links]

import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { delimiter, join, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PACKAGED_BINARIES, classifyInstallTarget, packagedSkillTargets } from "./lib/link-artifacts.mjs";

const execFile = promisify(execFileCallback);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));

const flags = new Set(process.argv.slice(2).filter((arg) => arg !== "--"));
const dryRun = flags.has("--dry-run");
const replaceSourceLinks = flags.has("--replace-source-links");
for (const flag of flags) {
  if (flag !== "--dry-run" && flag !== "--replace-source-links") {
    fail(`unknown flag: ${flag} (accepts --dry-run, --replace-source-links)`);
  }
}

const globalBin = resolve(join((await run("npm", ["prefix", "-g"])).trim(), "bin"));
const installedRoot = join((await run("npm", ["root", "-g"])).trim(), "cormidia");

console.log(`checkout:       ${packageRoot}`);
console.log(`npm global bin: ${globalBin}`);
console.log(`install target: ${installedRoot}`);

// ---------------------------------------------------------------------------
// Plan. Nothing below this block mutates anything.
// ---------------------------------------------------------------------------

/**
 * What this script may replace, by kind. The asymmetry is deliberate.
 *
 * A skill target is a POINTER this package wrote; re-pointing it at the current
 * install is repair, and a stale one is the normal consequence of changing node
 * version (the npm prefix moves and every link strands).
 *
 * A binary under another prefix's global bin is a REAL INSTALL belonging to
 * another node. Deleting it would silently break whichever node the operator
 * actually uses, so it is reported, never removed.
 */
const REPLACEABLE = { binary: new Set(["checkout"]), skill: new Set(["checkout", "prior-install"]) };
const OWNER = {
  checkout: "owned by this checkout",
  "prior-install": "left by a Cormidia install under a different npm prefix",
  foreign: "owned by something else",
};

const interfering = [];

// Binaries: a link earlier in PATH silently defeats the whole exercise — the
// packaged binaries install fine and are never the ones invoked.
const pathDirs = (process.env.PATH ?? "")
  .split(delimiter)
  .filter(Boolean)
  .map((dir) => resolve(dir));
for (const binary of PACKAGED_BINARIES) {
  for (const dir of pathDirs) {
    const candidate = join(dir, binary.name);
    if (!existsSync(candidate)) continue;
    if (dir === globalBin) break; // npm's own entry wins — nothing shadows it
    interfering.push({
      kind: "binary",
      label: binary.name,
      path: candidate,
      // A shadowing binary is never "current": whatever it points at, it is
      // not the npm-global entry, so it must go.
      state: await classifyInstallTarget(candidate, { packageRoot }),
    });
    break;
  }
}

// Skills. Only a CHECKOUT link blocks: it is the operator's live dev loop, and
// dismantling that is what --replace-source-links opts into.
//
// A `prior-install` link is a stale pointer from an install that is gone —
// `link-skills.mjs` adopts and re-points those on its own, so demanding a flag
// here would make this script stricter than the shipped path for no reason.
// Report it, do not block on it.
const adopting = [];
for (const skill of packagedSkillTargets(installedRoot)) {
  const state = await classifyInstallTarget(skill.target, {
    intendedSource: skill.source,
    packageRoot,
  });
  if (state === "absent" || state === "current") continue;
  if (state === "prior-install") {
    adopting.push({ label: `$${skill.skill} (${skill.provider})`, path: skill.target });
    continue;
  }
  interfering.push({
    kind: "skill",
    label: `$${skill.skill} (${skill.provider})`,
    path: skill.target,
    state,
  });
}

if (adopting.length > 0) {
  console.log("");
  for (const entry of adopting) {
    console.log(`re-pointing: ${entry.label} at ${entry.path} (stale link from an install that is gone)`);
  }
}

if (interfering.length > 0) {
  console.log("");
  for (const entry of interfering) {
    console.log(`interferes: ${entry.label} at ${entry.path} (${OWNER[entry.state] ?? entry.state})`);
  }

  // A Cormidia install under a different npm prefix is the single most
  // confusing failure here: everything looks installed, but a `node`/`nvm`
  // switch means this run resolves a different prefix than the one holding the
  // binaries on PATH. Name both prefixes instead of calling it "foreign".
  const otherPrefix = interfering.filter((entry) => entry.kind === "binary" && entry.state === "prior-install");
  if (otherPrefix.length > 0) {
    fail(
      `a Cormidia install under a different npm prefix owns ${otherPrefix.map((entry) => entry.path).join(", ")}, ` +
        `but this run resolves ${globalBin}.\n` +
        `You are running node ${process.version} from ${process.execPath}.\n` +
        "Re-run this script with the node whose prefix already holds Cormidia, " +
        "or uninstall the other copy first (npm uninstall -g cormidia) — this script will not delete another node's install.",
    );
  }

  const foreign = interfering.filter((entry) => !REPLACEABLE[entry.kind].has(entry.state));
  if (foreign.length > 0) {
    fail(
      `refusing to replace paths this checkout does not own:\n  ${foreign.map((entry) => entry.path).join("\n  ")}\n` +
        "Inspect each one and remove it yourself if it is stale — a link from another checkout, " +
        "or from a previous install under a different node prefix.",
    );
  }
  if (!replaceSourceLinks) {
    fail(
      `${interfering.length} link(s) into this checkout would block the packaged install — ` +
        "re-run with --replace-source-links to remove them (pnpm link:local restores them).",
    );
  }
}

if (dryRun) {
  console.log("");
  console.log("--dry-run: would build, pack, install the tarball globally, link both skills, and verify.");
  console.log(
    `--dry-run: would remove ${interfering.length} checkout link(s) and re-point ${adopting.length} stale link(s).`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Execute. The plan above is now known to be completable.
// ---------------------------------------------------------------------------
for (const entry of interfering) {
  await unlink(entry.path);
  console.log(`removed source-backed link: ${entry.path}`);
}

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
  const linked = await run(process.execPath, [join(installedRoot, "scripts", "link-skills.mjs")]);
  process.stdout.write(linked);
} finally {
  await rm(staging, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Verify independence. This is the assertion the whole script exists for.
// ---------------------------------------------------------------------------
console.log("");
for (const binary of PACKAGED_BINARIES) {
  const resolved = (
    await run("node", [
      "-e",
      `process.stdout.write(require("node:fs").realpathSync(process.argv[1]))`,
      join(globalBin, binary.name),
    ])
  ).trim();
  if (resolved.startsWith(resolve(packageRoot) + sep)) {
    fail(`${binary.name} still resolves into the checkout: ${resolved}`);
  }
  console.log(`${binary.name} -> ${resolved}`);
}

for (const skill of packagedSkillTargets(installedRoot)) {
  const state = await classifyInstallTarget(skill.target, { intendedSource: skill.source, packageRoot });
  if (state !== "current") fail(`${skill.target} did not end up pointing at the installed package (${state})`);
}
console.log(`all ${packagedSkillTargets(installedRoot).length} skill links resolve into ${installedRoot}`);

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
