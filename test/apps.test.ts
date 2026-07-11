// Tests the app registry loader and trigger override behavior in src/org/apps.ts.
// Covers apps.yaml validation, default budgets, root registry parsing, manual
// triggers, and the rule that cadence overrides replace role triggers.
// Temp YAML files are just parser fixtures; the root apps.yaml assertion reads
// repo-local config but uses no network, auth, or real org runtime state.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadApps, resolveTriggers, type AppEntry } from "../src/org/apps.js";
import type { RoleConfig } from "../src/runtime/types.js";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Write YAML to a temp apps.yaml and return its path. */
function appsFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "operon-apps-"));
  tempDirs.push(dir);
  const path = join(dir, "apps.yaml");
  writeFileSync(path, content);
  return path;
}

const VALID = `
org:
  name: operon
  max_concurrent_turns: 2
defaults:
  budget_usd_month: 1000
apps:
  civic:
    repo: owner/civic
    status: live
    cadence:
      support: []
      planner: [{schedule: "daily 08:00"}]
  buildstacks:
    repo: buildstacks-dev/buildstacks.dev
    status: onboarding
`;

describe("loadApps", () => {
  it("valid file parses", async () => {
    const { org, defaults, apps } = await loadApps(appsFile(VALID));
    expect(org).toEqual({ name: "operon", maxConcurrentTurns: 2 });
    expect(defaults.budgetUsdMonth).toBe(1000);
    expect(apps.map((a) => a.name)).toEqual(["civic", "buildstacks"]);

    const civic = apps[0]!;
    expect(civic.repo).toBe("owner/civic");
    expect(civic.status).toBe("live");
    expect(civic.budgetUsdMonth).toBe(1000); // inherited from defaults
    expect(civic.cadence).toEqual({
      support: [],
      planner: [{ schedule: "daily 08:00" }],
    });

    const buildstacks = apps[1]!;
    expect(buildstacks.status).toBe("onboarding");
    expect(buildstacks.cadence).toEqual({}); // cadence is optional
  });

  it("rejects an unknown status", async () => {
    const path = appsFile(`
org: {name: operon}
apps:
  civic: {repo: owner/civic, status: launched}
`);
    await expect(loadApps(path)).rejects.toThrow(/status must be one of live \| paused \| onboarding/);
  });

  it("rejects a missing apps mapping", async () => {
    const path = appsFile(`
org: {name: operon}
defaults: {budget_usd_month: 1000}
`);
    await expect(loadApps(path)).rejects.toThrow(/missing top-level "apps" mapping/);
  });

  it("rejects a cadence trigger with neither schedule nor event", async () => {
    const path = appsFile(`
org: {name: operon}
apps:
  civic:
    repo: owner/civic
    status: live
    cadence:
      planner: [{note: "not a trigger"}]
`);
    await expect(loadApps(path)).rejects.toThrow(/trigger needs schedule, event, or manual/);
  });

  it("parses manual cadence triggers", async () => {
    const path = appsFile(`
org: {name: operon}
apps:
  civic:
    repo: owner/civic
    status: live
    cadence:
      planner: [{manual: true}]
`);
    const { apps } = await loadApps(path);
    expect(apps[0]!.cadence.planner).toEqual([{ manual: true }]);
  });

  it("rejects a missing repo", async () => {
    const path = appsFile(`
org: {name: operon}
apps:
  civic: {status: live}
`);
    await expect(loadApps(path)).rejects.toThrow(/repo is required/);
  });

  it("applies per-app budget override over defaults", async () => {
    const path = appsFile(`
org: {name: operon}
defaults: {budget_usd_month: 1000}
apps:
  civic: {repo: owner/civic, status: live, budget_usd_month: 250}
`);
    const { apps } = await loadApps(path);
    expect(apps[0]!.budgetUsdMonth).toBe(250);
  });

  it("exposes schema_version when present", async () => {
    const path = appsFile(`
schema_version: 1
org: {name: operon}
apps:
  civic: {repo: owner/civic, status: live}
`);
    const file = await loadApps(path);
    expect(file.schemaVersion).toBe(1);
  });
});

describe("release block (A4)", () => {
  const base = (release: string) => `
org:
  name: operon
  max_concurrent_turns: 2
defaults:
  budget_usd_month: 1000
apps:
  site:
    repo: owner/site
    status: live
${release}
`;

  it("parses a deploy release with command and owner", async () => {
    const { apps } = await loadApps(
      appsFile(base(`    release:
      kind: deploy
      command: gh workflow run deploy.yml
      owner: sre`)),
    );
    expect(apps[0]?.release).toEqual({
      kind: "deploy",
      command: "gh workflow run deploy.yml",
      owner: "sre",
    });
  });

  it("defaults owner to orchestrator and accepts merge-only without a command", async () => {
    const { apps } = await loadApps(
      appsFile(base(`    release:
      kind: merge-only`)),
    );
    expect(apps[0]?.release).toEqual({ kind: "merge-only", owner: "orchestrator" });
  });

  it("absent release block leaves the entry undeclared", async () => {
    const { apps } = await loadApps(appsFile(base("")));
    expect(apps[0]?.release).toBeUndefined();
  });

  it("rejects deploy without a command", async () => {
    await expect(
      loadApps(appsFile(base(`    release:
      kind: deploy`))),
    ).rejects.toThrow(/release\.command is required for kind "deploy"/);
  });

  it("rejects a command on merge-only", async () => {
    await expect(
      loadApps(appsFile(base(`    release:
      kind: merge-only
      command: echo nothing`))),
    ).rejects.toThrow(/release\.command is meaningless for merge-only/);
  });

  it("rejects unknown kinds, owners, and keys", async () => {
    await expect(
      loadApps(appsFile(base(`    release:
      kind: yolo`))),
    ).rejects.toThrow(/release\.kind must be one of deploy \| package \| merge-only/);
    await expect(
      loadApps(appsFile(base(`    release:
      kind: package
      command: npm publish
      owner: intern`))),
    ).rejects.toThrow(/release\.owner must be one of orchestrator \| sre/);
    await expect(
      loadApps(appsFile(base(`    release:
      kind: merge-only
      approver: me`))),
    ).rejects.toThrow(/release: unknown key "approver"/);
  });
});

describe("new org registry", () => {
  it("accepts a newly initialized org with no registered apps", async () => {
    const file = await loadApps(
      appsFile(`schema_version: 1
org:
  name: fresh
  max_concurrent_turns: 2
defaults:
  budget_usd_month: 1000
apps: {}
`),
    );
    expect(file.org.name).toBe("fresh");
    expect(file.apps).toEqual([]);
  });
});

describe("resolveTriggers", () => {
  const role: RoleConfig = {
    name: "planner",
    runtime: "claude",
    model: "claude-opus-4-8",
    effort: "high",
    delegation: { allow: [] },
    triggers: [{ schedule: "daily 07:00" }, { schedule: "weekly mon" }],
    outputs: ["tickets"],
    maxTurnBudgetUsd: 5,
  };

  const app = (cadence: AppEntry["cadence"]): AppEntry => ({
    name: "civic",
    repo: "owner/civic",
    status: "live",
    budgetUsdMonth: 1000,
    cadence,
  });

  it("falls back to the role's roles.yaml triggers when there is no override", () => {
    expect(resolveTriggers(role, app({}))).toEqual(role.triggers);
  });

  it("disables the role on an empty override list", () => {
    expect(resolveTriggers(role, app({ planner: [] }))).toEqual([]);
  });

  it("replaces (never merges) the role's triggers when an override is present", () => {
    const override = [{ schedule: "daily 08:00" }];
    expect(resolveTriggers(role, app({ planner: override }))).toEqual(override);
  });

  it("ignores overrides addressed to other roles", () => {
    expect(resolveTriggers(role, app({ support: [] }))).toEqual(role.triggers);
  });
});
