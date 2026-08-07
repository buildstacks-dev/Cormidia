import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { GhIssue, GhOps } from "../../../src/loop/github.js";
import type { PublishedTicket, TicketPlan } from "../../../src/loop/plan-tickets.js";
import type { AppEntry } from "../../../src/org/apps.js";
import { persistPublishedRoadmap } from "../../../src/org/plan-auto.js";
import { readCurrentRoadmapPlan } from "../../../src/org/roadmap-delivery/roadmap-plan.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const homes: TempStateHome[] = [];
afterEach(async () => Promise.all(homes.splice(0).map((home) => home.cleanup())));

describe("HB-103/104/105 production wiring detector", () => {
  it("pins both live entry points and turns red when one authority seam is removed", async () => {
    const sources = {
      cli: await readFile("src/cli/loop.ts", "utf8"),
      dispatch: await readFile("src/org/turn-runner.ts", "utf8"),
      factory: await readFile("src/org/ticket-episode-runtime.ts", "utf8"),
      driver: await readFile("src/loop/driver.ts", "utf8"),
    };
    expect(() => assertProductionWiring(sources)).not.toThrow();

    // Seeded negative control: a green domain-only implementation is not
    // enough if autonomous dispatch drops the delivery-unit runtime.
    expect(() =>
      assertProductionWiring({
        ...sources,
        dispatch: sources.dispatch.replace("deliveryUnits: ticketEpisode.deliveryUnits", ""),
      }),
    ).toThrow("dispatch");
    expect(() =>
      assertProductionWiring({
        ...sources,
        factory: sources.factory.replace("workflowTemplates: ticketWorkflowTemplates(options)", ""),
      }),
    ).toThrow("factory");
  });

  it("projects Planner execution groups into real multi-ticket RoadmapPlan authority", async () => {
    const home = await makeTempStateHome({ name: "hb105-production-roadmap" });
    homes.push(home);
    const published: PublishedTicket[] = [
      { index: 0, issueNumber: 501, title: "First", ready: true, labels: ["op:ready"] },
      { index: 1, issueNumber: 502, title: "Second", ready: true, labels: ["op:ready"] },
      { index: 2, issueNumber: 503, title: "Follow-up", ready: false, labels: [] },
    ];
    const issues = published.map((entry) => issue(entry.issueNumber, entry.title, entry.labels));
    const plan: TicketPlan = {
      stage: "growth",
      ticketCountRationale: "Two cohesive members and one dependent follow-up.",
      releaseDisposition: "merge-only",
      releaseKind: "merge-only",
      tickets: [
        planTicket("First", "cohesive", []),
        planTicket("Second", "cohesive", []),
        planTicket("Follow-up", "later", [0, 1]),
      ],
    };

    await persistPublishedRoadmap({
      stateHome: home.stateHome,
      app: APP,
      gh: { listIssues: async () => structuredClone(issues) } as unknown as GhOps,
      plan,
      published,
      now: new Date("2026-08-03T23:30:00.000Z"),
    });

    const roadmap = await readCurrentRoadmapPlan(home.stateHome, APP.name);
    expect(roadmap?.value.deliveryUnits.map((unit) => unit.issueNumbers)).toEqual([[501, 502], [503]]);
    expect(roadmap?.value.readyFrontier).toHaveLength(1);
    expect(
      roadmap?.value.deliveryUnits.find((unit) => unit.unitId === roadmap.value.readyFrontier[0])?.issueNumbers,
    ).toEqual([501, 502]);

    // Exact replay is a no-op; a later Planner publication advances one
    // predecessor-bound version while preserving every prior open member.
    await persistPublishedRoadmap({
      stateHome: home.stateHome,
      app: APP,
      gh: { listIssues: async () => structuredClone(issues) } as unknown as GhOps,
      plan,
      published,
      now: new Date("2026-08-03T23:31:00.000Z"),
    });
    expect((await readCurrentRoadmapPlan(home.stateHome, APP.name))?.value.version).toBe(1);

    // Seeded negative control: a two-member unit with only one member still
    // open is not normalized into a smaller authority during replanning.
    await expect(
      persistPublishedRoadmap({
        stateHome: home.stateHome,
        app: APP,
        gh: {
          listIssues: async () => structuredClone(issues.filter((entry) => entry.number !== 502)),
        } as unknown as GhOps,
        plan,
        published,
        now: new Date("2026-08-03T23:31:30.000Z"),
      }),
    ).rejects.toThrow("subset closure");
    expect((await readCurrentRoadmapPlan(home.stateHome, APP.name))?.value.version).toBe(1);

    const successorPublished: PublishedTicket[] = [
      { index: 0, issueNumber: 601, title: "Successor A", ready: true, labels: ["op:ready"] },
      { index: 1, issueNumber: 602, title: "Successor B", ready: true, labels: ["op:ready"] },
    ];
    const successorPlan: TicketPlan = {
      ...plan,
      ticketCountRationale: "One new cohesive successor unit.",
      tickets: [planTicket("Successor A", "successor", []), planTicket("Successor B", "successor", [])],
    };
    const successorIssues = [
      ...issues,
      ...successorPublished.map((entry) => issue(entry.issueNumber, entry.title, entry.labels)),
    ];
    await persistPublishedRoadmap({
      stateHome: home.stateHome,
      app: APP,
      gh: { listIssues: async () => structuredClone(successorIssues) } as unknown as GhOps,
      plan: successorPlan,
      published: successorPublished,
      now: new Date("2026-08-03T23:32:00.000Z"),
    });
    const successor = await readCurrentRoadmapPlan(home.stateHome, APP.name);
    expect(successor?.value.version).toBe(2);
    expect(successor?.value.predecessor).toEqual(roadmap?.ref);
    expect(successor?.value.deliveryUnits.flatMap((unit) => unit.issueNumbers).sort((a, b) => a - b)).toEqual([
      501, 502, 503, 601, 602,
    ]);
    expect(successor?.value.deliveryUnits.find((unit) => unit.issueNumbers.includes(601))?.issueNumbers).toEqual([
      601, 602,
    ]);
  });

  it("moves a previously unplanned backlog member into the next scheduled Planner unit", async () => {
    const home = await makeTempStateHome({ name: "hb105-scheduled-replan" });
    homes.push(home);
    const issues = [issue(701, "Already planned", ["op:ready"]), issue(702, "Awaiting Planner", ["op:ready"])];
    await persistPublishedRoadmap({
      stateHome: home.stateHome,
      app: APP,
      gh: { listIssues: async () => structuredClone(issues) } as unknown as GhOps,
      plan: {
        stage: "growth",
        ticketCountRationale: "Initial partial projection.",
        releaseDisposition: "merge-only",
        releaseKind: "merge-only",
        tickets: [planTicket("Already planned", "initial", [])],
      },
      published: [{ index: 0, issueNumber: 701, title: "Already planned", ready: true, labels: ["op:ready"] }],
      now: new Date("2026-08-04T00:00:00.000Z"),
    });
    expect(
      (await readCurrentRoadmapPlan(home.stateHome, APP.name))?.value.deliveryUnits.find((unit) =>
        unit.issueNumbers.includes(702),
      )?.workstreamId,
    ).toBe("backlog-unplanned");

    await persistPublishedRoadmap({
      stateHome: home.stateHome,
      app: APP,
      gh: { listIssues: async () => structuredClone(issues) } as unknown as GhOps,
      plan: {
        stage: "growth",
        ticketCountRationale: "Scheduled Planner assigned the remaining issue.",
        releaseDisposition: "merge-only",
        releaseKind: "merge-only",
        tickets: [planTicket("Awaiting Planner", "scheduled", [])],
      },
      published: [{ index: 0, issueNumber: 702, title: "Awaiting Planner", ready: true, labels: ["op:ready"] }],
      now: new Date("2026-08-04T00:01:00.000Z"),
      issues,
      readyIssueNumbers: [702],
      source: "fixture:scheduled-planner",
    });

    const revised = await readCurrentRoadmapPlan(home.stateHome, APP.name);
    const moved = revised?.value.deliveryUnits.find((unit) => unit.issueNumbers.includes(702));
    expect(moved?.workstreamId).not.toBe("backlog-unplanned");
    expect(moved?.unitId).toBe("unplanned-702");
  });
});

const APP: AppEntry = {
  name: "hb105-app",
  repo: "fixture/hb105",
  status: "live",
  budgetUsdMonth: 100,
  objectiveBudgetUsd: 1000,
  cadence: {},
  execution: { assignmentMode: "fixed", allowedAssignments: {} },
};

function planTicket(title: string, executionGroup: string, dependsOn: number[]): TicketPlan["tickets"][number] {
  return {
    title,
    tier: "op:tier-standard",
    priority: "p2",
    dependsOn,
    executionGroup,
    fileScope: ["src/example.ts"],
    goal: `Deliver ${title}`,
    context: "HB-105 production wiring fixture.",
    acceptanceCriteria: [`${title} is delivered`],
    outOfScope: "external effects",
    notesForBuilder: "Use the accepted delivery unit.",
  };
}

function issue(number: number, title: string, labels: string[]): GhIssue {
  return {
    number,
    title,
    body: `## Goal\n${title}\n\nDepends-on: none`,
    labels,
    state: "OPEN",
  };
}

function assertProductionWiring(sources: Record<string, string>): void {
  const required: Array<[string, string]> = [
    ["cli", "deliveryUnits"],
    ["dispatch", "deliveryUnits: ticketEpisode.deliveryUnits"],
    ["factory", "createRoadmapLoopRuntime"],
    ["factory", "workflowTemplates: ticketWorkflowTemplates(options)"],
    ["driver", "claimDeliveryUnitIssues"],
    ["driver", "bindAcceptedPlan"],
    ["driver", "deliveryLifecycle"],
  ];
  for (const [file, needle] of required) {
    if (!sources[file]?.includes(needle)) {
      throw new Error(`${file} is missing production authority seam ${needle}`);
    }
  }
}
