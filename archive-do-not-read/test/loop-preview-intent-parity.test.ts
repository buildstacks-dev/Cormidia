// Regression for the onboarding loop preview/live boundary. Every fixture is
// local and deterministic: real git metadata, in-memory GitHub, temporary
// state, and an injected runtime factory that must remain untouched.

import {
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { baseRevisionForBranch } from "../src/loop/default-branch.js";
import {
  DEFAULT_LOOP_POLICY,
  runLoopOnce,
  type TicketEpisodePlanningRequest,
} from "../src/loop/driver.js";
import { persistEpisodeIntent } from "../src/org/episode-planner/coordinator.js";
import type { AppEntry } from "../src/org/apps.js";
import {
  createTicketEpisodeRuntime,
  inspectTicketEpisodeInvocation,
  type TicketEpisodeInspectionOptions,
} from "../src/org/ticket-episode-runtime.js";
import type {
  ContextBundle,
  RoleConfig,
  Runtime,
  TurnAssignment,
} from "../src/runtime/types.js";
import { makeBareWithClone } from "./fixtures/gitRepo.js";
import { makeOrgHome } from "./fixtures/orgHome.js";
import { FakeGhOps } from "./support/fakeGhOps.js";

const PLANNER_RESERVE_USD = 30;
const INITIAL_REMAINING_USD = 1_000;
const RESUMED_REMAINING_USD = 999.8;
const CONTEXT: ContextBundle = { taste: ["fixture authority"], memoryExcerpts: [] };

describe("loop dry-run immutable-intent parity", () => {
  it("keeps the original hard budget after Planner settlement and preserves the ordinary claim preview", async () => {
    const fixture = makeFixture();
    try {
      const initial = await inspectTicketEpisodeInvocation(
        fixture.inspection(INITIAL_REMAINING_USD),
        fixture.request,
      );
      expect(initial.intent.hardBudget).toMatchObject({
        maxEquivalentCostUsd: INITIAL_REMAINING_USD - PLANNER_RESERVE_USD,
        maxMechanicalOverheadUsd: INITIAL_REMAINING_USD - PLANNER_RESERVE_USD,
      });
      // This was the exact false mismatch: after two settled $0.10 Planner
      // attempts, rebuilding from the moving remainder yielded $969.80.
      expect(RESUMED_REMAINING_USD - PLANNER_RESERVE_USD).toBe(969.8);
      await persistEpisodeIntent(fixture.state.root, initial.intent);
      const before = snapshotTree(fixture.state.root);

      const result = await runLoopOnce({
        ...fixture.loopOptions,
        planOnly: true,
        ticketInspection: {
          root: fixture.state.root,
          inspect: async (request) => {
            const resumed = await inspectTicketEpisodeInvocation(
              fixture.inspection(RESUMED_REMAINING_USD),
              request,
            );
            expect(resumed.intent.hardBudget).toEqual(initial.intent.hardBudget);
          },
        },
      });

      expect(result.lines).toEqual([
        "#1 Establish stack and gates: ready -> claim",
      ]);
      expect(result.items).toEqual([]);
      expect((await fixture.gh.readIssue(1)).labels).toEqual(["op:ready", "p2"]);
      expect(snapshotTree(fixture.state.root)).toEqual(before);
    } finally {
      fixture.cleanup();
    }
  });

  it("reports the same known immutable-fact mismatch in preview and live before provider construction or writes", async () => {
    const fixture = makeFixture();
    try {
      const initial = await inspectTicketEpisodeInvocation(
        fixture.inspection(INITIAL_REMAINING_USD),
        fixture.request,
      );
      await persistEpisodeIntent(fixture.state.root, initial.intent);
      const before = snapshotTree(fixture.state.root);
      const changedTitle = "Establish a different stack and gates";
      fixture.gh.seedIssue({
        ...ticketSeed(),
        title: changedTitle,
      });

      const previewError = await thrown(runLoopOnce({
        ...fixture.loopOptions,
        planOnly: true,
        ticketInspection: {
          root: fixture.state.root,
          inspect: async (request) => {
            await inspectTicketEpisodeInvocation(
              fixture.inspection(RESUMED_REMAINING_USD),
              request,
            );
          },
        },
      }));

      const runtimeForAssignment = vi.fn((_assignment: TurnAssignment): Runtime => ({
        kind: "claude",
        async runTurn() {
          throw new Error("provider must not be constructed for an immutable-intent mismatch");
        },
      }));
      const live = createTicketEpisodeRuntime({
        ...fixture.inspection(RESUMED_REMAINING_USD),
        orgRoot: fixture.org.root,
        gh: fixture.gh,
        policy: DEFAULT_LOOP_POLICY,
        commands: {},
        hooks: { gate: () => ({ allow: true as const }) },
        runtimeForAssignment,
        plannerContext: CONTEXT,
      });
      const liveError = await thrown(live.planTicket({
        ...fixture.request,
        ticket: { ...fixture.request.ticket, title: changedTitle },
      }));

      expect(previewError.message).toBe(
        "episode ticket:preview-fixture:#1 resume facts differ from persisted immutable intent",
      );
      expect(liveError.message).toBe(previewError.message);
      expect(runtimeForAssignment).not.toHaveBeenCalled();
      expect((await fixture.gh.readIssue(1)).labels).toEqual(["op:ready", "p2"]);
      expect(snapshotTree(fixture.state.root)).toEqual(before);
    } finally {
      fixture.cleanup();
    }
  });
});

function makeFixture() {
  const state = makeOrgHome();
  const org = makeOrgHome();
  const repo = makeBareWithClone();
  const app: AppEntry = {
    name: "preview-fixture",
    repo: "fixture/preview",
    status: "onboarding",
    budgetUsdMonth: INITIAL_REMAINING_USD,
    cadence: {},
    execution: { assignmentMode: "fixed", allowedAssignments: {} },
  };
  const roles = fixtureRoles();
  const issue = ticketSeed();
  const gh = new FakeGhOps({
    repo: app.repo,
    cloneRoot: repo.clone.root,
    issues: [issue],
  });
  const request: TicketEpisodePlanningRequest = {
    root: state.root,
    episodeId: "ticket:preview-fixture:#1",
    app: app.name,
    targetRepo: app.repo,
    localRepo: repo.clone.root,
    base: baseRevisionForBranch("main"),
    ticket: {
      issueNumber: issue.number,
      ticketRef: "#1",
      title: issue.title,
      body: issue.body,
      labels: [...issue.labels],
    },
  };
  const inspection = (remainingBudgetUsd: number): TicketEpisodeInspectionOptions => ({
    root: state.root,
    app,
    roles,
    remainingBudgetUsd,
  });
  return {
    state,
    org,
    repo,
    app,
    roles,
    gh,
    request,
    inspection,
    loopOptions: {
      app: app.name,
      repo: app.repo,
      gh,
      localRepo: repo.clone.root,
      worktreeRoot: join(state.root, "worktrees"),
      policy: DEFAULT_LOOP_POLICY,
      commands: {},
      maxConcurrent: 1,
      base: baseRevisionForBranch("main"),
    },
    cleanup() {
      state.cleanup();
      org.cleanup();
      repo.cleanup();
    },
  };
}

function fixtureRoles(): RoleConfig[] {
  return [
    role("planner", { harness: "claude", model: "planner-fixture", effort: "high" }, 15),
    role("builder", { harness: "codex", model: "builder-fixture", effort: "high" }, 20),
    role("reviewer", { harness: "claude", model: "reviewer-fixture", effort: "high" }, 20),
  ];
}

function role(
  name: string,
  assignment: TurnAssignment,
  maxTurnBudgetUsd: number,
): RoleConfig {
  return {
    name,
    runtime: assignment.harness,
    model: assignment.model,
    effort: assignment.effort,
    delegation: { allow: [] },
    triggers: [],
    outputs: ["evidence"],
    maxTurnBudgetUsd,
  };
}

function ticketSeed() {
  return {
    number: 1,
    title: "Establish stack and gates",
    body: [
      "## Goal",
      "Select the implementation stack and establish meaningful gates.",
      "",
      "## Acceptance criteria",
      "- [ ] AC1: a real manifest and named behavior test exist",
      "- [ ] AC2: setup, test, and lint commands are non-vacuous",
      "",
    ].join("\n"),
    labels: ["op:ready", "p2"],
  };
}

async function thrown(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(String(error));
  }
  throw new Error("expected promise to reject");
}

function snapshotTree(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const walk = (dir: string, relativeDir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const relativePath = relativeDir === "" ? name : `${relativeDir}/${name}`;
      const stat = lstatSync(path);
      if (stat.isDirectory()) {
        snapshot[`${relativePath}/`] = "directory";
        walk(path, relativePath);
      } else if (stat.isSymbolicLink()) {
        snapshot[relativePath] = `symlink:${readlinkSync(path)}`;
      } else {
        snapshot[relativePath] = `file:${readFileSync(path).toString("base64")}`;
      }
    }
  };
  walk(root, "");
  return snapshot;
}
