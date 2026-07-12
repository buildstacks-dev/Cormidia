// M6 deterministic distillation, review persistence, caps, and report-only
// compaction. Uses the shared org/app fixtures and FakeClock; no model,
// network, auth, or ad-hoc temp tree is involved.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compactionReport,
  parseDistillationOutput,
  parseLearningReviewOutput,
  persistDistillationOutput,
  persistLearningReviewOutput,
  prepareDistillation,
  prepareLearningReview,
} from "../../src/org/learning/distillation.js";
import { createLearningEventSink, type LearningEvent } from "../../src/org/learning/events.js";
import { defaultLearningPolicy, loadLearningPolicy } from "../../src/org/learning/policy.js";
import { appendRejection } from "../../src/org/learning/rejections.js";
import { readReviewerVerdict } from "../../src/org/learning/review.js";
import { listCandidateArtifacts } from "../../src/org/learning/candidate-store.js";
import { appLearningRoot, orgLearningRoot } from "../../src/org/learning/concepts.js";
import { makeAppRepo, makeOrgHome } from "../fixtures/orgHome.js";
import { FakeClock } from "../fixtures/fakeClock.js";
import { conceptMarkdown } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function rig() {
  const org = makeOrgHome();
  const state = makeOrgHome({ state: true });
  const app = makeAppRepo();
  cleanups.push(org.cleanup, state.cleanup, app.cleanup);
  return {
    org,
    state,
    app,
    clock: new FakeClock("2026-07-12T06:00:00.000Z"),
    policy: defaultLearningPolicy(),
  };
}

function evidence(id: string, overrides: Partial<LearningEvent> = {}): LearningEvent {
  return {
    event_id: id,
    episode_id: `ep_alpha_ticket_${id.slice(-1)}`,
    ts: "2026-07-11T12:00:00.000Z",
    app: "alpha",
    agent_role: "builder",
    type: "error",
    error_class: "review.missing_test_mapping",
    cause_hypothesis: "acceptance criteria were not mapped to named tests",
    emitter: "orchestrator",
    source_channel: "internal",
    trust: "trusted",
    payload: { keywords: ["test-mapping", "workflow"] },
    ...overrides,
  };
}

async function seed(stateHome: string, events: LearningEvent[]): Promise<void> {
  const sink = createLearningEventSink(stateHome);
  for (const event of events) await sink.emit(event);
}

function prepareInput(r: ReturnType<typeof rig>) {
  return {
    orgHome: r.org.root,
    stateHome: r.state.root,
    app: "alpha",
    appWorkdir: r.app.root,
    appStages: { alpha: "live" },
    policy: r.policy,
    now: r.clock.now(),
  };
}

describe("M6 deterministic distillation", () => {
  it("parses policy-defined schedules and volume controls and keeps compaction report-only", async () => {
    const r = rig();
    mkdirSync(join(r.org.root, "learning"), { recursive: true });
    writeFileSync(
      join(r.org.root, "learning", "policy.yaml"),
      [
        "learning_budget:",
        "  max_distillations_per_week: 3",
        "distiller:",
        '  schedule: "daily 06:00"',
        "  max_candidates_per_run: 2",
        "  max_candidates_per_week: 6",
        "reviewer:",
        '  schedule: "weekly mon 07:00"',
        "  max_candidates_per_run: 4",
        "compaction:",
        '  schedule: "weekly mon 07:00"',
        "  report_only_v1: true",
        "",
      ].join("\n"),
    );
    const policy = await loadLearningPolicy(r.org.root);
    expect(policy.learning_budget.max_distillations_per_week).toBe(3);
    expect(policy.distiller).toMatchObject({ max_candidates_per_run: 2, max_candidates_per_week: 6 });
    expect(policy.reviewer).toMatchObject({ schedule: "weekly mon 07:00", max_candidates_per_run: 4 });
    expect(policy.compaction.report_only_v1).toBe(true);
  });

  it("skips an empty window before any model turn", async () => {
    const r = rig();
    const result = await prepareDistillation(prepareInput(r));
    expect(result).toMatchObject({
      status: "skipped",
      reason: "no_actionable_evidence",
      evidenceEvents: 0,
      clusters: [],
    });
  });

  it("clusters actionable evidence and persists a skill draft only through the candidate store", async () => {
    const r = rig();
    await seed(r.state.root, [evidence("evt_a1"), evidence("evt_a2")]);
    const preparation = await prepareDistillation(prepareInput(r));
    expect(preparation).toMatchObject({ status: "ready", actionableClusters: 1 });
    expect(preparation.clusters[0]?.skill_keywords).toContain("test-mapping");

    const cluster = preparation.clusters[0]!;
    const parsed = parseDistillationOutput(
      JSON.stringify({
        candidates: [
          {
            cluster_fingerprint: cluster.fingerprint,
            destination: "skill_draft",
            title: "Map acceptance criteria to named tests",
            proposed_scope: "roles/builder",
            proposed_tier: "T1",
            claims_efficacy: false,
            draft_summary: "A repeatable test-mapping workflow",
            draft_body: "List each criterion, name its proving test, then implement.",
            acceptance: ["Every criterion names at least one test."],
            topic_key: cluster.error_class,
          },
        ],
      }),
      preparation,
      "alpha",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const ids = await persistDistillationOutput({
      orgHome: r.org.root,
      appWorkdir: r.app.root,
      app: "alpha",
      now: r.clock.now(),
      preparation,
      verdict: parsed.verdict,
    });
    expect(ids).toHaveLength(1);
    const candidates = await listCandidateArtifacts(orgLearningRoot(r.org.root));
    expect(candidates[0]).toMatchObject({ destination: "skill_draft", event_ids: ["evt_a1", "evt_a2"] });
  });

  it("dedupes pending candidates and honors rejection suppression until evidence doubles", async () => {
    const r = rig();
    await seed(r.state.root, [evidence("evt_b1"), evidence("evt_b2")]);
    const first = await prepareDistillation(prepareInput(r));
    const cluster = first.clusters[0]!;
    const parsed = parseDistillationOutput(
      JSON.stringify({
        candidates: [
          {
            cluster_fingerprint: cluster.fingerprint,
            destination: "ticket",
            title: "Fix test mapping",
            proposed_scope: "apps/alpha",
            proposed_tier: "T1",
            claims_efficacy: false,
            draft_summary: "Fix the missing map",
            draft_body: "Implement deterministic criterion mapping.",
            acceptance: ["Mappings are complete."],
            topic_key: cluster.error_class,
          },
        ],
      }),
      first,
      "alpha",
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    await persistDistillationOutput({
      orgHome: r.org.root,
      appWorkdir: r.app.root,
      app: "alpha",
      now: r.clock.now(),
      preparation: first,
      verdict: parsed.verdict,
    });
    const deduped = await prepareDistillation(prepareInput(r));
    expect(deduped).toMatchObject({ status: "skipped", dedupedClusters: 1 });

    const candidate = (await listCandidateArtifacts(appLearningRoot(r.app.root)))[0]!;
    await appendRejection(r.org.root, {
      candidate,
      reason: "too broad",
      by: "learning-reviewer",
      now: r.clock.now(),
    });
    const suppressed = await prepareDistillation(prepareInput(r));
    expect(suppressed).toMatchObject({ status: "skipped", suppressedClusters: 1 });

    await seed(r.state.root, [evidence("evt_b3"), evidence("evt_b4")]);
    const overridden = await prepareDistillation(prepareInput(r));
    expect(overridden.status).toBe("ready");
  });

  it("enforces frequency and candidate-volume caps deterministically", async () => {
    const r = rig();
    await seed(r.state.root, [
      evidence("evt_c1"),
      evidence("evt_c2"),
      evidence("evt_d1", { error_class: "review.second_cluster" }),
      evidence("evt_d2", { error_class: "review.second_cluster" }),
    ]);
    r.policy.distiller.max_candidates_per_run = 1;
    const volume = await prepareDistillation(prepareInput(r));
    expect(volume).toMatchObject({ status: "ready", cappedClusters: 1, reason: "candidate_volume_cap_applied" });

    const telemetry = join(r.state.root, "telemetry");
    mkdirSync(telemetry, { recursive: true });
    writeFileSync(
      join(telemetry, "2026-07-12.jsonl"),
      Array.from({ length: r.policy.learning_budget.max_distillations_per_week }, (_, i) =>
        JSON.stringify({
          at: r.clock.now().toISOString(),
          role: "distiller",
          runtime: "claude",
          model: "m",
          status: "completed",
          tokensIn: 1,
          tokensOut: 1,
          costUsd: 0.01,
          usageQuality: "complete",
          subagentTurns: 0,
          wallClockMs: 1,
          escalations: 0,
          app: "alpha",
          runId: `distill-${i}`,
          learningActivity: "distillation",
        }),
      ).join("\n") + "\n",
    );
    const frequency = await prepareDistillation(prepareInput(r));
    expect(frequency).toMatchObject({ status: "capped", reason: "max_distillations_per_week" });
  });

  it("halts before a provider turn when the ordinary ledger reaches the learning overlay cap", async () => {
    const r = rig();
    await seed(r.state.root, [evidence("evt_cap1"), evidence("evt_cap2")]);
    const telemetry = join(r.state.root, "telemetry");
    mkdirSync(telemetry, { recursive: true });
    writeFileSync(
      join(telemetry, "2026-07-12.jsonl"),
      JSON.stringify({
        at: "2026-07-12T05:00:00.000Z",
        role: "distiller",
        runtime: "claude",
        model: "m",
        status: "completed",
        tokensIn: 1,
        tokensOut: 1,
        costUsd: r.policy.learning_budget.monthly_usd,
        usageQuality: "complete",
        subagentTurns: 0,
        wallClockMs: 1,
        escalations: 0,
        app: "alpha",
        learningActivity: "distillation",
      }) + "\n",
    );
    expect(await prepareDistillation(prepareInput(r))).toMatchObject({
      status: "capped",
      reason: "learning_monthly_budget",
      clusters: [],
    });
  });
});

describe("M6 independent review and compaction", () => {
  it("validates a complete structured reviewer batch and persists the fail-closed store contract", async () => {
    const r = rig();
    await seed(r.state.root, [evidence("evt_e1"), evidence("evt_e2")]);
    const distill = await prepareDistillation(prepareInput(r));
    const cluster = distill.clusters[0]!;
    const parsedCandidate = parseDistillationOutput(
      JSON.stringify({
        candidates: [
          {
            cluster_fingerprint: cluster.fingerprint,
            destination: "ticket",
            title: "Fix mapping",
            proposed_scope: "apps/alpha",
            proposed_tier: "T1",
            claims_efficacy: false,
            draft_summary: "Fix mapping",
            draft_body: "Implement it.",
            acceptance: ["Mapped."],
            topic_key: cluster.error_class,
          },
        ],
      }),
      distill,
      "alpha",
    );
    if (!parsedCandidate.ok) throw new Error(parsedCandidate.reason);
    await persistDistillationOutput({
      orgHome: r.org.root,
      appWorkdir: r.app.root,
      app: "alpha",
      now: r.clock.now(),
      preparation: distill,
      verdict: parsedCandidate.verdict,
    });
    const review = await prepareLearningReview({
      orgHome: r.org.root,
      stateHome: r.state.root,
      appWorkdir: r.app.root,
      app: "alpha",
      policy: r.policy,
      now: r.clock.now(),
    });
    const candidate = review.candidates[0]!;
    const output = JSON.stringify({
      reviews: [
        {
          candidate_id: candidate.candidate_id,
          verdict: "approve",
          proposed_destination: candidate.destination,
          proposed_tier: candidate.proposed_tier,
          proposed_scope: candidate.proposed_scope,
          experiment_required: false,
          rubric: {
            correctness: 5,
            generality: 4,
            scope_fit: 5,
            destination_fit: 5,
            provenance_trust: 5,
            injection_screen: "clean",
          },
          conflicts_with: [],
          duplicates: [],
          eval_required: false,
          eval_present: false,
          rationale: "Evidence and destination are aligned.",
        },
      ],
    });
    const parsed = parseLearningReviewOutput(output, review);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await persistLearningReviewOutput({
      orgHome: r.org.root,
      now: r.clock.now(),
      reviewer: "learning-reviewer:codex/gpt-test",
      preparation: review,
      verdict: parsed.verdict,
    });
    expect(await readReviewerVerdict(r.org.root, candidate.candidate_id)).toMatchObject({
      verdict: "approve",
      reviewed_by: "learning-reviewer:codex/gpt-test",
    });
    expect(parseLearningReviewOutput('{"reviews":[]}', review)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("missing review"),
    });
  });

  it("reports deprecate, merge, promote, and supersede without mutating bundle files", async () => {
    const r = rig();
    const orgRoot = orgLearningRoot(r.org.root);
    const appRoot = appLearningRoot(r.app.root);
    const orgScope = join(orgRoot.dir, "bundle", "roles", "builder");
    const alphaScope = join(appRoot.dir, "bundle", "apps", "alpha", "roles", "builder");
    mkdirSync(orgScope, { recursive: true });
    mkdirSync(alphaScope, { recursive: true });
    writeFileSync(join(orgScope, "stale.md"), conceptMarkdown({
      name: "stale",
      id: "lrn_stale",
      scope: "roles/builder",
      status: "active",
      topicKey: "old.topic",
      created: "2026-01-01",
    }));
    writeFileSync(join(orgScope, "dup-a.md"), conceptMarkdown({
      name: "dup-a", id: "lrn_dup_a", scope: "roles/builder", status: "active", topicKey: "dup.topic",
    }));
    writeFileSync(join(orgScope, "dup-b.md"), conceptMarkdown({
      name: "dup-b", id: "lrn_dup_b", scope: "roles/builder", status: "active", topicKey: "dup.topic",
    }));
    writeFileSync(join(alphaScope, "narrow.md"), conceptMarkdown({
      name: "narrow", id: "lrn_narrow", scope: "apps/alpha/roles/builder", status: "active", topicKey: "old.topic",
    }));
    const beta = makeAppRepo();
    cleanups.push(beta.cleanup);
    const betaRoot = appLearningRoot(beta.root);
    const betaScope = join(betaRoot.dir, "bundle", "apps", "beta", "roles", "reviewer");
    mkdirSync(betaScope, { recursive: true });
    writeFileSync(join(alphaScope, "promote-a.md"), conceptMarkdown({
      name: "promote-a", id: "lrn_promote_a", scope: "apps/alpha/roles/builder", status: "active", topicKey: "cross.app",
    }));
    writeFileSync(join(betaScope, "promote-b.md"), conceptMarkdown({
      name: "promote-b", id: "lrn_promote_b", scope: "apps/beta/roles/reviewer", status: "active", topicKey: "cross.app",
    }));
    const events: LearningEvent[] = [
      evidence("evt_conflict", {
        type: "conflict_resolved",
        error_class: undefined,
        cause_hypothesis: undefined,
        emitter: "resolver",
        payload: { winner: "lrn_narrow", loser: "lrn_stale" },
      }),
    ];
    const before = JSON.stringify([
      readFileText(join(orgScope, "stale.md")),
      readFileText(join(orgScope, "dup-a.md")),
    ]);
    const report = await compactionReport({
      roots: [orgRoot, appRoot, betaRoot],
      events,
      policy: r.policy,
      now: r.clock.now(),
    });
    expect(new Set(report.map((item) => item.action))).toEqual(
      new Set(["deprecate", "merge", "promote", "supersede"]),
    );
    expect(JSON.stringify([
      readFileText(join(orgScope, "stale.md")),
      readFileText(join(orgScope, "dup-a.md")),
    ])).toBe(before);
  });
});

function readFileText(path: string): string {
  return readFileSync(path, "utf8");
}
