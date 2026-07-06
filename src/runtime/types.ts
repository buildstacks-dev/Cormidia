// The runtime contract. Everything above this layer (loop, org) sees only
// these types — never a provider SDK. See research/2026-07-03_runtime-layer.md.

export type RuntimeKind = "claude" | "codex" | "pi";

// Generic across providers; each adapter maps to its native knob
// (Anthropic effort, OpenAI reasoning effort, pi thinking level).
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Trigger {
  schedule?: string;
  event?: string;
  /** Human-initiated invocation (e.g. `operon plan`, docs/architecture.md
   *  §8). The dispatcher must NEVER auto-fire a manual trigger (build plan
   *  M7.8 encodes that) — it exists so a role can declare the manual entry
   *  point and telemetry can attribute the turn to it. */
  manual?: boolean;
}

export interface RoleConfig {
  name: string;
  runtime: RuntimeKind;
  model: string;
  effort: Effort;
  /** Intra-turn fan-out the harness may perform. Cross-provider mixing is
   *  never intra-turn — it is an org-level flow between roles. */
  delegation: { allow: string[] };
  triggers: Trigger[];
  outputs: string[];
  maxTurnBudgetUsd: number;
}

/** Resume handle. Claude: session id; Codex: thread id; pi: session id/path. */
export interface SessionHandle {
  runtime: RuntimeKind;
  id: string;
}

/** Assembled context for one turn: TASTE layers + role protocol + memory
 *  excerpts. Adapters inject this through their harness's NATIVE channel
 *  (CLAUDE.md / AGENTS.md / pi SYSTEM.md-append) — never a bespoke mechanism. */
export interface ContextBundle {
  taste: string[]; // org TASTE.md, then role addendum, then app override
  memoryExcerpts: string[]; // relevant OKF documents for this task
}

export interface TurnRequest {
  role: RoleConfig;
  /** Target repo checkout / worktree the turn operates in. */
  workdir: string;
  /** The ticket / task prompt. */
  task: string;
  context: ContextBundle;
  session?: SessionHandle;
  /** Optional JSON schema for a typed verdict (docs/loop.md §10). Adapters
   *  with native structured output request it from the provider; adapters
   *  without support ignore it — the loop's lenient parser is the fallback
   *  (build plan M4.6). Deliberately just a JSON-schema-shaped bag here:
   *  verdict TYPES belong to src/loop/verdicts.ts, never to this layer. */
  verdictSchema?: Record<string, unknown>;
  /** Optional per-pass maximum conversation turns. Adapters map this to the
   *  provider's native "max turns" knob where one exists; absent means the
   *  adapter default applies. */
  maxTurns?: number;
}

export interface Artifact {
  kind: "pr" | "review" | "ticket" | "note" | "digest" | "draft" | "file";
  ref: string; // PR number, file path, issue number, ...
  summary: string;
}

export interface TurnUsage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** Subagent turns spawned inside this turn — silent fan-out must be visible. */
  subagentTurns: number;
  wallClockMs: number;
}

export interface TurnResult {
  status: "completed" | "blocked_on_gate" | "failed";
  summary: string;
  artifacts: Artifact[];
  session: SessionHandle;
  usage: TurnUsage;
  /** Critical-op requests that were denied and escalated to the human. */
  escalations: GateEscalation[];
}

export interface GateEscalation {
  action: ToolAction;
  reason: string;
}

/** A tool action as seen by the gate, normalized across runtimes. */
export interface ToolAction {
  tool: string;
  input: unknown;
  description?: string;
}

export type GateDecision =
  | { allow: true }
  | { allow: false; reason: string; escalate: boolean };

export type GateFn = (action: ToolAction) => GateDecision;

export interface TurnEvent {
  type: "text" | "tool_use" | "tool_result" | "subagent" | "gate";
  detail: string;
}

export interface TurnHooks {
  /** MUST be consulted for every tool action, including those made by
   *  subagents. Adapters prove this via the gate conformance suite. */
  gate: GateFn;
  onEvent?: (e: TurnEvent) => void;
}

export interface Runtime {
  readonly kind: RuntimeKind;
  runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult>;
}

export class NotImplementedError extends Error {
  constructor(what: string, pointer: string) {
    super(`${what} is not implemented yet. See ${pointer}`);
    this.name = "NotImplementedError";
  }
}
