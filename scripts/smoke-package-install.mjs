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
    const result = await execFile(join(root, "node_modules", ".bin", "cormidia"), ["--version"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.stdout.trim() !== packageJson.version)
      throw new Error("installed cormidia --version does not match packed package.json");
    process.stdout.write(`installed package smoke passed: cormidia@${packageJson.version}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
