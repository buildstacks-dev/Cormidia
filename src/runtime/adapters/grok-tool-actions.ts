// Grok hook envelope -> Cormidia ToolAction.
//
// Grok's `PreToolUse` payload is camelCase (`toolName`, `toolInput`; user
// guide, "Writing Hook Scripts"). Names that have a cross-provider equivalent
// are mapped onto the Claude-shaped names the gate and `normalizeToolAction`
// already classify, so one normalization owner serves every adapter. A tool
// with no equivalent keeps grok's own name: an unknown tool must stay visible
// to the gate, never be renamed into something familiar.

import type { ToolAction } from "../types.js";
import { normalizeToolAction } from "./claude.js";

/** Grok's fan-out tools. B-25 declares `intra_turn_fanout: unsupported`, and an
 *  unsupported surface must be *enforced*, not merely undeclared: a subagent
 *  whose tool calls Cormidia never observed would be an INV-002 hole. Throwing
 *  here makes the bridge deny the call. */
const SUBAGENT_TOOLS = new Set(["spawn_subagent", "task"]);

const GROK_TOOL_ALIASES: Record<string, string> = {
  run_terminal_command: "bash",
  bash: "bash",
  read_file: "read",
  search_replace: "edit",
  create_file: "write",
  write_file: "write",
  grep: "grep",
};

/** Every tool action one `pre_tool_use` envelope covers. */
export function normalizeGrokHookActions(input: unknown, workdir: string): ToolAction[] {
  if (input === null || typeof input !== "object") throw new Error("hook input is not an object");
  const record = input as Record<string, unknown>;
  const toolName = typeof record["toolName"] === "string" ? record["toolName"] : "";
  const rawInput = record["toolInput"];
  const toolInput = isRecord(rawInput) ? rawInput : {};
  const lower = toolName.toLowerCase();
  if (SUBAGENT_TOOLS.has(lower)) {
    throw new Error(
      `grok intra-turn fan-out is not a gateable route (tool ${JSON.stringify(toolName)}); ` +
        "B-25 declares intra_turn_fanout unsupported and the bridge enforces it",
    );
  }
  const mapped = GROK_TOOL_ALIASES[lower];
  if (mapped === undefined) return [{ tool: lower, input: toolInput }];
  return [normalizeToolAction(mapped, canonicalGrokToolInput(mapped, toolInput), workdir)];
}

function canonicalGrokToolInput(mapped: string, toolInput: Record<string, unknown>): Record<string, unknown> {
  const path = firstString(toolInput, ["file_path", "target_file", "path", "target_directory"]);
  switch (mapped) {
    case "bash":
      return { command: firstString(toolInput, ["command"]) ?? "" };
    case "read":
      return { file_path: path ?? "" };
    case "write":
      return { file_path: path ?? "", content: toolInput["contents"] ?? toolInput["content"] };
    case "edit":
      return {
        file_path: path ?? "",
        old_string: toolInput["old_string"] ?? toolInput["old_str"],
        new_string: toolInput["new_string"] ?? toolInput["new_str"],
      };
    default:
      return { ...toolInput, ...(path === undefined ? {} : { path }) };
  }
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
