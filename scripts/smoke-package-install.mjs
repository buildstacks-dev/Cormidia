#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const raw = args[0];
  if (args.length !== 1 || raw === undefined || !isAbsolute(raw))
    throw new Error("package install smoke requires one absolute tarball path");
  const tarball = resolve(raw);
  const root = await mkdtemp(join(tmpdir(), "cormidia-package-smoke-"));
  try {
    await writeFile(join(root, "package.json"), `${JSON.stringify({ private: true }, null, 2)}\n`, "utf8");
    await execFile("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const installedRoot = join(root, "node_modules", "cormidia");
    const packageJson = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
    await access(join(installedRoot, "dist", "runtime", "testing", "fakeRuntime.js"));
    try {
      await access(join(installedRoot, "dist", "org", "scheduler", "virtual-soak.js"));
      throw new Error("packed cormidia still contains the removed virtual scheduler soak module");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }

    // Every declared `bin` entry must be installed AND runnable. Asserting only
    // the first one let #359 ship a second binary whose packaged launcher was
    // never executed by any check.
    for (const binary of Object.keys(packageJson.bin ?? {})) {
      await access(join(root, "node_modules", ".bin", binary));
    }

    const version = await execFile(join(root, "node_modules", ".bin", "cormidia"), ["--version"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    if (version.stdout.trim() !== packageJson.version)
      throw new Error("installed cormidia --version does not match packed package.json");

    // Drives the packaged src/cormidia-job.cjs -> dist/jobs/main.js launcher,
    // the path a source-backed dev install never touches.
    const job = await execFile(join(root, "node_modules", ".bin", "cormidia-job"), ["--help"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    if (!job.stdout.includes("cormidia-job"))
      throw new Error("installed cormidia-job --help did not render its own usage");

    // The skills ship in the tarball, and scripts/link-skills.mjs is the only
    // path an npm user has to install them. All three must be present or a
    // published install cannot produce a working agent setup.
    for (const skill of ["cormidia", "cormidia-job"]) {
      await access(join(installedRoot, "agent-skills", skill, "SKILL.md"));
    }
    await access(join(installedRoot, "scripts", "link-skills.mjs"));
    await access(join(installedRoot, "scripts", "lib", "link-artifacts.mjs"));

    process.stdout.write(
      `installed package smoke passed: cormidia@${packageJson.version} ` +
        `(bins: ${Object.keys(packageJson.bin ?? {}).join(", ")})\n`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
