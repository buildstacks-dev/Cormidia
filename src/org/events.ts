// Event polling, dedup keys, and file-drop inbox (architecture.md §2).

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppEntry } from "./apps.js";
import { writeFileAtomic } from "./atomic.js";
import {
  CompanyEventValidationError,
  parseCompanyLifecycleEvent,
  type CompanyEventKind,
  type CompanyEventValidationCode,
} from "./event-schemas.js";
import { sha256, stableJson } from "./lifecycle.js";

/** GitHub transports plus the company-lifecycle file-drop transport. */
export type EventKind = "ticket-ready" | "pr-opened" | "ci-failed" | "release-shipped" | "alert-webhook";

/** Trigger-visible transport or parsed company-lifecycle kind. */
type RoutedEventKind = EventKind | CompanyEventKind;
export interface DueEvent {
  kind: RoutedEventKind;
  /** GitHub natural key or ID/filename-blind inbox content identity. */
  key: string;
  app: string;
  payload: Record<string, unknown>;
  /** Pre-v2 keys checked only for durable consumption/spawn migration. */
  migrationAliases?: string[];
}
interface CollapsedDelivery {
  app: string;
  file: string;
  firstFile: string;
  key: string;
}

interface EventPollError {
  code: EventPollErrorCode;
  app: string;
  kind: EventKind;
  message: string;
}

type EventPollErrorCode = "error_event_source" | "invalid_event_transport" | CompanyEventValidationCode;
interface PollEventsResult {
  events: DueEvent[];
  errors: EventPollError[];
  collapsed: CollapsedDelivery[];
  consumptionMigration: ConsumptionMigration;
}
type ConsumptionMigration = { add: string[]; remove: string[] };
interface InboxDelivery {
  file: string;
  payload: Record<string, unknown>;
  event: ReturnType<typeof parseCompanyLifecycleEvent>;
}

export interface GitHubEventSource {
  ticketReady(app: AppEntry): Promise<{ issueNumber: number }[]>;
  prOpened(app: AppEntry): Promise<{ prNumber: number; headSha: string }[]>;
  ciFailed(app: AppEntry): Promise<{ sha: string; check: string }[]>;
  releaseShipped(app: AppEntry): Promise<{ tag: string }[]>;
  /** Absent means unavailable input, never an empty repository. */
  openIssues?(app: AppEntry): Promise<GitHubIssueSummary[]>;
}
export interface GitHubIssueSummary {
  number: number;
  title: string;
  labels: string[];
}

export const EVENT_KINDS: EventKind[] = ["ticket-ready", "pr-opened", "ci-failed", "release-shipped", "alert-webhook"];

/** A role mark preserves later co-subscribers; only dispatch retires the bare key. */
export function roleConsumedKey(eventKey: string, role: string): string {
  return `${eventKey}::role::${role}`;
}

function dedupKey(kind: EventKind, payload: Record<string, unknown>): string {
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
      return inboxEventKey(payload);
  }
}

/** F-PT-006 option 1: canonical producer content, excluding transport filename
 *  and producer ID so a retry with a freshly minted ID still fires once. */
export function inboxEventKey(payload: Record<string, unknown>): string {
  const { filename: _filename, id: _id, ...content } = payload;
  return `event:${sha256(stableJson(content))}`;
}

/** The shipped v1 content key, retained only to migrate its durable marks. */
function v1InboxEventKey(payload: Record<string, unknown>): string {
  const { filename: _filename, ...content } = payload;
  return `event:${sha256(stableJson(content))}`;
}

export class EventStore {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** `false` keeps dispatch dry-run free of durable migration writes. */
  async poll(app: AppEntry, source: GitHubEventSource, persistMigrations = true): Promise<PollEventsResult> {
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
    if (persistMigrations) await this.applyConsumptionMigration(inbox.consumptionMigration);

    return { events, errors, collapsed: inbox.collapsed, consumptionMigration: inbox.consumptionMigration };
  }

  async readConsumed(): Promise<string[]> {
    const path = this.consumedPath();
    if (!existsSync(path)) return [];
    try {
      return JSON.parse(await readFile(path, "utf8")) as string[];
    } catch (error) {
      // A torn dedup file must not halt the tick; the next write repairs it.
      console.warn(
        `events: consumed.json unreadable, treating as empty: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  async markConsumed(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.ensure();
    const consumed = new Set(await this.readConsumed());
    for (const key of keys) consumed.add(key);
    await this.writeConsumed(consumed);
  }

  /** Write the bare key and prune now-redundant per-role marks atomically. */
  async retireEvent(eventKey: string): Promise<void> {
    await this.ensure();
    const consumed = new Set(await this.readConsumed());
    const rolePrefix = `${eventKey}::role::`;
    for (const key of [...consumed]) {
      if (key.startsWith(rolePrefix)) consumed.delete(key);
    }
    consumed.add(eventKey);
    await this.writeConsumed(consumed);
  }

  private async writeConsumed(consumed: ReadonlySet<string>): Promise<void> {
    await writeFileAtomic(this.consumedPath(), `${JSON.stringify([...consumed].sort(), null, 2)}\n`);
  }

  /** Group validated siblings before order-independent alias migration;
   * malformed unconsumed siblings remain visible as errors. */
  async readInbox(app: string, consumed: ReadonlySet<string> = new Set()): Promise<PollEventsResult> {
    await this.ensure();
    const dir = this.inboxDir();
    const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
    const events: DueEvent[] = [];
    const errors: EventPollError[] = [];
    const collapsed: CollapsedDelivery[] = [];
    const groups = new Map<string, InboxDelivery[]>();
    for (const file of files) {
      if (file.includes("::")) {
        if (consumed.has(file)) continue;
        errors.push(inboxError(app, file, "invalid_event_transport", new Error("'::' is reserved for marks")));
        continue;
      }
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(await readFile(join(dir, file), "utf8")) as Record<string, unknown>;
      } catch (error) {
        if (consumed.has(file)) continue;
        errors.push(inboxError(app, file, "malformed_company_event", error));
        continue;
      }
      let event: ReturnType<typeof parseCompanyLifecycleEvent>;
      try {
        event = parseCompanyLifecycleEvent(payload);
      } catch (error) {
        if (consumed.has(file)) continue;
        const code = error instanceof CompanyEventValidationError ? error.code : "malformed_company_event";
        errors.push(inboxError(app, file, code, error));
        continue;
      }
      if (event.app !== app) continue;
      const key = inboxEventKey(payload);
      const group = groups.get(key);
      const delivery = { file, payload, event };
      if (group === undefined) groups.set(key, [delivery]);
      else group.push(delivery);
    }

    const add = new Set<string>();
    const remove = new Set<string>();
    for (const [key, group] of groups) {
      // Each delivery contributes its filename and shipped ID-inclusive v1 key.
      const aliases = new Set(group.flatMap((item) => [item.file, v1InboxEventKey(item.payload)]));
      if (migrateGroupConsumption(key, aliases, consumed, add, remove)) continue;
      const first = group[0];
      if (first === undefined) continue;
      events.push({
        kind: first.event.kind,
        key,
        app: first.event.app,
        payload: { ...first.payload, filename: first.file },
        migrationAliases: [...aliases].sort(),
      });
      for (const duplicate of group.slice(1)) {
        collapsed.push({ app: duplicate.event.app, file: duplicate.file, firstFile: first.file, key });
      }
    }
    const consumptionMigration = { add: [...add].sort(), remove: [...remove].sort() };
    return { events, errors, collapsed, consumptionMigration };
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

  private async applyConsumptionMigration(migration: ConsumptionMigration): Promise<void> {
    if (migration.add.length === 0 && migration.remove.length === 0) return;
    const consumed = new Set(await this.readConsumed());
    for (const key of migration.remove) consumed.delete(key);
    for (const key of migration.add) consumed.add(key);
    await this.writeConsumed(consumed);
  }
}

/** Any bare alias retires the v2 group; otherwise union its per-role aliases. */
function migrateGroupConsumption(
  key: string,
  aliases: ReadonlySet<string>,
  consumed: ReadonlySet<string>,
  add: Set<string>,
  remove: Set<string>,
): boolean {
  const roles = new Set<string>();
  let legacyBare = false;
  for (const alias of aliases) {
    if (consumed.has(alias)) {
      legacyBare = true;
      remove.add(alias);
    }
    const prefix = `${alias}::role::`;
    for (const mark of consumed) {
      if (!mark.startsWith(prefix)) continue;
      const role = mark.slice(prefix.length);
      if (role.length > 0) roles.add(role);
      remove.add(mark);
    }
  }
  const canonicalBare = consumed.has(key);
  const retired = canonicalBare || legacyBare;
  if (legacyBare && !canonicalBare) add.add(key);
  if (!retired) for (const role of roles) add.add(roleConsumedKey(key, role));
  return retired;
}

function inboxError(
  app: string,
  file: string,
  code: Exclude<EventPollErrorCode, "error_event_source">,
  error: unknown,
): EventPollError {
  return {
    code,
    app,
    kind: "alert-webhook",
    message: `inbox ${file}: ${error instanceof Error ? error.message : String(error)}`,
  };
}

function mustString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`event payload missing string ${key}`);
  return value;
}

function mustNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`event payload missing number ${key}`);
  return value;
}
