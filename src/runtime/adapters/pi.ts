// All other models -> pi (earendil-works/pi), embedded in-process via its SDK.
//
// Integration notes (research/2026-07-03_runtime-layer.md):
// - protocol via SYSTEM.md / APPEND_SYSTEM.md + AGENTS.md context files
// - pi has no first-class approval flow; Operon installs an extension that
//   intercepts `tool_call` events and blocks on hooks.gate denial.
// - sessions are JSONL trees; resume uses the session file path when present.
// - custom providers via models.json (Google, xAI, DeepSeek, local, ...)
// - pi also speaks Anthropic/OpenAI natively — an ALL-PI org (e.g. pi + Opus)
//   is a supported first-class profile (docs/PURPOSE.md)
// - degradation to document: no native intra-turn subagent fan-out
import * as path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
  type ExtensionFactory,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import type { Artifact, GateEscalation, Runtime, TurnHooks, TurnRequest, TurnResult } from "../types.js";
import { renderContextBundle, writeMaskedWorktreeFile } from "../worktree-context.js";
import { createPiGateExtension } from "./pi-gate.js";

export type CreatePiAgentSessionFn = (
  options: CreateAgentSessionOptions,
) => Promise<CreateAgentSessionResult>;

export interface PiResourceLoaderFactoryInput {
  cwd: string;
  agentDir: string;
  extensionFactories: ExtensionFactory[];
}

export type PiResourceLoaderFactory = (
  input: PiResourceLoaderFactoryInput,
) => ResourceLoader | Promise<ResourceLoader>;

export interface PiRuntimeOptions {
  createAgentSessionFn?: CreatePiAgentSessionFn;
  resourceLoaderFactory?: PiResourceLoaderFactory;
  sessionManagerFactory?: (req: TurnRequest) => CreateAgentSessionOptions["sessionManager"];
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
  agentDir?: string;
  tools?: string[];
}

type PiModel = NonNullable<CreateAgentSessionOptions["model"]>;
type PiThinkingLevel = NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;

export class PiRuntime implements Runtime {
  readonly kind = "pi" as const;

  private readonly createAgentSessionFn: CreatePiAgentSessionFn;
  private readonly resourceLoaderFactory: PiResourceLoaderFactory;
  private readonly sessionManagerFactory?: PiRuntimeOptions["sessionManagerFactory"];
  private readonly authStorage: AuthStorage;
  private readonly modelRegistry: ModelRegistry;
  private readonly agentDir: string;
  private readonly tools: string[];

  constructor(opts: PiRuntimeOptions = {}) {
    this.agentDir = opts.agentDir ?? getAgentDir();
    this.authStorage = opts.authStorage ?? AuthStorage.create(path.join(this.agentDir, "auth.json"));
    this.modelRegistry =
      opts.modelRegistry ?? ModelRegistry.create(this.authStorage, path.join(this.agentDir, "models.json"));
    this.createAgentSessionFn = opts.createAgentSessionFn ?? createAgentSession;
    this.sessionManagerFactory = opts.sessionManagerFactory;
    this.tools = opts.tools ?? ["read", "bash", "edit", "write"];
    this.resourceLoaderFactory =
      opts.resourceLoaderFactory ??
      (async (input) => {
        const loader = new DefaultResourceLoader({
          cwd: input.cwd,
          agentDir: input.agentDir,
          extensionFactories: input.extensionFactories,
        });
        await loader.reload();
        return loader;
      });
  }

  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    if (req.session !== undefined && req.session.runtime !== "pi") {
      throw new Error(
        `PiRuntime cannot resume a "${req.session.runtime}" session - ` +
          `cross-runtime resume is an orchestrator bug (session id: ${req.session.id})`,
      );
    }

    const startTime = Date.now();
    const escalations: GateEscalation[] = [];
    writeMaskedWorktreeFile(req.workdir, ".pi/APPEND_SYSTEM.md", renderContextBundle(req.context));
    const resourceLoader = await this.resourceLoaderFactory({
      cwd: req.workdir,
      agentDir: this.agentDir,
      extensionFactories: [createPiGateExtension(req.workdir, hooks, escalations)],
    });
    const sessionManager =
      this.sessionManagerFactory?.(req) ??
      (req.session === undefined
        ? SessionManager.create(req.workdir)
        : SessionManager.open(req.session.id, undefined, req.workdir));
    const model = resolvePiModel(this.modelRegistry, req.role.model);
    if (model === undefined) {
      throw new Error(`PiRuntime: model not found in pi registry: ${req.role.model}`);
    }

    const { session } = await this.createAgentSessionFn({
      cwd: req.workdir,
      agentDir: this.agentDir,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      model,
      thinkingLevel: mapPiThinkingLevel(req.role.effort),
      resourceLoader,
      sessionManager,
      tools: this.tools,
    });
    hooks.onProgress?.({ session: { runtime: "pi", id: session.sessionFile ?? session.sessionId } });

    // Per-turn budget guard. pi's SDK has no native running budget knob (unlike
    // Claude's --max-budget-usd), so Operon enforces the cap itself: after each
    // pi turn completes we read the running cost and, once it crosses
    // role.maxTurnBudgetUsd, abort the session gracefully. The overrun then
    // maps to failed + exactly one incident note — mirroring ClaudeRuntime's
    // contract (roles.yaml: "overrun = incident note, not silent spend").
    const cap = req.role.maxTurnBudgetUsd;
    let budgetOverrun = false;
    let abortPromise: Promise<void> | undefined;
    const abortSession = (): void => {
      abortPromise ??= session.abort();
    };
    if (req.signal?.aborted) abortSession();
    else req.signal?.addEventListener("abort", abortSession, { once: true });
    let streamedText = "";
    let assistantFailure: string | undefined;
    const unsubscribe = session.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        streamedText += event.assistantMessageEvent.delta;
      }
      assistantFailure ??= piAssistantFailure(event);
      // Cost accrues at turn boundaries; check the running total there (cheap,
      // and avoids polling stats on every streamed text delta).
      if (!budgetOverrun && event.type === "turn_end" && session.getSessionStats().cost >= cap) {
        budgetOverrun = true;
        abortPromise = session.abort();
      }
      if (event.type === "turn_end") {
        const current = session.getSessionStats();
        hooks.onProgress?.({
          session: { runtime: "pi", id: session.sessionFile ?? session.sessionId },
          usage: {
            tokensIn: current.tokens.input + current.tokens.cacheRead + current.tokens.cacheWrite,
            tokensInUncached: current.tokens.input,
            cacheCreationTokens: current.tokens.cacheWrite,
            cacheReadTokens: current.tokens.cacheRead,
            tokensOut: current.tokens.output,
            costUsd: current.cost,
            subagentTurns: 0,
            wallClockMs: Date.now() - startTime,
            quality: "partial",
          },
        });
      }
    });

    let promptError: unknown;
    try {
      await session.prompt(req.task);
    } catch (error) {
      promptError = error;
    } finally {
      if (abortPromise !== undefined) await abortPromise;
      unsubscribe();
      req.signal?.removeEventListener("abort", abortSession);
      session.dispose();
    }

    const stats = session.getSessionStats();
    // Defensive final check: a single turn can jump past the cap in one step,
    // after which no further boundary fires — treat the final total as an
    // overrun too so the incident note is never silently skipped.
    const overBudget = budgetOverrun || stats.cost >= cap;
    if (promptError !== undefined && !req.signal?.aborted && assistantFailure === undefined) {
      throw promptError;
    }
    const stop = req.signal?.aborted ? piStopDescriptor(req.signal.reason) : undefined;
    const summary = overBudget
      ? `Budget overrun: turn stopped at the per-turn cap — spent $${stats.cost.toFixed(4)} ` +
        `against maxTurnBudgetUsd $${cap} (role ${req.role.name}).`
      : assistantFailure !== undefined
        ? assistantFailure
      : session.getLastAssistantText()?.trim() || streamedText.trim() || "completed";
    // A budget overrun is a hard stop: it fails the turn and emits exactly one
    // incident note, taking precedence over gate escalations that also occurred.
    const artifacts = overBudget
      ? [budgetOverrunNote(session.sessionFile ?? session.sessionId, stats.cost, req)]
      : assistantFailure !== undefined
        ? []
        : piArtifacts(req);
    return {
      status:
        stop?.status ??
        (overBudget || assistantFailure !== undefined
          ? "failed"
          : escalations.length > 0
            ? "blocked_on_gate"
            : "completed"),
      summary: stop?.reason ?? summary,
      artifacts,
      session: { runtime: "pi", id: session.sessionFile ?? session.sessionId },
      usage: {
        tokensIn: stats.tokens.input + stats.tokens.cacheRead + stats.tokens.cacheWrite,
        tokensInUncached: stats.tokens.input,
        cacheCreationTokens: stats.tokens.cacheWrite,
        cacheReadTokens: stats.tokens.cacheRead,
        tokensOut: stats.tokens.output,
        costUsd: stats.cost,
        subagentTurns: 0,
        wallClockMs: Date.now() - startTime,
        quality: stop === undefined ? "complete" : "partial",
      },
      escalations,
      ...(stop !== undefined
        ? { errorCode: stop.errorCode }
        : overBudget
          ? { errorCode: "error_max_budget_usd" }
          : assistantFailure !== undefined
            ? { errorCode: classifyPiFailure(assistantFailure) }
            : {}),
    };
  }
}

function piAssistantFailure(event: unknown): string | undefined {
  if (event === null || typeof event !== "object") return undefined;
  const record = event as Record<string, unknown>;
  if (record["type"] !== "message_end" && record["type"] !== "turn_end") return undefined;
  const message = record["message"];
  if (message === null || typeof message !== "object") return undefined;
  const assistant = message as Record<string, unknown>;
  if (assistant["role"] !== "assistant" || assistant["stopReason"] !== "error") return undefined;
  const detail = assistant["errorMessage"];
  return typeof detail === "string" && detail.trim().length > 0
    ? detail.trim()
    : "pi provider returned a terminal assistant error";
}

function classifyPiFailure(detail: string): string {
  if (/no api key|auth|credential|unauthoriz|not logged in|login|token/i.test(detail)) {
    return "error_auth";
  }
  return "error_provider";
}

function piStopDescriptor(reason: unknown): {
  status: "cancelled" | "timed_out";
  errorCode: string;
  reason: string;
} {
  if (reason !== null && typeof reason === "object") {
    const value = reason as Record<string, unknown>;
    if (
      (value["status"] === "cancelled" || value["status"] === "timed_out") &&
      typeof value["errorCode"] === "string" &&
      typeof value["reason"] === "string"
    ) {
      return {
        status: value["status"],
        errorCode: value["errorCode"],
        reason: value["reason"],
      };
    }
  }
  return {
    status: "cancelled",
    errorCode: "error_cancelled",
    reason: typeof reason === "string" && reason.length > 0 ? reason : "operator cancellation",
  };
}

export function resolvePiModel(registry: ModelRegistry, requested: string): PiModel | undefined {
  const explicitSlash = requested.match(/^([^/]+)\/(.+)$/);
  if (explicitSlash !== null) return registry.find(explicitSlash[1]!, explicitSlash[2]!) as PiModel | undefined;
  const explicitColon = requested.match(/^([^:]+):(.+)$/);
  if (explicitColon !== null) return registry.find(explicitColon[1]!, explicitColon[2]!) as PiModel | undefined;

  return registry.getAll().find((model) => {
    const rec = model as { provider?: string; id?: string };
    return rec.id === requested || `${rec.provider}/${rec.id}` === requested;
  }) as PiModel | undefined;
}

export function mapPiThinkingLevel(effort: TurnRequest["role"]["effort"]): PiThinkingLevel {
  return effort === "max" ? "xhigh" : effort;
}

function budgetOverrunNote(sessionRef: string, costUsd: number, req: TurnRequest): Artifact {
  return {
    kind: "note",
    ref: `budget-overrun/${sessionRef}`,
    summary:
      `Budget overrun: turn stopped at the per-turn cap — spent ` +
      `$${costUsd.toFixed(4)} against maxTurnBudgetUsd ` +
      `$${req.role.maxTurnBudgetUsd} (role ${req.role.name}). ` +
      `Overrun = incident note, not silent spend (roles.yaml).`,
  };
}

function piArtifacts(req: TurnRequest): Artifact[] {
  if (req.role.delegation.allow.length === 0) return [];
  return [
    {
      kind: "note",
      ref: "pi-delegation/no-native-fanout",
      summary:
        "pi has no native intra-turn subagent fan-out; delegation.allow is documented as degraded for this runtime.",
    },
  ];
}
