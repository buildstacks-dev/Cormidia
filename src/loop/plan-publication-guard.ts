import { SECRET_PATTERNS } from "../runtime/secret-patterns.js";
import type { PlanTicket } from "./plan-tickets.js";

/** Hash-only planning-source evidence allowed to cross the issue-publication
 * boundary. Raw source bytes — and, since F-PT-039, raw media bytes — never
 * cross it; only refs and digests do (INV-011, CORMIDIA-C-B31-003).
 *
 * Every row carries its OBSERVED consumption state rather than an assumed one:
 * a declared source the turn never opened publishes as `not_read`, and an
 * absent observation channel publishes as `unobservable`. A ticket must never
 * imply it was planned from evidence nobody looked at (INV-017). */
export interface PlanningSourceTicketEvidence {
  scopeSha256: string;
  evidence: "observed" | "unobservable";
  sources: Array<{
    canonicalRef: string;
    readSha256: string | null;
    readBytes: number | null;
    modality: "text" | "media";
    consumption: "consumed" | "not_read" | "unreadable" | "changed";
    trust: string;
  }>;
}

/** Typed INV-011 refusal; findings name pattern kinds but never matched bytes. */
export class TicketPublicationSecretError extends Error {
  readonly code = "error_ticket_publication_secret" as const;
  constructor(readonly findings: readonly string[]) {
    super(
      "publishTickets: refusing to publish — suspected secret material in planner-authored " +
        `ticket content (${findings.join("; ")}). No issue was created; remove the credential ` +
        "and re-plan. Publication refuses rather than scrubs: a silent scrub would publish " +
        "content nobody wrote (INV-011).",
    );
    this.name = "TicketPublicationSecretError";
  }
}

/** Scan the full active decomposition before the first bounded publication effect. */
export function assertPublishableContentCarriesNoSecret(input: {
  tickets: readonly PlanTicket[];
  selectedIndexes: readonly number[];
  activeTicketIndexes?: ReadonlySet<number>;
  renderBody: (ticket: PlanTicket) => string;
}): void {
  const indexes =
    input.activeTicketIndexes === undefined
      ? input.tickets.map((_, index) => index)
      : [...input.activeTicketIndexes].sort((left, right) => left - right);
  if (
    indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= input.tickets.length) ||
    input.selectedIndexes.some((index) => !indexes.includes(index))
  ) {
    throw new Error("publishTickets: active ticket scan does not cover the bounded publication selection");
  }
  const findings: string[] = [];
  for (const index of indexes) {
    const ticket = input.tickets[index]!;
    const surfaces = [
      ["title", ticket.title],
      ["body", input.renderBody(ticket)],
    ] as const;
    for (const [surface, text] of surfaces) {
      for (const { name, pattern } of SECRET_PATTERNS) {
        if (pattern.test(text)) findings.push(`ticket ${index} ${surface}: ${name}`);
      }
    }
  }
  if (findings.length > 0) throw new TicketPublicationSecretError(findings);
}
