// Weekly retro reporting (docs/architecture.md §6).
//
// Memory curation (runRetroCuration) was retired with learning-loop M1
// (issue #34): its destructive dedupe/delete was ungated, it was never wired
// to any runtime path, and curation authority now belongs to the governed
// learning loop (docs/learning-loop/ design §7.1). Its one good idea — skill
// drafts from recurring keywords — is recorded there for the M6 distiller's
// skill_draft destination.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { analyzeRunlogs } from "../runtime/runlog/anomalies.js";
import { readScorecards } from "./scorecards.js";

export interface RetroOptions {
  orgHome: string;
  /** High-churn telemetry/runlog root. Defaults to orgHome for callers from
   * before the packaging boundary was made explicit. */
  stateHome?: string;
  date: string;
  apps: string[];
  roles: string[];
}

export interface RetroResult {
  path: string;
  content: string;
}

export interface TelemetryRecord {
  at: string;
  app?: string;
  role: string;
  status: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  wallClockMs?: number;
}

export async function runRetro(options: RetroOptions): Promise<RetroResult> {
  const stateHome = options.stateHome ?? options.orgHome;
  const window = retroWindow(options.date);
  const telemetry = (await readTelemetry(stateHome)).filter((row) => inWindow(row.at, window));
  const anomalies = await analyzeRunlogs(stateHome).catch(() => []);
  const sections: string[] = [`# Retro ${options.date}`, "", `Window: ${window.start} through ${window.end}`, ""];

  for (const app of options.apps) {
    for (const role of options.roles) {
      const turns = telemetry.filter((row) => row.app === app && row.role === role);
      const scores = (await readScorecards(stateHome, app, role, new Date(window.start))).filter((event) =>
        inWindow(event.timestamp, window),
      );
      if (turns.length === 0 && scores.length === 0) continue;
      sections.push(`## ${app} / ${role}`, "");
      sections.push(`Turns: ${turns.length}`);
      sections.push(`Failures: ${turns.filter((row) => row.status === "failed").length}`);
      sections.push(`Cost: $${sum(turns.map((row) => row.costUsd ?? 0)).toFixed(2)}`);
      sections.push(
        `Tokens: ${sum(turns.map((row) => row.tokensIn ?? 0))} in / ${sum(turns.map((row) => row.tokensOut ?? 0))} out`,
      );
      sections.push(`Scorecard events: ${scores.length}`);
      for (const [kind, count] of counts(scores.map((score) => score.type))) {
        sections.push(`- ${kind}: ${count}`);
      }
      const appAnomalies = anomalies.filter((flag) => flag.app === app);
      sections.push(`Anomaly flags: ${appAnomalies.length}`);
      for (const flag of appAnomalies) {
        sections.push(`- ${flag.flag}: ${flag.recommendation}`);
      }
      sections.push("");
    }
  }

  if (sections[sections.length - 1] !== "") sections.push("");
  const content = `${sections.join("\n").trimEnd()}\n`;
  const path = join(options.orgHome, "retro", `${options.date}.md`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return { path, content };
}

async function readTelemetry(orgHome: string): Promise<TelemetryRecord[]> {
  const dir = join(orgHome, "telemetry");
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl")).sort();
  const rows: TelemetryRecord[] = [];
  for (const file of files) {
    const raw = await readFile(join(dir, file), "utf8");
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      try {
        rows.push(JSON.parse(line) as TelemetryRecord);
      } catch {
        // Torn trailing append — skip the line, never the retro.
      }
    }
  }
  return rows;
}

function retroWindow(date: string): { start: string; end: string } {
  const end = new Date(`${date}T23:59:59.999Z`);
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function inWindow(timestamp: string, window: { start: string; end: string }): boolean {
  const time = new Date(timestamp).getTime();
  return time >= new Date(window.start).getTime() && time <= new Date(window.end).getTime();
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function counts(values: readonly string[]): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
