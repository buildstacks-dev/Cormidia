// Focused `operon roles` rendering coverage. The fixture distinguishes an
// inherited cap from an explicit cap with the same numeric value so neither
// the human table nor the stable JSON projection can infer provenance by
// comparing numbers.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { cmdRoles } from "../src/cli/roles.js";

let directory: string;
let rolesPath: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "operon-cli-roles-"));
  rolesPath = join(directory, "roles.yaml");
  const role = (maxTurnBudgetUsd?: number) => ({
    runtime: "codex",
    model: "gpt-5.6-sol",
    effort: "high",
    delegation: { allow: [] },
    triggers: [{ event: "ticket-ready" }],
    outputs: ["pr"],
    ...(maxTurnBudgetUsd === undefined ? {} : { max_turn_budget_usd: maxTurnBudgetUsd }),
  });
  await writeFile(
    rolesPath,
    stringify({
      defaults: { max_turn_budget_usd: 5 },
      roles: {
        inherited: role(),
        "explicit-same": role(5),
        "explicit-higher": role(15),
      },
    }),
    "utf8",
  );
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("roles CLI budgets", () => {
  it("shows every effective cap and marks only inherited defaults", async () => {
    const output = await captureRoles([rolesPath]);

    expect(output).toContain(
      `${rolesPath}: OK — 3 roles; default turn budget $5; 2 role-specific overrides`,
    );
    expect(output).toMatch(/ROLE\s+RUNTIME\s+MODEL\s+EFFORT\s+BUDGET\s+ADAPTIVE\s+TRIGGERS/);

    const inherited = findRow(output, "inherited");
    const explicitSame = findRow(output, "explicit-same");
    const explicitHigher = findRow(output, "explicit-higher");
    expect(inherited).toMatch(/\$5 \(default\)\s+0\s+on:ticket-ready$/);
    expect(explicitSame).toMatch(/\$5\s+0\s+on:ticket-ready$/);
    expect(explicitSame).not.toContain("(default)");
    expect(explicitHigher).toMatch(/\$15\s+0\s+on:ticket-ready$/);
  });

  it("emits stable effective budget and inheritance fields in JSON", async () => {
    const output = await captureRoles(["--json", rolesPath]);
    const parsed = JSON.parse(output) as {
      defaultTurnBudgetUsd: number;
      roleTurnBudgetOverrideCount: number;
      roles: Array<Record<string, unknown>>;
    };

    expect(parsed.defaultTurnBudgetUsd).toBe(5);
    expect(parsed.roleTurnBudgetOverrideCount).toBe(2);
    expect(parsed.roles).toEqual([
      expect.objectContaining({
        name: "inherited",
        effectiveTurnBudgetUsd: 5,
        turnBudgetInherited: true,
      }),
      expect.objectContaining({
        name: "explicit-same",
        effectiveTurnBudgetUsd: 5,
        turnBudgetInherited: false,
      }),
      expect.objectContaining({
        name: "explicit-higher",
        effectiveTurnBudgetUsd: 15,
        turnBudgetInherited: false,
      }),
    ]);
    expect(output).not.toContain("roles; default turn budget");
  });
});

async function captureRoles(args: string[]): Promise<string> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    expect(await cmdRoles(args)).toBe(0);
    return log.mock.calls.map((call) => call.join(" ")).join("\n");
  } finally {
    log.mockRestore();
  }
}

function findRow(output: string, name: string): string {
  const row = output.split("\n").find((line) => line.startsWith(name));
  expect(row).toBeDefined();
  return row!;
}
