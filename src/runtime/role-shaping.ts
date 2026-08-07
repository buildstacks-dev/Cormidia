// Role-forbidden acts, defined once at the runtime layer so BOTH consumers
// share one list (docs/approvals/design.md, capability
// shaping): the org's composed gate auto-denies these flat (the mechanical
// backstop, src/org/gate-compose.ts — org→runtime is the legal import
// direction), and adapters that expose a toolset-shaping surface make the
// attempt UNREPRESENTABLE so it never reaches a gate at all.
//
// Only the Claude adapter has such a surface today (inline `settings`
// permissions.deny — full permission-rule syntax, evaluated by the CLI's
// own permission layer). Codex routes every command through its approval
// callback with no per-command deny list, and pi exposes only a coarse
// read/bash/edit/write toolset — for both, the composed gate's flat deny IS
// the enforcement (docs/harness/capability-matrix.md records the degradation).

/** Acts these roles must never even attempt. Keys are roles.yaml role
 *  names; values are the gate rule names (src/runtime/gate.ts). */
export const FORBIDDEN_BY_ROLE: Record<string, readonly string[]> = {
  builder: ["self-merge-or-approve", "production-deploy", "provider-global-memory"],
  reviewer: ["self-merge-or-approve", "production-deploy", "provider-global-memory"],
};

/** Claude permission deny rules (settings.json syntax) that make each
 *  forbidden act unrepresentable in the tool surface. Kept alongside the
 *  rule list so a new forbidden act fails loudly here (add its patterns or
 *  document why no pattern can exist) instead of silently relying on the
 *  backstop alone. */
const CLAUDE_PATTERNS_BY_RULE: Record<string, readonly string[]> = {
  "self-merge-or-approve": [
    // Merging or reviewing a PR is the orchestrator's act (GhOps), never an
    // agent's: reviews travel as typed verdicts. Blocking all of `gh pr
    // merge`/`gh pr review` costs nothing legitimate; `gh pr view/list/
    // checkout` stay available.
    "Bash(gh pr merge:*)",
    "Bash(gh pr review:*)",
  ],
  "production-deploy": [
    // Builder/reviewer never operate infrastructure; deploy triggers are the
    // orchestrator's release handoff (A4) behind the approval queue.
    "Bash(kubectl:*)",
    "Bash(doctl:*)",
  ],
  "provider-global-memory": [
    // Provider-global memory shapes future behavior across every app — an
    // agent write there is a persistence channel, not a work product.
    "Write(~/.claude/**)",
    "Edit(~/.claude/**)",
    "Write(~/.codex/**)",
    "Edit(~/.codex/**)",
    "Write(~/.config/claude/**)",
    "Edit(~/.config/claude/**)",
    "Write(~/.config/codex/**)",
    "Edit(~/.config/codex/**)",
  ],
};

/** The Claude permission deny rules for a role — empty for roles with no
 *  forbidden acts (planner, sre, …), so shaping never widens. */
export function claudeDenyRulesForRole(roleName: string): string[] {
  const rules = FORBIDDEN_BY_ROLE[roleName] ?? [];
  return rules.flatMap((rule) => CLAUDE_PATTERNS_BY_RULE[rule] ?? []);
}

/**
 * Nested-harness invocation.
 *
 * Cormidia owns the child process environment, which is what carries a
 * harness's gate wiring (Muse's `TBH_MANAGED_HOOKS_PATH`, Claude's inline
 * settings, Codex's hook socket). An agent WITH SHELL ACCESS can defeat that by
 * launching a second agent itself: `muse exec …` spawned from inside a turn
 * inherits no managed hook root, so its tool actions never reach the gate. The
 * nested process is a gate hole, not a convenience, and the deny is the
 * enforcement — the composed gate refuses the command before it runs.
 *
 * Matching is per command and deliberately narrow: the harness binaries only,
 * at a command position (start of line, after a separator, or inside a
 * substitution), with an optional path prefix.
 */
const NESTED_HARNESS_COMMAND =
  /(?:^|[;&|(]|\$\(|`|\n)\s*(?:[\w./+-]*\/)?(?:muse|claude|codex|cursor-agent|grok)(?:\s|$)/;

export function invokesNestedHarness(command: string): boolean {
  return NESTED_HARNESS_COMMAND.test(command);
}
