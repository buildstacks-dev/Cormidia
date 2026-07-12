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

/** Durable authority provenance recorded on tasks and run envelopes. */
export interface AuthorityEvidence {
  profile: string;
  version: string;
  sha256: string;
  sources: string[];
}

/** Effective authority prose plus its content-bound provenance. */
export interface AuthorityContext extends AuthorityEvidence {
  text: string;
}

/** Assembled context for one turn: TASTE layers + role protocol + memory
 *  excerpts. Adapters inject this through their harness's NATIVE channel
 *  (CLAUDE.md / AGENTS.md / pi SYSTEM.md-append) — never a bespoke mechanism. */
export interface ContextBundle {
  /** Injected before TASTE. Optional only for legacy/tests that construct a
   * bundle directly; production assembly always resolves it. */
  authority?: AuthorityContext;
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
  /** Allow outbound network inside a workspace-write runtime sandbox for this
   * turn. Defaults to false; the orchestration boundary must opt in. */
  networkAccess?: boolean;
  /** Orchestrator-owned cancellation. Every adapter must stop its provider
   * session and descendants when this fires; the pipeline waits only for a
   * bounded grace period before finalizing the pass. */
  signal?: AbortSignal;
}

export interface Artifact {
  kind: "pr" | "review" | "ticket" | "note" | "digest" | "draft" | "file";
  ref: string; // PR number, file path, issue number, ...
  summary: string;
}

export interface TurnUsage {
  /** Total prompt/input tokens. Equals uncached + cache creation + cache read
   *  when the adapter reports the split. */
  tokensIn: number;
  /** Uncached input tokens. Optional for adapters that cannot report the
   *  split yet; consumers must tolerate old records without it. */
  tokensInUncached?: number;
  /** Cache-write input tokens (provider naming varies). */
  cacheCreationTokens?: number;
  /** Cache-read input tokens. */
  cacheReadTokens?: number;
  tokensOut: number;
  costUsd: number;
  /** True when `costUsd` is an Operon-computed estimate from documented
   *  per-token list prices rather than a provider-reported figure. Codex's
   *  App Server does not report dollar cost, so its `costUsd` is estimated
   *  from token counts (src/runtime/adapters/codex.ts). Consumers that need
   *  provider-authoritative spend must tolerate/annotate this; budget
   *  rollups (src/org/budget.ts) deliberately still count estimated spend —
   *  an estimate is far better than the previous silent $0. Absent/false
   *  means the cost is provider-reported (Claude, pi). */
  costEstimated?: boolean;
  /** Subagent turns spawned inside this turn — silent fan-out must be visible. */
  subagentTurns: number;
  wallClockMs: number;
  /** Completeness of this usage snapshot. Omitted on legacy/final results;
   * consumers infer complete vs estimated from costEstimated. */
  quality?: UsageQuality;
}

export type UsageQuality = "complete" | "partial" | "estimated" | "unavailable";

export interface TurnResult {
  status: "completed" | "blocked_on_gate" | "failed" | "cancelled" | "timed_out";
  summary: string;
  artifacts: Artifact[];
  session: SessionHandle;
  usage: TurnUsage;
  /** Critical-op requests that were denied and escalated to the human. */
  escalations: GateEscalation[];
  /** Stable machine code for a failed turn (e.g. "error_max_budget_usd") —
   *  budget exhaustion must never masquerade as a generic failure or a
   *  secrets/auth escalation (proportionality-review Stage 3). Absent on
   *  success and on failures with no more specific cause. */
  errorCode?: string;
}

/** Monotonic provider progress that must survive a crash/cancellation before
 * the final TurnResult. Usage is cumulative for this turn, never a delta. */
export interface TurnProgress {
  at?: string;
  session?: SessionHandle;
  usage?: TurnUsage;
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
  /** Structured runlog fields (docs/loop.md §9 L2 bridge). All optional and
   *  purely additive: an adapter that only sets `type`/`detail` still works —
   *  the executor's L2 bridge (src/loop/pipeline.ts) reads these when present
   *  and infers what it can from `detail` otherwise. `args` is HASHED at the
   *  L2 boundary and never persisted raw (§9). */
  /** Tool name (on `tool_use`) or subagent type (on `subagent`). */
  name?: string;
  /** Subagent lifecycle phase — pairs `subagent.started`/`.completed` in L2. */
  phase?: "started" | "completed";
  /** Subagent span id — nests the fan-out under its parent pass in L2. */
  spanId?: string;
  /** Wall-clock duration of a `tool_use`. */
  durationMs?: number;
  /** Outcome of a `tool_use`. */
  success?: boolean;
  /** A classification tag forwarded onto `tool.called` detail (e.g.
   *  `environment_retry`), read by the L1/L2 anomaly detectors (§9). */
  category?: string;
  /** Raw `tool_use` args — hashed at the L2 boundary, never persisted raw. */
  args?: unknown;
}

export interface TurnHooks {
  /** MUST be consulted for every tool action, including those made by
   *  subagents. Adapters prove this via the gate conformance suite. */
  gate: GateFn;
  onEvent?: (e: TurnEvent) => void;
  /** Synchronous notification; the executor serializes durable writes. */
  onProgress?: (progress: TurnProgress) => void;
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
