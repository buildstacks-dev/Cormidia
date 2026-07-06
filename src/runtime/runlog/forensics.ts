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

/** session.log sink for TurnHooks.onEvent — one line per TurnEvent, in
 *  arrival order. Synchronous appends: onEvent is a sync void callback and
 *  a transcript with holes is worse than a briefly-blocked writer. */
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
