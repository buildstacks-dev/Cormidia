// CF-B10 / CF-C-B10 — HB-014 — boundary-map.md B-10; contracts/B-10-config-resolver.md product-identity clause.

// CF-B10-* (L1) — product-identity and storage-boundary rename detector.
//
// This source constructs the retired identifier from fragments so the detector
// can scan itself without granting itself a blanket exception. It enumerates
// tracked and untracked repository files, filters the frozen archive before any
// read, and tolerates ZERO occurrences: the rename completed and its last
// exceptions (migration seams, retired external repository slugs, immutable
// campaign evidence) were retired 2026-08-14 by owner ruling. An occurrence is
// an agent resurrecting the retired name, never legitimate residue.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const RETIRED = ["ope", "ron"].join("");
const FROZEN_ARCHIVE = "archive-do-not-read/";
const STANDALONE_AGENT_TOOLING = ".agents/";

function repositoryTextFiles(): Map<string, string> {
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .filter((path) => !path.startsWith(FROZEN_ARCHIVE))
    .filter((path) => !path.startsWith(STANDALONE_AGENT_TOOLING));

  const files = new Map<string, string>();
  for (const path of paths) {
    const bytes = readFileSync(join(REPO_ROOT, path));
    if (!bytes.includes(0)) files.set(path, bytes.toString("utf8"));
  }
  return files;
}

describe("CF-B10-* (L1) Cormidia is the sole product identity", () => {
  it("keeps the retired identifier out of the repository entirely", () => {
    const pattern = new RegExp(RETIRED, "i");
    const violations = [...repositoryTextFiles()].filter(([, text]) => pattern.test(text)).map(([path]) => path);
    expect(violations).toEqual([]);
  });

  it("keeps package, command, packaged paths, and moved filesystem entries in lockstep", () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      name: string;
      bin: Record<string, string>;
      files: string[];
      private?: boolean;
      publishConfig?: { access?: string };
    };
    expect(manifest.name).toBe("cormidia");
    // Still an EXACT map, deliberately: a new binary changes what the package
    // *is* and is a PURPOSE-level decision, so an unreviewed third entry must
    // fail here rather than ship. `cormidia-job` was ratified 2026-08-07
    // (PURPOSE v2.16 — jobs); it carries explicitly weaker guarantees than
    // `cormidia`, which is the reason it is a separate name at all
    // (docs/jobs/design.md §12).
    expect(manifest.bin).toEqual({
      cormidia: "./src/cormidia.cjs",
      "cormidia-job": "./src/cormidia-job.cjs",
    });
    // The manifest must stay publishable and public: `private: true` blocks the
    // publish outright, and without an explicit public access the registry can
    // default to restricted. Both are silent — they surface only at publish time.
    expect(manifest.private).toBe(false);
    expect(manifest.publishConfig).toEqual({ access: "public" });
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        "src/cormidia.cjs",
        "src/cormidia-job.cjs",
        "src/cormidia-local.cjs",
        "scripts/cormidia-local.mjs",
        "agent-skills/cormidia/",
      ]),
    );

    for (const path of [
      "src/cormidia.cjs",
      "src/cormidia-local.cjs",
      "scripts/cormidia-local.mjs",
      "agent-skills/cormidia/SKILL.md",
      "config/launchd/cormidia-dispatch.plist.template",
    ]) {
      expect(existsSync(join(REPO_ROOT, path)), path).toBe(true);
    }
    for (const path of [
      `src/${RETIRED}.cjs`,
      `src/${RETIRED}-local.cjs`,
      `scripts/${RETIRED}-local.mjs`,
      `agent-skills/${RETIRED}`,
      `config/launchd/${RETIRED}-dispatch.plist.template`,
    ]) {
      expect(existsSync(join(REPO_ROOT, path)), path).toBe(false);
    }
  });

  it("contains the biological origin only in the one README paragraph", () => {
    const vocabularyTerms = [
      ["cormi", "dium"],
      ["zoo", "id"],
      ["col", "ony"],
      ["siphono", "phore"],
    ].map((parts) => parts.join(""));
    const vocabulary = new RegExp(`(?:${vocabularyTerms.join("|")})\\w*`, "i");
    const hits = [...repositoryTextFiles()].filter(([, text]) => vocabulary.test(text)).map(([path]) => path);
    expect(hits).toEqual(["README.md"]);
  });
});
