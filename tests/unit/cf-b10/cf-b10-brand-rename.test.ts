// CF-B10-* (L1) — product-identity and storage-boundary rename detector.
//
// This source constructs the retired identifier from fragments so the detector
// can scan itself without granting itself a blanket exception. It enumerates
// tracked and untracked repository files, filters the frozen archive before any
// read, and permits only the explicitly ratified migration seams and external
// repository slugs.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const RETIRED = ["ope", "ron"].join("");
const LEGACY_DIR = `.${RETIRED}`;
const FROZEN_ARCHIVE = "archive-do-not-read/";

const IMMUTABLE_RESEARCH_EVIDENCE = [
  "research/evals/campaigns/",
  "research/2026-07-12_live-ui/buildstacks-telemetry.evidence/",
  "research/2026-07-12_live-ui/buildstacks-telemetry.html",
  "research/2026-07-12_live-ui/buildstacks-final-snapshot.json",
];

const PROTECTED_EXTERNAL_SLUGS = new Map([
  [`bikramgupta/${RETIRED}-sandbox-alpha`, 5],
  [`bikramgupta/${RETIRED}-sandbox-gamma`, 5],
  [`bikramgupta/${RETIRED}-marketplace-demo`, 2],
  [`bikramgupta/${RETIRED}-eval-candidate-qualification-v1-20260718-eb658f6309c9`, 1],
  [`buildstacks-dev/${RETIRED}-eval-candidate-qualification-v1-20260716-9ccc03a2c582`, 1],
]);

const PROTECTED_EXTERNAL_NAMES = new Map([
  [`${RETIRED}-sandbox-alpha`, 14],
  [`${RETIRED}-sandbox-gamma`, 23],
  [`${RETIRED}-marketplace-demo`, 16],
]);

const LEGACY_MIGRATION_COUNTS = new Map([
  ["README.md", 2],
  ["tests/hermetic/cf-b14/cf-b14-bootstrap-checkout.test.ts", 2],
  ["tests/hermetic/cf-j01/cf-j01-r.test.ts", 1],
  ["tests/hermetic/cf-j01/cf-j01-s.test.ts", 1],
  ["src/org/bootstrap.ts", 1],
  ["src/org/home.ts", 1],
  ["validation-design/contracts/B-10-config-resolver.md", 1],
]);

function repositoryTextFiles(): Map<string, string> {
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .filter((path) => !path.startsWith(FROZEN_ARCHIVE));

  const files = new Map<string, string>();
  for (const path of paths) {
    const bytes = readFileSync(join(REPO_ROOT, path));
    if (!bytes.includes(0)) files.set(path, bytes.toString("utf8"));
  }
  return files;
}

function occurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

function isImmutableResearchEvidence(path: string): boolean {
  return IMMUTABLE_RESEARCH_EVIDENCE.some((entry) =>
    entry.endsWith("/") ? path.startsWith(entry) : path === entry,
  );
}

describe("CF-B10-* (L1) Cormidia is the sole product identity", () => {
  it("keeps the retired identifier only in migration seams and protected external repository identities", () => {
    const files = repositoryTextFiles();
    const scannableFiles = [...files].filter(([path]) => !isImmutableResearchEvidence(path));
    const combined = scannableFiles.map(([, text]) => text).join("\n");

    for (const [slug, expectedCount] of PROTECTED_EXTERNAL_SLUGS) {
      expect(occurrences(combined, slug), slug).toBe(expectedCount);
    }
    let withoutSlugs = combined;
    for (const slug of PROTECTED_EXTERNAL_SLUGS.keys()) withoutSlugs = withoutSlugs.replaceAll(slug, "");
    for (const [name, expectedCount] of PROTECTED_EXTERNAL_NAMES) {
      expect(occurrences(withoutSlugs, name), name).toBe(expectedCount);
    }

    const violations: string[] = [];
    for (const [path, original] of scannableFiles) {
      let text = original;
      for (const slug of PROTECTED_EXTERNAL_SLUGS.keys()) text = text.replaceAll(slug, "");
      for (const name of PROTECTED_EXTERNAL_NAMES.keys()) text = text.replaceAll(name, "");

      const allowedLegacyCount = LEGACY_MIGRATION_COUNTS.get(path) ?? 0;
      expect(occurrences(text, LEGACY_DIR), path).toBe(allowedLegacyCount);
      text = text.replaceAll(LEGACY_DIR, "");

      if (new RegExp(RETIRED, "i").test(text)) violations.push(path);
    }

    expect(violations).toEqual([]);
  });

  it("keeps package, command, packaged paths, and moved filesystem entries in lockstep", () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      name: string;
      bin: Record<string, string>;
      files: string[];
    };
    expect(manifest.name).toBe("cormidia");
    expect(manifest.bin).toEqual({ cormidia: "./src/cormidia.cjs" });
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        "src/cormidia.cjs",
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
    const hits = [...repositoryTextFiles()]
      .filter(([, text]) => vocabulary.test(text))
      .map(([path]) => path);
    expect(hits).toEqual(["README.md"]);
  });
});
