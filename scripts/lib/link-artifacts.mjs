#!/usr/bin/env node

// Shared link/ownership guard for link:local-class operations
// (contracts/B-14-human-checkout.md §2): such an operation upgrades only
// artifacts owned by the same checkout and refuses foreign-owned files and
// links untouched.
//
// Two callers share this module, and they must share it: both write into the
// operator's real ~/.local/bin and provider skill homes, so a second private
// copy of the guard is a second place for the refusal to be forgotten.
//   - scripts/link-local.mjs      — source-backed dev install (both binaries + both skills)
//   - scripts/install-packaged.mjs — packaged install (skills only; npm owns the bins)

import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { lstat, mkdir, readlink, rename, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";

/**
 * Every `bin` entry the package declares, with both of its launchers.
 *
 * Each binary has TWO entry points and they are not interchangeable:
 *   packagedLauncher — shipped; resolves into `dist/`. What an npm install runs.
 *   localLauncher    — dev; resolves through `localRunner` into tsx + `src/`.
 *                      What `pnpm link:local` puts on PATH.
 *
 * This table is the single source of truth for "what an install must expose".
 * tests/unit/cf-reg-359/ pins it against package.json `bin` and `files`, so a
 * third binary cannot land with an install path that only covers two.
 */
export const PACKAGED_BINARIES = [
  {
    name: "cormidia",
    packagedLauncher: "src/cormidia.cjs",
    localLauncher: "src/cormidia-local.cjs",
    localRunner: "scripts/cormidia-local.mjs",
    // The pre-#359 link pointed straight at the runner; that shape is ours to upgrade.
    migrateFrom: ["scripts/cormidia-local.mjs"],
  },
  {
    name: "cormidia-job",
    packagedLauncher: "src/cormidia-job.cjs",
    localLauncher: "src/cormidia-job-local.cjs",
    localRunner: "scripts/cormidia-job-local.mjs",
    migrateFrom: [],
  },
];

/**
 * Every skill directory under `agent-skills/`. Both are operator-facing: they
 * teach a coding agent to drive the installed binaries. They are NOT org
 * role skills — nothing in roles.yaml or pipelines.yaml consumes a skill.
 *
 * `cormidia-job`'s description carries deliberate negative scope routing
 * product work back to `cormidia` (docs/jobs/design.md §"The packaged skill"),
 * so installing one without the other removes that routing.
 */
export const PACKAGED_SKILLS = ["cormidia", "cormidia-job"];

/** Resolve the three provider skill homes, honouring each provider's own
 *  override env var and falling back to its default home. */
export function resolveProviderSkillHomes(env = process.env) {
  return [
    ["Codex", resolve(env.CODEX_HOME ?? join(homedir(), ".codex"))],
    ["Claude", resolve(env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"))],
    ["pi", resolve(env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"))],
  ];
}

/**
 * Link every packaged skill from `packageRoot` into every provider skill home.
 *
 * Identical for a source checkout and an installed package: skills are plain
 * directories in both, and the destination — the provider's USER-GLOBAL skill
 * home — does not depend on which one the caller is. Returns one row per link.
 */
export async function linkPackagedSkills(packageRoot, env = process.env) {
  const linked = [];
  for (const skill of PACKAGED_SKILLS) {
    const source = join(packageRoot, "agent-skills", skill);
    for (const [provider, home] of resolveProviderSkillHomes(env)) {
      const target = join(home, "skills", skill);
      const action = await linkExact(source, target, "dir");
      linked.push({ skill, provider, source, target, action });
    }
  }
  return linked;
}

/**
 * Link `source` to `target`, refusing anything this checkout does not own.
 *
 * Returns "created" | "current" | "migrated". Throws the B-14 refusal for a
 * regular file, a directory, or a symlink pointing anywhere other than
 * `source` or an explicitly listed `options.migrateFrom` legacy source.
 */
export async function linkExact(source, target, kind, options = {}) {
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
  const temporaryTarget = join(dirname(target), `.${basename(target)}.cormidia-link-${process.pid}-${randomUUID()}`);

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

export function refusal(target) {
  return new Error(`refusing to replace existing path: ${target}`);
}
