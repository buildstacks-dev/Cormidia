// Proves the M0.3 fixture: each sub-builder works alone, sub-builders
// compose without leaking into each other, cleanup() is total, and
// FakeClock's now()/advance() are deterministic. This is the fixture's own
// test — later suites (memory, dispatcher, approvals, runlog) consume
// `makeOrgHome`/`makeAppRepo` without re-proving any of this.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { makeAppRepo, makeOrgHome } from "./orgHome.js";
import { FakeClock } from "./fakeClock.js";

describe("makeOrgHome", () => {
  it("with no options creates an empty root", () => {
    const fixture = makeOrgHome();
    expect(existsSync(fixture.root)).toBe(true);
    expect(readdirSync(fixture.root)).toEqual([]);
    fixture.cleanup();
  });

  it("taste sub-builder: default placeholder, custom org content, role addenda", () => {
    const withDefault = makeOrgHome({ taste: true });
    expect(readFileSync(withDefault.paths.taste, "utf8")).toContain("TASTE");
    withDefault.cleanup();

    const custom = makeOrgHome({
      taste: { org: "# Custom Org Taste\n", roles: { builder: "# Builder craft\n" } },
    });
    expect(readFileSync(custom.paths.taste, "utf8")).toBe("# Custom Org Taste\n");
    expect(readFileSync(custom.paths.roleTaste("builder"), "utf8")).toBe("# Builder craft\n");
    expect(existsSync(custom.paths.roleTaste("reviewer"))).toBe(false);
    custom.cleanup();
  });

  it("memory sub-builder: role bundles with INDEX.md + docs", () => {
    const fixture = makeOrgHome({
      memory: {
        roles: {
          builder: {
            index: "- prefer-fixture-factories\n",
            docs: [{ name: "prefer-fixture-factories", content: "Body text.\n" }],
          },
        },
      },
    });
    expect(readFileSync(fixture.paths.memoryIndex("builder"), "utf8")).toBe(
      "- prefer-fixture-factories\n",
    );
    expect(readFileSync(fixture.paths.memoryDoc("builder", "prefer-fixture-factories"), "utf8")).toBe(
      "Body text.\n",
    );
    // .md extension auto-appended even when the caller omits it.
    expect(existsSync(fixture.paths.memoryDoc("builder", "prefer-fixture-factories.md"))).toBe(true);
    fixture.cleanup();
  });

  it("memory sub-builder opted into with no roles still creates memory/roles", () => {
    const fixture = makeOrgHome({ memory: true });
    expect(existsSync(fixture.paths.memoryRoleDir("builder").replace(/\/builder$/, ""))).toBe(true);
    fixture.cleanup();
  });

  it("state sub-builder: schedule, turns, events inbox, consumed keys, locks", () => {
    const fixture = makeOrgHome({
      state: {
        schedule: { "civic|builder|hourly": "2026-07-04T09:00:00.000Z" },
        turns: { "t-1": { turnId: "t-1", phase: "running" } },
        eventsInbox: { "alert-1": { kind: "alert" } },
        consumedEventKeys: ["ticket-ready:42"],
        locks: { "civic--builder": { pid: 123 } },
      },
    });

    expect(JSON.parse(readFileSync(fixture.paths.schedule, "utf8"))).toEqual({
      "civic|builder|hourly": "2026-07-04T09:00:00.000Z",
    });
    expect(JSON.parse(readFileSync(fixture.paths.turn("t-1"), "utf8"))).toEqual({
      turnId: "t-1",
      phase: "running",
    });
    expect(JSON.parse(readFileSync(fixture.paths.eventsInboxFile("alert-1"), "utf8"))).toEqual({
      kind: "alert",
    });
    expect(JSON.parse(readFileSync(fixture.paths.consumedEvents, "utf8"))).toEqual([
      "ticket-ready:42",
    ]);
    expect(JSON.parse(readFileSync(fixture.paths.lock("civic", "builder"), "utf8"))).toEqual({
      pid: 123,
    });
    fixture.cleanup();
  });

  it("state sub-builder rejects a malformed lock key", () => {
    expect(() => makeOrgHome({ state: { locks: { "not-a-valid-key": {} } } })).toThrow(
      /must be shaped/,
    );
  });

  it("approvals sub-builder: pending, decided, grants, log in order", () => {
    const fixture = makeOrgHome({
      approvals: {
        pending: { "20260704T193201Z-8k2f": { app: "civic", rule: "secrets-or-auth" } },
        decided: { "20260704T180000Z-aaaa": { app: "civic", status: "denied" } },
        grants: { "grant-1": { app: "civic", uses: 1 } },
        log: [{ event: "raised", id: "20260704T193201Z-8k2f" }, { event: "denied", id: "20260704T180000Z-aaaa" }],
      },
    });

    expect(JSON.parse(readFileSync(fixture.paths.approvalsPending("20260704T193201Z-8k2f"), "utf8"))).toEqual(
      { app: "civic", rule: "secrets-or-auth" },
    );
    expect(JSON.parse(readFileSync(fixture.paths.approvalsDecided("20260704T180000Z-aaaa"), "utf8"))).toEqual(
      { app: "civic", status: "denied" },
    );
    expect(JSON.parse(readFileSync(fixture.paths.grant("grant-1"), "utf8"))).toEqual({
      app: "civic",
      uses: 1,
    });
    const logLines = readFileSync(fixture.paths.approvalsLog, "utf8").trim().split("\n");
    expect(logLines.map((line) => JSON.parse(line))).toEqual([
      { event: "raised", id: "20260704T193201Z-8k2f" },
      { event: "denied", id: "20260704T180000Z-aaaa" },
    ]);
    fixture.cleanup();
  });

  it("runs sub-builder: per-app directories, or a bare runs/ when unspecified", () => {
    const withApps = makeOrgHome({ runs: { apps: ["civic", "buildstacks"] } });
    expect(existsSync(withApps.paths.runsAppDir("civic"))).toBe(true);
    expect(existsSync(withApps.paths.runsAppDir("buildstacks"))).toBe(true);
    withApps.cleanup();

    const bare = makeOrgHome({ runs: true });
    expect(existsSync(bare.paths.runsAppDir("civic"))).toBe(false);
    expect(readdirSync(bare.root)).toEqual(["runs"]);
    bare.cleanup();
  });

  it("composes memory + approvals together without pulling in unrelated sub-trees", () => {
    const fixture = makeOrgHome({
      memory: { roles: { builder: { index: "idx\n" } } },
      approvals: { pending: { "id-1": { app: "civic" } } },
    });

    expect(existsSync(fixture.paths.memoryIndex("builder"))).toBe(true);
    expect(existsSync(fixture.paths.approvalsPending("id-1"))).toBe(true);
    // Opted-out sub-trees do not appear at all.
    expect(existsSync(fixture.paths.taste)).toBe(false);
    expect(existsSync(join(fixture.root, "state"))).toBe(false);
    expect(existsSync(join(fixture.root, "runs"))).toBe(false);
    fixture.cleanup();
  });

  it("composes all five sub-builders together", () => {
    const fixture = makeOrgHome({
      taste: true,
      memory: { roles: { builder: {} } },
      state: { schedule: { "civic|builder|hourly": "x" } },
      approvals: { pending: { "id-1": {} } },
      runs: { apps: ["civic"] },
    });

    expect(existsSync(fixture.paths.taste)).toBe(true);
    expect(existsSync(fixture.paths.memoryIndex("builder"))).toBe(true);
    expect(existsSync(fixture.paths.schedule)).toBe(true);
    expect(existsSync(fixture.paths.approvalsPending("id-1"))).toBe(true);
    expect(existsSync(fixture.paths.runsAppDir("civic"))).toBe(true);
    fixture.cleanup();
  });

  it("cleanup() removes everything and is safe to call twice", () => {
    const fixture = makeOrgHome({ taste: true, approvals: { pending: { "id-1": {} } } });
    expect(existsSync(fixture.root)).toBe(true);
    fixture.cleanup();
    expect(existsSync(fixture.root)).toBe(false);
    expect(() => fixture.cleanup()).not.toThrow();
  });
});

describe("makeAppRepo", () => {
  it("taste sub-builder: default placeholder and custom content", () => {
    const fixture = makeAppRepo({ taste: "# Civic charter\n" });
    expect(readFileSync(fixture.paths.taste, "utf8")).toBe("# Civic charter\n");
    fixture.cleanup();
  });

  it("config sub-builder: default stub and custom object round-trip through yaml", () => {
    const withDefault = makeAppRepo({ config: true });
    expect(parseYaml(readFileSync(withDefault.paths.config, "utf8"))).toEqual({ schema_version: 1 });
    withDefault.cleanup();

    const custom = makeAppRepo({
      config: { schema_version: 1, budget_usd_month: 1000, cadence: "flexi" },
    });
    expect(parseYaml(readFileSync(custom.paths.config, "utf8"))).toEqual({
      schema_version: 1,
      budget_usd_month: 1000,
      cadence: "flexi",
    });
    custom.cleanup();
  });

  it("memory sub-builder: .operon/memory/<role>/ with no 'roles' segment", () => {
    const fixture = makeAppRepo({
      memory: { roles: { planner: { index: "idx\n", docs: [{ name: "lesson", content: "…\n" }] } } },
    });
    expect(readFileSync(fixture.paths.memoryIndex("planner"), "utf8")).toBe("idx\n");
    expect(fixture.paths.memoryRoleDir("planner")).toBe(join(fixture.operonDir, "memory", "planner"));
    expect(fixture.paths.memoryRoleDir("planner")).not.toContain(join("memory", "roles"));
    fixture.cleanup();
  });

  it("org sub-builder: single-app profile mirrors org-home layout under .operon/org/", () => {
    const fixture = makeAppRepo({
      org: {
        taste: { org: "# Org constitution\n", roles: { reviewer: "# Reviewer craft\n" } },
        memory: { roles: { builder: { index: "idx\n" } } },
      },
    });

    expect(readFileSync(fixture.paths.orgTaste, "utf8")).toBe("# Org constitution\n");
    expect(readFileSync(fixture.paths.orgRoleTaste("reviewer"), "utf8")).toBe("# Reviewer craft\n");
    expect(existsSync(fixture.paths.orgMemoryRoleDir("builder"))).toBe(true);
    // The nested org profile never gets runtime-state dirs.
    expect(existsSync(join(fixture.paths.orgDir, "state"))).toBe(false);
    expect(existsSync(join(fixture.paths.orgDir, "approvals"))).toBe(false);
    fixture.cleanup();
  });

  it("composes memory + org together", () => {
    const fixture = makeAppRepo({
      memory: { roles: { support: { index: "idx\n" } } },
      org: { taste: true },
    });
    expect(existsSync(fixture.paths.memoryIndex("support"))).toBe(true);
    expect(existsSync(fixture.paths.orgTaste)).toBe(true);
    expect(existsSync(fixture.paths.taste)).toBe(false); // app-level taste not opted into
    fixture.cleanup();
  });

  it("cleanup() removes the whole app-repo tree", () => {
    const fixture = makeAppRepo({ taste: true, config: true });
    expect(existsSync(fixture.root)).toBe(true);
    fixture.cleanup();
    expect(existsSync(fixture.root)).toBe(false);
  });
});

describe("FakeClock", () => {
  it("defaults to the Unix epoch", () => {
    expect(new FakeClock().now().toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });

  it("starts at a given time", () => {
    expect(new FakeClock("2026-07-04T09:00:00.000Z").now().toISOString()).toBe(
      "2026-07-04T09:00:00.000Z",
    );
  });

  it("advance() moves now() forward deterministically and cumulatively", () => {
    const clock = new FakeClock("2026-07-04T09:00:00.000Z");
    clock.advance(1000);
    expect(clock.now().toISOString()).toBe("2026-07-04T09:00:01.000Z");
    clock.advance(59_000);
    expect(clock.now().toISOString()).toBe("2026-07-04T09:01:00.000Z");
  });

  it("advance() rejects negative durations", () => {
    const clock = new FakeClock();
    expect(() => clock.advance(-1)).toThrow(/non-negative/);
  });

  it("set() jumps directly to an absolute time", () => {
    const clock = new FakeClock("2026-07-04T09:00:00.000Z");
    clock.set("2027-01-01T00:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
