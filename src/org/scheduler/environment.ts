// Scheduler-owned process environment (#211). Host schedulers do not inherit
// an interactive shell PATH, so required tools are resolved once, recorded,
// rendered, and re-verified against the exact PATH the scheduled turn sees.

import { accessSync, constants } from "node:fs";
import { delimiter, dirname, isAbsolute, resolve } from "node:path";

export const DEFAULT_SCHEDULER_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
export const SCHEDULER_REQUIRED_EXECUTABLES_ENV = "CORMIDIA_SCHEDULER_REQUIRED_EXECUTABLES";
export const REQUIRED_SCHEDULER_TOOLS = ["gh"] as const;

export function resolveSchedulerRequiredExecutables(
  names: readonly string[] = REQUIRED_SCHEDULER_TOOLS,
  path = process.env.PATH ?? DEFAULT_SCHEDULER_PATH,
): Record<string, string> {
  return Object.fromEntries(
    names.map((name) => {
      const found = resolveExecutableOnPath(name, path);
      if (found === undefined) {
        throw new Error(`required scheduler tool '${name}' was not found on the operator PATH`);
      }
      return [name, found];
    }),
  );
}

export function schedulerEnvironmentPath(
  required: Readonly<Record<string, string>>,
  basePath = DEFAULT_SCHEDULER_PATH,
): string {
  const directories = Object.values(required).map((path) => dirname(assertAbsolute(path)));
  return [...new Set([...directories, ...basePath.split(delimiter).filter(Boolean)])].join(delimiter);
}

export function resolveExecutableOnPath(name: string, path: string): string | undefined {
  if (!/^[A-Za-z0-9._+-]+$/.test(name)) throw new TypeError(`invalid executable name: ${name}`);
  for (const directory of path.split(delimiter).filter(Boolean)) {
    const candidate = resolve(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* continue */
    }
  }
  return undefined;
}

export function requiredExecutablesManifest(required: Readonly<Record<string, string>>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(required).sort(([a], [b]) => a.localeCompare(b))));
}

export function schedulerEnvironmentProblems(input: {
  path: string;
  requiredExecutables: Readonly<Record<string, string>>;
}): string[] {
  const problems: string[] = [];
  for (const [name, recorded] of Object.entries(input.requiredExecutables).sort(([a], [b]) => a.localeCompare(b))) {
    const observed = resolveExecutableOnPath(name, input.path);
    if (observed !== recorded) {
      problems.push(
        `required tool '${name}' not found on scheduled-turn PATH at recorded path ${recorded}` +
          (observed === undefined ? "" : ` (resolved ${observed} instead)`),
      );
    }
  }
  return problems;
}

export function assertScheduledRequiredExecutables(env: Readonly<Record<string, string | undefined>>): void {
  const raw = env[SCHEDULER_REQUIRED_EXECUTABLES_ENV];
  if (raw === undefined) return;
  let required: Record<string, string>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a mapping");
    required = parsed as Record<string, string>;
  } catch (error) {
    throw new Error(
      `scheduled-turn required executable manifest is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const problems = schedulerEnvironmentProblems({
    path: env.PATH ?? "",
    requiredExecutables: required,
  });
  if (problems.length > 0) throw new Error(problems.join("; "));
}

function assertAbsolute(path: string): string {
  if (!isAbsolute(path)) throw new TypeError(`required executable path must be absolute: ${path}`);
  return resolve(path);
}
