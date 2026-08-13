// The runtime contract. Everything above this layer (loop, org) sees only
// these types — never a provider SDK. See research/2026-07-03_runtime-layer.md.

import type { AuthMode } from "./auth-mode.js";
import type { RuntimeCapability } from "./capabilities.js";
import type { ProviderPermissionModes } from "./permission-mode.js";
import type { TurnObserver } from "./turn-observer.js";

export type RuntimeKind = "claude" | "codex" | "pi" | "cursor" | "grok" | "muse" | "opencode";

// Generic across providers; each adapter maps to its native knob
// (Anthropic effort, OpenAI reasoning effort, pi thinking level).
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * One indivisible execution choice for a provider turn.
 *
 * `harness` is deliberately named at the planning boundary even though the
 * rest of the runtime layer historically calls the same value `runtime`.
 * Keeping all three fields together prevents a caller from selecting a model
 * and inferring (or silently substituting) its harness later.
 */
export interface TurnAssignment {
  harness: RuntimeKind;
  model: string;
  effort: Effort;
}

/** Durable provenance for the atomic tuple used by a provider turn. */
export type TurnAssignmentSource = "configured" | "episode_planner" | "creator";

export type AssignmentPricing =
  | { kind: "catalog_ref"; ref: string }
  | {
      kind: "conservative_estimate";
      maxTurnCostUsd: number;
      sourceRef: string;
    };

/** An org-approved adaptive candidate declared locally on a role. */
export interface AdaptiveAssignmentCandidate {
  /** Stable, role-local identifier used by app narrowing and plan evidence. */
  id: string;
  harness: RuntimeKind;
  model: string;
  /** Explicitly supported efforts for this exact harness/model pair. */
  efforts: Effort[];
  /** Provider ownership, independent of harness (pi may target OpenAI). */
  providerFamily: string;
  capabilityRef: string;
  qualificationRef: string;
  pricing: AssignmentPricing;
}

export interface Trigger {
  schedule?: string;
  event?: string;
  /** Human-initiated invocation (e.g. `cormidia plan`, docs/architecture.md
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
  /** Optional org-approved choices for adaptive assignment. The configured
   * fixed tuple above remains separate and is always available as the
   * reserved `configured` candidate. */
  adaptiveAssignments?: AdaptiveAssignmentCandidate[];
  /** Intra-turn fan-out the harness may perform. Cross-provider mixing is
   *  never intra-turn — it is an org-level flow between roles. */
  delegation: { allow: string[] };
  triggers: Trigger[];
  outputs: string[];
  maxTurnBudgetUsd: number;
  /** Ephemeral app-resolved provider policy. roles.yaml never owns this map;
   * the app registry can select only the supported non-bypass modes. */
  permissionModes?: ProviderPermissionModes;
  /** Ephemeral app-level maxima for the non-cost dimensions of one provider
   * turn. Null inherits the pass/episode allowance. */
  turnExecutionLimits?: {
    activeTimeMs: number | null;
    toolCalls: number | null;
    modelTurns: number | null;
  };
  /** Ephemeral app-level static-route limits. Accepted EpisodePlan DAGs do
   * not consume these because their validated steps are the authority. */
  routeExecutionLimits?: Record<
    "quick" | "standard" | "deep",
    {
      environmentRetries: number;
      toolCalls: number;
      claimAttempts: number;
      repairAttempts: number;
      reviewCycles: number;
    }
  >;
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
  /** Source-preserving transport metadata. Adapters ignore this field; the
   * loop records it in the pass context manifest before constructing a
   * runtime. Legacy/test bundles may omit it and are reported as explicitly
   * unattributed components rather than silently guessed. */
  components?: ContextComponent[];
  /** Auditable execution facts exposed to the turn. These describe the
   * selected adapter only; they do not grant tools or permissions. The
   * orchestration boundary resolves capabilities and adapters only validate
   * and render them. Optional for legacy callers while plan-aware execution
   * is migrated. */
  execution?: TurnExecutionFacts;
}

export interface TurnExecutionFacts {
  /** Role responsibility remains authoritative regardless of harness. */
  role: string;
  assignment: TurnAssignment;
  /** Canonical non-unsupported projection of the selected harness profile. */
  resolvedCapabilities: RuntimeCapability[];
  /** Profile surfaces that deterministic policy requires for this turn. */
  requiredCapabilities: RuntimeCapability[];
  /** Existing role-bound delegation policy, advertised but never granted by
   * this context object. Adapter/gate enforcement remains authoritative. */
  roleDelegation: { allow: string[] };
}

export interface ContextComponent {
  category: "authority" | "taste" | "role_protocol" | "memory";
  source: string;
  rendered: string;
  inclusionReason: string;
  requirement: "required" | "optional";
  cacheIdentity?: string;
}

export interface TurnRequest {
  role: RoleConfig;
  /** Exact atomic execution choice. Optional only for legacy/test callers;
   * adapters resolve omission to the role's configured fixed tuple. New
   * orchestration paths must persist and provide this value explicitly. */
  assignment?: TurnAssignment;
  /** Target repo checkout / worktree the turn operates in. */
  workdir: string;
  /** The ticket / task prompt. */
  task: string;
  context: ContextBundle;
  session?: SessionHandle;
  /** Optional JSON schema for a typed verdict (docs/loop/design.md §10). Adapters
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
  /** Uncached input tokens; optional when the adapter cannot report the split. */
  tokensInUncached?: number;
  /** Cache-write input tokens (provider naming varies). */
  cacheCreationTokens?: number;
  /** Cache-read input tokens. */
  cacheReadTokens?: number;
  tokensOut: number;
  costUsd: number;
  equivalentCostUsd?: number;
  equivalentCostEstimated?: boolean;
  /** True when `costUsd` is a Cormidia-computed estimate from documented
   *  per-token list prices rather than a provider-reported figure. Codex's
   *  App Server does not report dollar cost, so its `costUsd` is estimated
   *  from token counts (src/runtime/adapters/codex.ts). Consumers that need
   *  provider-authoritative spend must annotate this; budget rollups count it —
   *  an estimate is far better than the previous silent $0. Absent/false
   *  means the cost is provider-reported (Claude, pi). */
  costEstimated?: boolean;
  /** Billing of the (harness × provider-family) connection this turn ran on
   *  (#333). `subscription` means `costUsd` is an AUTHORITATIVE zero: the turn
   *  ran on the operator's own plan and has no marginal dollar cost — which is
   *  explicitly NOT the unknown-cost case (`quality: "unavailable"`), and
   *  explicitly not a silent zero (INV-006). `api_key` means metered spend.
   *  Absent = the connection is undeclared and `costUsd` is read exactly as it
   *  always was. Purely additive: old records parse unchanged. */
  billing?: AuthMode;
  /** Subagent turns spawned inside this turn — silent fan-out must be visible. */
  subagentTurns: number;
  wallClockMs: number;
  /** Completeness of this usage snapshot. Omitted on legacy/final results;
   * consumers infer complete vs estimated from costEstimated. */
  quality?: UsageQuality;
}

/**
 * Completeness of a usage snapshot.
 *
 * `none` is the authoritative-zero case: the pass invoked no provider at all
 * (deterministic orchestration — provision/setup, quality gates, the merge
 * state machine), so absent runtime/model/usage is expected rather than
 * missing. It is distinct from `unavailable`, which means a genuine provider
 * turn ran and its usage could not be observed. Conflating the two made every
 * mechanical pass look like unknown-cost provider activity (#88).
 */
export type UsageQuality = "complete" | "partial" | "estimated" | "unavailable" | "none";

/** Why a turn ended `interrupted` (CORMIDIA-C-CORE-001 §2, ratified 2026-08-12
 *  under F-PT-017). The vocabulary widened from `timed_out` to `interrupted`,
 *  so the reason carries the specificity the old NAME used to carry — losing it
 *  was the objection the ruling answers, which is why it is REQUIRED rather
 *  than another optional code.
 *
 *  `time_limit` is exactly what the retired `timed_out` meant, so a durable
 *  record written under the old name normalizes to `interrupted` + `time_limit`
 *  and is never read as unknown (`normalizeLegacyTerminalStatus`). */
export type InterruptedReason = "time_limit" | "operator_kill" | "provider_crash";

export type TerminalTurnStatus = "completed" | "blocked_on_gate" | "failed" | "cancelled" | "interrupted";

interface TurnResultCommon {
  summary: string;
  artifacts: Artifact[];
  session: SessionHandle;
  usage: TurnUsage;
  /** Critical-op requests that were denied and escalated to the human. */
  escalations: GateEscalation[];
  /** Stable machine code for a failed turn (e.g. "error_max_budget_usd") —
   *  budget exhaustion must never masquerade as a generic failure or a
   *  secrets/auth escalation (proportionality campaign Stage 3). Absent on
   *  success and on failures with no more specific cause. */
  errorCode?: string;
}

/** A run envelope. `interrupted` CANNOT be constructed without its reason —
 *  the requirement is enforced by the type, not by a convention a call site can
 *  forget (CORMIDIA-C-CORE-001 §2). */
export type TurnResult =
  | (TurnResultCommon & { status: Exclude<TerminalTurnStatus, "interrupted"> })
  | (TurnResultCommon & { status: "interrupted"; interruptedReason: InterruptedReason });

/** Durable-read normalizer (the F-PT-017 migration clause). Records written
 *  before 2026-08-12 carry `timed_out`; they mean `interrupted` for the
 *  `time_limit` reason and are read as exactly that — never as unknown, never
 *  dropped. Parse, don't cast: an unrecognized value is returned untouched so
 *  the caller's own validator refuses it. */
export function normalizeLegacyTerminalStatus(status: string): {
  status: string;
  interruptedReason?: InterruptedReason;
} {
  return status === "timed_out" ? { status: "interrupted", interruptedReason: "time_limit" } : { status };
}

/** Narrow an untrusted value to the ratified reason vocabulary. Adapters read
 *  their stop descriptor back off an AbortSignal reason, which is `unknown` by
 *  construction — this is the trust boundary, so it is parsed, never cast. */
export function parseInterruptedReason(value: unknown): InterruptedReason | undefined {
  return value === "time_limit" || value === "operator_kill" || value === "provider_crash" ? value : undefined;
}

/** Project a stop descriptor onto the TurnResult terminal discriminant, so the
 *  reason travels with the status it belongs to instead of being re-derived —
 *  or forgotten — at each construction site. Parse, don't cast: a descriptor
 *  claiming `interrupted` with no reason is a bug at the STOP site, and this
 *  refuses rather than inventing one. Fabricating `time_limit` for an unknown
 *  interruption is exactly the lost specificity F-PT-017 objected to. */
export function terminalStopFields(descriptor: {
  status: TerminalTurnStatus;
  interruptedReason?: InterruptedReason;
}):
  | { status: Exclude<TerminalTurnStatus, "interrupted"> }
  | { status: "interrupted"; interruptedReason: InterruptedReason } {
  if (descriptor.status !== "interrupted") return { status: descriptor.status };
  if (descriptor.interruptedReason === undefined) {
    throw new Error("an interrupted turn must carry a machine-readable reason (CORMIDIA-C-CORE-001 §2, F-PT-017)");
  }
  return { status: "interrupted", interruptedReason: descriptor.interruptedReason };
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

export type GateDecision = { allow: true } | { allow: false; reason: string; escalate: boolean };

export type GateFn = (action: ToolAction) => GateDecision;

export interface TurnEvent {
  type: "text" | "tool_use" | "tool_result" | "subagent" | "gate";
  detail: string;
  /** Structured runlog fields (docs/loop/design.md §9 L2 bridge). All optional and
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

export interface TurnHooks extends TurnObserver {
  /** MUST be consulted for every tool action, including those made by
   *  subagents. Adapters prove this via the gate conformance suite. */
  gate: GateFn;
  /** Synchronous notification; the executor serializes durable writes. */
}

export interface Runtime {
  readonly kind: RuntimeKind;
  runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult>;
}
