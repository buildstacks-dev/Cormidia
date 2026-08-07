// CF-SPLIT-PUBLISHING (L2) — target-repo verification at the composed gate
// (#296 §5.3, F-PT-023 ratified): the budgeted collaboration tier is reachable
// ONLY after the gate verifies the action's target is the app's own configured
// repository. An explicit slug is compared to the app's repo; a flag-less
// invocation is verified against the workdir's actual git origin; anything
// unverifiable — a dynamic slug, a cwd-shifting compound, a missing or
// foreign origin — refines to `repo-collaboration-foreign` (human-only) and
// escalates with THAT rule, so the never-scopeable boundary applies to the
// raised item. This is the compensating control that makes the headline split
// a net tightening: today the gate never checks which repository at all.

import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultGate } from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { composeGate, type GateContext } from "../../../src/org/gate-compose.js";
import { ObjectiveGrantStore } from "../../../src/org/objective-grants.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";

const APP = "pub-app";
const ROLE = "builder";
const APP_REPO = "cormidia/pub-app";
const COMMENT: ToolAction = { tool: "bash", input: { command: "gh issue comment 12 --body done" } };

describe("CF-SPLIT-PUBLISHING — target verification at the composed gate (L2)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeGitWorkdir(originUrl: string | null): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "cf-split-pub-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    execFileSync("git", ["init", "-q", dir]);
    if (originUrl !== null) {
      execFileSync("git", ["-C", dir, "remote", "add", "origin", originUrl]);
    }
    return dir;
  }

  async function makeWorld(context: Partial<GateContext> = {}): Promise<{
    home: TempStateHome;
    approvals: ApprovalStore;
    objectives: ObjectiveGrantStore;
    clock: TestClock;
    gate: ReturnType<typeof composeGate>;
  }> {
    const home = await makeTempStateHome({ name: "cf-split-publishing" });
    cleanups.push(() => home.cleanup());
    const clock = makeTestClock("2026-08-06T14:00:00.000Z");
    // Same pinned clock as the gate (B-06 §1): a store left on host wall time
    // judges these fixture-instant items for TTL expiry against real time, so
    // the foreign-slug refusal below rots into an expiry error once real time
    // passes the fixture (#356 / CF-REG-356 — the sibling of the CF-SPLIT-NETWORK
    // failure, armed for 2026-08-07T14:00Z).
    const approvals = new ApprovalStore(home.stateHome, { now: clock.dateFn });
    const objectives = new ObjectiveGrantStore(home.stateHome);
    const gate = composeGate(defaultGate, approvals, {
      app: APP,
      role: ROLE,
      appRepo: APP_REPO,
      now: () => clock.nowDate(),
      ...context,
    });
    return { home, approvals, objectives, clock, gate };
  }

  it("an explicit --repo slug equal to the app's own repo is budgeted: proceeds with an audit row, no item", async () => {
    const { approvals, objectives, gate } = await makeWorld();
    const action: ToolAction = { tool: "bash", input: { command: `gh issue comment 12 -R ${APP_REPO} --body done` } };
    expect(gate(action)).toEqual({ allow: true });
    expect(await approvals.listPending()).toHaveLength(0);
    const rows = objectives.readLogSync().filter((event) => event.type === "budgeted-action");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rule: "repo-collaboration" });
  });

  it("an explicit foreign slug refines to repo-collaboration-foreign: escalates under THAT rule, and the item is never widenable", async () => {
    const { approvals, gate } = await makeWorld();
    const action: ToolAction = { tool: "bash", input: { command: "gh issue comment 12 -R other/repo --body done" } };
    const decision = gate(action);
    expect(decision.allow).toBe(false);
    if (decision.allow === false) expect(decision.reason).toContain("repo-collaboration-foreign");
    const pending = await approvals.listPending();
    expect(pending.map((item) => item.rule)).toEqual(["repo-collaboration-foreign"]);
    expect(pending[0]?.classification?.rule).toBe("repo-collaboration-foreign");
    await expect(approvals.decide(pending[0]!.id, { decision: "approved", scope: { kind: "app" } })).rejects.toThrow(
      /never scopeable/,
    );
    await expect(
      approvals.decide(pending[0]!.id, {
        decision: "approved",
        decidedBy: { kind: "agent", identity: "agent/drain" },
        reason: "agent drain",
      }),
    ).rejects.toThrow(/requires a human decision/);
  });

  it("a flag-less invocation is verified against the workdir's REAL origin: matching origin is budgeted", async () => {
    const workdir = await makeGitWorkdir(`https://github.com/${APP_REPO}.git`);
    const { approvals, objectives, gate } = await makeWorld({ workdir });
    expect(gate(COMMENT)).toEqual({ allow: true });
    expect(await approvals.listPending()).toHaveLength(0);
    expect(objectives.readLogSync().filter((event) => event.type === "budgeted-action")).toHaveLength(1);
  });

  it("a flag-less invocation from a FOREIGN-origin workdir refines foreign — the prompt-injection cd-clone hole is closed", async () => {
    const workdir = await makeGitWorkdir("git@github.com:attacker/evil-clone.git");
    const { approvals, gate } = await makeWorld({ workdir });
    const decision = gate(COMMENT);
    expect(decision.allow).toBe(false);
    expect((await approvals.listPending()).map((item) => item.rule)).toEqual(["repo-collaboration-foreign"]);
  });

  it("unverifiable targets fail closed to foreign: no workdir, origin-less workdir, dynamic slug, and cwd-shifting compound", async () => {
    const originless = await makeGitWorkdir(null);
    for (const { context, action } of [
      { context: {}, action: COMMENT }, // no workdir at all
      { context: { workdir: originless }, action: COMMENT }, // repo with no origin
      { context: {}, action: { tool: "bash", input: { command: 'gh issue comment 12 -R "$TARGET" --body x' } } },
      { context: {}, action: { tool: "bash", input: { command: "cd /tmp/clone && gh issue comment 12 --body x" } } },
    ] as const) {
      const { approvals, gate } = await makeWorld(context);
      const decision = gate(action as ToolAction);
      expect(decision.allow).toBe(false);
      expect((await approvals.listPending()).map((item) => item.rule)).toEqual(["repo-collaboration-foreign"]);
    }
  });

  it("the typed durable-github tool verifies its input repo the same way", async () => {
    const { approvals, gate } = await makeWorld();
    const own: ToolAction = {
      tool: "cormidia.github.issue.comment",
      input: { schema_version: 1, repo: APP_REPO, issue: 12, body: "done" },
    };
    expect(gate(own)).toEqual({ allow: true });
    const foreign: ToolAction = {
      tool: "cormidia.github.issue.comment",
      input: { schema_version: 1, repo: "other/repo", issue: 12, body: "done" },
    };
    expect(gate(foreign).allow).toBe(false);
    expect((await approvals.listPending()).map((item) => item.rule)).toEqual(["repo-collaboration-foreign"]);
  });

  it("a §4.1 ceremony objective grant covers package-publish for its exact class; the collaboration tier never absorbs a publish", async () => {
    const { approvals, objectives, clock, gate } = await makeWorld();
    const publish: ToolAction = { tool: "bash", input: { command: "npm publish --access public" } };
    expect(gate(publish).allow).toBe(false);
    expect((await approvals.listPending()).map((item) => item.rule)).toEqual(["package-publish"]);

    objectives.createSync({
      app: APP,
      objective: "ship cormidia@0.1.x when qualification passes",
      createdBy: "human/owner",
      repoNamespace: APP_REPO,
      spendCeilingUsd: 10,
      criticalClasses: [{ rule: "package-publish", scope: "cormidia@0.1.x", precondition: "RQ-1 evidence complete" }],
      now: clock.nowDate(),
    });
    expect(gate(publish)).toEqual({ allow: true });
  });

  it("an A1 scoped grant can never cover the foreign class — the standing-grant guard applies to the REFINED rule", async () => {
    const { home, approvals, gate, clock } = await makeWorld();
    // Plant a scoped grant for repo-collaboration (the budgeted class) and
    // aim a FOREIGN comment at the gate: the refinement must consult the
    // foreign tier before grant matching, so the grant is never consulted
    // under the budgeted rule name.
    const { writeFile } = await import("node:fs/promises");
    const { actionHash } = await import("../../../src/org/approvals.js");
    const covered: ToolAction = { tool: "bash", input: { command: "gh issue comment 12 -R other/repo --body x" } };
    const item = {
      id: "20260806T140000Z-pubg",
      app: APP,
      role: ROLE,
      rule: "repo-collaboration",
      action: covered,
      raisedAt: clock.nowDate().toISOString(),
      status: "approved",
      decision: "approved",
      decidedAt: clock.nowDate().toISOString(),
      decidedBy: { kind: "human", identity: "human/operator" },
      reason: "pre-existing widened approval",
      grantId: "grant-20260806T140000Z-pubg",
    };
    const grant = {
      grantId: "grant-20260806T140000Z-pubg",
      approvalId: item.id,
      app: APP,
      role: ROLE,
      actionHash: actionHash(covered),
      identityVersion: (await import("../../../src/org/approvals.js")).ACTION_IDENTITY_VERSION,
      expiresAt: new Date(clock.nowDate().getTime() + 3_600_000).toISOString(),
      uses: 20,
      createdAt: clock.nowDate().toISOString(),
      scope: { kind: "app", rule: "repo-collaboration" },
    };
    await writeFile(join(home.stateHome, "approvals", "decided", `${item.id}.json`), JSON.stringify(item, null, 2));
    await writeFile(
      join(home.stateHome, "approvals", "grants", `${grant.grantId}.json`),
      JSON.stringify(grant, null, 2),
    );

    const decision = gate(covered);
    expect(decision.allow).toBe(false);
    expect((await approvals.listPending()).map((i) => i.rule)).toEqual(["repo-collaboration-foreign"]);
  });
});
