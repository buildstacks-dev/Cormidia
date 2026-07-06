// App registry loader (M3.1) — apps.yaml validation + resolveTriggers
// semantics (docs/architecture.md §2, §7): cadence overrides REPLACE a
// role's roles.yaml triggers, an empty list disables the role, no override
// falls back.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadApps, resolveTriggers, type AppEntry } from "../src/org/apps.js";
import type { RoleConfig } from "../src/runtime/types.js";

const APPS_PATH = fileURLToPath(new URL("../apps.yaml", import.meta.url));

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

describe("root apps.yaml (this repo as its own org home)", () => {
  it("parses with the self-referential placeholder and sandbox app entries", async () => {
    const { org, apps } = await loadApps(APPS_PATH);
    expect(org.name).toBe("operon");
    expect(org.maxConcurrentTurns).toBe(2);
    expect(apps).toHaveLength(6);
    expect(apps[0]!.name).toBe("operon");
    expect(apps[0]!.repo).toBe("buildstacks-dev/Operon");
    expect(apps[0]!.status).toBe("onboarding");
    expect(apps[1]).toMatchObject({
      name: "operon-sandbox-alpha",
      repo: "bikramgupta/operon-sandbox-alpha",
      status: "live",
      budgetUsdMonth: 1000,
    });
    expect(apps[2]).toMatchObject({
      name: "operon-sandbox-beta",
      repo: "bikramgupta/operon-sandbox-beta",
      status: "onboarding",
      budgetUsdMonth: 1000,
    });
    expect(apps[3]).toMatchObject({
      name: "operon-sandbox-gamma",
      repo: "bikramgupta/operon-sandbox-gamma",
      status: "onboarding",
      budgetUsdMonth: 1000,
    });
    expect(apps[4]).toMatchObject({
      name: "buildstacks.dev",
      repo: "buildstacks-dev/buildstacks.dev",
      status: "onboarding",
      budgetUsdMonth: 1000,
    });
    expect(apps[4]!.cadence).toEqual({ support: [] });
    expect(apps[5]).toMatchObject({
      name: "operon-sandbox-delta",
      repo: "bikramgupta/operon-sandbox-delta",
      status: "onboarding",
      budgetUsdMonth: 1000,
    });
    expect(apps[5]!.cadence).toEqual({});
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
