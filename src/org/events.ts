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

/** Transport kinds: GitHub-polled kinds plus the file-drop `alert-webhook`
 *  inbox transport. `alert-webhook` remains the dedup/transport identity for
 *  inbox files; the *routed* kind is the parsed company-lifecycle kind. */
export type EventKind = "ticket-ready" | "pr-opened" | "ci-failed" | "release-shipped" | "alert-webhook";

/** The kind a role's trigger matches on. GitHub events keep their transport
 *  kind; file-drop inbox events carry the parsed company-lifecycle kind
 *  (docs/scheduler/event-schemas.md) so roles.yaml stays the source of truth for who
 *  subscribes to `support-feedback` / `adoption-signal` / `health-alert` /
 *  `launch-calendar`. */
type RoutedEventKind = EventKind | CompanyEventKind;

export interface DueEvent {
  kind: RoutedEventKind;
  /** Dedup identity. For GitHub-polled kinds this is the per-kind natural key;
   *  for file-drop inbox events it is the CONTENT identity (B-13 §2, F-PT-006),
   *  never the delivery filename. */
  key: string;
  app: string;
  payload: Record<string, unknown>;
}

/** One inbox delivery that collapsed into an earlier one under the same content
 *  identity. Reported, never silent: a producer double-delivering is an
 *  operator-visible fact even though it correctly fires only once (INV-008). */
interface CollapsedDelivery {
  app: string;
  /** The duplicate file that did NOT produce a turn. */
  file: string;
  /** The delivery that did, under the shared identity. */
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
  /** Duplicate inbox deliveries collapsed under B-13 §2's one-firing rule. */
  collapsed: CollapsedDelivery[];
}

export interface GitHubEventSource {
  ticketReady(app: AppEntry): Promise<{ issueNumber: number }[]>;
  prOpened(app: AppEntry): Promise<{ prNumber: number; headSha: string }[]>;
  ciFailed(app: AppEntry): Promise<{ sha: string; check: string }[]>;
  releaseShipped(app: AppEntry): Promise<{ tag: string }[]>;
  /** Optional richer backlog snapshot used only by deterministic scheduled-role
   * eligibility and Planner intake. Older embedded sources remain valid; an
   * absent method is surfaced as unavailable input, never interpreted as an
   * empty repository. */
  openIssues?(app: AppEntry): Promise<GitHubIssueSummary[]>;
}

export interface GitHubIssueSummary {
  number: number;
  title: string;
  labels: string[];
}

export const EVENT_KINDS: EventKind[] = ["ticket-ready", "pr-opened", "ci-failed", "release-shipped", "alert-webhook"];

/** Per-role consumption mark. Multi-subscriber events are consumed per
 *  (eventKey, role) so a co-subscriber pushed to a later tick by the WIP
 *  limit still sees the event. The bare eventKey — what poll() filters on —
 *  is written by the dispatcher's per-tick retirement sweep once every
 *  CURRENT subscriber holds a mark (issue #25); the store never decides
 *  retirement itself because only the dispatcher knows the subscriber set. */
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

/** B-13 §2 / F-PT-006 (owner ruling 2026-08-12): an inbox event's dedup identity
 *  is CONTENT-DERIVED — sha256 over the canonical sorted-key serialization of
 *  the producer's payload — so **exactly one turn fires per real-world event**
 *  and duplicate deliveries collapse no matter what the producer named the file.
 *
 *  Why content and not a producer-supplied id (§6, and the reason the contract
 *  could take no position before): a retrying producer that mints a fresh id
 *  double-fires, and one that reuses an id with different bytes recreates the
 *  same-identity-two-payloads case nobody could resolve. Deriving from content
 *  makes that case VACUOUS — payloads that differ are different events. Same
 *  shape as the incident idempotency marker in standing-roles.ts.
 *
 *  `filename` is stripped first: it is transport, added by readInbox for the
 *  operator locator, and including it would key on delivery again. */
export function inboxEventKey(payload: Record<string, unknown>): string {
  const { filename: _filename, ...content } = payload;
  return `event:${sha256(stableJson(content))}`;
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

    return { events, errors, collapsed: inbox.collapsed };
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

  /** Retire an event: write the bare key (what poll() filters on) and prune
   *  the event's now-redundant per-role marks in the same atomic write, so
   *  consumed.json converges back to one entry per retired event. WHEN to
   *  retire is the dispatcher's per-tick decision — every current subscriber
   *  holds a mark — never the store's: a store-side completeness check would
   *  depend on callers supplying a subscriber set it cannot validate, and an
   *  incomplete one would silently starve co-subscribers (issue #25). */
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

  /** Read the file-drop inbox, parsing each payload's company-lifecycle kind
   *  (docs/scheduler/event-schemas.md) so the dispatcher can route by kind. Already
   *  consumed files are skipped. A malformed payload (bad JSON or a payload
   *  that fails the company-event contract) is surfaced LOUDLY as an
   *  `error_event_source` — never silently dropped — while sibling files keep
   *  flowing. */
  async readInbox(app: string, consumed: ReadonlySet<string> = new Set()): Promise<PollEventsResult> {
    await this.ensure();
    const dir = this.inboxDir();
    const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
    const events: DueEvent[] = [];
    const errors: EventPollError[] = [];
    const collapsed: CollapsedDelivery[] = [];
    // Content identity → the delivery that already claimed it THIS sweep, so a
    // second file carrying the same event collapses into the first rather than
    // fanning out twice (B-13 §2). Sorted filenames make the winner stable.
    const claimedThisSweep = new Map<string, string>();
    for (const file of files) {
      // MIGRATION (B-13 §6): consumed.json entries written before F-PT-006
      // are filenames. A legacy entry still suppresses its own file, so
      // nothing already consumed re-fires under the new identity. Suppression
      // only widens — tighten-only.
      if (consumed.has(file)) continue;
      // "::" is reserved for per-role consumption marks (roleConsumedKey);
      // a filename containing it could impersonate or shadow another event's
      // marks in the shared consumed set. Reject loudly at the transport
      // boundary — filenames are our own contract.
      if (file.includes("::")) {
        errors.push(
          inboxError(
            app,
            file,
            "invalid_event_transport",
            new Error("filename must not contain '::' (reserved for consumption marks)"),
          ),
        );
        continue;
      }
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(await readFile(join(dir, file), "utf8")) as Record<string, unknown>;
      } catch (error) {
        errors.push(inboxError(app, file, "malformed_company_event", error));
        continue;
      }
      let event: ReturnType<typeof parseCompanyLifecycleEvent>;
      try {
        event = parseCompanyLifecycleEvent(payload);
      } catch (error) {
        errors.push(
          inboxError(
            app,
            file,
            error instanceof CompanyEventValidationError ? error.code : "malformed_company_event",
            error,
          ),
        );
        continue;
      }
      if (event.app !== app) continue;
      const key = inboxEventKey(payload);
      if (consumed.has(key)) continue;
      const firstFile = claimedThisSweep.get(key);
      if (firstFile !== undefined) {
        collapsed.push({ app: event.app, file, firstFile, key });
        continue;
      }
      claimedThisSweep.set(key, file);
      events.push({ kind: event.kind, key, app: event.app, payload: { ...payload, filename: file } });
    }
    return { events, errors, collapsed };
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
