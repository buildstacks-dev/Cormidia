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

const APPROVAL_ACTION_REF =
  /^approval:([A-Za-z0-9][A-Za-z0-9._-]{0,199}):action-sha256:([a-f0-9]{64})$/;

export interface ExistingTicketApprovalHandlerOptions {
  store: ApprovalStore;
  app: string;
  roleNames: readonly string[];
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
        summary: `approval ${approval.id} is awaiting a durable human decision`,
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
