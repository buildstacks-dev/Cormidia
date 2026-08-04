// CF-J17-R — refusal legs of the release handoff (contracts/journey-acceptance.md
// J-17; contracts/B-17-typed-executor.md §1; CORMIDIA-INV-003; risk E-1):
// a deployable milestone with no declared `release:` mechanism fails the ship
// gate (A4/P7) before any merge side effect, and `production-deploy` — a
// never-broadly-scopeable rule — refuses a human scope-widening attempt.
//
// L2 on real product code: `advanceShipping` (the P7 ship gate) against the
// gh process double (B-01 seam), and `ApprovalStore.decide` against a temp
// state home. BLOCKED:B-17-L3 — the live cell of this boundary stays parked.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseRevisionForBranch } from "../../../src/loop/default-branch.js";
import { DEFAULT_LOOP_POLICY } from "../../../src/loop/driver.js";
import { GhCliOps } from "../../../src/loop/github.js";
import { advanceShipping } from "../../../src/loop/loop.js";
import { parseReleaseKind } from "../../../src/loop/plan-tickets.js";
import type { LoopItem, ReleaseConfig } from "../../../src/loop/types.js";
import {
  ApprovalStore,
  NEVER_SCOPEABLE_RULES,
  approvalLifecycleState,
} from "../../../src/org/approvals.js";
import { queueReleaseApprovals } from "../../../src/org/release.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { makeTestClock } from "../../fixtures/clock.js";

const APP = "release-app";
const DEFAULT_BRANCH = "trunk";
const OP_LABELS = [
  { name: "op:in-review", color: "0E8A16", description: "PR opened, in review" },
  { name: "op:returned", color: "B60205", description: "returned for triage" },
];

const DEPLOYABLE_BODY = [
  "## Goal",
  "Ship it.",
  "",
  "## Acceptance criteria",
  "- [ ] shipped",
  "",
  "Release-kind: deploy",
  "",
].join("\n");

describe("CF-J17-R — undeclared mechanism fails the ship gate; scoped grants refused for production-deploy (L2)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeShippingWalk(release: ReleaseConfig | undefined): Promise<{
    handle: GithubDoubleHandle;
    gh: GhCliOps;
    item: LoopItem;
    localRepo: string;
    issueNumber: number;
    release: ReleaseConfig | undefined;
  }> {
    const handle = await installGithubDouble({ defaultBranch: DEFAULT_BRANCH, labels: OP_LABELS });
    cleanups.push(() => handle.dispose());
    const gh = new GhCliOps(handle.repo, handle.exec);
    const issue = await gh.createIssue({
      title: "Deployable milestone",
      body: DEPLOYABLE_BODY,
      labels: ["op:in-review"],
    });
    const localRepo = await mkdtemp(join(tmpdir(), "cormidia-cf-j17-r-"));
    cleanups.push(() => rm(localRepo, { recursive: true, force: true }));
    const item: LoopItem = {
      issueNumber: issue.number,
      ticketRef: `#${issue.number}`,
      title: issue.title,
      body: DEPLOYABLE_BODY,
      targetRepo: handle.repo,
      labels: ["op:in-review"],
      phase: "shipping",
      tier: "standard",
      cycles: 0,
      remediationAttempts: 0,
      gateResults: [],
      findings: [],
      branch: "cormidia/issue-1",
      worktree: join(localRepo, "worktree-placeholder"),
      prNumber: 1,
    };
    return { handle, gh, item, localRepo, issueNumber: issue.number, release };
  }

  async function runShipGate(walk: Awaited<ReturnType<typeof makeShippingWalk>>): Promise<LoopItem> {
    return advanceShipping(walk.item, {
      gh: walk.gh,
      policy: DEFAULT_LOOP_POLICY,
      commands: { testCommand: "true" },
      criteria: [],
      criterionTests: {},
      base: baseRevisionForBranch(DEFAULT_BRANCH),
      localRepo: walk.localRepo,
      ...(walk.release !== undefined ? { release: walk.release } : {}),
    });
  }

  it("negative control: deployable milestone with NO declared mechanism — the P7 detector FIRES: returned, commented, never merged", async () => {
    // SEEDED VIOLATION: `Release-kind: deploy` is declared on the milestone
    // while the app declares no `release:` mechanism at all.
    const walk = await makeShippingWalk(undefined);
    const returned = await runShipGate(walk);

    expect(returned.phase).toBe("returned");
    expect(returned.releaseTrigger).toBeUndefined();
    expect(returned.labels).toContain("op:returned");

    // Durable refusal evidence on the ticket, and the label swap really landed.
    const issue = await walk.gh.readIssue(walk.issueNumber);
    expect(issue.labels).toEqual(["op:returned"]);
    const comments = await walk.gh.listIssueComments(walk.issueNumber);
    expect(comments.some((comment) => comment.body.includes("Release disposition unowned (P7)"))).toBe(true);

    // No merge side effect of any kind crossed the seam.
    const log = walk.handle.callLog();
    expect(log.some((entry) => entry.op === "pr.merge")).toBe(false);
  });

  it("a declared mechanism of the WRONG kind also fails the ship gate before any merge", async () => {
    const walk = await makeShippingWalk({ kind: "package", command: "./scripts/package.sh", owner: "orchestrator", trigger: "command" });
    const returned = await runShipGate(walk);
    expect(returned.phase).toBe("returned");
    const comments = await walk.gh.listIssueComments(walk.issueNumber);
    expect(comments.some((comment) => comment.body.includes("`release.kind: package`"))).toBe(true);
    expect(walk.handle.callLog().some((entry) => entry.op === "pr.merge")).toBe(false);
  });

  it("a milestone with no Release-kind trailer imposes no release requirement (P7 is specific, not always-red)", () => {
    // L1-grade check of the same product predicate the gate consults: the
    // refusal above is specific to a declared deployable disposition.
    expect(parseReleaseKind("## Goal\nJust merge.\n")).toBeUndefined();
    expect(parseReleaseKind(DEPLOYABLE_BODY)).toBe("deploy");
  });

  it("production-deploy refuses a human scope-widening attempt; the item stays pending and single-use approval still works", async () => {
    const home: TempStateHome = await makeTempStateHome({ name: "cf-j17-r" });
    cleanups.push(() => home.cleanup());
    const clock = makeTestClock("2026-07-31T09:00:00.000Z");
    const store = new ApprovalStore(home.stateHome);
    const [queued] = await queueReleaseApprovals(
      home.stateHome,
      APP,
      [
        {
          issueNumber: 7,
          ticketRef: "#7",
          title: "Deployable milestone",
          body: DEPLOYABLE_BODY,
          targetRepo: "cormidia-double/unused",
          labels: [],
          phase: "merged",
          tier: "standard",
          cycles: 0,
          remediationAttempts: 0,
          gateResults: [],
          findings: [],
          releaseTrigger: { kind: "deploy", command: "./scripts/deploy.sh production", owner: "sre" },
        },
      ],
      clock.dateFn,
    );
    const approvalId = queued!.approvalId;
    expect(NEVER_SCOPEABLE_RULES).toContain("production-deploy");

    // SEEDED VIOLATION (INV-003 grant-shape clause): the human tries to widen
    // a production deploy to an app-scoped multi-use grant.
    await expect(
      store.decide(approvalId, {
        decision: "approved",
        scope: { kind: "app" },
        now: clock.nowDate(),
      }),
    ).rejects.toThrow(/never scopeable/);

    // The refusal left the decision surface untouched: still pending, no
    // grant, no execution record.
    const pending = await store.listPending();
    expect(pending.map((item) => item.id)).toEqual([approvalId]);
    expect(pending[0]!.status).toBe("pending");
    expect(pending[0]!.grantId).toBeUndefined();
    expect((await store.listDecided())).toHaveLength(0);

    // The ratified default shape still works: fresh, exact, single-use.
    const decided = await store.decide(approvalId, { decision: "approved", now: clock.nowDate() });
    expect(approvalLifecycleState(decided)).toBe("approved");
    const { grant } = await store.show(approvalId);
    expect(grant!.uses).toBe(1);
    expect(grant!.scope).toBeUndefined();
  });
});
