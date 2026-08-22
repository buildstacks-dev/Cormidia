// `cormidia learn experiment ...` and `cormidia learn canary ...` — the M5
// human surface over offline evaluation and the episode-sticky live canary
// (design §8.4, §9.5; spec §10, §13), on the learning kernel since Cormidia
// #467 phase B (kernel decision 0028):
//
// experiment declare  — freeze a kernel ExperimentDefinition over the trusted
//                       fixtures' durable episodes, both arm fingerprints, the
//                       kernel's reference rules, and the worktree replay
//                       runner's exact registration; the subject is a
//                       published kernel intervention (validation is
//                       post-publication — a kernel ruling recorded in the
//                       phase-B parity record).
// experiment run      — the kernel drives every (episode, arm, repetition)
//                       through the worktree replay, attests each attempt,
//                       and mints the verdict into the intervention's
//                       `validation`; Cormidia keeps the budget preflight,
//                       seed clones, roles, and drift refusal.
// experiment list     — host audit copies plus ledger-attributed cost.
// canary start        — human-started, tier-gated live trial on a published
//                       activation; assignment is by episode hash.
// canary status/promote/stop — observe, then advance stable or roll back.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveAppRoles } from "../org/app-execution-policy.js";
import { resolveAppWorkdir } from "../org/app-workdir.js";
import { ApprovalStore } from "../org/approvals.js";
import { runtimePolicyForApp } from "../org/apps.js";
import { rollupLearningSpend } from "../org/budget.js";
import type { CormidiaHomes } from "../org/home.js";
import { composeLearningLoop } from "../org/learning-loop/compose.js";
import { ingestEpisodes } from "../org/learning-loop/candidates.js";
import {
  declareKernelExperiment,
  eligibleFixtures,
  parseGuardrailSpec,
  runKernelExperiment,
} from "../org/learning-loop/experiments.js";
import { listHostExperiments, readHostExperiment } from "../org/learning-loop/experiments-audit.js";
import { readHostCandidateIndex } from "../org/learning-loop/host-index.js";
import { interventionViewOf } from "../org/learning-loop/interventions.js";
import { learningLoopStateDir, type CormidiaLearningLoop } from "../org/learning-loop/loop.js";
import {
  disableOkfActivation,
  findOkfActivationForIntervention,
  type OkfActivation,
} from "../org/learning-loop/okf-lineage.js";
import { createLoopReplayRunner } from "../org/learning-loop/replay-runner.js";
import {
  listCanaryAssignments,
  promoteCanary,
  readRootManifest,
  startCanary,
  stopCanary,
  type CanaryRootKind,
} from "../org/learning-loop/host/canary.js";
import { findCandidateArtifact } from "../org/learning-loop/host/candidate-store.js";
import type { CandidateArtifact } from "../org/learning-loop/host/candidate.js";
import { appLearningRoot, orgLearningRoot, readManifest, scopeApp } from "../org/learning-loop/host/concepts.js";
import { readEpisodeRecords, type EpisodeRecord } from "../org/learning-loop/host/episode.js";
import type { EvalFixture } from "../org/learning-loop/host/eval-fixture.js";
import {
  computeSystemFingerprint,
  deriveFingerprintWithBundle,
  fingerprintDelta,
  readFingerprint,
  storeFingerprint,
  type SystemFingerprint,
} from "../org/learning-loop/host/fingerprint.js";
import { loadLearningPolicy, type LearningPolicy, type TierPromoteRule } from "../org/learning-loop/host/policy.js";
import { createLoopReplayExecutor, type ReplayExperimentContext } from "../org/learning-loop/host/replay.js";
import { loadRoles } from "../org/roles.js";
import { createCliProgressReporter, extractProgressArgs } from "../runtime/cli-progress.js";
import { defaultGate } from "../runtime/gate.js";
import { definedProps } from "../runtime/optional-properties.js";
import { getRuntime } from "../runtime/registry.js";
import { flag, learningRoots, parseFlags, requireFlag, type Flags } from "./learn-activation.js";
import { ensureCommit, ensureSeedClone } from "./learn-experiment-git.js";

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

function directionOf(flags: Flags, metric: string): "higher" | "lower" {
  const raw = flag(flags, "direction");
  if (raw === "higher" || raw === "increase") return "higher";
  if (raw === "lower" || raw === "decrease") return "lower";
  if (raw !== undefined) throw new Error('learn experiment declare: --direction must be "higher" or "lower"');
  return ["review_cycles", "cost_usd", "gate_failures"].includes(metric) ? "lower" : "higher";
}

async function composeWithRunner(
  homes: CormidiaHomes,
  policy: LearningPolicy,
  context: ReplayExperimentContext,
  fixtures: readonly EvalFixture[],
  executor: Parameters<typeof createLoopReplayRunner>[0]["executor"],
): Promise<CormidiaLearningLoop> {
  return composeLearningLoop(homes, {
    approvals: new ApprovalStore(homes.stateHome),
    policy,
    replayRunner: createLoopReplayRunner({ executor, fixtures, context, mode: "full" }),
  });
}

async function declare(homes: CormidiaHomes, args: string[]): Promise<number> {
  const flags = parseFlags(args, "learn experiment declare");
  const candidateId = requireFlag(flags, "candidate", "learn experiment declare");
  const evalsRef = requireFlag(flags, "evals", "learn experiment declare");
  const evalSet = evalsRef.startsWith("evals/") ? evalsRef : `evals/${evalsRef}`;
  const hypothesis = requireFlag(flags, "hypothesis", "learn experiment declare");
  const policy = await loadLearningPolicy(homes.orgHome);

  const { orgRoot, appRoots } = learningRoots(homes);
  const found = await findCandidateArtifact([orgRoot, ...Object.values(appRoots)], candidateId);
  if (found === undefined) {
    console.error(`learn experiment: no candidate ${candidateId} in any learning root`);
    return 1;
  }
  const candidate = found.candidate;
  const sourceApp = candidate.draft?.["source_app"];
  const appName =
    flag(flags, "app") ?? scopeApp(candidate.proposed_scope) ?? (typeof sourceApp === "string" ? sourceApp : undefined);
  if (appName === undefined) {
    throw new Error(
      "learn experiment declare: --app <name> is required for org-scoped candidates — replay recreates one app's episodes",
    );
  }
  const appEntry = homes.appsFile.apps.find((app) => app.name === appName);
  if (appEntry === undefined) throw new Error(`learn experiment declare: unknown app "${appName}" in apps.yaml`);

  const stateDir = learningLoopStateDir(homes.stateHome);
  const index = await readHostCandidateIndex(stateDir, candidateId);
  const published = [...(index?.entries ?? [])].reverse().find((entry) => entry.intervention_id !== undefined);
  if (published?.intervention_id === undefined) {
    console.error(
      `learn experiment declare: ${candidateId} has no published kernel intervention — ` +
        `\`cormidia learn publish ${candidateId}\` first; kernel experiments validate published interventions (decision 0028)`,
    );
    return 1;
  }

  const fixtures = await eligibleFixtures(homes.orgHome, evalSet);
  if (fixtures.length === 0) {
    console.error(
      `learn experiment declare: no trusted fixtures under ${evalSet} — ` +
        "draft with `cormidia learn fixture <episode-id> --set <set>` and have a second actor --validate",
    );
    return 1;
  }
  const metric = flag(flags, "metric") ?? "held_in_pass";
  const direction = directionOf(flags, metric);
  const minimumUsefulEffect = Number(flag(flags, "min-effect") ?? 0.01);
  const guardrails = (flags.values.get("guardrail") ?? ["merged=must_not_regress"]).map(parseGuardrailSpec);
  const repetitions = Math.min(
    Number(flag(flags, "repetitions") ?? 1),
    policy.learning_budget.max_repetitions_per_experiment,
  );
  const costCeilingUsd = Number(flag(flags, "cost-ceiling") ?? policy.learning_budget.per_candidate_replay_usd);
  const arms = await armFingerprints(homes, appName, candidate);
  const experimentId = flag(flags, "id") ?? (await nextExperimentId(stateDir, candidateId));
  const context: ReplayExperimentContext = {
    experimentId,
    app: appName,
    stage: [appEntry.status],
    budgetMaxUsd: costCeilingUsd,
    declaredAt: null,
  };
  const learning = await composeWithRunner(homes, policy, context, fixtures, () => {
    throw new Error("learn experiment declare never replays");
  });
  await ingestEpisodes(learning);
  const declared = await declareKernelExperiment({
    learning,
    experimentId,
    artifactId: candidateId,
    candidateId: published.id,
    interventionId: published.intervention_id,
    app: appName,
    stage: [appEntry.status],
    evalSet,
    fixtures,
    hypothesis,
    metric,
    direction,
    minimumUsefulEffect,
    guardrails,
    repetitions,
    control: arms.control,
    treatment: arms.treatment,
    controlFingerprintId: arms.controlId,
    treatmentFingerprintId: arms.treatmentId,
    costCeilingUsd,
  });
  console.log(`declared ${declared.definition.id} (definition ${declared.definition.definitionDigest.slice(0, 12)})`);
  console.log(`  subject: kernel intervention ${published.intervention_id}; ${fixtures.length} fixture episode(s)`);
  console.log(`  arms: control ${arms.controlId} vs treatment ${arms.treatmentId}`);
  console.log(`  run it with: cormidia learn experiment run ${declared.definition.id}`);
  return 0;
}

async function run(homes: CormidiaHomes, args: string[]): Promise<number> {
  const progressArgs = extractProgressArgs(args, "learn experiment run");
  const flags = parseFlags(progressArgs.rest, "learn experiment run");
  const experimentId = flags.positionals[0];
  if (experimentId === undefined) throw new Error("learn experiment run: <experiment-id> is required");
  const policy = await loadLearningPolicy(homes.orgHome);
  const stateDir = learningLoopStateDir(homes.stateHome);
  const record = await readHostExperiment(stateDir, experimentId);
  if (record === undefined) {
    console.error(
      `learn experiment run: ${experimentId} is not a kernel experiment declared on this org ` +
        "(forked-engine experiments are audit-only history; declare a fresh one)",
    );
    return 1;
  }
  const appEntry = homes.appsFile.apps.find((app) => app.name === record.app);
  if (appEntry === undefined) throw new Error(`learn experiment run: unknown app "${record.app}"`);
  const reporter = createCliProgressReporter({
    stateHome: homes.stateHome,
    command: "learn-experiment",
    scope: `${appEntry.name}/${experimentId}`,
    mode: progressArgs.mode,
  });
  reporter.phase("preflight", "started");
  try {
    const fixtures = await eligibleFixtures(homes.orgHome, record.eval_set);
    if (fixtures.length === 0) {
      console.error(`learn experiment run: no trusted fixtures under ${record.eval_set}`);
      reporter.terminal("failed", { nextAction: "create and validate a trusted fixture, then re-run" });
      return 1;
    }
    const { orgRoot, appRoots } = learningRoots(homes);
    const found = await findCandidateArtifact([orgRoot, ...Object.values(appRoots)], record.artifact_id);
    if (found === undefined) throw new Error(`learn experiment run: candidate ${record.artifact_id} is not readable`);

    // Drift check (design §9.1: arms are declared before results): refuse on
    // MATERIAL drift — the surfaces that shape agent behavior — and only note
    // the rest.
    const arms = await armFingerprints(homes, appEntry.name, found.candidate);
    const declaredControl =
      record.control_fingerprint_id === undefined
        ? undefined
        : await readFingerprint(homes.stateHome, record.control_fingerprint_id);
    if (declaredControl === undefined) {
      process.stderr.write(
        `learn experiment run: declared control arm is not in the fingerprint store — drift cannot be checked\n`,
      );
    } else if (arms.controlId !== record.control_fingerprint_id) {
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

    // Budget preflight (policy §13): the kernel enforces the declared cost
    // ceiling per attempt; the org ledger caps stay host-owned.
    const spend = await rollupLearningSpend(homes.stateHome);
    const caps = policy.learning_budget;
    if (spend.monthUsd >= caps.monthly_usd) {
      throw new Error(`learn experiment run: monthly learning budget cap ($${caps.monthly_usd.toFixed(2)}) reached`);
    }
    if ((spend.byCandidate.get(record.artifact_id) ?? 0) >= caps.per_candidate_replay_usd) {
      throw new Error(
        `learn experiment run: per-candidate replay cap ($${caps.per_candidate_replay_usd.toFixed(2)}) reached`,
      );
    }
    if (!spend.byExperiment.has(experimentId) && spend.experimentsThisMonth >= caps.max_experiments_per_month) {
      throw new Error(`learn experiment run: ${spend.experimentsThisMonth} experiments already ran this month`);
    }

    const repoDir = flag(flags, "repo-dir") ?? join(homes.stateHome, "repos", appEntry.name);
    ensureSeedClone(appEntry.repo, repoDir);
    for (const fixture of fixtures) {
      if (fixture.seed.commit !== null) ensureCommit(repoDir, appEntry.repo, fixture.seed.commit);
    }
    const rolesFile = await loadRoles(join(homes.orgHome, "roles.yaml"));
    const configuredRoles = resolveAppRoles(rolesFile.roles, runtimePolicyForApp(appEntry));
    const roles = Object.fromEntries(configuredRoles.map((role) => [role.name, role]));
    const worktreeRoot = flag(flags, "worktree-root") ?? join(homes.stateHome, "worktrees", "learning-replay");
    await mkdir(worktreeRoot, { recursive: true });

    const context: ReplayExperimentContext = {
      experimentId,
      app: appEntry.name,
      stage: [appEntry.status],
      budgetMaxUsd: policy.learning_budget.per_candidate_replay_usd,
      declaredAt: record.declared_at,
    };
    const probe = await composeLearningLoop(homes, { policy });
    const activation = await findOkfActivationForIntervention(
      probe,
      [orgRoot, ...Object.values(appRoots)],
      record.intervention_id,
    );
    if (activation === undefined) {
      throw new Error(
        `learn experiment run: ${record.intervention_id} is not an OKF activation — only concepts that enter ` +
          "context replay as control/treatment arms (the control arm resolves the bundle minus the concept)",
      );
    }
    const learning = await composeWithRunner(homes, policy, context, fixtures, () =>
      createLoopReplayExecutor({
        orgHome: homes.orgHome,
        stateHome: homes.stateHome,
        localRepo: repoDir,
        worktreeRoot,
        app: appEntry,
        roles,
        runtimeForAssignment: (assignment) => getRuntime(assignment.harness),
        policy,
        controlExcludes: activation.conceptIds,
        candidateRef: record.artifact_id,
        hooks: { ...reporter.observer, gate: defaultGate },
      }),
    );
    await ingestEpisodes(learning);
    const outcome = await runKernelExperiment(learning, experimentId);
    const evaluation = outcome.evaluation;
    console.log(`experiment ${experimentId}: verdict ${evaluation.verdict}`);
    if (evaluation.analysis !== null) {
      const analysis = evaluation.analysis;
      console.log(
        `  primary: mean favorable delta ${fmt(analysis.meanFavorableDelta)} (${analysis.favorablePairs} favorable / ` +
          `${analysis.unfavorablePairs} unfavorable pairs; minimum useful effect ${analysis.minimumUsefulEffect})`,
      );
      for (const pair of analysis.pairs) {
        console.log(`  ${pair.episodeId}: control ${fmt(pair.control)} | treatment ${fmt(pair.treatment)}`);
      }
      for (const guardrail of analysis.guardrails) {
        console.log(`  guardrail ${guardrail.metric} (${guardrail.rule}): ${guardrail.status}`);
      }
    } else {
      const statuses = new Map<string, number>();
      for (const slot of evaluation.classifications) {
        statuses.set(slot.status, (statuses.get(slot.status) ?? 0) + 1);
      }
      console.log(`  slots: ${[...statuses.entries()].map(([status, n]) => `${status}=${n}`).join(" ")}`);
    }
    for (const diagnostic of evaluation.diagnostics) console.log(`  ${diagnostic.code}: ${diagnostic.message}`);
    const spent = (await rollupLearningSpend(homes.stateHome)).byExperiment.get(experimentId);
    if (spent !== undefined) console.log(`  cost: $${spent.toFixed(2)} (org ledger)`);
    console.log(`  recorded: ${evaluation.id} on ${record.intervention_id} (cormidia learn show ${experimentId})`);
    reporter.terminal("completed", { artifactRef: `evaluation:${evaluation.id}` });
    return 0;
  } catch (error) {
    reporter.terminal("failed", { nextAction: `inspect ${reporter.relativeLogRef}` });
    throw error;
  } finally {
    reporter.dispose();
  }
}

async function list(homes: CormidiaHomes): Promise<number> {
  const experiments = await listHostExperiments(learningLoopStateDir(homes.stateHome));
  if (experiments.length === 0) {
    console.log("no kernel experiments declared");
    return 0;
  }
  const spend = await rollupLearningSpend(homes.stateHome);
  for (const experiment of experiments) {
    const cost = spend.byExperiment.get(experiment.experiment_id);
    console.log(
      `${experiment.experiment_id} [${experiment.evaluation === undefined ? "declared" : "evaluated"}]` +
        (experiment.evaluation !== undefined ? ` verdict ${experiment.evaluation.verdict}` : "") +
        (cost !== undefined ? ` — $${cost.toFixed(2)} this month` : "") +
        ` — ${experiment.hypothesis.slice(0, 80)}`,
    );
  }
  return 0;
}

// ---------------------------------------------------------------------------
// canary
// ---------------------------------------------------------------------------

/** The facts a canary start/promote needs about a kernel activation. */
async function kernelActivationFacts(
  homes: CormidiaHomes,
  interventionId: string,
): Promise<{
  readonly learning: CormidiaLearningLoop;
  readonly activation: OkfActivation;
  readonly replayPassed: boolean;
}> {
  const learning = await composeLearningLoop(homes);
  const { orgRoot, appRoots } = learningRoots(homes);
  const activation = await findOkfActivationForIntervention(
    learning,
    [orgRoot, ...Object.values(appRoots)],
    interventionId,
  );
  if (activation === undefined) {
    throw new Error(`learn canary: ${interventionId} is not a kernel OKF activation on any reachable root`);
  }
  const view = await interventionViewOf(learning, interventionId);
  return { learning, activation, replayPassed: view?.state.validation === "improved" };
}

export async function learnCanary(homes: CormidiaHomes, args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "start": {
      const flags = parseFlags(rest, "learn canary start");
      const interventionId = flags.positionals[0];
      if (interventionId === undefined) throw new Error("learn canary start: <intervention-id> is required");
      const policy = await loadLearningPolicy(homes.orgHome);
      const facts = await kernelActivationFacts(homes, interventionId);
      const routing = facts.activation.intervention.routing;
      if (routing === undefined) throw new Error(`learn canary start: ${interventionId} carries no host routing`);
      const started = await startCanary({
        orgHome: homes.orgHome,
        ...appWorkdirFlag(homes, flags),
        activation: {
          rootKind: facts.activation.root.kind,
          version: facts.activation.version,
          tier: routing.tier,
          interventionRef: interventionId,
          replayPassed: facts.replayPassed,
        },
        policy,
        stateHome: homes.stateHome,
      });
      console.log(
        `canary started on the ${started.root} root: version ${started.version} ` +
          `(tier ${started.meta.tier}, fraction ${started.meta.fraction}, window ${started.meta.window_hours}h)`,
      );
      console.log(
        "  new episodes assign by hash of episode id (design §8.4); watch it with: cormidia learn canary status",
      );
      return 0;
    }
    case "promote": {
      const flags = parseFlags(rest, "learn canary promote");
      const root = rootFlag(flags, "learn canary promote");
      const manifest = await readRootManifest(root, { orgHome: homes.orgHome, ...appWorkdirFlag(homes, flags) });
      const ref = manifest?.canary_meta?.intervention_ref;
      if (ref === undefined) throw new Error(`learn canary promote: no active canary on the ${root} root`);
      const facts = await kernelActivationFacts(homes, ref);
      const result = await promoteCanary({
        orgHome: homes.orgHome,
        ...appWorkdirFlag(homes, flags),
        root,
        stateHome: homes.stateHome,
        policy: await loadLearningPolicy(homes.orgHome),
        replayPassed: facts.replayPassed,
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
      const result = await stopCanary({ orgHome: homes.orgHome, ...appWorkdirFlag(homes, flags), root, reason });
      console.log(
        `stopped canary ${result.version} on the ${root} root -> cut ${result.newVersion}; ` +
          `deprecated: ${result.deactivated.join(", ") || "none still active"}`,
      );
      // Record the kernel intervention's disable (the concept is already
      // deprecated in place; the disable plan forward-completes on it).
      const facts = await kernelActivationFacts(homes, result.meta.intervention_ref).catch(() => undefined);
      if (facts !== undefined) {
        const disabled = await disableOkfActivation(facts.learning, facts.activation, flag(flags, "by") ?? "operator");
        console.log(
          "refused" in disabled
            ? `  kernel intervention ${result.meta.intervention_ref} not disabled: ${disabled.refused}`
            : `  kernel intervention ${result.meta.intervention_ref} disabled (${reason})`,
        );
      }
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
        appWorkdir: resolveAppWorkdir(app, { orgRoot: homes.orgHome, runtimeHome: homes.stateHome }),
      });
    } catch {
      // No local checkout — its manifest is unreachable from this CLI.
    }
  }

  let anyActive = false;
  for (const root of roots) {
    const manifest = await readRootManifest(root.kind, {
      orgHome: homes.orgHome,
      ...definedProps({ appWorkdir: root.appWorkdir }),
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
  const merged = closed.filter((record) => record.outcome?.merged === true).length;
  const mean = (values: number[]): number | null =>
    values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
  return {
    total: episodeIds.length,
    closed: closed.length,
    merged,
    mergedRate: closed.length > 0 ? merged / closed.length : null,
    meanReviewCycles: mean(closed.map((record) => record.outcome?.review_cycles ?? 0)),
    meanCostUsd: mean(closed.map((record) => record.outcome?.cost_usd ?? 0)),
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
 *  lineage. Both are stored content-addressed so declare can bind them and
 *  run can detect drift. */
async function armFingerprints(
  homes: CormidiaHomes,
  appName: string,
  candidate: CandidateArtifact,
): Promise<{ control: SystemFingerprint; treatment: SystemFingerprint; controlId: string; treatmentId: string }> {
  const rolesFile = await loadRoles(join(homes.orgHome, "roles.yaml"));
  const appEntry = homes.appsFile.apps.find((app) => app.name === appName);
  let workdir: string | undefined;
  if (appEntry !== undefined) {
    try {
      workdir = resolveAppWorkdir(appEntry, { orgRoot: homes.orgHome, runtimeHome: homes.stateHome });
    } catch {
      // No local checkout — app.commit reads null, same as capsule assembly.
    }
  }
  const versions: Record<string, string> = {
    org: (await readManifest(orgLearningRoot(homes.orgHome)))?.stable ?? "unversioned",
    ...(workdir !== undefined ? { app: (await readManifest(appLearningRoot(workdir)))?.stable ?? "unversioned" } : {}),
  };
  const control = await computeSystemFingerprint({
    packageRoot: homes.packageRoot,
    orgHome: homes.orgHome,
    app: {
      name: appName,
      ...definedProps({ workdir }),
      ...(appEntry !== undefined ? { budgetUsdMonth: appEntry.budgetUsdMonth } : {}),
    },
    roles: Object.fromEntries(rolesFile.roles.map((role) => [role.name, role])),
    bundle: { versions, lineage: "stable" },
  });
  const marker = candidate.content_hash.replace(/^sha256:/, "").slice(0, 12);
  const treatment = deriveFingerprintWithBundle(control, { versions, lineage: `candidate:${marker}` });
  return {
    control,
    treatment,
    controlId: await storeFingerprint(homes.stateHome, control),
    treatmentId: await storeFingerprint(homes.stateHome, treatment),
  };
}

async function nextExperimentId(stateDir: string, candidateId: string): Promise<string> {
  const suffix = candidateId.replace(/^cand_/, "");
  const existing = new Set((await listHostExperiments(stateDir)).map((record) => record.experiment_id));
  for (let n = 1; n < 100; n++) {
    const id = `exp_${suffix}_${String(n).padStart(2, "0")}`;
    if (!existing.has(id)) return id;
  }
  throw new Error(`learn experiment: 99 experiments already declared for ${candidateId}`);
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
  return { appWorkdir: resolveAppWorkdir(appEntry, { orgRoot: homes.orgHome, runtimeHome: homes.stateHome }) };
}

function fmt(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
