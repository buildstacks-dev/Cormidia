// Deterministic episode ids and anchors (docs/learning-loop/learning-loop-spec.md §5).
//
// The episode — not the turn — is the unit of treatment assignment and
// outcome measurement (design §8). Ids derive from the durable anchor with no
// coordination: every turn in the episode, across roles and retries, computes
// the same id. M1 stamps ids and episode context onto captured events; the M2
// projector (episode.ts) additionally needs the anchor's kind and source ref,
// so both derive from one place here.

import type { TurnEvent } from "../journal.js";

/** Spec §5 kind enum plus `turn`: schedule-triggered turns (retro, hourly
 *  planner, …) have no durable anchor beyond the turn itself, so the turn is
 *  its own episode — recorded as a spec delta in the M1a PR alongside
 *  `pass_verdict`. Company events whose kind is not in the routing table also
 *  classify as `turn`; their source still names the event. */
export type EpisodeKind = "build_ticket" | "incident" | "feedback_thread" | "campaign" | "turn";

export interface EpisodeSource {
  kind: "github_issue" | "company_event" | "turn";
  ref: string;
}

export interface EpisodeAnchor {
  episodeId: string;
  kind: EpisodeKind;
  source: EpisodeSource;
}

/** `ep_<app>_<kind-short>_<source-key>` (spec §5). */
export function buildTicketEpisodeId(app: string, ticketRef: string): string {
  return episodeId(app, "ticket", ticketKey(ticketRef));
}

export function ticketEpisodeAnchor(app: string, ticketRef: string): EpisodeAnchor {
  const numeric = ticketNumber(ticketRef);
  return {
    episodeId: buildTicketEpisodeId(app, ticketRef),
    kind: "build_ticket",
    source: {
      kind: "github_issue",
      ref: numeric !== undefined ? `${app}#${numeric}` : `${app}:${ticketRef}`,
    },
  };
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

const EVENT_EPISODE_KIND: Record<string, EpisodeKind> = {
  "support-feedback": "feedback_thread",
  "health-alert": "incident",
  "launch-calendar": "campaign",
  "adoption-signal": "campaign",
};

export function eventEpisodeId(app: string, event: Pick<TurnEvent, "kind" | "key">): string {
  const short = EVENT_KIND_SHORT[event.kind] ?? sanitizeSegment(event.kind);
  return episodeId(app, short, event.key);
}

export function eventEpisodeAnchor(
  app: string,
  event: Pick<TurnEvent, "kind" | "key">,
): EpisodeAnchor {
  return {
    episodeId: eventEpisodeId(app, event),
    kind: EVENT_EPISODE_KIND[event.kind] ?? "turn",
    source: { kind: "company_event", ref: `${event.kind}:${event.key}` },
  };
}

/** Schedule-triggered turns (retro, hourly planner, …) have no durable anchor
 *  beyond the turn itself: the turn is its own episode. */
export function turnEpisodeId(app: string, turnId: string): string {
  return episodeId(app, "turn", turnId);
}

/** Anchor derivation from a turn journal's fields — the ONE precedence order
 *  (event -> ticketRef -> the turn itself) shared by the capture projector
 *  and the resolver's turn-start pin, so resolve events and capture events
 *  land on the same episode. Capture additionally prefers the run envelope's
 *  own `ticket` when present (runtime truth for loop passes); a dispatched
 *  turn that claims a ticket AFTER its turn-start resolve therefore captures
 *  under the ticket episode while its resolve pin stays on this anchor —
 *  a known M4 boundary that M5's episode-sticky assignment moves the
 *  resolve to close. */
export function journalEpisodeAnchor(
  app: string,
  journal: { event?: Pick<TurnEvent, "kind" | "key">; ticketRef?: string },
  turnId: string,
): EpisodeAnchor {
  if (journal.event !== undefined) return eventEpisodeAnchor(app, journal.event);
  if (journal.ticketRef !== undefined) return ticketEpisodeAnchor(app, journal.ticketRef);
  return turnEpisodeAnchor(app, turnId);
}

export function turnEpisodeAnchor(app: string, turnId: string): EpisodeAnchor {
  return {
    episodeId: turnEpisodeId(app, turnId),
    kind: "turn",
    source: { kind: "turn", ref: turnId },
  };
}

function episodeId(app: string, kindShort: string, key: string): string {
  return `ep_${app}_${kindShort}_${sanitizeSegment(key)}`;
}

/** `#42` → `0042`, matching the spec's zero-padded examples; non-numeric
 *  refs sanitize as-is. Keeps the raw digit STRING (`#00042` → `00042`) —
 *  round-tripping through Number would shift existing episode ids. */
function ticketKey(ticketRef: string): string {
  const numeric = /^#?(\d+)$/.exec(ticketRef.trim());
  if (numeric !== null) return numeric[1]!.padStart(4, "0");
  return ticketRef;
}

/** `#42`/`42` → 42; undefined for non-numeric refs (bootstrap milestone keys). */
export function ticketNumber(ticketRef: string): number | undefined {
  const numeric = /^#?(\d+)$/.exec(ticketRef.trim());
  return numeric !== null ? Number(numeric[1]) : undefined;
}

function sanitizeSegment(part: string): string {
  const cleaned = part.replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned === "" ? "unknown" : cleaned;
}
