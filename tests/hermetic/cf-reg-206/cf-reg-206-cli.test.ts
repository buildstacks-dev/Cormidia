// CF-REG-206 — the interactive approval reviewer is never a successful
// non-interactive no-op. This detector was landed red-before-green against
// #206: before the repair EOF caused every item to be skipped with exit 0.

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { initWorldOrg, makeInitWorld, REPO_ROOT, type InitWorld } from "../cf-j01/support.js";

const worlds: InitWorld[] = [];

afterEach(async () => {
  for (const world of worlds.splice(0).reverse()) await world.cleanup();
});

function runCli(world: InitWorld, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(
    join(REPO_ROOT, "node_modules", ".bin", "tsx"),
    [
      join(REPO_ROOT, "src", "cli.ts"),
      "approvals",
      ...args,
      "--org-home",
      world.target,
      "--state-home",
      world.stateHome,
    ],
    { encoding: "utf8", input: "", env: { ...process.env, NO_COLOR: "1" } },
  );
}

function outputOf(result: SpawnSyncReturns<string>): string {
  return `${result.stdout}\n${result.stderr}`;
}

function assertNonInteractiveRefusal(result: { status: number | null; decisions: number }): void {
  if (result.status === 0 || result.decisions !== 0) {
    throw new Error("non-interactive review detector fired: review succeeded or wrote a decision");
  }
}

async function assertUndecided(store: ApprovalStore, id: string): Promise<void> {
  expect((await store.show(id)).item.status).toBe("pending");
  expect((await store.readLog()).filter((event) => event.type === "decided")).toEqual([]);
  expect(await store.listDecided()).toEqual([]);
}

async function makeWorld(): Promise<{ world: InitWorld; store: ApprovalStore }> {
  const world = await makeInitWorld();
  worlds.push(world);
  await initWorldOrg(world, "cf-reg-206");
  return { world, store: new ApprovalStore(world.stateHome) };
}

describe("CF-REG-206 — non-interactive approval decisions", () => {
  it("refuses review without a TTY, names decide, and writes no decision", async () => {
    const { world, store } = await makeWorld();
    const raised = await store.raise({
      app: "cli-app",
      role: "builder",
      rule: "outbound-network",
      action: { tool: "Bash", input: { command: "curl https://example.invalid" } },
    });

    const result = runCli(world, ["review"]);

    expect(result.status).not.toBe(0);
    expect(outputOf(result)).toMatch(/requires a terminal.*decide/i);
    await assertUndecided(store, raised.id);
    assertNonInteractiveRefusal({
      status: result.status,
      decisions: (await store.listDecided()).length,
    });
  });

  it("requires a target, one decision, a justification, identity, and exact confirmation", async () => {
    const { world, store } = await makeWorld();
    const raised = await store.raise({
      app: "cli-app",
      role: "builder",
      rule: "outbound-network",
      action: { tool: "Bash", input: { command: "curl https://example.invalid" } },
    });
    const invalid: Array<{ args: string[]; error: RegExp }> = [
      { args: ["decide"], error: /decide requires a value/ },
      { args: ["decide", raised.id], error: /choose exactly one/ },
      {
        args: ["decide", raised.id, "--approve", "--by", "Alice", "--confirm", raised.id],
        error: /--reason is required/,
      },
      {
        args: ["decide", raised.id, "--approve", "--reason", "routine approval", "--confirm", raised.id],
        error: /--by <identity> is required/,
      },
      {
        args: [
          "decide",
          raised.id,
          "--approve",
          "--reason",
          "routine approval",
          "--by",
          "Alice",
          "--confirm",
          "wrong-id",
        ],
        error: /--confirm must exactly match/,
      },
      {
        args: [
          "decide",
          raised.id,
          "--approve",
          "--deny",
          "--reason",
          "routine approval",
          "--by",
          "Alice",
          "--confirm",
          raised.id,
        ],
        error: /choose only one decision/,
      },
      {
        args: ["decide", raised.id, "--deny", "--reason", "d", "--by", "Alice", "--confirm", raised.id],
        error: /actual justification.*bare a\/d\/s token/,
      },
    ];

    for (const attempt of invalid) {
      const result = runCli(world, attempt.args);
      expect(result.status, outputOf(result)).not.toBe(0);
      expect(outputOf(result)).toMatch(attempt.error);
      await assertUndecided(store, raised.id);
    }
  });

  it("records an attributable agent decision and parses an app scope with an optional path", async () => {
    const { world, store } = await makeWorld();
    const raised = await store.raise({
      app: "cli-app",
      role: "builder",
      rule: "outbound-network",
      action: { tool: "Bash", input: { command: "curl https://example.invalid/src/data" } },
    });

    const result = runCli(world, [
      "decide",
      raised.id,
      "--approve",
      "--reason",
      "fixture network access is ordinary and bounded",
      "--by",
      "agent:builder",
      "--confirm",
      raised.id,
      "--scope",
      "app",
      "src/",
      "--json",
    ]);

    expect(result.status, outputOf(result)).toBe(0);
    const response = JSON.parse(result.stdout) as { item: { decidedBy: unknown; reason: string } };
    expect(response.item).toMatchObject({
      decidedBy: { kind: "agent", identity: "agent:builder" },
      reason: "fixture network access is ordinary and bounded",
    });
    const durable = await store.show(raised.id);
    expect(durable.item).toMatchObject({
      status: "approved",
      decidedBy: { kind: "agent", identity: "agent:builder" },
    });
    expect(durable.grant?.scope).toEqual({
      kind: "app",
      rule: "outbound-network",
      pathContains: "src/",
    });
    expect((await store.readLog()).find((event) => event.type === "decided")).toMatchObject({
      decidedBy: { kind: "agent", identity: "agent:builder" },
    });
  });

  it("requires a human identity for every decision on NEVER_SCOPEABLE_RULES", async () => {
    const { world, store } = await makeWorld();
    const raised = await store.raise({
      app: "cli-app",
      role: "builder",
      rule: "production-deploy",
      action: { tool: "Bash", input: { command: "deploy production" } },
    });

    for (const decision of ["--approve", "--deny"] as const) {
      const result = runCli(world, [
        "decide",
        raised.id,
        decision,
        "--reason",
        "agent attempted a protected decision",
        "--by",
        "agent:builder",
        "--confirm",
        raised.id,
      ]);
      expect(result.status, outputOf(result)).not.toBe(0);
      expect(outputOf(result)).toMatch(/requires a human decision.*agent identity/i);
      await assertUndecided(store, raised.id);
    }
  });

  it("negative control: the refusal detector fires on the seeded old EOF-success behavior", () => {
    expect(() => assertNonInteractiveRefusal({ status: 0, decisions: 0 })).toThrow(
      /review succeeded or wrote a decision/,
    );
  });
});
