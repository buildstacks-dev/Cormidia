#!/usr/bin/env node

import { chmod, lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const binarySource = join(packageRoot, "src", "operon-local.cjs");
const binDir = resolve(process.env.OPERON_BIN_DIR ?? join(homedir(), ".local", "bin"));
const binaryTarget = join(binDir, "operon");
const codexHome = resolve(process.env.CODEX_HOME ?? join(homedir(), ".codex"));
const claudeHome = resolve(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"));
const piHome = resolve(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"));
const skillSource = join(packageRoot, "agent-skills", "operon");
const skillTargets = [
  ["Codex", join(codexHome, "skills", "operon")],
  ["Claude", join(claudeHome, "skills", "operon")],
  ["pi", join(piHome, "skills", "operon")],
];

await chmod(binarySource, 0o755);
await linkExact(binarySource, binaryTarget, "file");
for (const [, target] of skillTargets) await linkExact(skillSource, target, "dir");

console.log(`operon binary linked: ${binaryTarget} -> ${binarySource}`);
for (const [provider, target] of skillTargets) {
  console.log(`Operon skill linked (${provider}): ${target} -> ${skillSource}`);
}
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
