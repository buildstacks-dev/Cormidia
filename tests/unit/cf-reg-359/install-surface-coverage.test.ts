// CF-REG-359 — every declared install surface is actually installable.
//
// #359 added a second binary (`cormidia-job`) and a second packaged skill
// (`agent-skills/cormidia-job/`) to package.json, but the install path was
// never widened: `scripts/link-local.mjs` linked only `cormidia` and only the
// `cormidia` skill, and `scripts/smoke-package-install.mjs` invoked only
// `cormidia --version`. Both binaries were declared, one was reachable, and
// every gate stayed green because nothing compared the two lists.
//
// This is the structural half of the fix (L1). It pins the shared install
// table in scripts/lib/link-artifacts.mjs against what package.json actually
// declares and what exists on disk, so a THIRD binary or skill cannot land
// with a two-entry installer. The behavioural half is
// tests/hermetic/cf-b14/cf-b14-link-ownership.test.ts, which runs the real
// linker and asserts every target lands.

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGED_BINARIES, PACKAGED_SKILLS } from "../../../scripts/lib/link-artifacts.mjs";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  bin: Record<string, string>;
  files: string[];
};

/** package.json `files` accepts both exact paths and directory prefixes
 *  (`agent-skills/cormidia/`), so coverage is a prefix test, not equality. */
function packagedBy(files: string[], relative: string): boolean {
  return files.some((entry) => {
    const normalized = entry.replace(/\/$/, "");
    return relative === normalized || relative.startsWith(`${normalized}/`);
  });
}

describe("CF-REG-359 — declared install surface is fully installable", () => {
  it("the shared binary table covers exactly package.json `bin` — no declared binary is missing an install row", () => {
    expect(PACKAGED_BINARIES.map((binary) => binary.name).sort()).toEqual(Object.keys(pkg.bin).sort());
  });

  it("every binary's packaged launcher is the one package.json points at, exists, and ships", () => {
    for (const binary of PACKAGED_BINARIES) {
      expect(pkg.bin[binary.name]).toBe(`./${binary.packagedLauncher}`);
      expect(existsSync(join(repoRoot, binary.packagedLauncher))).toBe(true);
      expect(packagedBy(pkg.files, binary.packagedLauncher)).toBe(true);
    }
  });

  it("every binary has a source-backed launcher and runner on disk — link:local cannot link a file that does not exist", () => {
    for (const binary of PACKAGED_BINARIES) {
      expect(existsSync(join(repoRoot, binary.localLauncher))).toBe(true);
      expect(existsSync(join(repoRoot, binary.localRunner))).toBe(true);
    }
  });

  it("the packaged skill list covers exactly the agent-skills/ directories, and each ships with its SKILL.md", () => {
    const onDisk = readdirSync(join(repoRoot, "agent-skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect([...PACKAGED_SKILLS].sort()).toEqual(onDisk);

    for (const skill of PACKAGED_SKILLS) {
      expect(existsSync(join(repoRoot, "agent-skills", skill, "SKILL.md"))).toBe(true);
      expect(packagedBy(pkg.files, `agent-skills/${skill}/SKILL.md`)).toBe(true);
    }
  });

  it("the skill linker a published install depends on ships with its shared helper", () => {
    // scripts/link-skills.mjs is the ONLY skill-install path available to a
    // user who ran `npm install -g cormidia`; shipping it without the lib it
    // imports would make an npm install's skill setup fail at require time.
    for (const relative of [
      "scripts/link-skills.mjs",
      "scripts/lib/install-ownership.mjs",
      "scripts/lib/install-transaction.mjs",
      "scripts/lib/link-artifacts.mjs",
    ]) {
      expect(existsSync(join(repoRoot, relative))).toBe(true);
      expect(packagedBy(pkg.files, relative)).toBe(true);
    }
  });
});
