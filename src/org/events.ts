// Event polling, dedup keys, and file-drop inbox (architecture.md §2).

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppEntry } from "./apps.js";
import { parseCompanyLifecycleEvent, type CompanyEventKind } from "./event-schemas.js";
import { writeFileAtomic } from "./atomic.js";

/** Transport kinds: GitHub-polled kinds plus the file-drop `alert-webhook`
 *  inbox transport. `alert-webhook` remains the dedup/transport identity for
 *  inbox files; the *routed* kind is the parsed company-lifecycle kind. */
export type EventKind =
  | "ticket-ready"
  | "pr-opened"
  | "ci-failed"
  | "release-shipped"
  | "alert-webhook";

/** The kind a role's trigger matches on. GitHub events keep their transport
 *  kind; file-drop inbox events carry the parsed company-lifecycle kind
 *  (docs/event-schemas.md) so roles.yaml stays the source of truth for who
 *  subscribes to `support-feedback` / `adoption-signal` / `health-alert` /
 *  `launch-calendar`. */
export type RoutedEventKind = EventKind | CompanyEventKind;

export interface DueEvent {
  kind: RoutedEventKind;
  key: string;
  app: string;
  payload: Record<string, unknown>;
}

export interface EventPollError {
  code: "error_event_source";
  app: string;
  kind: EventKind;
  message: string;
}

export interface PollEventsResult {
  events: DueEvent[];
  errors: EventPollError[];
}

export interface GitHubEventSource {
  ticketReady(app: AppEntry): Promise<{ issueNumber: number }[]>;
  prOpened(app: AppEntry): Promise<{ prNumber: number; headSha: string }[]>;
  ciFailed(app: AppEntry): Promise<{ sha: string; check: string }[]>;
  releaseShipped(app: AppEntry): Promise<{ tag: string }[]>;
}

export const EVENT_KINDS: EventKind[] = [
  "ticket-ready",
  "pr-opened",
  "ci-failed",
  "release-shipped",
  "alert-webhook",
];

export function dedupKey(kind: EventKind, payload: Record<string, unknown>): string {
  switch (kind) {
    case "ticket-ready":
      return `ticket-ready:${mustNumber(payload, "issueNumber")}`;
    case "pr-opened":
      return `pr-opened:${mustNumber(payload, "prNumber")}@${mustString(payload, "headSha")}`;
    case "ci-failed":
      return `ci-failed:${mustString(payload, "sha")}:${mustString(payload, "check")}`;
    case "release-shipped":
      return `release:${mustString(payload, "tag")}`;
    case "alert-webhook":
      return mustString(payload, "filename");
  }
}

export class EventStore {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async poll(app: AppEntry, source: GitHubEventSource): Promise<PollEventsResult> {
    await this.ensure();
    const consumed = new Set(await this.readConsumed());
    const events: DueEvent[] = [];
    const errors: EventPollError[] = [];

    for (const kind of EVENT_KINDS) {
      if (kind === "alert-webhook") continue;
      try {
        for (const payload of await this.pollKind(kind, app, source)) {
          const key = dedupKey(kind, payload);
          if (!consumed.has(key)) events.push({ kind, key, app: app.name, payload });
        }
      } catch (error) {
        errors.push({
          code: "error_event_source",
          app: app.name,
          kind,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const inbox = await this.readInbox(app.name, consumed);
    events.push(...inbox.events);
    errors.push(...inbox.errors);

    return { events, errors };
  }

  async readConsumed(): Promise<string[]> {
    const path = this.consumedPath();
    if (!existsSync(path)) return [];
    try {
      return JSON.parse(await readFile(path, "utf8")) as string[];
    } catch (error) {
      // A torn dedup file must never halt the whole tick. Atomic writes make
      // this unreachable in practice; treat a corrupt file as empty so the
      // dispatcher keeps running (the next markConsumed rewrites it cleanly).
      console.warn(`events: consumed.json unreadable, treating as empty: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  async markConsumed(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.ensure();
    const consumed = new Set(await this.readConsumed());
    for (const key of keys) consumed.add(key);
    await writeFileAtomic(this.consumedPath(), `${JSON.stringify([...consumed].sort(), null, 2)}\n`);
  }

  /** Read the file-drop inbox, parsing each payload's company-lifecycle kind
   *  (docs/event-schemas.md) so the dispatcher can route by kind. Already
   *  consumed files are skipped. A malformed payload (bad JSON or a payload
   *  that fails the company-event contract) is surfaced LOUDLY as an
   *  `error_event_source` — never silently dropped — while sibling files keep
   *  flowing. */
  async readInbox(
    app: string,
    consumed: ReadonlySet<string> = new Set(),
  ): Promise<PollEventsResult> {
    await this.ensure();
    const dir = this.inboxDir();
    const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
    const events: DueEvent[] = [];
    const errors: EventPollError[] = [];
    for (const file of files) {
      if (consumed.has(file)) continue;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(await readFile(join(dir, file), "utf8")) as Record<string, unknown>;
      } catch (error) {
        errors.push(inboxError(app, file, error));
        continue;
      }
      let event: ReturnType<typeof parseCompanyLifecycleEvent>;
      try {
        event = parseCompanyLifecycleEvent(payload);
      } catch (error) {
        errors.push(inboxError(app, file, error));
        continue;
      }
      if (event.app !== app) continue;
      events.push({ kind: event.kind, key: file, app: event.app, payload: { ...payload, filename: file } });
    }
    return { events, errors };
  }

  async removeInboxFile(filename: string): Promise<void> {
    await rm(join(this.inboxDir(), filename), { force: true });
  }

  private async pollKind(
    kind: Exclude<EventKind, "alert-webhook">,
    app: AppEntry,
    source: GitHubEventSource,
  ): Promise<Record<string, unknown>[]> {
    switch (kind) {
      case "ticket-ready":
        return source.ticketReady(app);
      case "pr-opened":
        return source.prOpened(app);
      case "ci-failed":
        return source.ciFailed(app);
      case "release-shipped":
        return source.releaseShipped(app);
    }
  }

  private async ensure(): Promise<void> {
    await mkdir(this.inboxDir(), { recursive: true });
    await mkdir(dirname(this.consumedPath()), { recursive: true });
    if (!existsSync(this.consumedPath())) await writeFile(this.consumedPath(), "[]\n", "utf8");
  }

  private inboxDir(): string {
    return join(this.root, "state", "events", "inbox");
  }

  private consumedPath(): string {
    return join(this.root, "state", "events", "consumed.json");
  }
}

function inboxError(app: string, file: string, error: unknown): EventPollError {
  return {
    code: "error_event_source",
    app,
    kind: "alert-webhook",
    message: `inbox ${file}: ${error instanceof Error ? error.message : String(error)}`,
  };
}

function mustString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`event payload missing string ${key}`);
  }
  return value;
}

function mustNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`event payload missing number ${key}`);
  }
  return value;
}
