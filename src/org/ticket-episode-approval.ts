import { existsSync } from "node:fs";
import type { LoopItem } from "../loop/types.js";
import type {
  AcceptedTicketEpisodePlan,
} from "../loop/driver.js";
import type { ApprovalStep } from "../loop/episode-plan.js";
import type {
  ApprovalStepOutcome,
  EpisodeStepExecutionContext,
} from "../loop/episode-plan-executor.js";
import {
  actionHash,
  ApprovalStore,
  type ApprovalItem,
} from "./approvals.js";
import { withFileLock } from "../runtime/file-lock.js";
import {
  readTicketClaimState,
  ticketStatePath,
  writeTicketClaimState,
  type TicketClaimEvent,
} from "../loop/rehydrate.js";

const APPROVAL_ACTION_REF =
  /^approval:([A-Za-z0-9][A-Za-z0-9._-]{0,199}):action-sha256:([a-f0-9]{64})$/;
const CLAIM_LOCK_STALE_MS = 10 * 60_000;
const CLAIM_LOCK_WAIT_MS = 12 * 60_000;
const CLAIM_EVENT_LIMIT = 100;

export interface ExistingTicketApprovalHandlerOptions {
  store: ApprovalStore;
  app: string;
  roleNames: readonly string[];
  now?: () => Date;
}

export type TicketEpisodeApprovalHandler = (
  step: ApprovalStep,
  execution: EpisodeStepExecutionContext,
  item: LoopItem,
  accepted: AcceptedTicketEpisodePlan,
) => Promise<ApprovalStepOutcome>;

/**
 * Observe one already-existing, content-bound approval decision for a ticket
 * EpisodePlan. This handler deliberately has no raise/decide/grant-consume
 * path: the role-scoped action gate remains the sole authority for executing
 * the approved action.
 */
export function createExistingTicketApprovalHandler(
  options: ExistingTicketApprovalHandlerOptions,
): TicketEpisodeApprovalHandler {
  const roleNames = new Set(options.roleNames);
  return async (step, execution, item, accepted) => {
    const reference = parseApprovalActionRef(step.actionRef);
    if (
      step.approvalKind !== "critical-operation" ||
      reference === undefined ||
      !step.inputRefs.some((input) => input.required && input.ref === step.actionRef)
    ) {
      return failure(
        "error_ticket_episode_approval_reference_invalid",
        `ticket plan approval ${step.id} must carry one exact content-bound approval reference`,
      );
    }

    const planProvenance = accepted.plan.creatorProvenance;
    const intentProvenance = accepted.intent.creatorScope?.provenance;
    if (
      accepted.plan.planningSource !== "creator_scope" ||
      planProvenance === undefined ||
      intentProvenance === undefined ||
      !planProvenance.evidenceRefs.includes(step.actionRef) ||
      !intentProvenance.evidenceRefs.includes(step.actionRef)
    ) {
      return failure(
        "error_ticket_episode_approval_provenance_invalid",
        `ticket plan approval ${step.id} is not backed by exact creator provenance`,
      );
    }

    let approval: ApprovalItem;
    try {
      const observedAt = options.now?.() ?? new Date();
      const expired = await options.store.expirePendingItem(
        reference.approvalId,
        observedAt,
      );
      if (expired !== undefined) {
        await releaseExpiredTicketApprovalClaim(options.store.root, expired, observedAt);
      }
      approval = (await options.store.show(reference.approvalId)).item;
    } catch {
      return failure(
        "error_ticket_episode_approval_not_found",
        `ticket plan approval ${step.id} references no durable approval item`,
      );
    }

    if (
      ticketApprovalActionRef(approval) !== step.actionRef ||
      approval.app !== options.app ||
      approval.ticketRef !== item.ticketRef ||
      !roleNames.has(approval.role)
    ) {
      return failure(
        "error_ticket_episode_approval_binding_mismatch",
        `ticket plan approval ${step.id} does not match this app, ticket, role, and action`,
      );
    }

    if (approval.status === "pending") {
      return {
        status: "pending",
        reasonCode: "ticket_episode_approval_pending",
        summary: `approval ${approval.id} is awaiting a durable attributable decision`,
      };
    }
    if (approval.status === "expired") {
      return {
        status: "denied",
        reasonCode: "ticket_episode_approval_expired",
        summary:
          `approval ${approval.id} expired undecided; the turn is blocked, its claim was released, ` +
          `and its durable artifacts remain preserved`,
      };
    }
    if (approval.status === "denied") {
      return {
        status: "denied",
        reasonCode: "ticket_episode_approval_denied",
        summary: `approval ${approval.id} was denied${
          approval.reason === undefined ? "" : `: ${approval.reason}`
        }`,
      };
    }
    if (approval.status !== "approved" || approval.decision !== "approved") {
      return failure(
        "error_ticket_episode_approval_state_invalid",
        `approval ${approval.id} has inconsistent durable decision state`,
      );
    }

    return {
      status: "completed",
      artifact: {
        approvalId: approval.id,
        actionSha256: reference.actionSha256,
        app: approval.app,
        role: approval.role,
        ticketRef: approval.ticketRef,
        rule: approval.rule,
        decision: "approved",
        planVersion: execution.planVersion,
        stepId: execution.stepId,
        executionId: execution.executionId,
        actionAuthority: "role-scoped-action-gate",
      },
    };
  };
}

/** Release only the suspended claim continuation associated with an expired
 * approval. The ticket's claim count is unchanged (expiry is not a merit
 * failure), and no worktree/artifact path is touched. Repeated calls are a
 * no-op, which lets approvals CLI, dispatch, and ticket observation converge
 * after any interruption. */
export async function releaseExpiredTicketApprovalClaim(
  root: string,
  item: ApprovalItem,
  now: Date = new Date(),
): Promise<boolean> {
  if (item.status !== "expired" || item.ticketRef === undefined) return false;
  const issueNumber = Number(/#(\d+)/.exec(item.ticketRef)?.[1]);
  if (!Number.isInteger(issueNumber)) return false;
  const path = ticketStatePath(root, item.app, issueNumber);
  if (!existsSync(path)) return false;

  return withFileLock(
    `${path}.lock`,
    { staleMs: CLAIM_LOCK_STALE_MS, maxWaitMs: CLAIM_LOCK_WAIT_MS },
    async () => {
      const state = readTicketClaimState(root, item.app, issueNumber);
      const continuation = state.continuation;
      if (continuation === undefined) return false;
      const claimNumber = continuation.claimNumber;
      const detail =
        `claim ${claimNumber}: approval ${item.id} expired; resolved blocked with artifacts ` +
        `preserved and no failure-claim consumption`;
      const event: TicketClaimEvent = {
        at: now.toISOString(),
        kind: "claim_terminal",
        claimNumber,
        detail,
        repeatedCostUsd: 0,
      };
      const { continuation: _continuation, ...withoutContinuation } = state;
      writeTicketClaimState(root, item.app, issueNumber, {
        ...withoutContinuation,
        outcomes: [...state.outcomes.slice(-9), detail],
        events: [...(state.events ?? []).slice(-(CLAIM_EVENT_LIMIT - 1)), event],
      });
      return true;
    },
  );
}

/** Canonical reference accepted by the ticket approval observer. */
export function ticketApprovalActionRef(item: ApprovalItem): string {
  return `approval:${item.id}:action-sha256:${actionHash(item.action)}`;
}

function parseApprovalActionRef(
  value: string,
): { approvalId: string; actionSha256: string } | undefined {
  const match = APPROVAL_ACTION_REF.exec(value);
  if (match === null) return undefined;
  return { approvalId: match[1]!, actionSha256: match[2]! };
}

function failure(reasonCode: string, summary: string): ApprovalStepOutcome {
  return { status: "failed", reasonCode, summary };
}
