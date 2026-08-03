// #209 — scheduler health describes scheduler execution, not ordinary
// backpressure, and a spawned provider decision is pending until its durable
// receipt makes settlement denominators measurable.

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dispatchTick } from "../../../src/org/dispatch.js";
import type { GitHubEventSource } from "../../../src/org/events.js";
import { writeJournalPatch } from "../../../src/org/journal.js";
import { acquireLock } from "../../../src/org/locks.js";
import { SchedulerEvidenceStore } from "../../../src/org/scheduler/evidence.js";
import { schedulerIdentity } from "../../../src/org/scheduler/model.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

const NOW = new Date("2026-08-03T12:41:00.000Z");
const SOURCE: GitHubEventSource = {
  ticketReady: async () => [],
  prOpened: async () => [],
  ciFailed: async () => [],
  releaseShipped: async () => [],
  openIssues: async () => [{ number: 209, title: "untriaged fixture", labels: [] }],
};

class BackpressureMisclassified extends Error {}

class UnresolvedDecisionAlert extends Error {}

function assertBackpressure(value: string | undefined): void {
  if (value !== "blocked_backpressure") throw new BackpressureMisclassified();
}

function assertDecisionAlertResolved(value: { resolved: boolean }): void {
  if (!value.resolved) throw new UnresolvedDecisionAlert();
}

describe("CF-REG-209 — scheduler health truth", () => {
  let org: TempOrgHome | undefined;
  afterEach(async () => {
    await org?.cleanup();
    org = undefined;
  });

  async function configure(appNames: string[] = ["app-a", "app-b"]): Promise<void> {
    org = await makeTempOrgHome({ name: "health-org" });
    await writeFile(join(org.orgHome, "apps.yaml"), [
      "schema_version: 1",
      "org:",
      "  name: health-org",
      "  max_concurrent_turns: 1",
      "defaults:",
      "  budget_usd_month: 1000",
      "apps:",
      ...appNames.flatMap((app) => [
        `  ${app}:`,
        `    repo: fixture/${app}`,
        "    status: live",
        "    cadence: {}",
        "    release:",
        "      kind: deploy",
        "      owner: sre",
        "      trigger: command",
        "      command: ./deploy.sh",
      ]),
      "",
    ].join("\n"), "utf8");
    await writeFile(join(org.orgHome, "roles.yaml"), [
      "defaults:",
      "  max_turn_budget_usd: 5",
      "roles:",
      ...["sre"].flatMap((role) => [
        `  ${role}:`,
        "    runtime: claude",
        "    model: claude-scripted-model",
        "    effort: medium",
        "    delegation: {allow: []}",
        "    triggers:",
        "      - schedule: hourly",
        "    outputs: [notes]",
      ]),
      "",
    ].join("\n"), "utf8");
  }

  function evidence(): SchedulerEvidenceStore {
    return new SchedulerEvidenceStore({
      stateHome: org!.stateHome,
      orgName: "health-org",
      orgHome: org!.orgHome,
      schedulerId: schedulerIdentity("health-org", org!.orgHome),
    });
  }

  it("completes a mixed spawn/WIP tick with zero alerts and keeps the provider decision pending", async () => {
    await configure();
    const tick = await dispatchTick({
      orgRoot: org!.orgHome,
      runtimeHome: org!.stateHome,
      now: () => NOW,
      eventSource: SOURCE,
      spawn: async () => {},
    });

    expect(tick.errors).toEqual([]);
    expect(tick.spawned).toHaveLength(1);
    const invocations = await evidence().listInvocations();
    expect(invocations[0]).toMatchObject({ terminal: "completed", reason_code: "executed" });
    const decisions = await evidence().listDecisions();
    expect(decisions.map((item) => ({ role: item.role, outcome: item.outcome, reason: item.reason_code, classification: item.classification })))
      .toContainEqual({ role: expect.any(String), outcome: "blocked", reason: "wip_limit", classification: "blocked_backpressure" });
    const provider = decisions.find((item) => item.episode_id === tick.spawned[0]!.turnId);
    expect(provider).toMatchObject({ stage: "spawned", outcome: null, classification: "pending" });
    expect(await evidence().listAlerts()).toEqual([]);
  });

  it("makes provider denominators non-null only after provider and settlement evidence arrive", async () => {
    await configure();
    const tick = await dispatchTick({
      orgRoot: org!.orgHome,
      runtimeHome: org!.stateHome,
      now: () => NOW,
      eventSource: SOURCE,
      spawn: async () => {},
    });
    const turn = tick.spawned[0]!;
    const runDir = join(org!.stateHome, "runs", turn.app, "provider-pass");
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "envelope.json"), JSON.stringify({
      schema_version: 1,
      trace_id: turn.turnId,
      provider_turn_ids: ["provider-1"],
    }) + "\n", "utf8");
    const telemetry = join(org!.stateHome, "telemetry", "2026-08.jsonl");
    await mkdir(dirname(telemetry), { recursive: true });
    await writeFile(telemetry, JSON.stringify({
      app: turn.app,
      traceId: turn.turnId,
      providerTurnId: "provider-1",
      costUsd: 1,
    }) + "\n", "utf8");
    for (const phase of ["running", "collecting", "done"] as const) {
      await writeJournalPatch(org!.stateHome, turn.turnId, {
        app: turn.app,
        role: turn.role,
        phase,
        message: "fixture provider completed",
      }, NOW);
    }

    const receipt = await evidence().recordTurnReceipt(turn.turnId, NOW, "fixture provider completed");
    expect(receipt).toMatchObject({
      stage: "terminal",
      outcome: "executed",
      classification: "executed",
      provider_turns: 1,
      provider_settlements: 1,
    });
    expect((await evidence().summarize(NOW))).toMatchObject({
      provider_turns: 1,
      provider_settlements: 1,
      provider_settlement_agreement: true,
      measurement_valid: true,
    });
  });

  it("classifies a fresh-lock-only tick as successful backpressure", async () => {
    await configure(["app-a"]);
    let installed = false;
    const source: GitHubEventSource = {
      ...SOURCE,
      ticketReady: async () => {
        if (!installed) {
          installed = true;
          await acquireLock(org!.stateHome, {
            app: "app-a",
            role: "sre",
            turnId: "already-running",
            now: NOW,
          });
        }
        return [];
      },
    };
    const tick = await dispatchTick({
      orgRoot: org!.orgHome,
      runtimeHome: org!.stateHome,
      now: () => NOW,
      eventSource: source,
      spawn: async () => { throw new Error("fresh lock must prevent spawn"); },
    });

    expect(tick.errors).toEqual([]);
    expect(tick.spawned).toEqual([]);
    expect((await evidence().listInvocations())[0]).toMatchObject({ terminal: "completed" });
    expect((await evidence().listDecisions()).find((item) => item.reason_code === "fresh_lock"))
      .toMatchObject({ outcome: "blocked", classification: "blocked_backpressure" });
    expect(await evidence().listAlerts()).toEqual([]);
  });

  it("auto-resolves invocation failure alerts after a successful scheduler cycle", async () => {
    await configure();
    const store = evidence();
    const failed = await store.beginInvocation(NOW);
    await store.finishInvocation(failed.invocation_id, "failed", "scheduler_state_failure", NOW);
    const later = new Date(NOW.getTime() + 5 * 60_000);
    const recovered = await store.beginInvocation(later);
    await store.finishInvocation(recovered.invocation_id, "completed", "no_due_work", later);

    expect(await store.listAlerts()).toEqual([
      expect.objectContaining({
        reason_code: "scheduler_state_failure",
        resolved: true,
        resolved_at: later.toISOString(),
      }),
    ]);
  });

  it("records a failed child receipt and resolves that alert after a later matching turn succeeds", async () => {
    await configure(["app-a"]);
    const store = evidence();
    const failedInvocation = await store.beginInvocation(NOW);
    const failedDecision = await store.claimDecision({
      invocationId: failedInvocation.invocation_id,
      cadenceWindow: failedInvocation.cadence_window,
      app: "app-a",
      role: "sre",
      triggerKind: "schedule",
      trigger: "hourly",
      now: NOW,
    });
    for (const phase of ["assembling", "failed"] as const) {
      await writeJournalPatch(org!.stateHome, failedDecision.record.episode_id!, {
        app: "app-a",
        role: "sre",
        phase,
        message: "seeded provider failure",
      }, NOW);
    }
    await store.recordTurnReceipt(failedDecision.record.episode_id!, NOW, "seeded provider failure");
    expect(await store.listAlerts()).toEqual([
      expect.objectContaining({
        evidence_id: failedDecision.record.decision_id,
        reason_code: "scheduler_state_failure",
        resolved: false,
      }),
    ]);

    const blockedAt = new Date(NOW.getTime() + 5 * 60_000);
    const blockedInvocation = await store.beginInvocation(blockedAt);
    const blockedDecision = await store.claimDecision({
      invocationId: blockedInvocation.invocation_id,
      cadenceWindow: blockedInvocation.cadence_window,
      app: "app-a",
      role: "sre",
      triggerKind: "schedule",
      trigger: "hourly",
      now: blockedAt,
    });
    await store.finishDecision(
      blockedDecision.record.decision_id,
      "blocked",
      "wip_limit",
      blockedAt,
      { detail: "healthy backpressure is not recovery evidence" },
    );
    expect((await store.listAlerts())
      .find((candidate) => candidate.evidence_id === failedDecision.record.decision_id))
      .toMatchObject({ resolved: false });

    const later = new Date(NOW.getTime() + 10 * 60_000);
    const recoveredInvocation = await store.beginInvocation(later);
    const recoveredDecision = await store.claimDecision({
      invocationId: recoveredInvocation.invocation_id,
      cadenceWindow: recoveredInvocation.cadence_window,
      app: "app-a",
      role: "sre",
      triggerKind: "schedule",
      trigger: "hourly",
      now: later,
    });
    for (const phase of ["assembling", "running", "collecting", "done"] as const) {
      await writeJournalPatch(org!.stateHome, recoveredDecision.record.episode_id!, {
        app: "app-a",
        role: "sre",
        phase,
        message: "fixture recovered",
      }, later);
    }
    await store.recordTurnReceipt(recoveredDecision.record.episode_id!, later, "fixture recovered");

    const alert = (await store.listAlerts())
      .find((candidate) => candidate.evidence_id === failedDecision.record.decision_id);
    expect(alert).toBeDefined();
    expect(alert).toMatchObject({
      evidence_id: failedDecision.record.decision_id,
      resolved: true,
      resolved_at: later.toISOString(),
    });
    expect(() => assertDecisionAlertResolved(alert!)).not.toThrow();
  });

  it("negative control: the detector rejects error-classification of normal backpressure", () => {
    expect(() => assertBackpressure("blocked_error")).toThrow(BackpressureMisclassified);
  });

  it("negative control: the alert-lifecycle detector rejects an unresolved recovered decision", () => {
    expect(() => assertDecisionAlertResolved({ resolved: false })).toThrow(UnresolvedDecisionAlert);
  });
});
