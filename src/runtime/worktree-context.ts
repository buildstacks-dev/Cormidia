import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import type { ContextBundle } from "./types.js";

export function renderContextBundle(context: ContextBundle): string {
  const sections = [...context.taste];
  if (context.memoryExcerpts.length > 0) {
    sections.push(["## Memory excerpts", ...context.memoryExcerpts].join("\n\n"));
  }
  return sections.join("\n\n---\n\n");
}

export interface WorktreeContextFile {
  path: string;
  excludePath: string;
}

export function writeMaskedWorktreeFile(
  workdir: string,
  relativePath: string,
  content: string,
): WorktreeContextFile {
  const normalized = normalizeRelativePath(relativePath);
  const target = path.join(workdir, normalized);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");

  const excludePath = gitExcludePath(workdir);
  mkdirSync(path.dirname(excludePath), { recursive: true });
  const existing = readFileIfExists(excludePath);
  const excludeEntry = normalized.split(path.sep).join("/");
  const lines = existing.split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.includes(excludeEntry)) {
    writeFileSync(
      excludePath,
      `${existing}${existing.length > 0 && !existing.endsWith("\n") ? "\n" : ""}${excludeEntry}\n`,
      "utf8",
    );
  }

  return { path: target, excludePath };
}

function normalizeRelativePath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`worktree context path must be relative: ${relativePath}`);
  }
  const normalized = path.normalize(relativePath);
  if (normalized === "." || normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`worktree context path escapes the worktree: ${relativePath}`);
  }
  return normalized;
}

function gitExcludePath(workdir: string): string {
  try {
    const gitPath = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], {
      cwd: workdir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return path.isAbsolute(gitPath) ? gitPath : path.join(workdir, gitPath);
  } catch {
    return path.join(workdir, ".git", "info", "exclude");
  }
}

function readFileIfExists(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
