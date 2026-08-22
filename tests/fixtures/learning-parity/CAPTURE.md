# Learning parity oracle — captured from the forked deterministic engine

**Provenance.** `captured/` is the learning state the FORKED engine
(`src/org/learning/*` at commit `ad3ba7db`, the last phase-A commit of Cormidia
#467) wrote when the script below ran it once under a fixed clock
(`2026-08-21T12:00:00.000Z`, advancing one minute per step), fixed approval ids
(`parity-approval-NN`), and the exact inputs in `inputs.ts`. The script ran
twice; both runs produced byte-identical trees (`digests.json` pins every
file's SHA-256). Host-specific temp paths were rewritten to `<org-home>`,
`<app-workdir>`, and `<state-home>` placeholders before capture.

**What it proves.** `tests/hermetic/cf-b32/learning-kernel-parity.test.ts`
(family CF-B32-PARITY) replays `inputs.ts` through the kernel path and compares
against these bytes: activated concept files, proposal drafts, and the rejection
ledger are byte-identical; manifest cuts match version-for-version (the ruled
delta is `approval_ref` — the fork keyed cuts by approval id, the kernel by its
idempotency key — and the cut note); the post-cutover resolver pins the same
resolved record, episode assignment, and `concept_loaded` events; and the
fork's own bundle/manifest (this capture) resolves unchanged under the
post-cutover reader, which is the compatibility policy's exact-preservation
clause (research/2026-08-21_learning-loop-migration-compatibility-policy.md §3a).

**Do not edit `captured/` by hand** (it is excluded from the formatter in
`biome.json`); a changed input means a new capture, which after the fork's
removal can only come from a checkout at `ad3ba7db`.

**Contents.** `org-home/learning/**` (bundle, manifest, candidates, reviews,
rejections, proposals, interventions, experiments, eval results),
`app-web/.cormidia/learning/**`, `state-home/learning/**` (episodes, events,
resolved pin, canary assignment, fingerprints, publish journals), and
`state-home/approvals/**` (the forked `learning_publish` items and grants).

## The capture script (run from the phase-B worktree at `ad3ba7db`)

```ts
// Parity capture (Cormidia #467 phase B): run the FORKED deterministic engine
// (src/org/learning/*) once under a fixed clock and fixed approval ids, and
// copy every learning artifact it produced into a committed fixture tree.
// The kernel-path parity spec replays the same inputs and compares bytes.
//
// Run from the phase-B worktree while the fork still exists:
//   node_modules/.bin/tsx <this file> <worktree-root>
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = process.argv[2];
if (ROOT === undefined) throw new Error("usage: capture-parity.ts <worktree-root>");

const { ApprovalStore } = await import(`${ROOT}/src/org/approvals.ts`);
const { openCandidateArtifact } = await import(`${ROOT}/src/org/learning/candidate-store.ts`);
const { appLearningRoot, orgLearningRoot, readManifest } = await import(`${ROOT}/src/org/learning/concepts.ts`);
const { appendLearningEventsDeduped } = await import(`${ROOT}/src/org/learning/events.ts`);
const { defaultLearningPolicy } = await import(`${ROOT}/src/org/learning/policy.ts`);
const { publishCandidate } = await import(`${ROOT}/src/org/learning/publisher.ts`);
const { resolveLearningContext } = await import(`${ROOT}/src/org/learning/resolver.ts`);
const { writeReviewerVerdict } = await import(`${ROOT}/src/org/learning/review.ts`);
const { declareExperiment } = await import(`${ROOT}/src/org/learning/experiment.ts`);
const { computeEvalResult, decideExperiment } = await import(`${ROOT}/src/org/learning/eval-result.ts`);
const { storeFingerprint } = await import(`${ROOT}/src/org/learning/fingerprint.ts`);
const { serializeOkfDocument } = await import(`${ROOT}/src/org/memory.ts`);
const { makeTestClock } = await import(`${ROOT}/tests/fixtures/clock.ts`);
const { makeTempOrgHome } = await import(`${ROOT}/tests/fixtures/org-home.ts`);
const { makeTempStateHome } = await import(`${ROOT}/tests/fixtures/state-home.ts`);

const ORG = "acme";
const CLOCK_START = "2026-08-21T12:00:00.000Z";

function sha256Ref(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function conceptDraft(input: { conceptId: string; name: string; scope: string; tier?: string; body: string }): string {
  return serializeOkfDocument({
    frontmatter: {
      name: input.name,
      description: `learning concept ${input.name}`,
      type: "lesson",
      keywords: ["typecheck", "review"],
      evidence: ["ep_web_ticket_0042"],
      status: "active",
      created: "2026-08-21",
      updated: "2026-08-21",
      loop: {
        id: input.conceptId,
        tier: input.tier ?? "T1",
        status: "candidate",
        scope: input.scope,
        version: 1,
        claim: "authorized",
        topic_key: `topic.${input.name}`,
      },
    },
    body: input.body,
  });
}

function episodeRecord(episodeId: string, ticket: string, closed: boolean): Record<string, unknown> {
  return {
    schema_version: 1,
    episode_id: episodeId,
    kind: "build_ticket",
    app: "web",
    source: { kind: "github_issue", ref: ticket },
    stage: null,
    risk_tier: null,
    opened: "2026-08-20T09:00:00.000Z",
    ...(closed ? { closed: "2026-08-20T10:00:00.000Z" } : {}),
    status: closed ? "closed" : "open",
    fingerprint_ref: null,
    bundle_lineage: null,
    turns: [],
    gates: [
      { gate: "typecheck", status: "fail", run_id: "run-1" },
      { gate: "typecheck", status: "pass", run_id: "run-2" },
    ],
    approvals: [],
    artifacts: [],
    side_effects: [],
    ...(closed
      ? {
          outcome: {
            completed: true,
            merged: true,
            release_disposition: "merged",
            review_cycles: 2,
            gate_failures: 1,
            human_interventions: 1,
            cost_usd: 1.25,
            cost_estimated: false,
            unsettled_runs: [],
            terminal_reason: "completed",
          },
        }
      : {}),
    late_outcomes: closed ? [{ kind: "revert", ref: "pr-7", recorded: "2026-08-21T08:00:00.000Z" }] : [],
    human_observations: [],
  };
}

function candidateSpec(input: {
  id: string;
  destination: string;
  scope: string;
  tier?: string;
  title: string;
  errorClass?: string;
  episodeIds: string[];
  draft?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    candidate_id: input.id,
    destination: input.destination,
    title: input.title,
    proposed_scope: input.scope,
    proposed_tier: input.tier ?? "T1",
    claims_efficacy: false,
    experiment_ref: null,
    ...(input.errorClass !== undefined ? { error_class: input.errorClass } : {}),
    episode_ids: input.episodeIds,
    event_ids: [],
    evidence_refs: [],
    content_hash: sha256Ref(`candidate-content:${input.id}`),
    ...(input.draft !== undefined ? { draft: input.draft } : {}),
  };
}

function verdictSpec(input: {
  id: string;
  destination: string;
  scope: string;
  tier?: string;
  verdict?: string;
  rationale?: string;
}): Record<string, unknown> {
  return {
    schema_version: 1,
    candidate_id: input.id,
    verdict: input.verdict ?? "approve",
    proposed_destination: input.destination,
    proposed_tier: input.tier ?? "T1",
    proposed_scope: input.scope,
    experiment_required: false,
    rubric: {
      correctness: 4,
      generality: 4,
      scope_fit: 4,
      destination_fit: 4,
      provenance_trust: 4,
      injection_screen: "clean",
    },
    conflicts_with: [],
    duplicates: [],
    eval_required: false,
    eval_present: false,
    rationale: input.rationale ?? `rationale for ${input.id}`,
    reviewed_by: "human:parity-reviewer",
    reviewed_at: "2026-08-21T11:00:00.000Z",
  };
}

async function walk(dir: string, out: string[] = [], base = dir): Promise<string[]> {
  if (!existsSync(dir)) return out;
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, out, base);
    else out.push(relative(base, path));
  }
  return out;
}

async function main(): Promise<void> {
  const org = await makeTempOrgHome({ name: ORG });
  const state = await makeTempStateHome({ name: ORG });
  const clock = makeTestClock(CLOCK_START);
  let approvalSeq = 0;
  const approvals = new ApprovalStore(state.stateHome, {
    now: clock.dateFn,
    idSource: () => `parity-approval-${String(++approvalSeq).padStart(2, "0")}`,
  });
  const appWorkdir = join(org.root, "apps", "web");
  await mkdir(appWorkdir, { recursive: true });
  const policy = defaultLearningPolicy();
  const orgRoot = orgLearningRoot(org.orgHome);
  const appRoot = appLearningRoot(appWorkdir);
  const deps = {
    orgHome: org.orgHome,
    stateHome: state.stateHome,
    policy,
    approvals,
    appRoots: { web: appRoot },
    clock: clock.dateFn,
  };

  // Evidence: two closed episodes + one open, in the state home.
  await mkdir(state.path("learning", "episodes"), { recursive: true });
  for (const [id, ticket, closed] of [
    ["ep_web_ticket_0042", "web#42", true],
    ["ep_web_ticket_0043", "web#43", true],
    ["ep_web_ticket_0044", "web#44", false],
  ] as const) {
    await writeFile(
      state.path("learning", "episodes", `${id}.json`),
      `${JSON.stringify(episodeRecord(id, ticket, closed), null, 2)}\n`,
    );
  }
  await appendLearningEventsDeduped(state.stateHome, [
    {
      event_id: "evt_parity_error_1",
      episode_id: "ep_web_ticket_0042",
      turn_id: "turn_parity_capture",
      ts: clock.nowIso(),
      app: "web",
      type: "error",
      error_class: "build.typecheck-before-done",
      emitter: "orchestrator",
      source_channel: "internal",
      trust: "trusted",
    },
  ]);

  // 1. org-scoped OKF concept, human-gated.
  const ORG_CAND = "cand_parity_org";
  await openCandidateArtifact(
    orgRoot,
    candidateSpec({
      id: ORG_CAND,
      destination: "okf_concept",
      scope: "org",
      title: "type-check before reporting done",
      errorClass: "build.typecheck-before-done",
      episodeIds: ["ep_web_ticket_0042"],
      draft: { generated_by: "distiller", source_app: "web", topic_key: "topic.parity-org-lesson" },
    }),
    conceptDraft({
      conceptId: "lrn_parity_org",
      name: "parity-org-lesson",
      scope: "org",
      body: "Run the repository type-check before reporting completion.\n",
    }),
  );
  await writeReviewerVerdict(org.orgHome, verdictSpec({ id: ORG_CAND, destination: "okf_concept", scope: "org" }));
  const raisedOrg = await publishCandidate(deps, ORG_CAND);
  if (raisedOrg.status !== "raised") throw new Error(`org raise: ${JSON.stringify(raisedOrg)}`);
  await approvals.decide(raisedOrg.approvalId, { decision: "approved", now: clock.nowDate() });
  clock.advance(60_000);
  const publishedOrg = await publishCandidate(deps, ORG_CAND);
  if (publishedOrg.status !== "published") throw new Error(`org publish: ${JSON.stringify(publishedOrg)}`);

  // 2. app-scoped OKF concept, human-gated, into the app checkout.
  const APP_CAND = "cand_parity_app";
  await openCandidateArtifact(
    appRoot,
    candidateSpec({
      id: APP_CAND,
      destination: "okf_concept",
      scope: "apps/web",
      title: "web: run the contract tests before review",
      episodeIds: ["ep_web_ticket_0042", "ep_web_ticket_0043"],
      draft: { generated_by: "distiller", source_app: "web" },
    }),
    conceptDraft({
      conceptId: "lrn_parity_app",
      name: "parity-app-lesson",
      scope: "apps/web",
      body: "Run the contract tests before requesting review on web.\n",
    }),
  );
  await writeReviewerVerdict(org.orgHome, verdictSpec({ id: APP_CAND, destination: "okf_concept", scope: "apps/web" }));
  const raisedApp = await publishCandidate(deps, APP_CAND);
  if (raisedApp.status !== "raised") throw new Error(`app raise: ${JSON.stringify(raisedApp)}`);
  await approvals.decide(raisedApp.approvalId, { decision: "approved", now: clock.nowDate() });
  clock.advance(60_000);
  const publishedApp = await publishCandidate(deps, APP_CAND);
  if (publishedApp.status !== "published") throw new Error(`app publish: ${JSON.stringify(publishedApp)}`);

  // 3. routine skill draft (no human gate).
  const SKILL_CAND = "cand_parity_skill";
  await openCandidateArtifact(
    orgRoot,
    candidateSpec({
      id: SKILL_CAND,
      destination: "skill_draft",
      scope: "roles/builder",
      tier: "T0",
      title: "builder: verify the default branch before diffing",
      episodeIds: ["ep_web_ticket_0043"],
      draft: { generated_by: "distiller", markdown: "# Verify the default branch\n\nResolve it; never guess.\n" },
    }),
  );
  await writeReviewerVerdict(
    org.orgHome,
    verdictSpec({ id: SKILL_CAND, destination: "skill_draft", scope: "roles/builder", tier: "T0" }),
  );
  clock.advance(60_000);
  const publishedSkill = await publishCandidate(deps, SKILL_CAND);
  if (publishedSkill.status !== "published") throw new Error(`skill publish: ${JSON.stringify(publishedSkill)}`);

  // 4. rejected candidate → ledger.
  const REJECT_CAND = "cand_parity_reject";
  await openCandidateArtifact(
    orgRoot,
    candidateSpec({
      id: REJECT_CAND,
      destination: "skill_draft",
      scope: "org",
      title: "noise",
      errorClass: "tooling.parity-flaky",
      episodeIds: ["ep_web_ticket_0043"],
    }),
  );
  await writeReviewerVerdict(
    org.orgHome,
    verdictSpec({ id: REJECT_CAND, destination: "reject", scope: "org", rationale: "recurring noise, not a lesson" }),
  );
  clock.advance(60_000);
  const rejected = await publishCandidate(deps, REJECT_CAND);
  if (rejected.status !== "rejected") throw new Error(`reject: ${JSON.stringify(rejected)}`);

  // 5. a governed resolve pinned for a turn of the open episode.
  clock.advance(60_000);
  const resolved = await resolveLearningContext({
    orgHome: org.orgHome,
    appWorkdir,
    app: "web",
    role: "builder",
    turnId: "turn_parity_1",
    episodeId: "ep_web_ticket_0044",
    taskText: "fix the typecheck failure on the review branch",
    policy,
    stateHome: state.stateHome,
    clock: clock.dateFn,
  });

  // 6. a legacy experiment + decided eval result (fork records, audit only).
  const fingerprint = (id: string, lineage: string) => ({
    fingerprint_id: id,
    cormidia: { version: "0.1.1", commit: "abc" },
    org: { commit: "def", taste_hash: "t", roles_hash: "r", pipelines_hash: "p", prompts_hash: "q" },
    app: { name: "web", commit: null, config_hash: null },
    bundle_versions: { org: "2026.08.21-1", app: "2026.08.21-1" },
    bundle_lineage: lineage,
    models: { builder: { runtime: "codex", model: "gpt", effort: "high" } },
    gates_hash: null,
    permissions_hash: null,
    budget_caps: { app_usd_month: null, per_turn_usd_by_role: {} },
    env: { node: "v26.7.0", platform: "darwin" },
  });
  await storeFingerprint(state.stateHome, fingerprint("sys_parity_control", "stable"));
  await storeFingerprint(state.stateHome, fingerprint("sys_parity_treatment", "stable+cand_parity_org"));
  const experimentRecord = {
    schema_version: 1,
    experiment_id: "exp_parity_1",
    candidate_ref: ORG_CAND,
    unit: "build_ticket",
    hypothesis: "type-checking before done reduces review cycles",
    control: { fingerprint_ref: "sys_parity_control" },
    treatment: { fingerprint_ref: "sys_parity_treatment" },
    eligibility: { episodes: "evals/roles/builder/standard-tickets", app: "web", stage: ["live"] },
    primary_metric: { name: "held_in_pass", expected_direction: "increase", min_useful_improvement_pct: 0 },
    guardrails: [{ metric: "merged", rule: "must_not_decrease" }],
    trials: { layer: "replay", repetitions: 1, early_stop: { on_held_in_failure: true, on_guardrail_trip: true } },
    observation: { outcome_maturity_days: 0 },
    stop_thresholds: null,
    decision: { promote_if: "primary_metric_improves_and_all_guardrails_pass", otherwise: "reject_extend_or_revise" },
    efficacy_protocol: null,
    status: "declared",
    result: null,
  };
  const declared = await declareExperiment(experimentRecord, { orgHome: org.orgHome, stateHome: state.stateHome });
  const result = computeEvalResult({
    experiment: declared.record,
    trials: [
      { pair: 0, control: { held_in_pass: 0 }, treatment: { held_in_pass: 1 } },
      { pair: 1, control: { held_in_pass: 0, merged: 1 }, treatment: { held_in_pass: 1, merged: 1 } },
    ],
    graderRef: "grader:build-outcome-v1",
    costUsd: 0.5,
    decidedBy: "human:parity-operator",
    decidedAt: clock.nowIso(),
  });
  await decideExperiment(org.orgHome, result);

  // --- copy the captured trees -----------------------------------------------
  const target = join(ROOT, "tests", "fixtures", "learning-parity", "captured");
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(join(org.orgHome, "learning"), join(target, "org-home", "learning"), { recursive: true });
  await cp(join(appWorkdir, ".cormidia", "learning"), join(target, "app-web", ".cormidia", "learning"), {
    recursive: true,
  });
  await cp(join(state.stateHome, "learning"), join(target, "state-home", "learning"), { recursive: true });
  await cp(join(state.stateHome, "approvals"), join(target, "state-home", "approvals"), { recursive: true });

  // Absolute temp paths in the publish journals and intervention refs are
  // host-specific; rewrite them to stable placeholders so the fixture is
  // byte-stable across machines.
  const placeholders: Array<[string, string]> = [
    [org.orgHome, "<org-home>"],
    [appWorkdir, "<app-workdir>"],
    [state.stateHome, "<state-home>"],
  ];
  for (const rel of await walk(target)) {
    const path = join(target, rel);
    const before = await readFile(path, "utf8");
    let after = before;
    for (const [from, to] of placeholders) after = after.split(from).join(to);
    if (after !== before) await writeFile(path, after);
  }

  const files = await walk(target);
  const digests: Record<string, string> = {};
  for (const rel of files) {
    digests[rel] = createHash("sha256")
      .update(await readFile(join(target, rel)))
      .digest("hex");
  }
  await writeFile(
    join(ROOT, "tests", "fixtures", "learning-parity", "digests.json"),
    `${JSON.stringify({ schema_version: 1, clock_start: CLOCK_START, files: digests }, null, 2)}\n`,
  );
  await writeFile(
    join(ROOT, "tests", "fixtures", "learning-parity", "resolved-summary.json"),
    `${JSON.stringify(
      {
        turn_id: resolved.turn_id,
        episode_id: resolved.episode_id,
        concept_ids: resolved.concept_ids,
        bundle_versions: resolved.bundle_versions,
        bundle_lineage: resolved.bundle_lineage,
        context_bytes: resolved.context_bytes,
        sections: resolved.sections,
        org_manifest: await readManifest(orgRoot),
        app_manifest: await readManifest(appRoot),
        approvals: { org: raisedOrg.approvalId, app: raisedApp.approvalId },
      },
      null,
      2,
    )}\n`,
  );
  console.log(`captured ${files.length} files under ${target}`);
  for (const rel of files) console.log(`  ${rel}`);
  await org.cleanup();
  await state.cleanup();
}

await main();
```
