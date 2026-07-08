// Tests runlog id and path helpers in src/runtime/runlog/paths.ts.
// Covers UTC run-id formatting, chronological sorting, path-safe sanitization,
// empty-part rejection, and the standard run directory file layout.
// Uses inline dates and strings only; no filesystem state, network, auth, or
// live wall clock is required.

import { sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  mintRunId,
  RUN_ID_RE,
  runDir,
  runPaths,
  sanitizeIdPart,
} from "../src/runtime/runlog/paths.js";

const T0 = new Date(Date.UTC(2026, 6, 5, 9, 30, 15)); // 2026-07-05 09:30:15Z

describe("mintRunId", () => {
  it("formats YYYYMMDD-HHMMSS-<pipeline>-<pass> in UTC", () => {
    const id = mintRunId(T0, "build", "implement");
    expect(id).toBe("20260705-093015-build-implement");
    expect(id).toMatch(RUN_ID_RE);
  });

  it("same-second different-pass ids differ; ids sort chronologically", () => {
    const contract = mintRunId(T0, "build", "contract");
    const implement = mintRunId(T0, "build", "implement");
    expect(contract).not.toBe(implement);

    const later = mintRunId(new Date(T0.getTime() + 61_000), "build", "contract");
    const evenLater = mintRunId(new Date(Date.UTC(2026, 6, 6, 0, 0, 0)), "review", "verify");
    // Plain string sort == chronological order (§9: "chronologically sortable").
    expect([evenLater, later, contract].sort()).toEqual([contract, later, evenLater]);
  });

  it("path-unsafe id parts sanitize deterministically; empty parts throw", () => {
    expect(mintRunId(T0, "we!rd/pipe", "pass one")).toBe("20260705-093015-we-rd-pipe-pass-one");
    expect(sanitizeIdPart("../../etc"), "dots and slashes collapse").toBe("etc");
    expect(() => sanitizeIdPart("///")).toThrow(/no path-safe characters/);
  });
});

describe("run path builders", () => {
  it("builds the five §9 files under runs/<app>/<runId>/", () => {
    const id = mintRunId(T0, "build", "implement");
    const paths = runPaths("/org/home", "civic", id);
    const dir = ["", "org", "home", "runs", "civic", id].join(sep);

    expect(runDir("/org/home", "civic", id)).toBe(dir);
    expect(paths.dir).toBe(dir);
    expect(paths.envelope).toBe(`${dir}${sep}envelope.json`);
    expect(paths.events).toBe(`${dir}${sep}events.jsonl`);
    expect(paths.brief).toBe(`${dir}${sep}brief.md`);
    expect(paths.output).toBe(`${dir}${sep}output.md`);
    expect(paths.sessionLog).toBe(`${dir}${sep}session.log`);
  });
});
