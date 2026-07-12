import { existsSync, readFileSync, readdirSync } from "node:fs";
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
    const capabilities = readFileSync(join(root, "src/cli/context-info.ts"), "utf8");
    for (const command of ["plan", "loop", "dispatch", "run-role", "learn"]) {
      expect(capabilities).toContain(`command: "${command}"`);
      const after = capabilities.slice(capabilities.indexOf(`command: "${command}"`), capabilities.indexOf(`command: "${command}"`) + 260);
      expect(after).toContain("spendsTokens: true");
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
});

function yamlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => entry.isDirectory() ? yamlFiles(join(dir, entry.name)) : extname(entry.name) === ".yaml" ? [join(dir, entry.name)] : []);
}
