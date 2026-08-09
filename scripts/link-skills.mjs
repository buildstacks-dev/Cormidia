#!/usr/bin/env node

// Preflight and replace every packaged skill as one rollback-safe generation.

import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { formatInstallConflicts, inspectPackagedSkills } from "./lib/install-ownership.mjs";
import { transactionalReplace } from "./lib/install-transaction.mjs";
import { packagedSkillTargets } from "./lib/link-artifacts.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.length === 1 && args[0] === "--dry-run";
  if (args.length > (dryRun ? 1 : 0)) throw new Error("accepts only --dry-run");

  for (const skill of packagedSkillTargets(packageRoot)) await access(`${skill.source}/SKILL.md`);
  const plan = await inspectPackagedSkills(packageRoot);
  if (plan.owner.state !== "packaged") {
    throw new Error(`package identity is not owned by Cormidia: ${plan.owner.state}`);
  }
  if (plan.conflicts.length > 0) {
    throw new Error(
      `foreign skill collision(s) found before mutation (${plan.conflicts.length}):\n\n` +
        `${await formatInstallConflicts(plan.conflicts)}\n\nNo skill target was changed.`,
    );
  }

  const changing = plan.artifacts.filter((artifact) => artifact.state !== "packaged");
  if (dryRun) {
    console.log(`--dry-run: ${changing.length} of ${plan.artifacts.length} packaged skill target(s) would change.`);
    return;
  }
  await transactionalReplace(changing, async ({ promoteSymlink }) => {
    for (const artifact of changing) {
      const skill = packagedSkillTargets(packageRoot).find((candidate) => candidate.target === artifact.target);
      if (skill === undefined) throw new Error(`skill target left the shared install table: ${artifact.target}`);
      await promoteSymlink(skill.source, skill.target, "dir");
    }
  });

  for (const row of packagedSkillTargets(packageRoot)) {
    console.log(`$${row.skill} skill linked (${row.provider}): ${row.target} -> ${row.source}`);
  }
  console.log(`Linked ${plan.artifacts.length} of ${plan.artifacts.length} skill targets from ${packageRoot}`);
}

main().catch((error) => {
  console.error(`cormidia link-skills: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
