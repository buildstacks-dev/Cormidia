import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { validateTurnExecutionFacts } from "./assignment.js";
import { runtimeCapabilityGuidance, runtimeCapabilityProfile } from "./capabilities.js";
import type { ContextBundle, TurnExecutionFacts } from "./types.js";

export function renderContextBundle(context: ContextBundle): string {
  const sections = [
    ...(context.authority !== undefined
      ? [`## Effective delegated authority\n\n${context.authority.text.trim()}`]
      : []),
    ...context.taste,
  ];
  if (context.memoryExcerpts.length > 0) {
    sections.push(["## Memory excerpts", ...context.memoryExcerpts].join("\n\n"));
  }
  if (context.execution !== undefined) {
    sections.push(renderTurnExecutionFacts(context.execution));
  }
  return sections.join("\n\n---\n\n");
}

/** Exact capability-note bytes used by both native context rendering and the
 * context manifest's source hash/cache identity. */
export function renderTurnExecutionFacts(value: TurnExecutionFacts): string {
  const facts = validateTurnExecutionFacts(value);
  const profile = runtimeCapabilityProfile(facts.assignment.harness);
  const delegation =
    facts.roleDelegation.allow.length === 0
      ? "- Role policy permits no intra-turn subagents."
      : profile.capabilities.intra_turn_fanout === "unsupported"
        ? `- Role policy names ${facts.roleDelegation.allow.join(", ")}, but this harness has no fan-out surface; do not spawn subagents.`
        : `- Role-approved subagent types: ${facts.roleDelegation.allow.join(", ")}. Use no others.`;
  return [
    "## Turn execution facts",
    `Role: ${facts.role}`,
    `Harness: ${facts.assignment.harness}`,
    `Exact model: ${facts.assignment.model}`,
    `Effort: ${facts.assignment.effort}`,
    `Capability profile: ${profile.ref}`,
    "Capability surfaces (profile-derived):",
    ...runtimeCapabilityGuidance(facts.assignment.harness, facts.requiredCapabilities),
    "Delegation policy:",
    delegation,
    "This note advertises existing surfaces only; it does not change the role's tools, permissions, or approval boundaries.",
  ].join("\n");
}

interface WorktreeContextFile {
  path: string;
  excludePath: string;
}

export function writeMaskedWorktreeFile(workdir: string, relativePath: string, content: string): WorktreeContextFile {
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
