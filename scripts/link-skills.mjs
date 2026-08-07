#!/usr/bin/env node

// Link the packaged Cormidia skills into the operator's provider skill homes.
//
// SHIPPED (package.json `files`): this is the only skill-install path a user
// who ran `npm install -g cormidia` has. npm installs the two binaries and
// nothing else — the skills ride along in the tarball but nothing links them,
// so without this script an npm install yields binaries no coding agent knows
// how to drive.
//
//   node "$(npm root -g)/cormidia/scripts/link-skills.mjs"
//
// Destination is the provider's USER-GLOBAL skill home, never a project
// directory and never an agent's root instruction file: a skill is routed by
// its frontmatter name/description and its body loads only when triggered, so
// a globally installed skill costs nothing until it is actually used.
//
// Run it again after upgrading. It is idempotent, and it refuses — untouched —
// any file or link at a target path that this package does not own.

import { linkPackagedSkills } from "./lib/link-artifacts.mjs";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

try {
  const linked = await linkPackagedSkills(packageRoot);
  for (const row of linked) {
    console.log(`$${row.skill} skill linked (${row.provider}): ${row.target} -> ${row.source}`);
  }
  console.log(`Linked ${linked.length} skill targets from ${packageRoot}`);
} catch (error) {
  console.error(`cormidia link-skills: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
