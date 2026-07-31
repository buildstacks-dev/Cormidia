// CF-J17-RC — typed idempotency-marker reconciliation of a crashed release
// attempt (contracts/B-17-typed-executor.md §4 "markers typed by what they
// prove"; contracts/journey-acceptance.md J-17 "exactly once only where
// completion evidence proves the effect"; OPERON-INV-003; T-12; risk E-1).
//
// The durable ReleaseExecutionRecord IS this executor's idempotency marker:
//   - `completed`/`failed` records are COMPLETION-typed evidence — they
//     convert a crashed `executing` claim to the terminal state they prove;
//   - a `running` record is ACCEPTANCE-typed evidence (the attempt was
//     accepted/started, completion never established) — it must NEVER convert
//     a crashed claim to `executed`.
// Seeds are planted at real product paths; the injected commandRunner is a
// willing target whose invocation count proves nothing was re-performed.
// BLOCKED:B-17-L3 — the live cell of this boundary stays parked.

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  ApprovalStore,
  approvalLifecycleState,
  type ApprovalLogEvent,
} from "../../../src/org/approvals.js";
import type { AppsFile } from "../../../src/org/apps.js";
import {
  executeApprovedReleases,
  queueReleaseApprovals,
  type ReleaseExecutionRecord,
} from "../../../src/org/release.js";
import type { LoopItem } from "../../../src/loop/types.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";

const APP = "release-app";
const RELEASE_COMMAND = "./scripts/deploy.sh production";

function mergedItem(): LoopItem {
  return {
    issueNumber: 7,
    ticketRef: "#7",
    title: "Deployable milestone",
    body: "Release-kind: deploy\n",
    targetRepo: "operon-double/unused",
    labels: [],
    phase: "merged",
    tier: "standard",
    cycles: 0,
    remediationAttempts: 0,
    gateResults: [],
    findings: [],
    releaseTrigger: { kind: "deploy", command: RELEASE_COMMAND, owner: "orchestrator" },
  };
}

interface Seeded {
  home: TempStateHome;
  store: ApprovalStore;
  clock: TestClock;
  approvalId: string;
  runnerCalls: () => number;
  run: () => ReturnType<typeof executeApprovedReleases>;
}

describe("CF-J17-RC — completion-typed markers convert a crashed attempt; acceptance-typed markers never do (L2)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function seedCrashedClaim(): Promise<Seeded> {
    const home = await makeTempStateHome({ name: "cf-j17-rc" });
    cleanups.push(() => home.cleanup());
    const clock = makeTestClock("2026-07-31T09:00:00.000Z");
    const store = new ApprovalStore(home.stateHome);
    const [queued] = await queueReleaseApprovals(home.stateHome, APP, [mergedItem()], clock.dateFn);
    const approvalId = queued!.approvalId;
    await store.decide(approvalId, { decision: "approved", now: clock.nowDate() });
    await store.beginExecution(approvalId, "orchestrator/release", clock.nowDate());
    const appsFile: AppsFile = {
      org: { name: "cf-j17-rc", maxConcurrentTurns: 1 },
      defaults: { budgetUsdMonth: 100 },
      apps: [{ name: APP, repo: "operon-double/unused", status: "live", budgetUsdMonth: 100, cadence: {} }],
    };
    let calls = 0;
    const run = () =>
      executeApprovedReleases({
        stateHome: home.stateHome,
        orgHome: home.path("org-home-never-read"),
        appsFile,
        now: clock.dateFn,
        commandRunner: async () => {
          calls += 1;
          return { exitCode: 0, stdout: "deployed again", stderr: "" };
        },
      });
    return { home, store, clock, approvalId, runnerCalls: () => calls, run };
  }

  function seedReleaseRecord(seeded: Seeded, status: "running" | "completed" | "failed"): void {
    const record: ReleaseExecutionRecord = {
      schemaVersion: 1,
      approvalId: seeded.approvalId,
      app: APP,
      ticketRef: "#7",
      owner: "orchestrator",
      command: RELEASE_COMMAND,
      status,
      startedAt: seeded.clock.nowIso(),
      commentedAt: seeded.clock.nowIso(), // keep reconciliation off the gh seam
      ...(status === "running"
        ? {}
        : { finishedAt: seeded.clock.nowIso(), exitCode: status === "completed" ? 0 : 1, summary: `seeded ${status} marker` }),
    };
    mkdirSync(seeded.home.path("releases"), { recursive: true });
    writeFileSync(seeded.home.path("releases", `${seeded.approvalId}.json`), `${JSON.stringify(record, null, 2)}\n`);
  }

  it("a completion-typed marker (completed record) converts the crashed claim to executed without re-performing", async () => {
    const seeded = await seedCrashedClaim();
    seedReleaseRecord(seeded, "completed");

    await seeded.run();
    expect(seeded.runnerCalls()).toBe(0); // exactly-once holds via evidence, not re-run
    const after = await seeded.store.show(seeded.approvalId);
    expect(after.item.execution?.state).toBe("executed");
    expect(after.item.execution?.actor).toBe("orchestrator/release-reconcile");
    expect(after.item.execution?.result).toContain("seeded completed marker");

    // The acknowledgement is a durable, distinct audit fact (T-12).
    const log = await seeded.store.readLog();
    const transitions = log.filter(
      (event): event is Extract<ApprovalLogEvent, { type: "execution-transition" }> =>
        event.type === "execution-transition" && event.id === seeded.approvalId,
    );
    expect(transitions.map((event) => `${event.from}->${event.to}`)).toEqual([
      "approved->executing",
      "executing->executed",
    ]);
  });

  it("a completion-typed FAILED marker converts the crashed claim to failed — evidence decides, never optimism", async () => {
    const seeded = await seedCrashedClaim();
    seedReleaseRecord(seeded, "failed");
    await seeded.run();
    expect(seeded.runnerCalls()).toBe(0);
    const after = await seeded.store.show(seeded.approvalId);
    expect(after.item.execution?.state).toBe("failed");
    expect(after.item.execution?.result).toContain("seeded failed marker");
  });

  it("negative control: an acceptance-typed marker (running record) seeded against a crashed claim — the typing detector FIRES: never executed, ambiguous instead", async () => {
    const seeded = await seedCrashedClaim();
    // SEEDED VIOLATION-TEMPTATION: the only surviving evidence says the
    // attempt was ACCEPTED (started); nothing proves completion. A marker
    // reconciler that treated acceptance as completion would mark executed.
    seedReleaseRecord(seeded, "running");

    await seeded.run();
    expect(seeded.runnerCalls()).toBe(0);
    const after = await seeded.store.show(seeded.approvalId);
    expect(after.item.execution?.state).toBe("ambiguous");
    expect(after.item.execution?.state).not.toBe("executed");
    expect(approvalLifecycleState(after.item)).toBe("ambiguous");

    // Repeat dispatches never upgrade acceptance into completion.
    await seeded.run();
    expect((await seeded.store.show(seeded.approvalId)).item.execution?.state).toBe("ambiguous");
    expect(seeded.runnerCalls()).toBe(0);
  });

  it("after the acceptance-only ambiguity, only an explicit human disposition closes it — and it retires the unconsumed grant", async () => {
    const seeded = await seedCrashedClaim();
    seedReleaseRecord(seeded, "running");
    await seeded.run();
    expect((await seeded.store.show(seeded.approvalId)).item.execution?.state).toBe("ambiguous");

    const closed = await seeded.store.dispositionExecution({
      id: seeded.approvalId,
      disposition: "executed",
      reason: "operator verified the deploy landed via the target's own console",
      actor: "human/operator",
      now: seeded.clock.nowDate(),
    });
    expect(closed.execution?.state).toBe("executed");
    expect(closed.execution?.actor).toBe("human/operator");

    // The never-consumed single-use grant cannot survive as live authority.
    const { grant } = await seeded.store.show(seeded.approvalId);
    expect(grant!.uses).toBe(0);
    expect(grant!.revokedAt).toBeDefined();
  });
});
