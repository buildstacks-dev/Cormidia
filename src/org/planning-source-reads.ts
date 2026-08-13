// Gate-observed read evidence for declared planning sources (B-31 / INV-017).
//
// Cormidia no longer reads the operator's files, so "was this evidence actually
// consumed?" can only be answered by watching what the turn did. This module is
// that observer, plus the gate narrowing that keeps reads inside the declared
// scope.
//
// Failure direction is deliberate: an unrecognized tool shape yields NO evidence,
// so the entry reconciles as `not_read`. Under-claiming is safe; over-claiming is
// the exact failure INV-017 exists to prevent.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { GateDecision, GateFn, ToolAction, TurnEvent } from "../runtime/types.js";
import type { PlanningSourceRead, PlanningSourceScope } from "./planning-inputs.js";

/** Argument keys the harnesses use for a file path on their read/view tools. */
const PATH_KEYS: readonly string[] = ["file_path", "filePath", "path", "target_file", "notebook_path", "absolute_path"];

const READ_TOOL_PATTERN = /^(read|view|read_file|view_image|open|cat|notebookread)/i;

export interface PlanningSourceReadObserver {
  onEvent: (event: TurnEvent) => void;
  /** Reads observed so far. Returns undefined when the turn produced no tool
   * events at all — an absent channel is `unobservable`, not "read nothing". */
  reads: () => PlanningSourceRead[] | undefined;
}

export function createPlanningSourceReadObserver(scope: PlanningSourceScope): PlanningSourceReadObserver {
  const declared = new Map(scope.entries.map((entry) => [entry.canonical_path, entry]));
  const observed = new Map<string, PlanningSourceRead>();
  let sawAnyToolEvent = false;
  return {
    onEvent: (event) => {
      if (event.type !== "tool_use") return;
      sawAnyToolEvent = true;
      if (event.name !== undefined && !READ_TOOL_PATTERN.test(event.name)) return;
      const path = extractPath(event.args);
      if (path === undefined) return;
      const canonical = resolve(path);
      if (!declared.has(canonical) || observed.has(canonical)) return;
      observed.set(canonical, {
        canonical_path: canonical,
        ...digestAtReadTime(canonical),
      });
    },
    reads: () => (sawAnyToolEvent ? [...observed.values()] : undefined),
  };
}

/** Narrow the gate so a planning turn reads inside its declared scope and its
 * workdir, and nowhere else. This TIGHTENS an existing gate — it can only turn
 * an allow into a deny, never the reverse (INV-015). */
export function withPlanningSourceScopeGate(
  gate: GateFn,
  input: { workdir: string; scope: PlanningSourceScope | undefined },
): GateFn {
  const roots = [
    resolve(input.workdir),
    ...(input.scope?.roots.flatMap((root) => (root.canonical_path === null ? [] : [root.canonical_path])) ?? []),
  ];
  return (action: ToolAction): GateDecision => {
    const decision = gate(action);
    if (!decision.allow) return decision;
    if (action.tool !== undefined && !READ_TOOL_PATTERN.test(action.tool)) return decision;
    const path = extractPath(action.input);
    if (path === undefined) return decision;
    const canonical = resolve(path);
    if (roots.some((root) => canonical === root || isInside(root, canonical))) return decision;
    return {
      allow: false,
      reason:
        `planning turns may read only the workdir and the operator's declared --source roots; ` +
        `${canonical} is outside every declared root`,
      escalate: false,
    };
  };
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

function extractPath(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const record: Partial<Record<string, unknown>> = args;
  for (const key of PATH_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

/** Hash what is on disk at the moment the turn read it. The declaration-time
 * size is compared against this by the reconciler, so a file edited mid-turn
 * reports `changed` rather than being recorded under bytes nobody saw. */
function digestAtReadTime(path: string): Pick<PlanningSourceRead, "read_sha256" | "read_bytes" | "outcome"> {
  try {
    const bytes = readFileSync(path);
    return {
      read_sha256: createHash("sha256").update(bytes).digest("hex"),
      read_bytes: bytes.byteLength,
      outcome: "read",
    };
  } catch {
    return { read_sha256: null, read_bytes: null, outcome: "unreadable" };
  }
}
