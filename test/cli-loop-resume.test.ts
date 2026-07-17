// L-005: `operon loop --resume-episode <id>` is a read-only PREVIEW of the
// durable resume plan — it must not silently look like it executed. This pins
// that it prints an explicit `preview: true` plan on stdout, a plain-language
// "read-only preview, does not execute" note on stderr, and mutates no state.
// Uses the repo root as a valid org home and a temp state home; no network,
// auth, real org state, or live wall clock is required.

import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cmdLoop } from "../src/cli/loop.js";
import { initializeExecutionJournal } from "../src/loop/execution-journal.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const NOW = new Date("2026-07-17T00:00:00Z");

describe("operon loop --resume-episode (L-005 preview)", () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it("prints an explicit preview plan and states plainly that it does not execute", async () => {
    const state = mkdtempSync(join(tmpdir(), "operon-resume-cli-"));
    await initializeExecutionJournal({ root: state, episodeId: "episode", app: "app", ticketRef: "#1", now: NOW });

    const before = snapshot(state);
    const out: string[] = [];
    const err: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...parts: unknown[]): void => void out.push(parts.join(" "));
    console.error = (...parts: unknown[]): void => void err.push(parts.join(" "));
    restore = () => {
      console.log = originalLog;
      console.error = originalError;
    };

    const code = await cmdLoop(["--org-home", ROOT, "--state-home", state, "--resume-episode", "episode"]);
    restore();
    restore = undefined;

    expect(code).toBe(0);
    // stdout is parseable JSON that flags itself as a preview, carrying the plan.
    const parsed = JSON.parse(out.join("\n")) as { preview: boolean; resume: { nextBoundary: unknown } };
    expect(parsed.preview).toBe(true);
    expect(parsed.resume).toHaveProperty("nextBoundary");
    // stderr says plainly this is read-only and how to actually continue.
    const stderr = err.join("\n");
    expect(stderr).toContain("read-only preview");
    expect(stderr).toContain("does not execute");
    expect(stderr).toContain("operon loop --app");
    // The preview mutated nothing under the state home.
    expect(snapshot(state)).toEqual(before);
  });
});

function snapshot(dir: string): string[] {
  const entries: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(current, entry.name), rel);
      else entries.push(rel);
    }
  };
  walk(dir, "");
  return entries;
}
