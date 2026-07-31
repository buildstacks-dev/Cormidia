// CF-SM-APPR-C — crash sweep over the decision write order (L2, HB-011).
//
// B-09a §3 documents the write order — grant file, then decision log line,
// then atomic item move (then grant-minted line) — and ratifies what the
// physical intermediates must satisfy: each is RECOGNIZABLE, an orphan grant
// is NEVER usable authorization, and reconciliation completes or repairs the
// decision state (INV-013). This sweep stages every intermediate by rewinding
// a real decide()'s disjoint file writes (the same reconstruction technique
// the ratified inv-006 crash test uses — each step writes disjoint paths, so
// the rewound tree is byte-faithful to the kill), plus one REAL subprocess
// kill between store transactions via fixtures/kill-point.ts.
//
// KNOWN DEFECTS (probed 2026-07-31, tripwires below, reported with HB-011):
//   D1 — the ORPHAN-GRANT intermediate IS usable authorization today:
//        findMatchingGrantSync never checks that a grant's approvalId has a
//        durable decision, and composeGate consumes+allows a scoped orphan.
//   D3 — the PENDING-GHOST intermediate (rename done, rm lost) is never
//        repaired by reconcile(); the already-decided item is re-offered and a
//        second decision succeeds, flipping the durable record while the first
//        decision's grant survives.
// The recognizability detectors for both intermediates are deposited here and
// proven to fire (negative controls); the never-usable / repaired clauses are
// it.fails tripwires that flip red when the product conforms.

import { afterEach, describe, expect, it } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  actionHash,
  ApprovalStore,
  type ApprovalGrant,
  type ApprovalItem,
  type ApprovalLogEvent,
} from "../../../src/org/approvals.js";
import { composeGate } from "../../../src/org/gate-compose.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";
import { runKillPointScenario, type KillPointResult } from "../../fixtures/kill-point.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";
import { detectIllegalExecutionTransitions } from "../../unit/cf-sm-appr/transition-relation.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const productModuleUrl = (rel: string): string => pathToFileURL(join(repoRoot, rel)).href;

const APP = "appr-crash-app";
const ROLE = "sre";

// ---------------------------------------------------------------------------
// Recognizability detectors (family detectors — negative controls below)
// ---------------------------------------------------------------------------

class OrphanGrantViolation extends Error {
  constructor(readonly grantIds: readonly string[]) {
    super(`CF-SM-APPR-C: orphan grant(s) without any durable decision: ${grantIds.join(", ")}`);
    this.name = "OrphanGrantViolation";
  }
}

/** Fires when a grant file exists whose approval has NO durable decision
 *  anywhere — no decided/<id>.json AND no `decided` log event. (A grant whose
 *  decision log line survived is not an orphan: reconcile() completes it.) */
function detectOrphanGrants(root: string): void {
  const grantsDir = join(root, "approvals", "grants");
  const logPath = join(root, "approvals", "log.jsonl");
  const decidedIds = new Set(
    (existsSync(logPath) ? readFileSync(logPath, "utf8") : "")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ApprovalLogEvent)
      .filter((event) => event.type === "decided")
      .map((event) => event.id),
  );
  const orphans: string[] = [];
  for (const file of existsSync(grantsDir) ? readdirSync(grantsDir) : []) {
    if (!file.endsWith(".json")) continue;
    const grant = JSON.parse(readFileSync(join(grantsDir, file), "utf8")) as ApprovalGrant;
    const hasDecidedFile = existsSync(join(root, "approvals", "decided", `${grant.approvalId}.json`));
    if (!hasDecidedFile && !decidedIds.has(grant.approvalId)) orphans.push(grant.grantId);
  }
  if (orphans.length > 0) throw new OrphanGrantViolation(orphans);
}

class PendingGhostViolation extends Error {
  constructor(readonly ids: readonly string[]) {
    super(`CF-SM-APPR-C: item(s) present in BOTH pending/ and decided/: ${ids.join(", ")}`);
    this.name = "PendingGhostViolation";
  }
}

/** Fires when an id exists in both pending/ and decided/ — the physical state
 *  a crash between moveToDecided's rename and its rm(pending) leaves. */
function detectPendingGhosts(root: string): void {
  const list = (dir: string): Set<string> =>
    new Set(
      (existsSync(dir) ? readdirSync(dir) : [])
        .filter((file) => file.endsWith(".json"))
        .map((file) => file.slice(0, -".json".length)),
    );
  const pending = list(join(root, "approvals", "pending"));
  const decided = list(join(root, "approvals", "decided"));
  const ghosts = [...pending].filter((id) => decided.has(id)).sort();
  if (ghosts.length > 0) throw new PendingGhostViolation(ghosts);
}

// ---------------------------------------------------------------------------
// Rig + intermediate staging
// ---------------------------------------------------------------------------

interface Rig {
  state: TempStateHome;
  store: ApprovalStore;
  clock: TestClock;
}

let rigs: Rig[] = [];
let killResults: KillPointResult[] = [];

afterEach(async () => {
  for (const rig of rigs) await rig.state.cleanup();
  rigs = [];
  for (const result of killResults) await result.cleanup();
  killResults = [];
});

async function makeRig(): Promise<Rig> {
  const state = await makeTempStateHome({ name: "cf-sm-appr-c" });
  const rig: Rig = {
    state,
    store: new ApprovalStore(state.stateHome),
    clock: makeTestClock("2026-07-31T12:00:00.000Z"),
  };
  rigs.push(rig);
  return rig;
}

const onceAction = { tool: "bash", input: { command: "npm publish" } };
const scopedAction = { tool: "bash", input: { command: "curl https://api.example.com/hook" } };

interface Snapshot {
  log: string;
  pending: string;
}

async function raiseAndSnapshot(
  rig: Rig,
  action: { tool: string; input: unknown },
  rule: string,
): Promise<{ item: ApprovalItem; snap: Snapshot }> {
  const item = await rig.store.raise({
    app: APP,
    role: ROLE,
    rule,
    action,
    ticketRef: "TICKET-C",
    now: rig.clock.nowDate(),
  });
  return {
    item,
    snap: {
      log: await readFile(rig.state.path("approvals", "log.jsonl"), "utf8"),
      pending: await readFile(rig.state.path("approvals", "pending", `${item.id}.json`), "utf8"),
    },
  };
}

/** Rewind a completed decide() to the crash point AFTER the (atomic) grant
 *  write and BEFORE the decision log append: grant bytes are exactly what the
 *  dying decide wrote; log and pending are byte-restored to their pre-decide
 *  content; the decided file (written later in the order) is removed. */
async function stageOrphanGrant(
  rig: Rig,
  action: { tool: string; input: unknown },
  rule: string,
  decideInput: { scope?: { kind: "ticket" | "app"; pathContains?: string }; maxUses?: number },
): Promise<{ item: ApprovalItem; grantId: string }> {
  const { item, snap } = await raiseAndSnapshot(rig, action, rule);
  const decided = await rig.store.decide(item.id, {
    decision: "approved",
    ...decideInput,
    now: rig.clock.nowDate(),
  });
  await writeFile(rig.state.path("approvals", "log.jsonl"), snap.log, "utf8");
  await rm(rig.state.path("approvals", "decided", `${item.id}.json`));
  await writeFile(rig.state.path("approvals", "pending", `${item.id}.json`), snap.pending, "utf8");
  return { item, grantId: decided.grantId! };
}

async function readLogEvents(rig: Rig): Promise<ApprovalLogEvent[]> {
  return rig.store.readLog();
}

// ---------------------------------------------------------------------------
// W1 — the ORPHAN-GRANT intermediate (grant written; log append + move lost)
// ---------------------------------------------------------------------------

describe("CF-SM-APPR-C — orphan-grant intermediate (B-09a §3, L2, HB-011)", () => {
  it("is recognizable: the orphan-grant detector names the grant with no durable decision", async () => {
    const rig = await makeRig();
    const { grantId } = await stageOrphanGrant(rig, onceAction, "external-publishing", {});
    await assertNonEmptyWalk(rig.state.path("approvals", "grants"), /\.json$/);
    expect(() => detectOrphanGrants(rig.state.stateHome)).toThrow(OrphanGrantViolation);
    expect(() => detectOrphanGrants(rig.state.stateHome)).toThrow(grantId);
  });

  it("negative control: the detector stays quiet on a cleanly decided store and FIRES only on the seeded orphan", async () => {
    const rig = await makeRig();
    const { item } = await raiseAndSnapshot(rig, onceAction, "external-publishing");
    await rig.store.decide(item.id, { decision: "approved", now: rig.clock.nowDate() });
    detectOrphanGrants(rig.state.stateHome); // clean store: quiet
    // Seed: plant a grant file pointing at an approval that was never decided.
    const seeded: ApprovalGrant = {
      grantId: "grant-seeded-orphan",
      approvalId: "20260731T120000Z-none",
      app: APP,
      role: ROLE,
      actionHash: actionHash(onceAction),
      identityVersion: 3,
      expiresAt: "2026-08-01T12:00:00.000Z",
      uses: 1,
      createdAt: "2026-07-31T12:00:00.000Z",
    };
    await writeFile(
      rig.state.path("approvals", "grants", "grant-seeded-orphan.json"),
      `${JSON.stringify(seeded, null, 2)}\n`,
      "utf8",
    );
    expect(() => detectOrphanGrants(rig.state.stateHome)).toThrow(/grant-seeded-orphan/);
  });

  // DEFECT TRIPWIRE D1a (B-09a §3 "no reader treats the orphan grant as
  // usable authorization"): findMatchingGrantSync matches on identity fields
  // alone (src/org/approvals.ts findMatchingGrantSync) and returns the orphan.
  it.fails("never matches as usable authorization: findMatchingGrantSync refuses a grant with no durable decision", async () => {
    const rig = await makeRig();
    await stageOrphanGrant(rig, onceAction, "external-publishing", {});
    const match = rig.store.findMatchingGrantSync({
      app: APP,
      role: ROLE,
      actionHash: actionHash(onceAction),
      now: rig.clock.nowDate(),
    });
    expect(match).toBeUndefined();
  });

  // DEFECT TRIPWIRE D1b (same clause, scoped shape, full gate composition):
  // composeGate consumes the scoped orphan and returns { allow: true } — a
  // critical action would execute with NO persisted decision anywhere
  // (OPERON-INV-003 falsifying shape: "an executed critical op with no prior
  // persisted decision").
  it.fails("never authorizes through the composed gate: a scoped orphan grant does not allow the action", async () => {
    const rig = await makeRig();
    await stageOrphanGrant(rig, scopedAction, "outbound-network", {
      scope: { kind: "ticket" },
      maxUses: 5,
    });
    const gate = composeGate(
      () => ({ allow: false, reason: "base gate escalates", escalate: true }),
      rig.store,
      { app: APP, role: ROLE, ticketRef: "TICKET-C", now: () => rig.clock.nowDate() },
    );
    const decision = gate(scopedAction);
    expect(decision.allow).toBe(false);
  });

  it("the once-grant claim path never claims an orphan: no executing record is created and the grant is not consumed", async () => {
    const rig = await makeRig();
    const { item, grantId } = await stageOrphanGrant(rig, onceAction, "external-publishing", {});
    const grantBytes = await readFile(rig.state.path("approvals", "grants", `${grantId}.json`), "utf8");
    // Outcome-shaped assertion (not pinned to today's raw-ENOENT throw): the
    // claim must not succeed however the refusal is expressed.
    let claimed = false;
    try {
      const claim = rig.store.claimActorRetryGrantSync(grantId, "actor/orphan", rig.clock.nowDate());
      claimed = claim.status === "claimed";
    } catch {
      // refusal by throw — acceptable fail-closed direction
    }
    expect(claimed).toBe(false);
    expect(await readFile(rig.state.path("approvals", "grants", `${grantId}.json`), "utf8")).toBe(grantBytes);
    expect(existsSync(rig.state.path("approvals", "decided", `${item.id}.json`))).toBe(false);
  });

  it("reconcile never fabricates a decision from an orphan grant: the item stays pending and no decided event is invented", async () => {
    const rig = await makeRig();
    const { item } = await stageOrphanGrant(rig, onceAction, "external-publishing", {});
    await rig.store.reconcile(rig.clock.nowDate());
    // The decision never became durable, so the ONLY correct repair is to
    // leave the ask open — the human decides again; nothing invents a
    // decision on their behalf (B-09b: never forge human decisions).
    expect(existsSync(rig.state.path("approvals", "pending", `${item.id}.json`))).toBe(true);
    expect(existsSync(rig.state.path("approvals", "decided", `${item.id}.json`))).toBe(false);
    const events = await readLogEvents(rig);
    expect(events.filter((event) => event.type === "decided")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// W2-W5 — the remaining write-order intermediates: reconcile repairs
// ---------------------------------------------------------------------------

describe("CF-SM-APPR-C — post-decision-log intermediates repair to the clean state (L2, HB-011)", () => {
  it("W2 decision log durable, item move lost: reconcile completes the move; the decision is never re-asked (B-09a §3)", async () => {
    const rig = await makeRig();
    const { item, snap } = await raiseAndSnapshot(rig, onceAction, "external-publishing");
    const clean = await rig.store.decide(item.id, { decision: "approved", now: rig.clock.nowDate() });
    // Rewind to: grant written + decided log line appended, move + grant-minted lost.
    const fullLog = await readFile(rig.state.path("approvals", "log.jsonl"), "utf8");
    const lines = fullLog.split("\n").filter((line) => line.trim().length > 0);
    const decidedLine = lines.find((line) => (JSON.parse(line) as ApprovalLogEvent).type === "decided")!;
    await writeFile(rig.state.path("approvals", "log.jsonl"), `${snap.log}${decidedLine}\n`, "utf8");
    await rm(rig.state.path("approvals", "decided", `${item.id}.json`));
    await writeFile(rig.state.path("approvals", "pending", `${item.id}.json`), snap.pending, "utf8");

    await rig.store.reconcile(rig.clock.nowDate());
    // Repaired to exactly the clean decide's durable item…
    const repaired = JSON.parse(
      await readFile(rig.state.path("approvals", "decided", `${item.id}.json`), "utf8"),
    ) as ApprovalItem;
    expect(repaired).toEqual(clean);
    // …the ask is closed (never re-asked), the grant matches, and the log
    // regains its grant-minted line exactly once.
    expect(await rig.store.listPending()).toHaveLength(0);
    expect(
      rig.store.findMatchingGrantSync({
        app: APP,
        role: ROLE,
        actionHash: actionHash(onceAction),
        now: rig.clock.nowDate(),
      })?.grantId,
    ).toBe(clean.grantId);
    const minted = (await readLogEvents(rig)).filter((event) => event.type === "grant-minted");
    expect(minted).toHaveLength(1);
    detectOrphanGrants(rig.state.stateHome); // not an orphan: the decision is durable
  });

  it("W4 grant-minted line lost after the move: reconcile appends it exactly once, idempotently", async () => {
    const rig = await makeRig();
    const { item } = await raiseAndSnapshot(rig, onceAction, "external-publishing");
    await rig.store.decide(item.id, { decision: "approved", now: rig.clock.nowDate() });
    const logPath = rig.state.path("approvals", "log.jsonl");
    const lines = (await readFile(logPath, "utf8")).split("\n").filter((line) => line.trim().length > 0);
    expect((JSON.parse(lines.at(-1)!) as ApprovalLogEvent).type).toBe("grant-minted");
    await writeFile(logPath, `${lines.slice(0, -1).join("\n")}\n`, "utf8"); // the append the crash lost
    await rig.store.reconcile(rig.clock.nowDate());
    await rig.store.reconcile(rig.clock.nowDate());
    const minted = (await readLogEvents(rig)).filter((event) => event.type === "grant-minted");
    expect(minted).toHaveLength(1);
  });

  it("W5 grant file lost after the decision: reconcile rebuilds it byte-equivalently from the embedded log grant", async () => {
    const rig = await makeRig();
    const { item } = await raiseAndSnapshot(rig, onceAction, "external-publishing");
    const clean = await rig.store.decide(item.id, { decision: "approved", now: rig.clock.nowDate() });
    const grantPath = rig.state.path("approvals", "grants", `${clean.grantId!}.json`);
    const cleanGrant = JSON.parse(await readFile(grantPath, "utf8")) as ApprovalGrant;
    await rm(grantPath);
    await rig.store.reconcile(rig.clock.nowDate());
    expect(JSON.parse(await readFile(grantPath, "utf8"))).toEqual(cleanGrant);
    expect(
      rig.store.findMatchingGrantSync({
        app: APP,
        role: ROLE,
        actionHash: actionHash(onceAction),
        now: rig.clock.nowDate(),
      })?.grantId,
    ).toBe(clean.grantId);
  });
});

// ---------------------------------------------------------------------------
// W3 — the PENDING-GHOST intermediate (rename durable, rm(pending) lost)
// ---------------------------------------------------------------------------

describe("CF-SM-APPR-C — pending-ghost intermediate (B-09a §3 / B-09b §3-§4, L2, HB-011)", () => {
  async function stageGhost(rig: Rig): Promise<{ item: ApprovalItem }> {
    const { item, snap } = await raiseAndSnapshot(rig, onceAction, "external-publishing");
    await rig.store.decide(item.id, { decision: "approved", now: rig.clock.nowDate() });
    // moveToDecided = write tmp → rename → rm(pending); the crash loses the rm.
    await writeFile(rig.state.path("approvals", "pending", `${item.id}.json`), snap.pending, "utf8");
    return { item };
  }

  it("is recognizable: the ghost detector names the id present in both pending/ and decided/", async () => {
    const rig = await makeRig();
    const { item } = await stageGhost(rig);
    expect(() => detectPendingGhosts(rig.state.stateHome)).toThrow(PendingGhostViolation);
    expect(() => detectPendingGhosts(rig.state.stateHome)).toThrow(item.id);
  });

  it("negative control: the ghost detector stays quiet on a clean store and FIRES on the seeded ghost", async () => {
    const rig = await makeRig();
    const { item } = await raiseAndSnapshot(rig, onceAction, "external-publishing");
    await rig.store.decide(item.id, { decision: "approved", now: rig.clock.nowDate() });
    detectPendingGhosts(rig.state.stateHome); // quiet
    await writeFile(
      rig.state.path("approvals", "pending", `${item.id}.json`),
      await readFile(rig.state.path("approvals", "decided", `${item.id}.json`), "utf8"),
      "utf8",
    );
    expect(() => detectPendingGhosts(rig.state.stateHome)).toThrow(item.id);
  });

  // DEFECT TRIPWIRE D3a (B-09a §3 "reconciliation completes or repairs the
  // decision state"): reconcile() only handles the missing-decided direction
  // and leaves the ghost, so listPending re-offers an already-decided item.
  it.fails("reconcile repairs the ghost: the decided item is not re-offered as pending (B-09a §3)", async () => {
    const rig = await makeRig();
    await stageGhost(rig);
    await rig.store.reconcile(rig.clock.nowDate());
    expect(await rig.store.listPending()).toHaveLength(0);
    detectPendingGhosts(rig.state.stateHome);
  });

  // DEFECT TRIPWIRE D3b (B-09b §3 "first durable write wins; the second
  // receives a typed already-decided outcome" / §4 immutability): today the
  // second decision SUCCEEDS from the ghost, flips the durable record
  // approved→denied, and the first decision's grant file remains live.
  it.fails("a second decision from the ghost is refused with the first durable decision preserved (B-09b §3/§4)", async () => {
    const rig = await makeRig();
    const { item } = await stageGhost(rig);
    await expect(
      rig.store.decide(item.id, {
        decision: "denied",
        reason: "changed my mind",
        now: rig.clock.nowDate(),
      }),
    ).rejects.toThrow(/already decided|not pending/i);
  });
});

// ---------------------------------------------------------------------------
// Kill-point leg — REAL subprocess killed between store transactions
// ---------------------------------------------------------------------------

describe("CF-SM-APPR-C — real subprocess killed mid-execution (kill-point, L2, HB-011)", () => {
  it("SIGKILL after beginExecution leaves durable 'executing' evidence; recovery never re-performs, only a human disposition terminalizes (INV-003 seed c)", async () => {
    const scenario = `
import { ApprovalStore } from ${JSON.stringify(productModuleUrl("src/org/approvals.ts"))};
const store = new ApprovalStore(process.env.KP_SCRATCH);
const now = new Date("2026-07-31T12:00:00.000Z");
const item = await store.raise({
  app: ${JSON.stringify(APP)},
  role: ${JSON.stringify(ROLE)},
  rule: "external-publishing",
  action: { tool: "bash", input: { command: "npm publish" } },
  ticketRef: "TICKET-C",
  now,
});
await kp("raised");
await store.decide(item.id, { decision: "approved", now: new Date(now.getTime() + 1000) });
await kp("decided");
await store.beginExecution(item.id, "dispatch/kp", new Date(now.getTime() + 2000));
await kp("executing");
await store.finishExecution({
  id: item.id,
  state: "executed",
  actor: "dispatch/kp",
  result: "acknowledged",
  now: new Date(now.getTime() + 3000),
});
await kp("finished");
`;
    const result = await runKillPointScenario({ source: scenario, killAt: "executing" });
    killResults.push(result);
    expect(result.killedAt).toBe("executing");
    expect(result.markers).toEqual(["raised", "decided", "executing"]);
    expect(result.timedOut).toBe(false);

    // Recover over the surviving bytes with a fresh store (a new process).
    const store = new ApprovalStore(result.stateDir);
    const clock = makeTestClock("2026-07-31T12:10:00.000Z");
    const decided = await store.listDecided();
    expect(decided).toHaveLength(1);
    const item = decided[0]!;
    // Durable evidence that execution started exists at the moment of death
    // (INV-003: executing|executed|failed|ambiguous — never silence).
    expect(item.execution?.state).toBe("executing");
    expect(item.execution?.attempts).toBe(1);
    expect(item.execution?.attemptedAt).toBeDefined();

    // No automated path re-performs: a duplicate claim refuses, and reconcile
    // leaves the in-flight record for a human, never resolves it itself.
    expect(await store.beginExecution(item.id, "dispatch/recovery", clock.nowDate())).toBeUndefined();
    await store.reconcile(clock.nowDate());
    const afterReconcile = await store.listDecided();
    expect(afterReconcile[0]?.execution?.state).toBe("executing");

    // The explicit human disposition is the only exit; the unconsumed grant is
    // closed with it (no live grant survives a terminal disposition).
    const terminal = await store.dispositionExecution({
      id: item.id,
      disposition: "executed",
      reason: "verified on the registry: the publish landed",
      actor: "human/operator",
      now: clock.nowDate(),
    });
    expect(terminal.execution?.state).toBe("executed");
    const grant = JSON.parse(
      await readFile(join(result.stateDir, "approvals", "grants", `${item.grantId!}.json`), "utf8"),
    ) as ApprovalGrant;
    expect(grant.uses).toBe(0);
    expect(grant.revokedAt).toBeDefined();

    // The whole surviving log is a legal chain.
    detectIllegalExecutionTransitions(await store.readLog());
    await assertNonEmptyWalk(join(result.stateDir, "approvals"), /\.json/);
  });
});
