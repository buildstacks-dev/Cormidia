// Shared conformance case fixtures (build plan M0.4). Mirrors
// test/gate.test.ts's case shape (a ToolAction paired with the gate rule it
// should trip / a routine near-miss) so the two suites read as one family,
// but does not import from test/gate.test.ts — that file exports nothing and
// stays unmodified per AGENTS.md. This is a smaller, adapter-facing fixture
// set exercised end-to-end through a Runtime's `runTurn()` + `hooks.gate`,
// rather than calling `classify`/`defaultGate` directly the way
// test/gate.test.ts does; test/gate.test.ts remains the exhaustive
// per-rule/per-surface source of truth for the gate itself.

import type { ToolAction } from "../../src/runtime/types.js";

const bash = (command: string): ToolAction => ({ tool: "bash", input: { command } });

export interface ConformanceCriticalCase {
  /** Short label used in per-case assertion failure messages. */
  name: string;
  action: ToolAction;
  /** The src/runtime/gate.ts CRITICAL_RULES name this action must trip. */
  rule: string;
}

/** A representative slice across distinct gate.ts rule families — enough to
 *  prove a Runtime denies + escalates end-to-end, not a restatement of
 *  test/gate.test.ts's exhaustive per-rule/per-surface coverage. */
export const CRITICAL_CASES: ConformanceCriticalCase[] = [
  {
    name: "production deploy",
    action: bash("kubectl apply -f prod.yaml"),
    rule: "production-deploy",
  },
  {
    name: "destructive rm -rf",
    action: bash("rm -rf /workspace/data"),
    rule: "destructive-or-irreversible",
  },
  {
    name: "npm publish",
    action: bash("npm publish --access public"),
    rule: "external-publishing",
  },
  {
    name: "read .env",
    action: bash("cat .env"),
    rule: "secrets-or-auth",
  },
  {
    name: "roles.yaml write",
    action: { tool: "write", input: { path: "roles.yaml", content: "..." } },
    rule: "protocol-self-edit",
  },
];

/** Routine near-misses: none of these should ever classify as critical. */
export const ROUTINE_CASES: ToolAction[] = [
  bash("pnpm test"),
  bash("git commit -m 'feat: add parser'"),
  { tool: "read", input: { path: "src/cli.ts" } },
];

/** The action a subagent attempts in the "subagent critical op escalates"
 *  case. Reuses a CRITICAL_CASES member (rather than a bespoke fixture) so
 *  there is exactly one place that defines what "destructive rm -rf" means. */
export const SUBAGENT_CRITICAL_CASE: ConformanceCriticalCase = CRITICAL_CASES[1]!;

/** docs/loop.md §2's ARG_MAX lesson: adapters must accept multi-hundred-KB
 *  task payloads via a robust channel, not ARG_MAX-limited argv. 300KB + 1
 *  byte, matching src/runtime/testing/fakeRuntime.test.ts's own self-test so
 *  the two payload-size constants never silently drift apart. */
export const LARGE_PAYLOAD_SIZE_BYTES = 300 * 1024 + 1;
