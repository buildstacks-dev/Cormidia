import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { decidePlanningDepth, type PlanningDepthInput } from "../../src/org/planning-depth.js";

interface RouteRow { id: string; expected: "quick" | "standard" | "deep"; blast_radius: "low" | "medium" | "high"; reversibility: "reversible" | "difficult" | "irreversible"; sensitive_domains: string[]; uncertainty: "low" | "medium" | "high"; release_consequence: string; prose_variant?: string; components?: number; external_systems?: number; repeated_keywords?: string[] }
const rows = (parse(readFileSync(fileURLToPath(new URL("../../eval/corpora/routing.yaml", import.meta.url)), "utf8")) as { cases: RouteRow[] }).cases;

describe("ROUTE-CORPUS-001 executes the reviewed table against the production planning boundary", () => {
  it("positive baseline records the exact semantic mismatches instead of treating inventory as execution", () => {
    const mismatches = rows.flatMap((row) => decidePlanningDepth(input(row)).depth === row.expected ? [] : [row.id]);
    expect(mismatches).toEqual(["r04", "r15"]);
  });
  it("near-miss metamorphic variants ignore length, repeated keywords metadata, and role availability", () => {
    for (const [left, right] of [["r12", "r13"], ["r01", "r14"], ["r01", "r31"]]) {
      const a = rows.find((row) => row.id === left)!; const b = rows.find((row) => row.id === right)!;
      expect(decidePlanningDepth(input(a)).depth).toBe(decidePlanningDepth(input(b)).depth);
    }
  });
  it("honest failure exposes prose-about-deploy/auth keyword inflation as product debt", () => {
    for (const id of ["r04"]) {
      const row = rows.find((item) => item.id === id)!;
      expect(row.expected).toBe("quick");
      expect(decidePlanningDepth(input(row)).depth).toBe("deep");
    }
  });
});

function input(row: RouteRow): PlanningDepthInput {
  const consequence = row.release_consequence === "production" || row.release_consequence === "migration" ? "customer-public-production" : row.release_consequence === "none" ? "none" : "internal";
  const count = Math.max(row.components ?? 1, row.external_systems ?? 0);
  return {
    goal: row.prose_variant ?? `Reviewed structured route case ${row.id}`,
    stage: "mature",
    riskTier: row.blast_radius,
    ambiguity: row.uncertainty,
    coupling: count >= 4 ? "high" : count >= 2 ? "medium" : "low",
    reversibility: row.reversibility === "difficult" ? "costly-to-reverse" : row.reversibility,
    externalConsequence: consequence,
    expectedTickets: count >= 7 ? "7+" : count >= 3 ? "3-6" : "1-2",
    sensitiveDomains: row.sensitive_domains,
  };
}
