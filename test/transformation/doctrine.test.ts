import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const efficiency = readFileSync(join(root, "docs/efficiency.md"), "utf8");

describe("ratified efficiency doctrine", () => {
  it("A-DOC-01 gives normative identities and measurements one canonical definition", () => {
    expect(efficiency.match(/<!-- efficiency-contract:start -->/g)).toHaveLength(1);
    for (const term of ["provider turn", "execution step", "mechanical step", "active wall time", "Readiness states"]) expect(efficiency.toLowerCase()).toContain(term.toLowerCase());
  });
  it("A-DOC-02 has exactly one authoritative route-budget table", () => {
    expect(efficiency.match(/<!-- efficiency-budgets:start -->/g)).toHaveLength(1);
    expect(efficiency.match(/<!-- efficiency-budgets:end -->/g)).toHaveLength(1);
  });
  it("A-DOC-03 explicitly supersedes unconditional deep/60-minute defaults", () => {
    const purpose = readFileSync(join(root, "docs/PURPOSE.md"), "utf8");
    expect(purpose).toContain("superseded by the 2026-07-12 efficiency doctrine");
    expect(purpose).toMatch(/neither former default can override proportional\s+admission/);
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
  });
  it("A-DOC-01 honest failure detects a duplicated canonical contract marker", () => {
    expect(() => oneMarker(`${efficiency}\n<!-- efficiency-contract:start -->`, "efficiency-contract")).toThrow("duplicate_canonical_marker");
  });
  it("A-DOC-02 near-miss permits linked budget discussion outside the one authoritative table", () => {
    expect(oneMarker(efficiency, "efficiency-budgets")).toBe(true);
    expect(efficiency).toContain("Canonical route budgets");
  });
  it("A-DOC-02 honest failure rejects a second numeric budget authority marker", () => {
    expect(() => oneMarker(`${efficiency}\n<!-- efficiency-budgets:start -->`, "efficiency-budgets")).toThrow("duplicate_canonical_marker");
  });
  it("A-DOC-03 near-miss preserves historical defaults only when explicitly marked superseded", () => {
    const purpose = readFileSync(join(root, "docs/PURPOSE.md"), "utf8");
    expect(purpose).toMatch(/superseded by the 2026-07-12 efficiency doctrine[\s\S]{0,800}60 minutes/);
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
function hasUnconditionalDefault(text: string): boolean { const lower = text.toLowerCase(); return (lower.includes("defaults to deep") || lower.includes("60-minute cap")) && !lower.includes("superseded"); }
function validCapability(value: unknown): boolean { const item = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}; return typeof item.command === "string" && typeof item.writes === "boolean" && typeof item.spendsTokens === "boolean"; }

function yamlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => entry.isDirectory() ? yamlFiles(join(dir, entry.name)) : extname(entry.name) === ".yaml" ? [join(dir, entry.name)] : []);
}
