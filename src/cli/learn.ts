// `cormidia learn` — the episode-linked human review workflow
// (learning-loop M1 capture + M2 episode substrate; docs/learning-loop/
// design §10.1, spec §16).
//
// M2 surface: inspect renders the full projected EpisodeRecord (turns,
// gates, outcome, approvals, artifacts, late outcomes) plus the replay
// capsule's replayability for closed build episodes; emit records a human
// observation (three-field contract kept separate) or an append-only late
// outcome; show traces one event id to its disposition; report adds an
// episodes section over the capture totals. `report` is read-only by default;
// `report --refresh` explicitly runs capture + episode projection first.
// Other record-specific read paths retain their existing targeted refreshes.
//
// M3 surface (experiment substrate): show additionally traces exp_/eval_/
// int_ ids to their disposition (declared-before-results status, verdict,
// lineage-chain gaps); report gains experiments and interventions sections
// where an authorized claim always renders as "authorized (unproven)"
// (design §9.1); fixture converts a closed build episode's capsule into a
// sanitized eval fixture under the org home's learning/evals/** and — as a
// separate, independent act — validates it (spec §7 two-actor trust).
// Distillation, candidates, and activation land in later milestones — the
// only writes here are human_correction / late_outcome events, fixture
// drafts/validations, and the projections' own idempotent state.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { resolveAppWorkdir } from "../org/app-workdir.js";
import { rollupLearningSpend } from "../org/budget.js";
import { resolveCormidiaHomes, type CormidiaHomes } from "../org/home.js";
import { composeLearningLoop } from "../org/learning-loop/compose.js";
import { listHostExperiments, readHostExperiment } from "../org/learning-loop/experiments-audit.js";
import { readHostCandidateIndex } from "../org/learning-loop/host-index.js";
import {
  interventionViewOf,
  listKernelInterventions,
  type KernelInterventionView,
} from "../org/learning-loop/interventions.js";
import { learningLoopStateDir } from "../org/learning-loop/loop.js";
import { syncKernelEvidence } from "../org/learning-loop/sync.js";
import { findCandidateArtifact } from "../org/learning-loop/host/candidate-store.js";
import { capsuleIdFor, createCapsuleBuilder, type ReplayCapsule } from "../org/learning-loop/host/capsule.js";
import {
  previewCaptureEvents,
  projectCaptureEvents,
  type CaptureProjectionResult,
} from "../org/learning-loop/host/capture.js";
import { compactionReport, listM6RunRecords, prepareDistillation } from "../org/learning-loop/host/distillation.js";
import {
  projectLearningEfficiencyHealth,
  type LearningEfficiencyHealth,
} from "../org/learning-loop/host/efficiency-health.js";
import {
  createEpisodeProjector,
  readEpisodeRecord,
  readEpisodeRecords,
  type EpisodeProjector,
  type EpisodeRecord,
} from "../org/learning-loop/host/episode.js";
import { convertCapsuleToEvalFixture, trustEvalFixture } from "../org/learning-loop/host/eval-fixture.js";
import { listEvalResults, readEvalResult, type EvalResult } from "../org/learning-loop/host/eval-result.js";
import {
  createLearningEventSink,
  learningEventPath,
  readLearningEvents,
  readLearningEventsWithDiagnostics,
  type LearningEvent,
} from "../org/learning-loop/host/events.js";
import {
  listExperimentRecords,
  readExperimentRecord,
  type ExperimentRecord,
} from "../org/learning-loop/host/experiment.js";
import { computeSystemFingerprint, storeFingerprint } from "../org/learning-loop/host/fingerprint.js";
import {
  interventionChainGaps,
  interventionIdForCandidate,
  interventionPath,
  listInterventionRecords,
  readInterventionRecord,
} from "../org/learning-loop/host/intervention.js";
import { loadLearningPolicy } from "../org/learning-loop/host/policy.js";
import { readRejections } from "../org/learning-loop/host/rejections.js";
import { listReviewerVerdicts, readReviewerVerdict } from "../org/learning-loop/host/review.js";
import { loadRoles } from "../org/roles.js";
import { extractProgressArgs } from "../runtime/cli-progress.js";
import { definedProps } from "../runtime/optional-properties.js";
import { extractHomeFlags } from "./home-flags.js";
import {
  activationReport,
  learnDisable,
  learningRoots,
  learnProvisional,
  learnPublish,
  learnResolve,
  learnReview,
  learnRollback,
  renderVerdictLine,
} from "./learn-activation.js";
import { canaryStatusLines, learnCanary, learnExperiment } from "./learn-experiment.js";
import { runLiveDistillation } from "./learn-distill-run.js";

export async function cmdLearn(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "learn");
  const [sub, ...rest] = common.rest;
  const homes = await resolveCormidiaHomes(common);
  const stateHome = homes.stateHome;
  const appStages = Object.fromEntries(homes.appsFile.apps.map((app) => [app.name, app.status]));
  const appNames = homes.appsFile.apps.map((app) => app.name);
  const projector = createEpisodeProjector({ stateHome, appStages });

  switch (sub) {
    case "inspect": {
      const episodeId = positional(rest, "learn inspect", "<episode-id>");
      const projection = await projectCaptureEvents({ stateHome, appStages });
      await projector.project();
      return inspect(homes, episodeId, projection);
    }
    case "emit":
      return emit(stateHome, rest, appNames, appStages, projector);
    case "show": {
      const id = positional(rest, "learn show", "<event-id>");
      // exp_/eval_/int_/cand_ ids read org-home records — the state-home
      // projections cannot affect them, so don't pay a full runs/** scan.
      if (!/^(exp|eval|int|cand)_/.test(id)) {
        await projectCaptureEvents({ stateHome, appStages });
        await projector.project();
      }
      return show(homes, id);
    }
    case "fixture":
      // The draft path refreshes the projections itself; --validate only
      // touches one fixture file under the org home.
      return fixture(homes, rest, appStages, projector);
    case "report": {
      for (const flag of rest) {
        if (flag !== "--json" && flag !== "--refresh" && flag !== "--efficiency-health") {
          throw new Error(`learn report: unknown argument "${flag}"`);
        }
      }
      const json = rest.includes("--json");
      const refresh = rest.includes("--refresh");
      const efficiencyHealth = rest.includes("--efficiency-health");
      const projection = refresh
        ? await projectCaptureEvents({ stateHome, appStages })
        : await previewCaptureEvents({ stateHome, appStages });
      if (refresh) {
        await projector.project();
        // Kernel evidence follows the projection: ingest the episodes and
        // acknowledge the exposure sets of every closed episode.
        const sync = await composeLearningLoop(homes).then((learning) => syncKernelEvidence(learning));
        if (sync.acknowledged.length > 0 || sync.pending.length > 0) {
          console.error(
            `learning-loop: ${sync.acknowledged.length} exposure set(s) acknowledged; ` +
              `${sync.pending.length} episode(s) still open`,
          );
        }
      }
      return report(homes, projection, json, efficiencyHealth, refresh);
    }
    // M4 — the manual governed-activation surface (learn-activation.ts).
    case "review":
      return learnReview(homes, rest);
    case "publish":
      return learnPublish(homes, rest);
    case "resolve":
      return learnResolve(homes, rest);
    case "disable":
      return learnDisable(homes, rest);
    case "rollback":
      return learnRollback(homes, rest);
    case "provisional":
      return learnProvisional(homes, rest);
    // M5 — offline evaluation and the human-started canary
    // (learn-experiment.ts).
    case "experiment":
      return learnExperiment(homes, rest);
    case "canary":
      return learnCanary(homes, rest);
    case "distill":
      return distill(homes, rest);
    default:
      throw new Error(
        "learn: expected a subcommand — inspect <episode-id> | emit [--episode <id>] | " +
          "show <event|experiment|eval|intervention-id> | " +
          "fixture <episode-id> --set <scope>/<set> [--validate] --by <name> | " +
          "report [--efficiency-health] [--json] [--refresh] | " +
          "review <candidate-id> | publish <candidate-id> | resolve --app <app> --role <role> | " +
          "disable <concept-id> | rollback --root org|app | provisional | " +
          "experiment declare|run|list | canary start|status|promote|stop | " +
          "distill [--app <app>] [--dry-run]",
      );
  }
}

async function distill(homes: CormidiaHomes, args: string[]): Promise<number> {
  const progressArgs = extractProgressArgs(args, "learn distill");
  args = progressArgs.rest;
  let appName: string | undefined;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--app") appName = needValue(args, ++i, arg);
    else throw new Error(`learn distill: unknown argument "${arg}"`);
  }
  const live = homes.appsFile.apps.filter((app) => app.status === "live");
  if (appName === undefined) {
    if (live.length === 0) throw new Error("learn distill: no live app is registered");
    if (live.length > 1) {
      throw new Error(
        `learn distill: multiple live apps are registered (${live.map((app) => app.name).join(", ")}); ` +
          "pass --app <name> to preserve one-turn-one-app",
      );
    }
    appName = live[0]!.name;
  }
  const app = homes.appsFile.apps.find((entry) => entry.name === appName);
  if (app === undefined) throw new Error(`learn distill: unknown app ${appName}`);
  if (app.status !== "live") throw new Error(`learn distill: app ${appName} is ${app.status}, not live`);

  const roles = await loadRoles(join(homes.orgHome, "roles.yaml"));
  const role = roles.roles.find((entry) => entry.name === "distiller");
  if (role === undefined) throw new Error("learn distill: roles.yaml has no distiller role");

  if (dryRun) {
    const appWorkdir = resolveAppWorkdir(app, {
      orgRoot: homes.orgHome,
      runtimeHome: homes.stateHome,
    });
    const preparation = await prepareDistillation({
      orgHome: homes.orgHome,
      stateHome: homes.stateHome,
      app: app.name,
      appWorkdir,
      appStages: Object.fromEntries(homes.appsFile.apps.map((entry) => [entry.name, entry.status])),
      policy: await loadLearningPolicy(homes.orgHome),
    });
    console.log(JSON.stringify(preparation, null, 2));
    return 0;
  }

  return runLiveDistillation(homes, app, role, progressArgs.mode);
}

// ---------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------

async function inspect(homes: CormidiaHomes, episodeId: string, projection: CaptureProjectionResult): Promise<number> {
  const stateHome = homes.stateHome;
  const events = (await readLearningEvents(stateHome)).filter((event) => event.episode_id === episodeId);
  const record = (await readEpisodeRecords(stateHome)).find((candidate) => candidate.episode_id === episodeId);
  if (record === undefined && events.length === 0) {
    console.error(
      `learn: no captured events for ${episodeId}` +
        (projection.runsPending > 0
          ? ` (${projection.runsPending} run(s) still pending capture — not yet terminal)`
          : "") +
        "\nList known episodes with: cormidia learn report",
    );
    return 1;
  }

  const lines: string[] = [];
  if (record !== undefined) {
    lines.push(`Episode ${episodeId} — ${record.kind}, ${record.status}`);
    lines.push(
      `App: ${record.app}${record.stage !== null ? ` (stage ${record.stage})` : ""}   ` +
        `Source: ${record.source.kind} ${record.source.ref}`,
    );
    lines.push(`Opened: ${record.opened}` + (record.closed !== undefined ? `   Closed: ${record.closed}` : ""));

    lines.push("", "Turns:");
    for (const turn of record.turns) {
      lines.push(
        `  ${turn.turn_id} — role ${turn.role}; passes ${turn.pipeline}/${turn.pass} ` +
          `[${turn.status}]; runs ${turn.run_ids.join(", ")}`,
      );
    }

    if (record.gates.length > 0) {
      lines.push("", "Gate outcomes:");
      for (const gate of record.gates) {
        lines.push(
          `  [${gate.status}] ${gate.gate} (${gate.run_id})` + (gate.detail !== undefined ? ` — ${gate.detail}` : ""),
        );
      }
    }
  } else {
    // No projected record (runs pruned before projection, or an
    // observation-only id): render what the capture events still carry —
    // the M1 view — instead of hiding evidence that survives on disk.
    lines.push(`Episode ${episodeId}`);
    lines.push(
      `App: ${events[0]?.app}   Events: ${events.length}` +
        "   (no projected record — its runs may be pruned or it never had any)",
    );
    const turns = new Map<string, LearningEvent[]>();
    for (const event of events) {
      if (event.turn_id === undefined) continue;
      turns.set(event.turn_id, [...(turns.get(event.turn_id) ?? []), event]);
    }
    if (turns.size > 0) {
      lines.push("", "Turns:");
      for (const [turnId, turnEvents] of [...turns.entries()].sort()) {
        const roles = uniq(turnEvents.map((event) => event.agent_role ?? "?"));
        const passes = uniq(turnEvents.map((event) => `${event.pipeline ?? "?"}/${event.pass ?? "?"}`));
        const runs = uniq(turnEvents.map((event) => event.run_id ?? "?"));
        lines.push(`  ${turnId} — role ${roles.join(", ")}; passes ${passes.join(", ")}; runs ${runs.join(", ")}`);
      }
    }
    const gateEvents = events.filter((event) => event.type === "gate_verdict");
    if (gateEvents.length > 0) {
      lines.push("", "Gate outcomes:");
      for (const gate of gateEvents) {
        const detail = typeof gate.payload?.["detail"] === "string" ? ` — ${gate.payload["detail"]}` : "";
        lines.push(`  [${gate.payload?.["status"]}] ${gate.payload?.["gate"]} (${gate.run_id})${detail}`);
      }
    }
    const lateEvents = events.filter((event) => event.type === "late_outcome");
    if (lateEvents.length > 0) {
      lines.push("", "Late outcomes:");
      for (const late of lateEvents) {
        lines.push(
          `  ${late.payload?.["kind"]} ${late.payload?.["ref"]} (recorded ${late.ts})` +
            (typeof late.payload?.["note"] === "string" ? ` — ${late.payload["note"]}` : ""),
        );
      }
    }
  }

  // Pass verdicts live only in capture events (spec §4) — render from there.
  const verdicts = events.filter((event) => event.type === "pass_verdict");
  if (verdicts.length > 0) {
    lines.push("", "Pass verdicts:");
    for (const verdict of verdicts) {
      lines.push(`  ${verdict.pipeline}/${verdict.pass}: ${compactPayload(verdict.payload)} (${verdict.run_id})`);
    }
  }

  if (record?.outcome !== undefined) {
    const outcome = record.outcome;
    lines.push("", "Outcome:");
    lines.push(
      `  completed ${outcome.completed ? "yes" : "no"}` +
        (outcome.merged !== undefined ? `; merged ${outcome.merged ? "yes" : "no"}` : "") +
        (outcome.release_disposition !== null ? `; release disposition ${outcome.release_disposition}` : ""),
    );
    lines.push(
      `  review cycles ${outcome.review_cycles}; gate failures ${outcome.gate_failures}; ` +
        `human interventions ${outcome.human_interventions}`,
    );
    lines.push(
      `  cost ${outcome.cost_estimated ? "~" : ""}$${outcome.cost_usd.toFixed(2)} (org ledger)` +
        (outcome.unsettled_runs.length > 0
          ? `; UNSETTLED runs: ${outcome.unsettled_runs.join(", ")} — run cormidia budget --reconcile`
          : ""),
    );
  }

  if (record !== undefined && record.approvals.length > 0) {
    lines.push("", `Approvals: ${record.approvals.join(", ")}`);
  }
  if (record !== undefined && record.artifacts.length > 0) {
    lines.push("", `Artifacts: ${record.artifacts.join(", ")}`);
    for (const effect of record.side_effects) {
      lines.push(`  ${effect.kind} ${effect.ref} (${effect.reversible ? "reversible" : "irreversible"})`);
    }
  }

  if (record !== undefined && record.kind === "build_ticket" && record.status === "closed") {
    lines.push("", ...(await capsuleLines(homes, record)));
  }

  if (record !== undefined && record.late_outcomes.length > 0) {
    lines.push("", "Late outcomes:");
    for (const late of record.late_outcomes) {
      lines.push(
        `  ${late.kind} ${late.ref} (recorded ${late.recorded})` + (late.note !== undefined ? ` — ${late.note}` : ""),
      );
    }
  }

  const humans = events.filter((event) => event.type === "human_correction");
  if (humans.length > 0) {
    lines.push("", "Human observations:");
    for (const observation of humans) {
      lines.push(`  ${observation.event_id} (${observation.ts})`);
      lines.push(`    observation: ${observation.payload?.["observation"]}`);
      if (observation.payload?.["cause_hypothesis_text"] !== undefined) {
        lines.push(`    cause hypothesis: ${observation.payload["cause_hypothesis_text"]}`);
      }
      if (observation.payload?.["suggested_intervention"] !== undefined) {
        lines.push(`    suggested intervention: ${observation.payload["suggested_intervention"]}`);
      }
    }
  }

  console.log(lines.join("\n"));
  return 0;
}

/** Best-effort capsule assembly for a build episode: a broken roles.yaml or
 *  missing checkout degrades the fingerprint (recorded as a failure reason),
 *  never the caller. Shared by inspect's capsule section and `learn fixture`. */
async function assembleCapsule(
  homes: CormidiaHomes,
  record: EpisodeRecord,
): Promise<{ capsule: ReplayCapsule; fingerprintFailure?: string }> {
  let fingerprintRef: string | undefined;
  let fingerprintFailure: string | undefined;
  try {
    const rolesFile = await loadRoles(join(homes.orgHome, "roles.yaml"));
    const appEntry = homes.appsFile.apps.find((app) => app.name === record.app);
    let workdir: string | undefined;
    if (appEntry !== undefined) {
      try {
        workdir = resolveAppWorkdir(appEntry, {
          orgRoot: homes.orgHome,
          runtimeHome: homes.stateHome,
        });
      } catch {
        // No local checkout — the fingerprint's app.commit reads null.
      }
    }
    const fingerprint = await computeSystemFingerprint({
      packageRoot: homes.packageRoot,
      orgHome: homes.orgHome,
      app: {
        name: record.app,
        ...definedProps({ workdir }),
        ...(appEntry !== undefined ? { budgetUsdMonth: appEntry.budgetUsdMonth } : {}),
      },
      roles: Object.fromEntries(rolesFile.roles.map((role) => [role.name, role])),
    });
    fingerprintRef = await storeFingerprint(homes.stateHome, fingerprint);
  } catch (error) {
    // Fingerprint is best-effort here; the capsule lists it as missing and
    // the reason renders in the caller.
    fingerprintFailure = (error as Error).message;
  }

  const capsule = await createCapsuleBuilder({
    stateHome: homes.stateHome,
    repoByApp: Object.fromEntries(homes.appsFile.apps.map((app) => [app.name, app.repo])),
    ...definedProps({ fingerprintRef }),
  }).assemble(record.episode_id);
  return { capsule, ...definedProps({ fingerprintFailure }) };
}

/** Replay-capsule section for a closed build episode. */
async function capsuleLines(homes: CormidiaHomes, record: EpisodeRecord): Promise<string[]> {
  let capsule: ReplayCapsule;
  let fingerprintFailure: string | undefined;
  try {
    ({ capsule, fingerprintFailure } = await assembleCapsule(homes, record));
  } catch (error) {
    return [`Replay capsule: not assembled — ${(error as Error).message}`];
  }
  return [
    `Replay capsule: ${capsule.capsule_id} — ${capsule.replayability}`,
    ...(capsule.missing.length > 0 ? [`  missing for trusted replay: ${capsule.missing.join(", ")}`] : []),
    ...(fingerprintFailure !== undefined ? [`  fingerprint not computed: ${fingerprintFailure}`] : []),
    ...(capsule.seed.repo !== null && capsule.seed.commit !== null
      ? [`  seed: ${capsule.seed.repo}@${capsule.seed.commit}`]
      : []),
  ];
}

// ---------------------------------------------------------------------------
// emit
// ---------------------------------------------------------------------------

interface EmitInput {
  episode: string | undefined;
  app: string | undefined;
  observation: string | undefined;
  cause: string | undefined;
  intervention: string | undefined;
  artifacts: string[];
  file: string | undefined;
  lateOutcome: string | undefined;
  ref: string | undefined;
  note: string | undefined;
}

async function emit(
  stateHome: string,
  args: string[],
  appNames: string[],
  appStages: Record<string, string>,
  projector: EpisodeProjector,
): Promise<number> {
  const parsed = parseEmitArgs(args);

  // The two lanes take disjoint flags; silently dropping the other lane's
  // input would be data loss with a success exit code.
  if (parsed.lateOutcome !== undefined) {
    const stray = [
      parsed.observation !== undefined ? "--observation" : undefined,
      parsed.cause !== undefined ? "--cause" : undefined,
      parsed.intervention !== undefined ? "--intervention" : undefined,
      parsed.artifacts.length > 0 ? "--artifact" : undefined,
      parsed.file !== undefined ? "--file" : undefined,
    ].filter((flag): flag is string => flag !== undefined);
    if (stray.length > 0) {
      throw new Error(
        `learn emit: ${stray.join(", ")} belong(s) to the observation lane — ` +
          "record the observation as a separate emit, or drop --late-outcome",
      );
    }
  } else if (parsed.ref !== undefined || parsed.note !== undefined) {
    throw new Error("learn emit: --ref/--note only apply with --late-outcome <kind>");
  }

  // Late outcomes are the record's one append-only lane (design §8.3):
  // routed through the projector so they fold into the EpisodeRecord.
  if (parsed.lateOutcome !== undefined) {
    if (parsed.episode === undefined || parsed.ref === undefined) {
      throw new Error("learn emit: --late-outcome <kind> requires --episode <id> and --ref <ref>");
    }
    await projectCaptureEvents({ stateHome, appStages });
    await projector.project();
    const event = await projector.recordLateOutcome(parsed.episode, {
      kind: parsed.lateOutcome,
      ref: parsed.ref,
      ...definedProps({ note: parsed.note }),
    });
    console.log(`recorded late outcome ${event.event_id} against ${event.episode_id}`);
    console.log(`  it folds into the episode record on the next projection`);
    console.log(`  trace it with: cormidia learn show ${event.event_id}`);
    return 0;
  }

  if (parsed.file !== undefined) {
    const spec = JSON.parse(await readFile(parsed.file, "utf8")) as Record<string, unknown>;
    parsed.episode ??= asOptionalString(spec, "episode_id") ?? asOptionalString(spec, "episode");
    parsed.observation ??= asOptionalString(spec, "observation");
    parsed.cause ??= asOptionalString(spec, "cause_hypothesis");
    parsed.intervention ??= asOptionalString(spec, "suggested_intervention");
    const artifacts = spec["artifacts"];
    if (Array.isArray(artifacts)) parsed.artifacts.push(...artifacts.map(String));
  }

  if (parsed.observation === undefined || parsed.episode === undefined) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      const rl = createInterface({ input, output });
      try {
        parsed.episode ??= (await rl.question("Episode id (ep_…): ")).trim();
        parsed.observation ??= (await rl.question("Observation (what you directly saw): ")).trim();
        parsed.cause ??= orUndefined((await rl.question("Cause hypothesis (optional): ")).trim());
        parsed.intervention ??= orUndefined((await rl.question("Suggested intervention (optional): ")).trim());
      } finally {
        rl.close();
      }
    } else {
      throw new Error(
        "learn emit: --episode and --observation (or --file <json>) are required outside an interactive terminal",
      );
    }
  }
  if (!parsed.episode) throw new Error("learn emit: episode id must not be empty");
  if (!parsed.observation) throw new Error("learn emit: observation must not be empty");

  const app = parsed.app ?? appFromEpisodeId(parsed.episode, appNames);
  if (app === undefined) {
    throw new Error(
      `learn emit: could not derive the app from "${parsed.episode}" — pass --app <name> (registered: ${appNames.join(", ") || "none"})`,
    );
  }

  const now = new Date();
  const event: LearningEvent = {
    event_id: mintEventId(now),
    episode_id: parsed.episode,
    ts: now.toISOString(),
    app,
    stage: appStages[app] ?? null,
    risk_tier: null,
    release_disposition: null,
    type: "human_correction",
    emitter: "human",
    source_channel: "internal",
    trust: "trusted",
    payload: {
      // The three-field contract stays separate (design §10.1): the
      // observation is trusted human evidence; the cause is a hypothesis
      // even from a human; the intervention still requires review.
      observation: parsed.observation,
      ...definedProps({ cause_hypothesis_text: parsed.cause }),
      ...definedProps({ suggested_intervention: parsed.intervention }),
      ...(parsed.artifacts.length > 0 ? { artifacts: parsed.artifacts } : {}),
    },
  };
  await createLearningEventSink(stateHome).emit(event);
  console.log(`recorded ${event.event_id} against ${event.episode_id}`);
  console.log(`  ${learningEventPath(stateHome, event)}`);
  console.log(`  trace it with: cormidia learn show ${event.event_id}`);
  return 0;
}

function parseEmitArgs(args: string[]): EmitInput {
  const out: EmitInput = {
    episode: undefined,
    app: undefined,
    observation: undefined,
    cause: undefined,
    intervention: undefined,
    artifacts: [],
    file: undefined,
    lateOutcome: undefined,
    ref: undefined,
    note: undefined,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--episode") out.episode = needValue(args, ++i, arg);
    else if (arg === "--app") out.app = needValue(args, ++i, arg);
    else if (arg === "--observation") out.observation = needValue(args, ++i, arg);
    else if (arg === "--cause") out.cause = needValue(args, ++i, arg);
    else if (arg === "--intervention") out.intervention = needValue(args, ++i, arg);
    else if (arg === "--artifact") out.artifacts.push(needValue(args, ++i, arg));
    else if (arg === "--file") out.file = needValue(args, ++i, arg);
    else if (arg === "--late-outcome") out.lateOutcome = needValue(args, ++i, arg);
    else if (arg === "--ref") out.ref = needValue(args, ++i, arg);
    else if (arg === "--note") out.note = needValue(args, ++i, arg);
    else throw new Error(`learn emit: unknown argument "${arg}"`);
  }
  return out;
}

/** Episode ids embed the verbatim registry app name (`ep_<app>_…`, spec §5);
 *  match against the registry rather than parsing — app names may contain
 *  any separator. */
function appFromEpisodeId(episodeId: string, appNames: string[]): string | undefined {
  return appNames.find((name) => episodeId.startsWith(`ep_${name}_`));
}

function mintEventId(now: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  const stamp =
    `${p(now.getUTCFullYear(), 4)}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  const suffix = Math.random().toString(36).slice(2, 6);
  return `evt_${stamp}_${suffix}`;
}

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

/** A kernel journal is whole by construction: no chain gap can exist. */
function noGaps(): string[] {
  return [];
}

function kernelStatusLabel(view: KernelInterventionView): string {
  if (view.state.publication === "rolled_back") return "rolled_back";
  if (view.state.activation === "disabled") return "disabled";
  if (view.state.activation === "active") return "active";
  if (view.state.publication === "published") return "published";
  if (view.state.publication === "failed") return "failed";
  return "proposed";
}

async function show(homes: CormidiaHomes, id: string): Promise<number> {
  const stateHome = homes.stateHome;

  // Kernel interventions and kernel experiments (Cormidia #467 phase B).
  if (id.startsWith("intervention-")) {
    const learning = await composeLearningLoop(homes);
    const view = await interventionViewOf(learning, id);
    if (view === undefined) {
      console.error(`learn: no kernel intervention ${id}`);
      return 1;
    }
    console.log(JSON.stringify(view, null, 2));
    console.log("");
    console.log(
      `disposition: ${kernelStatusLabel(view)} ${view.routing?.destination ?? "unknown"}` +
        (view.claimLabel !== undefined ? `; claim ${view.claimLabel}` : "") +
        `; validation ${view.state.validation}; chain complete (kernel journal)`,
    );
    return 0;
  }
  if (id.startsWith("exp_")) {
    const experiment = await readHostExperiment(learningLoopStateDir(stateHome), id);
    if (experiment !== undefined) {
      console.log(JSON.stringify(experiment, null, 2));
      console.log("");
      console.log(
        experiment.evaluation === undefined
          ? `disposition: declared — no results yet (declared-before-results, kernel decision 0028)`
          : `disposition: evaluated ${experiment.evaluation.verdict} (${experiment.evaluation.id}) on ${experiment.intervention_id}`,
      );
      return 0;
    }
  }

  // M3 record ids route to the committed org home's learning stores. A
  // missing record is the same class of user mistake as an unknown event id:
  // guidance on stderr and exit 1, not a stack trace.
  if (/^(exp|eval|int)_/.test(id)) {
    try {
      if (id.startsWith("exp_")) {
        const experiment = await readExperimentRecord(homes.orgHome, id);
        console.log(JSON.stringify(experiment, null, 2));
        console.log("");
        console.log(
          experiment.status === "decided"
            ? `disposition: decided by ${experiment.result} — trace it with: cormidia learn show ${experiment.result}`
            : `disposition: ${experiment.status} — no results yet (declared-before-results, design §9.1)`,
        );
      } else if (id.startsWith("eval_")) {
        const result = await readEvalResult(homes.orgHome, id);
        console.log(JSON.stringify(result, null, 2));
        console.log("");
        console.log(
          `disposition: verdict ${result.verdict} for ${result.experiment_ref} ` +
            `(grader ${result.grader.kind}: ${result.grader.ref})`,
        );
      } else {
        const intervention = await readInterventionRecord(homes.orgHome, id);
        console.log(JSON.stringify(intervention, null, 2));
        console.log("");
        const gaps = interventionChainGaps(intervention);
        console.log(
          `disposition: ${intervention.status} ${intervention.destination}` +
            (intervention.activation !== null ? `; claim ${claimLabel(intervention.activation.claim)}` : "") +
            (gaps.length > 0 ? `; chain INCOMPLETE — missing ${gaps.join(", ")}` : "; chain complete"),
        );
      }
      return 0;
    } catch (error) {
      console.error((error as Error).message);
      return 1;
    }
  }

  // Candidate ids trace review → publish/rejection disposition (M4).
  if (id.startsWith("cand_")) {
    const { orgRoot, appRoots } = learningRoots(homes);
    const found = await findCandidateArtifact([orgRoot, ...Object.values(appRoots)], id);
    if (found === undefined) {
      console.error(`learn: no candidate ${id} in any learning root`);
      return 1;
    }
    console.log(JSON.stringify(found.candidate, null, 2));
    console.log("");
    const verdict = await readReviewerVerdict(homes.orgHome, id);
    if (verdict === undefined) {
      console.log("disposition: awaiting review (fails closed) — cormidia learn review " + id);
      return 0;
    }
    console.log(`review: ${verdict.verdict} by ${verdict.reviewed_by} — ${verdict.rationale}`);
    // Kernel lineage first (the host index maps the artifact to its kernel
    // candidates, plans, and interventions); the forked engine's record is
    // history.
    const index = await readHostCandidateIndex(learningLoopStateDir(stateHome), id);
    const published = [...(index?.entries ?? [])].reverse().find((entry) => entry.intervention_id !== undefined);
    if (published?.intervention_id !== undefined) {
      const learning = await composeLearningLoop(homes);
      const view = await interventionViewOf(learning, published.intervention_id);
      console.log(
        view === undefined
          ? `disposition: kernel intervention ${published.intervention_id} is not readable`
          : `disposition: ${kernelStatusLabel(view)} ${view.routing?.destination ?? "unknown"} — ` +
              `trace it with: cormidia learn show ${view.id}`,
      );
      return 0;
    }
    // Distinguish "no record" from "corrupt record": a lineage record that
    // exists but fails validation must surface loudly, never read as
    // "not yet published" (that advice would re-run a committed publish).
    const interventionId = interventionIdForCandidate(id);
    if (existsSync(interventionPath(homes.orgHome, interventionId))) {
      const intervention = await readInterventionRecord(homes.orgHome, interventionId);
      console.log(
        `disposition: ${intervention.status} ${intervention.destination} — ` +
          `trace it with: cormidia learn show ${intervention.intervention_id}`,
      );
    } else {
      const rejected = (await readRejections(homes.orgHome)).find((entry) => entry.candidate_id === id);
      console.log(
        rejected !== undefined
          ? `disposition: rejected ${rejected.rejected_at} by ${rejected.by} — ${rejected.reason}`
          : `disposition: reviewed, not yet published — cormidia learn publish ${id}`,
      );
    }
    return 0;
  }

  const events = await readLearningEvents(stateHome);
  const match = events.find((event) => event.event_id === id);
  if (match === undefined) {
    console.error(`learn: no captured event with id ${id}`);
    return 1;
  }
  console.log(JSON.stringify(match, null, 2));
  console.log("");
  console.log(`stored at: ${learningEventPath(stateHome, match)}`);
  console.log(
    match.type === "late_outcome"
      ? `disposition: folded into ${match.episode_id}'s record (late_outcomes) — inspect it with: cormidia learn inspect ${match.episode_id}`
      : "disposition: captured — available to the M6 classification and distillation window",
  );
  return 0;
}

/** `validated` is earned; `authorized` renders as unproven everywhere
 *  (design §9.1) so an unevaluated activation can never read as a win. */
function claimLabel(claim: "authorized" | "validated"): string {
  return claim === "validated" ? "validated" : "authorized (unproven)";
}

// ---------------------------------------------------------------------------
// fixture — capsule -> sanitized eval fixture (draft), then independent trust
// ---------------------------------------------------------------------------

async function fixture(
  homes: CormidiaHomes,
  args: string[],
  appStages: Record<string, string>,
  projector: EpisodeProjector,
): Promise<number> {
  // One positional (the episode id, consumed by POSITION so a flag value may
  // legally equal it) plus flags in any order.
  let episodeId: string | undefined;
  let set: string | undefined;
  let by: string | undefined;
  let validate = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--set") set = needValue(args, ++i, arg);
    else if (arg === "--by") by = needValue(args, ++i, arg);
    else if (arg === "--validate") validate = true;
    else if (!arg.startsWith("--") && episodeId === undefined) episodeId = arg;
    else throw new Error(`learn fixture: unknown argument "${arg}"`);
  }
  if (episodeId === undefined) throw new Error("learn fixture: <episode-id> is required");
  if (set === undefined) {
    throw new Error("learn fixture: --set <scope>/<set-name> is required (e.g. roles/builder/standard-tickets)");
  }
  if (by === undefined) {
    // Both acts are identity-bearing: the independence check pivots on who
    // drafted, so an anonymous default drafter would let one human play both
    // actors (draft as the default, validate as themselves).
    throw new Error(
      `learn fixture: --by <name> is required — ${validate ? "validation" : "drafting"} records who acted, ` +
        "and the drafter/validator independence check depends on it",
    );
  }
  const capsuleId = capsuleIdFor(episodeId);

  if (validate) {
    const trusted = await trustEvalFixture({
      orgHome: homes.orgHome,
      set,
      capsuleId,
      validatedBy: by,
    });
    console.log(`fixture ${trusted.fixture_id} validated by ${trusted.validated_by}`);
    console.log("  sanitization re-verified against the canonical secret patterns");
    console.log(
      "  note: the secret scan is regex-shaped only — the fixture embeds the verbatim " +
        "brief, so validation includes reviewing it for sensitive free text (PII, internal " +
        "hostnames) the patterns cannot catch",
    );
    return 0;
  }

  // Draft path: make sure the capsule reflects the current projection first.
  await projectCaptureEvents({ stateHome: homes.stateHome, appStages });
  await projector.project();
  let record: EpisodeRecord;
  try {
    record = await readEpisodeRecord(homes.stateHome, episodeId);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  const { fingerprintFailure } = await assembleCapsule(homes, record);

  const converted = await convertCapsuleToEvalFixture({
    orgHome: homes.orgHome,
    stateHome: homes.stateHome,
    capsuleId,
    set,
    draftedBy: by,
  });
  console.log(`drafted ${converted.fixture.fixture_id} (by ${converted.fixture.drafted_by})`);
  console.log(`  ${converted.path}`);
  console.log(`  secrets scrubbed: ${converted.redactions} match(es) redacted`);
  if (fingerprintFailure !== undefined) {
    // A trust gap the validate step cannot fix — name the cause so the
    // operator re-drafts after repairing it instead of trusting a fixture
    // that can never reach trusted replayability.
    console.log(`  fingerprint not computed: ${fingerprintFailure}`);
  }
  if (converted.trust_gaps.length > 0) {
    console.log(`  not yet trusted — missing: ${converted.trust_gaps.join(", ")}`);
    console.log(
      `  validate independently with: cormidia learn fixture ${episodeId} --set ${set} --validate --by <someone-else>`,
    );
  }
  return 0;
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

async function report(
  homes: CormidiaHomes,
  projection: CaptureProjectionResult,
  json: boolean,
  efficiencyHealthRequested: boolean,
  refresh: boolean,
): Promise<number> {
  const stateHome = homes.stateHome;
  // One corrupt governance file (hand edit, merge conflict) must not take
  // the whole human window down: each org-home store degrades to an error
  // line, loudly, while the capture/episode report still renders — the same
  // shape loadBundle uses for a malformed memory doc.
  const storeErrors: string[] = [];
  const guarded = async <T>(read: Promise<T[]>): Promise<T[]> =>
    read.catch((error: Error) => {
      storeErrors.push(error.message);
      return [];
    });
  const [eventRead, records, experiments, evalResults, interventions, verdicts] = await Promise.all([
    readLearningEventsWithDiagnostics(stateHome),
    readEpisodeRecords(stateHome),
    guarded(listExperimentRecords(homes.orgHome)),
    guarded(listEvalResults(homes.orgHome)),
    guarded(listInterventionRecords(homes.orgHome)),
    guarded(listReviewerVerdicts(homes.orgHome)),
  ]);
  // The kernel path (Cormidia #467 phase B): interventions re-read from the
  // kernel through the host index, experiments from the host audit copies.
  // Forked-engine records above stay listed as history (compatibility policy
  // §3a/§3b), marked `engine: "forked"`.
  const kernelInterventions = await composeLearningLoop(homes)
    .then((learning) => listKernelInterventions(learning))
    .catch((error: Error): KernelInterventionView[] => {
      storeErrors.push(`kernel interventions unavailable: ${error.message}`);
      return [];
    });
  const kernelExperiments = await guarded(listHostExperiments(learningLoopStateDir(stateHome)));
  const kernelInterventionRows = kernelInterventions.map((view) => ({
    intervention_id: view.id,
    engine: "kernel" as const,
    destination: view.routing?.destination ?? "unknown",
    status: kernelStatusLabel(view),
    claim: view.claim,
    ...(view.claimLabel !== undefined ? { claim_display: view.claimLabel } : {}),
    state: view.state,
    chain_gaps: noGaps(),
  }));
  const kernelExperimentRows = kernelExperiments.map((experiment) => ({
    experiment_id: experiment.experiment_id,
    engine: "kernel" as const,
    status: experiment.evaluation === undefined ? "declared" : "evaluated",
    candidate_ref: experiment.artifact_id,
    intervention_ref: experiment.intervention_id,
    control: experiment.control_fingerprint,
    treatment: experiment.treatment_fingerprint,
    result: experiment.evaluation?.id ?? null,
    ...(experiment.evaluation !== undefined ? { verdict: experiment.evaluation.verdict } : {}),
  }));
  const events = eventRead.events;
  for (const path of eventRead.missingFiles) {
    storeErrors.push(`learning event file disappeared before read: ${path}`);
  }
  // M4 activation sections: review queue + SLA, reviewer-human agreement,
  // suppression ledger size, and per-concept load counts from resolver events.
  // Same degrade-gracefully contract as every other org-home store: a
  // malformed policy.yaml becomes a STORE ERRORS line, never a dead report.
  const policy = await loadLearningPolicy(homes.orgHome).catch((error: Error) => {
    storeErrors.push(error.message);
    return undefined;
  });
  const activation =
    policy === undefined
      ? undefined
      : await activationReport(homes, policy, verdicts).catch((error: Error) => {
          storeErrors.push(error.message);
          return undefined;
        });
  const conceptLoads = count(
    events
      .filter((event) => event.type === "concept_loaded")
      .map((event) => String(event.payload?.["concept_id"] ?? "unknown")),
  );
  const evalById = new Map(evalResults.map((result) => [result.eval_id, result]));
  const byType = count(events.map((event) => event.type));
  const byApp = count(events.map((event) => event.app));
  const eventsByEpisode = new Map<string, number>();
  for (const event of events) {
    eventsByEpisode.set(event.episode_id, (eventsByEpisode.get(event.episode_id) ?? 0) + 1);
  }
  const gateFailures = count(
    events
      .filter((event) => event.type === "gate_verdict" && event.payload?.["status"] === "fail")
      .map((event) => event.error_class ?? "unknown"),
  );
  const humans = events.filter((event) => event.type === "human_correction");
  const open = records.filter((record) => record.status === "open");
  const closed = records.filter((record) => record.status === "closed");

  // M5: learning-budget accountability (design §9.5 — cost per experiment,
  // cost per accepted improvement) and the canary view.
  const learningSpend = await rollupLearningSpend(stateHome);
  const month = new Date().toISOString().slice(0, 7);
  const improvedThisMonth = evalResults.filter(
    (result) => result.verdict === "improved" && result.decided_at.startsWith(month),
  ).length;
  const costPerExperiment =
    learningSpend.experimentsThisMonth > 0 ? learningSpend.monthUsd / learningSpend.experimentsThisMonth : null;
  const costPerImprovement = improvedThisMonth > 0 ? learningSpend.monthUsd / improvedThisMonth : null;
  const canaryLines =
    policy !== undefined
      ? await canaryStatusLines(homes, policy, records).catch((error: Error) => {
          storeErrors.push(error.message);
          return [];
        })
      : [];
  const m6Runs = await listM6RunRecords(stateHome).catch((error: Error) => {
    storeErrors.push(error.message);
    return [];
  });
  const { orgRoot, appRoots } = learningRoots(homes);
  let efficiencyHealth: LearningEfficiencyHealth | undefined;
  if (efficiencyHealthRequested && policy !== undefined) {
    efficiencyHealth = await projectLearningEfficiencyHealth({
      orgHome: homes.orgHome,
      stateHome,
      capture: projection,
      policy,
      roots: [orgRoot, ...Object.values(appRoots)],
      kernel: { interventions: kernelInterventions, experiments: kernelExperiments },
      ...(refresh ? { persist: true } : {}),
    }).catch((error: Error) => {
      storeErrors.push(error.message);
      return undefined;
    });
  }
  const compaction =
    policy === undefined
      ? []
      : await compactionReport({
          roots: [orgRoot, ...Object.values(appRoots)],
          events,
          policy,
        }).catch((error: Error) => {
          storeErrors.push(error.message);
          return [];
        });

  if (json) {
    console.log(
      JSON.stringify(
        {
          capture: projection,
          totals: { events: events.length, by_type: byType, by_app: byApp },
          episodes: [
            ...records.map((record) => ({
              episode_id: record.episode_id,
              kind: record.kind,
              status: record.status,
              events: eventsByEpisode.get(record.episode_id) ?? 0,
              ...(record.outcome !== undefined
                ? {
                    completed: record.outcome.completed,
                    cost_usd: record.outcome.cost_usd,
                    cost_estimated: record.outcome.cost_estimated,
                    release_disposition: record.outcome.release_disposition,
                  }
                : {}),
            })),
            // Event-bearing episodes without a projected record (pruned
            // before projection, or observation-only ids) stay visible in
            // the machine-readable surface too.
            ...[...eventsByEpisode.entries()]
              .filter(([episodeId]) => !records.some((r) => r.episode_id === episodeId))
              .map(([episodeId, n]) => ({
                episode_id: episodeId,
                status: "no_record" as const,
                events: n,
              })),
          ],
          gate_failures: gateFailures,
          human_observations: humans.map((event) => event.event_id),
          learning_spend: {
            month_usd: learningSpend.monthUsd,
            experiments_this_month: learningSpend.experimentsThisMonth,
            distillations_this_week: learningSpend.distillationsThisWeek,
            learning_reviews_this_week: learningSpend.reviewsThisWeek,
            cost_per_experiment: costPerExperiment,
            cost_per_accepted_improvement: costPerImprovement,
            by_candidate: Object.fromEntries(learningSpend.byCandidate),
          },
          canary_status: canaryLines,
          scheduled_learning: m6Runs,
          compaction: {
            report_only: true,
            recommendations: compaction,
          },
          experiments: [
            ...kernelExperimentRows,
            ...experiments.map((experiment) => ({
              experiment_id: experiment.experiment_id,
              engine: "forked" as const,
              status: experiment.status,
              unit: experiment.unit,
              candidate_ref: experiment.candidate_ref,
              control: experiment.control.fingerprint_ref,
              treatment: experiment.treatment.fingerprint_ref,
              result: experiment.result,
              ...(experiment.result !== null ? { verdict: verdictFor(experiment, evalById) } : {}),
            })),
          ],
          interventions: [
            ...kernelInterventionRows,
            ...interventions.map((intervention) => ({
              intervention_id: intervention.intervention_id,
              engine: "forked" as const,
              destination: intervention.destination,
              status: intervention.status,
              claim: intervention.activation?.claim ?? null,
              ...(intervention.activation !== null ? { claim_display: claimLabel(intervention.activation.claim) } : {}),
              chain_gaps: interventionChainGaps(intervention),
            })),
          ],
          reviews: verdicts.map((verdict) => ({
            candidate_id: verdict.candidate_id,
            verdict: verdict.verdict,
            proposed_destination: verdict.proposed_destination,
            proposed_tier: verdict.proposed_tier,
            reviewed_by: verdict.reviewed_by,
          })),
          ...(activation !== undefined
            ? {
                activation: {
                  pending_review: activation.pendingReview,
                  reviewer_sla_hours: activation.slaHours,
                  reviewer_human_agreement: activation.agreement,
                  rejection_entries: activation.suppressions,
                  concept_loads: Object.fromEntries(conceptLoads),
                },
              }
            : {}),
          ...definedProps({ efficiency_health: efficiencyHealth }),
          ...(storeErrors.length > 0 ? { store_errors: storeErrors } : {}),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const lines: string[] = [];
  lines.push(
    "Learning report (capture + episode + experiment + governed activation + scheduled distillation — every activation human-approved)",
  );
  lines.push("");
  if (projection.mode === "read_only") {
    lines.push(
      `Projection (read-only): ${projection.runsProjected} terminal run(s) await capture, ` +
        `${projection.runsRepaired} receipt(s) await repair, ` +
        `${projection.receiptsNeedingUpgrade} receipt(s) await path rebinding, ` +
        `${projection.runsAlreadyProjected} already captured, ` +
        `${projection.runsPending} pending (not yet terminal)`,
    );
    lines.push(
      projection.refreshRequired
        ? "Run `cormidia learn report --refresh` to update derived capture and episode projections."
        : "Derived capture projection is current; no files were changed.",
    );
  } else {
    lines.push(
      `Projection refreshed: ${projection.runsProjected} run(s) newly captured, ` +
        `${projection.runsAlreadyProjected} already captured, ` +
        `${projection.runsPending} pending (not yet terminal)`,
    );
  }
  if (projection.runsRepaired > 0) {
    lines.push(
      `Capture repair: ${projection.runsRepaired} receipt(s), ` +
        `${projection.eventFilesRecovered} missing event file(s) reconstructed`,
    );
  }
  for (const warning of projection.warnings) lines.push(`Capture warning: ${warning}`);
  lines.push(`Events: ${events.length}`);
  for (const [type, n] of byType) lines.push(`  ${type}: ${n}`);
  lines.push("", `Episodes: ${records.length} (${open.length} open, ${closed.length} closed)`);
  for (const record of records) {
    const outcome =
      record.outcome !== undefined
        ? `; ${record.outcome.completed ? "completed" : "incomplete"}` +
          `; cost ${record.outcome.cost_estimated ? "~" : ""}$${record.outcome.cost_usd.toFixed(2)}`
        : "";
    const lineage =
      record.bundle_lineage !== null && record.bundle_lineage !== undefined
        ? `; lineage ${record.bundle_lineage}${record.bundle_lineage === "mixed" ? " (STICKINESS VIOLATION — turns disagreed)" : ""}`
        : "";
    lines.push(
      `  ${record.episode_id} — ${record.kind} ${record.status}${outcome}${lineage}; ` +
        `${eventsByEpisode.get(record.episode_id) ?? 0} event(s)`,
    );
  }
  // Episodes whose events exist but whose records were never projected
  // (observations against unknown ids) stay visible.
  for (const [episodeId, n] of eventsByEpisode) {
    if (!records.some((record) => record.episode_id === episodeId)) {
      lines.push(`  ${episodeId} — (no projected record); ${n} event(s)`);
    }
  }
  if (gateFailures.length > 0) {
    lines.push("", "Gate failures by class:");
    for (const [errorClass, n] of gateFailures) lines.push(`  ${errorClass}: ${n}`);
  }
  lines.push("", `Human observations: ${humans.length}`);
  for (const event of humans.slice(-5)) {
    lines.push(`  ${event.event_id} → ${event.episode_id}`);
  }
  lines.push("", `Scheduled learning runs: ${m6Runs.length}`);
  for (const run of m6Runs.slice(-10)) {
    lines.push(
      `  ${run.run_id}: ${run.kind} ${run.status}; model turns ${run.model_turns}` +
        (run.reason !== null ? `; ${run.reason}` : ""),
    );
  }
  lines.push("", `Compaction recommendations (report-only): ${compaction.length}`);
  for (const recommendation of compaction) {
    lines.push(
      `  ${recommendation.action}: ${recommendation.concept_ids.join(", ")} — ${recommendation.rationale}` +
        (recommendation.proposed_scope !== undefined ? `; proposed scope ${recommendation.proposed_scope}` : ""),
    );
  }
  if (kernelExperimentRows.length > 0 || experiments.length > 0) {
    lines.push("", `Experiments: ${kernelExperimentRows.length + experiments.length}`);
    for (const experiment of kernelExperimentRows) {
      const cost = learningSpend.byExperiment.get(experiment.experiment_id);
      lines.push(
        `  ${experiment.experiment_id} — kernel, ${experiment.status}` +
          (experiment.verdict !== undefined ? ` → ${experiment.result} (${experiment.verdict})` : "") +
          (cost !== undefined ? `; $${cost.toFixed(2)} this month` : ""),
      );
      lines.push(`    control ${experiment.control.slice(0, 12)} vs treatment ${experiment.treatment.slice(0, 12)}`);
    }
    for (const experiment of experiments) {
      const suffix = experiment.result !== null ? ` → ${experiment.result} (${verdictFor(experiment, evalById)})` : "";
      const cost = learningSpend.byExperiment.get(experiment.experiment_id);
      lines.push(
        `  ${experiment.experiment_id} — forked engine (history), ${experiment.unit}, ${experiment.status}${suffix}` +
          (cost !== undefined ? `; $${cost.toFixed(2)} this month` : ""),
      );
      lines.push(
        `    control ${experiment.control.fingerprint_ref} vs treatment ${experiment.treatment.fingerprint_ref}`,
      );
    }
  }
  if (learningSpend.monthUsd > 0) {
    lines.push("", "Learning spend (this month, from the org ledger):");
    lines.push(
      `  $${learningSpend.monthUsd.toFixed(2)}; ${learningSpend.distillationsThisWeek} distillation(s) and ` +
        `${learningSpend.reviewsThisWeek} learning review(s) in the rolling week; ` +
        `${learningSpend.experimentsThisMonth} experiment(s) this month` +
        (costPerExperiment !== null ? `; cost per experiment $${costPerExperiment.toFixed(2)}` : ""),
    );
    lines.push(
      costPerImprovement !== null
        ? `  cost per accepted improvement: $${costPerImprovement.toFixed(2)} (${improvedThisMonth} improved verdict(s))`
        : "  cost per accepted improvement: n/a — no improved verdict this month",
    );
  }
  if (canaryLines.length > 0) {
    lines.push("", "Canary:");
    for (const line of canaryLines) lines.push(`  ${line}`);
  }
  if (kernelInterventionRows.length > 0 || interventions.length > 0) {
    lines.push("", `Interventions: ${kernelInterventionRows.length + interventions.length}`);
    for (const intervention of kernelInterventionRows) {
      lines.push(
        `  ${intervention.intervention_id} — ${intervention.destination}, ${intervention.status}` +
          (intervention.claim_display !== undefined ? `; claim ${intervention.claim_display}` : "") +
          `; validation ${intervention.state.validation}`,
      );
    }
    for (const intervention of interventions) {
      const gaps = interventionChainGaps(intervention);
      lines.push(
        `  ${intervention.intervention_id} — forked engine (history), ${intervention.destination}, ${intervention.status}` +
          (intervention.activation !== null ? `; claim ${claimLabel(intervention.activation.claim)}` : "") +
          (gaps.length > 0 ? `; chain INCOMPLETE (missing ${gaps.join(", ")})` : ""),
      );
    }
  }
  if (verdicts.length > 0) {
    lines.push("", `Reviews: ${verdicts.length}`);
    for (const verdict of verdicts) lines.push(renderVerdictLine(verdict));
  }
  if (activation !== undefined) {
    lines.push("", "Activation:");
    if (activation.pendingReview.length === 0) {
      lines.push("  review queue empty");
    } else {
      for (const pending of activation.pendingReview) {
        lines.push(
          `  ${pending.candidate_id} awaiting review (${pending.ageHours.toFixed(1)}h)` +
            (pending.overSla
              ? ` — OVER the ${activation.slaHours}h reviewer SLA (policy §13); review fails closed, nothing merges`
              : ""),
        );
      }
    }
    if (conceptLoads.length > 0) {
      lines.push("  concept loads (resolver):");
      for (const [conceptId, n] of conceptLoads) lines.push(`    ${conceptId}: ${n}`);
    }
    if (activation.agreement.compared > 0) {
      lines.push(`  reviewer-human agreement: ${activation.agreement.agreed}/${activation.agreement.compared}`);
    }
    if (activation.suppressions > 0) {
      lines.push(`  rejection ledger entries: ${activation.suppressions}`);
    }
  }
  if (efficiencyHealth !== undefined) {
    lines.push("", "Learning efficiency health:");
    lines.push(
      `  Capture: ${efficiencyHealth.capture.status}; eligible ${efficiencyHealth.capture.eligible_finalized_runs ?? "invalid denominator"}; ` +
        `exactly-once ${efficiencyHealth.capture.projected_exactly_once}; blocked ${efficiencyHealth.capture.blocked_runs.length}`,
    );
    for (const blocked of efficiencyHealth.capture.blocked_runs) {
      lines.push(`    BLOCKED ${blocked.app}/${blocked.runId}: ${blocked.reason}`);
    }
    lines.push(
      `  Governance: ${efficiencyHealth.governance.status}; actionable ${efficiencyHealth.governance.actionable_clusters}; ` +
        `non-actionable ${efficiencyHealth.governance.non_actionable_clusters}; lineage gaps ${efficiencyHealth.governance.lineage_gaps.length}`,
    );
    for (const [kind, n] of Object.entries(efficiencyHealth.governance.candidate_dispositions)) {
      if (n > 0) lines.push(`    ${kind}: ${n}`);
    }
    lines.push(
      `  Efficacy: ${efficiencyHealth.efficacy.status}; experiments ${efficiencyHealth.efficacy.declared_experiments}; ` +
        `valid comparisons ${efficiencyHealth.efficacy.valid_control_treatment_comparisons}; ` +
        `post-activation coverage ${efficiencyHealth.efficacy.comparable_post_activation_coverage}`,
    );
    for (const recommendation of efficiencyHealth.efficacy.recommendations) {
      lines.push(`    ${recommendation.experiment_ref}: ${recommendation.recommendation}`);
    }
  }
  if (storeErrors.length > 0) {
    lines.push("", "STORE ERRORS (records excluded from this report until fixed):");
    for (const message of storeErrors) lines.push(`  ${message}`);
  }
  console.log(lines.join("\n"));
  return 0;
}

/** One spelling for a dangling result ref in both report modes. */
function verdictFor(experiment: ExperimentRecord, evalById: Map<string, EvalResult>): string {
  return experiment.result !== null
    ? (evalById.get(experiment.result)?.verdict ?? "verdict unknown")
    : "verdict unknown";
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function positional(args: string[], command: string, what: string): string {
  const value = args.find((arg) => !arg.startsWith("--"));
  if (value === undefined) throw new Error(`${command}: ${what} is required`);
  return value;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`learn: ${flag} requires a value`);
  return value;
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function count(values: string[]): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function compactPayload(payload: Record<string, unknown> | undefined): string {
  if (payload === undefined) return "(no detail)";
  return Object.entries(payload)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

function orUndefined(value: string): string | undefined {
  return value === "" ? undefined : value;
}

function asOptionalString(spec: Record<string, unknown>, key: string): string | undefined {
  const value = spec[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
