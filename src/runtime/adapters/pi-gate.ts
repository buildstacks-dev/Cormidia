import * as path from "node:path";
import type { ExtensionFactory, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import type { GateEscalation, ToolAction, TurnHooks } from "../types.js";

export function normalizePiToolAction(
  toolName: string,
  input: Record<string, unknown>,
  workdir: string,
): ToolAction {
  const tool = toolName.toLowerCase();
  const rel = (p: unknown): string => {
    const raw = typeof p === "string" ? p : "";
    if (path.isAbsolute(raw)) {
      const relative = path.relative(workdir, raw);
      if (relative !== "" && !relative.startsWith("..")) return relative;
    }
    return raw;
  };

  switch (tool) {
    case "bash":
      return { tool, input: { command: typeof input.command === "string" ? input.command : "" } };
    case "write":
      return { tool, input: { path: rel(input.path ?? input.file_path), content: input.content } };
    case "edit":
      return {
        tool,
        input: {
          path: rel(input.path ?? input.file_path),
          old_string: input.old_string,
          new_string: input.new_string,
        },
      };
    case "read":
      return { tool, input: { path: rel(input.path ?? input.file_path) } };
    default:
      return { tool, input };
  }
}

export function createPiGateExtension(
  workdir: string,
  hooks: TurnHooks,
  escalations: GateEscalation[],
): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async (event): Promise<ToolCallEventResult | undefined> => {
      if (isSubagentToolCallEvent(event)) {
        hooks.onEvent?.({
          type: "subagent",
          detail: `pi subagent attempting: ${event.toolName}`,
        });
      }
      const action = normalizePiToolAction(
        event.toolName,
        event.input as Record<string, unknown>,
        workdir,
      );
      const decision = hooks.gate(action);
      if (decision.allow) return undefined;
      if (decision.escalate) {
        escalations.push({ action, reason: decision.reason });
      }
      return { block: true, reason: decision.reason };
    });
  };
}

function isSubagentToolCallEvent(event: unknown): event is { toolName: string } {
  if (typeof event !== "object" || event === null) return false;
  const rec = event as Record<string, unknown>;
  return (
    rec.fromSubagent === true ||
    typeof rec.agentId === "string" ||
    typeof rec.agentPath === "string" ||
    rec.source === "subagent"
  );
}
