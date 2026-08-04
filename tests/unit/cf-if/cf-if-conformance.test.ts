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
        remediation: expect.stringContaining("cormidia org init"),
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

describe("CF-IF-SKILL — packaged Cormidia skill discovers only real CLI command families", () => {
  it("every cormidia command shown by the skill maps to the runtime capability catalog", async () => {
    const capture = await captured(() => cmdCapabilities(["--json"]));
    const catalog = JSON.parse(capture.out.join("\n")) as { commands: Array<{ command: string }> };
    const prefixes = catalog.commands.map((row) => row.command).sort((a, b) => b.length - a.length);
    const skill = await readFile("agent-skills/cormidia/SKILL.md", "utf8");
    const examples = [...skill.matchAll(/^cormidia\s+([^\n]+)$/gm)].map((match) => match[1]!.trim());
    expect(examples.length).toBeGreaterThan(10);
    const unknown = examples.filter((example) => {
      const words = example.replace(/<[^>]+>|\[[^\]]+\]|\.{3}/g, "value");
      return !prefixes.some((prefix) => words === prefix || words.startsWith(`${prefix} `));
    });
    expect(unknown).toEqual([]);
  });
});

// CF-IF-SKILL (self-hosting half) — "self-hosting and human-approved-release
// agreement across PURPOSE, developer policy, root instructions, and packaged
// skill" per case-catalog.md §6. docs/PURPOSE.md is the decision log (AGENTS.md
// § Scope: on conflict its Decided section wins and the other file is stale),
// so this asserts the dependent surfaces have not drifted behind it. Deposited
// because they had: AGENTS.md carried a sequencing carve-out PURPOSE dropped,
// and SKILL.md — the packaged guide shipped to users — still prohibited
// self-hosting outright.

const SELF_HOSTING_POLICY_PATHS = [
  "docs/PURPOSE.md",
  "docs/DEVELOPMENT.md",
  "docs/approvals/design.md",
  "docs/architecture.md",
  "AGENTS.md",
  "agent-skills/cormidia/SKILL.md",
] as const;

/** Prohibitions PURPOSE v2.11+ retired. Any survivor is stale policy. */
const STALE_SELF_HOSTING_CLAIMS = [
  "Cormidia does not operate an org whose job is to build or maintain Cormidia",
  "Cormidia must not operate an org whose job is to build or maintain Cormidia",
  "Do not turn the Cormidia repository into an app managed by a Cormidia org",
  "platform source repo only after the public app has proven the loop",
] as const;

/** The boundary every operating surface must state in the same terms. */
const UNIFORM_BOUNDARY = "requires explicit human approval";

const BOUNDARY_BEARING_PATHS = ["docs/DEVELOPMENT.md", "AGENTS.md", "agent-skills/cormidia/SKILL.md"] as const;

const PURPOSE_CONTRACT = [
  "may register, onboard, and operate both repositories as apps",
  "every release-shaped action for every app",
  UNIFORM_BOUNDARY,
  "Cormidia may execute only the exact approved action",
] as const;

function assertSelfHostingPolicy(docs: ReadonlyMap<string, string>): void {
  // Whitespace-normalized: these phrases wrap across lines in prose.
  const normalized = new Map([...docs].map(([path, source]) => [path, source.replace(/\s+/g, " ")]));

  for (const [path, source] of normalized) {
    for (const claim of STALE_SELF_HOSTING_CLAIMS) {
      if (source.includes(claim)) throw new Error(`stale self-hosting prohibition in ${path}: ${claim}`);
    }
  }

  const purpose = normalized.get("docs/PURPOSE.md") ?? "";
  for (const required of PURPOSE_CONTRACT) {
    if (!purpose.includes(required)) throw new Error(`PURPOSE self-hosting contract is missing: ${required}`);
  }

  for (const path of BOUNDARY_BEARING_PATHS) {
    if (!(normalized.get(path) ?? "").includes(UNIFORM_BOUNDARY)) {
      throw new Error(`${path} does not carry the uniform human-approved release boundary`);
    }
  }
}

describe("CF-IF-SKILL — policy corpus agrees on the self-hosting release boundary", () => {
  const load = async (): Promise<Map<string, string>> =>
    new Map(
      await Promise.all(
        SELF_HOSTING_POLICY_PATHS.map(async (path) => [path, await readFile(path, "utf8")] as const),
      ),
    );

  it("no surface contradicts PURPOSE, and every operating surface states the same approval boundary", async () => {
    const docs = await load();
    expect(() => assertSelfHostingPolicy(docs)).not.toThrow();
  });

  // Negative controls — a detector that has never fired is an assumption.
  it("rejects a reintroduced stale prohibition", async () => {
    const seeded = await load();
    seeded.set(
      "agent-skills/cormidia/SKILL.md",
      `${seeded.get("agent-skills/cormidia/SKILL.md")}\n${STALE_SELF_HOSTING_CLAIMS[2]}\n`,
    );
    expect(() => assertSelfHostingPolicy(seeded)).toThrow(/stale self-hosting prohibition/);
  });

  // These phrases wrap across lines in the real files, so the seed must be
  // applied to the same whitespace-normalized form the assertion reads.
  // Normalization is idempotent, so re-normalizing inside the assertion is safe.
  const flat = (source: string): string => source.replace(/\s+/g, " ");

  it("rejects an operating surface that drops the approval boundary", async () => {
    const seeded = await load();
    seeded.set("AGENTS.md", flat(seeded.get("AGENTS.md") ?? "").replaceAll(UNIFORM_BOUNDARY, "is fine"));
    expect(() => assertSelfHostingPolicy(seeded)).toThrow(/uniform human-approved release boundary/);
  });

  it("rejects a PURPOSE that loses a contract clause", async () => {
    const seeded = await load();
    seeded.set("docs/PURPOSE.md", flat(seeded.get("docs/PURPOSE.md") ?? "").replaceAll(PURPOSE_CONTRACT[0], "x"));
    expect(() => assertSelfHostingPolicy(seeded)).toThrow(/PURPOSE self-hosting contract is missing/);
  });
});
