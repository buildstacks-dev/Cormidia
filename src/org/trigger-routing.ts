// Trigger -> execution route table (M8.3).
//
// M7 intentionally skipped non-builder roles when no execution path existed.
// M8 makes the mapping explicit: roles.yaml declares triggers, this module
// says which protocol each effective trigger runs.

import type { Trigger } from "../runtime/types.js";
import type { AppChannels } from "./apps.js";

export type TriggerRoute =
  | { kind: "pipeline"; pipeline: string }
  | { kind: "build-loop"; pipeline: "build" }
  | { kind: "review-loop"; pipeline: "review" }
  | { kind: "skip"; reason: string };

export interface ResolveTriggerRouteInput {
  role: string;
  trigger: Trigger;
  /** The app's declared channels, for the Support/Marketing channel-presence
   *  gate (docs/PURPOSE.md). When PROVIDED (even as `{}`) an audience-facing
   *  role with no matching channel is gated off — schedule and event triggers
   *  alike. When OMITTED (undefined) the gate is skipped: callers that route
   *  purely by trigger shape (e.g. the turn runner re-resolving an already
   *  dispatched turn, or unit tests) opt out. The dispatcher always passes a
   *  concrete object so undeclared apps ARE gated. */
  channels?: AppChannels;
}

export function resolveTriggerRoute(input: ResolveTriggerRouteInput): TriggerRoute {
  const role = input.role;
  const trigger = input.trigger;

  if (trigger.manual === true) return skip(role, "manual triggers never auto-route");

  if (input.channels !== undefined) {
    const need = requiredChannel(role);
    if (need !== undefined && !hasChannel(input.channels, need)) {
      return skip(role, `${need} channel gate: app declares no ${need} channels`);
    }
  }

  if (role === "planner") {
    if (trigger.schedule !== undefined) {
      if (isDaily(trigger.schedule)) return { kind: "pipeline", pipeline: "groom" };
      if (isWeekly(trigger.schedule)) return { kind: "pipeline", pipeline: "plan" };
      return skip(role, `planner schedule "${trigger.schedule}" is not mapped`);
    }
    // Groom feed: a support-feedback or adoption-signal drop grooms the
    // backlog with that specific signal in hand (docs/scheduler/event-schemas.md).
    if (trigger.event === "support-feedback" || trigger.event === "adoption-signal") {
      return { kind: "pipeline", pipeline: "groom" };
    }
  }

  if (role === "builder" && trigger.event === "ticket-ready") {
    return { kind: "build-loop", pipeline: "build" };
  }

  if (role === "reviewer" && trigger.event === "pr-opened") {
    return { kind: "review-loop", pipeline: "review" };
  }

  if (role === "sre") {
    if (trigger.schedule === "hourly") return { kind: "pipeline", pipeline: "sre-health" };
    if (
      trigger.event === "ci-failed" ||
      trigger.event === "alert-webhook" ||
      trigger.event === "health-alert"
    ) {
      return { kind: "pipeline", pipeline: "sre-incident" };
    }
  }

  if (role === "support") {
    if (trigger.event === "support-feedback") return { kind: "pipeline", pipeline: "support-digest" };
    if (trigger.schedule !== undefined) return { kind: "pipeline", pipeline: "support-digest" };
  }

  if (role === "marketing") {
    if (trigger.event === "release-shipped") return { kind: "pipeline", pipeline: "marketing-release" };
    if (trigger.event === "launch-calendar") return { kind: "pipeline", pipeline: "marketing-release" };
    if (trigger.event === "adoption-signal") return { kind: "pipeline", pipeline: "ci-sweep" };
    if (trigger.schedule !== undefined && isWeekly(trigger.schedule)) {
      return { kind: "pipeline", pipeline: "ci-sweep" };
    }
  }

  if (role === "distiller" && trigger.schedule === "daily 06:00") {
    return { kind: "pipeline", pipeline: "learning-distill" };
  }

  if (role === "learning-reviewer" && trigger.schedule === "weekly mon 07:00") {
    return { kind: "pipeline", pipeline: "learning-review" };
  }

  return skip(role, `no route for ${describeTrigger(trigger)}`);
}

/** The channel a role must have declared to run at all, or undefined for
 *  roles that are never channel-gated (planner/builder/reviewer/sre). */
export function requiredChannel(role: string): keyof AppChannels | undefined {
  if (role === "support") return "support";
  if (role === "marketing") return "marketing";
  return undefined;
}

function hasChannel(channels: AppChannels, key: keyof AppChannels): boolean {
  const list = channels[key];
  return Array.isArray(list) && list.length > 0;
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
