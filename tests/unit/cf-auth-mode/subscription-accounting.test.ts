// CF-AUTH-MODE — subscription billing in settlement and budget rollups
// (#333), L1.
//
// A subscription turn has no marginal dollar cost. That is an AUTHORITATIVE
// zero carrying `billing: "subscription"` — categorically different from
// unknown cost (`quality: "unavailable"`), and never a silent zero (INV-006).
// The rollup therefore reports metered spend and plan VOLUME as two numbers,
// because summing them would invent an invoice and hiding them would make a
// busy month on a plan look idle.
//
// Layer: 1 (unit). Zero network, zero tokens; every write lands in a temp home.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppsFile } from "../../../src/org/apps.js";
import { rollupBudgets } from "../../../src/org/budget.js";
import { recordTurn, toRecord, type TurnRecord } from "../../../src/runtime/telemetry.js";
import { billingSettlementFault, settleBilling } from "../../../src/runtime/turn-usage.js";
import type { RoleConfig, TurnResult, TurnUsage } from "../../../src/runtime/types.js";

const temps: string[] = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cormidia-billing-"));
  temps.push(dir);
  return dir;
}

const ROLE: RoleConfig = {
  name: "builder",
  runtime: "claude",
  model: "claude-opus-5",
  effort: "high",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 10,
};

const USAGE: TurnUsage = {
  tokensIn: 120_000,
  tokensOut: 4_000,
  cacheReadTokens: 100_000,
  costUsd: 3.25,
  costEstimated: true,
  subagentTurns: 1,
  wallClockMs: 42_000,
  quality: "estimated",
};

function result(usage: TurnUsage = USAGE): TurnResult {
  return {
    status: "completed",
    summary: "done",
    artifacts: [],
    session: { runtime: "claude", id: "s1" },
    usage,
    escalations: [],
  };
}

const APPS: AppsFile = {
  org: { name: "acme", maxConcurrentTurns: 2 },
  defaults: { budgetUsdMonth: 100, objectiveBudgetUsd: 100 },
  apps: [
    {
      name: "demo",
      repo: "acme/demo",
      status: "live",
      budgetUsdMonth: 100,
      objectiveBudgetUsd: 100,
      cadence: {},
    },
  ],
};

describe("CF-AUTH-MODE-SETTLE — a subscription turn settles as an authoritative zero", () => {
  it("labels the row, zeroes the marginal cost, and keeps tokens and quality intact", () => {
    const record = toRecord(ROLE, result(), new Date("2026-08-07T10:00:00Z"), {
      app: "demo",
      billing: "subscription",
      providerTurnId: "pt-1",
    });
    expect(record.billing).toBe("subscription");
    expect(record.costUsd).toBe(0);
    // An estimate of a charge that does not exist is not an estimate.
    expect(record.costEstimated).toBeUndefined();
    // Tokens and quality describe the OBSERVATION and keep their meaning.
    expect(record.tokensIn).toBe(120_000);
    expect(record.cacheReadTokens).toBe(100_000);
    expect(record.usageQuality).toBe("estimated");
    expect(record.subagentTurns).toBe(1);
  });

  it("is distinct from unknown cost — an unobservable plan turn stays `unavailable`", () => {
    const record = toRecord(ROLE, result({ ...USAGE, quality: "unavailable" }), new Date("2026-08-07T10:00:00Z"), {
      app: "demo",
      billing: "subscription",
      unmeasured: true,
    });
    expect(record.billing).toBe("subscription");
    expect(record.costUsd).toBe(0);
    expect(record.usageQuality).toBe("unavailable");
    expect(record.unmeasured).toBe(true);
  });

  it("an api_key turn is unchanged from today apart from the label", () => {
    const labelled = toRecord(ROLE, result(), new Date("2026-08-07T10:00:00Z"), {
      app: "demo",
      billing: "api_key",
    });
    const legacy = toRecord(ROLE, result(), new Date("2026-08-07T10:00:00Z"), { app: "demo" });
    expect(labelled.billing).toBe("api_key");
    expect(labelled.costUsd).toBe(3.25);
    expect(labelled.costEstimated).toBe(true);
    expect({ ...labelled, billing: undefined }).toEqual({ ...legacy, billing: undefined });
  });

  it("an undeclared connection settles exactly as before — no label, no zeroing", () => {
    const record = toRecord(ROLE, result(), new Date("2026-08-07T10:00:00Z"), { app: "demo" });
    expect(record.billing).toBeUndefined();
    expect(record.costUsd).toBe(3.25);
    expect(JSON.parse(JSON.stringify(record))).not.toHaveProperty("billing");
  });

  it("an adapter-observed label wins over the declaration for the same turn", () => {
    const record = toRecord(ROLE, result({ ...USAGE, billing: "api_key" }), new Date("2026-08-07T10:00:00Z"), {
      app: "demo",
      billing: "subscription",
    });
    expect(record.billing).toBe("api_key");
    expect(record.costUsd).toBe(3.25);
  });

  it("settleBilling itself is total: undefined passes through untouched", () => {
    expect(settleBilling(USAGE, undefined)).toBe(USAGE);
    expect(settleBilling(USAGE, "subscription").costUsd).toBe(0);
    expect(settleBilling(USAGE, "api_key").costUsd).toBe(3.25);
  });

  it("a subscription label with real dollars is a fault, not a preference", () => {
    expect(billingSettlementFault({ billing: "subscription", costUsd: 0 })).toBeUndefined();
    expect(billingSettlementFault({ billing: "api_key", costUsd: 3.25 })).toBeUndefined();
    expect(billingSettlementFault({ costUsd: 3.25 })).toBeUndefined();
    expect(billingSettlementFault({ billing: "subscription", costUsd: 3.25 })).toMatch(/non-zero costUsd/);
    expect(billingSettlementFault({ billing: "subscription" })).toMatch(/non-finite costUsd/);
  });
});

describe("CF-AUTH-MODE-ROLLUP — plan volume and metered spend are two numbers", () => {
  async function ledger(rows: Array<Partial<TurnRecord>>): Promise<string> {
    const home = await tempHome();
    for (const [index, row] of rows.entries()) {
      await recordTurn(home, {
        at: "2026-08-07T10:00:00Z",
        role: "builder",
        runtime: "claude",
        model: "claude-opus-5",
        status: "completed",
        tokensIn: 1_000,
        tokensOut: 100,
        costUsd: 0,
        usageQuality: "complete",
        subagentTurns: 0,
        wallClockMs: 1_000,
        escalations: 0,
        app: "demo",
        providerTurnId: `pt-${index}`,
        ...row,
      } as TurnRecord);
    }
    return home;
  }

  const now = new Date("2026-08-07T12:00:00Z");

  it("subscription turns are counted, never summed into spend", async () => {
    const home = await ledger([
      { billing: "subscription", costUsd: 0 },
      { billing: "subscription", costUsd: 0 },
      { billing: "api_key", costUsd: 4.5 },
    ]);
    const [row] = await rollupBudgets(home, APPS, now);
    expect(row!.spentUsd).toBe(4.5);
    expect(row!.subscriptionTurns).toBe(2);
    expect(row!.status).toBe("ok");
  });

  it("a month of plan-only work reports zero spend AND its real volume", async () => {
    const home = await ledger([
      { billing: "subscription", costUsd: 0 },
      { billing: "subscription", costUsd: 0 },
      { billing: "subscription", costUsd: 0 },
    ]);
    const [row] = await rollupBudgets(home, APPS, now);
    expect(row!.spentUsd).toBe(0);
    expect(row!.percent).toBe(0);
    // The distinction that makes the zero honest rather than silent.
    expect(row!.subscriptionTurns).toBe(3);
  });

  it("a subscription row carrying real dollars fails the month closed", async () => {
    const home = await ledger([{ billing: "subscription", costUsd: 7.5 }]);
    const [row] = await rollupBudgets(home, APPS, now);
    // Either the label or the cost is wrong; the reader picks neither.
    expect(row!.status).toBe("unknown");
    expect(row!.subscriptionTurns).toBe(0);
  });

  it("legacy unlabeled rows roll up exactly as they always did", async () => {
    const home = await ledger([{ costUsd: 30 }, { costUsd: 55 }]);
    const [row] = await rollupBudgets(home, APPS, now);
    expect(row!.spentUsd).toBe(85);
    expect(row!.subscriptionTurns).toBe(0);
    expect(row!.status).toBe("warning");
  });

  it("a malformed cost still fails closed, unchanged by #333", async () => {
    const home = await ledger([{ costUsd: "free" as unknown as number }]);
    const [row] = await rollupBudgets(home, APPS, now);
    expect(row!.status).toBe("unknown");
  });
});
