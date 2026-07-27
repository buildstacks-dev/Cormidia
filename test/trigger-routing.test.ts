// Tests trigger-to-execution routing in src/org/trigger-routing.ts.
// Covers standing-role schedules/events, company-lifecycle fan-out, channel
// gates for Support/Marketing, non-audience exemptions, manual skips, and
// unknown-route reasons.
// Uses inline triggers only; no filesystem state, network, auth, or wall-clock
// time is required.

import { describe, expect, it } from "vitest";
import { resolveTriggerRoute } from "../src/org/trigger-routing.js";
import type { Trigger } from "../src/runtime/types.js";

const route = (role: string, trigger: Trigger) => resolveTriggerRoute({ role, trigger });

describe("trigger routing", () => {
  it("maps standing role triggers to executable protocols", () => {
    expect(route("planner", { schedule: "daily 07:00" })).toEqual({
      kind: "pipeline",
      pipeline: "groom",
    });
    expect(route("planner", { schedule: "weekly mon" })).toEqual({
      kind: "pipeline",
      pipeline: "plan",
    });
    expect(route("builder", { event: "ticket-ready" })).toEqual({
      kind: "build-loop",
      pipeline: "build",
    });
    expect(route("reviewer", { event: "pr-opened" })).toEqual({
      kind: "review-loop",
      pipeline: "review",
    });
    expect(route("sre", { schedule: "hourly" })).toEqual({
      kind: "pipeline",
      pipeline: "sre-health",
    });
    expect(route("sre", { event: "ci-failed" })).toEqual({
      kind: "pipeline",
      pipeline: "sre-incident",
    });
    expect(route("sre", { event: "alert-webhook" })).toEqual({
      kind: "pipeline",
      pipeline: "sre-incident",
    });
    expect(route("support", { schedule: "every 4h" })).toEqual({
      kind: "pipeline",
      pipeline: "support-digest",
    });
    expect(route("marketing", { event: "release-shipped" })).toEqual({
      kind: "pipeline",
      pipeline: "marketing-release",
    });
    expect(route("marketing", { schedule: "weekly thu" })).toEqual({
      kind: "pipeline",
      pipeline: "ci-sweep",
    });
    expect(route("distiller", { schedule: "daily 06:00" })).toEqual({
      kind: "pipeline",
      pipeline: "learning-distill",
    });
    expect(route("learning-reviewer", { schedule: "weekly mon 07:00" })).toEqual({
      kind: "pipeline",
      pipeline: "learning-review",
    });
  });

  it("routes company-lifecycle event kinds to their documented pipelines", () => {
    // docs/scheduler/event-schemas.md fan-out (GAP B).
    expect(route("support", { event: "support-feedback" })).toEqual({
      kind: "pipeline",
      pipeline: "support-digest",
    });
    expect(route("planner", { event: "support-feedback" })).toEqual({
      kind: "pipeline",
      pipeline: "groom",
    });
    expect(route("marketing", { event: "adoption-signal" })).toEqual({
      kind: "pipeline",
      pipeline: "ci-sweep",
    });
    expect(route("planner", { event: "adoption-signal" })).toEqual({
      kind: "pipeline",
      pipeline: "groom",
    });
    expect(route("sre", { event: "health-alert" })).toEqual({
      kind: "pipeline",
      pipeline: "sre-incident",
    });
    expect(route("marketing", { event: "launch-calendar" })).toEqual({
      kind: "pipeline",
      pipeline: "marketing-release",
    });
    // near-miss: a role that does not subscribe to the kind is unrouted.
    expect(route("sre", { event: "support-feedback" })).toMatchObject({
      kind: "skip",
      reason: expect.stringContaining("no route"),
    });
  });

  it("gates Support/Marketing by channel presence (GAP E)", () => {
    // Channels provided but the required one is absent/empty -> gated skip,
    // for both schedule and event triggers.
    expect(resolveTriggerRoute({ role: "support", trigger: { schedule: "every 4h" }, channels: {} })).toMatchObject({
      kind: "skip",
      reason: expect.stringContaining("support channel gate"),
    });
    expect(
      resolveTriggerRoute({ role: "support", trigger: { event: "support-feedback" }, channels: {} }),
    ).toMatchObject({ kind: "skip", reason: expect.stringContaining("support channel gate") });
    expect(
      resolveTriggerRoute({
        role: "marketing",
        trigger: { event: "adoption-signal" },
        channels: { support: ["email"] },
      }),
    ).toMatchObject({ kind: "skip", reason: expect.stringContaining("marketing channel gate") });
    // Channel present -> routes normally.
    expect(
      resolveTriggerRoute({
        role: "support",
        trigger: { event: "support-feedback" },
        channels: { support: ["email"] },
      }),
    ).toEqual({ kind: "pipeline", pipeline: "support-digest" });
    expect(
      resolveTriggerRoute({
        role: "marketing",
        trigger: { schedule: "weekly thu" },
        channels: { marketing: ["blog"] },
      }),
    ).toEqual({ kind: "pipeline", pipeline: "ci-sweep" });
    // Non-audience roles are never channel-gated, even with empty channels.
    expect(resolveTriggerRoute({ role: "sre", trigger: { event: "health-alert" }, channels: {} })).toEqual({
      kind: "pipeline",
      pipeline: "sre-incident",
    });
    expect(
      resolveTriggerRoute({ role: "planner", trigger: { event: "support-feedback" }, channels: {} }),
    ).toEqual({ kind: "pipeline", pipeline: "groom" });
    // Omitting channels entirely opts out of the gate (turn-runner re-resolve).
    expect(resolveTriggerRoute({ role: "support", trigger: { schedule: "every 4h" } })).toEqual({
      kind: "pipeline",
      pipeline: "support-digest",
    });
  });

  it("manual and unknown triggers return typed skip reasons", () => {
    expect(route("planner", { manual: true })).toMatchObject({
      kind: "skip",
      reason: expect.stringContaining("manual"),
    });
    expect(route("reviewer", { schedule: "hourly" })).toMatchObject({
      kind: "skip",
      reason: expect.stringContaining("no route"),
    });
  });
});
