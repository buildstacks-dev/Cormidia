import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const efficiency = readFileSync(join(root, "docs/efficiency.md"), "utf8");
const purpose = readFileSync(join(root, "docs/PURPOSE.md"), "utf8");
const vision = readFileSync(join(root, "docs/VISION.md"), "utf8");
const architecture = readFileSync(join(root, "docs/architecture.md"), "utf8");
const loop = readFileSync(join(root, "docs/loop.md"), "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");
describe("ratified efficiency doctrine", () => {
  it("A-DOC-01 gives normative identities and measurements one canonical definition", () => {
    expect(efficiency.match(/<!-- efficiency-contract:start -->/g)).toHaveLength(1);
    for (const term of ["episode", "role invocation", "pass", "provider turn", "execution step", "mechanical step", "attempt", "active wall time", "Readiness states", "planned_route", "current_route", "final_route"]) {
      expect(efficiency.toLowerCase()).toContain(term.toLowerCase());
    }
    expect(efficiency).toMatch(/Organization-wide operating doctrine ratified 2026-07-13/);
    expect(purpose).toContain("organization-wide operating doctrine ratified");
    for (const [name, text] of [["PURPOSE", purpose], ["VISION", vision], ["README", readme], ["architecture", architecture], ["loop", loop]] as const) {
      expect(text, `${name} must link the canonical authority`).toContain("docs/efficiency.md");
      expect(identityConflicts(text), name).toEqual([]);
    }
  });
  it("A-DOC-02 has exactly one authoritative route-budget table", () => {
    expect(efficiency.match(/<!-- efficiency-budgets:start -->/g)).toHaveLength(1);
    expect(efficiency.match(/<!-- efficiency-budgets:end -->/g)).toHaveLength(1);
  });
  it("A-DOC-03 explicitly supersedes unconditional deep/60-minute defaults", () => {
    expect(purpose).toContain("superseded by the 2026-07-12 efficiency doctrine");
    expect(purpose).toMatch(/neither former default can override proportional\s+admission/);
    for (const [name, text] of [["architecture", architecture], ["loop", loop]] as const) {
      expect(activeDefaultViolations(text), name).toEqual([]);
    }
  });
  it("A-DOC-04 capabilities type every existing token-spending command", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", join(root, "src/cli.ts"), "capabilities", "--json"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(0);
    const capabilities = JSON.parse(result.stdout) as { commands: Array<{ command: string; spendsTokens: boolean }> };
    for (const command of ["plan", "loop", "dispatch", "run-role", "learn"]) {
      expect(capabilities.commands.find((entry) => entry.command === command)?.spendsTokens).toBe(true);
    }
  });
  it("A-DOC-05 traces every case requirement to the inventory and resolves task/grader links", () => {
    const inventory = parse(readFileSync(join(root, "eval/contracts.yaml"), "utf8")) as { contracts: Array<{ id: string }> };
    const ids = new Set(inventory.contracts.map((item) => item.id));
    for (const path of yamlFiles(join(root, "eval/cases"))) {
      const value = parse(readFileSync(path, "utf8")) as { requirements: string[]; episode: { task_ref: string }; oracle: { hidden_grader: string } };
      for (const id of value.requirements) expect(ids.has(id), `${path}: ${id}`).toBe(true);
      expect(existsSync(join(root, "eval", value.episode.task_ref)), path).toBe(true);
      expect(existsSync(join(root, "eval", value.oracle.hidden_grader)), path).toBe(true);
    }
  });
  it("A-DOC-01 near-miss does not confuse an explanatory use of turn with a second canonical identity", () => {
    expect(efficiency.match(/<!-- efficiency-contract:start -->/g)).toHaveLength(1);
    expect(efficiency.match(/<!-- efficiency-contract:end -->/g)).toHaveLength(1);
    expect(identityConflicts("A pass is not the provider-accounting identity; one pass may expose two provider turns.")).toEqual([]);
  });
  it("A-DOC-01 honest failure detects a duplicated canonical contract marker", () => {
    expect(() => oneMarker(`${efficiency}\n<!-- efficiency-contract:start -->`, "efficiency-contract")).toThrow("duplicate_canonical_marker");
    expect(identityConflicts("A pass is the provider-accounting identity. A mechanical step has one provider settlement.")).toHaveLength(2);
  });
  it("A-DOC-02 near-miss permits linked budget discussion outside the one authoritative table", () => {
    expect(oneMarker(efficiency, "efficiency-budgets")).toBe(true);
    expect(efficiency).toContain("Canonical route budgets");
  });
  it("A-DOC-02 honest failure rejects a second numeric budget authority marker", () => {
    expect(() => oneMarker(`${efficiency}\n<!-- efficiency-budgets:start -->`, "efficiency-budgets")).toThrow("duplicate_canonical_marker");
  });
  it("A-DOC-03 near-miss preserves historical defaults only when explicitly marked superseded", () => {
    expect(purpose).toMatch(/superseded by the 2026-07-12 efficiency doctrine[\s\S]{0,800}60 minutes/);
    expect(hasUnconditionalDefault("Historical decision: milestone planning used deep and the pass cap was 60 minutes. This is superseded and non-normative.")).toBe(false);
  });
  it("A-DOC-03 honest failure catches an unconditional active default fixture", () => {
    expect(hasUnconditionalDefault("Planner depth defaults to deep. Every pass has a 60-minute cap.")).toBe(true);
    expect(hasUnconditionalDefault("The former deep and 60-minute defaults are superseded.")).toBe(false);
  });
  it("A-DOC-04 near-miss reads the public machine capability surface and preserves token-free dry-run commands", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", join(root, "src/cli.ts"), "capabilities", "--json"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(0);
    const capabilities = JSON.parse(result.stdout) as { commands: Array<{ command: string; writes: boolean; spendsTokens: boolean }> };
    expect(capabilities.commands.find((entry) => entry.command === "report")).toMatchObject({ writes: false, spendsTokens: false });
    for (const command of ["plan", "loop", "dispatch", "run-role", "learn"]) expect(capabilities.commands.find((entry) => entry.command === command)?.spendsTokens).toBe(true);
  });
  it("A-DOC-04 honest failure rejects a mutating command without an explicit spending claim", () => {
    expect(validCapability({ command: "mystery", writes: true })).toBe(false);
  });
  it("A-DOC-05 near-miss allows a requirement to have several executable case links", () => {
    const manifests = yamlFiles(join(root, "eval/cases")).map((path) => parse(readFileSync(path, "utf8")) as { requirements: string[] });
    expect(manifests.filter((item) => item.requirements.includes("D-PLAN-01")).length).toBeGreaterThanOrEqual(1);
  });
  it("A-DOC-05 honest failure detects an unknown requirement and missing task/grader path fixture", () => {
    const ids = new Set((parse(readFileSync(join(root, "eval/contracts.yaml"), "utf8")) as { contracts: Array<{ id: string }> }).contracts.map((item) => item.id));
    expect(ids.has("UNKNOWN-01")).toBe(false);
    expect(existsSync(join(root, "eval/tasks/not-real.md"))).toBe(false);
    expect(existsSync(join(root, "eval/graders/not-real.ts"))).toBe(false);
  });
});

function oneMarker(text: string, name: string): true { const starts = text.match(new RegExp(`<!-- ${name}:start -->`, "g")) ?? []; const ends = text.match(new RegExp(`<!-- ${name}:end -->`, "g")) ?? []; if (starts.length !== 1 || ends.length !== 1) throw new Error("duplicate_canonical_marker"); return true; }
function activeDefaultViolations(text: string): string[] {
  const defaultPattern = /(?:defaults?\s+to\s+deep|milestone\s+planning\s+(?:uses|used|use|runs?)\s+(?:the\s+)?deep|(?:default|fallback|falls?\s+back|fell\s+back)\s+(?:is\s+|to\s+)?(?:\*\*)?60(?:-minute|\s+min(?:ute)?s?)|60-minute\s+cap)/i;
  const historicalQualifier = /(?:historical|superseded|legacy|non-normative|implementation gap|not active policy|not the active-time policy)/i;
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => defaultPattern.test(paragraph) && !historicalQualifier.test(paragraph));
}
function hasUnconditionalDefault(text: string): boolean { return activeDefaultViolations(text).length > 0; }
function identityConflicts(text: string): string[] {
  const patterns = [
    /\bpass\s+is\s+(?:the\s+)?provider-accounting identity\b/i,
    /\bmechanical step\s+(?:has|creates|joins? to)\s+(?:exactly\s+)?(?:one|a)\s+provider settlement\b/i,
  ];
  return patterns.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}
function validCapability(value: unknown): boolean { const item = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}; return typeof item.command === "string" && typeof item.writes === "boolean" && typeof item.spendsTokens === "boolean"; }

function yamlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => entry.isDirectory() ? yamlFiles(join(dir, entry.name)) : extname(entry.name) === ".yaml" ? [join(dir, entry.name)] : []);
}
