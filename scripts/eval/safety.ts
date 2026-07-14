export function assertGitHubTarget(actual: { owner: string; repo: string; isPrivate: boolean }, declared: { owner: string; repo_pattern: string }): void {
  if (actual.owner !== declared.owner) throw new Error("github_owner_not_allowlisted");
  if (!/^operon-eval-[a-z0-9][a-z0-9-]*$/.test(actual.repo)) throw new Error("github_repo_not_allowlisted");
  if (declared.repo_pattern !== "operon-eval-*" && actual.repo !== declared.repo_pattern) throw new Error("github_repo_not_declared");
  if (!actual.isPrivate) throw new Error("github_repo_must_be_private");
}

export function assertLiveConfirmation(args: { envEnabled: boolean; campaignId: string; confirmedId?: string; requestedMaxUsd?: number; manifestMaxUsd: number }): void {
  if (!args.envEnabled) throw new Error("live_eval_env_not_enabled");
  if (args.confirmedId !== args.campaignId) throw new Error("live_eval_confirmation_mismatch");
  if (typeof args.requestedMaxUsd !== "number" || !Number.isFinite(args.requestedMaxUsd) || args.requestedMaxUsd <= 0) throw new Error("live_eval_max_usd_required");
  if (args.requestedMaxUsd > args.manifestMaxUsd) throw new Error("live_eval_cap_exceeds_manifest");
}

export function assertEvalSeparation(evalRoot: string, productionPaths: string[]): void {
  const evaluation = resolve(evalRoot);
  for (const raw of productionPaths.filter((path) => path.trim() !== "")) {
    const production = existsSync(raw) ? realpathSync(raw) : resolve(raw);
    if (inside(production, evaluation) || inside(evaluation, production)) throw new Error(`production_path_overlap:${production}`);
  }
}

export function makeEvalActorGate(options: { workdir: string; forbiddenRoots: string[]; baseGate?: GateFn }): GateFn {
  const workdir = realpathSync(options.workdir);
  const forbidden = options.forbiddenRoots.map((path) => existsSync(path) ? realpathSync(path) : resolve(path));
  const base = options.baseGate ?? defaultGate;
  return (action: ToolAction) => {
    const violation = actorPathViolation(action, workdir, forbidden);
    if (violation) return { allow: false, reason: `eval actor isolation (${violation})`, escalate: false };
    return base(action);
  };
}

function actorPathViolation(action: ToolAction, workdir: string, forbidden: string[]): string | null {
  const raw = `${action.tool}\n${JSON.stringify(action.input ?? "")}`;
  const decoded = decodeRepeated(raw).replaceAll("\\\\", "/");
  for (const root of forbidden) if (decoded.includes(root) || decoded.includes(root.replaceAll("\\\\", "/"))) return "forbidden_root";
  if (/(^|[\s"'=;(])\.\.(?:\/|\\)/.test(decoded)) return "parent_traversal";
  const candidates = pathCandidates(action, decoded);
  for (const candidate of candidates) {
    if (/^(?:~|\$HOME|\$\{HOME\})(?:[\\/]|$)/i.test(candidate)) {
      return "outside_worktree";
    }
    const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(workdir, candidate);
    if (!inside(workdir, absolute)) return "outside_worktree";
    if (existsSync(absolute)) {
      let real: string;
      try { real = realpathSync(absolute); } catch { return "unreadable_path"; }
      if (!inside(workdir, real)) return "symlink_escape";
    }
  }
  return null;
}
function pathCandidates(action: ToolAction, text: string): string[] {
  const values: string[] = [];
  const input = typeof action.input === "object" && action.input !== null && !Array.isArray(action.input) ? action.input as Record<string, unknown> : undefined;
  for (const key of ["path", "file", "cwd", "workdir", "target", "destination"]) if (typeof input?.[key] === "string") values.push(input[key] as string);
  for (const match of text.matchAll(/(?:^|\s)(?:>|>>|<|--file|--output|-o)\s*["']?([^\s"';|&]+)/g)) if (match[1]) values.push(match[1]);
  // Bash paths used as ordinary arguments (for example `cat ~/.claude/...`
  // or `python /etc/tool.py`) must not escape merely because they are not a
  // redirection target or a structured `path` field.
  for (const match of text.matchAll(/(?:^|[\s"'=;(,:])((?:~|\$HOME|\$\{HOME\})(?:[\\/][^\s"'`;|&}]*)?|\/(?:[^\s"'`;|&}]+))/gi)) if (match[1]) values.push(match[1]);
  return [...new Set(values.filter((value) => value !== "-" && value !== "/dev/null"))];
}
function decodeRepeated(value: string): string { let current = value; for (let i = 0; i < 3; i++) { try { const decoded = decodeURIComponent(current); if (decoded === current) return current; current = decoded; } catch { return current; } } return current; }
function inside(root: string, path: string): boolean { const rel = relative(root, path); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); }
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { GateFn, ToolAction } from "../../src/runtime/types.js";
import { classify, defaultGate } from "../../src/runtime/gate.js";
import { FORBIDDEN_BY_ROLE } from "../../src/runtime/role-shaping.js";

export function makeEvalRoleGate(roleName: string, base: GateFn): GateFn { return (action) => { const rule = classify(action).rule; if (rule && FORBIDDEN_BY_ROLE[roleName]?.includes(rule)) return { allow: false, reason: `role ${roleName} forbids ${rule}`, escalate: false }; return base(action); }; }
