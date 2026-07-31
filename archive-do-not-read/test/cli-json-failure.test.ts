import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonCliFailure, runJsonCliCommand } from "../src/cli/json-failure.js";
import { NoActiveOrgError } from "../src/org/home.js";

afterEach(() => vi.restoreAllMocks());

describe("top-level JSON failure transaction", () => {
  it("discards partial stdout and stderr before emitting one failure document", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const stdoutWrite = process.stdout.write;
    const stderrWrite = process.stderr.write;
    vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      stdout.push(values.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => {
      stderr.push(values.map(String).join(" "));
    });

    const code = await runJsonCliCommand("context", () => {
      console.log('{"partial":true}');
      console.error("partial diagnostic");
      process.stdout.write('{"rawPartial":true}\n');
      process.stderr.write("raw partial diagnostic\n");
      throw new NoActiveOrgError();
    });

    expect(code).toBe(1);
    expect(stderr).toEqual([]);
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0]!)).toEqual(jsonCliFailure(new NoActiveOrgError(), "context"));
    expect(stdout[0]).not.toContain("partial");
    expect(process.stdout.write).toBe(stdoutWrite);
    expect(process.stderr.write).toBe(stderrWrite);
  });

  it("replays successful output without wrapping it", async () => {
    const stdout: string[] = [];
    const stdoutWrite = process.stdout.write;
    const stderrWrite = process.stderr.write;
    vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      stdout.push(values.map(String).join(" "));
    });

    const code = await runJsonCliCommand("context", () => {
      console.log('{"ok":true}');
      return 0;
    });

    expect(code).toBe(0);
    expect(stdout).toEqual(['{"ok":true}']);
    expect(process.stdout.write).toBe(stdoutWrite);
    expect(process.stderr.write).toBe(stderrWrite);
  });
});
