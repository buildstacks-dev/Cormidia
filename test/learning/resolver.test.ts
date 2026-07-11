// The learning resolver (learning-loop M4, spec §8.1, design §12.1).
// Covers milestone Done-means #1 (disable takes effect for subsequent
// resolves while siblings keep resolving), #5 (an expired provisional never
// resolves and its expiry is an event), #8 (an org-scope flood cannot starve
// apps/<app>/roles/<role> selection), plus conflict-before-budget,
// deterministic byte-identical rendering, and protected-tier fail-loud.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appLearningRoot,
  bundleScopeDir,
  disableConcept,
  orgLearningRoot,
  quarantineDir,
} from "../../src/org/learning/concepts.js";
import { readLearningEvents } from "../../src/org/learning/events.js";
import { defaultLearningPolicy } from "../../src/org/learning/policy.js";
import {
  resolveLearningContext,
  resolvedContextPath,
  type ResolveInput,
} from "../../src/org/learning/resolver.js";
import { makeAppRepo, makeOrgHome, type AppRepoFixture, type OrgHomeFixture } from "../fixtures/orgHome.js";
import { conceptMarkdown, type ConceptMarkdownOptions } from "./helpers.js";
import { existsSync } from "node:fs";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

interface Rig {
  orgHome: OrgHomeFixture;
  stateHome: OrgHomeFixture;
  appRepo: AppRepoFixture;
  input: ResolveInput;
}

function makeRig(policy = defaultLearningPolicy()): Rig {
  const orgHome = makeOrgHome();
  const stateHome = makeOrgHome();
  const appRepo = makeAppRepo();
  cleanups.push(orgHome.cleanup, stateHome.cleanup, appRepo.cleanup);
  return {
    orgHome,
    stateHome,
    appRepo,
    input: {
      orgHome: orgHome.root,
      appWorkdir: appRepo.root,
      app: "alpha",
      role: "builder",
      turnId: "turn-1",
      episodeId: "ep_alpha_ticket_0001",
      taskText: "builder turn for alpha",
      policy,
      clock: () => new Date("2026-07-11T10:00:00Z"),
    },
  };
}

function seed(
  rig: Rig,
  where: "org-bundle" | "app-bundle" | "org-quarantine",
  options: ConceptMarkdownOptions,
): void {
  const dir =
    where === "org-bundle"
      ? bundleScopeDir(orgLearningRoot(rig.orgHome.root), options.scope)
      : where === "app-bundle"
        ? bundleScopeDir(appLearningRoot(rig.appRepo.root), options.scope)
        : quarantineDir(orgLearningRoot(rig.orgHome.root));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${options.name}.md`), conceptMarkdown(options), "utf8");
}

describe("gathering and precedence", () => {
  it("loads active concepts from all four scopes in precedence order, sorted by id in scope", async () => {
    const rig = makeRig();
    seed(rig, "org-bundle", { name: "o", id: "lrn_org", scope: "org", status: "active" });
    seed(rig, "org-bundle", { name: "r2", id: "lrn_role-b", scope: "roles/builder", status: "active" });
    seed(rig, "org-bundle", { name: "r1", id: "lrn_role-a", scope: "roles/builder", status: "active" });
    seed(rig, "app-bundle", { name: "a", id: "lrn_app", scope: "apps/alpha", status: "active" });
    seed(rig, "app-bundle", {
      name: "ar",
      id: "lrn_app-role",
      scope: "apps/alpha/roles/builder",
      status: "active",
    });

    const resolved = await resolveLearningContext(rig.input);
    expect(resolved.concept_ids).toEqual([
      "lrn_org",
      "lrn_role-a",
      "lrn_role-b",
      "lrn_app",
      "lrn_app-role",
    ]);
    expect(resolved.bundle_lineage).toBe("stable");
  });

  it("skips deprecated concepts and concepts scoped to other roles/apps", async () => {
    const rig = makeRig();
    seed(rig, "org-bundle", { name: "dead", id: "lrn_dead", scope: "org", status: "deprecated" });
    seed(rig, "org-bundle", {
      name: "other-role",
      id: "lrn_other",
      scope: "roles/reviewer",
      status: "active",
    });
    const resolved = await resolveLearningContext(rig.input);
    expect(resolved.concept_ids).toEqual([]);
  });
});

describe("disable takes effect immediately for subsequent resolves (Done #1)", () => {
  it("a disabled concept stops resolving while its sibling keeps resolving", async () => {
    const rig = makeRig();
    seed(rig, "org-bundle", { name: "bad", id: "lrn_bad", scope: "roles/builder", status: "active" });
    seed(rig, "org-bundle", { name: "good", id: "lrn_good", scope: "roles/builder", status: "active" });

    const before = await resolveLearningContext(rig.input);
    expect(before.concept_ids).toEqual(["lrn_bad", "lrn_good"]);
    // The in-flight turn's pin is this immutable resolved value — disable
    // below cannot reach into it (resolve runs once at turn start).
    const pinnedSections = [...before.sections];

    await disableConcept(orgLearningRoot(rig.orgHome.root), "lrn_bad");

    const after = await resolveLearningContext({ ...rig.input, turnId: "turn-2" });
    expect(after.concept_ids).toEqual(["lrn_good"]);
    expect(pinnedSections.join("\n")).toContain("lrn_bad".replace("lrn_", "")); // pin unchanged
  });
});

describe("provisional TTL enforcement (Done #5)", () => {
  it("an unexpired provisional resolves under the UNVERIFIED label; an expired one never resolves and emits provisional_expired", async () => {
    const rig = makeRig();
    seed(rig, "org-quarantine", {
      name: "fresh",
      id: "lrn_fresh",
      scope: "roles/builder",
      status: "provisional",
      created: "2026-07-10",
      ttlDays: 7,
      author: "human-operator",
    });
    seed(rig, "org-quarantine", {
      name: "stale",
      id: "lrn_stale",
      scope: "roles/builder",
      status: "provisional",
      created: "2026-06-01",
      ttlDays: 7,
      author: "human-operator",
    });

    const resolved = await resolveLearningContext({ ...rig.input, stateHome: rig.stateHome.root });
    expect(resolved.concept_ids).toEqual(["lrn_fresh"]);
    expect(resolved.sections.join("\n")).toContain("UNVERIFIED - provisional");

    const events = await readLearningEvents(rig.stateHome.root);
    const expiry = events.filter((event) => event.type === "provisional_expired");
    expect(expiry).toHaveLength(1);
    expect(expiry[0]?.payload).toMatchObject({ concept_id: "lrn_stale" });
    const loads = events.filter((event) => event.type === "concept_loaded");
    expect(loads.map((event) => event.payload?.["concept_id"])).toEqual(["lrn_fresh"]);
  });
});

describe("conflicts resolve before budgeting (spec §8.1 step 2)", () => {
  it("the narrower scope wins a shared topic_key and the loser emits conflict_resolved", async () => {
    const rig = makeRig();
    seed(rig, "org-bundle", {
      name: "broad",
      id: "lrn_broad",
      scope: "org",
      status: "active",
      topicKey: "support.missing_payload",
    });
    seed(rig, "app-bundle", {
      name: "narrow",
      id: "lrn_narrow",
      scope: "apps/alpha/roles/builder",
      status: "active",
      topicKey: "support.missing_payload",
    });
    const resolved = await resolveLearningContext({ ...rig.input, stateHome: rig.stateHome.root });
    expect(resolved.concept_ids).toEqual(["lrn_narrow"]);

    const conflicts = (await readLearningEvents(rig.stateHome.root)).filter(
      (event) => event.type === "conflict_resolved",
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.payload).toMatchObject({ winner: "lrn_narrow", loser: "lrn_broad" });
  });
});

describe("budget shares with narrowest-first redistribution (Done #8)", () => {
  it("an org-scope flood cannot starve apps/<app>/roles/<role> selection", async () => {
    const policy = defaultLearningPolicy();
    policy.context_budget.default_bytes = 2048; // org share: 512 bytes
    const rig = makeRig(policy);
    // Ten ~350-byte org concepts — far over the whole budget on their own.
    for (let i = 0; i < 10; i++) {
      seed(rig, "org-bundle", {
        name: `flood-${i}`,
        id: `lrn_flood-${i}`,
        scope: "org",
        status: "active",
        body: "f".repeat(300),
      });
    }
    seed(rig, "app-bundle", {
      name: "narrow",
      id: "lrn_narrow",
      scope: "apps/alpha/roles/builder",
      status: "active",
    });

    const resolved = await resolveLearningContext({ ...rig.input, stateHome: rig.stateHome.root });
    // The narrow concept always resolves; the flood fills only org's share
    // plus whatever redistributes AFTER narrower scopes were served.
    expect(resolved.concept_ids).toContain("lrn_narrow");
    expect(resolved.context_bytes).toBeLessThanOrEqual(2048);
    expect(resolved.concept_ids.filter((id) => id.startsWith("lrn_flood"))).not.toHaveLength(10);

    const evictions = (await readLearningEvents(rig.stateHome.root)).filter(
      (event) => event.type === "context_evicted",
    );
    expect(evictions.length).toBeGreaterThan(0);
    expect(evictions.every((event) => String(event.payload?.["concept_id"]).startsWith("lrn_flood"))).toBe(
      true,
    );
  });

  it("dropping a protected-tier concept fails loud instead of evicting", async () => {
    const policy = defaultLearningPolicy();
    policy.context_budget.default_bytes = 256;
    const rig = makeRig(policy);
    seed(rig, "org-bundle", {
      name: "protected",
      id: "lrn_protected",
      scope: "org",
      status: "active",
      tier: "T2",
      body: "p".repeat(1024),
    });
    await expect(resolveLearningContext(rig.input)).rejects.toThrow(/protected T2 .* fail loud/);
  });
});

describe("cache stability (design §12.1)", () => {
  it("renders byte-identically across resolves and turn ids; no turn id in rendered bytes", async () => {
    const rig = makeRig();
    seed(rig, "org-bundle", { name: "o", id: "lrn_org", scope: "org", status: "active" });
    seed(rig, "app-bundle", {
      name: "ar",
      id: "lrn_ar",
      scope: "apps/alpha/roles/builder",
      status: "active",
    });
    const first = await resolveLearningContext(rig.input);
    const second = await resolveLearningContext({ ...rig.input, turnId: "turn-other" });
    expect(second.sections.join("\n---\n")).toBe(first.sections.join("\n---\n"));
    expect(first.sections.join("\n")).not.toContain("turn-1");
  });
});

describe("the pinned resolved-context record", () => {
  it("persists the record (without prompt bytes) and stamps events with bundle versions", async () => {
    const rig = makeRig();
    seed(rig, "org-bundle", { name: "o", id: "lrn_org", scope: "org", status: "active" });
    const resolved = await resolveLearningContext({ ...rig.input, stateHome: rig.stateHome.root });
    expect(resolved.bundle_versions).toMatchObject({ org: "unversioned", app: "unversioned" });

    const path = resolvedContextPath(rig.stateHome.root, "turn-1");
    expect(existsSync(path)).toBe(true);
    const record = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    expect(record).toMatchObject({
      turn_id: "turn-1",
      episode_id: "ep_alpha_ticket_0001",
      concept_ids: ["lrn_org"],
    });
    expect(record["sections"]).toBeUndefined();

    const loads = (await readLearningEvents(rig.stateHome.root)).filter(
      (event) => event.type === "concept_loaded",
    );
    expect(loads[0]?.bundle_versions).toMatchObject({ org: "unversioned" });
    expect(loads[0]?.bundle_lineage).toBe("stable");
  });
});
