// CF-J15-S + CF-INV-008 — snapshot truth and no green-by-absence.

import { afterEach, describe, expect, it } from "vitest";
import { indexLocalSources } from "../../../src/observe/file-index.js";
import { projectObserveSnapshot } from "../../../src/observe/project.js";
import type { StatusRow } from "../../../src/runtime/runlog/status.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { J15_APP, J15_APPS, J15_NOW, seedJ15Run } from "./support.js";

function assertNoAdvancedLabelClaim(state: string, reason: string | null): void {
  if (state === "in_review" || reason === null) {
    throw new Error(`label outran artifact: state=${state} reason=${reason ?? "none"}`);
  }
}

describe("CF-J15-S / CF-INV-008 — evidence never outruns reality", () => {
  const states: TempStateHome[] = [];
  afterEach(async () => {
    for (const state of states.splice(0).reverse()) await state.cleanup();
  });

  it("names each source and preserves unknown usage, approval execution, label, and scheduler distinctions", async () => {
    const state = await makeTempStateHome({ name: "cf-j15-s" });
    states.push(state);
    await seedJ15Run(state);
    const local = await indexLocalSources({
      orgName: J15_APPS.org.name,
      stateHome: state.stateHome,
      appsFile: J15_APPS,
      filters: {},
      now: J15_NOW,
    });
    const unknown: StatusRow = {
      runId: "20260731-130000-review-review",
      app: J15_APP,
      ticket: "#15",
      traceId: "trace-cf-j15-unknown",
      pipeline: "review",
      pass: "review",
      role: "reviewer",
      runtime: "codex",
      model: "codex-scripted-model",
      status: "failed",
      durationMs: 10,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      costEstimated: false,
      usageQuality: "unavailable",
      escalations: 0,
      toolCalls: 0,
      startedAt: "2026-07-31T13:00:00.000Z",
      refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
    };
    local.passes.push({ row: unknown, events: [], artifacts: {} });
    local.source_health.push({
      id: "github",
      status: "unavailable",
      observed_at: J15_NOW.toISOString(),
      last_success_at: "2026-07-31T12:00:00.000Z",
      detail: "seeded GitHub outage; cached issue evidence is stale",
    });

    const snapshot = projectObserveSnapshot({
      ...local,
      cursor: "4",
      github: [{
        app: J15_APP,
        repo: J15_APPS.apps[0]!.repo,
        issues: [{
          number: 15,
          title: "Label without PR",
          body: "",
          labels: ["op:in-review"],
          state: "OPEN",
        }],
        pull_requests: [],
        observed_at: "2026-07-31T12:00:00.000Z",
        error: "seeded GitHub outage",
      }],
    });

    expect(snapshot.sources.map((source) => source.id).sort()).toEqual([
      "approvals", "github", "ledger", "local_files", "roadmap_delivery", "scheduler",
    ]);
    expect(snapshot.sources.find((source) => source.id === "roadmap_delivery")).toMatchObject({
      status: "unavailable",
      detail: expect.stringMatching(/No durable planning state/),
    });
    expect(snapshot.sources.find((source) => source.id === "scheduler")).toMatchObject({
      status: "unavailable",
      detail: expect.stringMatching(/not measured/i),
    });
    expect(snapshot.sources.find((source) => source.id === "github")).toMatchObject({
      status: "unavailable",
      last_success_at: "2026-07-31T12:00:00.000Z",
    });

    const ticket = snapshot.delivery[0]!;
    assertNoAdvancedLabelClaim(ticket.state, ticket.quality_reason);
    expect(ticket.state).toBe("closed_unknown");
    expect(ticket.quality_reason).toMatch(/no correlated open pull request/);

    const approval = snapshot.approvals.find((item) => item.approval_id === "appr-j15")!;
    expect(approval.status).toBe("granted");
    expect(approval.execution_state).toBeNull();

    expect(snapshot.totals.cost.known_cost_usd).toBe(1.25);
    expect(snapshot.totals.cost.unknown_turns).toBe(1);
    expect(snapshot.totals.cost.coverage).toBe("partial");
    expect(snapshot.totals.usage_quality).toBe("unavailable");
    expect(snapshot.attention).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "source_health", title: "github is unavailable" }),
    ]));
  });

  it("negative control: the label/artifact detector fires on a seeded in-review overclaim", () => {
    expect(() => assertNoAdvancedLabelClaim("in_review", null)).toThrow(/label outran artifact/);
  });
});
