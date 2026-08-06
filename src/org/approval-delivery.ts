// Durable execution for allowlisted content-bound approval actions (#103).
// Approval and execution are separate facts: the human decision mints the
// grant, then a later dispatch claims the exact typed action, reconciles its
// idempotency marker, executes once, and persists acknowledgement evidence.

import type { GhIssue, GhOps } from "../loop/github.js";
import { GhCliOps, GhOpsError } from "../loop/github.js";
import type { ToolAction } from "../runtime/types.js";
import { actionHash, ApprovalStore, type ApprovalItem } from "./approvals.js";
import type { AppEntry, AppsFile } from "./apps.js";
import { grantScopeText } from "./gate-compose.js";

const GITHUB_ISSUE_CREATE_TOOL = "cormidia.github.issue.create";
const GITHUB_ISSUE_COMMENT_TOOL = "cormidia.github.issue.comment";

interface DurableGitHubIssueCreateInput {
  schema_version: 1;
  repo: string;
  title: string;
  body: string;
  labels: string[];
  idempotency_key: string;
  destination: "github";
  effect: "create_issue";
}

interface DurableGitHubIssueCommentInput {
  schema_version: 1;
  repo: string;
  issue_number: number;
  body: string;
  idempotency_key: string;
  destination: "github";
  effect: "comment_issue";
}

type DurableGitHubAction =
  | { tool: typeof GITHUB_ISSUE_CREATE_TOOL; input: DurableGitHubIssueCreateInput }
  | { tool: typeof GITHUB_ISSUE_COMMENT_TOOL; input: DurableGitHubIssueCommentInput };

export type DeliveryFailureCause =
  | "gate_denied"
  | "sandbox_denied"
  | "dns_failure"
  | "tls_failure"
  | "authentication_failure"
  | "remote_rejection"
  | "remote_api_failure"
  | "ambiguous_remote_response"
  | "invalid_action"
  | "grant_unavailable";

interface ApprovalDeliveryOutcome {
  approvalId: string;
  app: string;
  status: "executed" | "failed" | "ambiguous" | "skipped";
  summary: string;
  cause?: DeliveryFailureCause;
  remoteRef?: string;
}

interface ExecuteApprovedDeliveriesOptions {
  stateHome: string;
  appsFile: AppsFile;
  now?: () => Date;
  ghFor?: (app: AppEntry) => GhOps;
  /** Deterministic crash injection used by regression tests. A throw after
   * the remote response deliberately leaves the item `executing`; the next
   * dispatch reconciles by idempotency marker and never blindly retries. */
  fault?: (boundary: "after_claim" | "after_remote") => void | Promise<void>;
}

export function githubIssueCreateAction(
  input: Omit<DurableGitHubIssueCreateInput, "schema_version" | "destination" | "effect">,
): ToolAction {
  validateIdempotencyKey(input.idempotency_key);
  return {
    tool: GITHUB_ISSUE_CREATE_TOOL,
    input: {
      schema_version: 1,
      ...input,
      labels: [...new Set(input.labels)].sort(),
      destination: "github",
      effect: "create_issue",
    } satisfies DurableGitHubIssueCreateInput,
  };
}

/** Execute and reconcile every approved allowlisted GitHub action. Generic
 * shell commands remain on artifact-level actor retry; release commands stay
 * on the specialized A4 executor in release.ts. */
export async function executeApprovedDeliveries(
  options: ExecuteApprovedDeliveriesOptions,
): Promise<ApprovalDeliveryOutcome[]> {
  const clock = options.now ?? (() => new Date());
  const store = new ApprovalStore(options.stateHome);
  const outcomes: ApprovalDeliveryOutcome[] = [];
  const items = (await store.listDecided()).filter(
    (item) => item.decision === "approved" && item.execution?.executor === "durable-github",
  );

  for (const item of items) {
    const app = options.appsFile.apps.find((entry) => entry.name === item.app);
    const parsed = parseDurableGitHubAction(item.action);
    if (app === undefined || parsed === undefined || parsed.input.repo !== app.repo) {
      outcomes.push(
        await failWithoutRemote(
          store,
          item,
          "invalid_action",
          "approved GitHub delivery has invalid app/repo/action metadata",
          clock,
        ),
      );
      continue;
    }
    const gh = options.ghFor?.(app) ?? new GhCliOps(app.repo);

    if (item.execution?.state === "executed" || item.execution?.state === "failed") continue;
    if (item.execution?.state === "executing" || item.execution?.state === "ambiguous") {
      let reconciled: string | undefined;
      try {
        reconciled = await reconcileExisting(gh, parsed);
      } catch (error) {
        const classification = classifyDeliveryError(error);
        const summary = `reconciliation ${classification.summary}`;
        if (item.execution.state === "executing") {
          await store.finishExecution({
            id: item.id,
            state: "ambiguous",
            actor: "orchestrator/dispatch-reconcile",
            result: summary,
            failureCause: classification.cause,
            now: clock(),
          });
        }
        outcomes.push({
          approvalId: item.id,
          app: item.app,
          status: "ambiguous",
          summary,
          cause: classification.cause,
        });
        continue;
      }
      if (reconciled !== undefined) {
        const finished = await store.finishExecution({
          id: item.id,
          state: "executed",
          actor: "orchestrator/dispatch-reconcile",
          result: "remote acknowledgement recovered from idempotency marker",
          remoteRef: reconciled,
          now: clock(),
        });
        outcomes.push({
          approvalId: item.id,
          app: item.app,
          status: "executed",
          summary: finished.execution!.result!,
          remoteRef: reconciled,
        });
      } else if (item.execution.state === "executing") {
        const finished = await store.finishExecution({
          id: item.id,
          state: "ambiguous",
          actor: "orchestrator/dispatch-reconcile",
          result: "prior executor stopped before acknowledgement and no unique remote marker was found",
          failureCause: "ambiguous_remote_response",
          now: clock(),
        });
        outcomes.push({
          approvalId: item.id,
          app: item.app,
          status: "ambiguous",
          summary: finished.execution!.result!,
          cause: "ambiguous_remote_response",
        });
      } else {
        outcomes.push({
          approvalId: item.id,
          app: item.app,
          status: "skipped",
          summary: "ambiguous delivery still requires reconciliation or human disposition",
        });
      }
      continue;
    }

    const claimed = await store.beginExecution(item.id, "orchestrator/dispatch", clock());
    if (claimed === undefined) continue;
    await options.fault?.("after_claim");
    const grant = store.findMatchingGrantSync({
      app: item.app,
      role: item.role,
      actionHash: actionHash(item.action),
      rule: item.rule,
      actionText: grantScopeText(item.action),
      ...(item.ticketRef !== undefined ? { ticketRef: item.ticketRef } : {}),
      now: clock(),
    });
    if (grant === undefined) {
      outcomes.push(
        await terminalFailure(store, item, "grant_unavailable", "approved action has no live matching grant", clock),
      );
      continue;
    }
    store.consumeGrantSync(grant.grantId, clock());

    let existing: string | undefined;
    try {
      existing = await reconcileExisting(gh, parsed);
    } catch (error) {
      // No mutation has been attempted yet, so even a timeout/5xx here is a
      // confirmed failed attempt rather than an ambiguous outward effect.
      const classification = classifyDeliveryError(error);
      const state = error instanceof NonUniqueDeliveryMarkerError ? ("ambiguous" as const) : ("failed" as const);
      await store.finishExecution({
        id: item.id,
        state,
        actor: "orchestrator/dispatch",
        result: `preflight ${classification.summary}`,
        failureCause: classification.cause,
        now: clock(),
      });
      outcomes.push({
        approvalId: item.id,
        app: item.app,
        status: state,
        summary: `preflight ${classification.summary}`,
        cause: classification.cause,
      });
      continue;
    }
    if (existing !== undefined) {
      await store.finishExecution({
        id: item.id,
        state: "executed",
        actor: "orchestrator/dispatch",
        result: "existing remote action matched the idempotency marker",
        remoteRef: existing,
        now: clock(),
      });
      outcomes.push({
        approvalId: item.id,
        app: item.app,
        status: "executed",
        summary: "existing remote action matched the idempotency marker",
        remoteRef: existing,
      });
      continue;
    }

    let remoteRef: string;
    try {
      remoteRef = await executeGitHubAction(gh, parsed);
    } catch (error) {
      const classification = classifyDeliveryError(error);
      if (classification.ambiguous) {
        const reconciled = await safeReconcileExisting(gh, parsed);
        if (reconciled !== undefined) {
          await store.finishExecution({
            id: item.id,
            state: "executed",
            actor: "orchestrator/dispatch-reconcile",
            result: "ambiguous response reconciled to a unique remote marker",
            remoteRef: reconciled,
            now: clock(),
          });
          outcomes.push({
            approvalId: item.id,
            app: item.app,
            status: "executed",
            summary: "ambiguous response reconciled to a unique remote marker",
            remoteRef: reconciled,
          });
          continue;
        }
      }
      const state = classification.ambiguous ? ("ambiguous" as const) : ("failed" as const);
      await store.finishExecution({
        id: item.id,
        state,
        actor: "orchestrator/dispatch",
        result: classification.summary,
        failureCause: classification.cause,
        now: clock(),
      });
      outcomes.push({
        approvalId: item.id,
        app: item.app,
        status: state,
        summary: classification.summary,
        cause: classification.cause,
      });
      continue;
    }

    await options.fault?.("after_remote");
    await store.finishExecution({
      id: item.id,
      state: "executed",
      actor: "orchestrator/dispatch",
      result: "remote action acknowledged",
      remoteRef,
      now: clock(),
    });
    outcomes.push({
      approvalId: item.id,
      app: item.app,
      status: "executed",
      summary: "remote action acknowledged",
      remoteRef,
    });
  }
  return outcomes;
}

function parseDurableGitHubAction(action: ApprovalItem["action"]): DurableGitHubAction | undefined {
  if (!isRecord(action.input)) return undefined;
  const input = action.input;
  if (action.tool === GITHUB_ISSUE_CREATE_TOOL) {
    if (
      input["schema_version"] !== 1 ||
      typeof input["repo"] !== "string" ||
      typeof input["title"] !== "string" ||
      typeof input["body"] !== "string" ||
      !Array.isArray(input["labels"]) ||
      input["labels"].some((label) => typeof label !== "string") ||
      typeof input["idempotency_key"] !== "string" ||
      input["destination"] !== "github" ||
      input["effect"] !== "create_issue"
    )
      return undefined;
    validateIdempotencyKey(input["idempotency_key"]);
    return { tool: GITHUB_ISSUE_CREATE_TOOL, input: input as unknown as DurableGitHubIssueCreateInput };
  }
  if (action.tool === GITHUB_ISSUE_COMMENT_TOOL) {
    if (
      input["schema_version"] !== 1 ||
      typeof input["repo"] !== "string" ||
      !Number.isInteger(input["issue_number"]) ||
      typeof input["body"] !== "string" ||
      typeof input["idempotency_key"] !== "string" ||
      input["destination"] !== "github" ||
      input["effect"] !== "comment_issue"
    )
      return undefined;
    validateIdempotencyKey(input["idempotency_key"]);
    return { tool: GITHUB_ISSUE_COMMENT_TOOL, input: input as unknown as DurableGitHubIssueCommentInput };
  }
  return undefined;
}

async function executeGitHubAction(gh: GhOps, action: DurableGitHubAction): Promise<string> {
  if (action.tool === GITHUB_ISSUE_CREATE_TOOL) {
    for (const label of action.input.labels) {
      if (label === "op:incident") {
        await gh.ensureLabel({ name: label, color: "d73a4a", description: "Cormidia incident requiring response" });
      }
    }
    const issue = await gh.createIssue({
      title: action.input.title,
      body: withMarker(action.input.body, action.input.idempotency_key),
      labels: action.input.labels,
    });
    return issue.url ?? `#${issue.number}`;
  }
  await gh.commentIssue(action.input.issue_number, withMarker(action.input.body, action.input.idempotency_key));
  return `#${action.input.issue_number}#comment`;
}

async function reconcileExisting(gh: GhOps, action: DurableGitHubAction): Promise<string | undefined> {
  const marker = deliveryMarker(action.input.idempotency_key);
  if (action.tool === GITHUB_ISSUE_CREATE_TOOL) {
    // Search independently of mutable labels: removing `op:incident` must
    // not hide the marker and let a later dispatch create a duplicate.
    const matches = (await gh.listIssues({ state: "all", limit: 1_000 })).filter((issue) =>
      issue.body.includes(marker),
    );
    if (matches.length > 1) throw new NonUniqueDeliveryMarkerError(matches.length);
    return uniqueIssueRef(matches);
  }
  const matches = (await gh.listIssueComments(action.input.issue_number)).filter((comment) =>
    comment.body.includes(marker),
  );
  if (matches.length > 1) throw new NonUniqueDeliveryMarkerError(matches.length);
  return matches.length === 1 ? `#${action.input.issue_number}#comment` : undefined;
}

async function safeReconcileExisting(gh: GhOps, action: DurableGitHubAction): Promise<string | undefined> {
  try {
    return await reconcileExisting(gh, action);
  } catch {
    return undefined;
  }
}

function uniqueIssueRef(matches: GhIssue[]): string | undefined {
  if (matches.length !== 1) return undefined;
  return matches[0]!.url ?? `#${matches[0]!.number}`;
}

class NonUniqueDeliveryMarkerError extends Error {
  constructor(count: number) {
    super(`multiple remote actions (${count}) matched the durable delivery marker`);
    this.name = "NonUniqueDeliveryMarkerError";
  }
}

function classifyDeliveryError(error: unknown): { cause: DeliveryFailureCause; ambiguous: boolean; summary: string } {
  const detail = error instanceof Error ? error.message : String(error);
  const raw = error instanceof GhOpsError ? `${error.stderr}\n${error.stdout}\n${detail}` : detail;
  const lower = raw.toLowerCase();
  if (/sandbox|operation not permitted|permission denied by policy/.test(lower))
    return result("sandbox_denied", false, detail);
  if (/enotfound|could not resolve|name or service not known|dns/.test(lower))
    return result("dns_failure", false, detail);
  if (/certificate|tls|ssl/.test(lower)) return result("tls_failure", false, detail);
  if (/authentication|not logged|http 401|http 403|bad credentials/.test(lower))
    return result("authentication_failure", false, detail);
  if (/validation failed|unprocessable|http 4\d\d|not found/.test(lower))
    return result("remote_rejection", false, detail);
  if (/timeout|timed out|econnreset|socket hang up|unexpected eof|unreachable/.test(lower))
    return result("ambiguous_remote_response", true, detail);
  if (/http 5\d\d|api\.github\.com/.test(lower)) return result("remote_api_failure", true, detail);
  return result("ambiguous_remote_response", true, detail);
}

function result(cause: DeliveryFailureCause, ambiguous: boolean, detail: string) {
  return { cause, ambiguous, summary: `${cause}: ${detail.split("\n")[0]}` };
}

async function terminalFailure(
  store: ApprovalStore,
  item: ApprovalItem,
  cause: DeliveryFailureCause,
  summary: string,
  clock: () => Date,
): Promise<ApprovalDeliveryOutcome> {
  await store.finishExecution({
    id: item.id,
    state: "failed",
    actor: "orchestrator/dispatch",
    result: summary,
    failureCause: cause,
    now: clock(),
  });
  return { approvalId: item.id, app: item.app, status: "failed", summary, cause };
}

async function failWithoutRemote(
  store: ApprovalStore,
  item: ApprovalItem,
  cause: DeliveryFailureCause,
  summary: string,
  clock: () => Date,
): Promise<ApprovalDeliveryOutcome> {
  if (item.execution?.state === "approved") await store.beginExecution(item.id, "orchestrator/dispatch", clock());
  if (item.execution?.state === "approved" || item.execution?.state === "executing") {
    return terminalFailure(store, item, cause, summary, clock);
  }
  return { approvalId: item.id, app: item.app, status: "skipped", summary };
}

function deliveryMarker(key: string): string {
  return `<!-- cormidia:delivery id=${key} -->`;
}

function withMarker(body: string, key: string): string {
  const marker = deliveryMarker(key);
  return body.includes(marker) ? body : `${body.trimEnd()}\n\n${marker}\n`;
}

function validateIdempotencyKey(key: string): void {
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) {
    throw new Error("durable GitHub action idempotency_key must be 8-160 stable characters");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
