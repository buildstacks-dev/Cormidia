// Traceability: CF-J14-A · HB-015; CF-INV-010 · HB-015 · contracts/journey-acceptance.md J-14 alternative; invariants.md CORMIDIA-INV-010.

// CF-J14-A — the SIBLING-DIFF ORACLE: a reset leaves the sibling app and the
// human checkout bit-identical, destruction stays inside the authorized
// destructive set, and a failed archive write means destruction never begins
// (L2, E1/FLOOR; INV-010 all four adversarial seeds folded here per the
// CF-INV-010 catalog row; C-OP-LIFE §6; journey-acceptance J-14).
//
//   seed (a) — reset app A with app B active: full-state diff of B;
//   seed (b) — fail the archive write: destruction must not begin;
//   seed (c) — --force vs fresh heartbeat/pending approval: cf-j14-r;
//   seed (d) — remote moved / renamed default branch: the recorded-default
//              wrong-remote guard keeps the default branch out of the
//              planned deletion set even when it appears as a managed PR
//              head (#101).
//
// Negative controls break the oracle's guard on purpose and prove the
// detector FIRES — a detector that has never fired is an assumption.

import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeAppReset, planAppReset, type AppResetOptions } from "../../../src/org/app-reset.js";
import { loadApps } from "../../../src/org/apps.js";
import {
  assertResetScope,
  completedResetAllowance,
  diffWorld,
  makeResetWorld,
  mutatingOpsSince,
  preDestructionAllowance,
  ResetScopeViolation,
  seedActiveJournal,
  snapshotWorld,
  DOUBLE_DEFAULT_BRANCH,
  TARGET_APP,
  SIBLING_APP,
  type ResetWorld,
} from "./support.js";

describe("CF-J14-A — sibling-diff oracle and the authorized destructive set (INV-010)", () => {
  let cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function world(options: Parameters<typeof makeResetWorld>[0] = {}): Promise<ResetWorld> {
    const w = await makeResetWorld(options);
    cleanups.push(() => w.cleanup());
    return w;
  }

  function resetInput(w: ResetWorld, overrides: Partial<AppResetOptions> = {}): AppResetOptions {
    return {
      orgHome: w.orgHome,
      stateHome: w.stateHome,
      appsFile: w.appsFile,
      appName: TARGET_APP,
      gh: w.gh,
      archiveRoot: w.archiveRoot,
      ...overrides,
    };
  }

  it("INV-010 seed (a): reset of A with B active — B's full state and the human checkout are bit-identical", async () => {
    const w = await world();
    // B is genuinely ACTIVE: a live journal — attributable to B, so it must
    // neither block A's reset nor be touched by it.
    await seedActiveJournal(w, SIBLING_APP);
    const before = await snapshotWorld(w);

    const input = resetInput(w);
    const plan = await planAppReset(input);
    expect(plan.blockers).toEqual([]); // B's activity never blocks A
    await executeAppReset(input, plan);

    const diff = diffWorld(before, await snapshotWorld(w));
    // The oracle: everything that moved is inside A's authorized set.
    assertResetScope(
      TARGET_APP,
      diff,
      completedResetAllowance(TARGET_APP, [
        ...w.targetApprovalFiles,
        "telemetry/mixed.jsonl",
        "invocations/audit.jsonl",
      ]),
    );
    // Explicit bit-identity for every sibling-owned path (full-state diff of
    // B): no B path appears in the diff at all.
    const siblingTouched = [...diff.state.added, ...diff.state.removed, ...diff.state.changed].filter((rel) =>
      rel.includes(SIBLING_APP),
    );
    expect(siblingTouched).toEqual([]);
    expect(diff.human).toEqual({ added: [], removed: [], changed: [] });
    // B survives in the registry; B's journal survives on disk.
    expect((await loadApps(join(w.orgHome, "apps.yaml"))).apps.map((app) => app.name)).toEqual([SIBLING_APP]);
    expect(existsSync(join(w.stateHome, "state", "turns", `turn-${SIBLING_APP}-journal.json`))).toBe(true);
  });

  it("negative control (oracle self-test): a seeded out-of-scope mutation makes the oracle FIRE naming the path", async () => {
    const w = await world();
    const before = await snapshotWorld(w);
    // SEEDED VIOLATION: something destroys a sibling byte (no reset at all —
    // this is the oracle's own trigger test).
    await writeFile(
      join(w.stateHome, "runs", SIBLING_APP, "seed-run", "artifact.txt"),
      "clobbered by an out-of-scope writer\n",
      "utf8",
    );
    const diff = diffWorld(before, await snapshotWorld(w));
    expect(() => assertResetScope(TARGET_APP, diff, completedResetAllowance(TARGET_APP, []))).toThrow(
      ResetScopeViolation,
    );
    try {
      assertResetScope(TARGET_APP, diff, completedResetAllowance(TARGET_APP, []));
    } catch (error) {
      expect((error as ResetScopeViolation).offenders).toEqual([`state:runs/${SIBLING_APP}/seed-run/artifact.txt`]);
    }
  });

  it("INV-010 seed (b): the archive write fails — destruction never begins, remote untouched", async () => {
    const w = await world();
    const before = await snapshotWorld(w);
    const input = resetInput(w, {
      fault: (point) => {
        if (point === "before_archive_checksum") {
          throw new Error("cf-j14-a: injected archive-write failure");
        }
      },
    });
    const plan = await planAppReset(input);
    expect(plan.blockers).toEqual([]);
    await expect(executeAppReset(input, plan)).rejects.toThrow(/injected archive-write failure/);

    // Destruction never began: only the non-destructive journal writes moved.
    const diff = diffWorld(before, await snapshotWorld(w));
    assertResetScope(TARGET_APP, diff, preDestructionAllowance(TARGET_APP));
    expect(existsSync(join(w.stateHome, "runs", TARGET_APP, "seed-run", "artifact.txt"))).toBe(true);
    expect((await loadApps(join(w.orgHome, "apps.yaml"))).apps.map((app) => app.name)).toContain(TARGET_APP);
    expect(mutatingOpsSince(w)).toEqual([]);
    // No half-archive was left masquerading as final.
    expect(existsSync(join(w.archiveRoot, plan.archiveId))).toBe(false);
  });

  it("negative control (seed b guard): destruction seeded AFTER the failed archive — the oracle FIRES", async () => {
    const w = await world();
    const before = await snapshotWorld(w);
    const input = resetInput(w, {
      fault: (point) => {
        if (point === "before_archive_checksum") {
          throw new Error("cf-j14-a: injected archive-write failure");
        }
      },
    });
    await expect(executeAppReset(input, await planAppReset(input))).rejects.toThrow(/injected archive-write failure/);
    // SEEDED VIOLATION: a buggy implementation that had already started
    // deleting managed state before its archive completed.
    await rm(join(w.stateHome, "runs", TARGET_APP), { recursive: true, force: true });
    const diff = diffWorld(before, await snapshotWorld(w));
    expect(() => assertResetScope(TARGET_APP, diff, preDestructionAllowance(TARGET_APP))).toThrow(
      /INV-010 violation.*runs\/alpha/,
    );
  });

  it("INV-010 seed (d): the recorded default branch never enters the deletion set, even as a managed PR's head (#101 wrong-remote guard)", async () => {
    const w = await world({ recordDefaultBranch: DOUBLE_DEFAULT_BRANCH });
    // Adversarial shape: a human opened default→production on a PR whose body
    // links the managed issue — the default branch is now a managed PR HEAD,
    // and no open PR uses it as a base.
    w.handle.seedBranch("production");
    await w.gh.closePullRequest(w.pr.number); // drop the trunk-based PR so no base protects trunk
    const adversarial = await w.gh.createPR({
      head: DOUBLE_DEFAULT_BRANCH,
      base: "production",
      title: "Human release PR from the default branch",
      body: `Relates work. Closes #${w.issue.number}`,
    });

    const plan = await planAppReset(resetInput(w));
    // The adversarial PR is managed (it links the op issue) …
    expect(plan.github.pullRequests.map((pr) => pr.number)).toContain(adversarial.number);
    // … but its head — the recorded default branch — is NEVER planned for
    // deletion; only PR-base protection would miss it (negative control
    // below proves that), the lifecycle-record guard catches it.
    expect(plan.github.branches).not.toContain(DOUBLE_DEFAULT_BRANCH);
  });

  it("negative control (seed d): with the lifecycle record removed, only PR-base protection remains and the default branch regresses into the deletion set — proving the record guard is the active detector", async () => {
    const w = await world({ recordDefaultBranch: DOUBLE_DEFAULT_BRANCH });
    w.handle.seedBranch("production");
    await w.gh.closePullRequest(w.pr.number);
    await w.gh.createPR({
      head: DOUBLE_DEFAULT_BRANCH,
      base: "production",
      title: "Human release PR from the default branch",
      body: `Closes #${w.issue.number}`,
    });
    // SEEDED VIOLATION: the durable record is gone (the “remote moved /
    // nothing recorded” world) — the second protection layer disappears.
    await rm(join(w.stateHome, "lifecycle", "apps", TARGET_APP, "record.json"), { force: true });

    const plan = await planAppReset(resetInput(w));
    expect(plan.github.branches).toContain(DOUBLE_DEFAULT_BRANCH);
  });
});
