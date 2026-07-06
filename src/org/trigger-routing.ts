// Trigger -> execution route table (M8.3).
//
// M7 intentionally skipped non-builder roles when no execution path existed.
// M8 makes the mapping explicit: roles.yaml declares triggers, this module
// says which protocol each effective trigger runs.

import type { Trigger } from "../runtime/types.js";

export type TriggerRoute =
  | { kind: "pipeline"; pipeline: string }
  | { kind: "build-loop"; pipeline: "build" }
  | { kind: "review-loop"; pipeline: "review" }
  | { kind: "skip"; reason: string };

export interface ResolveTriggerRouteInput {
  role: string;
  trigger: Trigger;
}

export function resolveTriggerRoute(input: ResolveTriggerRouteInput): TriggerRoute {
  const role = input.role;
  const trigger = input.trigger;

  if (trigger.manual === true) return skip(role, "manual triggers never auto-route");

  if (role === "planner" && trigger.schedule !== undefined) {
    if (isDaily(trigger.schedule)) return { kind: "pipeline", pipeline: "groom" };
    if (isWeekly(trigger.schedule)) return { kind: "pipeline", pipeline: "plan" };
    return skip(role, `planner schedule "${trigger.schedule}" is not mapped`);
  }

  if (role === "builder" && trigger.event === "ticket-ready") {
    return { kind: "build-loop", pipeline: "build" };
  }

  if (role === "reviewer" && trigger.event === "pr-opened") {
    return { kind: "review-loop", pipeline: "review" };
  }

  if (role === "sre") {
    if (trigger.schedule === "hourly") return { kind: "pipeline", pipeline: "sre-health" };
    if (trigger.event === "ci-failed" || trigger.event === "alert-webhook") {
      return { kind: "pipeline", pipeline: "sre-incident" };
    }
  }

  if (role === "support" && trigger.schedule !== undefined) {
    return { kind: "pipeline", pipeline: "support-digest" };
  }

  if (role === "marketing") {
    if (trigger.event === "release-shipped") return { kind: "pipeline", pipeline: "marketing-release" };
    if (trigger.schedule !== undefined && isWeekly(trigger.schedule)) {
      return { kind: "pipeline", pipeline: "ci-sweep" };
    }
  }

  return skip(role, `no route for ${describeTrigger(trigger)}`);
}

export function describeTrigger(trigger: Trigger): string {
  if (trigger.event !== undefined) return `event:${trigger.event}`;
  if (trigger.schedule !== undefined) return `schedule:${trigger.schedule}`;
  if (trigger.manual === true) return "manual";
  return "unknown-trigger";
}

function skip(role: string, reason: string): TriggerRoute {
  return { kind: "skip", reason: `${role}: ${reason}` };
}

function isDaily(schedule: string): boolean {
  return schedule === "daily" || schedule.startsWith("daily ");
}

function isWeekly(schedule: string): boolean {
  return schedule === "weekly" || schedule.startsWith("weekly ");
}
