#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readlink, rename, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const binarySource = join(packageRoot, "src", "operon-local.cjs");
const legacyBinarySources = [join(packageRoot, "scripts", "operon-local.mjs")];
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
const binaryLinkAction = await linkExact(binarySource, binaryTarget, "file", {
  migrateFrom: legacyBinarySources,
});
for (const [, target] of skillTargets) await linkExact(skillSource, target, "dir");

if (binaryLinkAction === "migrated") {
  console.log(`operon binary link migrated from the legacy same-checkout launcher: ${binaryTarget}`);
}
console.log(`operon binary linked: ${binaryTarget} -> ${binarySource}`);
for (const [provider, target] of skillTargets) {
  console.log(`Operon skill linked (${provider}): ${target} -> ${skillSource}`);
}
console.log("This local link is source-backed: the next invocation picks up source changes without update or rebuild.");
if (!process.env.PATH?.split(":").includes(binDir)) {
  console.log(`Add ${binDir} to PATH, then run: operon --version`);
}

async function linkExact(source, target, kind, options = {}) {
  await mkdir(dirname(target), { recursive: true });

  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await symlink(source, target, kind);
    return "created";
  }

  if (!info.isSymbolicLink()) throw refusal(target);

  const rawLink = await readlink(target);
  const resolvedLink = resolve(dirname(target), rawLink);
  if (resolvedLink === resolve(source)) return "current";

  const ownedLegacySource = options.migrateFrom?.some((candidate) => resolvedLink === resolve(candidate));
  if (!ownedLegacySource) throw refusal(target);

  await migrateOwnedSymlink(source, target, kind, { info, rawLink });
  return "migrated";
}

async function migrateOwnedSymlink(source, target, kind, observed) {
  const temporaryTarget = join(
    dirname(target),
    `.${basename(target)}.operon-link-${process.pid}-${randomUUID()}`,
  );

  try {
    await symlink(source, temporaryTarget, kind);

    // Recheck the exact directory entry immediately before replacement. This
    // prevents a concurrently changed or foreign path from inheriting the
    // one-time migration permission granted to the observed legacy link.
    let currentInfo;
    let currentLink;
    try {
      currentInfo = await lstat(target);
      currentLink = currentInfo.isSymbolicLink() ? await readlink(target) : undefined;
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "EINVAL") throw refusal(target);
      throw error;
    }
    if (
      !currentInfo.isSymbolicLink() ||
      currentInfo.dev !== observed.info.dev ||
      currentInfo.ino !== observed.info.ino ||
      currentLink !== observed.rawLink
    ) {
      throw refusal(target);
    }

    await rename(temporaryTarget, target);
  } finally {
    await rm(temporaryTarget, { force: true });
  }
}

function refusal(target) {
  return new Error(`refusing to replace existing path: ${target}`);
}
