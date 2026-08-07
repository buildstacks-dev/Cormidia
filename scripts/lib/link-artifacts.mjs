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
import { basename, dirname, join, resolve, sep } from "node:path";
import { lstat, mkdir, readlink, rename, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";

/**
 * Is `resolved` a skill directory belonging to some Cormidia npm install?
 *
 * A link at `~/.pi/agent/skills/cormidia` pointing into
 * `<prefix>/lib/node_modules/cormidia/agent-skills/cormidia` is provably an
 * artifact this package wrote, not an operator's own file — so replacing it is
 * within the B-14 contract rather than an exception to it. This is the ordinary
 * upgrade path: changing node version changes the npm prefix, which strands
 * every skill link at the old one. Refusing those would leave a real user with
 * no way forward but manual `rm`.
 *
 * The basename check keeps the permission narrow: only a link to the SAME
 * skill name is adoptable.
 */
function isInsideCormidiaInstall(resolved) {
  return resolved.includes(`${sep}node_modules${sep}cormidia${sep}`);
}

function isPriorCormidiaSkillInstall(resolved, source) {
  return (
    resolved.includes(`${sep}node_modules${sep}cormidia${sep}agent-skills${sep}`) &&
    basename(resolved) === basename(source)
  );
}

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
  const refused = [];

  for (const skill of PACKAGED_SKILLS) {
    const source = join(packageRoot, "agent-skills", skill);

    // Never create a dangling link. A truncated or mis-packed install would
    // otherwise leave every provider pointing at nothing, which presents to
    // the agent as a skill that exists and cannot load.
    const sourceUsable = await isDirectory(source);

    for (const [provider, home] of resolveProviderSkillHomes(env)) {
      const target = join(home, "skills", skill);
      if (!sourceUsable) {
        refused.push({ skill, provider, source, target, reason: `packaged skill directory is missing: ${source}` });
        continue;
      }
      try {
        // adoptPriorInstall: an upgrade, or a node-version change that moved
        // the npm prefix, leaves this package's own links pointing at the old
        // root.
        const action = await linkExact(source, target, "dir", { adoptPriorInstall: true });
        linked.push({ skill, provider, source, target, action });
      } catch (error) {
        // One unusable target must not cost the other five. A machine with a
        // human-owned directory at one provider path is ordinary, and the
        // other providers are still installable — all-or-nothing turns a
        // partial obstacle into a total install failure.
        refused.push({ skill, provider, source, target, reason: describeLinkFailure(error, target) });
      }
    }
  }

  return { linked, refused };
}

async function isDirectory(path) {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Turn the raw failure into something an operator can act on. The common ones
 *  are not bugs: a directory they created, or a home they cannot write. */
function describeLinkFailure(error, target) {
  if (error?.code === "EACCES" || error?.code === "EPERM") {
    return `permission denied writing ${target} — check ownership of this path, then re-run`;
  }
  if (error?.code === "ENOTDIR") {
    return `a parent of ${target} exists as a file, so the skills directory cannot be created`;
  }
  return error instanceof Error ? error.message : String(error);
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

  const ownedLegacySource =
    options.migrateFrom?.some((candidate) => resolvedLink === resolve(candidate)) ||
    (options.adoptPriorInstall === true && isPriorCormidiaSkillInstall(resolvedLink, source));
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
  return new Error(
    `refusing to replace existing path: ${target} — ` +
      "this package does not own it. Inspect it, then remove it yourself if it is stale " +
      "(a link left by a source checkout or a previous install under a different node prefix).",
  );
}

/**
 * Classify what currently sits at an install target, without touching it.
 *
 * `linkExact` refuses everything it does not own, which is correct for the
 * SHIPPED linker: a real user's paths are never silently clobbered. But the
 * dev installer can prove a link belongs to the checkout it is packaging, and
 * must be able to replace exactly those. Splitting the question from the
 * action is what lets one caller refuse and the other adopt, off one rule.
 *
 * Returns:
 *   "absent"        — nothing there
 *   "current"       — already the intended link
 *   "checkout"      — a symlink into `packageRoot` (link:local's work)
 *   "prior-install" — a symlink into another Cormidia npm install (stale prefix)
 *   "foreign"       — anything else, including a real file or directory
 *
 * The first four are this package's own artifacts and are replaceable; only
 * "foreign" is refused.
 */
export async function classifyInstallTarget(target, { intendedSource, packageRoot }) {
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return "absent";
    throw error;
  }

  if (!info.isSymbolicLink()) return "foreign";

  const resolved = resolve(dirname(target), await readlink(target));
  if (intendedSource !== undefined && resolved === resolve(intendedSource)) return "current";

  const root = resolve(packageRoot);
  if (resolved === root || resolved.startsWith(`${root}${sep}`)) return "checkout";
  // With an intendedSource this is a skill target, and adoption is narrowed to
  // the same skill name. Without one it is a binary, where any path inside a
  // Cormidia install identifies the artifact.
  const prior =
    intendedSource === undefined
      ? isInsideCormidiaInstall(resolved)
      : isPriorCormidiaSkillInstall(resolved, intendedSource);
  return prior ? "prior-install" : "foreign";
}

/** Every provider skill-home path the installers write, paired with the source
 *  a given `packageRoot` would link there. Used to plan before mutating. */
export function packagedSkillTargets(packageRoot, env = process.env) {
  const targets = [];
  for (const skill of PACKAGED_SKILLS) {
    const source = join(packageRoot, "agent-skills", skill);
    for (const [provider, home] of resolveProviderSkillHomes(env)) {
      targets.push({ skill, provider, source, target: join(home, "skills", skill) });
    }
  }
  return targets;
}
