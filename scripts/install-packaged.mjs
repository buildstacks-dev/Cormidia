#!/usr/bin/env node

// Build or accept one exact tarball, exercise npm's real global-install layout
// in a disposable same-filesystem prefix, then promote package, binaries, and
// skills as one ownership-checked transaction. The operator's actual global
// install is never passed to npm's mutating reifier: only artifacts proven to
// belong to Cormidia are renamed aside and replaced, with rollback on failure.

import { execFile as execFileCallback } from "node:child_process";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { packagedInstallProof, tarballIdentity } from "./lib/install-proof.mjs";
import { formatInstallConflicts, inspectInstall, installPlanFingerprint } from "./lib/install-ownership.mjs";
import { transactionalReplace } from "./lib/install-transaction.mjs";
import { PACKAGED_BINARIES, packagedSkillTargets } from "./lib/link-artifacts.mjs";

const execFile = promisify(execFileCallback);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));

async function main() {
  const options = parseArgs(process.argv.slice(2).filter((arg) => arg !== "--"));
  const globalPrefix = resolve((await run("npm", ["prefix", "-g"])).trim());
  const globalBin = join(globalPrefix, "bin");
  const installedRoot = join((await run("npm", ["root", "-g"])).trim(), "cormidia");
  const pathDirs = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((path) => resolve(path));

  console.log(`checkout:       ${packageRoot}`);
  console.log(`npm global bin: ${globalBin}`);
  console.log(`install target: ${installedRoot}`);

  const initial = await inspectInstall({ globalBin, installedRoot, packageRoot, pathDirs });
  if (initial.package.state === "packaged") {
    console.log(`ownership:      cormidia@${initial.package.version} (${initial.package.evidence})`);
  } else if (initial.package.state === "absent") {
    console.log("ownership:      no package at the target prefix");
  }
  if (initial.conflicts.length > 0) {
    throw new Error(
      `foreign collision(s) found before mutation (${initial.conflicts.length}):\n\n` +
        `${await formatInstallConflicts(initial.conflicts)}\n\n` +
        "No install target was changed.",
    );
  }
  if (initial.sourceLinks.length > 0 && !options.replaceSourceLinks) {
    const evidence = initial.sourceLinks
      .map((artifact) => `  path: ${artifact.target}\n    evidence: ${artifact.evidence}`)
      .join("\n");
    throw new Error(
      `${initial.sourceLinks.length} source-backed artifact(s) belong to this checkout:\n${evidence}\n` +
        "Re-run with --replace-source-links to replace the complete source generation transactionally. " +
        "pnpm link:local restores it.",
    );
  }

  if (options.dryRun) {
    console.log("");
    console.log("--dry-run: ownership preflight passed; no install target was changed.");
    console.log(
      `--dry-run: would stage npm's global layout, replace ${initial.targets.length} declared target(s), ` +
        `and remove ${initial.sourceLinks.length} source-backed link(s).`,
    );
    return;
  }

  const workingRoot = await mkdtemp(join(tmpdir(), "cormidia-packaged-install-"));
  let stagePrefix;
  try {
    const tarball = options.tarball ?? (await buildAndPack(workingRoot));
    const identity = await tarballIdentity(tarball);
    await mkdir(globalPrefix, { recursive: true });
    stagePrefix = await mkdtemp(join(globalPrefix, ".cormidia-install-stage-"));

    console.log(`staging npm global install from ${tarball}…`);
    await run("npm", [
      "install",
      "-g",
      "--prefix",
      stagePrefix,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
    ]);
    const stageBin = join(stagePrefix, "bin");
    const stageRoot = join(stagePrefix, "lib", "node_modules", "cormidia");
    const stageEnv = {
      CODEX_HOME: join(stagePrefix, "proof", "codex"),
      CLAUDE_CONFIG_DIR: join(stagePrefix, "proof", "claude"),
      PI_CODING_AGENT_DIR: join(stagePrefix, "proof", "pi"),
    };
    const staged = await inspectInstall({
      globalBin: stageBin,
      installedRoot: stageRoot,
      packageRoot,
      pathDirs: [],
      env: stageEnv,
    });
    const targetVersion = staged.package.version;
    if (staged.package.state !== "packaged" || targetVersion === undefined) {
      throw new Error(`staged tarball does not contain an owned Cormidia package: ${staged.package.evidence}`);
    }
    for (const binary of PACKAGED_BINARIES) {
      const artifact = staged.artifacts.find(
        (candidate) => candidate.kind === "binary" && candidate.target === join(stageBin, binary.name),
      );
      if (artifact?.state !== "packaged") {
        throw new Error(`staged npm global install did not own ${join(stageBin, binary.name)}: ${artifact?.evidence}`);
      }
    }
    const stagedVersion = (await run(join(stageBin, "cormidia"), ["--version"])).trim();
    await run(join(stageBin, "cormidia-job"), ["--help"]);
    if (stagedVersion !== targetVersion) {
      throw new Error(`staged binary version ${stagedVersion} does not match package ${targetVersion}`);
    }

    const current = await inspectInstall({ globalBin, installedRoot, packageRoot, pathDirs });
    if (installPlanFingerprint(current) !== installPlanFingerprint(initial)) {
      throw new Error("install targets changed while the tarball was staged; refusing before target mutation");
    }
    if (current.package.state === "packaged" && current.package.version === targetVersion) {
      console.log(`same-version reinstall: cormidia@${targetVersion}`);
    } else if (current.package.state === "packaged") {
      console.log(`packaged upgrade: cormidia@${current.package.version} -> cormidia@${targetVersion}`);
    } else if (current.sourceLinks.length > 0) {
      console.log(`source-link replacement: checkout -> cormidia@${targetVersion}`);
    } else {
      console.log(`clean packaged install: cormidia@${targetVersion}`);
    }

    await transactionalReplace(current.targetArtifacts, async ({ promotePath, promoteSymlink }) => {
      await promotePath(stageRoot, installedRoot);
      for (const binary of PACKAGED_BINARIES) {
        await promotePath(join(stageBin, binary.name), join(globalBin, binary.name));
      }
      for (const skill of packagedSkillTargets(installedRoot)) {
        await promoteSymlink(skill.source, skill.target, "dir");
      }

      const installed = await inspectInstall({ globalBin, installedRoot, packageRoot, pathDirs });
      const incomplete = installed.artifacts.filter(
        (artifact) =>
          artifact.kind !== "shadow" &&
          artifact.state !== "packaged" &&
          !(artifact.kind === "package" && artifact.state === "packaged"),
      );
      if (installed.package.version !== targetVersion || installed.conflicts.length > 0 || incomplete.length > 0) {
        throw new Error(
          `installed generation failed ownership verification: ${[...installed.conflicts, ...incomplete]
            .map((artifact) => `${artifact.target} (${artifact.state}: ${artifact.evidence})`)
            .join(", ")}`,
        );
      }
      const installedVersion = (await run(join(globalBin, "cormidia"), ["--version"])).trim();
      await run(join(globalBin, "cormidia-job"), ["--help"]);
      if (installedVersion !== targetVersion) {
        throw new Error(`installed binary version ${installedVersion} does not match package ${targetVersion}`);
      }
    });

    console.log(`all ${packagedSkillTargets(installedRoot).length} skill links resolve into ${installedRoot}`);
    console.log(`cormidia@${targetVersion} installed independently of ${packageRoot}`);
    console.log(
      JSON.stringify(
        packagedInstallProof({
          argv: process.argv.slice(2).filter((arg) => arg !== "--"),
          installedVersion: targetVersion,
          tarball: identity,
        }),
      ),
    );
  } finally {
    await rm(workingRoot, { recursive: true, force: true });
    if (stagePrefix !== undefined) await rm(stagePrefix, { recursive: true, force: true });
  }
}

function parseArgs(args) {
  const options = { dryRun: false, replaceSourceLinks: false, tarball: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--replace-source-links") options.replaceSourceLinks = true;
    else if (flag === "--tarball") {
      const value = args[index + 1];
      if (value === undefined || !isAbsolute(value)) throw new Error("--tarball requires one absolute path");
      options.tarball = resolve(value);
      index += 1;
    } else throw new Error(`unknown flag: ${flag} (accepts --dry-run, --replace-source-links, --tarball <absolute>)`);
  }
  return options;
}

async function buildAndPack(destination) {
  const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const packageManager = pkg.packageManager;
  if (typeof packageManager !== "string" || !packageManager.startsWith("pnpm@")) {
    throw new Error("package.json packageManager must pin pnpm exactly");
  }
  console.log(`building with ${packageManager}…`);
  await run("npm", ["exec", "--yes", `--package=${packageManager}`, "--", "pnpm", "build"], { cwd: packageRoot });
  console.log("packing…");
  const packed = await run("npm", ["pack", "--pack-destination", destination, "--json", "--ignore-scripts"], {
    cwd: packageRoot,
  });
  const start = packed.indexOf("[");
  if (start === -1) throw new Error(`npm pack --json produced no JSON array:\n${packed}`);
  const filename = JSON.parse(packed.slice(start))[0]?.filename;
  if (filename === undefined) throw new Error("npm pack --json produced no tarball filename");
  return join(destination, filename);
}

async function run(command, args, options = {}) {
  const { stdout } = await execFile(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  return stdout;
}

main().catch((error) => {
  console.error(`cormidia install-packaged: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
