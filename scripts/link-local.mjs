#!/usr/bin/env node

// Source-backed dev install. Links every packaged `bin` entry and every
// packaged skill in `agent-skills/` so a source checkout exposes exactly the
// surface a packaged install does — one binary or skill left unlinked here is
// a capability that silently does not exist for the operator (#359 shipped
// `cormidia-job` and its skill without a link target; both were unreachable).
//
// The ownership guard lives in scripts/lib/link-artifacts.mjs and is shared
// with scripts/install-packaged.mjs.

import { chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGED_BINARIES, linkExact, linkPackagedSkills } from "./lib/link-artifacts.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const binDir = resolve(process.env.CORMIDIA_BIN_DIR ?? join(homedir(), ".local", "bin"));

const binaries = PACKAGED_BINARIES.map((binary) => ({
  name: binary.name,
  source: join(packageRoot, binary.localLauncher),
  migrateFrom: binary.migrateFrom.map((relative) => join(packageRoot, relative)),
}));

for (const binary of binaries) await chmod(binary.source, 0o755);

const linkedBinaries = [];
for (const binary of binaries) {
  const target = join(binDir, binary.name);
  const action = await linkExact(binary.source, target, "file", { migrateFrom: binary.migrateFrom });
  linkedBinaries.push({ ...binary, target, action });
}

const linkedSkills = await linkPackagedSkills(packageRoot);

for (const binary of linkedBinaries) {
  if (binary.action === "migrated") {
    console.log(`${binary.name} binary link migrated from the legacy same-checkout launcher: ${binary.target}`);
  }
  console.log(`${binary.name} binary linked: ${binary.target} -> ${binary.source}`);
}
for (const linked of linkedSkills) {
  console.log(`$${linked.skill} skill linked (${linked.provider}): ${linked.target} -> ${linked.source}`);
}
console.log("This local link is source-backed: the next invocation picks up source changes without update or rebuild.");
if (!process.env.PATH?.split(":").includes(binDir)) {
  console.log(`Add ${binDir} to PATH, then run: cormidia --version`);
}
