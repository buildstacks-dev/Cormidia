// Session identity, model resolution, and live turn observation for
// OpencodeRuntime.
//
// OpenCode reports usage per ASSISTANT MESSAGE, not once per turn, and a turn
// that fans out produces assistant messages in child sessions too. The observer
// below tails the server's SSE stream, keeps the latest snapshot per message id
// across the root session and its children, and sums them — so cancellation or
// a crash still settles real spend (core §5, INV-006) and the per-turn cap can
// be enforced as a RUNNING guard rather than a post-mortem.

import type { Effort, SessionHandle, TurnProgress, TurnUsage } from "../types.js";

/** Structural view of the SDK surfaces this module uses. Keeping it structural
 *  means an upstream field addition cannot break the adapter's compile. */
type Envelope<T> = { data?: T | undefined };

interface OpencodeProviderLike {
  id?: string | undefined;
  models?: Record<string, { variants?: Record<string, unknown> | undefined }> | undefined;
}

export interface OpencodeClientLike {
  session: {
    create(parameters: Record<string, unknown>): Promise<Envelope<{ id?: string | undefined }>>;
    get(parameters: Record<string, unknown>): Promise<Envelope<{ id?: string | undefined }>>;
    abort(parameters: Record<string, unknown>): Promise<unknown>;
  };
  config: {
    providers(
      parameters?: Record<string, unknown>,
    ): Promise<Envelope<{ providers?: OpencodeProviderLike[] | undefined }>>;
  };
  event: { subscribe(parameters?: Record<string, unknown>): Promise<{ stream: AsyncIterable<unknown> }> };
}

export class OpencodeSessionResumeMismatchError extends Error {
  readonly code = "error_resume_session_mismatch";
  constructor(requested: string, restored: string) {
    super(
      `OpencodeRuntime: resume requested session ${JSON.stringify(requested)} but the server restored ` +
        `${JSON.stringify(restored)} — a resume must bind the exact prior session; failing closed pre-spend`,
    );
    this.name = "OpencodeSessionResumeMismatchError";
  }
}

export class OpencodeModelUnavailableError extends Error {
  readonly code = "error_adapter_misconfigured";
  constructor(model: string, detail: string) {
    super(`OpencodeRuntime: model ${JSON.stringify(model)} is not served by this install: ${detail}`);
    this.name = "OpencodeModelUnavailableError";
  }
}

/** OpenCode model ids are `provider/model`; the split is exact, never guessed. */
export function parseOpencodeModelRef(model: string): { providerID: string; modelID: string } {
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) {
    throw new OpencodeModelUnavailableError(model, "expected an exact provider/model identifier");
  }
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) };
}

/** Token-free variant roster for the exact assigned model. A retired or
 *  misspelled id is a typed refusal here, before the provider is constructed. */
export async function readOpencodeModelVariants(
  client: OpencodeClientLike,
  directory: string,
  ref: { providerID: string; modelID: string },
): Promise<string[]> {
  const response = await client.config.providers({ directory });
  const providers = response.data?.providers ?? [];
  const provider = providers.find((entry) => entry.id === ref.providerID);
  if (provider === undefined) {
    throw new OpencodeModelUnavailableError(
      `${ref.providerID}/${ref.modelID}`,
      `provider ${JSON.stringify(ref.providerID)} is not configured (available: ${providers
        .map((entry) => entry.id ?? "?")
        .join(", ")})`,
    );
  }
  const model = provider.models?.[ref.modelID];
  if (model === undefined) {
    throw new OpencodeModelUnavailableError(`${ref.providerID}/${ref.modelID}`, "model id absent from the roster");
  }
  return Object.keys(model.variants ?? {});
}

/** Create a fresh session, or bind the exact prior one. */
export async function resolveOpencodeSessionId(
  client: OpencodeClientLike,
  directory: string,
  session: SessionHandle | undefined,
): Promise<string> {
  if (session === undefined) {
    const created = await client.session.create({ directory, title: "cormidia turn" });
    const id = created.data?.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("OpencodeRuntime: the server created no session id");
    }
    return id;
  }
  const existing = await client.session.get({ sessionID: session.id, directory });
  const id = existing.data?.id;
  if (typeof id !== "string" || id !== session.id) {
    throw new OpencodeSessionResumeMismatchError(session.id, typeof id === "string" ? id : "<none>");
  }
  return id;
}

interface MessageUsage {
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Tails the server event stream for one turn. */
export class OpencodeTurnObserver {
  private readonly messages = new Map<string, MessageUsage>();
  private readonly sessions: Set<string>;
  private stopped = false;
  private aborting: Promise<unknown> | undefined;
  budgetOverrun = false;
  providerError: string | undefined;

  constructor(
    private readonly input: {
      client: OpencodeClientLike;
      directory: string;
      rootSessionId: string;
      capUsd: number;
      startedAt: number;
      /** Fan-out observed at the gate bridge — the only place a `task` spawn
       *  is visible, and never allowed to stay silent (INV-006). */
      subagentTurns: () => number;
      onProgress?: ((progress: TurnProgress) => void) | undefined;
    },
  ) {
    this.sessions = new Set([input.rootSessionId]);
  }

  /** Begin tailing. Resolves once the stream is open so no early event is lost. */
  async start(): Promise<void> {
    const events = await this.input.client.event.subscribe({ directory: this.input.directory });
    void (async () => {
      try {
        for await (const event of events.stream) {
          if (this.stopped) return;
          this.consume(event);
        }
      } catch {
        // A dropped stream is not a completion: usage already observed stays,
        // and the terminal prompt response remains the authority for the turn.
      }
    })();
  }

  stop(): void {
    this.stopped = true;
  }

  abortSession(): Promise<unknown> {
    this.aborting ??= this.input.client.session
      .abort({ sessionID: this.input.rootSessionId, directory: this.input.directory })
      .catch(() => undefined);
    return this.aborting;
  }

  /** Fold one assistant message snapshot in (idempotent per message id). */
  record(message: unknown): void {
    const info = asRecord(message);
    if (info === undefined || info["role"] !== "assistant") return;
    const id = typeof info["id"] === "string" ? info["id"] : undefined;
    const sessionID = typeof info["sessionID"] === "string" ? info["sessionID"] : undefined;
    if (id === undefined || sessionID === undefined || !this.sessions.has(sessionID)) return;
    const tokens = asRecord(info["tokens"]);
    if (tokens === undefined) {
      // The server reported no usage block for this message. Absent is UNKNOWN,
      // never zero (INV-006): recording it would turn silence into a claim.
      this.recordError(info);
      return;
    }
    const cache = asRecord(tokens["cache"]) ?? {};
    this.messages.set(id, {
      cost: numberOf(info["cost"]),
      input: numberOf(tokens["input"]),
      output: numberOf(tokens["output"]),
      cacheRead: numberOf(cache["read"]),
      cacheWrite: numberOf(cache["write"]),
    });
    this.recordError(info);
  }

  private recordError(info: Record<string, unknown>): void {
    const error = asRecord(info["error"]);
    if (error === undefined || typeof error["name"] !== "string" || error["name"] === "MessageAbortedError") return;
    const data = asRecord(error["data"]);
    this.providerError ??= `${error["name"]}: ${typeof data?.["message"] === "string" ? data["message"] : "no detail"}`;
  }

  /** True once any usage was observed — the INV-006 "unknown vs zero" pivot. */
  get observed(): boolean {
    return this.messages.size > 0;
  }

  usage(quality: TurnUsage["quality"]): TurnUsage {
    let cost = 0;
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    for (const entry of this.messages.values()) {
      cost += entry.cost;
      input += entry.input;
      output += entry.output;
      cacheRead += entry.cacheRead;
      cacheWrite += entry.cacheWrite;
    }
    return {
      tokensIn: input + cacheRead + cacheWrite,
      tokensInUncached: input,
      cacheCreationTokens: cacheWrite,
      cacheReadTokens: cacheRead,
      tokensOut: output,
      costUsd: cost,
      // OpenCode derives dollars from the models.dev catalog rather than a
      // provider billing response, so the figure is never claimed as
      // provider-authoritative spend (TurnUsage.costEstimated).
      costEstimated: true,
      subagentTurns: this.input.subagentTurns(),
      wallClockMs: Date.now() - this.input.startedAt,
      // Tokens measured but dollars zero means the catalog prices this
      // model/auth tier at nothing, not that the turn was free to run. That is
      // an incomplete snapshot, never an authoritative "complete" one.
      ...(quality === "complete" && cost === 0 && input + output + cacheRead + cacheWrite > 0
        ? { quality: "partial" as const }
        : quality === undefined
          ? {}
          : { quality }),
    };
  }

  private consume(event: unknown): void {
    const record = asRecord(event);
    const properties = asRecord(record?.["properties"]);
    if (record?.["type"] === "session.created") {
      const info = asRecord(properties?.["info"]);
      const parentID = typeof info?.["parentID"] === "string" ? info["parentID"] : undefined;
      const id = typeof info?.["id"] === "string" ? info["id"] : undefined;
      if (id !== undefined && parentID !== undefined && this.sessions.has(parentID)) this.sessions.add(id);
      return;
    }
    if (record?.["type"] !== "message.updated") return;
    this.record(properties?.["info"]);
    this.input.onProgress?.({
      session: { runtime: "opencode", id: this.input.rootSessionId },
      usage: this.usage("partial"),
    });
    if (!this.budgetOverrun && this.usage("partial").costUsd >= this.input.capUsd) {
      this.budgetOverrun = true;
      void this.abortSession();
    }
  }
}

/** Terminal provider failures are evidence: auth is classified distinctly. */
export function classifyOpencodeFailure(detail: string): string {
  if (/ProviderAuthError|unauthoriz|invalid[_ ]api[_ ]key|not logged in|credential|expired/i.test(detail)) {
    return "error_auth";
  }
  if (/StructuredOutputError/i.test(detail)) return "error_max_structured_output_retries";
  if (/ContextOverflowError|MessageOutputLengthError/i.test(detail)) return "error_context_overflow";
  if (/^transport:/i.test(detail)) return "error_transport";
  if (/^malformed output/i.test(detail)) return "error_malformed_output";
  return "error_provider";
}

/** OpenCode variants and Cormidia efforts share a vocabulary; the check is a
 *  lookup performed by opencode-config.ts. Re-exported name kept local so the
 *  effort type stays imported here for the adapter's signature. */
export type OpencodeEffort = Effort;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
