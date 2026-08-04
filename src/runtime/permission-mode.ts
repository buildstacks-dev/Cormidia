import type { RuntimeKind } from "./types.js";

export const CODEX_PERMISSION_MODES = ["untrusted", "on-request", "never"] as const;
export type CodexPermissionMode = (typeof CODEX_PERMISSION_MODES)[number];

export const CLAUDE_PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "dontAsk",
  "auto",
] as const;
export type ClaudePermissionMode = (typeof CLAUDE_PERMISSION_MODES)[number];

/** App-resolved provider permission policy. Bypass modes are deliberately
 * unrepresentable: Cormidia's gate and exact critical-operation approvals
 * remain in force regardless of the harness's convenience mode. */
export interface ProviderPermissionModes {
  codex: CodexPermissionMode;
  claude: ClaudePermissionMode;
}

export const SHIPPED_PROVIDER_PERMISSION_MODES: Readonly<ProviderPermissionModes> = {
  codex: "on-request",
  claude: "auto",
};

export function permissionModeFor(
  runtime: RuntimeKind,
  configured?: ProviderPermissionModes,
): CodexPermissionMode | ClaudePermissionMode | "cormidia-gate" {
  if (runtime === "codex") {
    return configured?.codex ?? SHIPPED_PROVIDER_PERMISSION_MODES.codex;
  }
  if (runtime === "claude") {
    return configured?.claude ?? SHIPPED_PROVIDER_PERMISSION_MODES.claude;
  }
  return "cormidia-gate";
}
