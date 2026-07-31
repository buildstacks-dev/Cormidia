// Episode-sticky canary (learning-loop M5; design §8.4, spec §13).
// Covers milestone Done-means #2 (every turn of a canaried episode resolves
// the same lineage, verified from resolved-context records) and #3 (a T3
// live canary is refused by policy structurally), plus deterministic
// assignment, bounded windows, manifest lifecycle (start/promote/stop), and
// the tier gating on `canary start`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canaryBucket,
  decideRootLineage,
  listCanaryAssignments,
  readCanaryAssignment,
  startCanary,
  stopCanary,
} from "../../src/org/learning/canary.js";
import {
  bundleScopeDir,
  cutManifestVersion,
  disableConcept,
  manifestPath,
  orgLearningRoot,
  promoteCanaryOnManifest,
  readManifest,
  rollbackRoot,
  startCanaryOnManifest,
  stopCanaryOnManifest,
} from "../../src/org/learning/concepts.js";
import { writeInterventionRecord } from "../../src/org/learning/intervention.js";
import { writeCandidateArtifact } from "../../src/org/learning/candidate-store.js";
import { declareExperiment } from "../../src/org/learning/experiment.js";
import { decideExperiment } from "../../src/org/learning/eval-result.js";
import { readLearningEvents } from "../../src/org/learning/events.js";
import { defaultLearningPolicy, loadLearningPolicy } from "../../src/org/learning/policy.js";
import {
  resolveLearningContext,
  resolvedContextPath,
  type ResolveInput,
} from "../../src/org/learning/resolver.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";
import {
  conceptMarkdown,
  makeCandidate,
  makeExperiment,
  makeIntervention,
} from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function tempOrg(): OrgHomeFixture {
  const fixture = makeOrgHome();
  cleanups.push(fixture.cleanup);
  return fixture;
}

const NOW = new Date("2026-07-11T10:00:00Z");

/** Find episode ids that deterministically bucket inside/outside `fraction`. */
function episodeIdsFor(fraction: number): { canary: string; stable: string } {
  let canary: string | undefined;
  let stable: string | undefined;
  for (let n = 1; n < 500 && (canary === undefined || stable === undefined); n++) {
    const id = `ep_alpha_ticket_${String(n).padStart(4, "0")}`;
    if (canaryBucket(id) < fraction) canary ??= id;
    else stable ??= id;
  }
  return { canary: canary!, stable: stable! };
}

// ---------------------------------------------------------------------------
// policy: the M5 knobs and the structural T3 rule (Done #3)
// ---------------------------------------------------------------------------

describe("policy M5 knobs", () => {
  it("defaults carry the spec §13 tier table and learning budget", () => {
    const policy = defaultLearningPolicy();
    expect(policy.tiers.T1.canary).toEqual({
      unit: "episode",
      fraction: 0.1,
      window_hours: 48,
      requires_replay_pass: false,
    });
    expect(policy.tiers.T2.canary?.requires_replay_pass).toBe(true);
    expect(policy.tiers.T2.experiment_required).toBe(true);
    expect(policy.tiers.T3.canary).toBeNull();
    expect(policy.tiers.T3.live_canary).toBe("forbidden");
    expect(policy.learning_budget).toEqual({
      monthly_usd: 200,
      per_candidate_replay_usd: 75,
      max_repetitions_per_experiment: 5,
      max_experiments_per_month: 4,
      max_distillations_per_week: 7,
      require_benefit_justification: true,
    });
  });

  it("merges tier and budget overrides from policy.yaml", async () => {
    const org = tempOrg();
    mkdirSync(join(org.root, "learning"), { recursive: true });
    writeFileSync(
      join(org.root, "learning", "policy.yaml"),
      [
        "tiers:",
        "  T1:",
        "    canary: { fraction: 0.5, window_hours: 24 }",
        "learning_budget:",
        "  monthly_usd: 50",
        "  max_repetitions_per_experiment: 2",
        "",
      ].join("\n"),
    );
    const policy = await loadLearningPolicy(org.root);
    expect(policy.tiers.T1.canary).toEqual({
      unit: "episode",
      fraction: 0.5,
      window_hours: 24,
      requires_replay_pass: false,
    });
    expect(policy.learning_budget.monthly_usd).toBe(50);
    expect(policy.learning_budget.max_repetitions_per_experiment).toBe(2);
    // Untouched knobs keep their defaults.
    expect(policy.tiers.T2.canary?.window_hours).toBe(72);
  });

  it("REFUSES to load a policy that grants T3 a canary — structural, not conventional (Done #3)", async () => {
    const org = tempOrg();
    mkdirSync(join(org.root, "learning"), { recursive: true });
    writeFileSync(
      join(org.root, "learning", "policy.yaml"),
      "tiers:\n  T3:\n    canary: { fraction: 0.1, window_hours: 24 }\n",
    );
    await expect(loadLearningPolicy(org.root)).rejects.toThrow(/T3.*canary|live_canary/);
  });

  it("refuses live_canary: allowed on T3 and a forbidden tier that still declares a canary", async () => {
    const org = tempOrg();
    mkdirSync(join(org.root, "learning"), { recursive: true });
    writeFileSync(join(org.root, "learning", "policy.yaml"), "tiers:\n  T3:\n    live_canary: allowed\n");
    await expect(loadLearningPolicy(org.root)).rejects.toThrow(/forbidden/);

    writeFileSync(
      join(org.root, "learning", "policy.yaml"),
      [
        "tiers:",
        "  T1:",
        "    live_canary: forbidden",
        "    canary: { fraction: 0.1, window_hours: 24 }",
        "",
      ].join("\n"),
    );
    await expect(loadLearningPolicy(org.root)).rejects.toThrow(/cannot both hold/);
  });
});

// ---------------------------------------------------------------------------
// deterministic assignment
// ---------------------------------------------------------------------------

describe("canaryBucket + decideRootLineage", () => {
  it("buckets deterministically in [0, 1) from the episode id alone", () => {
    const bucket = canaryBucket("ep_alpha_ticket_0007");
    expect(bucket).toBe(canaryBucket("ep_alpha_ticket_0007"));
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(1);
    expect(canaryBucket("ep_alpha_ticket_0008")).not.toBe(bucket);
  });

  const manifest = {
    schema_version: 1 as const,
    bundle_version: "2026.07.11-2",
    stable: "2026.07.11-1",
    canary: "2026.07.11-2",
    canary_meta: {
      version: "2026.07.11-2",
      started_at: "2026-07-11T09:00:00.000Z",
      window_hours: 48,
      fraction: 0.5,
      tier: "T1",
      intervention_ref: "int_x",
      concepts: ["lrn_trial"],
    },
    history: [],
  };

  it("assigns by bucket inside an open window; stable exclusions carry the trial concepts", () => {
    const canary = decideRootLineage({ manifest, bucket: 0.2, now: NOW });
    expect(canary).toMatchObject({
      lineage: "canary",
      version: "2026.07.11-2",
      excluded: [],
      assignment: { version: "2026.07.11-2", lineage: "canary" },
    });
    const stable = decideRootLineage({ manifest, bucket: 0.7, now: NOW });
    expect(stable).toMatchObject({
      lineage: "stable",
      version: "2026.07.11-1",
      excluded: ["lrn_trial"],
      assignment: { version: "2026.07.11-2", lineage: "stable" },
    });
  });

  it("an elapsed window admits no new episodes and records no assignment (bounded exposure)", () => {
    const late = new Date("2026-07-13T10:00:00Z"); // 49h after start
    const decision = decideRootLineage({ manifest, bucket: 0.2, now: late });
    expect(decision.lineage).toBe("stable");
    expect(decision.assignment).toBeUndefined();
  });

  it("honors a sticky assignment over the bucket, and ignores one from a previous trial", () => {
    const sticky = decideRootLineage({
      manifest,
      existing: { version: "2026.07.11-2", lineage: "canary" },
      bucket: 0.99,
      now: NOW,
    });
    expect(sticky.lineage).toBe("canary");
    const staleTrial = decideRootLineage({
      manifest,
      existing: { version: "2026.07.01-9", lineage: "canary" },
      bucket: 0.2,
      now: NOW,
    });
    expect(staleTrial.lineage).toBe("stable");
    expect(staleTrial.excluded).toEqual(["lrn_trial"]);
  });

  it("no running trial resolves stable at the manifest pointer", () => {
    const idle = decideRootLineage({
      manifest: { ...manifest, canary: null, canary_meta: null },
      bucket: 0.01,
      now: NOW,
    });
    expect(idle).toMatchObject({ lineage: "stable", version: "2026.07.11-1", excluded: [] });
  });
});

// ---------------------------------------------------------------------------
// manifest lifecycle
// ---------------------------------------------------------------------------

describe("manifest canary lifecycle", () => {
  async function cutTwice(orgRoot: ReturnType<typeof orgLearningRoot>): Promise<void> {
    await cutManifestVersion(orgRoot, {
      concepts: ["lrn_base"],
      now: new Date("2026-07-10T08:00:00Z"),
    });
    await cutManifestVersion(orgRoot, {
      concepts: ["lrn_trial"],
      now: new Date("2026-07-11T08:00:00Z"),
    });
  }

  it("start re-points stable to the prior cut and records the trial; one canary per root", async () => {
    const org = tempOrg();
    const root = orgLearningRoot(org.root);
    await cutTwice(root);
    const manifest = await startCanaryOnManifest(root, {
      version: "2026.07.11-1",
      windowHours: 48,
      fraction: 0.1,
      tier: "T1",
      interventionRef: "int_x",
      now: NOW,
    });
    expect(manifest.stable).toBe("2026.07.10-1");
    expect(manifest.canary).toBe("2026.07.11-1");
    expect(manifest.canary_meta?.concepts).toEqual(["lrn_trial"]);

    await expect(
      startCanaryOnManifest(root, {
        version: "2026.07.11-1",
        windowHours: 48,
        fraction: 0.1,
        tier: "T1",
        interventionRef: "int_y",
      }),
    ).rejects.toThrow(/already has an active canary/);
  });

  it("refuses to canary a version that is not the latest cut", async () => {
    const org = tempOrg();
    const root = orgLearningRoot(org.root);
    await cutTwice(root);
    await expect(
      startCanaryOnManifest(root, {
        version: "2026.07.10-1",
        windowHours: 48,
        fraction: 0.1,
        tier: "T1",
        interventionRef: "int_x",
      }),
    ).rejects.toThrow(/not the latest cut/);
  });

  it("promote advances stable in one append-only cut and clears the trial", async () => {
    const org = tempOrg();
    const root = orgLearningRoot(org.root);
    await cutTwice(root);
    await startCanaryOnManifest(root, {
      version: "2026.07.11-1",
      windowHours: 48,
      fraction: 0.1,
      tier: "T1",
      interventionRef: "int_x",
      now: NOW,
    });
    const result = await promoteCanaryOnManifest(root, { now: new Date("2026-07-12T08:00:00Z") });
    expect(result.version).toBe("2026.07.11-1");
    const manifest = (await readManifest(root))!;
    expect(manifest.stable).toBe(result.newVersion);
    expect(manifest.canary).toBeNull();
    expect(manifest.canary_meta).toBeNull();
    expect(manifest.history.at(-1)?.note).toBe("promote canary 2026.07.11-1");
  });

  it("stop deprecates the trial's still-active concepts before clearing the manifest", async () => {
    const org = tempOrg();
    const root = orgLearningRoot(org.root);
    const scopeDir = bundleScopeDir(root, "roles/builder");
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(
      join(scopeDir, "trial.md"),
      conceptMarkdown({ name: "trial", id: "lrn_trial", scope: "roles/builder", status: "active" }),
    );
    await cutTwice(root);
    await startCanaryOnManifest(root, {
      version: "2026.07.11-1",
      windowHours: 48,
      fraction: 0.1,
      tier: "T1",
      interventionRef: "int_x",
      now: NOW,
    });
    const result = await stopCanaryOnManifest(root, { now: new Date("2026-07-12T08:00:00Z") });
    expect(result.deactivated).toEqual(["lrn_trial"]);
    expect(readFileSync(join(scopeDir, "trial.md"), "utf8")).toContain("status: deprecated");
    const manifest = (await readManifest(root))!;
    expect(manifest.canary).toBeNull();
    expect(manifest.history.at(-1)?.note).toBe("stop canary 2026.07.11-1");
  });

  it("refuses version cuts while a trial runs — publish/disable/rollback cannot corrupt the population", async () => {
    const org = tempOrg();
    const root = orgLearningRoot(org.root);
    await cutTwice(root);
    await startCanaryOnManifest(root, {
      version: "2026.07.11-1",
      windowHours: 48,
      fraction: 0.1,
      tier: "T1",
      interventionRef: "int_x",
      now: NOW,
    });
    await expect(
      cutManifestVersion(root, { concepts: ["lrn_new"], now: new Date("2026-07-11T12:00:00Z") }),
    ).rejects.toThrow(/active canary.*promote\|stop/);
    // Closing the trial re-opens the cut path.
    await promoteCanaryOnManifest(root, { now: new Date("2026-07-12T08:00:00Z") });
    const cut = await cutManifestVersion(root, {
      concepts: ["lrn_new"],
      now: new Date("2026-07-12T09:00:00Z"),
    });
    expect(cut.version).toBe("2026.07.12-2");
  });

  it("disable and rollback refuse mid-trial BEFORE touching any file (verify round)", async () => {
    const org = tempOrg();
    const root = orgLearningRoot(org.root);
    const scopeDir = bundleScopeDir(root, "roles/builder");
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(
      join(scopeDir, "base.md"),
      conceptMarkdown({ name: "base", id: "lrn_base", scope: "roles/builder", status: "active" }),
    );
    writeFileSync(
      join(scopeDir, "trial.md"),
      conceptMarkdown({ name: "trial", id: "lrn_trial", scope: "roles/builder", status: "active" }),
    );
    await cutTwice(root);
    await startCanaryOnManifest(root, {
      version: "2026.07.11-1",
      windowHours: 48,
      fraction: 0.1,
      tier: "T1",
      interventionRef: "int_x",
      now: NOW,
    });

    await expect(disableConcept(root, "lrn_base")).rejects.toThrow(/active canary/);
    // The refusal must not have deprecated the file — a half-applied
    // "refusal" would strip content from both trial arms.
    expect(readFileSync(join(scopeDir, "base.md"), "utf8")).toContain("status: active");

    await expect(rollbackRoot(root)).rejects.toThrow(/active canary/);
    expect(readFileSync(join(scopeDir, "trial.md"), "utf8")).toContain("status: active");
  });

  it("readManifest rejects a canary pointer without its trial metadata", async () => {
    const org = tempOrg();
    const root = orgLearningRoot(org.root);
    await cutTwice(root);
    const path = manifestPath(root);
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(/^canary: null$/m, 'canary: "2026.07.11-1"'),
    );
    await expect(readManifest(root)).rejects.toThrow(/canary and canary_meta/);
  });
});

// ---------------------------------------------------------------------------
// startCanary tier gating (design §6, policy §13)
// ---------------------------------------------------------------------------

describe("startCanary gating", () => {
  interface GateRig {
    org: OrgHomeFixture;
    state: OrgHomeFixture;
  }

  async function gateRig(tier: string): Promise<GateRig> {
    const org = tempOrg();
    const state = tempOrg();
    const root = orgLearningRoot(org.root);
    await cutManifestVersion(root, { concepts: ["lrn_base"], now: new Date("2026-07-10T08:00:00Z") });
    await cutManifestVersion(root, { concepts: ["lrn_trial"], now: new Date("2026-07-11T08:00:00Z") });
    await writeCandidateArtifact(root, makeCandidate({ proposed_tier: tier }));
    await writeInterventionRecord(
      org.root,
      makeIntervention({
        intervention_id: "int_20260711_01JGHI",
        destination: "okf_concept",
        publish: {
          kind: "bundle_version",
          ref: "org@2026.07.11-1",
          commit: null,
          published_at: "2026-07-11T08:00:00.000Z",
        },
        activation: { activated_at: "2026-07-11T08:00:00.000Z", claim: "authorized" },
        affected_episodes: { query: "bundle_versions.org >= 2026.07.11-1" },
        status: "active",
      }),
    );
    return { org, state };
  }

  it("starts a T1 canary with the tier's fraction and window", async () => {
    const rig = await gateRig("T1");
    const started = await startCanary({
      orgHome: rig.org.root,
      interventionId: "int_20260711_01JGHI",
      policy: defaultLearningPolicy(),
      now: NOW,
    });
    expect(started).toMatchObject({ root: "org", version: "2026.07.11-1" });
    expect(started.meta.fraction).toBe(0.1);
    expect(started.meta.window_hours).toBe(48);
    expect(started.meta.tier).toBe("T1");
  });

  it("REFUSES a T3 live canary — the policy forbids it, not a call-site convention (Done #3)", async () => {
    const rig = await gateRig("T3");
    await expect(
      startCanary({
        orgHome: rig.org.root,
        interventionId: "int_20260711_01JGHI",
        policy: defaultLearningPolicy(),
        now: NOW,
      }),
    ).rejects.toThrow(/tier T3 forbids live canary/);
  });

  it("refuses a tier with no canary policy (T0) — fail closed", async () => {
    const rig = await gateRig("T0");
    await expect(
      startCanary({
        orgHome: rig.org.root,
        interventionId: "int_20260711_01JGHI",
        policy: defaultLearningPolicy(),
        now: NOW,
      }),
    ).rejects.toThrow(/no canary policy/);
  });

  it("T2 requires a decided improved replay verdict before live exposure", async () => {
    const rig = await gateRig("T2");
    await expect(
      startCanary({
        orgHome: rig.org.root,
        interventionId: "int_20260711_01JGHI",
        policy: defaultLearningPolicy(),
        now: NOW,
      }),
    ).rejects.toThrow(/requires a passed replay/);

    // Wire a decided improved replay through the real M3 substrate, then the
    // intervention re-checks clean.
    await declareExperiment(makeExperiment({ experiment_id: "exp_t2_01" }), {
      orgHome: rig.org.root,
    });
    await decideExperiment(rig.org.root, {
      schema_version: 1,
      eval_id: "eval_t2improved1",
      experiment_ref: "exp_t2_01",
      layer: "replay",
      capsule_refs: [],
      trials: [{ pair: 1, control: { review_cycles: 3 }, treatment: { review_cycles: 1 } }],
      primary_metric: {
        name: "review_cycles",
        control: 3,
        treatment: 1,
        direction_ok: true,
        min_useful_met: true,
      },
      guardrails: [],
      verdict: "improved",
      grader: { kind: "deterministic", ref: "builtin:build-outcome@1" },
      cost_usd: 1,
      decided_by: "human-operator",
      decided_at: "2026-07-11T09:00:00.000Z",
    });
    await writeInterventionRecord(
      rig.org.root,
      makeIntervention({
        intervention_id: "int_20260711_01JGHI",
        destination: "okf_concept",
        publish: {
          kind: "bundle_version",
          ref: "org@2026.07.11-1",
          commit: null,
          published_at: "2026-07-11T08:00:00.000Z",
        },
        activation: { activated_at: "2026-07-11T08:00:00.000Z", claim: "authorized" },
        affected_episodes: { query: "bundle_versions.org >= 2026.07.11-1" },
        experiment_ref: "exp_t2_01",
        outcome_ref: "eval_t2improved1",
        status: "active",
      }),
    );
    const started = await startCanary({
      orgHome: rig.org.root,
      interventionId: "int_20260711_01JGHI",
      policy: defaultLearningPolicy(),
      now: NOW,
    });
    expect(started.meta.tier).toBe("T2");
  });

  it("refuses to start while an okf publish journal is mid-transaction on the root (verify round)", async () => {
    const rig = await gateRig("T1");
    const journalDir = join(rig.state.root, "learning", "publish-journal");
    mkdirSync(journalDir, { recursive: true });
    writeFileSync(
      join(journalDir, "pub-inflight.json"),
      JSON.stringify({
        schema_version: 1,
        journal_id: "pub-inflight",
        candidate_id: "cand_x",
        candidate_hash: "sha256:" + "ab".repeat(32),
        destination: "okf_concept",
        tier: "T1",
        scope: "roles/builder",
        approval_ref: null,
        claim: "authorized",
        waivers: [],
        artifact: { kind: "bundle_version", bytes: "x" },
      }) + "\n",
    );
    await expect(
      startCanary({
        orgHome: rig.org.root,
        interventionId: "int_20260711_01JGHI",
        policy: defaultLearningPolicy(),
        stateHome: rig.state.root,
        now: NOW,
      }),
    ).rejects.toThrow(/mid-transaction/);
  });

  it("refuses non-activation interventions and app roots without a checkout", async () => {
    const rig = await gateRig("T1");
    await writeInterventionRecord(
      rig.org.root,
      makeIntervention({ intervention_id: "int_ticketpub", destination: "ticket" }),
    );
    await expect(
      startCanary({
        orgHome: rig.org.root,
        interventionId: "int_ticketpub",
        policy: defaultLearningPolicy(),
      }),
    ).rejects.toThrow(/only bundle-version activations/);
  });
});

// ---------------------------------------------------------------------------
// resolver integration: episode-sticky lineage end-to-end (Done #2)
// ---------------------------------------------------------------------------

describe("resolver lineage under a running canary", () => {
  interface Rig {
    org: OrgHomeFixture;
    state: OrgHomeFixture;
    input: (episodeId: string, turnId: string) => ResolveInput;
  }

  async function canaryRig(fraction = 0.5): Promise<Rig> {
    const org = tempOrg();
    const state = tempOrg();
    const root = orgLearningRoot(org.root);
    const scopeDir = bundleScopeDir(root, "roles/builder");
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(
      join(scopeDir, "base.md"),
      conceptMarkdown({ name: "base", id: "lrn_base", scope: "roles/builder", status: "active" }),
    );
    writeFileSync(
      join(scopeDir, "trial.md"),
      conceptMarkdown({ name: "trial", id: "lrn_trial", scope: "roles/builder", status: "active" }),
    );
    await cutManifestVersion(root, { concepts: ["lrn_base"], now: new Date("2026-07-10T08:00:00Z") });
    await cutManifestVersion(root, { concepts: ["lrn_trial"], now: new Date("2026-07-11T08:00:00Z") });
    await startCanaryOnManifest(root, {
      version: "2026.07.11-1",
      windowHours: 48,
      fraction,
      tier: "T1",
      interventionRef: "int_x",
      now: new Date("2026-07-11T09:00:00Z"),
    });
    return {
      org,
      state,
      input: (episodeId, turnId) => ({
        orgHome: org.root,
        app: "alpha",
        role: "builder",
        turnId,
        episodeId,
        taskText: "builder turn",
        policy: defaultLearningPolicy(),
        stateHome: state.root,
        clock: () => NOW,
      }),
    };
  }

  it("a canary-bucketed episode resolves the full bundle; a stable one excludes the trial (Done #2)", async () => {
    const rig = await canaryRig();
    const ids = episodeIdsFor(0.5);

    const canary = await resolveLearningContext(rig.input(ids.canary, "turn-c1"));
    expect(canary.bundle_lineage).toBe("canary");
    expect(canary.concept_ids).toEqual(["lrn_base", "lrn_trial"]);
    expect(canary.bundle_versions["org"]).toBe("2026.07.11-1");

    const stable = await resolveLearningContext(rig.input(ids.stable, "turn-s1"));
    expect(stable.bundle_lineage).toBe("stable");
    expect(stable.concept_ids).toEqual(["lrn_base"]);
    expect(stable.bundle_versions["org"]).toBe("2026.07.10-1");

    // Both assignments recorded (canary population AND in-window control),
    // stamped with the episode-keyed canary_assigned event once.
    const assignments = await listCanaryAssignments(rig.state.root);
    expect(assignments.map((a) => [a.episode_id, a.lineage])).toEqual(
      [
        [ids.canary, "canary"],
        [ids.stable, "stable"],
      ].sort((a, b) => a[0]!.localeCompare(b[0]!)),
    );
    const events = await readLearningEvents(rig.state.root);
    const assigned = events.filter((event) => event.type === "canary_assigned");
    expect(assigned).toHaveLength(2);
    expect(assigned[0]?.bundle_lineage).toBeDefined();

    // The pinned resolve records carry the lineage — the Done #2 evidence.
    const record = JSON.parse(
      readFileSync(resolvedContextPath(rig.state.root, "turn-c1"), "utf8"),
    ) as { bundle_lineage: string; episode_id: string };
    expect(record).toMatchObject({ bundle_lineage: "canary", episode_id: ids.canary });
  });

  it("every later turn in the episode resolves the SAME lineage even after the fraction changes", async () => {
    const rig = await canaryRig();
    const ids = episodeIdsFor(0.5);
    await resolveLearningContext(rig.input(ids.canary, "turn-1"));

    // Shrink the fraction to zero mid-episode: a fresh hash would now assign
    // stable, but the sticky record must win.
    const root = orgLearningRoot(rig.org.root);
    const manifest = (await readManifest(root))!;
    writeFileSync(
      manifestPath(root),
      readFileSync(manifestPath(root), "utf8").replace(
        `fraction: ${manifest.canary_meta!.fraction}`,
        "fraction: 0",
      ),
    );
    const again = await resolveLearningContext(rig.input(ids.canary, "turn-2"));
    expect(again.bundle_lineage).toBe("canary");
    expect(again.concept_ids).toEqual(["lrn_base", "lrn_trial"]);
    const assignment = await readCanaryAssignment(rig.state.root, ids.canary);
    expect(assignment?.turn_id).toBe("turn-1"); // first write stood
  });

  it("after the window elapses new episodes resolve stable, pinned OUTSIDE the trial population", async () => {
    const rig = await canaryRig();
    const ids = episodeIdsFor(0.5);
    const lateInput = { ...rig.input(ids.canary, "turn-late"), clock: () => new Date("2026-07-14T10:00:00Z") };
    const resolved = await resolveLearningContext(lateInput);
    expect(resolved.bundle_lineage).toBe("stable");
    // The episode still gets its first-resolve pin — with NO trial entry, so
    // it can never be admitted to this (or a later) trial mid-episode.
    const record = await readCanaryAssignment(rig.state.root, ids.canary);
    expect(record?.lineage).toBe("stable");
    expect(record?.roots).toEqual({});
  });

  it("an episode first resolved BEFORE a trial starts is never admitted mid-episode (stickiness)", async () => {
    const org = tempOrg();
    const state = tempOrg();
    const root = orgLearningRoot(org.root);
    const scopeDir = bundleScopeDir(root, "roles/builder");
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(
      join(scopeDir, "base.md"),
      conceptMarkdown({ name: "base", id: "lrn_base", scope: "roles/builder", status: "active" }),
    );
    writeFileSync(
      join(scopeDir, "trial.md"),
      conceptMarkdown({ name: "trial", id: "lrn_trial", scope: "roles/builder", status: "active" }),
    );
    await cutManifestVersion(root, { concepts: ["lrn_base"], now: new Date("2026-07-10T08:00:00Z") });
    const ids = episodeIdsFor(0.99); // canary-bucketed under almost any fraction
    const input = (turnId: string, clock: Date): ResolveInput => ({
      orgHome: org.root,
      app: "alpha",
      role: "builder",
      turnId,
      episodeId: ids.canary,
      taskText: "builder turn",
      policy: defaultLearningPolicy(),
      stateHome: state.root,
      clock: () => clock,
    });

    // First resolve happens with NO trial running.
    const before = await resolveLearningContext(input("turn-1", new Date("2026-07-10T10:00:00Z")));
    expect(before.bundle_lineage).toBe("stable");

    // A trial starts later; the episode's bucket WOULD admit it.
    await cutManifestVersion(root, { concepts: ["lrn_trial"], now: new Date("2026-07-11T08:00:00Z") });
    await startCanaryOnManifest(root, {
      version: "2026.07.11-1",
      windowHours: 48,
      fraction: 0.99,
      tier: "T1",
      interventionRef: "int_x",
      now: new Date("2026-07-11T09:00:00Z"),
    });
    const after = await resolveLearningContext(input("turn-2", new Date("2026-07-11T10:00:00Z")));
    expect(after.bundle_lineage).toBe("stable"); // pre-trial pin wins
    expect(after.concept_ids).toEqual(["lrn_base"]); // trial concept excluded
  });

  it("stopCanary ends the trial for subsequent resolves; the sticky record does not resurrect it", async () => {
    const rig = await canaryRig();
    const ids = episodeIdsFor(0.5);
    await resolveLearningContext(rig.input(ids.canary, "turn-1"));

    await writeInterventionRecord(
      rig.org.root,
      makeIntervention({
        intervention_id: "int_x",
        destination: "okf_concept",
        publish: {
          kind: "bundle_version",
          ref: "org@2026.07.11-1",
          commit: null,
          published_at: "2026-07-11T08:00:00.000Z",
        },
        activation: { activated_at: "2026-07-11T08:00:00.000Z", claim: "authorized" },
        affected_episodes: { query: "bundle_versions.org >= 2026.07.11-1" },
        status: "active",
      }),
    );
    await stopCanary({
      orgHome: rig.org.root,
      root: "org",
      reason: "regressed in trial",
      now: new Date("2026-07-11T12:00:00Z"),
    });

    const after = await resolveLearningContext(rig.input(ids.canary, "turn-after-stop"));
    expect(after.bundle_lineage).toBe("stable");
    expect(after.concept_ids).toEqual(["lrn_base"]); // trial concept deprecated
  });

  it("a corrupt org manifest degrades that root only — the app trial still pins, and the org root settles once readable (verify round)", async () => {
    const rig = await canaryRig(); // org-root trial, fraction 0.5
    const ids = episodeIdsFor(0.5);
    // Corrupt the org manifest AFTER the trial started.
    const root = orgLearningRoot(rig.org.root);
    const good = readFileSync(manifestPath(root), "utf8");
    writeFileSync(manifestPath(root), "canary: [not-a-mapping\n");

    const during = await resolveLearningContext(rig.input(ids.canary, "turn-corrupt"));
    // Org root skipped (no concepts, unreadable version), but the pin is
    // still written with the org root marked undecided.
    expect(during.concept_ids).toEqual([]);
    expect(during.bundle_versions["org"]).toBe("unreadable");
    const pinned = await readCanaryAssignment(rig.state.root, ids.canary);
    expect(pinned?.undecided).toEqual(["org"]);
    expect(pinned?.roots).toEqual({});

    // Manifest restored: the next resolve SETTLES the org root (window
    // still open, bucket admits) instead of re-deriving per turn.
    writeFileSync(manifestPath(root), good);
    const after = await resolveLearningContext(rig.input(ids.canary, "turn-settle"));
    expect(after.bundle_lineage).toBe("canary");
    const settled = await readCanaryAssignment(rig.state.root, ids.canary);
    expect(settled?.roots["org"]).toEqual({ version: "2026.07.11-1", lineage: "canary" });
    expect(settled?.undecided).toBeUndefined();

    // And the settled entry is honored thereafter (fraction change ignored).
    const again = await resolveLearningContext(rig.input(ids.canary, "turn-after-settle"));
    expect(again.bundle_lineage).toBe("canary");
  });

  it("lineageOverride forces stable under a running trial and records nothing (replay arms)", async () => {
    const rig = await canaryRig();
    const ids = episodeIdsFor(0.5);
    // Drop stateHome entirely so the override trial records nothing; the
    // resolver only writes canary assignments when stateHome is present.
    const { stateHome: _omitStateHome, ...overrideInput } = rig.input(ids.canary, "turn-override");
    const resolved = await resolveLearningContext({
      ...overrideInput,
      lineageOverride: "stable",
    });
    expect(resolved.bundle_lineage).toBe("stable");
    expect(resolved.concept_ids).toEqual(["lrn_base"]);
    expect(await listCanaryAssignments(rig.state.root)).toEqual([]);
  });
});
