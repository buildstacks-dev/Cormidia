#!/usr/bin/env node

import { chmod, lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const binarySource = join(packageRoot, "scripts", "operon-local.mjs");
const binDir = resolve(process.env.OPERON_BIN_DIR ?? join(homedir(), ".local", "bin"));
const binaryTarget = join(binDir, "operon");
const codexHome = resolve(process.env.CODEX_HOME ?? join(homedir(), ".codex"));
const skillSource = join(packageRoot, "agent-skills", "operon");
const skillTarget = join(codexHome, "skills", "operon");

await chmod(binarySource, 0o755);
await linkExact(binarySource, binaryTarget, "file");
await linkExact(skillSource, skillTarget, "dir");

console.log(`operon binary linked: ${binaryTarget} -> ${binarySource}`);
console.log(`Operon skill linked:  ${skillTarget} -> ${skillSource}`);
console.log("This local link is source-backed: the next invocation picks up source changes without update or rebuild.");
if (!process.env.PATH?.split(":").includes(binDir)) {
  console.log(`Add ${binDir} to PATH, then run: operon --version`);
}

async function linkExact(source, target, kind) {
  await mkdir(dirname(target), { recursive: true });
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() && resolve(dirname(target), await readlink(target)) === resolve(source)) return;
    throw new Error(`refusing to replace existing path: ${target}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await rm(target, { force: true, recursive: kind === "dir" });
  await symlink(source, target, kind);
}
