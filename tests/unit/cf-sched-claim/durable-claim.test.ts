// #231 — reusable durable single-claim primitive. This family is deliberately
// independent of scheduler code so a future per-item approval decision lock
// (#199) can adopt the same seam without refactoring approval execution locks.

import { afterEach, describe, expect, it } from "vitest";
import { DurableClaimStore, type DurableClaimRecord } from "../../../src/runtime/durable-claim.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const AT = new Date("2026-08-03T07:41:00.000Z");

class DuplicateClaimViolation extends Error {
  constructor(records: readonly DurableClaimRecord[]) {
    super(`one settlement identity has ${records.length} independently admitted attempts`);
    this.name = "DuplicateClaimViolation";
  }
}

class CommitBoundaryViolation extends Error {}

function assertOneActiveAttempt(records: readonly DurableClaimRecord[]): void {
  const active = records.filter((record) => record.status === "claimed" || record.status === "committed");
  if (active.length > 1) throw new DuplicateClaimViolation(active);
}

function assertCommitted(record: DurableClaimRecord): void {
  if (record.status !== "committed") throw new CommitBoundaryViolation();
}

describe("CF-SCHED-CLAIM — reusable durable single claim with explicit bounded retry", () => {
  let state: TempStateHome | undefined;

  afterEach(async () => {
    await state?.cleanup();
    state = undefined;
  });

  it("serializes concurrent claim attempts and preserves one settlement identity", async () => {
    state = await makeTempStateHome({ name: "durable-claim-race" });
    const store = new DurableClaimStore({ root: state.stateHome, namespace: "test-claims" });
    const input = {
      identity: ["app", "planner", "daily 07:00", "2026-08-03T07:00:00.000Z"].join("\0"),
      payload: { app: "app", role: "planner" },
      maxAttempts: 2,
      now: AT,
    };

    const raced = await Promise.all([store.claim(input), store.claim(input)]);
    expect(raced.filter((result) => result.disposition === "claimed")).toHaveLength(1);
    expect(raced.filter((result) => result.disposition === "already_claimed")).toHaveLength(1);
    expect(new Set(raced.map((result) => result.record.settlement_id))).toHaveLength(1);
    assertOneActiveAttempt(await store.list());
  });

  it("ordinary replay stays settled; one explicit retry reuses the identity and the hard attempt bound refuses another", async () => {
    state = await makeTempStateHome({ name: "durable-claim-retry" });
    const store = new DurableClaimStore({ root: state.stateHome, namespace: "test-claims" });
    const first = await store.claim({
      identity: "due-window-1",
      payload: { due_window: "2026-08-03T07:00:00.000Z" },
      maxAttempts: 2,
      now: AT,
    });
    expect(first.disposition).toBe("claimed");
    expect(first.token).toBeDefined();
    await store.commit({
      settlementId: first.record.settlement_id,
      attempt: 1,
      token: first.token!,
      runId: "run-1",
      now: AT,
    });
    await store.settle({
      settlementId: first.record.settlement_id,
      attempt: 1,
      runId: "run-1",
      outcome: "failed",
      now: AT,
    });

    const ordinary = await store.claim({
      identity: "due-window-1",
      payload: { due_window: "2026-08-03T07:00:00.000Z" },
      maxAttempts: 2,
      now: new Date(AT.getTime() + 5 * 60_000),
    });
    expect(ordinary.disposition).toBe("already_settled");

    const retry = await store.claim({
      identity: "due-window-1",
      payload: { due_window: "2026-08-03T07:00:00.000Z" },
      maxAttempts: 2,
      explicitRetry: true,
      now: new Date(AT.getTime() + 10 * 60_000),
    });
    expect(retry.disposition).toBe("explicit_retry");
    expect(retry.record).toMatchObject({
      settlement_id: first.record.settlement_id,
      attempt: 2,
      status: "claimed",
    });
    await store.commit({
      settlementId: retry.record.settlement_id,
      attempt: 2,
      token: retry.token!,
      runId: "run-2",
      now: AT,
    });
    await store.settle({
      settlementId: retry.record.settlement_id,
      attempt: 2,
      runId: "run-2",
      outcome: "failed",
      now: AT,
    });

    const exhausted = await store.claim({
      identity: "due-window-1",
      payload: { due_window: "2026-08-03T07:00:00.000Z" },
      maxAttempts: 2,
      explicitRetry: true,
      now: new Date(AT.getTime() + 15 * 60_000),
    });
    expect(exhausted.disposition).toBe("retry_exhausted");
    expect(exhausted.record.attempt).toBe(2);
  });

  it("a dead pre-commit owner is recovered under the same attempt; a live owner is only observed", async () => {
    state = await makeTempStateHome({ name: "durable-claim-recovery" });
    let owner: "live" | "dead" | "unknown" = "live";
    const store = new DurableClaimStore({
      root: state.stateHome,
      namespace: "test-claims",
      ownerStatus: () => owner,
    });
    const first = await store.claim({ identity: "recoverable", payload: {}, maxAttempts: 2, now: AT });
    expect(first.disposition).toBe("claimed");
    expect((await store.claim({ identity: "recoverable", payload: {}, maxAttempts: 2, now: AT })).disposition).toBe(
      "already_claimed",
    );

    owner = "dead";
    const recovered = await store.claim({
      identity: "recoverable",
      payload: {},
      maxAttempts: 2,
      now: new Date(AT.getTime() + 60_000),
    });
    expect(recovered.disposition).toBe("recovered_claim");
    expect(recovered.record.attempt).toBe(1);
    expect(recovered.record.settlement_id).toBe(first.record.settlement_id);
  });

  it("refuses settlement before the durable commit boundary", async () => {
    state = await makeTempStateHome({ name: "durable-claim-commit-boundary" });
    const store = new DurableClaimStore({ root: state.stateHome, namespace: "test-claims" });
    const claimed = await store.claim({
      identity: "must-commit-first",
      payload: { due_window: "2026-08-03T07:00:00.000Z" },
      maxAttempts: 2,
      now: AT,
    });

    await expect(
      store.settle({
        settlementId: claimed.record.settlement_id,
        attempt: claimed.record.attempt,
        runId: "run-without-commit",
        outcome: "forged",
        now: AT,
      }),
    ).rejects.toThrow("cannot settle before commit");
    expect((await store.read(claimed.record.settlement_id))?.status).toBe("claimed");

    // Seeded negative control: a forged claimed record must make the independent
    // commit-boundary detector fire rather than silently treating it as settled.
    expect(() => assertCommitted(claimed.record)).toThrow(CommitBoundaryViolation);
  });

  it("negative control: the detector fires if one identity is forged with two active attempts", () => {
    const forged = [
      { settlement_id: "same", status: "claimed" },
      { settlement_id: "same", status: "committed" },
    ] as DurableClaimRecord[];
    expect(() => assertOneActiveAttempt(forged)).toThrow(DuplicateClaimViolation);
  });
});
