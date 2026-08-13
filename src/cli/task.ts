// `cormidia task` — explicit parent delegated-task lifecycle. A top-level
// Codex/Claude harness begins one record, exports CORMIDIA_PARENT_TASK_ID while
// invoking Planner/Builder/Reviewer commands, records any external fallback,
// and finishes only when the delegated outcome is terminal.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveAppWorkdir } from "../org/app-workdir.js";
import { authorityEvidence, resolveAuthority } from "../org/authority.js";
import { resolveCormidiaHomes } from "../org/home.js";
import {
  beginParentTask,
  finishParentTask,
  markParentTaskFallback,
  readParentTask,
  readParentTaskPrompt,
  type ParentTaskCompletionState,
  type ParentTaskRecord,
  type ParentTaskStatus,
} from "../org/parent-task.js";
import { extractHomeFlags } from "./home-flags.js";
import { definedProps } from "../runtime/optional-properties.js";

export async function cmdTask(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "task");
  const [verb, ...rest] = common.rest;
  if (verb === undefined) throw new Error("task: expected begin | fallback | finish | show");
  const homes = await resolveCormidiaHomes(common);

  if (verb === "begin") {
    const parsed = parseBegin(rest);
    const originalPrompt = await readFile(resolve(parsed.promptFile), "utf8");
    const completionCriteria =
      parsed.completionFile !== undefined ? await readFile(resolve(parsed.completionFile), "utf8") : undefined;
    const nativeRef =
      parsed.nativeRef ??
      (parsed.harness === "codex" && parsed.nativeTaskId !== undefined
        ? `codex://threads/${parsed.nativeTaskId}`
        : undefined);
    let effectiveWorkdir = parsed.workdir;
    if (effectiveWorkdir === undefined && parsed.app !== undefined) {
      const app = homes.appsFile.apps.find((candidate) => candidate.name === parsed.app);
      if (app === undefined) throw new Error(`task begin: unknown app "${parsed.app}" in apps.yaml`);
      effectiveWorkdir = resolveAppWorkdir(app, {
        orgRoot: homes.orgHome,
        runtimeHome: homes.stateHome,
      });
    }
    const record = await beginParentTask({
      stateHome: homes.stateHome,
      taskId: parsed.id,
      originalPrompt,
      ...definedProps({ objective: parsed.objective }),
      ...definedProps({ completionCriteria }),
      ...definedProps({ app: parsed.app }),
      ...definedProps({ workdir: effectiveWorkdir }),
      ...definedProps({ harness: parsed.harness }),
      ...definedProps({ nativeTaskId: parsed.nativeTaskId }),
      ...definedProps({ nativeRef }),
      ...definedProps({ requiredStages: parsed.requiredStages }),
      charter: authorityEvidence(
        await resolveAuthority({
          orgHome: homes.orgHome,
          ...definedProps({ appWorkdir: effectiveWorkdir }),
        }),
      ),
    });
    printTask(record);
    console.log(`next: export CORMIDIA_PARENT_TASK_ID=${shellQuote(record.taskId)}`);
    return 0;
  }

  if (verb === "fallback") {
    const parsed = parseFallback(rest);
    const record = await markParentTaskFallback({
      stateHome: homes.stateHome,
      taskId: parsed.id,
      reason: parsed.reason,
      ...definedProps({ actor: parsed.actor }),
      ...(parsed.externalOnly ? { externalOnly: true } : {}),
    });
    printTask(record);
    return 0;
  }

  if (verb === "finish") {
    const parsed = parseFinish(rest);
    const record = await finishParentTask({
      stateHome: homes.stateHome,
      taskId: parsed.id,
      status: parsed.status,
      ...definedProps({ resultSummary: parsed.result }),
      refs: parsed.refs,
      completionState: parsed.completionState,
    });
    printTask(record);
    return 0;
  }

  if (verb === "show") {
    const parsed = parseShow(rest);
    const record = await readParentTask(homes.stateHome, parsed.id);
    if (parsed.prompt) console.log(await readParentTaskPrompt(homes.stateHome, parsed.id));
    else if (parsed.json) console.log(JSON.stringify(record, null, 2));
    else printTask(record);
    return 0;
  }

  throw new Error(`task: unknown verb "${verb}"`);
}

function printTask(record: ParentTaskRecord): void {
  console.log(`task ${record.taskId}: ${record.status}`);
  console.log(`objective: ${record.objective}`);
  console.log(`execution: ${record.executionMode}`);
  console.log(`required stages: ${record.requiredStages.join(", ") || "none"}`);
  console.log(`prompt: ${record.promptRef} sha256:${record.promptSha256}`);
  if (record.charter !== undefined) {
    console.log(`authority: ${record.charter.version} sha256:${record.charter.sha256}`);
  }
  if (record.source?.nativeRef !== undefined) console.log(`native task: ${record.source.nativeRef}`);
  if (record.fallbackEvents.length > 0) {
    console.log(`fallbacks: ${record.fallbackEvents.map((event) => event.reason).join("; ")}`);
  }
}

interface BeginArgs {
  id: string;
  promptFile: string;
  completionFile?: string;
  objective?: string;
  app?: string;
  workdir?: string;
  harness?: string;
  nativeTaskId?: string;
  nativeRef?: string;
  requiredStages?: string[];
}

function parseBegin(args: string[]): BeginArgs {
  const values = parseFlags(
    args,
    new Set([
      "--id",
      "--prompt-file",
      "--completion-file",
      "--objective",
      "--app",
      "--workdir",
      "--harness",
      "--native-task-id",
      "--native-ref",
      "--required-stages",
    ]),
  );
  return {
    id: required(values, "--id", "task begin"),
    promptFile: required(values, "--prompt-file", "task begin"),
    ...optional(values, "--completion-file", "completionFile"),
    ...optional(values, "--objective", "objective"),
    ...optional(values, "--app", "app"),
    ...optional(values, "--workdir", "workdir"),
    ...optional(values, "--harness", "harness"),
    ...optional(values, "--native-task-id", "nativeTaskId"),
    ...optional(values, "--native-ref", "nativeRef"),
    ...(values.get("--required-stages") !== undefined
      ? { requiredStages: splitList(values.get("--required-stages")!) }
      : {}),
  };
}

function parseFallback(args: string[]): { id: string; reason: string; actor?: string; externalOnly: boolean } {
  const externalOnly = args.includes("--external-only");
  const values = parseFlags(
    args.filter((arg) => arg !== "--external-only"),
    new Set(["--id", "--reason", "--actor"]),
  );
  return {
    id: required(values, "--id", "task fallback"),
    reason: required(values, "--reason", "task fallback"),
    ...optional(values, "--actor", "actor"),
    externalOnly,
  };
}

function parseFinish(args: string[]): {
  id: string;
  status: Exclude<ParentTaskStatus, "running">;
  result?: string;
  refs: ParentTaskRecord["refs"];
  completionState: ParentTaskCompletionState;
} {
  const multi = parseMultiFlags(
    args,
    new Set([
      "--id",
      "--status",
      "--result",
      "--ticket",
      "--trace",
      "--branch",
      "--pr",
      "--review",
      "--deployment",
      "--implementation",
      "--ci",
      "--cormidia-review",
      "--human-review",
      "--pr-state",
      "--issue-closes-on-merge",
    ]),
  );
  const status = requiredMulti(multi, "--status", "task finish");
  if (!(["completed", "failed", "cancelled", "interrupted"] as string[]).includes(status)) {
    throw new Error("task finish: --status must be completed | failed | cancelled | interrupted");
  }
  return {
    id: requiredMulti(multi, "--id", "task finish"),
    status: status as Exclude<ParentTaskStatus, "running">,
    ...(multi.get("--result")?.[0] !== undefined ? { result: multi.get("--result")![0] } : {}),
    refs: {
      tickets: multi.get("--ticket") ?? [],
      traces: multi.get("--trace") ?? [],
      branches: multi.get("--branch") ?? [],
      prs: multi.get("--pr") ?? [],
      reviews: multi.get("--review") ?? [],
      deployments: multi.get("--deployment") ?? [],
    },
    completionState: {
      implementation: enumValue(multi, "--implementation", ["complete", "incomplete", "unknown"], "unknown"),
      ci: enumValue(multi, "--ci", ["green", "red", "pending", "unknown"], "unknown"),
      cormidiaReview: enumValue(
        multi,
        "--cormidia-review",
        ["approved", "changes_requested", "awaiting", "bypassed", "not_required", "unknown"],
        "unknown",
      ),
      humanReview: enumValue(multi, "--human-review", ["approved", "awaiting", "not_required", "unknown"], "unknown"),
      pr: enumValue(multi, "--pr-state", ["open", "merged", "closed", "abandoned", "none", "unknown"], "unknown"),
      issuesCloseOnMerge: multi.get("--issue-closes-on-merge") ?? [],
    },
  };
}

function parseShow(args: string[]): { id: string; json: boolean; prompt: boolean } {
  const json = args.includes("--json");
  const prompt = args.includes("--prompt");
  const values = parseFlags(
    args.filter((arg) => arg !== "--json" && arg !== "--prompt"),
    new Set(["--id"]),
  );
  return { id: required(values, "--id", "task show"), json, prompt };
}

function parseFlags(args: string[], allowed: Set<string>): Map<string, string> {
  const multi = parseMultiFlags(args, allowed);
  const values = new Map<string, string>();
  for (const [flag, entries] of multi) {
    if (entries.length > 1) throw new Error(`task: ${flag} may be specified only once`);
    values.set(flag, entries[0]!);
  }
  return values;
}

function parseMultiFlags(args: string[], allowed: Set<string>): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === undefined || !allowed.has(flag)) throw new Error(`task: unknown argument "${flag ?? ""}"`);
    if (value === undefined || value.startsWith("--")) throw new Error(`task: ${flag} requires a value`);
    values.set(flag, [...(values.get(flag) ?? []), value]);
  }
  return values;
}

function required(values: Map<string, string>, flag: string, command: string): string {
  const value = values.get(flag);
  if (value === undefined) throw new Error(`${command}: ${flag} is required`);
  return value;
}

function requiredMulti(values: Map<string, string[]>, flag: string, command: string): string {
  const value = values.get(flag)?.[0];
  if (value === undefined) throw new Error(`${command}: ${flag} is required`);
  if ((values.get(flag)?.length ?? 0) > 1) throw new Error(`${command}: ${flag} may be specified only once`);
  return value;
}

function optional<K extends string>(values: Map<string, string>, flag: string, key: K): { [P in K]?: string } {
  const value = values.get(flag);
  return value !== undefined ? ({ [key]: value } as { [P in K]?: string }) : {};
}

function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

function enumValue<const T extends string>(
  values: Map<string, string[]>,
  flag: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const entries = values.get(flag);
  if (entries === undefined) return fallback;
  if (entries.length !== 1 || !allowed.includes(entries[0] as T)) {
    throw new Error(`task finish: ${flag} must be ${allowed.join(" | ")}`);
  }
  return entries[0] as T;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
