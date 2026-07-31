import { describe, expect, it } from "vitest";
import { previewCaptureEvents, projectCaptureEvents } from "../../src/org/learning/capture.js";
import { readLearningEvents } from "../../src/org/learning/events.js";
import { SchedulerEvidenceStore } from "../../src/org/scheduler/evidence.js";
import { schedulerIdentity } from "../../src/org/scheduler/model.js";
import { makeOrgHome } from "../fixtures/orgHome.js";

describe("scheduled learning governance boundary", () => {
  it("feeds missed scheduler decisions into the existing Phase 4 typed evidence projection exactly once", async () => {
    const home = makeOrgHome({ state: true });
    const orgName = "learning-scheduler";
    const store = new SchedulerEvidenceStore({ stateHome: home.root, orgName, orgHome: home.root, schedulerId: schedulerIdentity(orgName, home.root) });
    try {
      const first = await store.beginInvocation(new Date("2026-07-14T00:00:00Z"));
      await store.finishInvocation(first.invocation_id, "completed", "no_due_work", new Date("2026-07-14T00:00:01Z"));
      const resumed = await store.beginInvocation(new Date("2026-07-14T00:15:00Z"));
      expect(resumed.missed_windows).toBe(2);
      const miss = await store.claimDecision({ invocationId: resumed.invocation_id, cadenceWindow: resumed.cadence_window, app: "service", role: "planner", triggerKind: "schedule", trigger: "daily 07:00", now: new Date("2026-07-14T00:15:00Z") });
      await store.finishDecision(miss.record.decision_id, "reconciled", "missed_window_reconciled", new Date("2026-07-14T00:15:00Z"), { providerTurns: 0, providerSettlements: 0 });
      await store.finishInvocation(resumed.invocation_id, "completed", "missed_window_reconciled", new Date("2026-07-14T00:15:01Z"));

      const preview = await previewCaptureEvents({ stateHome: home.root });
      expect(preview.refreshRequired).toBe(true);
      expect(await readLearningEvents(home.root)).toEqual([]);
      const refreshed = await projectCaptureEvents({ stateHome: home.root });
      expect(refreshed.eventsEmitted).toBe(1);
      const events = await readLearningEvents(home.root);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ app: "service", agent_role: "planner", error_class: "scheduler.missed_tick", emitter: "verifier", payload: { evidence_kind: "mechanical" } });
      const replay = await projectCaptureEvents({ stateHome: home.root });
      expect(replay.eventsEmitted).toBe(0);
      expect(await readLearningEvents(home.root)).toEqual(events);
    } finally { home.cleanup(); }
  });
});
