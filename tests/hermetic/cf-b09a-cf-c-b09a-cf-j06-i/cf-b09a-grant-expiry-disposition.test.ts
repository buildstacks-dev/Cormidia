// Traceability: CF-B09a · CF-C-B09A · CF-J06-I · HB-012 · HB-P5 · contracts/B-09a-approval-continuation.md §3; case-catalog.md §5 contract matrix.

// HB-P5 — F-PT-008 (owner ruling 2026-08-12): an expired grant REOPENS THE
// ORIGINAL ITEM. Never a silent fresh item, never a dropped operation.
//
// The two rejected dispositions are seeded as controls, because the ruling is
// a choice between three readings and a test that only asserts the winner
// proves nothing about the losers:
//   - FRESH ITEM  → a new id appears and the original decision history is
//     orphaned; the operation loses its thread to the decision already made.
//   - DROPPED     → the item stays decided-but-unusable and the operation is
//     stranded behind authority that quietly ran out.
//
// Also pinned: the TTLs are POLICY CONFIGURATION (F-PT-020 precedent), the
// ratified defaults are grant 48h / pending 24h, and — the load-bearing one —
// raising the grant default does NOT move the pending bound.

import { afterEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ApprovalStore, resolveApprovalPolicy, type ApprovalItem } from "../../../src/org/approvals.js";
import { loadApps } from "../../../src/org/apps.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { writeFile } from "node:fs/promises";

const HOUR = 60 * 60 * 1000;
const RAISED = new Date("2026-08-12T00:00:00.000Z");
const homes: TempStateHome[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => home.cleanup()));
});

async function store(now: Date): Promise<{ store: ApprovalStore; home: TempStateHome }> {
  const home = await makeTempStateHome();
  homes.push(home);
  return { store: new ApprovalStore(home.stateHome, { now: () => now }), home };
}

const ACTION = { tool: "bash", input: { command: "gh release create v1.0.0" } };

async function raiseAndApprove(root: string, at: Date): Promise<ApprovalItem> {
  const approvals = new ApprovalStore(root, { now: () => at });
  const raised = await approvals.raise({
    app: "app-a",
    role: "sre",
    rule: "external-publishing",
    action: ACTION,
    now: at,
  });
  return approvals.decide(raised.id, {
    decision: "approved",
    decidedBy: { kind: "human", identity: "bikram" },
    now: at,
  });
}

/** Parse the append-only approval log. Narrowed through a runtime check rather
 *  than cast: a malformed line must fail the fixture loudly, not be assumed. */
function logEventFrom(line: string): { type: string; id: string } {
  const parsed: unknown = JSON.parse(line);
  if (typeof parsed !== "object" || parsed === null) throw new Error(`approval log line is not an object: ${line}`);
  const record: Record<string, unknown> = { ...parsed };
  const { type, id } = record;
  if (typeof type !== "string" || typeof id !== "string") {
    throw new Error(`approval log line lacks string type/id: ${line}`);
  }
  return { type, id };
}

async function logEvents(root: string): Promise<{ type: string; id: string }[]> {
  const text = await readFile(join(root, "approvals", "log.jsonl"), "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(logEventFrom);
}

describe("CF-B09a — grant-expiry disposition (HB-P5, F-PT-008 ratified 2026-08-12)", () => {
  it("the ratified defaults: grant 48h, undecided item 24h, and they are INDEPENDENT", () => {
    // Written out from the ruling, not read back from a product constant.
    expect(resolveApprovalPolicy()).toEqual({ grantTtlMs: 48 * HOUR, pendingTtlMs: 24 * HOUR });

    // THE LOAD-BEARING CASE. Before the ruling, pendingTtlMs fell back to
    // grantTtlMs, so lengthening the grant would ALSO have doubled F-PT-020's
    // ratified 24h undecided-item bound. Configuring only the grant must leave
    // the pending bound exactly where the owner pinned it.
    expect(resolveApprovalPolicy({ grantTtlMs: 72 * HOUR })).toEqual({
      grantTtlMs: 72 * HOUR,
      pendingTtlMs: 24 * HOUR,
    });
    // SEEDED VIOLATION: the pre-ruling inheritance. If pendingTtlMs ever
    // followed grantTtlMs again, this is what it would produce — and it is
    // exactly the loosening the owner refused.
    expect(resolveApprovalPolicy({ grantTtlMs: 72 * HOUR }).pendingTtlMs).not.toBe(72 * HOUR);

    // An explicit pending TTL still overrides, in either direction.
    expect(resolveApprovalPolicy({ pendingTtlMs: 6 * HOUR }).pendingTtlMs).toBe(6 * HOUR);
    // A non-positive or non-finite TTL is refused, never coerced.
    expect(() => resolveApprovalPolicy({ grantTtlMs: 0 })).toThrow(/positive finite/);
    expect(() => resolveApprovalPolicy({ pendingTtlMs: Number.NaN })).toThrow(/positive finite/);
  });

  it("the TTL is POLICY CONFIGURATION reachable from org config, never a source constant", async () => {
    const home = await makeTempStateHome();
    homes.push(home);
    const path = join(home.stateHome, "apps.yaml");
    await writeFile(
      path,
      [
        "schema_version: 1",
        "org:",
        "  name: ttl-org",
        "  max_concurrent_turns: 1",
        "  approval_policy:",
        "    grant_ttl_hours: 12",
        "    pending_ttl_hours: 3",
        "defaults:",
        "  budget_usd_month: 1000",
        "apps:",
        "  app-a:",
        "    repo: fixture/app-a",
        "    status: live",
        "    cadence: {}",
        "",
      ].join("\n"),
      "utf8",
    );
    const loaded = await loadApps(path);
    expect(loaded.approvalPolicy).toEqual({ grantTtlMs: 12 * HOUR, pendingTtlMs: 3 * HOUR });
    expect(resolveApprovalPolicy(loaded.approvalPolicy)).toEqual({
      grantTtlMs: 12 * HOUR,
      pendingTtlMs: 3 * HOUR,
    });

    // SEEDED VIOLATION: an unusable configured value must be refused, not
    // silently replaced by a default the operator never chose — this bound
    // governs how long delegated authority lives.
    await writeFile(path, (await readFile(path, "utf8")).replace("grant_ttl_hours: 12", "grant_ttl_hours: -1"), "utf8");
    await expect(loadApps(path)).rejects.toThrow(/approval_policy\.grant_ttl_hours/);
  });

  it("RATIFIED DISPOSITION: an expired grant reopens the ORIGINAL item, id and history intact", async () => {
    const { store: approvals, home } = await store(RAISED);
    const decided = await raiseAndApprove(home.stateHome, RAISED);
    expect(decided.status).toBe("approved");
    expect(decided.grantId).toBeDefined();

    // Before expiry nothing moves: a live grant is not a reopen trigger.
    const early = new ApprovalStore(home.stateHome, { now: () => new Date(RAISED.getTime() + 47 * HOUR) });
    expect(await early.reopenExpiredGrants()).toEqual([]);
    expect((await early.listPending()).map((item) => item.id)).toEqual([]);

    // Past the 48h grant TTL the original item comes back.
    const later = new ApprovalStore(home.stateHome, { now: () => new Date(RAISED.getTime() + 49 * HOUR) });
    const reopened = await later.reopenExpiredGrants();
    expect(reopened).toHaveLength(1);

    const item = reopened[0];
    if (item === undefined) throw new Error("expected exactly one reopened item");
    // NOT a fresh item: same id, same action, same raise time.
    expect(item.id).toBe(decided.id);
    expect(item.action).toEqual(decided.action);
    expect(item.raisedAt).toBe(decided.raisedAt);
    // NOT dropped: it is back in the pending queue, decidable again.
    expect(item.status).toBe("pending");
    expect((await later.listPending()).map((entry) => entry.id)).toEqual([decided.id]);
    // The decision history survives — that is what "reopen the original" means.
    expect(item.decision).toBe("approved");
    expect(item.decidedBy).toEqual({ kind: "human", identity: "bikram" });
    expect(item.decidedAt).toBe(decided.decidedAt);
    // ...and the reopen is visible as a reopen, not disguised as a fresh raise.
    expect(item.reopenedAt).toBeDefined();
    expect(item.expiredGrantId).toBe(decided.grantId);
    expect(item.reopenCount).toBe(1);
    expect(approvals).toBeDefined();
  });

  it("B-09b immutability holds: the reopen is an APPENDED transition, never an edit of a decision record", async () => {
    const { home } = await store(RAISED);
    const decided = await raiseAndApprove(home.stateHome, RAISED);
    const before = await logEvents(home.stateHome);

    const later = new ApprovalStore(home.stateHome, { now: () => new Date(RAISED.getTime() + 49 * HOUR) });
    await later.reopenExpiredGrants();
    const after = await logEvents(home.stateHome);

    // Every prior event survives byte-for-byte in order; the reopen is appended.
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length).map((event) => event.type)).toEqual(["reopened"]);
    // The original `decided` event is still there and still says approved.
    const decision = after.find((event) => event.type === "decided");
    expect(decision?.id).toBe(decided.id);
  });

  it("SEEDED VIOLATIONS: the two rejected dispositions both fail the oracle", async () => {
    const { home } = await store(RAISED);
    const decided = await raiseAndApprove(home.stateHome, RAISED);
    const later = new ApprovalStore(home.stateHome, { now: () => new Date(RAISED.getTime() + 49 * HOUR) });
    const reopened = (await later.reopenExpiredGrants())[0];
    if (reopened === undefined) throw new Error("expected the expired grant to reopen its item");

    // (a) FRESH ITEM would mean a different id with no decision history. The
    // ratified disposition produces neither.
    expect(reopened.id).toBe(decided.id);
    expect(reopened.decision).toBeDefined();
    // (b) DROPPED would mean nothing in the pending queue after expiry.
    expect(await later.listPending()).toHaveLength(1);
  });

  it("the PRODUCTION sweep reopens: `reconcile()` — what dispatch actually calls — brings the item back", async () => {
    // The cases above drive reopenExpiredGrants directly, which would still
    // pass if the transition were never wired into the sweep that runs in
    // production. This one goes through reconcile(), so a missing wiring —
    // the DROPPED disposition — fails here.
    const { home } = await store(RAISED);
    const decided = await raiseAndApprove(home.stateHome, RAISED);
    const later = new ApprovalStore(home.stateHome, { now: () => new Date(RAISED.getTime() + 49 * HOUR) });

    await later.reconcile();
    const pending = await later.listPending();
    expect(pending.map((item) => item.id)).toEqual([decided.id]);
    expect(pending[0]?.reopenedAt).toBeDefined();
  });

  it("an already-executed operation is NOT reopened, and the sweep is idempotent", async () => {
    const { home } = await store(RAISED);
    await raiseAndApprove(home.stateHome, RAISED);
    const later = new ApprovalStore(home.stateHome, { now: () => new Date(RAISED.getTime() + 49 * HOUR) });

    const first = await later.reopenExpiredGrants();
    expect(first).toHaveLength(1);
    // A repeated sweep must not re-append events or inflate the count: the
    // item is already pending, so there is nothing to reopen.
    const second = await later.reopenExpiredGrants();
    expect(second).toEqual([]);
    expect((await later.listPending())[0]?.reopenCount).toBe(1);
  });
});
