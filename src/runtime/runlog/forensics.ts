// L3 forensics writers (build plan M2.7; docs/loop.md §9).
//
// L3 is the verbatim layer: exact assembled brief, final output text, full
// transcript. Local-only, UNREDACTED by design — reproducibility beats
// tidiness here, and nothing in L3 is ever exported (redaction is a
// precondition for export and applies to L1/L2; L3 stays on disk under
// `session_retention_days` and is pruned by retention.ts).

import { appendFileSync, mkdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TurnEvent } from "../types.js";
import { runPaths } from "./paths.js";

/** brief.md — the exact assembled brief, byte-for-byte (§3: briefs are
 *  logged verbatim so every pass is reproducible). */
export async function writeBrief(
  root: string,
  app: string,
  runId: string,
  brief: string,
): Promise<void> {
  const path = runPaths(root, app, runId).brief;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, brief, "utf8");
}

/** prompt.md — the exact Runtime.runTurn task, including the versioned pass
 * template appended after the assembled brief. This is distinct from
 * brief.md so both planning input and executable protocol remain auditable. */
export async function writePrompt(
  root: string,
  app: string,
  runId: string,
  prompt: string,
): Promise<void> {
  const path = runPaths(root, app, runId).prompt;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, prompt, "utf8");
}

/** output.md — the pass's final output text, verbatim. */
export async function writeOutput(
  root: string,
  app: string,
  runId: string,
  output: string,
): Promise<void> {
  const path = runPaths(root, app, runId).output;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, output, "utf8");
}

/** session.log activity sink for TurnHooks.onEvent — one line per structured
 * runtime event in arrival order. This is NOT a full model transcript; the
 * envelope records transcript availability separately. Synchronous appends:
 * onEvent is a sync void callback and an activity log with holes is worse
 * than a briefly-blocked writer. */
export function createSessionLogSink(
  root: string,
  app: string,
  runId: string,
): (e: TurnEvent) => void {
  const path = runPaths(root, app, runId).sessionLog;
  mkdirSync(dirname(path), { recursive: true });
  return (e: TurnEvent): void => {
    appendFileSync(path, `[${e.type}] ${e.detail}\n`, "utf8");
  };
}
