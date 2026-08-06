// CF-INV-002 — "forbidden read via hook bridge" + seed (d) "the Codex
// untrusted-read bypass (issue #20) generalized to a write". Codex's App Server
// approval callback does not see auto-approved reads such as `cat .env`; the
// documented compensating boundary is the PreToolUse hook → per-turn Unix
// socket → Cormidia's in-process GateFn (src/runtime/adapters/codex-gate-bridge.ts
// + codex-gate-hook.ts). Per the ratified B-03 contract (CORMIDIA-C-B03-001): "A
// forbidden READ escaping that hook is an INV-002/INV-011 violation ... a
// forbidden WRITE escaping is likewise INV-002." The bridge fails closed.
//
// Risk E-1 / T-11. Layer 2 — the REAL bridge server over a REAL Unix socket,
// wired to the REAL product gate (defaultGate). No provider, no tokens, no
// network. The socket client below mirrors exactly what codex-gate-hook.ts (the
// child half) sends: connect, half-close with the hook JSON, read the reply.
//
// Detector family = "the bridge denies a forbidden action + records the
// escalation, and fails closed on anything it cannot classify". Negative
// controls: (i) a THROWING gate is denied (the bridge's own fail-closed fires),
// and (ii) a permissive gate is surfaced as allow — proving the deny in the
// real-gate cases comes from the gate's classification and the bridge would
// surface a weakened gate rather than mask it (the assertions are load-bearing).

import { createConnection } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startCodexGateBridge, type CodexGateBridge } from "../../../src/runtime/adapters/codex-gate-bridge.js";
import { defaultGate } from "../../../src/runtime/gate.js";
import type { GateDecision, GateEscalation, ToolAction, TurnHooks } from "../../../src/runtime/types.js";

interface BridgeReply {
  allow: boolean;
  reason?: string;
}

/** Speak the exact wire protocol codex-gate-hook.ts speaks: connect, end with
 *  the payload, read the JSON reply the server writes on socket end. `payload`
 *  may be a hook object (JSON-encoded here) or a raw string for malformed-input
 *  cases. */
function askBridge(socketPath: string, payload: unknown, raw = false): Promise<BridgeReply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let out = "";
    socket.setTimeout(10_000, () => {
      socket.destroy();
      reject(new Error("bridge client timed out"));
    });
    socket.on("connect", () => socket.end(raw ? String(payload) : JSON.stringify(payload)));
    socket.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    socket.on("error", reject);
    socket.on("end", () => {
      try {
        const parsed = JSON.parse(out) as BridgeReply;
        resolve(parsed);
      } catch (error) {
        reject(new Error(`unparsable bridge reply ${JSON.stringify(out)}: ${String(error)}`));
      }
    });
  });
}

const hook = (toolName: string, toolInput: Record<string, unknown>): Record<string, unknown> => ({
  tool_name: toolName,
  tool_input: toolInput,
});

/** apply_patch bodies — the Codex write path the bridge normalizes into
 *  gate-visible edit/write actions. */
const patch = (line: string): Record<string, unknown> =>
  hook("apply_patch", { command: `*** Begin Patch\n${line}\n*** End Patch` });

describe("CF-INV-002 (hook bridge / seed d) — forbidden reads & writes are denied through the real Codex gate bridge (L2, HB-010)", () => {
  let bridges: CodexGateBridge[] = [];

  afterEach(async () => {
    for (const bridge of bridges) await bridge.close();
    bridges = [];
  });

  async function startBridge(hooks: TurnHooks, escalations: GateEscalation[] = []): Promise<CodexGateBridge> {
    const bridge = await startCodexGateBridge("/tmp/cf-inv-002-wd", "gpt-5.6-sol", hooks, escalations);
    bridges.push(bridge);
    return bridge;
  }

  it("forbidden READ (the untrusted-read bypass class) is denied and escalated through the hook bridge", async () => {
    const escalations: GateEscalation[] = [];
    const bridge = await startBridge({ gate: defaultGate }, escalations);

    // `cat .env` and `cat secrets.json` are exactly the auto-approved reads the
    // App Server callback would miss — the hook must still see and refuse them.
    for (const command of ["cat .env", "cat secrets.json", "cat ~/.ssh/id_rsa"]) {
      const reply = await askBridge(bridge.socketPath, hook("Bash", { command }));
      expect(reply.allow).toBe(false);
      expect(reply.reason).toContain("secret-read");
    }
    // The reads were recorded as escalations (a critical op never silently drops).
    expect(escalations.length).toBe(3);
    expect(escalations.every((e) => e.action.tool === "bash")).toBe(true);
  });

  it("forbidden WRITE (read-bypass generalized to a write) is denied through the hook bridge", async () => {
    const bridge = await startBridge({ gate: defaultGate });

    // A protocol-surface rewrite and a forged approval-store grant, both via the
    // apply_patch write path — each must reach the gate and be refused.
    const rolesEdit = await askBridge(bridge.socketPath, patch("*** Update File: roles.yaml"));
    expect(rolesEdit.allow).toBe(false);
    expect(rolesEdit.reason).toContain("protocol-self-edit");

    const grantForge = await askBridge(bridge.socketPath, patch("*** Add File: approvals/grants/forged.json"));
    expect(grantForge.allow).toBe(false);
    expect(grantForge.reason).toContain("approval-store-tamper");
  });

  it("a benign read is allowed — the bridge is a real discriminator, not a constant deny", async () => {
    const bridge = await startBridge({ gate: defaultGate });
    const reply = await askBridge(bridge.socketPath, hook("Bash", { command: "ls -la" }));
    expect(reply.allow).toBe(true);
  });

  it("fails closed on an input the bridge cannot classify (unknown shape / malformed JSON)", async () => {
    const bridge = await startBridge({ gate: defaultGate });

    const nonObject = await askBridge(bridge.socketPath, '"just a string"', true);
    expect(nonObject.allow).toBe(false);
    expect(nonObject.reason).toContain("failed closed");

    const badJson = await askBridge(bridge.socketPath, "{not valid json", true);
    expect(badJson.allow).toBe(false);
    expect(badJson.reason).toContain("failed closed");
  });

  it("negative control: a THROWING gate (INV-015 classifier-error posture) is denied — the bridge's own fail-closed fires", async () => {
    const throwingGate = (): GateDecision => {
      throw new Error("classifier boom");
    };
    const bridge = await startBridge({ gate: throwingGate });
    const reply = await askBridge(bridge.socketPath, hook("Bash", { command: "cat .env" }));
    expect(reply.allow).toBe(false);
    expect(reply.reason).toContain("failed closed");
  });

  it("negative control: a permissive gate lets the forbidden write through — proving the deny comes from the gate, not the transport", async () => {
    // Seed the violation: a weakened gate that allows everything. The bridge
    // must SURFACE the allow (never mask it) — so the real-gate deny above is
    // attributable to the gate's classification, and this assertion would break
    // the instant enforcement were removed from the gate.
    const permissiveGate = (_action: ToolAction): GateDecision => ({ allow: true });
    const bridge = await startBridge({ gate: permissiveGate });
    const reply = await askBridge(bridge.socketPath, patch("*** Update File: roles.yaml"));
    expect(reply.allow).toBe(true);
  });
});
