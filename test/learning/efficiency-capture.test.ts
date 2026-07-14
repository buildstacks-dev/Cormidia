import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { prepareDistillation } from "../../src/org/learning/distillation.js";
import { createLearningEventSink } from "../../src/org/learning/events.js";
import { defaultLearningPolicy } from "../../src/org/learning/policy.js";
import { duplicateSingletonClasses, projectHistoricalLearningOracle } from "../../scripts/eval/historical-learning-oracle.js";
import { makeAppRepo, makeOrgHome } from "../fixtures/orgHome.js";

const fixture = fileURLToPath(new URL("../fixtures/historical/2026-07-12-buildstacks-class", import.meta.url));
const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

describe("LEARNING-CLOSURE-001 efficiency anomaly capture and production-policy clustering", () => {
  it("positive oracle maps every required historical anomaly to stable trusted classes", () => {
    const classes = new Set(projectHistoricalLearningOracle(fixture).map((event) => event.error_class));
    for (const errorClass of ["execution.cancelled", "execution.stale_finalization", "review.long_duration", "route.budget_overrun", "execution.repeated_work", "environment.retry_cluster", "tooling.shell_heavy_repetition", "approval.false_positive"]) expect(classes.has(errorClass), errorClass).toBe(true);
  });
  it("near-miss injects two comparable episodes per singleton and forms actionable clusters under the unmodified production policy", async () => {
    const org = makeOrgHome(); const state = makeOrgHome({ state: true }); const app = makeAppRepo(); cleanup.push(org.cleanup, state.cleanup, app.cleanup);
    const events = duplicateSingletonClasses(projectHistoricalLearningOracle(fixture)); const sink = createLearningEventSink(state.root);
    for (const event of events) await sink.emit(event);
    const prepared = await prepareDistillation({ orgHome: org.root, stateHome: state.root, app: "alpha", appWorkdir: app.root, appStages: { alpha: "live" }, policy: defaultLearningPolicy(), now: new Date("2026-07-12T06:00:00.000Z") });
    expect(prepared.status).toBe("ready");
    expect(prepared.evidenceEvents).toBe(events.length);
    expect(prepared.actionableClusters).toBeGreaterThanOrEqual(8);
    expect(prepared.clusters.every((cluster) => cluster.event_ids.length >= 2)).toBe(true);
  });
  it("honest failure preserves the current capture disagreement as exact product debt instead of fabricating green projection", () => {
    const expected = JSON.parse(readFileSync(new URL("../fixtures/historical/2026-07-12-buildstacks-class/expected.json", import.meta.url), "utf8")) as { capture_disagreement: { eligible_provider_runs: number; projected_runs: number } };
    expect(expected.capture_disagreement).toEqual({ eligible_provider_runs: 6, projected_runs: 0 });
    expect(projectHistoricalLearningOracle(fixture).length).toBeGreaterThan(0);
  });
});
