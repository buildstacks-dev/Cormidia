// Bounded, provenance-bearing issue intake and deterministic readiness
// application for scheduled Planner work (#230).

import type { GhIssue, GhOps, ListIssueOptions } from "../loop/github.js";
import {
  AUTONOMOUS_EXECUTION_EXCLUSION_LABEL,
  autonomousExecutionExclusionLabel,
  STATE_LABELS,
} from "../loop/plan-tickets.js";
import { canonicalJson, sha256 } from "./scheduler/model.js";

const PLANNER_ISSUE_BATCH_MAX = 100;
const PLANNER_ISSUE_BUDGET_BYTES = 64 * 1024;
const PLANNER_BACKLOG_COMPLETENESS_LIMIT = 10_001;

type PlannerInputDiagnosticCode =
  | "planner_input_ready"
  | "empty_repository"
  | "github_unavailable"
  | "missing_required_executable"
  | "ready_only_filtering"
  | "backlog_completeness_bound";

interface PlannerIssueInput {
  number: number;
  title: string;
  body: string;
  labels: string[];
  source_bytes: number;
  included_bytes: number;
  inclusion: "full" | "truncated";
}

export interface PlannerIssueIntake {
  schema_version: 1;
  kind: "planner-issue-intake";
  app: string;
  turn_id: string;
  query: ListIssueOptions;
  budget_bytes: number;
  included_bytes: number;
  deferred_count: number;
  issues: PlannerIssueInput[];
  diagnostic: { code: PlannerInputDiagnosticCode; detail: string };
  manifest_sha256: string;
}

type PlannerReadinessReasonCode =
  | "routine_ready"
  | "high_risk"
  | "validation_incomplete"
  | "blocked_dependency"
  | "needs_information"
  | "not_buildable"
  | "autonomous_execution_excluded"
  | "routing_state_unreadable";

export interface PlannerReadinessDecision {
  issue_number: number;
  disposition: "ready" | "unready";
  reason_code: PlannerReadinessReasonCode;
  reason: string;
}

export function parsePlannerReadinessDecisions(output: string): PlannerReadinessDecision[] {
  const marker = "<!-- cormidia:planner-readiness-v1 -->";
  const start = output.indexOf(marker);
  if (start < 0) throw new Error("Planner output has no cormidia:planner-readiness-v1 marker");
  const tail = output.slice(start + marker.length);
  const fence = /```json\s*\n([\s\S]*?)\n```/.exec(tail);
  if (fence?.[1] === undefined) throw new Error("Planner readiness marker has no JSON fence");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fence[1]);
  } catch (error) {
    throw new Error(`Planner readiness JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Planner readiness JSON must be an object");
  }
  const record = parsed as Record<string, unknown>;
  if (record["schema_version"] !== 1 || !Array.isArray(record["decisions"])) {
    throw new Error("Planner readiness JSON must be schema_version 1 with decisions[]");
  }
  return record["decisions"].map((value, index) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Planner readiness decision ${index} must be an object`);
    }
    const decision = value as Record<string, unknown>;
    const reasonCode = decision["reason_code"];
    if (
      !Number.isInteger(decision["issue_number"]) ||
      (decision["disposition"] !== "ready" && decision["disposition"] !== "unready") ||
      !isReadinessReasonCode(reasonCode) ||
      typeof decision["reason"] !== "string"
    ) {
      throw new Error(`Planner readiness decision ${index} has invalid fields`);
    }
    return {
      issue_number: decision["issue_number"] as number,
      disposition: decision["disposition"],
      reason_code: reasonCode,
      reason: decision["reason"],
    };
  });
}

interface PlannerReadinessOutcome extends PlannerReadinessDecision {
  requested_disposition: "ready" | "unready";
}

export interface PlannerReadinessApplication {
  schema_version: 1;
  kind: "planner-readiness-application";
  intake_sha256: string;
  applied_issue_numbers: number[];
  outcomes: PlannerReadinessOutcome[];
}

export async function preparePlannerIssueIntake(input: {
  gh: Pick<GhOps, "listIssues">;
  app: string;
  turnId: string;
  query?: ListIssueOptions;
  maxIssues?: number;
  budgetBytes?: number;
}): Promise<PlannerIssueIntake> {
  // The provider brief remains bounded below, but the source read itself is a
  // complete-open-backlog read. Otherwise deferred_count=0 can falsely mean
  // complete when GitHub merely stopped at the provider batch size.
  const query = input.query ?? { state: "open", limit: PLANNER_BACKLOG_COMPLETENESS_LIMIT };
  if (query.labels?.includes("op:ready") === true) {
    return intakeRecord(input, query, [], 0, 0, {
      code: "ready_only_filtering",
      detail: "Planner issue intake must not filter on op:ready; Builder owns the ready-only query",
    });
  }
  let fetched: GhIssue[];
  try {
    fetched = await input.gh.listIssues(query);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return intakeRecord(input, query, [], 0, 0, {
      code: /\b(?:enoent|spawn\s+gh|gh:\s*command not found)\b/i.test(detail)
        ? "missing_required_executable"
        : "github_unavailable",
      detail,
    });
  }
  const maxIssues = input.maxIssues ?? PLANNER_ISSUE_BATCH_MAX;
  const budgetBytes = input.budgetBytes ?? PLANNER_ISSUE_BUDGET_BYTES;
  if (!Number.isInteger(maxIssues) || maxIssues < 1) throw new Error("planner intake maxIssues must be positive");
  if (!Number.isInteger(budgetBytes) || budgetBytes < 1) throw new Error("planner intake budgetBytes must be positive");
  const selected: PlannerIssueInput[] = [];
  let remaining = budgetBytes;
  const candidates = fetched
    .filter((issue) => issue.state === "OPEN")
    .sort((left, right) => left.number - right.number);
  if (candidates.length >= PLANNER_BACKLOG_COMPLETENESS_LIMIT) {
    return intakeRecord(
      input,
      query,
      [],
      0,
      candidates.length,
      {
        code: "backlog_completeness_bound",
        detail: `open backlog reached the ${PLANNER_BACKLOG_COMPLETENESS_LIMIT - 1} issue completeness bound`,
      },
      budgetBytes,
    );
  }
  for (const issue of candidates.slice(0, maxIssues)) {
    const header = `#${issue.number} ${issue.title}\nLabels: ${issue.labels.join(", ") || "none"}\n`;
    const available = Math.max(0, remaining - Buffer.byteLength(header));
    if (available < 1) break;
    const body = truncateUtf8(issue.body, available);
    const sourceBytes = Buffer.byteLength(issue.body);
    const includedBytes = Buffer.byteLength(body);
    selected.push({
      number: issue.number,
      title: issue.title,
      body,
      labels: [...issue.labels].sort(),
      source_bytes: sourceBytes,
      included_bytes: includedBytes,
      inclusion: includedBytes < sourceBytes ? "truncated" : "full",
    });
    remaining -= Buffer.byteLength(header) + includedBytes;
  }
  const diagnostic =
    candidates.length === 0
      ? { code: "empty_repository" as const, detail: "GitHub returned no eligible open issues" }
      : {
          code: "planner_input_ready" as const,
          detail: `${selected.length} open issue(s) selected without an op:ready filter`,
        };
  return intakeRecord(
    input,
    query,
    selected,
    budgetBytes - remaining,
    Math.max(0, candidates.length - selected.length),
    diagnostic,
    budgetBytes,
  );
}

export function plannerIssueIntakeBrief(intake: PlannerIssueIntake): string {
  if (intake.issues.length === 0)
    return `Planner issue intake: ${intake.diagnostic.code} — ${intake.diagnostic.detail}`;
  return intake.issues
    .map((issue) =>
      [
        `### #${issue.number} ${issue.title}`,
        `Labels: ${issue.labels.join(", ") || "none"}`,
        `Provenance: GitHub issue #${issue.number}; body ${issue.inclusion}, ${issue.included_bytes}/${issue.source_bytes} bytes.`,
        "",
        issue.body,
      ].join("\n"),
    )
    .join("\n\n");
}

export async function applyPlannerReadinessDecisions(input: {
  gh: Pick<GhOps, "addLabel" | "removeLabel" | "readIssue">;
  intake: PlannerIssueIntake;
  decisions: readonly PlannerReadinessDecision[];
  fault?: (boundary: "after_remote") => void | Promise<void>;
}): Promise<PlannerReadinessApplication> {
  const outcomes = validateReadinessDecisions(input.intake, input.decisions);
  const appliedIssueNumbers: number[] = [];
  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index]!;
    if (outcome.disposition !== "ready") continue;
    const issueNumber = outcome.issue_number;

    // The intake is a bounded snapshot, not authority. A human may route the
    // ticket after Planner read it, so re-read immediately before publication.
    // If GitHub cannot supply label state, uncertainty narrows capability:
    // nothing is readied and the typed outcome says why.
    let before: GhIssue;
    try {
      before = await input.gh.readIssue(issueNumber);
    } catch (error) {
      outcomes[index] = routingOutcome(
        outcome,
        "routing_state_unreadable",
        `autonomous readiness excluded because GitHub label state is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const beforeExclusion = autonomousExecutionExclusionLabel(before.labels);
    if (beforeExclusion !== undefined) {
      outcomes[index] = routingOutcome(outcome, "autonomous_execution_excluded", exclusionReason(beforeExclusion));
      continue;
    }

    // A replay after a lost acknowledgement observes the exact intended
    // state and performs no duplicate remote write.
    if (!before.labels.includes("op:ready")) {
      await input.gh.addLabel(issueNumber, "op:ready");
      await input.fault?.("after_remote");
    }
    let observed: GhIssue;
    try {
      observed = await input.gh.readIssue(issueNumber);
    } catch (error) {
      // Publication is not complete until the routing state and the new phase
      // are both observable. Retract readiness when that proof is unavailable
      // so a later Builder cannot inherit an uncertified Planner decision.
      try {
        await input.gh.removeLabel(issueNumber, "op:ready");
      } catch (rollbackError) {
        throw new Error(
          `Planner could not verify routing state or retract op:ready on issue #${issueNumber}: ` +
            `${error instanceof Error ? error.message : String(error)}; rollback failed: ` +
            `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }
      outcomes[index] = routingOutcome(
        outcome,
        "routing_state_unreadable",
        `autonomous readiness excluded because routing state became unreadable during publication; op:ready was removed: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const observedExclusion = autonomousExecutionExclusionLabel(observed.labels);
    if (observedExclusion !== undefined) {
      if (observed.labels.includes("op:ready")) await input.gh.removeLabel(issueNumber, "op:ready");
      outcomes[index] = routingOutcome(
        outcome,
        "autonomous_execution_excluded",
        `ticket acquired ${observedExclusion} while readiness was publishing; op:ready was removed`,
      );
      continue;
    }
    if (!observed.labels.includes("op:ready")) {
      throw new Error(`GitHub did not acknowledge op:ready on issue #${issueNumber}`);
    }
    appliedIssueNumbers.push(issueNumber);
  }
  return {
    schema_version: 1,
    kind: "planner-readiness-application",
    intake_sha256: input.intake.manifest_sha256,
    applied_issue_numbers: appliedIssueNumbers,
    outcomes,
  };
}

function validateReadinessDecisions(
  intake: PlannerIssueIntake,
  decisions: readonly PlannerReadinessDecision[],
): PlannerReadinessOutcome[] {
  const actionable = intake.issues.filter(
    (issue) => !issue.labels.some((label) => STATE_LABELS.includes(label as (typeof STATE_LABELS)[number])),
  );
  const byNumber = new Map<number, PlannerReadinessDecision>();
  for (const decision of decisions) {
    if (byNumber.has(decision.issue_number))
      throw new Error(`duplicate Planner readiness decision for #${decision.issue_number}`);
    if (decision.reason.trim().length === 0)
      throw new Error(`Planner readiness decision #${decision.issue_number} has no reason`);
    byNumber.set(decision.issue_number, decision);
  }
  const allowed = new Set(actionable.map((issue) => issue.number));
  for (const number of byNumber.keys()) {
    if (!allowed.has(number))
      throw new Error(`Planner readiness decision references unknown or already-active issue #${number}`);
  }
  return actionable.map((issue) => {
    const requested = byNumber.get(issue.number);
    if (requested === undefined) throw new Error(`Planner omitted readiness decision for #${issue.number}`);
    const guard = plannerRoutineReadinessGuard(issue);
    if (requested.disposition === "ready" && guard !== undefined) {
      return {
        ...requested,
        requested_disposition: "ready",
        disposition: "unready",
        reason_code: guard.code,
        reason: guard.detail,
      };
    }
    if (requested.disposition === "ready" && requested.reason_code !== "routine_ready") {
      throw new Error(`ready decision #${issue.number} must use reason_code routine_ready`);
    }
    if (requested.disposition === "unready" && requested.reason_code === "routine_ready") {
      throw new Error(`unready decision #${issue.number} cannot use reason_code routine_ready`);
    }
    return { ...requested, requested_disposition: requested.disposition };
  });
}

export function plannerRoutineReadinessGuard(issue: PlannerIssueInput):
  | {
      code: "high_risk" | "validation_incomplete" | "autonomous_execution_excluded";
      detail: string;
    }
  | undefined {
  const exclusion = autonomousExecutionExclusionLabel(issue.labels);
  if (exclusion !== undefined) {
    return {
      code: "autonomous_execution_excluded",
      detail: exclusionReason(exclusion),
    };
  }
  if (issue.labels.includes("op:tier-deep") || issue.labels.some((label) => label.startsWith("domain:"))) {
    return { code: "high_risk", detail: "high-risk/deep work requires human-signed criteria before op:ready" };
  }
  const required = [
    /(?:^|\n)Depends-on:\s*\S/im,
    /(?:^|\n)Execution group:\s*\S/im,
    /(?:^|\n)File scope:\s*\S/im,
    /^##\s+Acceptance criteria\s*$/im,
    /^\s*-\s+\[\s\]\s+\S/m,
  ];
  const tiers = issue.labels.filter((label) => /^op:tier-(?:quick|standard|deep)$/.test(label));
  const priorities = issue.labels.filter((label) => /^p[123]$/.test(label));
  if (
    issue.inclusion !== "full" ||
    tiers.length !== 1 ||
    priorities.length !== 1 ||
    required.some((pattern) => !pattern.test(issue.body))
  ) {
    return {
      code: "validation_incomplete",
      detail: "ticket lacks complete tier, priority, scope, dependency, or binary acceptance evidence",
    };
  }
  return undefined;
}

function intakeRecord(
  input: { app: string; turnId: string },
  query: ListIssueOptions,
  issues: PlannerIssueInput[],
  includedBytes: number,
  deferredCount: number,
  diagnostic: PlannerIssueIntake["diagnostic"],
  budgetBytes = PLANNER_ISSUE_BUDGET_BYTES,
): PlannerIssueIntake {
  const withoutHash = {
    schema_version: 1 as const,
    kind: "planner-issue-intake" as const,
    app: input.app,
    turn_id: input.turnId,
    query: structuredClone(query),
    budget_bytes: budgetBytes,
    included_bytes: includedBytes,
    deferred_count: deferredCount,
    issues,
    diagnostic,
  };
  return { ...withoutHash, manifest_sha256: sha256(canonicalJson(withoutHash)) };
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let end = Math.min(value.length, maxBytes);
  while (end > 0 && Buffer.byteLength(value.slice(0, end)) > maxBytes) end -= 1;
  return value.slice(0, end);
}

function isReadinessReasonCode(value: unknown): value is PlannerReadinessReasonCode {
  return [
    "routine_ready",
    "high_risk",
    "validation_incomplete",
    "blocked_dependency",
    "needs_information",
    "not_buildable",
    "autonomous_execution_excluded",
    "routing_state_unreadable",
  ].includes(String(value));
}

function routingOutcome(
  outcome: PlannerReadinessOutcome,
  reasonCode: "autonomous_execution_excluded" | "routing_state_unreadable",
  reason: string,
): PlannerReadinessOutcome {
  return {
    ...outcome,
    requested_disposition: outcome.requested_disposition,
    disposition: "unready",
    reason_code: reasonCode,
    reason,
  };
}

function exclusionReason(label: string): string {
  return label === AUTONOMOUS_EXECUTION_EXCLUSION_LABEL
    ? `ticket carries ${label}; only a human may route this PR scope`
    : `ticket carries ${label}; only a human may remove this review hold`;
}
