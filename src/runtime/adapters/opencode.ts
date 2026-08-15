// Generic multi-model backbone → OpenCode, driven as a per-turn headless
// server (`opencode serve`) plus `@opencode-ai/sdk`'s generated v2 client.
//
// Integration facts, all verified against the operator's installed opencode
// 1.18.15 on 2026-08-07 (research/adapters/2026-08-07_opencode-adapter-certification.md):
// - Cormidia NEVER installs opencode (#224). The binary is the operator's; the
//   adapter spawns it, binds to that exact process, and readiness answers for
//   usable auth rather than mere presence.
// - THE GATE CHANNEL IS THE `tool.execute.before` PLUGIN HOOK. It is in-process,
//   fires for every tool in every session including subagent child sessions, and
//   a throw blocks the call pre-execution. `--auto` bypasses only the permission
//   ask layer, never this hook, and a configured `ask` auto-REJECTS headlessly —
//   so config permissions are shaping (deny-by-default) and the hook is the
//   enforcement. F-PT-025 also proved a bash-only gate is no gate: with bash
//   blocked the model got the same effect through `read`. Every tool crosses.
// - The task travels as a JSON request body (`parts[].text`), never argv.
// - ContextBundle rides the native `instructions` config channel, pointed at a
//   git-excluded file in the workdir (the shape pi uses for APPEND_SYSTEM.md).
// - Usage is per assistant message with catalog-derived dollars; effort is the
//   per-model `variant`. The native json_schema verdict format is published but
//   unusable (see below), and there is no max-turns knob, so `verdictSchema` and
//   `maxTurns` are both left to the loop.

import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { resolveTurnRequestAssignment } from "../assignment.js";
import { withNonInteractiveEnv } from "../non-interactive-env.js";
import type { Artifact, GateEscalation, Runtime, TurnHooks, TurnRequest, TurnResult, TurnUsage } from "../types.js";
import { renderContextBundle, writeMaskedWorktreeFile } from "../worktree-context.js";
import { buildOpencodeInlineConfig, resolveOpencodeVariant } from "./opencode-config.js";
import { startOpencodeGateBridge } from "./opencode-gate-bridge.js";
import { OpencodeServerIdentityError, startOpencodeServer, type OpencodeServer } from "./opencode-server.js";
import {
  classifyOpencodeFailure,
  OpencodeTurnObserver,
  parseOpencodeModelRef,
  readOpencodeModelVariants,
  resolveOpencodeSessionId,
} from "./opencode-session.js";

/** Git-excluded native context file inside the turn's workdir. */
export const OPENCODE_CONTEXT_FILE = ".opencode/cormidia-context.md";

const DEFAULT_SERVER_START_MS = 60_000;
const DEFAULT_GATE_HANDSHAKE_MS = 30_000;

interface OpencodeRuntimeOptions {
  /** Injection seam for the transport double; defaults to the real launcher. */
  provisionFn?: (input: {
    workdir: string;
    inlineConfig: unknown;
    bridgeEnv: NodeJS.ProcessEnv;
    extraEnv?: NodeJS.ProcessEnv;
    startTimeoutMs: number;
  }) => Promise<OpencodeServer>;
  /** Injection seam for the generated client; defaults to createOpencodeClient. */
  clientFactory?: (input: { baseUrl: string; directory: string }) => ReturnType<typeof createOpencodeClient>;
  serverStartTimeoutMs?: number;
  gateHandshakeTimeoutMs?: number;
}

export class OpencodeRuntime implements Runtime {
  readonly kind = "opencode" as const;

  private readonly options: OpencodeRuntimeOptions;

  constructor(options: OpencodeRuntimeOptions = {}) {
    this.options = options;
  }

  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    const assignment = resolveTurnRequestAssignment(req, this.kind);
    if (req.session !== undefined && req.session.runtime !== "opencode") {
      throw new Error(
        `OpencodeRuntime cannot resume a "${req.session.runtime}" session — ` +
          `cross-runtime resume is an orchestrator bug (session id: ${req.session.id})`,
      );
    }

    const startedAt = Date.now();
    const escalations: GateEscalation[] = [];
    const context = writeMaskedWorktreeFile(req.workdir, OPENCODE_CONTEXT_FILE, renderContextBundle(req.context));
    const bridge = await startOpencodeGateBridge(req.workdir, hooks, escalations);
    let server: OpencodeServer | undefined;
    let observer: OpencodeTurnObserver | undefined;
    let detachAbort: (() => void) | undefined;

    try {
      server = await (this.options.provisionFn ?? startOpencodeServer)({
        workdir: req.workdir,
        inlineConfig: buildOpencodeInlineConfig({
          roleName: req.role.name,
          networkAccess: req.networkAccess === true,
          pluginUrl: opencodeGatePluginUrl(),
          instructionFiles: [context.path],
        }),
        bridgeEnv: bridge.env,
        extraEnv: withNonInteractiveEnv({}),
        startTimeoutMs: this.options.serverStartTimeoutMs ?? DEFAULT_SERVER_START_MS,
      });
      const client = (this.options.clientFactory ?? defaultClientFactory)({
        baseUrl: server.url,
        directory: req.workdir,
      });

      // Touching the session materializes the app instance for this workdir,
      // which is what loads the gate plugin. The event stream is opened next,
      // BEFORE the activation wait: the plugin proves itself through a hook the
      // server invokes, and an idle server emits nothing to invoke it with.
      const sessionId = await resolveOpencodeSessionId(client, req.workdir, req.session);
      observer = new OpencodeTurnObserver({
        client,
        directory: req.workdir,
        rootSessionId: sessionId,
        capUsd: req.role.maxTurnBudgetUsd,
        startedAt,
        subagentTurns: () => bridge.subagentTurns(),
        onProgress: hooks.onProgress,
      });
      await observer.start();

      const handshake = await bridge.whenActive(this.options.gateHandshakeTimeoutMs ?? DEFAULT_GATE_HANDSHAKE_MS);
      if (server.pid > 0 && handshake.pid > 0 && handshake.pid !== server.pid) {
        throw new OpencodeServerIdentityError(server.pid, handshake.pid, server.url);
      }
      hooks.onProgress?.({ session: { runtime: "opencode", id: sessionId } });

      const ref = parseOpencodeModelRef(assignment.model);
      const variant = resolveOpencodeVariant(
        assignment.model,
        assignment.effort,
        await readOpencodeModelVariants(client, req.workdir, ref),
      );

      const active = observer;
      const abort = (): void => void active.abortSession();
      if (req.signal?.aborted) abort();
      else req.signal?.addEventListener("abort", abort, { once: true });
      detachAbort = () => req.signal?.removeEventListener("abort", abort);

      let answer: Awaited<ReturnType<typeof client.session.prompt>> | undefined;
      let transportError: string | undefined;
      try {
        // No `format` field: requesting the server's native json_schema output
        // put a one-step review into a five-minute retry loop that returned no
        // assistant message (certification 2026-08-07), so the profile records
        // `structured_verdict: fallback` and the loop parses leniently.
        answer = await client.session.prompt({
          sessionID: sessionId,
          directory: req.workdir,
          model: ref,
          variant,
          parts: [{ type: "text", text: req.task }],
        });
      } catch (error) {
        // Lost response: the turn may have continued server-side. That is
        // execution ambiguity with whatever usage was observed — never a
        // fabricated completion (CORMIDIA-C-B23-001, events).
        transportError = `transport: ${error instanceof Error ? error.message : String(error)}`;
      }
      const info = answer?.data?.info;
      if (info !== undefined) observer.record(info);

      return this.settle({
        req,
        sessionId,
        observer,
        escalations,
        info,
        parts: answer?.data?.parts,
        ...(transportError === undefined ? {} : { transportError }),
      });
    } finally {
      detachAbort?.();
      observer?.stop();
      await server?.close();
      await bridge.close();
    }
  }

  private settle(input: {
    req: TurnRequest;
    sessionId: string;
    observer: OpencodeTurnObserver;
    escalations: GateEscalation[];
    info: { error?: unknown; structured?: unknown } | undefined;
    parts: unknown;
    transportError?: string;
  }): TurnResult {
    const { req, sessionId, observer, escalations } = input;
    const cancelled = req.signal?.aborted === true;
    const malformed =
      input.transportError === undefined && input.info === undefined
        ? "malformed output: the server returned no assistant message for this turn"
        : undefined;
    const failure = input.transportError ?? observer.providerError ?? messageError(input.info) ?? malformed;
    const overBudget =
      observer.budgetOverrun || (observer.observed && observer.usage("partial").costUsd >= req.role.maxTurnBudgetUsd);
    const usage = observer.usage(
      !observer.observed ? "unavailable" : cancelled || overBudget || failure !== undefined ? "partial" : "complete",
    );
    const session = { runtime: "opencode" as const, id: sessionId };
    if (cancelled) {
      return {
        status: "cancelled",
        errorCode: "error_cancelled",
        summary:
          typeof req.signal?.reason === "string" && req.signal.reason.length > 0
            ? req.signal.reason
            : "operator cancellation",
        artifacts: [],
        session,
        usage,
        escalations,
      };
    }
    if (overBudget) {
      const note = budgetOverrunNote(sessionId, usage, req);
      return {
        status: "failed",
        errorCode: "error_max_budget_usd",
        summary: note.summary,
        artifacts: [note],
        session,
        usage,
        escalations,
      };
    }
    if (failure !== undefined) {
      return {
        status: "failed",
        errorCode: classifyOpencodeFailure(failure),
        summary: failure,
        artifacts: [],
        session,
        usage,
        escalations,
      };
    }
    return {
      status: escalations.length > 0 ? "blocked_on_gate" : "completed",
      summary: summaryOf(input.info, input.parts),
      artifacts: [],
      session,
      usage,
      escalations,
    };
  }
}

/** Absolute `file://` URL of the in-server gate plugin, in source or dist mode. */
export function opencodeGatePluginUrl(): string {
  const here = import.meta.url;
  return here.replace(/opencode\.(ts|js)$/, (_match, extension: string) => `opencode-gate-plugin.${extension}`);
}

function defaultClientFactory(input: { baseUrl: string; directory: string }): ReturnType<typeof createOpencodeClient> {
  return createOpencodeClient({ baseUrl: input.baseUrl, directory: input.directory });
}

function messageError(info: { error?: unknown } | undefined): string | undefined {
  const error = asRecord(info?.error);
  if (error === undefined) return undefined;
  const name = typeof error["name"] === "string" ? error["name"] : "UnknownError";
  if (name === "MessageAbortedError") return undefined;
  const message = asRecord(error["data"])?.["message"];
  return `${name}: ${typeof message === "string" ? message : "no detail"}`;
}

/** Provider prose passes through verbatim (INV-012). A structured value is
 *  rendered if the server returns one, but this adapter never requests it. */
function summaryOf(info: { structured?: unknown } | undefined, parts: unknown): string {
  if (info?.structured !== undefined) {
    const encoded = JSON.stringify(info.structured);
    if (encoded !== undefined) return encoded;
  }
  const text = (Array.isArray(parts) ? parts : [])
    .map(asRecord)
    .filter((part) => part?.["type"] === "text" && typeof part["text"] === "string" && part["synthetic"] !== true)
    .map((part) => String(part!["text"]))
    .join("\n")
    .trim();
  return text.length > 0 ? text : "completed";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function budgetOverrunNote(sessionId: string, usage: TurnUsage, req: TurnRequest): Artifact {
  return {
    kind: "note",
    ref: `budget-overrun/${sessionId}`,
    summary:
      `Budget overrun: turn stopped at the per-turn cap — spent $${usage.costUsd.toFixed(4)} against ` +
      `maxTurnBudgetUsd $${req.role.maxTurnBudgetUsd} (role ${req.role.name}). ` +
      `Overrun = incident note, not silent spend (roles.yaml).`,
  };
}
