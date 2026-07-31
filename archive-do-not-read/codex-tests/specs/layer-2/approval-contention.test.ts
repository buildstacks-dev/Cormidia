import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalStore } from "../../../src/org/approvals.js";
import {
  createControlledWorld,
  FakeClock,
  type ControlledWorld,
} from "../../src/fixtures/controlled-world.js";

let world: ControlledWorld | undefined;

afterEach(async () => {
  await world?.cleanup();
  world = undefined;
});

describe("approval decision contention", () => {
  it("retains exactly one authoritative decision and matching grant state", async () => {
    world = await createControlledWorld("layer-2-approval-contention");
    const clock = new FakeClock();
    const store = new ApprovalStore(world.stateRoot, {
      idSource: () => "approval-contention-1",
    });
    const item = await store.raise({
      app: "sample-app",
      role: "sre",
      rule: "critical-op",
      action: {
        tool: "bash",
        input: { command: "controlled consequential action" },
      },
      justification: "exercise concurrent human decision delivery",
      now: clock.now(),
    });

    const decisions = await Promise.allSettled([
      store.decide(item.id, {
        decision: "approved",
        now: clock.now(),
      }),
      store.decide(item.id, {
        decision: "denied",
        reason: "controlled denial",
        now: clock.now(),
      }),
    ]);
    await store.reconcile(clock.now());

    const settled = decisions.filter(
      (decision): decision is PromiseFulfilledResult<Awaited<ReturnType<typeof store.decide>>> =>
        decision.status === "fulfilled",
    );
    const authoritative = (await store.show(item.id)).item;
    const decisionEvents = (await store.readLog()).filter(
      (event) => event.type === "decided" && event.id === item.id,
    );
    const grants = await readdir(
      resolve(world.stateRoot, "approvals", "grants"),
    );
    const expectedGrantFiles =
      authoritative.decision === "approved" && authoritative.grantId !== undefined
        ? [`${authoritative.grantId}.json`]
        : [];

    expect({
      fulfilled: settled.length,
      rejected: decisions.length - settled.length,
      fulfilledDecisions: settled.map((decision) => decision.value.decision).sort(),
      authoritativeDecision: authoritative.decision,
      decisionEvents: decisionEvents.length,
      grantBindingConsistent:
        authoritative.decision === "approved"
          ? authoritative.grantId !== undefined
          : authoritative.grantId === undefined,
      grantFiles: grants.sort(),
    }).toEqual({
      fulfilled: 1,
      rejected: 1,
      fulfilledDecisions: [authoritative.decision],
      authoritativeDecision: authoritative.decision,
      decisionEvents: 1,
      grantBindingConsistent: true,
      grantFiles: expectedGrantFiles,
    });
  });
});
