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
  const { linked, refused } = await linkPackagedSkills(packageRoot);

  for (const row of linked) {
    console.log(`$${row.skill} skill linked (${row.provider}): ${row.target} -> ${row.source}`);
  }
  console.log(`Linked ${linked.length} of ${linked.length + refused.length} skill targets from ${packageRoot}`);

  if (refused.length > 0) {
    // Partial success is the honest outcome and the useful one: the providers
    // that could be linked are linked, and the operator gets a specific list
    // rather than a single first-failure message. Exit is still non-zero —
    // a skipped provider is something to act on, not something to overlook.
    console.error("");
    console.error(`${refused.length} target(s) were left untouched:`);
    for (const row of refused) {
      console.error(`  $${row.skill} (${row.provider}): ${row.reason}`);
    }
    console.error("");
    console.error(
      "Cormidia never replaces a path it does not own. For each one: inspect it, and if it is stale " +
        "(a directory you no longer use, or a link from an old checkout) remove it and re-run this script. " +
        "The skills already linked above are working — the agents behind the skipped providers simply will not see Cormidia.",
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`cormidia link-skills: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
