// CF-C-OPLIFE — contract-clause sweep over CORMIDIA-C-OPLIFE-001 §§1–6 plus the
// error split: precondition/identity failures refuse BEFORE domain mutation;
// mid-execution failures leave the journaled, resumable intermediate
// (L2, E1 — T-8 slices; contracts/OP-lifecycle.md; case-catalog row
// CF-C-OPLIFE; defends INV-008/010/013/015).
//
// Deep walks of §§1/§3/§6 live in the CF-J01-*/CF-J14-* suites; this sweep
// pins each section's contract sentence at its cheapest observable seam so a
// clause regression is traceable to the exact §.
//
// §4/§5 coverage note (honest partial): the clauses pinned here are the
// promotion-preview slice — a missing lifecycle record is a TYPED
// verification result (never a raw ENOENT), verify performs no provider
// construction (the report's provider counters are the product's own zero
// evidence), promote preview is non-mutating with actionable remediation,
// and promote execute refuses on unverifiable state. The deep §4 cells
// (refs/ancestry against a live-shaped remote, config acceptance from the
// fetched default branch, crash-resumable config ratification journal) and
// §5's resumable promotion transaction need a bootstrap-grade fixture
// (managed clone + record + remote) and are NOT covered by this ticket —
// they remain open CF-C-OPLIFE cells for the wave that lands the bootstrap
// world (no green by absence: reduced here, not silently skipped).

import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAuditedCliInvocation } from "../../../src/cli/invocation-audit.js";
import { cmdOrg } from "../../../src/cli/org.js";
import { LEGACY_CONSERVATIVE_VERSION, resolveAuthority } from "../../../src/org/authority.js";
import { executeAppPromotion, planAppPromotion, verifyApp } from "../../../src/org/app-lifecycle.js";
import { executeAppReset, planAppReset, type AppResetOptions } from "../../../src/org/app-reset.js";
import { loadApps } from "../../../src/org/apps.js";
import { initOrgHome, planOrgInit, readActiveOrgPointer } from "../../../src/org/home.js";
import { stableJson } from "../../../src/org/lifecycle.js";
import { executeOrgUpgrade, planOrgUpgrade, type OrgUpgradeOptions } from "../../../src/org/org-upgrade.js";
import {
  diffIsEmpty,
  diffPaths,
  diffSnapshots,
  makeInitWorld,
  makeUpgradeWorld,
  snapshotTree,
  snapshotTreeAllowEmpty,
} from "../cf-j01/support.js";
import { diffWorld, makeResetWorld, snapshotWorld, TARGET_APP } from "../cf-j14/support.js";

describe("CF-C-OPLIFE — C-OP-LIFE §§1–6 + error split (contracts/OP-lifecycle.md)", () => {
  let cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  it("§1 dry-run: the module preflight is a zero-write preview — not one byte anywhere", async () => {
    const w = await makeInitWorld();
    cleanups.push(() => w.cleanup());
    const before = await snapshotTree(w.root);
    const plan = await planOrgInit({
      target: w.target,
      name: "preview-org",
      stateHome: w.stateHome,
      homeDir: w.homeDir,
      pointerPath: w.pointerPath,
    });
    expect(plan.preview.executable).toBe(true);
    const diff = diffSnapshots(before, await snapshotTree(w.root));
    expect(diffIsEmpty(diff), `preflight wrote: ${diffPaths(diff).join(", ")}`).toBe(true);
  });

  it("§1 + error split: the dispatched CLI dry-run writes NOTHING but the invocation audit row", async () => {
    const w = await makeInitWorld();
    cleanups.push(() => w.cleanup());
    const before = await snapshotTreeAllowEmpty(w.root);
    // Through the REAL audited dispatch scope (src/cli.ts wraps every command
    // in runAuditedCliInvocation) — a bare cmdOrg call has no audit scope and
    // would prove nothing about the sole preview write. `org init` is exempt
    // from the initial home resolution, so no ambient pointer is consulted.
    const argv = ["org", "init", w.target, "--name", "preview-org", "--state-home", w.stateHome, "--dry-run", "--json"];
    const code = await runAuditedCliInvocation(argv, () =>
      cmdOrg(argv.slice(1), { homeDir: w.homeDir, pointerPath: w.pointerPath }),
    );
    expect(code).toBe(0);
    const diff = diffSnapshots(before, await snapshotTreeAllowEmpty(w.root));
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    // The sole preview write: invocation audit rows under the planned state
    // home. Nothing lands in the org target or the pointer.
    expect(diff.added.length).toBeGreaterThan(0); // the audit row itself is evidence (INV-014)
    const offenders = diff.added.filter(
      (rel) =>
        !/^state\/(?:invocations|invocation-journal)\//.test(rel) && !/^state\/state\/invocation-journal\//.test(rel),
    );
    expect(offenders, `dry-run wrote beyond the audit row: ${offenders.join(", ")}`).toEqual([]);
    expect(existsSync(w.target)).toBe(false);
    expect(existsSync(w.pointerPath)).toBe(false);
  });

  it("§2 org use: pointer update is atomic and wholesale — junk bytes are replaced, no temp residue survives", async () => {
    const w = await makeInitWorld();
    cleanups.push(() => w.cleanup());
    await initOrgHome({
      target: w.target,
      name: "atomic-org",
      stateHome: w.stateHome,
      homeDir: w.homeDir,
      pointerPath: w.pointerPath,
    });
    // Pointer clobbered by junk between selections.
    await writeFile(w.pointerPath, "not: [valid yaml pointer\n", "utf8");
    const code = await cmdOrg(["use", w.target, "--state-home", w.stateHome], {
      homeDir: w.homeDir,
      pointerPath: w.pointerPath,
    });
    expect(code).toBe(0);
    expect(await readActiveOrgPointer(w.pointerPath)).toEqual({
      orgHome: w.target,
      stateHome: w.stateHome,
    });
    // Atomic temp+rename leaves no `.tmp-*` sibling behind.
    const pointerDir = await snapshotTree(join(w.homeDir, ".cormidia"));
    const residue = [...pointerDir.keys()].filter((rel) => rel.includes(".tmp"));
    expect(residue).toEqual([]);
  });

  it("§2 / INV-015: a complete org with no AUTHORITY.md still resolves, and authority fails closed to legacy-conservative", async () => {
    const w = await makeInitWorld();
    cleanups.push(() => w.cleanup());
    await initOrgHome({
      target: w.target,
      name: "legacy-auth-org",
      stateHome: w.stateHome,
      homeDir: w.homeDir,
      pointerPath: w.pointerPath,
    });
    await rm(join(w.target, "AUTHORITY.md"));
    const authority = await resolveAuthority({ orgHome: w.target });
    expect(authority.profile).toBe("conservative");
    expect(authority.version).toBe(LEGACY_CONSERVATIVE_VERSION);
    expect(authority.sources).toEqual([`builtin:${LEGACY_CONSERVATIVE_VERSION}`]);
  });

  it("§3 preview: the upgrade plan is byte-stable across repeated planning", async () => {
    const w = await makeUpgradeWorld("oplife-stable");
    cleanups.push(() => w.cleanup());
    const input: OrgUpgradeOptions = {
      orgHome: w.orgHome,
      stateHome: w.stateHome,
      archiveRoot: w.archiveRoot,
      authorityChoice: "conservative",
    };
    expect(stableJson(await planOrgUpgrade(input))).toBe(stableJson(await planOrgUpgrade(input)));
  });

  it("§3: the archive root inside the state home refuses — the backup can never destroy itself", async () => {
    const w = await makeUpgradeWorld("oplife-archive-inside");
    cleanups.push(() => w.cleanup());
    await expect(
      planOrgUpgrade({
        orgHome: w.orgHome,
        stateHome: w.stateHome,
        archiveRoot: join(w.stateHome, "nested-archives"),
        authorityChoice: "conservative",
      }),
    ).rejects.toThrow(/archive root must be outside the state home/);
    // Same clause on reset (§6 wording: --archive-root outside the active
    // state home).
    const rw = await makeResetWorld();
    cleanups.push(() => rw.cleanup());
    await expect(
      planAppReset({
        orgHome: rw.orgHome,
        stateHome: rw.stateHome,
        appsFile: rw.appsFile,
        appName: TARGET_APP,
        gh: rw.gh,
        archiveRoot: join(rw.stateHome, "nested"),
      }),
    ).rejects.toThrow(/--archive-root must be outside the active state home/);
  });

  it("§3 + error split: a blocked upgrade plan refuses execution before any domain mutation", async () => {
    const w = await makeUpgradeWorld("oplife-blocked");
    cleanups.push(() => w.cleanup());
    // No authority choice on a legacy org without AUTHORITY.md ⇒ blocked plan.
    const input: OrgUpgradeOptions = { orgHome: w.orgHome, stateHome: w.stateHome, archiveRoot: w.archiveRoot };
    const plan = await planOrgUpgrade(input);
    expect(plan.executable).toBe(false);
    expect(plan.blockers.map((blocker) => blocker.code)).toContain("authority_choice_required");
    const before = await snapshotTree(w.orgHome);
    await expect(executeOrgUpgrade(input, plan)).rejects.toThrow(/blocked — authority_choice_required/);
    const diff = diffSnapshots(before, await snapshotTree(w.orgHome));
    expect(diffIsEmpty(diff), `blocked upgrade mutated: ${diffPaths(diff).join(", ")}`).toBe(true);
  });

  it("§4: a missing lifecycle record is a TYPED verification result with zero provider construction, and the preview form writes nothing", async () => {
    const w = await makeResetWorld();
    cleanups.push(() => w.cleanup());
    const before = await snapshotWorld(w);
    const report = await verifyApp({
      orgHome: w.orgHome,
      stateHome: w.stateHome,
      appName: TARGET_APP,
      synchronize: false, // the promotion-preview form: non-mutating
      writeReadiness: false,
      recordEvidence: false,
    });
    // Typed, never a raw ENOENT; the claim stays at "registered" (INV-008).
    expect(report.kind).toBe("app-verification");
    expect(report.status).toBe("blocked");
    expect(report.evidence_state).toBe("registered");
    const check = report.checks.find((item) => item.id === "lifecycle-record");
    expect(check).toBeDefined();
    expect(check!.status).toBe("blocked");
    expect(check!.remediation).toContain("app verify");
    // "without starting a runtime": the product's own provider evidence.
    expect(report.provider).toEqual({ factories: 0, processes: 0, turns: 0, settlements: 0 });
    // Non-mutating preview: not one byte moved anywhere in the world.
    const diff = diffWorld(before, await snapshotWorld(w));
    expect(diff.org).toEqual({ added: [], removed: [], changed: [] });
    expect(diff.state).toEqual({ added: [], removed: [], changed: [] });
    expect(diff.human).toEqual({ added: [], removed: [], changed: [] });
  });

  it("§5: promote preview is non-mutating with actionable remediation; execute refuses on unverifiable state (error split: precondition refusal)", async () => {
    const w = await makeResetWorld();
    cleanups.push(() => w.cleanup());
    const before = await snapshotWorld(w);
    const options = {
      orgHome: w.orgHome,
      stateHome: w.stateHome,
      appName: TARGET_APP,
      to: "live" as const,
    };
    const plan = await planAppPromotion(options);
    expect(plan.kind).toBe("app-promotion-plan");
    expect(plan.executable).toBe(false);
    expect(plan.verification.status).toBe("blocked");
    const remediation = plan.verification.checks.find((check) => check.id === "lifecycle-record");
    expect(remediation?.remediation).toContain("retry promotion");

    await expect(executeAppPromotion(options, plan)).rejects.toThrow(/verification is blocked; promotion refused/);
    // Preview + refused execute together mutated nothing (the lifecycle
    // operation lock is created and released; only files count here).
    const diff = diffWorld(before, await snapshotWorld(w));
    expect(diff.org).toEqual({ added: [], removed: [], changed: [] });
    expect(diff.state).toEqual({ added: [], removed: [], changed: [] });
    expect(diff.human).toEqual({ added: [], removed: [], changed: [] });
  });

  it("§6 + error split: the reviewed-plan identity check refuses a plan/app mismatch before locks, intent, or archive", async () => {
    const w = await makeResetWorld();
    cleanups.push(() => w.cleanup());
    const input: AppResetOptions = {
      orgHome: w.orgHome,
      stateHome: w.stateHome,
      appsFile: w.appsFile,
      appName: TARGET_APP,
      gh: w.gh,
      archiveRoot: w.archiveRoot,
    };
    const plan = await planAppReset(input);
    const before = await snapshotWorld(w);
    // Identity mismatch: the reviewed plan names alpha, the request names beta.
    await expect(executeAppReset({ ...input, appName: "beta" }, plan)).rejects.toThrow(
      /reviewed plan does not match the requested app and homes/,
    );
    const diff = diffWorld(before, await snapshotWorld(w));
    expect(diff.state).toEqual({ added: [], removed: [], changed: [] });
    expect(diff.org).toEqual({ added: [], removed: [], changed: [] });
  });

  it("error split (journaled intermediate): a mid-closes failure leaves the durable intent + archive, restores local state, and the rerun completes without duplicating closes", async () => {
    const w = await makeResetWorld();
    cleanups.push(() => w.cleanup());
    const input: AppResetOptions = {
      orgHome: w.orgHome,
      stateHome: w.stateHome,
      appsFile: w.appsFile,
      appName: TARGET_APP,
      gh: w.gh,
      archiveRoot: w.archiveRoot,
    };
    // Fail between the PR close and the issue close.
    const failing: AppResetOptions = {
      ...input,
      fault: (point) => {
        if (point === "before_issue_update") throw new Error("cf-c-oplife: injected close failure");
      },
    };
    const plan = await planAppReset(failing);
    await expect(executeAppReset(failing, plan)).rejects.toThrow(/injected close failure/);

    // The operation-specific recoverable intermediate (§6 + error clause):
    // durable intent still present, checksummed archive present, local state
    // restored, registry intact.
    expect(existsSync(join(w.stateHome, "lifecycle", "transactions", `reset-${TARGET_APP}.json`))).toBe(true);
    expect(existsSync(join(w.archiveRoot, plan.archiveId, "manifest.json"))).toBe(true);
    expect(existsSync(join(w.stateHome, "runs", TARGET_APP, "seed-run", "artifact.txt"))).toBe(true);
    expect((await loadApps(join(w.orgHome, "apps.yaml"))).apps.map((app) => app.name)).toContain(TARGET_APP);

    // Resumable: the rerun completes; the PR closed exactly once across both
    // attempts (J-13: never re-perform an external effect).
    const rerun = await executeAppReset(input, await planAppReset(input));
    expect(rerun.archivePath).toBe(join(w.archiveRoot, plan.archiveId));
    const log = w.handle.callLog().slice(w.baseCallCount);
    expect(log.filter((entry) => entry.op === "pr.close").length).toBe(1);
    expect(log.filter((entry) => entry.op === "issue.close").length).toBe(1);
    expect(existsSync(join(w.stateHome, "lifecycle", "transactions", `reset-${TARGET_APP}.json`))).toBe(false);
  });

  it("negative control: a lying preview (stale reviewed upgrade plan) — the staleness detector FIRES before any write", async () => {
    const w = await makeUpgradeWorld("oplife-stale-plan");
    cleanups.push(() => w.cleanup());
    const input: OrgUpgradeOptions = {
      orgHome: w.orgHome,
      stateHome: w.stateHome,
      archiveRoot: w.archiveRoot,
      authorityChoice: "conservative",
    };
    const plan = await planOrgUpgrade(input);
    // SEEDED VIOLATION: the org moves after the review — the reviewed plan
    // no longer describes the world it would mutate.
    await writeFile(join(w.orgHome, "TASTE.md"), "# landed after the preview\n", "utf8");
    const before = await snapshotTree(w.orgHome);
    await expect(executeOrgUpgrade(input, plan)).rejects.toThrow(/reviewed plan is stale/);
    const diff = diffSnapshots(before, await snapshotTree(w.orgHome));
    expect(diffIsEmpty(diff), `stale execute mutated: ${diffPaths(diff).join(", ")}`).toBe(true);
  });
});
