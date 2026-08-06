// CF-J05-RC — idempotency-marker reconciliation converts a crashed attempt
// correctly; markers are typed by what they prove (contracts/
// B-17-typed-executor.md §3/§4; contracts/journey-acceptance.md J-05;
// CORMIDIA-INV-003/008; system-map T-12; risk E-1).
//
// L2 on real product code: `executeApprovedDeliveries` (the durable-github
// typed executor) against the gh PROCESS double (B-01 seam) through
// unmodified GhCliOps. Marker typing on this executor:
//   - COMPLETION-typed: the delivery marker found in exactly one remote body
//     — converts a crashed `executing` claim to `executed`;
//   - ACCEPTANCE-typed: the consumed grant + claimed attempt (the attempt
//     was accepted into flight) — NEVER converts to executed; without
//     completion evidence the record lands `ambiguous`;
//   - DISAGREEMENT: more than one remote body carries the marker — ambiguous,
//     never the greener story.

import { afterEach, describe, expect, it } from "vitest";
import { executeApprovedDeliveries, githubIssueCreateAction } from "../../../src/org/approval-delivery.js";
import { ApprovalStore, approvalLifecycleState, type ApprovalItem } from "../../../src/org/approvals.js";
import type { AppsFile } from "../../../src/org/apps.js";
import { GhCliOps } from "../../../src/loop/github.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";

const APP = "delivery-app";
const ROLE = "support";
const IDEMPOTENCY_KEY = "cf-j05-rc:delivery:0001";

interface Walk {
  home: TempStateHome;
  handle: GithubDoubleHandle;
  gh: GhCliOps;
  store: ApprovalStore;
  clock: TestClock;
  appsFile: AppsFile;
  approvalId: string;
  run: (fault?: "after_claim" | "after_remote") => Promise<Awaited<ReturnType<typeof executeApprovedDeliveries>>>;
}

describe("CF-J05-RC — typed idempotency-marker reconciliation of crashed durable-github deliveries (L2)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeWalk(): Promise<Walk> {
    const home = await makeTempStateHome({ name: "cf-j05-rc" });
    cleanups.push(() => home.cleanup());
    const handle = await installGithubDouble({ defaultBranch: "trunk" });
    cleanups.push(() => handle.dispose());
    const gh = new GhCliOps(handle.repo, handle.exec);
    const clock = makeTestClock("2026-07-31T09:00:00.000Z");
    const store = new ApprovalStore(home.stateHome);

    const action = githubIssueCreateAction({
      repo: handle.repo,
      title: "Support digest",
      body: "A typed, content-bound external publication.",
      labels: [],
      idempotency_key: IDEMPOTENCY_KEY,
    });
    const raised = await store.raise({
      app: APP,
      role: ROLE,
      rule: "external-publishing",
      action,
      now: clock.nowDate(),
    });
    const decided = await store.decide(raised.id, { decision: "approved", now: clock.nowDate() });
    expect(decided.execution?.executor).toBe("durable-github"); // the typed slice under test

    const appsFile: AppsFile = {
      org: { name: "cf-j05-rc", maxConcurrentTurns: 1 },
      defaults: { budgetUsdMonth: 100, objectiveBudgetUsd: 1000 },
      apps: [
        { name: APP, repo: handle.repo, status: "live", budgetUsdMonth: 100, objectiveBudgetUsd: 1000, cadence: {} },
      ],
    };
    const run = (fault?: "after_claim" | "after_remote") =>
      executeApprovedDeliveries({
        stateHome: home.stateHome,
        appsFile,
        now: clock.dateFn,
        ghFor: () => new GhCliOps(handle.repo, handle.exec),
        ...(fault === undefined
          ? {}
          : {
              fault: (boundary: "after_claim" | "after_remote") => {
                if (boundary === fault) throw new Error(`SIMULATED CRASH at ${fault}`);
              },
            }),
      });
    return { home, handle, gh, store, clock, appsFile, approvalId: raised.id, run };
  }

  function remoteIssuesWithMarker(handle: GithubDoubleHandle): string[] {
    const state = handle.readState();
    return Object.values(state.issues)
      .filter((issue) => issue.body.includes(`cormidia:delivery id=${IDEMPOTENCY_KEY}`))
      .map((issue) => issue.title);
  }

  it("completion-typed marker: a crash after the remote effect reconciles to executed WITHOUT a duplicate publication", async () => {
    const walk = await makeWalk();

    // Crash between the remote effect and the acknowledgement.
    await expect(walk.run("after_remote")).rejects.toThrow(/SIMULATED CRASH/);
    const crashed = await walk.store.show(walk.approvalId);
    expect(crashed.item.execution?.state).toBe("executing");
    expect(crashed.grant!.uses).toBe(0); // grant consumed before the effect
    expect(remoteIssuesWithMarker(walk.handle)).toHaveLength(1); // effect landed once

    // The next dispatch reconciles by marker — never re-publishes.
    const outcomes = await walk.run();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ approvalId: walk.approvalId, status: "executed" });
    expect(outcomes[0]!.summary).toContain("recovered from idempotency marker");
    expect(outcomes[0]!.remoteRef).toBeDefined();
    const after = await walk.store.show(walk.approvalId);
    expect(after.item.execution?.state).toBe("executed");
    expect(after.item.execution?.remoteRef).toBeDefined();
    expect(remoteIssuesWithMarker(walk.handle)).toHaveLength(1); // still exactly one

    // At-most-once across a further dispatch too.
    expect(await walk.run()).toEqual([]);
    expect(remoteIssuesWithMarker(walk.handle)).toHaveLength(1);
  });

  it("acceptance-typed evidence alone (claimed attempt, no remote marker) NEVER converts to executed — ambiguous instead, and only explicit re-arm retries", async () => {
    const walk = await makeWalk();

    // Crash after the claim, before any remote mutation: the surviving
    // evidence says only "the attempt was accepted into flight".
    await expect(walk.run("after_claim")).rejects.toThrow(/SIMULATED CRASH/);
    const crashed = await walk.store.show(walk.approvalId);
    expect(crashed.item.execution?.state).toBe("executing");
    expect(crashed.item.execution?.attempts).toBe(1);
    expect(remoteIssuesWithMarker(walk.handle)).toHaveLength(0);

    // Reconciliation finds no completion marker: acceptance never upgrades.
    const outcomes = await walk.run();
    expect(outcomes[0]).toMatchObject({ status: "ambiguous", cause: "ambiguous_remote_response" });
    const ambiguous = await walk.store.show(walk.approvalId);
    expect(ambiguous.item.execution?.state).toBe("ambiguous");
    expect(approvalLifecycleState(ambiguous.item)).not.toBe("executed");

    // Terminal for automation: a further dispatch only reports, never retries.
    const again = await walk.run();
    expect(again[0]).toMatchObject({ status: "skipped" });
    expect(again[0]!.summary).toContain("human disposition");
    expect(remoteIssuesWithMarker(walk.handle)).toHaveLength(0);

    // Explicit human re-arm is the ONLY retry path (content-bound, one use).
    await walk.store.dispositionExecution({
      id: walk.approvalId,
      disposition: "retry",
      reason: "operator verified nothing reached the target; re-arming the exact grant",
      actor: "human/operator",
      now: walk.clock.nowDate(),
    });
    const rearmed = await walk.run();
    expect(rearmed[0]).toMatchObject({ status: "executed" });
    expect(remoteIssuesWithMarker(walk.handle)).toHaveLength(1); // performed exactly once, after re-arm
  });

  it("negative control: TWO remote bodies carry the marker — the disagreement detector FIRES: ambiguous, never the greener story", async () => {
    const walk = await makeWalk();

    // Crash after the remote effect (one legitimate marked issue exists).
    await expect(walk.run("after_remote")).rejects.toThrow(/SIMULATED CRASH/);
    const marked = remoteIssuesWithMarker(walk.handle);
    expect(marked).toHaveLength(1);

    // SEEDED VIOLATION: a second remote body with the SAME delivery marker
    // (copied from the real one, so the format cannot drift from product).
    const state = walk.handle.readState();
    const original = Object.values(state.issues).find((issue) =>
      issue.body.includes(`cormidia:delivery id=${IDEMPOTENCY_KEY}`),
    )!;
    const markerLine = /<!-- cormidia:delivery id=[^>]*-->/.exec(original.body)![0];
    await walk.gh.createIssue({
      title: "Impostor with the same marker",
      body: `Unrelated content.\n\n${markerLine}\n`,
      labels: [],
    });
    expect(remoteIssuesWithMarker(walk.handle)).toHaveLength(2);

    const outcomes = await walk.run();
    expect(outcomes[0]).toMatchObject({ status: "ambiguous" });
    expect(outcomes[0]!.summary).toContain("multiple remote actions");
    const after = await walk.store.show(walk.approvalId);
    expect(after.item.execution?.state).toBe("ambiguous");
    expect(after.item.execution?.state).not.toBe("executed");
    // No third publication was ever attempted.
    expect(remoteIssuesWithMarker(walk.handle)).toHaveLength(2);
  });

  it("a tampered action (app/repo mismatch) fails closed without touching the remote", async () => {
    const walk = await makeWalk();
    // SEEDED VIOLATION: the decided action's repo no longer matches the app's.
    const decidedPath = walk.home.path("approvals", "decided", `${walk.approvalId}.json`);
    const { readFileSync, writeFileSync } = await import("node:fs");
    const tampered = JSON.parse(readFileSync(decidedPath, "utf8")) as ApprovalItem;
    (tampered.action.input as { repo: string }).repo = "somebody-else/other-repo";
    writeFileSync(decidedPath, `${JSON.stringify(tampered, null, 2)}\n`);

    const outcomes = await walk.run();
    expect(outcomes[0]).toMatchObject({ status: "failed", cause: "invalid_action" });
    expect(remoteIssuesWithMarker(walk.handle)).toHaveLength(0);
    expect(walk.handle.callLog().some((entry) => entry.op === "issue.create")).toBe(false);
  });
});
