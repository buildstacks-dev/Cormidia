import { afterEach, describe, expect, it } from "vitest";
import type { AppEntry } from "../../../src/org/apps.js";
import { EventStore } from "../../../src/org/events.js";
import { SchedulerEvidenceStore } from "../../../src/org/scheduler/evidence.js";
import { schedulerIdentity } from "../../../src/org/scheduler/model.js";
import {
  boundedEnvironment,
  ControlledProcessError,
  ControlledProcessRunner,
  DeterministicRandom,
  StatefulEffectTarget,
  StatefulEventSource,
  StatefulGitHubSimulator,
} from "../../src/simulators/controlled-seams.js";
import {
  createControlledWorld,
  type ControlledWorld,
} from "../../src/fixtures/controlled-world.js";

let world: ControlledWorld | undefined;

afterEach(async () => {
  await world?.cleanup();
  world = undefined;
});

describe("stateful controlled-boundary kernel", () => {
  it("models GitHub stale reads, version skew, partial success, and write ambiguity", async () => {
    const github = new StatefulGitHubSimulator();
    github.seedIssue({
      number: 7,
      title: "initial",
      body: "body",
      labels: ["op:ready"],
      state: "OPEN",
    });
    await github.updateIssueBody(7, "current");

    github.queueFault("readIssue", "stale_read");
    await expect(github.readIssue(7)).resolves.toMatchObject({ body: "body" });

    github.apiVersion = 2;
    github.queueFault("readIssue", "version_skew");
    await expect(github.readIssue(7)).rejects.toThrow(/version 2 is incompatible/);

    github.queueFault("swapLabel", "partial_success");
    await expect(github.swapLabel(7, "op:ready", "op:building")).rejects.toThrow(
      /partial success/,
    );
    await expect(github.readIssue(7)).resolves.toMatchObject({ labels: [] });

    github.queueFault("createIssue", "timeout_after_write");
    await expect(
      github.createIssue({ title: "ambiguous", body: "marker", labels: [] }),
    ).rejects.toThrow(/timeout after possible write/);
    expect(github.issueCount()).toBe(2);
    expect(github.operationCount("createIssue")).toBe(1);
  });

  it("composes replay, source-specific failure, and stale delivery through production EventStore", async () => {
    world = await createControlledWorld("layer-2-event-source");
    const app: AppEntry = {
      name: "sample-app",
      repo: "example/sample-app",
      status: "live",
      budgetUsdMonth: 100,
      cadence: {},
    };
    const source = new StatefulEventSource();
    const store = new EventStore(world.stateRoot);

    source.publish(app.name, "ticket-ready", { issueNumber: 1 });
    const first = await store.poll(app, source);
    expect(first.errors).toEqual([]);
    expect(first.events).toContainEqual({
      kind: "ticket-ready",
      key: "ticket-ready:1",
      app: app.name,
      payload: { issueNumber: 1 },
    });

    await store.markConsumed(["ticket-ready:1"]);
    source.queueFault("pr-opened", "unavailable");
    source.publish(app.name, "ticket-ready", { issueNumber: 2 });
    source.publish(app.name, "ci-failed", { sha: "old", check: "build" });
    source.publish(app.name, "ci-failed", { sha: "new", check: "build" });
    source.queueFault("ci-failed", "stale_read");

    const second = await store.poll(app, source);
    expect(second.events.map((event) => event.key)).toContain("ticket-ready:2");
    expect(second.events.map((event) => event.key)).not.toContain("ticket-ready:1");
    expect(second.events.map((event) => event.key)).toContain("ci-failed:old:build");
    expect(second.events.map((event) => event.key)).not.toContain("ci-failed:new:build");
    expect(second.errors).toContainEqual(
      expect.objectContaining({ kind: "pr-opened", code: "error_event_source" }),
    );
  });

  it("deduplicates concurrent scheduler decisions across a reconstructed production store", async () => {
    world = await createControlledWorld("layer-2-scheduler-concurrency");
    const at = new Date("2026-01-01T00:00:00.000Z");
    const schedulerId = schedulerIdentity("controlled-org", world.orgRoot);
    const store = new SchedulerEvidenceStore({
      stateHome: world.stateRoot,
      orgName: "controlled-org",
      orgHome: world.orgRoot,
      schedulerId,
      cadenceMinutes: 5,
    });
    const invocation = await store.beginInvocation(at);
    const decision = {
      invocationId: invocation.invocation_id,
      cadenceWindow: invocation.cadence_window,
      app: "sample-app",
      role: "builder",
      triggerKind: "event" as const,
      trigger: "ticket-ready",
      eventKey: "ticket-ready:1",
      now: at,
    };
    const claims = await Promise.all([store.claimDecision(decision), store.claimDecision(decision)]);

    expect(claims.map((claim) => claim.created).sort()).toEqual([false, true]);
    expect(new Set(claims.map((claim) => claim.record.decision_id)).size).toBe(1);

    await store.advanceDecision(claims[0]!.record.decision_id, "spawn_committed", at);
    const reconstructed = new SchedulerEvidenceStore({
      stateHome: world.stateRoot,
      orgName: "controlled-org",
      orgHome: world.orgRoot,
      schedulerId,
      cadenceMinutes: 5,
    });
    const finished = await reconstructed.finishDecision(
      claims[0]!.record.decision_id,
      "executed",
      "executed",
      at,
      { providerTurns: 1, providerSettlements: 1 },
    );
    const replay = await reconstructed.claimDecision(decision);

    expect(finished.stage).toBe("terminal");
    expect(replay).toMatchObject({
      created: false,
      record: { decision_id: finished.decision_id, outcome: "executed" },
    });
    expect(await reconstructed.listDecisions()).toHaveLength(1);
  });

  it("controls process outcomes, deterministic randomness, and ambient environment", async () => {
    const runner = new ControlledProcessRunner();
    runner.enqueue({ kind: "success", stdout: "enabled" });
    runner.enqueue({ kind: "partial_success", stdout: "wrote definition", stderr: "load failed" });
    runner.enqueue({ kind: "timeout" });

    await expect(runner.run({ command: "scheduler", args: ["enable"] })).resolves.toEqual({
      code: 0,
      stdout: "enabled",
      stderr: "",
    });
    await expect(runner.run({ command: "scheduler", args: ["reload"] })).resolves.toEqual({
      code: 1,
      stdout: "wrote definition",
      stderr: "load failed",
    });
    await expect(runner.run({ command: "scheduler", args: ["inspect"] })).rejects.toEqual(
      expect.objectContaining<Partial<ControlledProcessError>>({ outcome: "timeout" }),
    );

    const first = new DeterministicRandom(20260729);
    const second = new DeterministicRandom(20260729);
    expect(Array.from({ length: 20 }, () => first.next())).toEqual(
      Array.from({ length: 20 }, () => second.next()),
    );
    expect(
      boundedEnvironment(
        { PATH: "/controlled/bin", SECRET_TOKEN: "must-not-leak", OPERON_ORG_HOME: "/org" },
        { allowed: ["PATH", "OPERON_ORG_HOME"], required: ["OPERON_ORG_HOME"] },
      ),
    ).toEqual({ PATH: "/controlled/bin", OPERON_ORG_HOME: "/org" });
  });

  it("reconciles a lost external-effect acknowledgement without duplicating the effect", () => {
    const target = new StatefulEffectTarget();
    const request = {
      operationId: "publish-1",
      target: "disposable-portal",
      payloadHash: "sha256:artifact",
      marker: "operon-effect-1",
    };
    target.queueFault("lost_acknowledgement");

    expect(() => target.execute(request)).toThrow(/lost acknowledgement/);
    expect(target.effectCount()).toBe(1);
    expect(target.reconcile(request.marker)).toMatchObject(request);
    expect(target.execute(request)).toMatchObject(request);
    expect(target.effectCount()).toBe(1);
  });
});
