// The exact OpenCode configuration one Cormidia turn runs under.
//
// Cormidia's enforcing gate is the plugin hook (./opencode-gate-bridge.ts).
// This file is the SHAPING layer around it, and the two are not
// interchangeable: OpenCode's `ask` action auto-rejects in headless mode
// (F-PT-025 probe, 2026-08-07) and its `--auto` flag only bypasses that ask
// layer, never the plugin hook. So nothing here is ever `ask`, nothing here is
// relied on for enforcement, and `--auto` is never passed.
//
// The posture is deny-by-default: `"*": "deny"` is the catch-all, so a
// permission key OpenCode adds in a later release is refused rather than
// silently granted, and only the tool families Cormidia's gate classifies are
// opened back up for the hook to decide. Rules are evaluated in order with the
// later rule winning, which is why the catch-all is written first.

import { FORBIDDEN_BY_ROLE } from "../role-shaping.js";
import type { Effort } from "../types.js";

/** Provider-global memory locations an agent must never write, expressed in
 *  OpenCode's `~`-expanding path patterns. Mirrors role-shaping.ts's
 *  `provider-global-memory` rule and adds OpenCode's own config root. */
const GLOBAL_MEMORY_PATTERNS = [
  "~/.claude/**",
  "~/.codex/**",
  "~/.config/claude/**",
  "~/.config/codex/**",
  "~/.config/opencode/**",
];

const BASH_PATTERNS_BY_RULE: Record<string, readonly string[]> = {
  "self-merge-or-approve": ["gh pr merge*", "gh pr review*"],
  "production-deploy": ["kubectl*", "doctl*"],
  "provider-global-memory": [],
};

export class OpencodeEffortUnsupportedError extends Error {
  readonly code = "error_adapter_misconfigured";
  constructor(model: string, effort: Effort, available: string[]) {
    super(
      `OpencodeRuntime: model ${JSON.stringify(model)} does not expose effort ${JSON.stringify(effort)} ` +
        `(available variants: ${available.length === 0 ? "none" : available.join(", ")}). ` +
        `The assigned harness/model/effort tuple is indivisible — no effort alias or silent drop is allowed.`,
    );
    this.name = "OpencodeEffortUnsupportedError";
  }
}

/**
 * OpenCode carries reasoning effort as a per-model `variant` whose names
 * already match Cormidia's Effort vocabulary. Availability is per model, so
 * the mapping is a lookup, never a coercion: a model that does not publish the
 * requested variant — including a model that publishes none at all — is a
 * typed refusal before the provider is constructed.
 */
export function resolveOpencodeVariant(model: string, effort: Effort, variants: readonly string[]): string {
  if (!variants.includes(effort)) throw new OpencodeEffortUnsupportedError(model, effort, [...variants]);
  return effort;
}

/** Deny-by-default permission map for one turn. */
export function opencodePermissionConfig(input: { roleName: string; networkAccess: boolean }): Record<string, unknown> {
  const rules = FORBIDDEN_BY_ROLE[input.roleName] ?? [];
  const bashDenies = rules.flatMap((rule) => BASH_PATTERNS_BY_RULE[rule] ?? []);
  const guardsGlobalMemory = rules.includes("provider-global-memory");
  const network = input.networkAccess ? "allow" : "deny";
  const pathRule = (): Record<string, string> => ({
    "*": "allow",
    ...Object.fromEntries(GLOBAL_MEMORY_PATTERNS.map((pattern) => [pattern, "deny"])),
  });
  return {
    // Catch-all first: anything Cormidia has not classified is refused.
    "*": "deny",
    bash:
      bashDenies.length === 0 ? "allow" : { "*": "allow", ...Object.fromEntries(bashDenies.map((p) => [p, "deny"])) },
    read: "allow",
    glob: "allow",
    grep: "allow",
    list: "allow",
    lsp: "allow",
    todowrite: "allow",
    task: "allow",
    edit: guardsGlobalMemory ? pathRule() : "allow",
    write: guardsGlobalMemory ? pathRule() : "allow",
    webfetch: network,
    websearch: network,
    // Ambient-context and interaction channels Cormidia never uses headlessly.
    // `question` would auto-reject anyway; denying it makes that explicit
    // instead of leaving a silent rejection to look like a model failure.
    skill: "deny",
    question: "deny",
    external_directory: "deny",
    doom_loop: "deny",
  };
}

/**
 * The full inline config handed to the server through OPENCODE_CONFIG_CONTENT,
 * which outranks project and global config. `plugin` carries the Cormidia gate
 * as a `file://` URL so nothing is written into the operator's config root or
 * the app checkout, and `instructions` is the native context-file channel that
 * carries the ContextBundle.
 */
export function buildOpencodeInlineConfig(input: {
  roleName: string;
  networkAccess: boolean;
  pluginUrl: string;
  instructionFiles: string[];
}): Record<string, unknown> {
  return {
    $schema: "https://opencode.ai/config.json",
    plugin: [input.pluginUrl],
    instructions: input.instructionFiles,
    permission: opencodePermissionConfig({ roleName: input.roleName, networkAccess: input.networkAccess }),
    // No MCP servers, no sharing, no self-update inside an org turn.
    mcp: {},
    share: "disabled",
    autoupdate: false,
    snapshot: false,
  };
}
