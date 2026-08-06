// `cormidia learn experiment ...` and `cormidia learn canary ...` — the M5
// human surface over the offline-evaluation funnel and the episode-sticky
// live canary (design §8.4, §9.5; spec §10, §13).
//
// experiment declare  — build both arm fingerprints (control = the stable
//                       system, treatment = stable + the candidate marker)
//                       and persist the declared-before-results record.
// experiment run      — the §9.5 funnel: prechecks → targeted eval → paired
//                       replay, spending real tokens through the ordinary
//                       pass executor; the verdict lands via decideExperiment.
// experiment list     — declarations, verdicts, and ledger-attributed cost.
// canary start        — human-started, tier-gated live trial on a published
//                       intervention; assignment is by episode hash.
// canary status/promote/stop — observe, then advance stable or roll back.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveAppWorkdir } from "../org/app-workdir.js";
import { rollupLearningSpend } from "../org/budget.js";
import type { CormidiaHomes } from "../org/home.js";
import {
  listCanaryAssignments,
  promoteCanary,
  readRootManifest,
  startCanary,
  stopCanary,
  type CanaryRootKind,
} from "../org/learning/canary.js";
import { findCandidateArtifact } from "../org/learning/candidate-store.js";
import type { CandidateArtifact } from "../org/learning/candidate.js";
import { orgLearningRoot, readManifest, scopeApp } from "../org/learning/concepts.js";
import { listEvalResults } from "../org/learning/eval-result.js";
import {
  declareExperiment,
  listExperimentRecords,
  readExperimentRecord,
  type ExperimentGuardrail,
  type ExperimentRecord,
} from "../org/learning/experiment.js";
import { readEpisodeRecords, type EpisodeRecord } from "../org/learning/episode.js";
import {
  computeSystemFingerprint,
  deriveFingerprintWithBundle,
  fingerprintDelta,
  readFingerprint,
  storeFingerprint,
  type SystemFingerprint,
} from "../org/learning/fingerprint.js";
import { loadLearningPolicy, type LearningPolicy, type TierPromoteRule } from "../org/learning/policy.js";
import { createLoopReplayExecutor, gitIn, renderCandidateOverlay } from "../org/learning/replay.js";
import { eligibleFixtures, runExperiment } from "../org/learning/runner.js";
import { loadRoles } from "../org/roles.js";
import { runtimePolicyForApp } from "../org/apps.js";
import { resolveAppRoles } from "../org/app-execution-policy.js";
import { getRuntime } from "../runtime/registry.js";
import { flag, learningRoots, parseFlags, requireFlag, type Flags } from "./learn-activation.js";

// ---------------------------------------------------------------------------
// experiment
// ---------------------------------------------------------------------------

export async function learnExperiment(homes: CormidiaHomes, args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "declare":
      return declare(homes, rest);
    case "run":
      return run(homes, rest);
    case "list":
      return list(homes);
    default:
      throw new Error(
        "learn experiment: expected declare --candidate <id> --evals <scope>/<set> " +
          '--hypothesis "<text>" | run <experiment-id> [--by <name>] | list',
      );
  }
}

async function declare(homes: CormidiaHomes, args: string[]): Promise<number> {
  const flags = parseFlags(args, "learn experiment declare");
  const candidateId = requireFlag(flags, "candidate", "learn experiment declare");
  const evalsRef = requireFlag(flags, "evals", "learn experiment declare");
  const hypothesis = requireFlag(flags, "hypothesis", "learn experiment declare");
  const policy = await loadLearningPolicy(homes.orgHome);

  const { orgRoot, appRoots } = learningRoots(homes);
  const found = await findCandidateArtifact([orgRoot, ...Object.values(appRoots)], candidateId);
  if (found === undefined) {
    console.error(`learn experiment: no candidate ${candidateId} in any learning root`);
    return 1;
  }
  const candidate = found.candidate;
  const appName = flag(flags, "app") ?? scopeApp(candidate.proposed_scope);
  if (appName === undefined) {
    throw new Error(
      "learn experiment declare: --app <name> is required for org-scoped candidates — " +
        "replay recreates one app's episodes",
    );
  }
  const appEntry = homes.appsFile.apps.find((app) => app.name === appName);
  if (appEntry === undefined) {
    throw new Error(`learn experiment declare: unknown app "${appName}" in apps.yaml`);
  }

  const metric = flag(flags, "metric") ?? "held_in_pass";
  const direction =
    flag(flags, "direction") ??
    (["review_cycles", "cost_usd", "gate_failures"].includes(metric) ? "decrease" : "increase");
  if (direction !== "increase" && direction !== "decrease") {
    throw new Error('learn experiment declare: --direction must be "increase" or "decrease"');
  }
  const repetitions = Math.min(
    Number(flag(flags, "repetitions") ?? 3),
    policy.learning_budget.max_repetitions_per_experiment,
  );
  const minImprovement = Number(flag(flags, "min-improvement-pct") ?? 0);

  const guardrails: ExperimentGuardrail[] = flags.values.get("guardrail")?.map(parseGuardrail) ?? [
    { metric: "merged", rule: "must_not_decrease" },
  ];

  const arms = await armFingerprints(homes, appName, candidate);
  const experimentId = flag(flags, "id") ?? (await nextExperimentId(homes.orgHome, candidateId));

  const record: ExperimentRecord = {
    schema_version: 1,
    experiment_id: experimentId,
    candidate_ref: candidateId,
    unit: "build_ticket",
    hypothesis,
    control: { fingerprint_ref: arms.controlId },
    treatment: { fingerprint_ref: arms.treatmentId },
    eligibility: {
      episodes: evalsRef.startsWith("evals/") ? evalsRef : `evals/${evalsRef}`,
      app: appName,
      stage: [appEntry.status],
    },
    primary_metric: {
      name: metric,
      expected_direction: direction,
      min_useful_improvement_pct: minImprovement,
    },
    guardrails,
    trials: {
      layer: "replay",
      repetitions,
      early_stop: { on_held_in_failure: true, on_guardrail_trip: true },
    },
    observation: { outcome_maturity_days: 0 },
    stop_thresholds: null,
    decision: {
      promote_if: "primary_metric_improves_and_all_guardrails_pass",
      otherwise: "reject_extend_or_revise",
    },
    efficacy_protocol: {
      declared_at: new Date().toISOString(),
      baseline: {
        metric,
        value: Number(flag(flags, "baseline") ?? 0),
        source_ref: flag(flags, "baseline-ref") ?? evalsRef,
      },
      hidden_guardrail_commitment: {
        sha256: sha256Ref(JSON.stringify({ evals: evalsRef, guardrails })),
        fixture_refs: [evalsRef.startsWith("evals/") ? evalsRef : `evals/${evalsRef}`],
      },
      eligibility_sha256: sha256Ref(JSON.stringify({ app: appName, stage: [appEntry.status], evals: evalsRef })),
      actor_blinding: { treatment_identity_hidden: true },
      pairing: { seed: `${experimentId}:paired-v1`, order: "alternating_control_treatment" },
      budget: { max_usd: policy.learning_budget.per_candidate_replay_usd },
      stop_rules: {
        retain_attempted_pairs: true,
        early_stop_reasons: ["held_in_failure", "guardrail_trip", "budget_stop"],
      },
      side_effect_replacement: {
        network: "fixture_only",
        publishing: "forbidden",
        deployment: "sandbox_only",
      },
      missingness: { missing: "invalid_measurement", invalid: "fail_closed" },
    },
    status: "declared",
    result: null,
  };
  const declared = await declareExperiment(record, {
    orgHome: homes.orgHome,
    stateHome: homes.stateHome,
  });
  console.log(`declared ${declared.record.experiment_id} -> ${declared.path}`);
  console.log(
    `  arms: control ${arms.controlId} vs treatment ${arms.treatmentId}` +
      (declared.arm_delta !== null ? ` (delta: ${declared.arm_delta.join(", ")})` : ""),
  );
  console.log(`  run it with: cormidia learn experiment run ${declared.record.experiment_id}`);
  return 0;
}

function sha256Ref(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function run(homes: CormidiaHomes, args: string[]): Promise<number> {
  const flags = parseFlags(args, "learn experiment run");
  const experimentId = flags.positionals[0];
  if (experimentId === undefined) {
    throw new Error("learn experiment run: <experiment-id> is required");
  }
  const decidedBy = flag(flags, "by") ?? "human-operator";
  const policy = await loadLearningPolicy(homes.orgHome);
  const experiment = await readExperimentRecord(homes.orgHome, experimentId);
  if (experiment.candidate_ref === null) {
    throw new Error(
      `learn experiment run: ${experimentId} has no candidate — the treatment arm is the ` +
        `candidate's rendered concept, so a candidateless experiment cannot replay`,
    );
  }

  const appName = flag(flags, "app") ?? experiment.eligibility.app;
  const appEntry = homes.appsFile.apps.find((app) => app.name === appName);
  if (appEntry === undefined) {
    throw new Error(`learn experiment run: unknown app "${appName}" — pass --app`);
  }
  let appWorkdir: string | undefined;
  try {
    appWorkdir = resolveAppWorkdir(appEntry, {
      orgRoot: homes.orgHome,
      runtimeHome: homes.stateHome,
    });
  } catch {
    // Overlay lookup falls back to the org root below.
  }

  const fixtures = await eligibleFixtures(homes.orgHome, experiment);
  if (fixtures.length === 0) {
    console.error(
      `learn experiment run: no trusted fixtures under ${experiment.eligibility.episodes} — ` +
        "draft with `cormidia learn fixture <episode-id> --set <set>` and have a second actor --validate",
    );
    return 1;
  }

  // Seed clone: replay worktrees check out fixture seed commits from a local
  // clone that never pushes (the executor constructs no GhOps).
  const repoDir = flag(flags, "repo-dir") ?? join(homes.stateHome, "repos", appEntry.name);
  ensureSeedClone(appEntry.repo, repoDir);
  for (const fixture of fixtures) {
    if (fixture.seed.commit !== null) ensureCommit(repoDir, appEntry.repo, fixture.seed.commit);
  }

  const rolesFile = await loadRoles(join(homes.orgHome, "roles.yaml"));
  const configuredRoles = resolveAppRoles(rolesFile.roles, runtimePolicyForApp(appEntry));
  const roles = Object.fromEntries(configuredRoles.map((role) => [role.name, role]));
  const overlay = await renderCandidateOverlay({
    orgHome: homes.orgHome,
    ...(appWorkdir !== undefined ? { appWorkdir } : {}),
    candidateId: experiment.candidate_ref,
    policy,
  });

  const spendRollup = await rollupLearningSpend(homes.stateHome);
  const worktreeRoot = flag(flags, "worktree-root") ?? join(homes.stateHome, "worktrees", "learning-replay");
  await mkdir(worktreeRoot, { recursive: true });

  // Drift check (design §9.1: arms are declared before results): refuse on
  // MATERIAL drift — the surfaces that shape agent behavior — and only note
  // the rest (org/app commits move on every unrelated commit; refusing on
  // them would push operators into declare-and-run-atomically, hollowing
  // out declared-before-results).
  const arms = await armFingerprints(homes, appEntry.name, overlay.candidate);
  const declaredControl = await readFingerprint(homes.stateHome, experiment.control.fingerprint_ref);
  if (declaredControl === undefined) {
    process.stderr.write(
      `learn experiment run: declared control arm ${experiment.control.fingerprint_ref} is not ` +
        `in the fingerprint store — drift cannot be checked\n`,
    );
  } else if (arms.controlId !== experiment.control.fingerprint_ref) {
    const delta = fingerprintDelta(declaredControl, arms.control);
    const material = delta.filter((path) =>
      MATERIAL_FINGERPRINT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}.`)),
    );
    if (material.length > 0) {
      throw new Error(
        `learn experiment run: the system has materially drifted since ${experimentId} was ` +
          `declared (${material.join(", ")}) — a replay now would measure the drift, not the ` +
          `candidate; declare a fresh experiment`,
      );
    }
    process.stderr.write(
      `learn experiment run: immaterial drift since declaration (${delta.join(", ")}) — proceeding\n`,
    );
  }
  if (arms.treatmentId !== experiment.treatment.fingerprint_ref) {
    throw new Error(
      `learn experiment run: the candidate changed since ${experimentId} was declared ` +
        `(treatment arm ${experiment.treatment.fingerprint_ref}, current ${arms.treatmentId}) — ` +
        `the replay would test different intervention bytes than the declaration bound; ` +
        `declare a fresh experiment`,
    );
  }
  const outcome = await runExperiment(experimentId, {
    orgHome: homes.orgHome,
    policy,
    decidedBy,
    // The candidate was already located across org AND app roots — the
    // runner's org-root-only default must not decide held-in coverage for
    // app-repo candidates.
    heldInEpisodeIds: overlay.candidate.episode_ids,
    executor: createLoopReplayExecutor({
      orgHome: homes.orgHome,
      stateHome: homes.stateHome,
      localRepo: repoDir,
      worktreeRoot,
      app: appEntry,
      roles,
      runtimeForAssignment: (assignment) => getRuntime(assignment.harness),
      policy,
      treatmentOverlay: overlay.overlay,
      candidateRef: experiment.candidate_ref,
    }),
    spend: {
      monthUsd: spendRollup.monthUsd,
      candidateUsd: spendRollup.byCandidate.get(experiment.candidate_ref) ?? 0,
      experimentsThisMonth: spendRollup.experimentsThisMonth,
      experimentCounted: spendRollup.byExperiment.has(experimentId),
    },
    fixtures,
  });

  console.log(`experiment ${experimentId}: verdict ${outcome.result.verdict}`);
  console.log(
    `  primary ${outcome.result.primary_metric.name}: control ${fmt(outcome.result.primary_metric.control)} ` +
      `vs treatment ${fmt(outcome.result.primary_metric.treatment)}` +
      ` (direction_ok ${outcome.result.primary_metric.direction_ok}, min_useful ${outcome.result.primary_metric.min_useful_met})`,
  );
  for (const guardrail of outcome.result.guardrails) {
    console.log(
      `  guardrail ${guardrail.metric}: ${guardrail.pass ? "pass" : "FAIL"}` +
        (guardrail.detail !== undefined ? ` — ${guardrail.detail}` : ""),
    );
  }
  for (const trial of outcome.result.trials) {
    console.log(
      `  pair ${trial.pair}: control ${renderMetrics(trial.control)} | treatment ${renderMetrics(trial.treatment)}`,
    );
  }
  console.log(`  cost: $${outcome.result.cost_usd.toFixed(2)} (${outcome.attempts.length} attempts)`);
  if (outcome.halted !== null) console.log(`  halted: ${outcome.halted}`);
  console.log(`  recorded: ${outcome.result.eval_id} (cormidia learn show ${outcome.result.eval_id})`);
  return 0;
}

async function list(homes: CormidiaHomes): Promise<number> {
  const experiments = await listExperimentRecords(homes.orgHome);
  if (experiments.length === 0) {
    console.log("no experiments declared");
    return 0;
  }
  const results = new Map((await listEvalResults(homes.orgHome)).map((result) => [result.eval_id, result]));
  const spend = await rollupLearningSpend(homes.stateHome);
  for (const experiment of experiments) {
    const result = experiment.result !== null ? results.get(experiment.result) : undefined;
    const cost = spend.byExperiment.get(experiment.experiment_id);
    console.log(
      `${experiment.experiment_id} [${experiment.status}]` +
        (result !== undefined ? ` verdict ${result.verdict}` : "") +
        (cost !== undefined ? ` — $${cost.toFixed(2)} this month` : "") +
        ` — ${experiment.hypothesis.slice(0, 80)}`,
    );
  }
  return 0;
}

// ---------------------------------------------------------------------------
// canary
// ---------------------------------------------------------------------------

export async function learnCanary(homes: CormidiaHomes, args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "start": {
      const flags = parseFlags(rest, "learn canary start");
      const interventionId = flags.positionals[0];
      if (interventionId === undefined) {
        throw new Error("learn canary start: <intervention-id> is required");
      }
      const policy = await loadLearningPolicy(homes.orgHome);
      const started = await startCanary({
        orgHome: homes.orgHome,
        ...appWorkdirFlag(homes, flags),
        interventionId,
        policy,
        stateHome: homes.stateHome,
      });
      console.log(
        `canary started on the ${started.root} root: version ${started.version} ` +
          `(tier ${started.meta.tier}, fraction ${started.meta.fraction}, ` +
          `window ${started.meta.window_hours}h)`,
      );
      console.log(
        "  new episodes assign by hash of episode id (design §8.4); " + "watch it with: cormidia learn canary status",
      );
      return 0;
    }
    case "promote": {
      const flags = parseFlags(rest, "learn canary promote");
      const root = rootFlag(flags, "learn canary promote");
      const result = await promoteCanary({
        orgHome: homes.orgHome,
        ...appWorkdirFlag(homes, flags),
        root,
        stateHome: homes.stateHome,
        policy: await loadLearningPolicy(homes.orgHome),
      });
      console.log(
        `promoted canary ${result.version} on the ${root} root -> stable ${result.newVersion} ` +
          `(${result.meta.concepts.length} concept(s) now stable-lineage)`,
      );
      return 0;
    }
    case "stop": {
      const flags = parseFlags(rest, "learn canary stop");
      const root = rootFlag(flags, "learn canary stop");
      const reason = flag(flags, "reason") ?? "stopped by operator";
      const result = await stopCanary({
        orgHome: homes.orgHome,
        ...appWorkdirFlag(homes, flags),
        root,
        reason,
      });
      console.log(
        `stopped canary ${result.version} on the ${root} root -> cut ${result.newVersion}; ` +
          `deprecated: ${result.deactivated.join(", ") || "none still active"}`,
      );
      return 0;
    }
    case "status": {
      const lines = await canaryStatusLines(homes, await loadLearningPolicy(homes.orgHome));
      console.log(lines.join("\n"));
      return 0;
    }
    default:
      throw new Error(
        "learn canary: expected start <intervention-id> [--app <name>] | status | " +
          "promote --root org|app [--app <name>] | stop --root org|app [--app <name>] --reason <text>",
      );
  }
}

/** Shared by `canary status` and the learn report's canary section; the
 *  report passes its already-loaded episode records instead of re-walking
 *  the store. */
export async function canaryStatusLines(
  homes: CormidiaHomes,
  policy: LearningPolicy,
  preloadedEpisodes?: EpisodeRecord[],
): Promise<string[]> {
  const lines: string[] = [];
  const assignments = await listCanaryAssignments(homes.stateHome);
  const episodes = preloadedEpisodes ?? (await readEpisodeRecords(homes.stateHome));
  const byEpisode = new Map(episodes.map((episode) => [episode.episode_id, episode]));

  const roots: Array<{ label: string; kind: CanaryRootKind; appWorkdir?: string }> = [{ label: "org", kind: "org" }];
  for (const app of homes.appsFile.apps) {
    try {
      roots.push({
        label: `app ${app.name}`,
        kind: "app",
        appWorkdir: resolveAppWorkdir(app, {
          orgRoot: homes.orgHome,
          runtimeHome: homes.stateHome,
        }),
      });
    } catch {
      // No local checkout — its manifest is unreachable from this CLI.
    }
  }

  let anyActive = false;
  for (const root of roots) {
    const manifest = await readRootManifest(root.kind, {
      orgHome: homes.orgHome,
      ...(root.appWorkdir !== undefined ? { appWorkdir: root.appWorkdir } : {}),
    });
    const meta = manifest?.canary_meta ?? null;
    if (meta === null) continue;
    anyActive = true;
    const windowEnd = new Date(new Date(meta.started_at).getTime() + meta.window_hours * 60 * 60 * 1000);
    // Match on THIS root's assignment entry: version strings are minted
    // per root (org and app can both cut "YYYY.MM.DD-1" the same day), and
    // an episode's lineage in this trial is its entry for this root, never
    // the episode-level fold.
    const inTrial = assignments.filter((assignment) => assignment.roots[root.kind]?.version === meta.version);
    const canaryIds = inTrial.filter((a) => a.roots[root.kind]?.lineage === "canary").map((a) => a.episode_id);
    const stableIds = inTrial.filter((a) => a.roots[root.kind]?.lineage === "stable").map((a) => a.episode_id);
    lines.push(
      `${root.label}: canary ${meta.version} (tier ${meta.tier}, fraction ${meta.fraction}, ` +
        `window until ${windowEnd.toISOString()}) — intervention ${meta.intervention_ref}`,
    );
    lines.push(`  assignments: ${canaryIds.length} canary / ${stableIds.length} stable (in-window control)`);
    const canaryStats = lineageStats(canaryIds, byEpisode);
    const stableStats = lineageStats(stableIds, byEpisode);
    lines.push(`  canary episodes: ${renderStats(canaryStats)}`);
    lines.push(`  stable episodes: ${renderStats(stableStats)}`);
    const rule = policy.tiers[meta.tier as keyof LearningPolicy["tiers"]]?.promote_rule ?? null;
    lines.push(`  recommendation: ${recommend(rule, canaryStats, stableStats)}`);
    lines.push(
      `  next: cormidia learn canary promote --root ${root.kind} | ` +
        `cormidia learn canary stop --root ${root.kind} --reason "<why>"`,
    );
  }
  if (!anyActive) lines.push("no active canary on any reachable root");
  return lines;
}

interface LineageStats {
  total: number;
  closed: number;
  merged: number;
  mergedRate: number | null;
  meanReviewCycles: number | null;
  meanCostUsd: number | null;
}

function lineageStats(episodeIds: string[], byEpisode: Map<string, EpisodeRecord>): LineageStats {
  const closed = episodeIds
    .map((id) => byEpisode.get(id))
    .filter((record): record is EpisodeRecord => record?.outcome !== undefined);
  const merged = closed.filter((record) => record.outcome!.merged === true).length;
  const mean = (values: number[]): number | null =>
    values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
  return {
    total: episodeIds.length,
    closed: closed.length,
    merged,
    mergedRate: closed.length > 0 ? merged / closed.length : null,
    meanReviewCycles: mean(closed.map((record) => record.outcome!.review_cycles)),
    meanCostUsd: mean(closed.map((record) => record.outcome!.cost_usd)),
  };
}

function renderStats(stats: LineageStats): string {
  if (stats.total === 0) return "none yet";
  return (
    `${stats.total} assigned, ${stats.closed} closed` +
    (stats.mergedRate !== null ? `, merged ${(stats.mergedRate * 100).toFixed(0)}%` : "") +
    (stats.meanReviewCycles !== null ? `, review cycles avg ${stats.meanReviewCycles.toFixed(1)}` : "") +
    (stats.meanCostUsd !== null ? `, cost avg $${stats.meanCostUsd.toFixed(2)}` : "")
  );
}

/** The design §10 three-part decision rule, rendered as a recommendation the
 *  human executes: insufficient volume reads `inconclusive`, never limbo. */
function recommend(rule: TierPromoteRule | null, canary: LineageStats, stable: LineageStats): string {
  if (rule === null) return "no promote rule for this tier — human judgment";
  if (canary.closed < rule.min_canary_episodes) {
    return (
      `inconclusive — ${canary.closed}/${rule.min_canary_episodes} closed canary episodes; ` +
      "extend the window or decide on human judgment (design §10)"
    );
  }
  if (canary.mergedRate === null || stable.mergedRate === null || stable.mergedRate === 0) {
    return "inconclusive — no closed stable control episodes to compare against";
  }
  const regressionPct = ((stable.mergedRate - canary.mergedRate) / stable.mergedRate) * 100;
  if (regressionPct > rule.max_regression_pct) {
    return (
      `rollback recommended — canary merge rate regressed ${regressionPct.toFixed(1)}% ` +
      `(cap ${rule.max_regression_pct}%)`
    );
  }
  return "promote recommended — no regression beyond the rule; the human executes (design §10)";
}

// ---------------------------------------------------------------------------
// arm fingerprints
// ---------------------------------------------------------------------------

/** Fingerprint leaves whose drift invalidates a declared experiment: the
 *  surfaces that shape agent behavior. Commits and env move on every
 *  unrelated change and are deliberately immaterial. */
const MATERIAL_FINGERPRINT_PREFIXES = [
  "org.taste_hash",
  "org.roles_hash",
  "org.pipelines_hash",
  "org.prompts_hash",
  "app.config_hash",
  "models",
  "bundle_versions",
  "bundle_lineage",
];

/** Control = the current stable system (manifest versions, stable lineage);
 *  treatment = the identical system plus the candidate marker in the
 *  lineage. Both are stored content-addressed so declare can verify them
 *  and run can detect drift. */
async function armFingerprints(
  homes: CormidiaHomes,
  appName: string,
  candidate: CandidateArtifact,
): Promise<{ control: SystemFingerprint; controlId: string; treatmentId: string }> {
  const rolesFile = await loadRoles(join(homes.orgHome, "roles.yaml"));
  const appEntry = homes.appsFile.apps.find((app) => app.name === appName);
  let workdir: string | undefined;
  if (appEntry !== undefined) {
    try {
      workdir = resolveAppWorkdir(appEntry, {
        orgRoot: homes.orgHome,
        runtimeHome: homes.stateHome,
      });
    } catch {
      // No local checkout — app.commit reads null, same as capsule assembly.
    }
  }
  const versions: Record<string, string> = {
    org: (await readManifest(orgLearningRoot(homes.orgHome)))?.stable ?? "unversioned",
  };
  // One full compute; the treatment arm differs only in its bundle block,
  // so it derives from the control's hashes instead of re-walking the org.
  const control = await computeSystemFingerprint({
    packageRoot: homes.packageRoot,
    orgHome: homes.orgHome,
    app: {
      name: appName,
      ...(workdir !== undefined ? { workdir } : {}),
      ...(appEntry !== undefined ? { budgetUsdMonth: appEntry.budgetUsdMonth } : {}),
    },
    roles: Object.fromEntries(rolesFile.roles.map((role) => [role.name, role])),
    bundle: { versions, lineage: "stable" },
  });
  const marker = candidate.content_hash.replace(/^sha256:/, "").slice(0, 12);
  const treatment = deriveFingerprintWithBundle(control, {
    versions,
    lineage: `candidate:${marker}`,
  });
  return {
    control,
    controlId: await storeFingerprint(homes.stateHome, control),
    treatmentId: await storeFingerprint(homes.stateHome, treatment),
  };
}

async function nextExperimentId(orgHome: string, candidateId: string): Promise<string> {
  const suffix = candidateId.replace(/^cand_/, "");
  const existing = new Set((await listExperimentRecords(orgHome)).map((record) => record.experiment_id));
  for (let n = 1; n < 100; n++) {
    const id = `exp_${suffix}_${String(n).padStart(2, "0")}`;
    if (!existing.has(id)) return id;
  }
  throw new Error(`learn experiment: 99 experiments already declared for ${candidateId}`);
}

// ---------------------------------------------------------------------------
// seed clones
// ---------------------------------------------------------------------------

function ensureSeedClone(repoSlug: string, repoDir: string): void {
  if (existsSync(join(repoDir, ".git"))) {
    try {
      gitIn(repoDir, "fetch", "origin");
    } catch (error) {
      // Offline with a warm clone is fine — ensureCommit still verifies the
      // seed is present before any token is spent.
      process.stderr.write(
        `learn experiment: fetch failed (continuing with the local clone): ` +
          `${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    return;
  }
  mkdirSync(dirname(repoDir), { recursive: true });
  gitIn(dirname(repoDir), "clone", `https://github.com/${repoSlug}.git`, repoDir);
}

function ensureCommit(repoDir: string, repoSlug: string, commit: string): void {
  try {
    gitIn(repoDir, "cat-file", "-e", `${commit}^{commit}`);
    return;
  } catch {
    // Not local yet — a seed commit predating the clone or on a pruned ref.
  }
  try {
    gitIn(repoDir, "fetch", "origin", commit);
    gitIn(repoDir, "cat-file", "-e", `${commit}^{commit}`);
  } catch {
    throw new Error(
      `learn experiment run: seed commit ${commit} is not reachable in ${repoSlug} — ` +
        "the fixture's starting state no longer exists; re-draft from a fresh episode",
    );
  }
}

// ---------------------------------------------------------------------------
// flags (shared grammar: learn-activation.ts parseFlags/flag/requireFlag)
// ---------------------------------------------------------------------------

function rootFlag(flags: Flags, command: string): CanaryRootKind {
  const root = flag(flags, "root");
  if (root !== "org" && root !== "app") throw new Error(`${command}: --root org|app is required`);
  return root;
}

function appWorkdirFlag(homes: CormidiaHomes, flags: Flags): { appWorkdir?: string } {
  const appName = flag(flags, "app");
  if (appName === undefined) return {};
  const appEntry = homes.appsFile.apps.find((app) => app.name === appName);
  if (appEntry === undefined) throw new Error(`learn canary: unknown app "${appName}"`);
  return {
    appWorkdir: resolveAppWorkdir(appEntry, {
      orgRoot: homes.orgHome,
      runtimeHome: homes.stateHome,
    }),
  };
}

/** `metric:rule[:pct]`, e.g. `cost_usd:max_increase_pct:25`. */
function parseGuardrail(spec: string): ExperimentGuardrail {
  const [metric, rule, pct] = spec.split(":");
  if (metric === undefined || metric === "" || rule === undefined) {
    throw new Error(`learn experiment declare: --guardrail "${spec}" is not metric:rule[:pct]`);
  }
  if (rule === "max_increase_pct" || rule === "max_decrease_pct") {
    return { metric, rule, pct: Number(pct) };
  }
  if (rule === "must_not_decrease" || rule === "must_not_increase") {
    return { metric, rule };
  }
  throw new Error(`learn experiment declare: unknown guardrail rule "${rule}"`);
}

function renderMetrics(metrics: Record<string, number>): string {
  return Object.entries(metrics)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${name === "cost_usd" ? `$${value.toFixed(2)}` : value}`)
    .join(" ");
}

function fmt(value: number | null): string {
  return value === null ? "n/a" : String(Math.round(value * 1000) / 1000);
}
