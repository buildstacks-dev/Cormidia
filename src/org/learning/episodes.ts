// Deterministic episode ids (docs/learning-loop/learning-loop-spec.md §5).
//
// The episode — not the turn — is the unit of treatment assignment and
// outcome measurement (design §8). Ids derive from the durable anchor with no
// coordination: every turn in the episode, across roles and retries, computes
// the same id. Full EpisodeRecord projection is M2; M1 only stamps ids and
// episode context onto captured events.

import type { TurnEvent } from "../journal.js";

/** `ep_<app>_<kind-short>_<source-key>` (spec §5). */
export function buildTicketEpisodeId(app: string, ticketRef: string): string {
  return episodeId(app, "ticket", ticketKey(ticketRef));
}

/** Company-lifecycle event kind → episode kind-short (design §8.1 table):
 *  Support feedback threads, SRE incidents, and Marketing campaign/release
 *  work each anchor on their triggering event. `adoption-signal` routes to
 *  Marketing pipelines, so it keys as campaign work. */
const EVENT_KIND_SHORT: Record<string, string> = {
  "support-feedback": "feedback",
  "health-alert": "incident",
  "launch-calendar": "campaign",
  "adoption-signal": "campaign",
};

export function eventEpisodeId(app: string, event: Pick<TurnEvent, "kind" | "key">): string {
  const short = EVENT_KIND_SHORT[event.kind] ?? sanitizeSegment(event.kind);
  return episodeId(app, short, event.key);
}

/** Schedule-triggered turns (retro, hourly planner, …) have no durable anchor
 *  beyond the turn itself: the turn is its own episode. */
export function turnEpisodeId(app: string, turnId: string): string {
  return episodeId(app, "turn", turnId);
}

function episodeId(app: string, kindShort: string, key: string): string {
  return `ep_${app}_${kindShort}_${sanitizeSegment(key)}`;
}

/** `#42` → `0042`, matching the spec's zero-padded examples; non-numeric
 *  refs sanitize as-is. */
function ticketKey(ticketRef: string): string {
  const numeric = /^#?(\d+)$/.exec(ticketRef.trim());
  if (numeric !== null) return numeric[1]!.padStart(4, "0");
  return ticketRef;
}

function sanitizeSegment(part: string): string {
  const cleaned = part.replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned === "" ? "unknown" : cleaned;
}
