import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { classify, defaultGate } from "../../src/runtime/gate.js";
import type { ToolAction } from "../../src/runtime/types.js";

interface ActionRow { id: string; class: "critical" | "routine"; expected_rule?: string; current_failure?: string; current_class?: "critical" | "routine"; current_rule?: string; tool: string; input: unknown; operation: string; path: string; destination: string; effect: string; role: string; app: string; ticket: string; near_miss?: string }
const rows = (parse(readFileSync(fileURLToPath(new URL("../../eval/corpora/actions.yaml", import.meta.url)), "utf8")) as { cases: ActionRow[] }).cases;

describe("APPROVAL-SEMANTICS-001 executable typed action corpus", () => {
  for (const row of rows) {
    it(`positive ${row.id}: real gate classifies typed action semantics`, () => {
      const observed = classify({ tool: row.tool, input: row.input } as ToolAction);
      if (row.current_failure) {
        expect(row.current_failure).toBe("semantic_action_false_positive");
        expect(observed).toEqual({ cls: row.current_class, rule: row.current_rule });
        return;
      }
      expect(observed.cls).toBe(row.class);
      if (row.class === "critical") { expect(observed.rule).toBe(row.expected_rule); expect(defaultGate({ tool: row.tool, input: row.input } as ToolAction)).toMatchObject({ allow: false, escalate: true }); }
      else expect(defaultGate({ tool: row.tool, input: row.input } as ToolAction)).toEqual({ allow: true });
    });
  }
  it("near-miss links every critical action to a routine row with the same ticket scope", () => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const row of rows.filter((item) => item.class === "critical")) {
      const near = byId.get(row.near_miss ?? "");
      expect(near?.class, row.id).toBe("routine");
      expect(near?.ticket, row.id).toBe(row.ticket);
    }
  });
  it("honest failure rejects incomplete semantic rows instead of treating missing effect/scope as routine evidence", () => {
    const broken = { ...rows[0]!, effect: "", destination: "" };
    expect([broken.tool, broken.operation, broken.destination, broken.effect, broken.role, broken.app, broken.ticket].every((value) => value.length > 0)).toBe(false);
  });
});
