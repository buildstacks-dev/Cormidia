// CF-SM-GRANT-C — crash between a grant use and its audit row (L2, HB-011).
//
// consumeGrantSync's write order is: grant file update (uses decremented,
// consumedAt stamped) THEN the append-only grant-consumed row; revokeGrantSync
// likewise writes the grant file before its grant-revoked row. A SIGKILL
// between the two leaves a use (or a revocation) with no audit row —
// CORMIDIA-INV-003's scoped-shape falsifier "a use with no per-use audit row".
// The intermediates are staged by byte-rewinding the log around a REAL store
// call (each step writes disjoint files, so the rewound tree is exactly what
// the dying process leaves; the kill cannot be injected INSIDE the product
// method without product hooks, and no such hook exists — stated honestly).
//
// The ratified obligations tested here:
//   - recognizable: the audit-conservation detector below fires on every torn
//     intermediate (and is proven to fire — negative controls);
//   - fail-safe direction: the crash can only LOSE audit, never manufacture an
//     extra use — a torn once-grant use still refuses replay (never
//     re-performed, INV-003), and a torn revocation still refuses every use.
//
// NOT asserted (candidate finding material, reported with HB-011, not
// encoded): whether reconcile() must REPAIR a torn use-audit row. B-09a §3's
// "reconciliation completes or repairs the decision state" names decision
// state; neither contract says who rebuilds lost grant-use audit rows.
// reconcile() today does not. The detector deposited here recognizes the
// drift; the repair obligation is for the owner to rule on.

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  actionHash,
  ApprovalStore,
  type ApprovalGrant,
  type ApprovalLogEvent,
} from "../../../src/org/approvals.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";

// Full-lane flake guard (see cf-sm-appr-lir.test.ts): finishExecution/
// dispositionExecution take real per-item execution file locks that can wait
// up to ~35s under worker contention; widen the budget in TEST setup, never
// in src.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const APP = "grant-crash-app";
const ROLE = "sre";

// ---------------------------------------------------------------------------
// The family detector: grant-use audit conservation
// ---------------------------------------------------------------------------

class GrantAuditDriftViolation extends Error {
  constructor(readonly grantId: string, readonly detail: string) {
    super(`CF-SM-GRANT-C: grant ${grantId} audit drift: ${detail}`);
    this.name = "GrantAuditDriftViolation";
  }
}

/** Fires when a grant file and the append-only log disagree about uses:
 *  - unrevoked grants must conserve `mintedUses - currentUses + reArms ===
 *    consumedRows` (a torn consume leaves a decremented use with no row);
 *  - revoked grants must carry their grant-revoked row.
 *  Minted uses come from the grant embedded in the `decided` log event; grants
 *  with no durable decision are CF-SM-APPR-C's orphan case, not this
 *  detector's. Re-arms (dispositionExecution retry restoring one use) are
 *  counted from execution-transition rows back to `approved`. */
function detectGrantAuditDrift(root: string): void {
  const logPath = join(root, "approvals", "log.jsonl");
  const events = (existsSync(logPath) ? readFileSync(logPath, "utf8") : "")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ApprovalLogEvent);
  const mintedUses = new Map<string, number>();
  for (const event of events) {
    if (event.type === "decided" && event.grant !== undefined) {
      mintedUses.set(event.grant.grantId, event.grant.uses);
    }
  }
  const grantsDir = join(root, "approvals", "grants");
  for (const file of existsSync(grantsDir) ? readdirSync(grantsDir) : []) {
    if (!file.endsWith(".json")) continue;
    const grant = JSON.parse(readFileSync(join(grantsDir, file), "utf8")) as ApprovalGrant;
    const minted = mintedUses.get(grant.grantId);
    if (minted === undefined) continue; // orphan — CF-SM-APPR-C's detector
    const consumedRows = events.filter(
      (event) => event.type === "grant-consumed" && event.grantId === grant.grantId,
    ).length;
    if (grant.revokedAt !== undefined) {
      const revokedRows = events.filter(
        (event) => event.type === "grant-revoked" && event.grantId === grant.grantId,
      ).length;
      if (revokedRows === 0) {
        throw new GrantAuditDriftViolation(grant.grantId, "revoked with no grant-revoked audit row");
      }
      continue; // revocation zeroes uses; use-conservation no longer applies
    }
    const reArms = events.filter(
      (event) =>
        event.type === "execution-transition" &&
        event.id === grant.approvalId &&
        event.to === "approved",
    ).length;
    const expectedRows = minted - grant.uses + reArms;
    if (expectedRows !== consumedRows) {
      throw new GrantAuditDriftViolation(
        grant.grantId,
        `${expectedRows} use(s) taken but ${consumedRows} grant-consumed row(s) on the log`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Rig + torn-write staging
// ---------------------------------------------------------------------------

interface Rig {
  state: TempStateHome;
  store: ApprovalStore;
  clock: TestClock;
}

let rigs: Rig[] = [];

afterEach(async () => {
  for (const rig of rigs) await rig.state.cleanup();
  rigs = [];
});

async function makeRig(): Promise<Rig> {
  const state = await makeTempStateHome({ name: "cf-sm-grant-c" });
  const rig: Rig = {
    state,
    store: new ApprovalStore(state.stateHome),
    clock: makeTestClock("2026-07-31T12:00:00.000Z"),
  };
  rigs.push(rig);
  return rig;
}

const onceAction = { tool: "bash", input: { command: "gh auth refresh --hostname github.com" } };

async function mint(
  rig: Rig,
  options: { scoped?: { maxUses: number } } = {},
): Promise<{ itemId: string; grantId: string }> {
  const item = await rig.store.raise({
    app: APP,
    role: ROLE,
    rule: "secrets-or-auth",
    action: onceAction,
    ticketRef: "TICKET-GC",
    now: rig.clock.nowDate(),
  });
  const decided = await rig.store.decide(item.id, {
    decision: "approved",
    ...(options.scoped !== undefined
      ? { scope: { kind: "ticket" as const }, maxUses: options.scoped.maxUses }
      : {}),
    now: rig.clock.nowDate(),
  });
  return { itemId: item.id, grantId: decided.grantId! };
}

/** Run one real store call and drop the log lines it appended: the exact tree
 *  a SIGKILL leaves between the grant-file write and the audit append. */
async function withTornAudit(rig: Rig, act: () => void): Promise<void> {
  const logPath = rig.state.path("approvals", "log.jsonl");
  const before = await readFile(logPath, "utf8");
  act();
  await writeFile(logPath, before, "utf8");
}

function readGrant(rig: Rig, grantId: string): ApprovalGrant {
  return JSON.parse(
    readFileSync(rig.state.path("approvals", "grants", `${grantId}.json`), "utf8"),
  ) as ApprovalGrant;
}

describe("CF-SM-GRANT-C — crash between use and audit row (L2, HB-011)", () => {
  it("green control: the audit-conservation detector stays quiet across clean consumes, revocations, and a retry re-arm", async () => {
    const rig = await makeRig();
    // once-grant consumed cleanly
    const once = await mint(rig);
    rig.store.consumeGrantSync(once.grantId, rig.clock.nowDate());
    // scoped grant: two uses then revocation
    const scoped = await mint(rig, { scoped: { maxUses: 3 } });
    rig.store.consumeGrantSync(scoped.grantId, rig.clock.nowDate());
    rig.store.consumeGrantSync(scoped.grantId, rig.clock.nowDate());
    rig.store.revokeGrantSync(scoped.grantId, rig.clock.nowDate());
    // a claimed-then-failed once-grant that a human re-arms (uses restored)
    const rearmed = await mint(rig);
    rig.store.claimActorRetryGrantSync(rearmed.grantId, "actor/t1", rig.clock.nowDate());
    await rig.store.finishExecution({
      id: rearmed.itemId,
      state: "failed",
      actor: "actor/t1",
      result: "provider reported failure",
      now: rig.clock.nowDate(),
    });
    await rig.store.dispositionExecution({
      id: rearmed.itemId,
      disposition: "retry",
      reason: "transient failure; retry the exact approved action",
      actor: "human/operator",
      now: rig.clock.nowDate(),
    });
    await assertNonEmptyWalk(rig.state.path("approvals", "grants"), /\.json$/);
    detectGrantAuditDrift(rig.state.stateHome); // conservation holds
  });

  it("negative control: a seeded torn consume (use taken, audit row lost) makes the detector FIRE", async () => {
    const rig = await makeRig();
    const { grantId } = await mint(rig);
    await withTornAudit(rig, () => {
      rig.store.consumeGrantSync(grantId, rig.clock.nowDate());
    });
    expect(readGrant(rig, grantId).uses).toBe(0); // the use the crash kept
    expect(() => detectGrantAuditDrift(rig.state.stateHome)).toThrow(GrantAuditDriftViolation);
    expect(() => detectGrantAuditDrift(rig.state.stateHome)).toThrow(/1 use\(s\) taken but 0/);
  });

  it("a torn once-grant use can only LOSE audit, never re-authorize: replay refused on every path (INV-003: ack-crash never re-performs)", async () => {
    const rig = await makeRig();
    const { grantId } = await mint(rig);
    await withTornAudit(rig, () => {
      rig.store.consumeGrantSync(grantId, rig.clock.nowDate());
    });
    // The grant-file write precedes the audit append, so the surviving state
    // is fail-safe: zero remaining uses however the log looks.
    expect(
      rig.store.findMatchingGrantSync({
        app: APP,
        role: ROLE,
        actionHash: actionHash(onceAction),
        now: rig.clock.nowDate(),
      }),
    ).toBeUndefined();
    expect(() => rig.store.consumeGrantSync(grantId, rig.clock.nowDate())).toThrow(/no remaining uses/);
  });

  it("a torn scoped use keeps the drift recognizable across later clean uses (the lost row never silently heals)", async () => {
    const rig = await makeRig();
    const { grantId } = await mint(rig, { scoped: { maxUses: 3 } });
    rig.store.consumeGrantSync(grantId, rig.clock.nowDate()); // clean use, row kept
    await withTornAudit(rig, () => {
      rig.store.consumeGrantSync(grantId, rig.clock.nowDate()); // torn use, row lost
    });
    rig.store.consumeGrantSync(grantId, rig.clock.nowDate()); // later clean use
    expect(readGrant(rig, grantId).uses).toBe(0);
    expect(() => detectGrantAuditDrift(rig.state.stateHome)).toThrow(/3 use\(s\) taken but 2/);
    // reconcile() does not (and per the open question above, may not be meant
    // to) rebuild the lost row — the drift must still be recognizable after.
    await rig.store.reconcile(rig.clock.nowDate());
    expect(() => detectGrantAuditDrift(rig.state.stateHome)).toThrow(GrantAuditDriftViolation);
  });

  it("a torn revocation (revokedAt durable, audit row lost) still refuses every use, and the detector FIRES on the missing row", async () => {
    const rig = await makeRig();
    const { itemId, grantId } = await mint(rig, { scoped: { maxUses: 3 } });
    // revokeGrantSync writes the grant file first; rewind its log appends AND
    // its decided-item terminalization side effect to isolate the earliest
    // crash point (grant file durable, everything after lost).
    const decidedPath = rig.state.path("approvals", "decided", `${itemId}.json`);
    const decidedBefore = await readFile(decidedPath, "utf8");
    await withTornAudit(rig, () => {
      rig.store.revokeGrantSync(grantId, rig.clock.nowDate());
    });
    await writeFile(decidedPath, decidedBefore, "utf8");

    const grant = readGrant(rig, grantId);
    expect(grant.revokedAt).toBeDefined();
    expect(grant.uses).toBe(0);
    // Fail-safe direction: the revocation is effective everywhere even though
    // its audit row died with the process.
    expect(
      rig.store.findMatchingGrantSync({
        app: APP,
        role: ROLE,
        actionHash: actionHash(onceAction),
        rule: "secrets-or-auth",
        actionText: "anything",
        ticketRef: "TICKET-GC",
        now: rig.clock.nowDate(),
      }),
    ).toBeUndefined();
    expect(() => rig.store.consumeGrantSync(grantId, rig.clock.nowDate())).toThrow(/is revoked/);
    expect(() => detectGrantAuditDrift(rig.state.stateHome)).toThrow(/no grant-revoked audit row/);
  });

  it("a torn grant-FILE write (killed mid-write, no rename discipline on the consume path) never yields a usable grant", async () => {
    const rig = await makeRig();
    const { grantId } = await mint(rig);
    const grantPath = rig.state.path("approvals", "grants", `${grantId}.json`);
    const bytes = await readFile(grantPath, "utf8");
    // consumeGrantSync writes the grant file with a plain (non-atomic)
    // write, so a mid-write kill can leave a prefix. Stage that prefix.
    await writeFile(grantPath, bytes.slice(0, Math.floor(bytes.length / 2)), "utf8");
    // Outcome-shaped assertion: however the reader reacts (today it throws a
    // parse error out of findMatchingGrantSync — fail closed, and honestly
    // noted: the throw blocks matching for the whole store, not just this
    // grant), a torn grant must never come back as usable authorization.
    let matched: ApprovalGrant | undefined;
    try {
      matched = rig.store.findMatchingGrantSync({
        app: APP,
        role: ROLE,
        actionHash: actionHash(onceAction),
        now: rig.clock.nowDate(),
      });
    } catch {
      // fail-closed refusal by throw
    }
    expect(matched).toBeUndefined();
    let consumed: ApprovalGrant | undefined;
    try {
      consumed = rig.store.consumeGrantSync(grantId, rig.clock.nowDate());
    } catch {
      // fail-closed refusal by throw
    }
    expect(consumed).toBeUndefined();
  });
});
