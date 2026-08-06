// Deterministic safety-fact derivation at episode entry boundaries.
//
// These mappings consume only structured, exact values. Goal/title/body/event
// prose is deliberately absent: prose may be supplied to EpisodePlanner as
// bounded context, but it is not a safety-control input.

import type { SafetyFact } from "../loop/episode-plan.js";
import type { TurnEvent } from "./journal.js";

type PlanningSafetyKind = Extract<
  SafetyFact["kind"],
  | "authentication"
  | "security"
  | "secrets"
  | "privacy"
  | "payments"
  | "user_data"
  | "data_migration"
  | "production_deployment"
  | "performance_sensitive"
>;

const TICKET_LABEL_SAFETY_FACTS = {
  "domain:auth": "authentication",
  "domain:security": "security",
  "domain:secret": "secrets",
  "domain:privacy": "privacy",
  "domain:payment": "payments",
  "domain:data": "user_data",
  "op:perf-sensitive": "performance_sensitive",
  "op:incident": "incident_response",
} as const satisfies Readonly<Record<string, SafetyFact["kind"]>>;

/** Exact values accepted by the existing repeatable `--sensitive-domains`
 * planning flag. The input remains open for compatibility; unknown values are
 * retained in requested constraints but cannot silently gain safety meaning. */
const PLANNING_DOMAIN_SAFETY_FACTS = {
  auth: "authentication",
  authentication: "authentication",
  security: "security",
  secret: "secrets",
  secrets: "secrets",
  privacy: "privacy",
  payment: "payments",
  payments: "payments",
  data: "user_data",
  "user-data": "user_data",
  migration: "data_migration",
  "data-migration": "data_migration",
  deployment: "production_deployment",
  "production-deployment": "production_deployment",
  perf: "performance_sensitive",
  performance: "performance_sensitive",
} as const satisfies Readonly<Record<string, PlanningSafetyKind>>;

const INCIDENT_EVENT_KINDS = new Set([
  "health-alert",
  "ci-failed",
  // Retained for the legacy typed alert route. File-drop company events are
  // normalized to `health-alert` before journal persistence.
  "alert-webhook",
]);

export function safetyFactsFromTicketLabels(labels: readonly string[], ticketRef: string): SafetyFact[] {
  const facts: SafetyFact[] = [];
  for (const label of uniqueNormalized(labels)) {
    const kind = TICKET_LABEL_SAFETY_FACTS[label as keyof typeof TICKET_LABEL_SAFETY_FACTS];
    if (kind === undefined) continue;
    facts.push({
      kind,
      evidenceRefs: [`ticket:${ticketRef}`, `ticket-label:${label}`],
    });
  }
  return normalizeSafetyFacts(facts);
}

export function safetyFactsFromPlanningRequest(
  input: { sensitiveDomains?: readonly string[] } | undefined,
): SafetyFact[] {
  const facts: SafetyFact[] = [];
  for (const domain of uniqueNormalized(input?.sensitiveDomains ?? [])) {
    const kind = PLANNING_DOMAIN_SAFETY_FACTS[domain as keyof typeof PLANNING_DOMAIN_SAFETY_FACTS];
    if (kind === undefined) continue;
    facts.push({
      kind,
      evidenceRefs: [`planning-request:sensitive-domain:${domain}`],
    });
  }
  return normalizeSafetyFacts(facts);
}

export function safetyFactsFromTurnEvent(event: Pick<TurnEvent, "kind" | "key"> | undefined): SafetyFact[] {
  if (event === undefined) return [];
  if (INCIDENT_EVENT_KINDS.has(event.kind)) {
    return [
      {
        kind: "incident_response",
        evidenceRefs: [`event:${event.kind}:${event.key}`],
      },
    ];
  }
  if (event.kind === "release-shipped") {
    return [
      {
        kind: "release",
        evidenceRefs: [`event:${event.kind}:${event.key}`],
      },
    ];
  }
  return [];
}

/** Preserve creator-declared fact identities while deduplicating exact facts.
 * Validation compares creator facts by kind plus their full evidence-ref set,
 * so merging facts by kind would silently destroy creator provenance. */
export function mergeEpisodeSafetyFacts(...groups: readonly (readonly SafetyFact[])[]): SafetyFact[] {
  return normalizeSafetyFacts(groups.flatMap((group) => group));
}

function normalizeSafetyFacts(facts: readonly SafetyFact[]): SafetyFact[] {
  const byIdentity = new Map<string, SafetyFact>();
  for (const fact of facts) {
    const normalized = {
      kind: fact.kind,
      evidenceRefs: uniqueSorted(fact.evidenceRefs),
    };
    byIdentity.set(`${normalized.kind}\0${normalized.evidenceRefs.join("\0")}`, normalized);
  }
  return [...byIdentity.values()].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.evidenceRefs.join("\0").localeCompare(right.evidenceRefs.join("\0")),
  );
}

function uniqueNormalized(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}
