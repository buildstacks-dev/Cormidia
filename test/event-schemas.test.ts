import { describe, expect, it } from "vitest";
import { parseCompanyLifecycleEvent } from "../src/org/event-schemas.js";

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

  it("rejects unknown event kinds", () => {
    expect(() =>
      parseCompanyLifecycleEvent({
        ...BASE,
        kind: "billing-webhook",
        summary: "not in the v0 contract",
      }),
    ).toThrow(/unknown company event kind "billing-webhook"/);
  });
});
