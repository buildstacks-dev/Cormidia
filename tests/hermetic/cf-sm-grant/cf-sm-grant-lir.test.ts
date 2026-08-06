// CF-SM-GRANT-L/I/R — grant lifecycle on the real ApprovalStore (L2, HB-011):
// once-grants (minted → consumed) and human-widened scoped A1 grants
// (minted → n uses → expired/revoked), with every refusal leg of
// CORMIDIA-INV-003's falsifying shapes: cap+1, post-revocation, post-expiry,
// out-of-scope, changed-bytes, stale identity version, and consumed-once
// replay.
//
// Design: case-catalog §2 CF-SM-GRANT row; contracts/B-09b §1-§5;
// invariants.md CORMIDIA-INV-003 shapes (a)/(b). Time is injected through the
// store's per-call `now` parameters (fixtures/clock.ts) — decide,
// findMatchingGrantSync, consumeGrantSync, revokeGrantSync and
// claimActorRetryGrantSync all accept the instant, so TTL expiry is scripted,
// never slept for.
//
// BLOCKED:F-PT-008 (grant-expiry ITEM disposition) — expiry tests below
// assert ONLY the grant-level typed refusal. Whether expiry creates a fresh
// item, reopens the old one, or requires another explicit operation is an
// open product-truth finding (validation-policy.yaml open_findings); no
// assertion here encodes any of those outcomes.

import { afterEach, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import {
  actionHash,
  ApprovalStore,
  commandIdentityHash,
  pathBoundaryMatch,
  type ApprovalGrant,
  type ApprovalLogEvent,
} from "../../../src/org/approvals.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";

const APP = "grant-app";
const ROLE = "sre";
const DAY_MS = 24 * 60 * 60 * 1000;

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
  const state = await makeTempStateHome({ name: "cf-sm-grant" });
  const rig: Rig = {
    state,
    store: new ApprovalStore(state.stateHome),
    clock: makeTestClock("2026-07-31T12:00:00.000Z"),
  };
  rigs.push(rig);
  return rig;
}

const onceCommand = "gh auth refresh --hostname github.com";
const onceAction = { tool: "bash", input: { command: onceCommand } };

async function mintOnce(rig: Rig): Promise<{ itemId: string; grant: ApprovalGrant }> {
  // rule secrets-or-auth → executor actor-retry (not orchestrator-executable),
  // the shape claimActorRetryGrantSync governs.
  const item = await rig.store.raise({
    app: APP,
    role: ROLE,
    rule: "secrets-or-auth",
    action: onceAction,
    ticketRef: "TICKET-G",
    now: rig.clock.nowDate(),
  });
  const decided = await rig.store.decide(item.id, {
    decision: "approved",
    now: rig.clock.nowDate(),
  });
  const grant = JSON.parse(
    await readFile(rig.state.path("approvals", "grants", `${decided.grantId!}.json`), "utf8"),
  ) as ApprovalGrant;
  return { itemId: item.id, grant };
}

const scopedAction = { tool: "bash", input: { command: "npm config fix --location project .npmrc" } };

async function mintScoped(
  rig: Rig,
  options: { maxUses?: number; pathContains?: string } = {},
): Promise<{ itemId: string; grant: ApprovalGrant }> {
  const item = await rig.store.raise({
    app: APP,
    role: ROLE,
    rule: "secrets-or-auth",
    action: scopedAction,
    ticketRef: "TICKET-G",
    now: rig.clock.nowDate(),
  });
  const decided = await rig.store.decide(item.id, {
    decision: "approved",
    scope: {
      kind: "ticket",
      ...(options.pathContains !== undefined ? { pathContains: options.pathContains } : {}),
    },
    ...(options.maxUses !== undefined ? { maxUses: options.maxUses } : {}),
    now: rig.clock.nowDate(),
  });
  const grant = JSON.parse(
    await readFile(rig.state.path("approvals", "grants", `${decided.grantId!}.json`), "utf8"),
  ) as ApprovalGrant;
  return { itemId: item.id, grant };
}

function matchOnce(rig: Rig, overrides: { app?: string; role?: string; hash?: string } = {}) {
  return rig.store.findMatchingGrantSync({
    app: overrides.app ?? APP,
    role: overrides.role ?? ROLE,
    actionHash: overrides.hash ?? actionHash(onceAction),
    now: rig.clock.nowDate(),
  });
}

function matchScoped(rig: Rig, overrides: { rule?: string; ticketRef?: string; actionText?: string } = {}) {
  return rig.store.findMatchingGrantSync({
    app: APP,
    role: ROLE,
    actionHash: actionHash({ tool: "bash", input: { command: "some other in-scope command" } }),
    rule: overrides.rule ?? "secrets-or-auth",
    actionText: overrides.actionText ?? ".npmrc",
    ticketRef: overrides.ticketRef ?? "TICKET-G",
    now: rig.clock.nowDate(),
  });
}

async function grantEvents(rig: Rig): Promise<ApprovalLogEvent[]> {
  return (await rig.store.readLog()).filter(
    (event) => event.type === "grant-consumed" || event.type === "grant-revoked",
  );
}

describe("CF-SM-GRANT-L — once-grant: minted → consumed, bound to actor/app/payload/content-version (L2, HB-011)", () => {
  it("mints the ratified default shape: single-use, exact action hash, raw command literal bound, current identity version, TTL 24h [doc B-09b §5]", async () => {
    const rig = await makeRig();
    const minted = rig.clock.nowIso();
    const { itemId, grant } = await mintOnce(rig);
    expect(grant).toMatchObject({
      grantId: `grant-${itemId}`,
      approvalId: itemId,
      app: APP,
      role: ROLE,
      uses: 1,
      actionHash: actionHash(onceAction),
      commandSha256: commandIdentityHash(onceCommand),
      createdAt: minted,
    });
    expect(grant.scope).toBeUndefined();
    // Ratified default TTL: exactly 24 hours from decision time.
    expect(new Date(grant.expiresAt).getTime() - new Date(grant.createdAt).getTime()).toBe(DAY_MS);
  });

  it("matches only its exact binding: wrong app, wrong role, or changed payload bytes never match (INV-003 shape a)", async () => {
    const rig = await makeRig();
    const { grant } = await mintOnce(rig);
    expect(matchOnce(rig)?.grantId).toBe(grant.grantId);
    expect(matchOnce(rig, { app: "other-app" })).toBeUndefined();
    expect(matchOnce(rig, { role: "builder" })).toBeUndefined();
    // Changed bytes under the old approval: an env-prefix edit of the decided
    // command is a different authorization identity.
    expect(
      matchOnce(rig, {
        hash: actionHash({ tool: "bash", input: { command: `env INJECTED=pwned ${onceCommand}` } }),
      }),
    ).toBeUndefined();
  });

  it("consumes exactly once with a durable audit row, then never matches again", async () => {
    const rig = await makeRig();
    const { grant } = await mintOnce(rig);
    rig.clock.advance(60_000);
    const consumed = rig.store.consumeGrantSync(grant.grantId, rig.clock.nowDate());
    expect(consumed.uses).toBe(0);
    expect(consumed.consumedAt).toBe(rig.clock.nowIso());
    const events = await grantEvents(rig);
    expect(events).toEqual([
      { type: "grant-consumed", id: grant.approvalId, grantId: grant.grantId, at: rig.clock.nowIso() },
    ]);
    expect(matchOnce(rig)).toBeUndefined();
  });

  it("a fresh ask after consumption is a NEW approval item — never a silent reuse (INV-003 seed b: the miss path re-raises)", async () => {
    const rig = await makeRig();
    const { itemId, grant } = await mintOnce(rig);
    rig.store.consumeGrantSync(grant.grantId, rig.clock.nowDate());
    rig.clock.advance(1_000);
    const second = await rig.store.raise({
      app: APP,
      role: ROLE,
      rule: "secrets-or-auth",
      action: onceAction,
      ticketRef: "TICKET-G",
      now: rig.clock.nowDate(),
    });
    expect(second.id).not.toBe(itemId);
    expect(second.status).toBe("pending");
  });
});

describe("CF-SM-GRANT-L — scoped A1 grant: minted → n uses with per-use audit → revoked/expired (L2, HB-011)", () => {
  it("mints the human-widened shape: rule+ticket scope, use cap, NO command literal binding (it intentionally covers many commands)", async () => {
    const rig = await makeRig();
    const { itemId, grant } = await mintScoped(rig, { maxUses: 3, pathContains: ".npmrc" });
    expect(grant).toMatchObject({
      approvalId: itemId,
      uses: 3,
      scope: { kind: "ticket", rule: "secrets-or-auth", ticketRef: "TICKET-G", pathContains: ".npmrc" },
    });
    expect(grant.commandSha256).toBeUndefined();
  });

  it("each use within the bounds appends its own audit row (INV-003 shape b: per-use audit)", async () => {
    const rig = await makeRig();
    const { grant } = await mintScoped(rig, { maxUses: 3 });
    for (const minute of [1, 2]) {
      rig.clock.advance(60_000);
      expect(matchScoped(rig)?.grantId).toBe(grant.grantId);
      rig.store.consumeGrantSync(grant.grantId, rig.clock.nowDate());
      void minute;
    }
    const consumedRows = (await grantEvents(rig)).filter((event) => event.type === "grant-consumed");
    expect(consumedRows).toHaveLength(2);
    const after = JSON.parse(
      await readFile(rig.state.path("approvals", "grants", `${grant.grantId}.json`), "utf8"),
    ) as ApprovalGrant;
    expect(after.uses).toBe(1); // 3 minted - 2 used
  });

  it("binds to the human-chosen scope: wrong rule, wrong ticket, and repo-escaping path tokens never match (A1 boundary)", async () => {
    const rig = await makeRig();
    await mintScoped(rig, { pathContains: ".npmrc" });
    expect(matchScoped(rig)).toBeDefined();
    expect(matchScoped(rig, { rule: "outbound-network" })).toBeUndefined(); // a scoped grant never crosses rules
    expect(matchScoped(rig, { ticketRef: "TICKET-OTHER" })).toBeUndefined();
    // pathContains is a repo-local bound, not a substring (the 2026-07-11
    // approver-rehearsal boundary): the user-global variant never matches.
    expect(matchScoped(rig, { actionText: "~/.npmrc" })).toBeUndefined();
    expect(matchScoped(rig, { actionText: "/etc/.npmrc" })).toBeUndefined();
    expect(matchScoped(rig, { actionText: "$HOME/.npmrc" })).toBeUndefined();
    expect(matchScoped(rig, { actionText: "../outside/.npmrc" })).toBeUndefined();
    expect(matchScoped(rig, { actionText: "https://evil.example/.npmrc" })).toBeUndefined();
    expect(matchScoped(rig, { actionText: "config/.npmrc" })).toBeDefined(); // nested repo-relative is in scope
    // The same boundary, asserted at the pure function for exactness.
    expect(pathBoundaryMatch("cat ~/.npmrc", ".npmrc")).toBe(false);
    expect(pathBoundaryMatch("cat ./.npmrc", ".npmrc")).toBe(true);
  });
});

describe("CF-SM-GRANT-I — refusals: cap+1, expiry, revocation, scope-widening, stale identity (L2, HB-011)", () => {
  it("refuses cap+1: the use beyond the cap throws and the exhausted grant never matches", async () => {
    const rig = await makeRig();
    const { grant } = await mintScoped(rig, { maxUses: 2 });
    rig.store.consumeGrantSync(grant.grantId, rig.clock.nowDate());
    rig.store.consumeGrantSync(grant.grantId, rig.clock.nowDate());
    expect(matchScoped(rig)).toBeUndefined();
    expect(() => rig.store.consumeGrantSync(grant.grantId, rig.clock.nowDate())).toThrow(/no remaining uses/);
    expect((await grantEvents(rig)).filter((event) => event.type === "grant-consumed")).toHaveLength(2);
  });

  it("refuses post-expiry with a typed outcome, closed at the exact TTL boundary (B-09b §5; item disposition BLOCKED:F-PT-008)", async () => {
    const rig = await makeRig();
    const { grant } = await mintOnce(rig);
    rig.clock.advance(DAY_MS - 1);
    expect(matchOnce(rig)?.grantId).toBe(grant.grantId); // 1ms before the boundary: live
    rig.clock.advance(1);
    expect(matchOnce(rig)).toBeUndefined(); // at expiresAt exactly: expired (fail closed)
    expect(() => rig.store.consumeGrantSync(grant.grantId, rig.clock.nowDate())).toThrow(/is expired/);
    // BLOCKED:F-PT-008 — deliberately NO assertion about what expiry does to
    // the approval item (fresh item / reopen / explicit op): unratified.
  });

  it("refuses post-revocation: revocation takes effect before any later use, with the revocation and prior uses intact in audit (B-09b §3)", async () => {
    const rig = await makeRig();
    const { grant } = await mintScoped(rig, { maxUses: 3 });
    rig.store.consumeGrantSync(grant.grantId, rig.clock.nowDate());
    rig.clock.advance(60_000);
    const revoked = rig.store.revokeGrantSync(grant.grantId, rig.clock.nowDate());
    expect(revoked.revokedAt).toBe(rig.clock.nowIso());
    expect(revoked.uses).toBe(0);
    // No consumed+revoked contradiction on the live grant file; the prior use
    // survives as its append-only audit row.
    expect(revoked.consumedAt).toBeUndefined();
    const events = await grantEvents(rig);
    expect(events.map((event) => event.type)).toEqual(["grant-consumed", "grant-revoked"]);

    expect(matchScoped(rig)).toBeUndefined();
    expect(() => rig.store.consumeGrantSync(grant.grantId, rig.clock.nowDate())).toThrow(/is revoked/);
    // Revocation replay is a no-op: same terminal grant, no second audit row.
    const again = rig.store.revokeGrantSync(grant.grantId, rig.clock.nowDate());
    expect(again.revokedAt).toBe(revoked.revokedAt);
    expect((await grantEvents(rig)).filter((event) => event.type === "grant-revoked")).toHaveLength(1);
  });

  it("revoking an unused once-grant terminalizes its approved execution record (approved → failed, cause grant_revoked)", async () => {
    const rig = await makeRig();
    const { itemId, grant } = await mintOnce(rig);
    rig.store.revokeGrantSync(grant.grantId, rig.clock.nowDate());
    const { item } = await rig.store.show(itemId);
    expect(item.execution?.state).toBe("failed");
    expect(item.execution?.failureCause).toBe("grant_revoked");
    expect(item.execution?.nextAction).toBe("none");
  });

  it("refuses to retroactively revoke a consumed once-grant: the effect may have run — reconcile explicitly instead", async () => {
    const rig = await makeRig();
    const { grant } = await mintOnce(rig);
    rig.store.consumeGrantSync(grant.grantId, rig.clock.nowDate());
    expect(() => rig.store.revokeGrantSync(grant.grantId, rig.clock.nowDate())).toThrow(
      /already consumed; reconcile approval/,
    );
  });

  it("refuses scope-widening on a never-scopeable rule with a typed refusal and an unchanged store (B-09b §1, INV-003 shape a)", async () => {
    const rig = await makeRig();
    const item = await rig.store.raise({
      app: APP,
      role: ROLE,
      rule: "production-deploy",
      action: { tool: "bash", input: { command: "gh workflow run deploy.yml" } },
      now: rig.clock.nowDate(),
    });
    const logBefore = await readFile(rig.state.path("approvals", "log.jsonl"), "utf8");
    await expect(
      rig.store.decide(item.id, {
        decision: "approved",
        scope: { kind: "app" },
        now: rig.clock.nowDate(),
      }),
    ).rejects.toThrow(/never scopeable/);
    // Typed refusal, store unchanged: still pending, no grant, no new events.
    expect((await rig.store.listPending()).map((pending) => pending.id)).toEqual([item.id]);
    expect(await readFile(rig.state.path("approvals", "log.jsonl"), "utf8")).toBe(logBefore);
    const files = await assertNonEmptyWalk(rig.state.path("approvals"));
    expect(files.filter((file) => file.startsWith("grants/"))).toHaveLength(0);
  });

  it("refuses a grant minted under a superseded identity version — a format bump cancels every in-flight grant (content-version binding)", async () => {
    const rig = await makeRig();
    const { grant } = await mintOnce(rig);
    const grantPath = rig.state.path("approvals", "grants", `${grant.grantId}.json`);
    // Seed a legacy grant: same bytes, previous identity format generation.
    const legacy: ApprovalGrant = { ...grant, identityVersion: grant.identityVersion! - 1 };
    await writeFile(grantPath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
    expect(matchOnce(rig)).toBeUndefined();
  });
});

describe("CF-SM-GRANT-R — replayed consumption never re-authorizes (L2, HB-011)", () => {
  it("replaying a consumed once-grant is refused on every path: consume throws, match misses (INV-003 seed b)", async () => {
    const rig = await makeRig();
    const { grant } = await mintOnce(rig);
    rig.store.consumeGrantSync(grant.grantId, rig.clock.nowDate());
    rig.clock.advance(1_000); // the next tick
    expect(matchOnce(rig)).toBeUndefined();
    expect(() => rig.store.consumeGrantSync(grant.grantId, rig.clock.nowDate())).toThrow(/no remaining uses/);
    expect((await grantEvents(rig)).filter((event) => event.type === "grant-consumed")).toHaveLength(1);
  });

  it("a replayed actor claim is blocked without a second consumption: executing advances once, the grant decrements once", async () => {
    const rig = await makeRig();
    const { itemId, grant } = await mintOnce(rig);
    const first = rig.store.claimActorRetryGrantSync(grant.grantId, "actor/turn-1", rig.clock.nowDate());
    expect(first.status).toBe("claimed");
    expect(first.item.execution?.state).toBe("executing");
    expect(first.item.execution?.attempts).toBe(1);

    const replay = rig.store.claimActorRetryGrantSync(grant.grantId, "actor/turn-2", rig.clock.nowDate());
    expect(replay.status).toBe("blocked");
    const { item } = await rig.store.show(itemId);
    expect(item.execution?.attempts).toBe(1);
    expect(item.execution?.actor).toBe("actor/turn-1");
    const consumedRows = (await grantEvents(rig)).filter((event) => event.type === "grant-consumed");
    expect(consumedRows).toHaveLength(1);
  });
});
