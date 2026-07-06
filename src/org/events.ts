// Event polling, dedup keys, and file-drop inbox (architecture.md §2).

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppEntry } from "./apps.js";

export type EventKind =
  | "ticket-ready"
  | "pr-opened"
  | "ci-failed"
  | "release-shipped"
  | "alert-webhook";

export interface DueEvent {
  kind: EventKind;
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

    for (const event of await this.readInbox(app.name)) {
      if (!consumed.has(event.key)) events.push(event);
    }

    return { events, errors };
  }

  async readConsumed(): Promise<string[]> {
    const path = this.consumedPath();
    if (!existsSync(path)) return [];
    return JSON.parse(await readFile(path, "utf8")) as string[];
  }

  async markConsumed(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.ensure();
    const consumed = new Set(await this.readConsumed());
    for (const key of keys) consumed.add(key);
    await writeFile(this.consumedPath(), `${JSON.stringify([...consumed].sort(), null, 2)}\n`, "utf8");
  }

  async readInbox(app: string): Promise<DueEvent[]> {
    await this.ensure();
    const dir = this.inboxDir();
    const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
    const events: DueEvent[] = [];
    for (const file of files) {
      const payload = JSON.parse(await readFile(join(dir, file), "utf8")) as Record<string, unknown>;
      events.push({
        kind: "alert-webhook",
        key: file,
        app,
        payload: { ...payload, filename: file },
      });
    }
    return events;
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
