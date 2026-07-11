// Tests the pi gate extension in src/runtime/adapters/pi-gate.ts.
// Covers pi tool-input normalization, routine allow behavior, critical-action
// blocking/escalation, and subagent event ordering before the gate.
// Uses inline extension events only; no pi SDK session, network, auth, filesystem
// state, or wall-clock time is required.

import { describe, expect, it } from "vitest";
import { createPiGateExtension, normalizePiToolAction } from "../../src/runtime/adapters/pi-gate.js";
import { defaultGate } from "../../src/runtime/gate.js";
import type { GateEscalation, TurnEvent } from "../../src/runtime/types.js";

describe("pi gate extension", () => {
  it("normalizes pi tool inputs", () => {
    expect(normalizePiToolAction("Write", { path: "/repo/roles.yaml", content: "x" }, "/repo")).toEqual({
      tool: "write",
      input: { path: "roles.yaml", content: "x" },
    });
    expect(normalizePiToolAction("Bash", { command: "pnpm test", timeout: 1000 }, "/repo")).toEqual({
      tool: "bash",
      input: { command: "pnpm test" },
    });
  });

  it("allows routine tool calls", async () => {
    const handler = installHandler([]);

    const result = await handler({ toolName: "bash", input: { command: "pnpm test" } });

    expect(result).toBeUndefined();
  });

  it("blocks and escalates critical tool calls", async () => {
    const escalations: GateEscalation[] = [];
    const handler = installHandler(escalations);

    const result = await handler({ toolName: "bash", input: { command: "rm -rf /workspace/data" } });

    expect(result).toMatchObject({ block: true, reason: expect.stringContaining("destructive-or-irreversible") });
    expect(escalations).toHaveLength(1);
    expect(escalations[0]?.action).toEqual({ tool: "bash", input: { command: "rm -rf /workspace/data" } });
  });

  it("emits tool_use for allowed calls, none for blocked ones (issue #27)", async () => {
    const events: TurnEvent[] = [];
    let handler: ((event: { toolName: string; input: unknown }) => Promise<unknown>) | undefined;
    createPiGateExtension(
      "/repo",
      { gate: defaultGate, onEvent: (event) => events.push(event) },
      [],
    )({ on: (_name, h) => (handler = h as typeof handler) } as never);

    await handler?.({ toolName: "bash", input: { command: "pnpm install" } });
    await handler?.({ toolName: "bash", input: { command: "rm -rf /workspace/data" } });

    const toolUses = events.filter((event) => event.type === "tool_use");
    expect(toolUses).toEqual([
      expect.objectContaining({
        name: "bash",
        detail: "bash: pnpm install",
        category: "environment_retry",
      }),
    ]);
  });

  it("emits subagent events before routing subagent-like tool calls", async () => {
    const events: TurnEvent[] = [];
    const order: string[] = [];
    const escalations: GateEscalation[] = [];
    let handler: ((event: { toolName: string; input: unknown; fromSubagent?: boolean }) => Promise<unknown>) | undefined;
    createPiGateExtension(
      "/repo",
      {
        gate: (action) => {
          order.push(`gate:${action.tool}`);
          return defaultGate(action);
        },
        onEvent: (event) => {
          events.push(event);
          order.push(`event:${event.type}`);
        },
      },
      escalations,
    )({ on: (_name, h) => (handler = h as typeof handler) } as never);

    await handler?.({
      toolName: "bash",
      input: { command: "rm -rf /workspace/data" },
      fromSubagent: true,
    });

    expect(events.some((event) => event.type === "subagent")).toBe(true);
    expect(order).toEqual(["event:subagent", "gate:bash"]);
    expect(escalations).toHaveLength(1);
  });
});

function installHandler(escalations: GateEscalation[]) {
  let handler: ((event: { toolName: string; input: unknown }) => Promise<unknown>) | undefined;
  createPiGateExtension("/repo", { gate: defaultGate }, escalations)({
    on: (_name, h) => (handler = h as typeof handler),
  } as never);
  if (handler === undefined) throw new Error("handler was not installed");
  return handler;
}
