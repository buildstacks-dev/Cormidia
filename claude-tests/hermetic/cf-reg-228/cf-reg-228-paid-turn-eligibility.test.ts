// #228 — a clock wake-up is not paid-turn eligibility. These cases exercise
// the dispatcher boundary so the spawn/provider-construction seam itself is
// proven untouched for empty scheduled work.

import { afterEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dispatchTick } from "../../../src/org/dispatch.js";
import type { GitHubEventSource, GitHubIssueSummary } from "../../../src/org/events.js";
import { SchedulerEvidenceStore } from "../../../src/org/scheduler/evidence.js";
import { schedulerIdentity } from "../../../src/org/scheduler/model.js";
import { makeTestClock } from "../../fixtures/clock.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

const APP = "eligibility-app";
const NOW = "2026-08-03T12:41:00.000Z";

function source(openIssues: GitHubIssueSummary[] = []): GitHubEventSource {
  return {
    ticketReady: async () => [],
    prOpened: async () => [],
    ciFailed: async () => [],
    releaseShipped: async () => [],
    openIssues: async () => openIssues,
  };
}

function appsYaml(input: {
  channels?: "support" | "marketing";
  release?: boolean;
} = {}): string {
  return [
    "schema_version: 1",
    "org:",
    "  name: eligibility-org",
    "  max_concurrent_turns: 1",
    "defaults:",
    "  budget_usd_month: 1000",
    "apps:",
    `  ${APP}:`,
    "    repo: fixture/eligibility-app",
    "    status: live",
    "    cadence: {}",
    ...(input.channels === undefined
      ? []
      : ["    channels:", `      ${input.channels}: [fixture]`]),
    ...(input.release === true
      ? [
          "    release:",
          "      kind: deploy",
          "      owner: sre",
          "      trigger: command",
          "      command: ./deploy.sh",
        ]
      : []),
    "",
  ].join("\n");
}

function rolesYaml(role: "planner" | "sre" | "support" | "marketing"): string {
  return [
    "defaults:",
    "  max_turn_budget_usd: 5",
    "roles:",
    `  ${role}:`,
    "    runtime: claude",
    "    model: claude-scripted-model",
    "    effort: medium",
    "    delegation: {allow: []}",
    "    triggers:",
    "      - schedule: hourly",
    "    outputs: [notes]",
    "",
  ].join("\n");
}

class PaidTurnOnEmptyInputViolation extends Error {
  constructor(count: number) {
    super(`empty scheduled input constructed ${count} paid turn(s)`);
    this.name = "PaidTurnOnEmptyInputViolation";
  }
}

function assertNoPaidTurn(count: number): void {
  if (count !== 0) throw new PaidTurnOnEmptyInputViolation(count);
}

describe("CF-REG-228 — scheduled paid-turn eligibility", () => {
  let org: TempOrgHome | undefined;

  afterEach(async () => {
    await org?.cleanup();
    org = undefined;
  });

  async function configure(
    role: "planner" | "sre" | "support" | "marketing",
    app: Parameters<typeof appsYaml>[0] = {},
  ): Promise<void> {
    org = await makeTempOrgHome({ name: "eligibility-org" });
    await writeFile(join(org.orgHome, "apps.yaml"), appsYaml(app), "utf8");
    await writeFile(join(org.orgHome, "roles.yaml"), rolesYaml(role), "utf8");
  }

  function evidence(): SchedulerEvidenceStore {
    return new SchedulerEvidenceStore({
      stateHome: org!.stateHome,
      orgName: "eligibility-org",
      orgHome: org!.orgHome,
      schedulerId: schedulerIdentity("eligibility-org", org!.orgHome),
    });
  }

  it("no-ops an hourly SRE turn with missing operational configuration before construction", async () => {
    await configure("sre");
    let providerConstructions = 0;
    const tick = await dispatchTick({
      orgRoot: org!.orgHome,
      runtimeHome: org!.stateHome,
      now: () => new Date(NOW),
      eventSource: source(),
      spawn: async () => { providerConstructions += 1; },
    });

    expect(tick.errors).toEqual([]);
    expect(tick.spawned).toEqual([]);
    expect(providerConstructions).toBe(0);
    const decision = (await evidence().listDecisions()).find((item) => item.role === "sre");
    expect(decision).toMatchObject({
      outcome: "skipped",
      reason_code: "no_actionable_input",
      provider_turns: 0,
      provider_settlements: 0,
    });
    expect(decision?.detail).toContain('"configuration":"missing"');
    expect(decision?.detail).toContain("app.release");
  });

  it("admits exactly one SRE turn when a declared deploy surface makes the window actionable", async () => {
    await configure("sre", { release: true });
    let providerConstructions = 0;
    const tick = await dispatchTick({
      orgRoot: org!.orgHome,
      runtimeHome: org!.stateHome,
      now: () => new Date(NOW),
      eventSource: source(),
      spawn: async () => { providerConstructions += 1; },
    });

    expect(tick.errors).toEqual([]);
    expect(tick.spawned).toHaveLength(1);
    expect(providerConstructions).toBe(1);
  });

  it("does not mistake an already-active issue for untriaged Planner work", async () => {
    await configure("planner");
    let providerConstructions = 0;
    const tick = await dispatchTick({
      orgRoot: org!.orgHome,
      runtimeHome: org!.stateHome,
      now: () => new Date(NOW),
      eventSource: source([{ number: 228, title: "already building", labels: ["op:building"] }]),
      spawn: async () => { providerConstructions += 1; },
    });

    expect(tick.errors).toEqual([]);
    expect(tick.spawned).toEqual([]);
    expect(providerConstructions).toBe(0);
    expect((await evidence().listDecisions()).find((item) => item.role === "planner"))
      .toMatchObject({ outcome: "skipped", reason_code: "no_actionable_input" });
  });

  for (const role of ["support", "marketing"] as const) {
    it(`no-ops ${role} when its declared channel is configured but its backlog is empty`, async () => {
      await configure(role, { channels: role });
      const clock = makeTestClock(NOW);
      let providerConstructions = 0;
      const run = () => dispatchTick({
        orgRoot: org!.orgHome,
        runtimeHome: org!.stateHome,
        now: clock.nowDate,
        eventSource: source(),
        spawn: async () => { providerConstructions += 1; },
      });

      const first = await run();
      clock.advance(5 * 60_000);
      const second = await run();

      expect(first.errors).toEqual([]);
      expect(second.errors).toEqual([]);
      expect(providerConstructions).toBe(0);
      const decisions = (await evidence().listDecisions()).filter((item) => item.role === role);
      expect(decisions).toHaveLength(2);
      expect(decisions.every((item) =>
        item.reason_code === "no_actionable_input"
        && item.provider_turns === 0
        && item.provider_settlements === 0
        && item.detail?.includes('"configuration":"declared"') === true
      )).toBe(true);
      expect(await evidence().listAlerts()).toEqual([]);
    });
  }

  it("negative control: the empty-input detector fires for a forged paid construction", () => {
    expect(() => assertNoPaidTurn(1)).toThrow(PaidTurnOnEmptyInputViolation);
  });
});
