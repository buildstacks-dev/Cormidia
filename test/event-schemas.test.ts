// Tests company-lifecycle event payload parsing in src/org/event-schemas.ts.
// Covers every supported file-drop kind and rejects unknown kinds loudly.
// Uses inline objects only; no filesystem fixture, network, auth, real org
// state, or wall-clock time is required.

import { describe, expect, it } from "vitest";
import {
  CompanyEventValidationError,
  parseCompanyLifecycleEvent,
} from "../src/org/event-schemas.js";

const BASE = {
  id: "evt-1",
  app: "gamma",
  occurred_at: "2026-07-06T12:00:00Z",
  source: "fixture",
};

describe("company lifecycle event schemas", () => {
  it("parses the supported file-drop event kinds", () => {
    expect(
      parseCompanyLifecycleEvent({
        ...BASE,
        kind: "support-feedback",
        severity: "medium",
        channel: "email",
        summary: "user needs help",
      }),
    ).toMatchObject({ kind: "support-feedback", severity: "medium" });

    expect(
      parseCompanyLifecycleEvent({
        ...BASE,
        kind: "adoption-signal",
        metric: "weekly_active_checks",
        direction: "up",
        value: 42,
        summary: "usage rose",
      }),
    ).toMatchObject({ kind: "adoption-signal", direction: "up" });

    expect(
      parseCompanyLifecycleEvent({
        ...BASE,
        kind: "health-alert",
        severity: "critical",
        service: "web",
        status: "down",
        summary: "/health failed",
      }),
    ).toMatchObject({ kind: "health-alert", status: "down" });

    expect(
      parseCompanyLifecycleEvent({
        ...BASE,
        kind: "launch-calendar",
        date: "2026-07-20",
        milestone: "gamma smoke",
        summary: "draft launch note",
      }),
    ).toMatchObject({ kind: "launch-calendar", date: "2026-07-20" });
  });

  it("rejects unknown and near-miss kinds with the stable unknown-kind code", () => {
    for (const kind of ["billing-webhook", "support-feedback-v2"]) {
      expect(() =>
        parseCompanyLifecycleEvent({
          ...BASE,
          kind,
          summary: "not in the v0 contract",
        }),
      ).toThrow(
        expect.objectContaining({
          name: "CompanyEventValidationError",
          code: "unknown_company_event_kind",
          message: expect.stringContaining(`unknown company event kind "${kind}"`),
        }),
      );
    }
  });

  it("keeps a known kind with an invalid payload out of the unknown-kind class", () => {
    try {
      parseCompanyLifecycleEvent({
        ...BASE,
        kind: "health-alert",
        severity: "critical",
        service: "web",
        status: "down",
        // summary is deliberately absent
      });
      throw new Error("expected parseCompanyLifecycleEvent to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(CompanyEventValidationError);
      expect(error).toMatchObject({
        code: "malformed_company_event",
        message: 'company event missing non-empty string "summary"',
      });
    }
  });

  it("classifies an incomplete unknown-looking envelope as malformed first", () => {
    expect(() => parseCompanyLifecycleEvent({ kind: "support-feedback-v2" })).toThrow(
      expect.objectContaining({
        code: "malformed_company_event",
        message: 'company event missing non-empty string "id"',
      }),
    );
  });
});
