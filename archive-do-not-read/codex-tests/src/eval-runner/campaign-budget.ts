import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  Runtime,
  TurnHooks,
  TurnRequest,
  TurnResult,
} from "../../../src/runtime/types.js";

export interface CampaignBudgetTurn {
  id: string;
  attempt_id: string;
  ordinal: number;
  status: "in_flight" | "settled";
  reserved_usd: number;
  observed_usd: number | null;
  admitted_at: string;
  settled_at: string | null;
  terminal_status: TurnResult["status"] | null;
  usage_quality: TurnResult["usage"]["quality"] | null;
  ceiling_violation: string | null;
}

export interface CampaignBudgetLedger {
  schema_version: 1;
  campaign_id: string;
  corpus_sha256: string;
  aggregate_ceiling_usd: number;
  per_turn_ceiling_usd: number;
  turns: CampaignBudgetTurn[];
}

export interface CampaignBudgetAuthorization {
  campaignId: string;
  aggregateCeilingUsd: number;
  perTurnCeilingUsd: number;
}

export interface CampaignSpendSummary {
  observedUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  unmeasuredTurnIds: string[];
  ceilingViolations: string[];
}

export class CampaignBudgetStore {
  constructor(
    readonly path: string,
    readonly corpusSha256: string,
    readonly authorization: CampaignBudgetAuthorization,
  ) {}

  async initialize(): Promise<CampaignBudgetLedger> {
    try {
      return await this.read();
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      const ledger: CampaignBudgetLedger = {
        schema_version: 1,
        campaign_id: this.authorization.campaignId,
        corpus_sha256: this.corpusSha256,
        aggregate_ceiling_usd: this.authorization.aggregateCeilingUsd,
        per_turn_ceiling_usd: this.authorization.perTurnCeilingUsd,
        turns: [],
      };
      await this.write(ledger);
      return ledger;
    }
  }

  async read(): Promise<CampaignBudgetLedger> {
    const parsed = JSON.parse(await readFile(this.path, "utf8")) as unknown;
    return validateLedger(parsed, this.corpusSha256, this.authorization);
  }

  async write(ledger: CampaignBudgetLedger): Promise<void> {
    validateLedger(ledger, this.corpusSha256, this.authorization);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }

  async summary(): Promise<CampaignSpendSummary> {
    return summarizeCampaignSpend(await this.read());
  }
}

export class EnforcedCampaignBudgetRuntime implements Runtime {
  readonly kind = "claude" as const;
  private turnOrdinal = 0;

  constructor(
    private readonly inner: Runtime,
    private readonly store: CampaignBudgetStore,
    private readonly attemptId: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (inner.kind !== "claude") {
      throw new Error(`campaign budget runtime requires claude; received ${inner.kind}`);
    }
  }

  async runTurn(request: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    this.turnOrdinal += 1;
    const turnId = `${this.attemptId}:planner-turn:${this.turnOrdinal}`;
    const ledger = await this.store.initialize();
    const duplicate = ledger.turns.find((turn) => turn.id === turnId);
    if (duplicate !== undefined) {
      return budgetRefusal(
        turnId,
        duplicate.status === "in_flight"
          ? "campaign budget has an unresolved in-flight reservation"
          : "campaign budget refuses a duplicate settled provider turn",
      );
    }
    const before = summarizeCampaignSpend(ledger);
    const reservation = Math.min(
      ledger.per_turn_ceiling_usd,
      request.role.maxTurnBudgetUsd,
      before.remainingUsd,
    );
    if (!Number.isFinite(reservation) || reservation <= 0) {
      return budgetRefusal(turnId, "campaign aggregate spend ceiling is exhausted");
    }
    const admittedAt = this.now().toISOString();
    ledger.turns.push({
      id: turnId,
      attempt_id: this.attemptId,
      ordinal: this.turnOrdinal,
      status: "in_flight",
      reserved_usd: reservation,
      observed_usd: null,
      admitted_at: admittedAt,
      settled_at: null,
      terminal_status: null,
      usage_quality: null,
      ceiling_violation: null,
    });
    await this.store.write(ledger);

    let result: TurnResult;
    try {
      result = await this.inner.runTurn(
        {
          ...request,
          role: {
            ...request.role,
            maxTurnBudgetUsd: reservation,
          },
        },
        hooks,
      );
    } catch (error) {
      // The reservation remains in flight. Unknown provider usage cannot be
      // reclaimed or guessed, so subsequent admission fails closed.
      throw error;
    }

    const after = await this.store.read();
    const turn = after.turns.find((entry) => entry.id === turnId);
    if (turn === undefined || turn.status !== "in_flight") {
      throw new Error(`campaign ledger lost in-flight reservation ${turnId}`);
    }
    const observed = result.usage.costUsd;
    const violation =
      !Number.isFinite(observed) || observed < 0
        ? `provider returned invalid observed spend ${String(observed)}`
        : observed > reservation + 0.000001
          ? `provider spend $${observed} exceeded reservation $${reservation}`
          : null;
    turn.status = "settled";
    turn.observed_usd = Number.isFinite(observed) && observed >= 0 ? observed : null;
    turn.settled_at = this.now().toISOString();
    turn.terminal_status = result.status;
    turn.usage_quality = result.usage.quality;
    turn.ceiling_violation = violation;
    await this.store.write(after);

    const summary = summarizeCampaignSpend(after);
    const aggregateViolation =
      summary.observedUsd > after.aggregate_ceiling_usd + 0.000001
        ? `observed aggregate spend $${summary.observedUsd} exceeded ` +
          `$${after.aggregate_ceiling_usd}`
        : undefined;
    if (violation === null && aggregateViolation === undefined) return result;
    return {
      ...result,
      status: "failed",
      errorCode: "error_campaign_spend_ceiling",
      summary: [violation, aggregateViolation].filter((entry) => entry !== undefined).join("; "),
      artifacts: [
        ...result.artifacts,
        {
          kind: "note",
          ref: `campaign-budget/${turnId}`,
          summary: "Layer-4 campaign spend enforcement detected a ceiling violation.",
        },
      ],
    };
  }
}

export function summarizeCampaignSpend(ledger: CampaignBudgetLedger): CampaignSpendSummary {
  const observedUsd = ledger.turns.reduce(
    (sum, turn) => sum + (turn.observed_usd ?? 0),
    0,
  );
  const reservedUsd = ledger.turns
    .filter((turn) => turn.status === "in_flight")
    .reduce((sum, turn) => sum + turn.reserved_usd, 0);
  return {
    observedUsd,
    reservedUsd,
    remainingUsd: Math.max(0, ledger.aggregate_ceiling_usd - observedUsd - reservedUsd),
    unmeasuredTurnIds: ledger.turns
      .filter((turn) => turn.status === "in_flight" || turn.observed_usd === null)
      .map((turn) => turn.id),
    ceilingViolations: ledger.turns
      .flatMap((turn) => turn.ceiling_violation === null ? [] : [`${turn.id}: ${turn.ceiling_violation}`]),
  };
}

export function evidenceBackedPlannerAttemptCount(
  preparedPlannerAttempts: number,
  budgetTurns: readonly CampaignBudgetTurn[],
): number {
  if (!Number.isInteger(preparedPlannerAttempts) || preparedPlannerAttempts < 0) {
    throw new Error("prepared planner-attempt count must be a non-negative integer");
  }
  const ordinals = budgetTurns.map((turn) => turn.ordinal);
  if (
    ordinals.some((ordinal) => !Number.isInteger(ordinal) || ordinal < 1) ||
    new Set(ordinals).size !== ordinals.length
  ) {
    throw new Error("budget-turn ordinals must be unique positive integers");
  }
  return Math.max(preparedPlannerAttempts, budgetTurns.length);
}

function validateLedger(
  value: unknown,
  corpusSha256: string,
  authorization: CampaignBudgetAuthorization,
): CampaignBudgetLedger {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("campaign budget ledger must be an object");
  }
  const ledger = value as Record<string, unknown>;
  const keys = [
    "schema_version",
    "campaign_id",
    "corpus_sha256",
    "aggregate_ceiling_usd",
    "per_turn_ceiling_usd",
    "turns",
  ];
  const unknown = Object.keys(ledger).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !(key in ledger));
  if (unknown.length > 0 || missing.length > 0) {
    throw new Error(
      `campaign budget ledger keys are invalid; unknown [${unknown.join(", ")}], ` +
        `missing [${missing.join(", ")}]`,
    );
  }
  if (
    ledger.schema_version !== 1 ||
    ledger.campaign_id !== authorization.campaignId ||
    ledger.corpus_sha256 !== corpusSha256 ||
    ledger.aggregate_ceiling_usd !== authorization.aggregateCeilingUsd ||
    ledger.per_turn_ceiling_usd !== authorization.perTurnCeilingUsd ||
    !Array.isArray(ledger.turns)
  ) {
    throw new Error("campaign budget ledger identity or ceilings disagree with authorization");
  }
  for (const [index, turnValue] of ledger.turns.entries()) {
    if (turnValue === null || typeof turnValue !== "object" || Array.isArray(turnValue)) {
      throw new Error(`campaign budget turn ${index} must be an object`);
    }
    const turn = turnValue as Record<string, unknown>;
    const turnKeys = [
      "id",
      "attempt_id",
      "ordinal",
      "status",
      "reserved_usd",
      "observed_usd",
      "admitted_at",
      "settled_at",
      "terminal_status",
      "usage_quality",
      "ceiling_violation",
    ];
    if (
      turnKeys.some((key) => !(key in turn)) ||
      Object.keys(turn).some((key) => !turnKeys.includes(key)) ||
      typeof turn.id !== "string" ||
      typeof turn.attempt_id !== "string" ||
      !Number.isInteger(turn.ordinal) ||
      (turn.status !== "in_flight" && turn.status !== "settled") ||
      typeof turn.reserved_usd !== "number" ||
      !Number.isFinite(turn.reserved_usd) ||
      turn.reserved_usd <= 0 ||
      turn.reserved_usd > authorization.perTurnCeilingUsd ||
      (turn.observed_usd !== null &&
        (typeof turn.observed_usd !== "number" || !Number.isFinite(turn.observed_usd))) ||
      typeof turn.admitted_at !== "string"
    ) {
      throw new Error(`campaign budget turn ${index} is invalid`);
    }
  }
  const ids = (ledger.turns as CampaignBudgetTurn[]).map((turn) => turn.id);
  if (new Set(ids).size !== ids.length) throw new Error("campaign budget turn ids must be unique");
  return ledger as unknown as CampaignBudgetLedger;
}

function budgetRefusal(turnId: string, reason: string): TurnResult {
  return {
    status: "failed",
    errorCode: "error_campaign_spend_ceiling",
    summary: reason,
    artifacts: [],
    session: { runtime: "claude", id: `not-started-${turnId}` },
    usage: {
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      subagentTurns: 0,
      wallClockMs: 0,
      quality: "complete",
    },
    escalations: [],
  };
}

function isMissingFile(error: unknown): boolean {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT";
}
