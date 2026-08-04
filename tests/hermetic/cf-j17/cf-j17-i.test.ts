// CF-J17-I — lost response / marker disagreement → ambiguous terminal
// (contracts/B-17-typed-executor.md §3; CORMIDIA-INV-003 "ambiguity is
// terminal-until-reconciled and is never resolved by re-performing";
// system-map T-12; risk E-1).
//
// L2 on real product code: `executeApprovedReleases` reconciling seeded crash
// states — a claim with no release record (response lost before the durable
// attempt record), and a `running` record whose process died (response lost
// after the attempt started). Seeds are planted at the real product paths
// (`approvals/decided/*.json` via the store API, `releases/<id>.json` per the
// exported ReleaseExecutionRecord schema). The injected commandRunner is a
// WILLING deploy target: proof of "never re-perform" is that it is never
// invoked. BLOCKED:B-17-L3 — the live cell of this boundary stays parked.

import { afterEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ApprovalStore, approvalLifecycleState } from "../../../src/org/approvals.js";
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
    targetRepo: "cormidia-double/unused",
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
  appsFile: AppsFile;
  runnerCalls: () => number;
  run: () => ReturnType<typeof executeApprovedReleases>;
}

describe("CF-J17-I — lost response and record/claim disagreement land ambiguous-terminal, never a re-performed deploy (L2)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  /** Approved release claimed to `executing` — the durable state a process
   *  death leaves between the claim and the acknowledgement. */
  async function seedCrashedClaim(): Promise<Seeded> {
    const home = await makeTempStateHome({ name: "cf-j17-i" });
    cleanups.push(() => home.cleanup());
    const clock = makeTestClock("2026-07-31T09:00:00.000Z");
    const store = new ApprovalStore(home.stateHome);
    const [queued] = await queueReleaseApprovals(home.stateHome, APP, [mergedItem()], clock.dateFn);
    const approvalId = queued!.approvalId;
    await store.decide(approvalId, { decision: "approved", now: clock.nowDate() });
    const claimed = await store.beginExecution(approvalId, "orchestrator/release", clock.nowDate());
    expect(claimed?.execution?.state).toBe("executing");
    const appsFile: AppsFile = {
      org: { name: "cf-j17-i", maxConcurrentTurns: 1 },
      defaults: { budgetUsdMonth: 100 },
      apps: [{ name: APP, repo: "cormidia-double/unused", status: "live", budgetUsdMonth: 100, cadence: {} }],
    };
    let calls = 0;
    const run = () =>
      executeApprovedReleases({
        stateHome: home.stateHome,
        // orgHome is only dereferenced once an execution episode actually
        // starts; these reconciliation walks must terminate before that.
        orgHome: home.path("org-home-never-read"),
        appsFile,
        now: clock.dateFn,
        commandRunner: async () => {
          calls += 1; // a WILLING target — being invoked would BE the violation
          return { exitCode: 0, stdout: "deployed again", stderr: "" };
        },
      });
    return { home, store, clock, approvalId, appsFile, runnerCalls: () => calls, run };
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
      // commentedAt set so reconciliation stays off the GitHub seam — the
      // outcome-comment leg is CF-J17-S's.
      commentedAt: seeded.clock.nowIso(),
      ...(status === "running" ? {} : { finishedAt: seeded.clock.nowIso(), exitCode: status === "completed" ? 0 : 1, summary: `seeded ${status} record` }),
    };
    mkdirSync(seeded.home.path("releases"), { recursive: true });
    writeFileSync(seeded.home.path("releases", `${seeded.approvalId}.json`), `${JSON.stringify(record, null, 2)}\n`);
  }

  it("negative control: a claim with NO release record (lost before the attempt record) — the ambiguity detector FIRES; the willing runner is never invoked", async () => {
    const seeded = await seedCrashedClaim();

    const outcomes = await seeded.run();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.status).toBe("skipped");
    expect(outcomes[0]!.summary).toContain("claim without an execution record");
    expect(seeded.runnerCalls()).toBe(0);

    const after = await seeded.store.show(seeded.approvalId);
    expect(after.item.execution?.state).toBe("ambiguous");
    expect(after.item.execution?.failureCause).toBe("ambiguous_release_result");
    expect(after.item.execution?.nextAction).toBe("reconcile");

    // Terminal-until-reconciled: further dispatches never retry, never flip
    // the record, never touch the target.
    const second = await seeded.run();
    expect(second).toHaveLength(1);
    expect(second[0]!.status).toBe("skipped");
    expect(second[0]!.summary).toContain("remains ambiguous");
    expect(seeded.runnerCalls()).toBe(0);
    expect((await seeded.store.show(seeded.approvalId)).item.execution?.state).toBe("ambiguous");
  });

  it("a running record whose process died (lost after the attempt started) lands ambiguous and stays there across dispatches", async () => {
    const seeded = await seedCrashedClaim();
    seedReleaseRecord(seeded, "running");

    const outcomes = await seeded.run();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.status).toBe("skipped");
    expect(outcomes[0]!.summary).toContain("ambiguous running record");
    expect(seeded.runnerCalls()).toBe(0);
    const after = await seeded.store.show(seeded.approvalId);
    expect(after.item.execution?.state).toBe("ambiguous");
    expect(approvalLifecycleState(after.item)).toBe("ambiguous"); // never rendered executed

    const second = await seeded.run();
    expect(second[0]!.status).toBe("skipped");
    expect(seeded.runnerCalls()).toBe(0);
    expect((await seeded.store.show(seeded.approvalId)).item.execution?.state).toBe("ambiguous");
  });

  it("record/claim disagreement never picks the greener story: a failed record converts the claim to failed, not executed", async () => {
    const seeded = await seedCrashedClaim();
    seedReleaseRecord(seeded, "failed");

    await seeded.run();
    expect(seeded.runnerCalls()).toBe(0);
    const after = await seeded.store.show(seeded.approvalId);
    expect(after.item.execution?.state).toBe("failed");
    expect(after.item.execution?.failureCause).toBe("release_failed");
    expect(after.item.execution?.state).not.toBe("executed");
  });
});
