// Filesystem scope resolution for repository provisioning (#382).
//
// The declaration-bounded half of the preflight, split out so the preflight
// itself stays inside the new-module size ceiling. Every function here answers
// one question: given a DECLARED set of file paths and `dir/` prefixes, which
// real bytes does it cover?
//
// The org-scope guard is the load-bearing part. `classifyOrgHomeWrite` is the
// single org/state boundary decision (src/org/home.ts owns it), and a path it
// does not call committed configuration never enters a provisioning commit —
// whatever a declaration claims. That is why the check lives here rather than
// being restated as a second exclusion list.

import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { join, relative, sep } from "node:path";
import { classifyOrgHomeWrite } from "./committed-org-surfaces.js";
import { sha256Hex } from "./git-publication-substrate.js";

export interface RepositoryProvisionOwnedPath {
  path: string;
  bytes: number;
  sha256: string;
}

export type RepositoryProvisionScope = "org" | "app";

/** The concrete files a declaration covers: every declared file that exists,
 *  plus, for each `dir/` prefix, its real files — bounded by the declaration at
 *  every step, and for the org scope re-checked through `classifyOrgHomeWrite`
 *  so no runtime-state path can enter a commit. */
export function expandDeclaration(
  root: string,
  declared: readonly string[],
  scope: RepositoryProvisionScope,
  blockers: string[],
  errorPrefix: string,
): RepositoryProvisionOwnedPath[] {
  const found = new Set<string>();
  for (const entry of declared) {
    if (entry.endsWith("/")) {
      for (const path of walkFiles(root, entry.slice(0, -1))) found.add(path);
    } else if (isReadableFile(join(root, entry))) {
      found.add(entry);
    }
  }

  const owned: RepositoryProvisionOwnedPath[] = [];
  for (const path of [...found].sort()) {
    if (!declarationOwns(declared, path)) continue;
    if (scope === "org") {
      // The state-home guard. `classifyOrgHomeWrite` is the single boundary
      // decision; a path it does not call committed configuration never enters
      // a provisioning commit, whatever a declaration claims.
      const classification = classifyOrgHomeWrite(path);
      if (classification.kind !== "committed") {
        if (classification.kind === "unclassified") {
          blockers.push(
            `${errorPrefix}: ${path} is inside a declared org surface but is not classified committed ` +
              "configuration — register it in src/org/committed-org-surfaces.ts or exclude it",
          );
        }
        continue;
      }
    }
    const absolute = join(root, path);
    const content = readFileSync(absolute);
    owned.push({ path, bytes: content.byteLength, sha256: sha256Hex(content) });
  }
  return owned;
}

/** Repo-relative files under a directory, skipping `.git` and never following
 *  a symlink out of the tree — a provisioning commit must not carry bytes from
 *  outside the checkout it claims to publish. */
function walkFiles(root: string, directory: string): string[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  const results: string[] = [];
  const stack = [absolute];
  for (;;) {
    const current = stack.pop();
    if (current === undefined) break;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const child = join(current, entry.name);
      // Never traverse or read a symlink: it can point anywhere.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(child);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(root, child).split(sep).join("/");
      if (rel.startsWith("..")) continue;
      results.push(rel);
    }
  }
  return results.sort();
}

function isReadableFile(absolute: string): boolean {
  try {
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}

export function declarationOwns(declared: readonly string[], path: string): boolean {
  return declared.some((owned) => (owned.endsWith("/") ? path.startsWith(owned) : path === owned));
}

/** The configured remote URL, read from the git config file directly so this
 *  stays inspection-only and works on a directory `git init` has never run in. */
export function readLocalOrigin(root: string, remoteName: string): string | null {
  const configPath = join(root, ".git", "config");
  if (!existsSync(configPath)) return null;
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch {
    return null;
  }
  const section = new RegExp(`\\[remote "${remoteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\]([^[]*)`).exec(text);
  const url = section?.[1] === undefined ? undefined : /^\s*url\s*=\s*(.+)$/m.exec(section[1])?.[1];
  return url === undefined ? null : url.trim();
}

/** Does a remote URL name this slug? Compared on the owner/repo tail so SSH,
 *  HTTPS, and `.git`-suffixed spellings of the same repository all agree. */
export function remoteUrlNamesSlug(url: string, slug: string): boolean {
  const match = /([^/:]+\/[^/:]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match?.[1]?.toLowerCase() === slug.toLowerCase();
}
