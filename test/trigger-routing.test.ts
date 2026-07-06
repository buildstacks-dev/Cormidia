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
