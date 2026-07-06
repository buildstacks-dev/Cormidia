// Human dashboard over L1 envelopes + L2 events only (docs/loop.md §9).

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readEvents } from "./events.js";
import type { RunEnvelope } from "./envelope.js";

export interface StatusRow {
  runId: string;
  app: string;
  pipeline: string;
  pass: string;
  status: string;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  escalations: number;
  startedAt: string;
}

export async function readStatusRows(
  root: string,
  options: { app?: string; limit?: number } = {},
): Promise<StatusRow[]> {
  const runsRoot = join(root, "runs");
  if (!existsSync(runsRoot)) return [];
  const apps = options.app !== undefined ? [options.app] : await childDirs(runsRoot);
  const rows: StatusRow[] = [];

  for (const app of apps) {
    const appDir = join(runsRoot, app);
    if (!existsSync(appDir)) continue;
    for (const runId of await childDirs(appDir)) {
      const envelope = await readEnvelopeFile(join(appDir, runId, "envelope.json")).catch(() => undefined);
      if (envelope === undefined) continue;
      const events = await readEvents(root, app, runId).catch(() => []);
      rows.push({
        runId,
        app,
        pipeline: envelope.pipeline,
        pass: envelope.pass,
        status: statusLabel(envelope),
        durationMs: envelope.wall_clock_ms ?? 0,
        tokensIn: envelope.usage?.tokens_in ?? 0,
        tokensOut: envelope.usage?.tokens_out ?? 0,
        costUsd: envelope.usage?.cost_usd ?? 0,
        escalations: events.filter((event) => event.event === "escalation.raised").length,
        startedAt: envelope.started_at,
      });
    }
  }

  rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.runId.localeCompare(a.runId));
  return options.limit === undefined ? rows : rows.slice(0, options.limit);
}

export function formatStatusRows(rows: readonly StatusRow[]): string {
  const header = "RUN ID                         APP        PIPE/PASS                 STATUS                 DUR     TOKENS     COST   ESC";
  const lines = rows.map((row) => {
    const pipePass = `${row.pipeline}/${row.pass}`;
    const tokens = `${row.tokensIn}/${row.tokensOut}`;
    return [
      row.runId.padEnd(30),
      row.app.padEnd(10),
      pipePass.padEnd(25),
      row.status.padEnd(22),
      formatDuration(row.durationMs).padStart(7),
      tokens.padStart(10),
      `$${row.costUsd.toFixed(2)}`.padStart(8),
      String(row.escalations).padStart(5),
    ].join(" ");
  });
  return [header, ...lines].join("\n");
}

function statusLabel(envelope: RunEnvelope): string {
  if (envelope.status === "failed") return `failed(${envelope.error_code ?? "error_unknown"})`;
  return envelope.status;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

async function childDirs(path: string): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function readEnvelopeFile(path: string): Promise<RunEnvelope> {
  return JSON.parse(await readFile(path, "utf8")) as RunEnvelope;
}
