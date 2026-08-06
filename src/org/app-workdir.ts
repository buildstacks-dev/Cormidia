// Local app checkout resolution for manual CLIs.
//
// App identity is the GitHub slug in apps.yaml; execution still needs a local
// checkout/worktree. For Bikram's laptop-first layout, target apps usually sit
// beside the Cormidia repo under ~/Build/. Managed dispatch clones live under
// ~/.cormidia/<org>/repos/<app>. Keep this resolver in the org layer so loop code
// remains app-agnostic.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { AppEntry } from "./apps.js";

export interface ResolveAppWorkdirOptions {
  explicitWorkdir?: string;
  orgRoot?: string;
  runtimeHome?: string;
}

export function resolveAppWorkdir(app: AppEntry, options: ResolveAppWorkdirOptions = {}): string {
  if (options.explicitWorkdir !== undefined) return resolve(options.explicitWorkdir);

  const candidates = appWorkdirCandidates(app, options);
  const found = candidates.find(isGitCheckout);
  if (found !== undefined) return found;

  throw new Error(
    `app workdir: no local checkout found for ${app.name} (${app.repo}); ` +
      `pass --workdir <path> or create one of: ${candidates.join(", ")}`,
  );
}

export function appWorkdirCandidates(app: AppEntry, options: ResolveAppWorkdirOptions = {}): string[] {
  const orgRoot = resolve(options.orgRoot ?? process.cwd());
  const runtimeHome = options.runtimeHome ?? join(homedir(), ".cormidia", "cormidia");
  const siblingRoot = dirname(orgRoot);
  const repoBase = repoBasename(app.repo);
  const candidates = [
    join(runtimeHome, "repos", app.name),
    join(siblingRoot, app.name),
    ...(repoBase !== app.name ? [join(siblingRoot, repoBase)] : []),
    ...localRepoCandidates(app.repo),
  ];

  return [...new Set(candidates.map((candidate) => resolve(candidate)))];
}

function isGitCheckout(path: string): boolean {
  return existsSync(join(path, ".git"));
}

function repoBasename(repo: string): string {
  const withoutGit = repo.endsWith(".git") ? repo.slice(0, -4) : repo;
  return basename(withoutGit);
}

function localRepoCandidates(repo: string): string[] {
  if (repo.startsWith("/") || repo.startsWith(".")) return [repo];
  if (!repo.startsWith("file:")) return [];
  try {
    return [new URL(repo).pathname];
  } catch {
    return [];
  }
}
