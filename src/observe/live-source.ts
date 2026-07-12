import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import type { ServerResponse } from "node:http";
import type { AppsFile } from "../org/apps.js";
import { indexLocalSources } from "./file-index.js";
import { GhObserveSource, type ObserveGitHubSource } from "./github-source.js";
import { projectObserveSnapshot } from "./project.js";
import type { GitHubAppSnapshot, ObserveFiltersV1, ObserveSnapshotV1, SourceHealthView } from "./types.js";

export interface ObserveServiceOptions {
  orgName: string;
  stateHome: string;
  appsFile: AppsFile;
  filters?: ObserveFiltersV1;
  githubSource?: ObserveGitHubSource;
  reconcileMs?: number;
  githubPollMs?: number;
  heartbeatMs?: number;
  replayLimit?: number;
  clock?: () => Date;
  watchFiles?: boolean;
}

interface ReplayEvent {
  cursor: number;
  type: "entity.upsert" | "source.health";
  data: unknown;
}

interface Client {
  response: ServerResponse;
  ping: NodeJS.Timeout;
}

export class ObserveService {
  readonly stateHome: string;
  private readonly options: Required<Pick<ObserveServiceOptions, "reconcileMs" | "githubPollMs" | "heartbeatMs" | "replayLimit" | "watchFiles">> & ObserveServiceOptions;
  private readonly clock: () => Date;
  private github: GitHubAppSnapshot[] = [];
  private githubHealth: SourceHealthView | undefined;
  private snapshotValue: ObserveSnapshotV1 | undefined;
  private fingerprint = "";
  private cursor = 0;
  private replay: ReplayEvent[] = [];
  private clients = new Set<Client>();
  private reconciliation: NodeJS.Timeout | undefined;
  private githubPoll: NodeJS.Timeout | undefined;
  private watcher: FSWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private rebuilding: Promise<void> = Promise.resolve();

  constructor(options: ObserveServiceOptions) {
    this.stateHome = options.stateHome;
    this.options = {
      ...options,
      reconcileMs: options.reconcileMs ?? 5_000,
      githubPollMs: options.githubPollMs ?? 20_000,
      heartbeatMs: options.heartbeatMs ?? 15_000,
      replayLimit: options.replayLimit ?? 256,
      watchFiles: options.watchFiles ?? true,
    };
    this.clock = options.clock ?? (() => new Date());
  }

  async start(): Promise<void> {
    await this.refreshGithub();
    await this.rebuild(true);
    this.reconciliation = setInterval(() => this.queueRebuild(), this.options.reconcileMs);
    this.reconciliation.unref();
    this.githubPoll = setInterval(() => void this.refreshGithub().then(() => this.queueRebuild()), this.options.githubPollMs);
    this.githubPoll.unref();
    if (this.options.watchFiles) this.startWatcher();
  }

  async stop(): Promise<void> {
    if (this.reconciliation !== undefined) clearInterval(this.reconciliation);
    if (this.githubPoll !== undefined) clearInterval(this.githubPoll);
    if (this.debounce !== undefined) clearTimeout(this.debounce);
    this.watcher?.close();
    for (const client of this.clients) {
      clearInterval(client.ping);
      client.response.end();
    }
    this.clients.clear();
    await this.rebuilding;
  }

  snapshot(): ObserveSnapshotV1 {
    if (this.snapshotValue === undefined) throw new Error("observe service has not started");
    return this.snapshotValue;
  }

  subscribe(response: ServerResponse, requestedCursor?: string): () => void {
    const parsed = requestedCursor === undefined ? undefined : parseCursor(requestedCursor);
    if (requestedCursor !== undefined && parsed === undefined) {
      writeSse(response, this.cursor, "resync", { reason: "invalid_cursor" });
    } else if (parsed === undefined) {
      writeSse(response, this.cursor, "snapshot", this.snapshot());
    } else {
      const oldest = this.replay[0]?.cursor ?? this.cursor;
      if (parsed < oldest - 1 || parsed > this.cursor) {
        writeSse(response, this.cursor, "resync", { reason: "cursor_outside_replay", oldest_cursor: String(oldest) });
      } else {
        for (const event of this.replay.filter((candidate) => candidate.cursor > parsed)) {
          writeSse(response, event.cursor, event.type, event.data);
        }
      }
    }
    const client: Client = {
      response,
      ping: setInterval(() => {
        if (!response.writableEnded) response.write(`: heartbeat ${this.clock().toISOString()}\n\n`);
      }, this.options.heartbeatMs),
    };
    client.ping.unref();
    this.clients.add(client);
    const close = (): void => {
      clearInterval(client.ping);
      this.clients.delete(client);
    };
    response.on("close", close);
    return close;
  }

  async reconcileNow(): Promise<void> {
    await this.rebuild(false);
  }

  async refreshGithubNow(): Promise<void> {
    await this.refreshGithub();
    await this.rebuild(false);
  }

  /** Close only observer streams. Durable Operon work is not consulted or
   * changed; browsers reconnect with their cursor. Useful for controlled
   * maintenance and reconnect verification. */
  disconnectClients(): void {
    for (const client of [...this.clients]) {
      clearInterval(client.ping);
      client.response.end();
      this.clients.delete(client);
    }
  }

  private queueRebuild(): void {
    this.rebuilding = this.rebuilding.then(() => this.rebuild(false)).catch(() => undefined);
  }

  private async rebuild(initial: boolean): Promise<void> {
    const local = await indexLocalSources({
      orgName: this.options.orgName,
      stateHome: this.options.stateHome,
      appsFile: this.options.appsFile,
      filters: this.options.filters ?? {},
      now: this.clock(),
    });
    const sources = [...local.source_health, this.githubHealth ?? defaultGithubHealth(this.clock())];
    const candidate = projectObserveSnapshot({
      ...local,
      cursor: String(this.cursor),
      github: this.github,
      source_health: sources,
    });
    const fingerprint = contentHash(candidate);
    if (initial || fingerprint !== this.fingerprint) {
      this.fingerprint = fingerprint;
      if (!initial) this.cursor += 1;
      candidate.cursor = String(this.cursor);
      this.snapshotValue = candidate;
      if (!initial) this.publish("entity.upsert", { entity_type: "snapshot", entity_id: "snapshot", snapshot: candidate });
    } else {
      candidate.cursor = String(this.cursor);
      this.snapshotValue = candidate;
    }
  }

  private publish(type: ReplayEvent["type"], data: unknown): void {
    const event = { cursor: this.cursor, type, data };
    this.replay.push(event);
    if (this.replay.length > this.options.replayLimit) this.replay.splice(0, this.replay.length - this.options.replayLimit);
    for (const client of this.clients) {
      if (!client.response.writableEnded) writeSse(client.response, event.cursor, event.type, event.data);
    }
  }

  private async refreshGithub(): Promise<void> {
    const source = this.options.githubSource ?? new GhObserveSource();
    const result = await source.read(this.options.appsFile.apps, this.clock());
    const previous = new Map(this.github.map((app) => [app.app, app]));
    this.github = result.apps.map((app) => {
      const prior = previous.get(app.app);
      return app.error !== undefined && prior !== undefined
        ? { ...prior, observed_at: app.observed_at, error: app.error }
        : app;
    });
    const changed = this.githubHealth?.status !== result.health.status || this.githubHealth?.detail !== result.health.detail;
    this.githubHealth = result.health;
    if (changed && this.snapshotValue !== undefined) {
      this.cursor += 1;
      this.publish("source.health", result.health);
    }
  }

  private startWatcher(): void {
    try {
      this.watcher = watch(this.options.stateHome, { recursive: true }, () => {
        if (this.debounce !== undefined) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => this.queueRebuild(), 75);
      });
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = undefined;
      });
    } catch {
      // Periodic reconciliation remains the correctness path on platforms
      // without recursive filesystem notifications.
    }
  }
}

function contentHash(snapshot: ObserveSnapshotV1): string {
  return createHash("sha256").update(JSON.stringify(stripVolatile(snapshot))).digest("hex");
}

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (["generated_at", "cursor", "observed_at", "last_success_at", "liveness_reason"].includes(key)) continue;
    out[key] = stripVolatile(child);
  }
  return out;
}

function parseCursor(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function writeSse(response: ServerResponse, cursor: number, type: string, data: unknown): void {
  response.write(`id: ${cursor}\n`);
  response.write(`event: ${type}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function defaultGithubHealth(now: Date): SourceHealthView {
  return {
    id: "github",
    status: "unavailable",
    observed_at: now.toISOString(),
    last_success_at: null,
    detail: "GitHub projection has not completed",
  };
}
