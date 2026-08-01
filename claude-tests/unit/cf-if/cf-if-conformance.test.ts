// CF-IF-CLI / JSON / SKILL — command-surface conformance at pure/local seams.

import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { cmdApp, parseAppVerifyArgs } from "../../../src/cli/app.js";
import { cmdCapabilities } from "../../../src/cli/context-info.js";
import { runJsonCliCommand } from "../../../src/cli/json-failure.js";
import { parseReportArgs } from "../../../src/cli/report.js";
import { NoActiveOrgError } from "../../../src/org/home.js";
import { canonicalValue, stableJson } from "../../../src/org/lifecycle.js";

async function captured<T>(run: () => Promise<T>): Promise<{ value: T; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => out.push(parts.map(String).join(" ")));
  const error = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => err.push(parts.map(String).join(" ")));
  try {
    return { value: await run(), out, err };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

describe("CF-IF-CLI / CF-IF-JSON — parsing, failures, confirmation, and canonical JSON", () => {
  it("JSON mode replaces partial stdout/stderr with one stable no_active_org failure document", async () => {
    const result = await captured(() => runJsonCliCommand("status", async () => {
      console.log("partial prose that must be discarded");
      console.error("partial stderr that must be discarded");
      throw new NoActiveOrgError();
    }));
    expect(result.value).toBe(1);
    expect(result.err).toEqual([]);
    expect(result.out).toHaveLength(1);
    expect(JSON.parse(result.out[0]!)).toEqual({
      schema_version: 1,
      ok: false,
      error: {
        code: "no_active_org",
        message: "no active org home",
        remediation: expect.stringContaining("operon org init"),
      },
    });
    expect(result.out[0]).not.toContain("partial prose");
  });

  it("subcommand parsers reject unknown/missing values and destructive execution requires exact confirmation before home resolution", async () => {
    expect(() => parseAppVerifyArgs([])).toThrow(/app-name.*required/);
    expect(() => parseAppVerifyArgs(["alpha", "--bogus"])).toThrow(/unknown flag/);
    expect(() => parseReportArgs(["--period", "forever"])).toThrow(/7d\|30d\|90d\|1y\|all/);
    expect(() => parseReportArgs(["--open"])).toThrow(/requires --html/);
    await expect(cmdApp(["reset", "alpha", "--execute", "--confirm", "beta"]))
      .rejects.toThrow(/--confirm alpha/);
  });

  it("canonical JSON sorts object keys recursively while preserving array order", () => {
    const input = { z: { b: 2, a: 1 }, a: [{ y: 2, x: 1 }, "tail"] };
    expect(canonicalValue(input)).toEqual({ a: [{ x: 1, y: 2 }, "tail"], z: { a: 1, b: 2 } });
    expect(stableJson(input)).toBe(stableJson({ a: [{ x: 1, y: 2 }, "tail"], z: { a: 1, b: 2 } }));
  });

  it("capabilities marks token-spending commands and states their token-free preview exception", async () => {
    const capture = await captured(() => cmdCapabilities(["--json"]));
    const data = JSON.parse(capture.out.join("\n")) as { commands: Array<{ command: string; spendsTokens: boolean; summary: string }> };
    for (const command of ["plan", "loop", "dispatch", "run-role"]) {
      const row = data.commands.find((candidate) => candidate.command === command)!;
      expect(row.spendsTokens).toBe(true);
      expect(row.summary).toMatch(/dry-run.*token-free/i);
    }
    expect(data.commands.find((row) => row.command === "report")).toMatchObject({ spendsTokens: false });
    expect(data.commands.find((row) => row.command === "observe")).toMatchObject({ spendsTokens: false });
  });
});

describe("CF-IF-SKILL — packaged Operon skill discovers only real CLI command families", () => {
  it("every operon command shown by the skill maps to the runtime capability catalog", async () => {
    const capture = await captured(() => cmdCapabilities(["--json"]));
    const catalog = JSON.parse(capture.out.join("\n")) as { commands: Array<{ command: string }> };
    const prefixes = catalog.commands.map((row) => row.command).sort((a, b) => b.length - a.length);
    const skill = await readFile("agent-skills/operon/SKILL.md", "utf8");
    const examples = [...skill.matchAll(/^operon\s+([^\n]+)$/gm)].map((match) => match[1]!.trim());
    expect(examples.length).toBeGreaterThan(10);
    const unknown = examples.filter((example) => {
      const words = example.replace(/<[^>]+>|\[[^\]]+\]|\.{3}/g, "value");
      return !prefixes.some((prefix) => words === prefix || words.startsWith(`${prefix} `));
    });
    expect(unknown).toEqual([]);
  });
});
