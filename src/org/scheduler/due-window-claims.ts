import {
  DurableClaimStore,
  durableClaimSettlementId,
  type DurableClaimOwner,
  type DurableClaimOwnerStatus,
  type DurableClaimRecord,
  type DurableClaimResult,
  type DurableClaimToken,
} from "../../runtime/durable-claim.js";
import { scheduledEpisodeId } from "./model.js";

const SCHEDULE_DUE_MAX_ATTEMPTS = 2;

export interface ScheduleDueClaimPayload {
  org_id: string;
  app: string;
  role: string;
  trigger: string;
  due_window: string;
}

type ScheduleDueClaimRecord = DurableClaimRecord<ScheduleDueClaimPayload>;
type ScheduleDueClaimResult = DurableClaimResult<ScheduleDueClaimPayload>;

/** Scheduler-owned adapter over the reusable runtime claim primitive. The
 * settlement identity excludes attempt: an explicit retry remains visibly
 * attached to the one due window rather than masquerading as new work. */
export class ScheduleDueClaimStore {
  private readonly store: DurableClaimStore<ScheduleDueClaimPayload>;

  constructor(
    stateHome: string,
    options: { ownerStatus?: (owner: DurableClaimOwner) => DurableClaimOwnerStatus } = {},
  ) {
    this.store = new DurableClaimStore({
      root: stateHome,
      namespace: "scheduler/due-window-claims",
      ...(options.ownerStatus !== undefined ? { ownerStatus: options.ownerStatus } : {}),
    });
  }

  settlementId(payload: ScheduleDueClaimPayload): string {
    return durableClaimSettlementId(scheduleDueIdentity(payload));
  }

  turnId(settlementId: string, attempt: number): string {
    return scheduledEpisodeId(`${settlementId}\0attempt:${attempt}`);
  }

  async claim(payload: ScheduleDueClaimPayload, now: Date, explicitRetry = false): Promise<ScheduleDueClaimResult> {
    return this.store.claim({
      identity: scheduleDueIdentity(payload),
      payload,
      maxAttempts: SCHEDULE_DUE_MAX_ATTEMPTS,
      now,
      ...(explicitRetry ? { explicitRetry: true } : {}),
    });
  }

  async commit(input: {
    settlementId: string;
    attempt: number;
    token: DurableClaimToken;
    runId: string;
    now: Date;
  }): Promise<ScheduleDueClaimRecord> {
    return this.store.commit(input);
  }

  async settle(input: {
    settlementId: string;
    attempt: number;
    runId: string;
    outcome: string;
    now: Date;
  }): Promise<ScheduleDueClaimRecord> {
    return this.store.settle(input);
  }

  async read(settlementId: string): Promise<ScheduleDueClaimRecord | undefined> {
    return this.store.read(settlementId);
  }

  async list(): Promise<ScheduleDueClaimRecord[]> {
    return this.store.list();
  }
}

function scheduleDueIdentity(payload: ScheduleDueClaimPayload): string {
  return [payload.org_id, payload.app, payload.role, payload.trigger, payload.due_window].join("\0");
}
