import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const required = [
  "B-ADM-01", "B-ADM-02", "B-ADM-03", "B-ADM-04", "B-ADM-05",
  "B-MET-01", "B-MET-02", "B-MET-03", "B-MET-04", "B-RPT-01", "B-RPT-02",
];

describe("Phase 1 Workstream B promotion", () => {
  it.each(required)("%s names executable required evidence instead of a synthetic CLI-token red", (id) => {
    const registry = parse(readFileSync("eval/contracts.yaml", "utf8")) as {
      contracts: Array<{ id: string; state: string; evidence: string }>;
    };
    const contract = registry.contracts.find((item) => item.id === id);
    expect(contract).toMatchObject({ state: "required" });
    expect(contract?.evidence).toMatch(/^test\/(efficiency|report)\//);
  });
});
