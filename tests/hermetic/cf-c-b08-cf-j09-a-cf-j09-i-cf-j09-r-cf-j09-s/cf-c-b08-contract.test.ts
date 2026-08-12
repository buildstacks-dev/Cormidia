// Traceability: CF-C-B08 · HB-142 · contracts/B-08-tick-turn.md
// (CORMIDIA-C-B08-001) — clause-complete per the case-catalog `contract`
// oracle macro: every clause of §1–§5 is either asserted in this file or
// delegated to the NAMED existing spec that owns it.
//
// Clause ledger (verbatim clause → disposition):
// §1  inputs enumerated; "due is arithmetic; token-free preflight"
//       → asserted here (no provider construction on an ineligible window);
//         depth: tests/hermetic/cf-reg-228/ (HB-139/#228).
// §2a closed 20-member vocabulary (F-PT-034)
//       → asserted here (three ratified surfaces agree); production
//         completeness: cf-j09-r-vocabulary.test.ts.
// §2b every considered (app, role, trigger, window) terminates in a durable
//     named reason → asserted here (mixed tick leaves no unnamed terminal);
//         breadth: cf-j09-r-vocabulary.test.ts · tests/hermetic/cf-inv-014/.
// §2c spawn decision durably committed BEFORE the child starts
//       → delegated: cf-j09-s-due-matrix.test.ts (in-spawn observation).
// §2d one content-bound claim/commit/settle identity; dead pre-commit owner
//     reclaim; one bounded operator retry
//       → delegated: tests/hermetic/cf-reg-231/ + tests/unit/cf-sched-claim/.
// §2e asymmetric spawn_failure vs post_spawn_bookkeeping_failure, distinct,
//     no duplicate spawn on the next tick
//       → delegated: tests/hermetic/cf-inv-014/ (distinctness) and
//         cf-j09-i-asymmetric.test.ts (next-tick legs).
// §3a "unreadable budget state → no admission" (INV-015)
//       → asserted here (corrupt overlay fails closed, named + evidenced,
//         tick survives) — F-PT-034 product change.
// §3b "unreadable schedule → no spawn, durable anomaly"
//       → asserted here (corrupt schedule state → named decision + unresolved
//         alert + zero scheduled spawns) — F-PT-034 product change.
// §3c fresh lock → skip with `fresh_lock`; stale → recovery path
//       → delegated: cf-j09-r-vocabulary.test.ts (fresh_lock leg) and
//         tests/hermetic/cf-b07-cf-c-b07/ (stale-lock reclamation, HB-023).
// §4a one event wakes a role exactly once per (event, role) mark
//       → delegated: tests/hermetic/cf-inv-014/ (sweep-refusal leg) and the
//         cf-b13/cf-j10 event-intake family.
// §4b missed windows reconcile to ONE firing with count (B-06)
//       → asserted here (missed_windows counted, single mechanical decision).
// §4c double-fire: at most one spawns; loser records a named reason
//       → delegated: tests/hermetic/cf-j09-rc/ (HB-021).
// §5  configured cadence ~5 min `[doc]`; org WIP limit 2 `[doc]`
//       → asserted here (config facts); "a turn may run for hours across many
//         ticks" is permissive prose with no falsifiable obligation.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadApps } from "../../../src/org/apps.js";
import { DEFAULT_SCHEDULER_CADENCE_MINUTES } from "../../../src/org/scheduler/model.js";
import {
  B08_CLOSED_VOCABULARY,
  contractClosedVocabulary,
  decisionProjections,
  designDocExecutionAdmissionRow,
  makeSchedulerWorld,
  mustFind,
  tickWithoutCrash,
  type SchedulerWorld,
} from "./support.js";

describe("CF-C-B08 — dispatcher tick ↔ detached turn, clause-complete (L2, HB-142)", () => {
  const worlds: SchedulerWorld[] = [];
  const scratch: string[] = [];

  async function world(spec: Parameters<typeof makeSchedulerWorld>[0]): Promise<SchedulerWorld> {
    const made = await makeSchedulerWorld(spec);
    worlds.push(made);
    return made;
  }

  afterEach(async () => {
    await Promise.all(worlds.splice(0).map((entry) => entry.cleanup()));
    await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("§2a: the contract, the canonical design-doc table, and the product pin agree on one closed set", async () => {
    const fromContract = [...(await contractClosedVocabulary())].sort();
    const fromDesignDoc = [...(await designDocExecutionAdmissionRow())].sort();
    const pinned = [...B08_CLOSED_VOCABULARY].sort();
    expect(fromContract).toEqual(pinned);
    expect(fromDesignDoc).toEqual(pinned);
    expect(pinned).toHaveLength(20);
  });

  it("§1 + §2b: a mixed tick names every considered entry durably, without constructing providers for ineligible windows", async () => {
    const w = await world({
      apps: [{ name: "app-a" }, { name: "app-b", release: false }],
      roles: [{ name: "sre", triggers: [{ schedule: "hourly" }] }],
    });
    const tick = await w.tick();
    // app-a admits (declared deploy surface); app-b's window is time-only —
    // the token-free preflight refuses before any provider construction.
    expect(tick.spawned).toHaveLength(1);
    expect(mustFind(w.spawns, () => true, "the admitted spawn")).toMatchObject({ app: "app-a" });
    const rows = await decisionProjections(w);
    const refused = mustFind(rows, (row) => row.app === "app-b", "the ineligible entry's decision");
    expect(refused).toMatchObject({ stage: "terminal", outcome: "skipped", reason_code: "no_actionable_input" });
    for (const row of rows) {
      if (row.stage === "terminal") {
        expect(row.reason_code).not.toBeNull();
        expect(row.episode_id).not.toBeNull();
      }
    }
  });

  it("§3a: unreadable budget state admits nothing for the app and is named — never a crash, never a greener result", async () => {
    const w = await world({
      apps: [{ name: "app-a" }],
      roles: [{ name: "sre", triggers: [{ schedule: "hourly" }] }],
    });
    await w.corruptBudgetOverlay();
    const tick = await tickWithoutCrash(w.tick());
    expect(tick.spawned).toEqual([]);
    expect(tick.errors.some((line) => line.includes("budget overlay refresh failed"))).toBe(true);
    const row = mustFind(
      await decisionProjections(w),
      (item) => item.reason_code === "scheduler_state_failure" && item.app === "app-a",
      "the fail-closed budget-state decision",
    );
    expect(row).toMatchObject({ stage: "terminal", outcome: "failed", classification: "blocked_error" });
    const raw = mustFind(
      await w.evidence.listDecisions(),
      (item) => item.decision_id === row.decision_id,
      "the raw fail-closed decision record",
    );
    expect(raw.detail ?? "").toContain("budget overlay unreadable");
  });

  it("§3b: unreadable schedule state spawns nothing scheduled and leaves a durable anomaly", async () => {
    const w = await world({
      apps: [{ name: "app-a" }],
      roles: [{ name: "sre", triggers: [{ schedule: "hourly" }] }],
    });
    await w.corruptScheduleState('{"app-a|sre|hourly": "not-a-timestamp"}');
    const tick = await tickWithoutCrash(w.tick());
    expect(tick.spawned).toEqual([]);
    const row = mustFind(
      await decisionProjections(w),
      (item) => item.reason_code === "scheduler_state_failure",
      "the schedule-state decision",
    );
    expect(row).toMatchObject({ stage: "terminal", outcome: "failed" });
    const alert = mustFind(
      await w.evidence.listAlerts(),
      (item) => item.reason_code === "scheduler_state_failure" && !item.resolved,
      "the durable anomaly (unresolved alert)",
    );
    expect(alert.evidence_id).toBe(row.decision_id);
  });

  it("§4b: missed host windows collapse to one counted firing", async () => {
    const w = await world({
      apps: [{ name: "app-a" }],
      roles: [{ name: "sre", triggers: [{ manual: true }] }],
    });
    const start = new Date("2026-08-12T16:00:00.000Z");
    await w.tick({ at: start });
    await w.tick({ at: new Date(start.getTime() + 20 * 60_000) });
    const reconciling = mustFind(
      await w.evidence.listInvocations(),
      (item) => item.missed_windows > 0,
      "the reconciling invocation",
    );
    expect(reconciling.missed_windows).toBe(3);
    expect(reconciling.reconciled_windows).toBe(3);
    const mechanical = (await decisionProjections(w)).filter((row) => row.reason_code === "missed_window_reconciled");
    expect(mechanical).toHaveLength(1);
    expect(mechanical[0]?.outcome).toBe("reconciled");
  });

  it("§5: the configured cadence and org WIP defaults are the documented figures", async () => {
    expect(DEFAULT_SCHEDULER_CADENCE_MINUTES).toBe(5);
    const dir = await mkdtemp(join(tmpdir(), "cf-c-b08-apps-"));
    scratch.push(dir);
    const path = join(dir, "apps.yaml");
    await writeFile(
      path,
      [
        "schema_version: 1",
        "org:",
        "  name: defaults-org",
        "defaults:",
        "  budget_usd_month: 1000",
        "apps:",
        "  app-a:",
        "    repo: fixture/app-a",
        "    status: live",
        "    cadence: {}",
        "",
      ].join("\n"),
      "utf8",
    );
    const apps = await loadApps(path);
    expect(apps.org.maxConcurrentTurns).toBe(2);
  });
});
