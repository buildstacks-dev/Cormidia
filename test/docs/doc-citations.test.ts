// Documentation citations are load-bearing: code comments, ratified YAML
// surfaces, nested AGENTS.md files, and the docs themselves all point at
// `docs/...` paths, and nothing previously verified that those targets exist.
// The 2026-07-26 topic-folder reorg moved most root docs, so this is that
// change's deposited detector (AGENTS.md: every fix deposits its detector):
// a cited docs path that stops resolving — or a relative markdown link or
// heading anchor that rots — fails offline here instead of silently.
//
// Deliberately NOT scanned:
//  - research/**                      dated historical records; they cite the
//                                     paths that were true at their date
//  - eval/** except AGENTS.md/README  corpora, cases, and authorizations carry
//                                     synthetic target-app paths and frozen
//                                     evidence that must never be rewritten
//  - docs/wiki.html                   retired by the same reorg
//
// Reads committed files only; no network, org state, or wall-clock time.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Paths cited in code/docs that intentionally do NOT exist in this repo. */
const KNOWN_EXTERNAL_PATHS = new Set([
  // Emitted by `operon new-app` / `bootstrap` into the *target app's* repo.
  "docs/REQUIREMENTS.md",
  "docs/RUNBOOK.md",
  // The seeded benchmark sandbox repo's own file (scripts/seed-benchmark-repo.sh).
  "docs/product.md",
  // A managed app repo's design assets, cited from docs/live-ui/design.md.
  "docs/design/buildstacks-design-spec.md",
  "docs/design/buildstacks-prototype.html",
  // Glob illustration in policy templates and comments, not a real path.
  "docs/a/b.md",
  // Target-app spec path used in README's episode-intent example block.
  "docs/specs/feature-a.md",
  // Retired by ratified decisions; PURPOSE's Decided log and the successor
  // contracts' "formerly docs/efficiency.md" lineage notes cite them as
  // history. The 2026-07-26 reorg split efficiency.md into
  // docs/episodes/contract.md + docs/qualification/design.md.
  "docs/status.md",
  "docs/architecture/conceptual-overview.md",
  "docs/efficiency.md",
]);

const SCANNED_EXTENSIONS = new Set([".ts", ".mjs", ".cjs", ".sh", ".md", ".yaml", ".yml", ".template", ".mermaid"]);

// test/** is deliberately absent: fixture repos cite synthetic target-app
// docs paths by design, and a rotted path a test itself reads already fails
// that test loudly.
const SCAN_ROOTS = ["src", "scripts", "prompts", "docs", ".github"];
const SCAN_FILES = ["README.md", "AGENTS.md", "CLAUDE.md", "roles.yaml", "pipelines.yaml", "apps.yaml", "package.json", "eval/AGENTS.md", "eval/README.md"];

const SKIP_DIRS = new Set(["node_modules", "dist", ".eval-artifacts"]);

function walk(dir: string): string[] {
  return readdirSync(join(repoRoot, dir), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(rel);
      return SCANNED_EXTENSIONS.has(extname(entry.name)) ? [rel] : [];
    });
}

function scannedFiles(): string[] {
  const files = SCAN_ROOTS.flatMap((root) => (existsSync(join(repoRoot, root)) ? walk(root) : []));
  for (const file of SCAN_FILES) if (existsSync(join(repoRoot, file))) files.push(file);
  // The reorg backlog cites folders before they exist; it is deleted when done.
  return files.filter((file) => file !== join("docs", "todo-plan.md"));
}

/**
 * Extract `docs/...` file citations from arbitrary text (code, YAML, prose).
 * Directory references are not checked: target-app repos legitimately carry
 * their own `docs/specs/`-style trees that this repo never contains.
 */
function citedDocsPaths(text: string): string[] {
  const matches = text.match(/docs\/[A-Za-z0-9][A-Za-z0-9_./-]*/g) ?? [];
  return matches
    .map((raw) => raw.replace(/[.,;:)\]]+$/, ""))
    .filter((path) => /\.(?:md|html|template|mermaid|yaml|yml)$/.test(path));
}

/** GitHub-style heading slug (sufficient for the anchors this repo uses). */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9 _-]/g, "")
    .trim()
    .replace(/ /g, "-");
}

function headingSlugs(markdown: string): Set<string> {
  const slugs = new Set<string>();
  for (const line of markdown.split("\n")) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (match) slugs.add(slug(match[1]));
  }
  return slugs;
}

describe("documentation citations resolve", () => {
  it("every docs/ path cited anywhere in the repo exists", () => {
    const failures: string[] = [];
    for (const file of scannedFiles()) {
      const text = readFileSync(join(repoRoot, file), "utf8");
      for (const cited of citedDocsPaths(text)) {
        if (KNOWN_EXTERNAL_PATHS.has(cited)) continue;
        const target = join(repoRoot, cited);
        if (cited.endsWith("/") ? !isDirectory(target) : !existsSync(target)) {
          failures.push(`${file} cites missing ${cited}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("relative markdown links and heading anchors inside the docs tree resolve", () => {
    const markdownFiles = scannedFiles().filter(
      (file) => file.endsWith(".md") && (file.startsWith(`docs${sep}`) || file === "README.md" || file.endsWith("AGENTS.md") || file === "eval/README.md"),
    );
    const failures: string[] = [];
    for (const file of markdownFiles) {
      const text = readFileSync(join(repoRoot, file), "utf8");
      for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const raw = match[1];
        if (/^(?:https?:|mailto:)/.test(raw)) continue;
        const [pathPart, anchor] = raw.split("#", 2);
        const target = pathPart === "" ? join(repoRoot, file) : resolve(repoRoot, dirname(file), pathPart);
        if (!existsSync(target)) {
          failures.push(`${file} links missing ${raw}`);
          continue;
        }
        if (anchor && extname(target) === ".md" && !headingSlugs(readFileSync(target, "utf8")).has(anchor)) {
          failures.push(`${file} links missing anchor ${raw}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
