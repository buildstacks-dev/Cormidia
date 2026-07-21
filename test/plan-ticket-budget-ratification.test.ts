// Tests the ticket-budget ratification verb and its two durable halves
// (ENH-011): the preserved refused decomposition under
// planning/<app>/refused-decompositions/, and the attributable human decision
// under lifecycle/apps/<app>/ticket-budget-ratifications/.
//
// Everything here is offline: temp state homes, FakeGhOps, and a fixed clock.
// No provider, network, auth, or real GitHub state is touched — ratification
// republishes work the planner was already paid for and must never spend a
// provider turn to do it.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cmdPlanRatifyTicketBudget, parsePlanRatifyArgs, type PlanRatifyIo } from "../src/cli/plan-ratify.js";
import type { OperonHomes } from "../src/org/home.js";
import { ticketPlanDigest, type PlanTicket, type TicketPlan } from "../src/loop/plan-tickets.js";
import {
  executeTicketBudgetRatification,
  listRefusedDecompositions,
  planTicketBudgetRatification,
  ratifyTicketBudgetCommand,
  readRefusedDecomposition,
  readTicketBudgetRatification,
  recordRefusedDecomposition,
  refusedDecompositionPath,
  ticketBudgetRatificationPath,
} from "../src/org/ticket-budget-ratification.js";
import { FakeGhOps } from "./support/fakeGhOps.js";

const NOW = new Date("2026-07-21T09:30:00.000Z");

function ticket(overrides: Partial<PlanTicket> = {}): PlanTicket {
  return {
    title: "Ship the landing page",
    tier: "op:tier-standard",
    priority: "p1",
    dependsOn: [],
    executionGroup: "g1",
    fileScope: ["src/**"],
    goal: "A deployable page with real content.",
    context: "Greenfield repository.",
    acceptanceCriteria: ["pnpm test exits 0"],
    outOfScope: "Analytics.",
    notesForBuilder: "Keep dependencies boring.",
    ...overrides,
  };
}

function oversizedPlan(count = 8): TicketPlan {
  return {
    stage: "bootstrap",
    ticketCountRationale: "Nine design-spec steps collapse into eight shippable slices.",
    releaseDisposition: "Deploys through the configured CI handoff after merge.",
    releaseKind: "deploy",
    tickets: Array.from({ length: count }, (_unused, index) =>
      ticket({ title: `Step ${index + 1}` })),
  };
}

describe("ticket-budget ratification (ENH-011)", () => {
  let root = "";

  afterEach(() => {
    if (root !== "") rmSync(root, { recursive: true, force: true });
    root = "";
  });

  function homesFor(stateHome: string): OperonHomes {
    return {
      packageRoot: stateHome,
      orgHome: stateHome,
      stateHome,
      pointerPath: join(stateHome, "pointer"),
      appsFile: {
        org: { name: "fixture", maxConcurrentTurns: 1 },
        defaults: { budgetUsdMonth: 10 },
        apps: [{
          name: "site",
          repo: "owner/site",
          status: "onboarding",
          budgetUsdMonth: 10,
          cadence: {},
        }],
      },
    };
  }

  async function seedRefusal(plan: TicketPlan = oversizedPlan()) {
    root = mkdtempSync(join(tmpdir(), "operon-ratify-"));
    const record = await recordRefusedDecomposition({
      stateHome: root,
      app: "site",
      goal: "The complete site, design spec sections 1-9",
      stage: "bootstrap",
      plan,
      problems: ["8 tickets exceed the bootstrap budget of 3"],
      provenance: {
        episode_id: "trace:site:product-plan:1",
        run_id: "run-1",
        trace_id: "plan-site-abc",
      },
      now: NOW,
    });
    return { record, homes: homesFor(root) };
  }

  function io(lines: string[], interactive = false): PlanRatifyIo {
    return {
      interactive,
      ask: async () => "",
      out: (line) => lines.push(line),
    };
  }

  function args(overrides: Record<string, string | undefined> = {}): string[] {
    const base: Record<string, string | undefined> = {
      "--app": "site",
      "--decomposition": undefined,
      "--actor": "operator@example.com",
      "--reason": "reviewed the 8-ticket decomposition and accept it",
      "--from-budget": "3",
      "--to-budget": "8",
      ...overrides,
    };
    return Object.entries(base).flatMap(([flag, value]) =>
      value === undefined ? [] : [flag, value]);
  }

  it("preserves a budget-only refusal verbatim, keyed by its own content digest", async () => {
    const plan = oversizedPlan();
    const { record } = await seedRefusal(plan);

    expect(record.decomposition_id).toBe(ticketPlanDigest(plan));
    expect(record.ticket_count).toBe(8);
    expect(record.stage_ticket_budget).toBe(3);
    expect(existsSync(refusedDecompositionPath(root, "site", record.decomposition_id))).toBe(true);
    const read = await readRefusedDecomposition(root, "site", record.decomposition_id);
    expect(read?.plan).toEqual(plan);
    expect((await listRefusedDecompositions(root, "site")).map((r) => r.decomposition_id))
      .toEqual([record.decomposition_id]);
  });

  it("refuses to preserve a decomposition that a bigger budget would not fix", async () => {
    root = mkdtempSync(join(tmpdir(), "operon-ratify-"));
    const broken = oversizedPlan();
    broken.tickets[0] = ticket({ acceptanceCriteria: ["works"] });
    await expect(recordRefusedDecomposition({
      stateHome: root,
      app: "site",
      goal: "goal",
      stage: "bootstrap",
      plan: broken,
      problems: [],
      provenance: { episode_id: "e", run_id: "r", trace_id: "t" },
      now: NOW,
    })).rejects.toThrow(/sole refusal is the stage ticket budget/);
  });

  it("replaying the same refusal keeps the original refused_at (retention ages by it)", async () => {
    const plan = oversizedPlan();
    const { record } = await seedRefusal(plan);
    const replay = await recordRefusedDecomposition({
      stateHome: root,
      app: "site",
      goal: "The complete site, design spec sections 1-9",
      stage: "bootstrap",
      plan,
      problems: [],
      provenance: { episode_id: "trace:site:product-plan:1", run_id: "run-1", trace_id: "plan-site-abc" },
      now: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(replay.refused_at).toBe(record.refused_at);
  });

  it("previews without writing anything and prints the exact confirmation token", async () => {
    const { record, homes } = await seedRefusal();
    const lines: string[] = [];
    const gh = new FakeGhOps({ repo: "owner/site" });

    const code = await cmdPlanRatifyTicketBudget(
      args({ "--decomposition": record.decomposition_id }),
      homes,
      io(lines),
      { ghFor: () => gh },
    );

    expect(code).toBe(0);
    expect(lines[0]).toContain(`PREVIEW site@${record.decomposition_id}`);
    expect(lines[0]).toContain("bootstrap ticket budget 3->8");
    expect(lines.some((line) => line.includes("Step 1"))).toBe(true);
    expect(lines.at(-1)).toContain(`--execute --confirm site@${record.decomposition_id}`);
    expect(existsSync(ticketBudgetRatificationPath(root, "site", record.decomposition_id))).toBe(false);
    expect(await gh.listIssues({ state: "all", limit: 50 })).toHaveLength(0);
  });

  it("executes: records who/when/what and publishes exactly the preserved tickets, token-free", async () => {
    const { record, homes } = await seedRefusal();
    const lines: string[] = [];
    const gh = new FakeGhOps({ repo: "owner/site" });

    const code = await cmdPlanRatifyTicketBudget(
      [
        ...args({ "--decomposition": record.decomposition_id }),
        "--execute",
        "--confirm",
        `site@${record.decomposition_id}`,
      ],
      homes,
      io(lines),
      { ghFor: () => gh },
    );

    expect(code).toBe(0);
    const written = await readTicketBudgetRatification(root, "site", record.decomposition_id);
    expect(written).toMatchObject({
      kind: "ticket-budget-ratification",
      phase: "complete",
      app: "site",
      stage: "bootstrap",
      stage_ticket_budget: 3,
      ratified_ticket_count: 8,
      actor: "operator@example.com",
      reason: "reviewed the 8-ticket decomposition and accept it",
    });
    expect(Number.isNaN(Date.parse(written!.ratified_at))).toBe(false);
    // Self-contained evidence: the accepted plan travels with the decision.
    expect(written?.plan.tickets).toHaveLength(8);
    expect(written?.publication.status).toBe("published");
    const issues = await gh.listIssues({ state: "all", limit: 50 });
    expect(issues).toHaveLength(8);
    expect(lines.some((line) => line.includes("Published 8 ticket(s)"))).toBe(true);
    // No provider turn: ratification republishes already-paid-for work. The
    // only run-directory write is the local half of the provenance edge.
    expect(existsSync(join(root, "telemetry"))).toBe(false);
    expect(existsSync(join(root, "runs", "site", "run-1", "envelope.json"))).toBe(false);
    expect(existsSync(join(root, "runs", "site", "run-1", "published-tickets.json"))).toBe(true);
  });

  it("is idempotent: a second execute reports the prior decision and creates no duplicate issues", async () => {
    const { record, homes } = await seedRefusal();
    const gh = new FakeGhOps({ repo: "owner/site" });
    const execArgs = [
      ...args({ "--decomposition": record.decomposition_id }),
      "--execute",
      "--confirm",
      `site@${record.decomposition_id}`,
    ];
    await cmdPlanRatifyTicketBudget(execArgs, homes, io([]), { ghFor: () => gh });
    const lines: string[] = [];
    await cmdPlanRatifyTicketBudget(execArgs, homes, io(lines), { ghFor: () => gh });
    expect(lines[0]).toContain("Already ratified");
    expect(await gh.listIssues({ state: "all", limit: 50 })).toHaveLength(8);
  });

  // Adversarial near-miss: every guard that keeps this from becoming a silent
  // bypass. Each of these is a way an operator (or an agent) could try to turn
  // the verb into "skip the check".
  it("refuses without an exact confirmation, an actor, a reason, or a fresh from-budget", async () => {
    const { record, homes } = await seedRefusal();
    const gh = new FakeGhOps({ repo: "owner/site" });
    const decomposition = record.decomposition_id;

    await expect(cmdPlanRatifyTicketBudget(
      [...args({ "--decomposition": decomposition }), "--execute"],
      homes,
      io([]),
      { ghFor: () => gh },
    )).rejects.toThrow(/--confirm must exactly match/);

    await expect(cmdPlanRatifyTicketBudget(
      [...args({ "--decomposition": decomposition }), "--execute", "--confirm", "site"],
      homes,
      io([]),
      { ghFor: () => gh },
    )).rejects.toThrow(/--confirm must exactly match/);

    await expect(cmdPlanRatifyTicketBudget(
      args({ "--decomposition": decomposition, "--actor": undefined }),
      homes,
      io([]),
      { ghFor: () => gh },
    )).rejects.toThrow(/--actor is required/);

    await expect(cmdPlanRatifyTicketBudget(
      args({ "--decomposition": decomposition, "--reason": undefined }),
      homes,
      io([]),
      { ghFor: () => gh },
    )).rejects.toThrow(/--reason is required/);

    await expect(cmdPlanRatifyTicketBudget(
      args({ "--decomposition": decomposition, "--from-budget": "7" }),
      homes,
      io([]),
      { ghFor: () => gh },
    )).rejects.toThrow(/stale --from-budget 7/);

    // The point of the fix: a number nobody read cannot be ratified.
    await expect(cmdPlanRatifyTicketBudget(
      args({ "--decomposition": decomposition, "--to-budget": "40" }),
      homes,
      io([]),
      { ghFor: () => gh },
    )).rejects.toThrow(/--to-budget must be exactly 8/);

    expect(await gh.listIssues({ state: "all", limit: 50 })).toHaveLength(0);
    expect(existsSync(ticketBudgetRatificationPath(root, "site", decomposition))).toBe(false);
  });

  it("refuses a decomposition it never preserved — ratification never invents a plan", async () => {
    const { homes } = await seedRefusal();
    await expect(cmdPlanRatifyTicketBudget(
      args({ "--decomposition": "0000000000000000000000ff" }),
      homes,
      io([]),
      { ghFor: () => new FakeGhOps({ repo: "owner/site" }) },
    )).rejects.toThrow(/no refused decomposition 0000000000000000000000ff/);
  });

  it("refuses a hand-edited record whose plan no longer matches its ratified digest", async () => {
    const { record, homes } = await seedRefusal();
    const path = refusedDecompositionPath(root, "site", record.decomposition_id);
    const tampered = JSON.parse(await readFile(path, "utf8")) as { plan: TicketPlan };
    tampered.plan.tickets.push(ticket({ title: "Smuggled ninth ticket" }));
    await writeFile(path, JSON.stringify(tampered, null, 2));

    await expect(planTicketBudgetRatification({
      stateHome: root,
      app: "site",
      decompositionId: record.decomposition_id,
      actor: "operator@example.com",
      reason: "why",
      fromBudget: 3,
      toBudget: 8,
    })).rejects.toThrow(/does not match its own decomposition digest/);
    expect(homes.stateHome).toBe(root);
  });

  it("--no-publish records the decision without touching GitHub", async () => {
    const { record, homes } = await seedRefusal();
    const gh = new FakeGhOps({ repo: "owner/site" });
    await cmdPlanRatifyTicketBudget(
      [
        ...args({ "--decomposition": record.decomposition_id }),
        "--no-publish",
        "--execute",
        "--confirm",
        `site@${record.decomposition_id}`,
      ],
      homes,
      io([]),
      { ghFor: () => gh },
    );
    expect(await gh.listIssues({ state: "all", limit: 50 })).toHaveLength(0);
    const written = await readTicketBudgetRatification(root, "site", record.decomposition_id);
    expect(written?.publication).toEqual({ status: "skipped", published: [] });
  });

  it("keeps the ratification out of the way of the ordinary budget for the next plan", async () => {
    const { record, homes } = await seedRefusal();
    const gh = new FakeGhOps({ repo: "owner/site" });
    await cmdPlanRatifyTicketBudget(
      [
        ...args({ "--decomposition": record.decomposition_id }),
        "--execute",
        "--confirm",
        `site@${record.decomposition_id}`,
      ],
      homes,
      io([]),
      { ghFor: () => gh },
    );
    // A SECOND, different 8-ticket decomposition for the same app and stage
    // is a different digest, so the prior decision cannot admit it.
    const next = oversizedPlan();
    next.tickets[0] = ticket({ title: "A different first slice" });
    const second = await recordRefusedDecomposition({
      stateHome: root,
      app: "site",
      goal: "The complete site, design spec sections 1-9",
      stage: "bootstrap",
      plan: next,
      problems: [],
      provenance: { episode_id: "trace:site:product-plan:2", run_id: "run-2", trace_id: "plan-site-def" },
      now: NOW,
    });
    expect(second.decomposition_id).not.toBe(record.decomposition_id);
    expect(await readTicketBudgetRatification(root, "site", second.decomposition_id)).toBeUndefined();
  });

  it("names a pasteable command and rejects unknown flags", () => {
    expect(ratifyTicketBudgetCommand({
      app: "site",
      decompositionId: "abc123",
      stageBudget: 3,
      ticketCount: 8,
    })).toContain("operon plan ratify-ticket-budget --app site --decomposition abc123");
    expect(() => parsePlanRatifyArgs(["--app", "site", "--skip-budget"]))
      .toThrow(/unknown flag "--skip-budget"/);
    expect(() => parsePlanRatifyArgs(["--app", "site"]))
      .toThrow(/--decomposition <id> is required/);
  });

  it("emits a single machine-readable preview document under --json", async () => {
    const { record, homes } = await seedRefusal();
    const log: string[] = [];
    const spy = console.log;
    console.log = (line: string) => log.push(line);
    try {
      await cmdPlanRatifyTicketBudget(
        [...args({ "--decomposition": record.decomposition_id }), "--json"],
        homes,
        io([]),
        { ghFor: () => new FakeGhOps({ repo: "owner/site" }) },
      );
    } finally {
      console.log = spy;
    }
    const parsed = JSON.parse(log.join("\n")) as Record<string, unknown>;
    expect(parsed["kind"]).toBe("plan-ticket-budget-ratification-preview");
    expect(parsed["stage_ticket_budget"]).toBe(3);
    expect(parsed["ratified_ticket_count"]).toBe(8);
    expect(parsed["confirmation"]).toBe(`site@${record.decomposition_id}`);
    expect(parsed["actor"]).toBe("operator@example.com");
  });

  it("executeTicketBudgetRatification refuses to publish without a GitHub client", async () => {
    const { record } = await seedRefusal();
    await expect(executeTicketBudgetRatification({
      stateHome: root,
      app: "site",
      decompositionId: record.decomposition_id,
      actor: "operator@example.com",
      reason: "reviewed",
      fromBudget: 3,
      toBudget: 8,
      now: NOW,
    })).rejects.toThrow(/requires a GitHub operations client/);
  });
});
