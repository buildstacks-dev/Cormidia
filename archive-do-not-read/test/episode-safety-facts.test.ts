import { describe, expect, it } from "vitest";
import {
  mergeEpisodeSafetyFacts,
  safetyFactsFromPlanningRequest,
  safetyFactsFromTicketLabels,
  safetyFactsFromTurnEvent,
} from "../src/org/episode-safety-facts.js";

describe("structured episode safety facts", () => {
  it("derives exact ticket-label floors without treating user data as migration", () => {
    expect(safetyFactsFromTicketLabels([
      "domain:auth",
      "domain:secret",
      "op:perf-sensitive",
      "op:incident",
      "domain:data",
      "domain:security",
      "domain:privacy",
      "domain:payment",
    ], "#41")).toEqual([
      {
        kind: "authentication",
        evidenceRefs: ["ticket-label:domain:auth", "ticket:#41"],
      },
      {
        kind: "incident_response",
        evidenceRefs: ["ticket-label:op:incident", "ticket:#41"],
      },
      {
        kind: "payments",
        evidenceRefs: ["ticket-label:domain:payment", "ticket:#41"],
      },
      {
        kind: "performance_sensitive",
        evidenceRefs: ["ticket-label:op:perf-sensitive", "ticket:#41"],
      },
      {
        kind: "privacy",
        evidenceRefs: ["ticket-label:domain:privacy", "ticket:#41"],
      },
      {
        kind: "secrets",
        evidenceRefs: ["ticket-label:domain:secret", "ticket:#41"],
      },
      {
        kind: "security",
        evidenceRefs: ["ticket-label:domain:security", "ticket:#41"],
      },
      {
        kind: "user_data",
        evidenceRefs: ["ticket-label:domain:data", "ticket:#41"],
      },
    ]);
  });

  it("maps only exact structured planning-domain declarations", () => {
    expect(safetyFactsFromPlanningRequest({
      sensitiveDomains: [
        "auth",
        "secrets",
        "data-migration",
        "production-deployment",
        "performance",
        "data",
        "security",
        "privacy",
        "payment",
        "auth-guide",
      ],
    })).toEqual([
      {
        kind: "authentication",
        evidenceRefs: ["planning-request:sensitive-domain:auth"],
      },
      {
        kind: "data_migration",
        evidenceRefs: ["planning-request:sensitive-domain:data-migration"],
      },
      {
        kind: "payments",
        evidenceRefs: ["planning-request:sensitive-domain:payment"],
      },
      {
        kind: "performance_sensitive",
        evidenceRefs: ["planning-request:sensitive-domain:performance"],
      },
      {
        kind: "privacy",
        evidenceRefs: ["planning-request:sensitive-domain:privacy"],
      },
      {
        kind: "production_deployment",
        evidenceRefs: ["planning-request:sensitive-domain:production-deployment"],
      },
      {
        kind: "secrets",
        evidenceRefs: ["planning-request:sensitive-domain:secrets"],
      },
      {
        kind: "security",
        evidenceRefs: ["planning-request:sensitive-domain:security"],
      },
      {
        kind: "user_data",
        evidenceRefs: ["planning-request:sensitive-domain:data"],
      },
    ]);
  });

  it("derives incident and completed-release facts only from typed events", () => {
    for (const kind of ["health-alert", "ci-failed", "alert-webhook"]) {
      expect(safetyFactsFromTurnEvent({ kind, key: "source-7" })).toEqual([{
        kind: "incident_response",
        evidenceRefs: [`event:${kind}:source-7`],
      }]);
    }
    expect(safetyFactsFromTurnEvent({
      kind: "release-shipped",
      key: "release:v7",
    })).toEqual([{
      kind: "release",
      evidenceRefs: ["event:release-shipped:release:v7"],
    }]);
    expect(safetyFactsFromTurnEvent({ kind: "launch-calendar", key: "launch-1" }))
      .toEqual([]);
    expect(safetyFactsFromTurnEvent({ kind: "support-feedback", key: "auth-secrets" }))
      .toEqual([]);
  });

  it("preserves creator fact provenance while deduplicating exact facts", () => {
    const creatorFact = {
      kind: "secrets" as const,
      evidenceRefs: ["Creator:Scope:Secret", "parent-plan:v3"],
    };
    expect(mergeEpisodeSafetyFacts(
      [creatorFact],
      safetyFactsFromTicketLabels(["domain:secret"], "#9"),
      [creatorFact],
    )).toEqual([
      creatorFact,
      {
        kind: "secrets",
        evidenceRefs: ["ticket-label:domain:secret", "ticket:#9"],
      },
    ]);
  });
});
