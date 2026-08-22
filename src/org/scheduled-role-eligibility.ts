import { STATE_LABELS } from "../loop/plan-tickets.js";
import { resolveAppWorkdir } from "./app-workdir.js";
import type { AppEntry } from "./apps.js";
import type { DueEvent, GitHubIssueSummary } from "./events.js";
import { prepareDistillation, prepareLearningReview } from "./learning-loop/host/distillation.js";
import { loadLearningPolicy } from "./learning-loop/host/policy.js";
import { readPlannerFeeds } from "./standing-roles.js";

type EligibilityConfiguration = "declared" | "missing" | "unavailable";

type ScheduledRoleEligibility =
  | {
      eligible: true;
      reason: "actionable_input";
      configuration: EligibilityConfiguration;
      checked: string[];
      actionable: string[];
    }
  | {
      eligible: false;
      reason: "no_actionable_input";
      configuration: EligibilityConfiguration;
      checked: string[];
      actionable: [];
    };

/** Deterministic, token-free paid-turn preflight (#228). Time proves only that
 * a role should look; this function decides whether it found work worth a
 * provider construction. Event-triggered turns remain independently routed,
 * so a scheduled digest never duplicates the event turn that woke beside it. */
export async function scheduledRoleEligibility(input: {
  orgHome: string;
  stateHome: string;
  appStages: Record<string, string>;
  app: AppEntry;
  role: string;
  now: Date;
  polledEvents: readonly DueEvent[];
  openIssues: readonly GitHubIssueSummary[] | undefined;
  openIssuesAvailable: boolean;
}): Promise<ScheduledRoleEligibility> {
  const checked: string[] = [];
  const actionable: string[] = [];

  if (input.role === "sre") {
    checked.push("app.release", "open issues labeled op:incident/op:ops", "pending health/CI events");
    if (input.app.release !== undefined) actionable.push(`declared_${input.app.release.kind}_surface`);
    for (const issue of input.openIssues ?? []) {
      if (issue.labels.some((label) => label === "op:incident" || label === "op:ops")) {
        actionable.push(`queued_issue:${issue.number}`);
      }
    }
    // The matching event is already its own due turn. Name it in diagnostics,
    // but do not dispatch a second scheduled run for the same input.
    const pendingEvents = input.polledEvents.filter(
      (event) => event.kind === "health-alert" || event.kind === "ci-failed",
    );
    if (pendingEvents.length > 0) checked.push(`event_turns_routed_separately:${pendingEvents.length}`);
    return result(actionable, checked, input.app.release === undefined ? "missing" : "declared");
  }

  if (input.role === "support") {
    const channels = input.app.channels?.support ?? [];
    checked.push("channels.support", "open support backlog", "pending support-feedback events");
    if (channels.length > 0) {
      for (const issue of input.openIssues ?? []) {
        if (issue.labels.some((label) => label === "op:support" || label === "support")) {
          actionable.push(`support_backlog:${issue.number}`);
        }
      }
    }
    return result(actionable, checked, channels.length === 0 ? "missing" : "declared");
  }

  if (input.role === "marketing") {
    const channels = input.app.channels?.marketing ?? [];
    checked.push("channels.marketing", "open marketing backlog", "pending release/adoption/calendar events");
    if (channels.length > 0) {
      for (const issue of input.openIssues ?? []) {
        if (issue.labels.some((label) => label === "op:marketing" || label === "marketing")) {
          actionable.push(`marketing_backlog:${issue.number}`);
        }
      }
    }
    return result(actionable, checked, channels.length === 0 ? "missing" : "declared");
  }

  if (input.role === "planner") {
    checked.push("open untriaged issues", "pending standing-role Planner feeds");
    for (const issue of input.openIssues ?? []) {
      if (!issue.labels.some((label) => STATE_LABELS.includes(label as (typeof STATE_LABELS)[number]))) {
        actionable.push(`untriaged_issue:${issue.number}`);
      }
    }
    const pendingFeeds = (await readPlannerFeeds(input.stateHome, input.app.name)).filter(
      (feed) => feed.status === "pending",
    );
    actionable.push(...pendingFeeds.map((feed) => `planner_feed:${feed.feed_id}`));
    return result(
      actionable,
      checked,
      input.openIssuesAvailable || pendingFeeds.length > 0 ? "declared" : "unavailable",
    );
  }

  if (input.role === "distiller" || input.role === "learning-reviewer") {
    checked.push(
      input.role === "distiller"
        ? "eligible unsuppressed learning evidence clusters"
        : "pending unreviewed learning candidates",
      "learning policy caps",
    );
    try {
      const appWorkdir = resolveAppWorkdir(input.app, {
        orgRoot: input.orgHome,
        runtimeHome: input.stateHome,
      });
      const policy = await loadLearningPolicy(input.orgHome);
      const prepared =
        input.role === "distiller"
          ? await prepareDistillation({
              orgHome: input.orgHome,
              stateHome: input.stateHome,
              app: input.app.name,
              appWorkdir,
              appStages: input.appStages,
              policy,
              now: input.now,
            })
          : await prepareLearningReview({
              orgHome: input.orgHome,
              stateHome: input.stateHome,
              app: input.app.name,
              appWorkdir,
              policy,
              now: input.now,
            });
      if (prepared.status === "ready") actionable.push(`learning_${input.role}_window_ready`);
      else checked.push(`learning_preflight:${prepared.status}:${prepared.reason ?? "no_reason"}`);
      return result(actionable, checked, "declared");
    } catch (error) {
      checked.push(`learning_preflight_unavailable:${error instanceof Error ? error.message : String(error)}`);
      return result(actionable, checked, "unavailable");
    }
  }

  // An extension role without a deterministic adapter cannot buy a provider
  // turn merely because time passed. Adding a scheduled role therefore also
  // requires adding its token-free eligibility adapter here.
  checked.push(`no deterministic scheduled eligibility adapter for role ${input.role}`);
  return result(actionable, checked, "unavailable");
}

function result(
  actionable: string[],
  checked: string[],
  configured: EligibilityConfiguration,
): ScheduledRoleEligibility {
  if (actionable.length > 0) {
    return {
      eligible: true,
      reason: "actionable_input",
      configuration: configured,
      checked,
      actionable: [...new Set(actionable)].sort(),
    };
  }
  return {
    eligible: false,
    reason: "no_actionable_input",
    configuration: configured,
    checked,
    actionable: [],
  };
}
