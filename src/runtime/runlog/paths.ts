// Run-record ids and path builders (build plan M2.4; docs/loop.md §9).
//
// One run record per executed pass, under the org runtime home:
//   runs/<app>/<runId>/{envelope.json,events.jsonl,brief.md,prompt.md,output.md,session.log}
// runId = YYYYMMDD-HHMMSS-<pipeline>-<pass> — chronologically sortable as a
// plain string; two passes minted in the same second differ by their
// pipeline/pass suffix.
//
// Pure functions only: the clock is a parameter (FakeClock-compatible; no
// Date.now() here) and nothing touches the filesystem — writers arrive with
// M2.5–M2.7.

import { join } from "node:path";

/** Path-safe id segment: anything outside [A-Za-z0-9-] collapses to a
 *  single dash (deterministically), so a pipeline/pass id can never smuggle
 *  a path separator into the run directory name. */
export function sanitizeIdPart(part: string): string {
  const cleaned = part.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (cleaned === "") {
    throw new Error(`runlog: id part "${part}" has no path-safe characters`);
  }
  return cleaned;
}

/** `YYYYMMDD-HHMMSS-<pipeline>-<pass>` in UTC (docs/loop.md §9). */
export function mintRunId(now: Date, pipeline: string, pass: string): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  const stamp =
    `${p(now.getUTCFullYear(), 4)}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  return `${stamp}-${sanitizeIdPart(pipeline)}-${sanitizeIdPart(pass)}`;
}

export const RUN_ID_RE = /^\d{8}-\d{6}-[A-Za-z0-9-]+-[A-Za-z0-9-]+$/;

export interface RunPaths {
  dir: string;
  /** L1 — ids, status, rollups, gate results, truncated previews. */
  envelope: string;
  /** L2 — append-only structured events. */
  events: string;
  /** L3 — exact assembled brief, verbatim. */
  brief: string;
  /** L3 — exact runtime input (brief + pass template), verbatim. */
  prompt: string;
  /** L3 — final output text. */
  output: string;
  /** L3 — full transcript, fed by TurnHooks.onEvent. */
  sessionLog: string;
}

export function runDir(root: string, app: string, runId: string): string {
  return join(root, "runs", app, runId);
}

export function runPaths(root: string, app: string, runId: string): RunPaths {
  const dir = runDir(root, app, runId);
  return {
    dir,
    envelope: join(dir, "envelope.json"),
    events: join(dir, "events.jsonl"),
    brief: join(dir, "brief.md"),
    prompt: join(dir, "prompt.md"),
    output: join(dir, "output.md"),
    sessionLog: join(dir, "session.log"),
  };
}
