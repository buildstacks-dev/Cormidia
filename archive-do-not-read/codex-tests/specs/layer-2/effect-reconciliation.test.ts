import { afterEach, describe, expect, it } from "vitest";
import {
  executeApprovedDeliveries,
  githubIssueCreateAction,
} from "../../../src/org/approval-delivery.js";
import { ApprovalStore } from "../../../src/org/approvals.js";
import type { AppsFile } from "../../../src/org/apps.js";
import {
  createControlledWorld,
  FakeClock,
  type ControlledWorld,
} from "../../src/fixtures/controlled-world.js";
import { StatefulGitHubSimulator } from "../../src/simulators/controlled-seams.js";

let world: ControlledWorld | undefined;

afterEach(async () => {
  await world?.cleanup();
  world = undefined;
});

describe("production consequential-effect reconciliation", () => {
  it("recovers a crash after the remote effect without a second issue or grant", async () => {
    world = await createControlledWorld("layer-2-effect-crash");
    const clock = new FakeClock();
    const github = new StatefulGitHubSimulator();
    const appsFile = controlledAppsFile();
    const store = new ApprovalStore(world.stateRoot, {
      idSource: () => "approval-effect-crash",
    });
    const item = await store.raise({
      app: "sample-app",
      role: "sre",
      rule: "external-publishing",
      action: githubIssueCreateAction({
        repo: "example/sample-app",
        title: "Controlled incident",
        body: "Evidence-bound incident",
        labels: ["op:incident"],
        idempotency_key: "effect-crash-0001",
      }),
      justification: "exercise acknowledgement recovery",
      now: clock.now(),
    });
    await store.decide(item.id, { decision: "approved", now: clock.now() });

    await expect(
      executeApprovedDeliveries({
        stateHome: world.stateRoot,
        appsFile,
        now: clock.now,
        ghFor: () => github,
        fault: (boundary) => {
          if (boundary === "after_remote") throw new Error("controlled crash after remote");
        },
      }),
    ).rejects.toThrow(/controlled crash after remote/);

    expect(github.issueCount()).toBe(1);
    expect(github.operationCount("createIssue")).toBe(1);
    expect((await store.show(item.id)).item.execution).toMatchObject({
      state: "executing",
      attempts: 1,
    });

    const recovered = await executeApprovedDeliveries({
      stateHome: world.stateRoot,
      appsFile,
      now: clock.now,
      ghFor: () => github,
    });

    expect(recovered).toEqual([
      expect.objectContaining({
        approvalId: item.id,
        status: "executed",
        summary: "remote acknowledgement recovered from idempotency marker",
      }),
    ]);
    expect(github.issueCount()).toBe(1);
    expect(github.operationCount("createIssue")).toBe(1);
    expect((await store.show(item.id)).item.execution).toMatchObject({
      state: "executed",
      attempts: 1,
    });
  });

  it("reconciles a timeout after a possible write in the same execution lifecycle", async () => {
    world = await createControlledWorld("layer-2-effect-timeout");
    const clock = new FakeClock();
    const github = new StatefulGitHubSimulator();
    const store = new ApprovalStore(world.stateRoot, {
      idSource: () => "approval-effect-timeout",
    });
    const item = await store.raise({
      app: "sample-app",
      role: "sre",
      rule: "external-publishing",
      action: githubIssueCreateAction({
        repo: "example/sample-app",
        title: "Controlled timeout",
        body: "The remote write may have succeeded",
        labels: [],
        idempotency_key: "effect-timeout-0001",
      }),
      justification: "exercise timeout-after-write reconciliation",
      now: clock.now(),
    });
    await store.decide(item.id, { decision: "approved", now: clock.now() });
    github.queueFault("createIssue", "timeout_after_write");

    const outcomes = await executeApprovedDeliveries({
      stateHome: world.stateRoot,
      appsFile: controlledAppsFile(),
      now: clock.now,
      ghFor: () => github,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        approvalId: item.id,
        status: "executed",
        summary: "ambiguous response reconciled to a unique remote marker",
      }),
    ]);
    expect(github.issueCount()).toBe(1);
    expect(github.operationCount("createIssue")).toBe(1);
    expect((await store.show(item.id)).item.execution?.state).toBe("executed");
  });
});

function controlledAppsFile(): AppsFile {
  return {
    schemaVersion: 1,
    org: { name: "controlled-org", maxConcurrentTurns: 2 },
    defaults: { budgetUsdMonth: 100 },
    apps: [
      {
        name: "sample-app",
        repo: "example/sample-app",
        status: "live",
        budgetUsdMonth: 100,
        cadence: {},
      },
    ],
  };
}
