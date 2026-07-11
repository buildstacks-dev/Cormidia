// `operon learn` — the episode-linked human review workflow
// (learning-loop M1 capture + M2 episode substrate; docs/learning-loop/
// design §10.1, spec §16).
//
// M2 surface: inspect renders the full projected EpisodeRecord (turns,
// gates, outcome, approvals, artifacts, late outcomes) plus the replay
// capsule's replayability for closed build episodes; emit records a human
// observation (three-field contract kept separate) or an append-only late
// outcome; show traces one event id to its disposition; report adds an
// episodes section over the capture totals. Every read subcommand refreshes
// the capture AND episode projections first, so output reflects the current
// run records. Distillation, candidates, and activation land in later
// milestones — the only writes here are human_correction / late_outcome
// events and the projections' own idempotent state.

import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveAppWorkdir } from "../org/app-workdir.js";
import { resolveOperonHomes, type OperonHomes } from "../org/home.js";
import { createCapsuleBuilder, type ReplayCapsule } from "../org/learning/capsule.js";
import { projectCaptureEvents, type CaptureProjectionResult } from "../org/learning/capture.js";
import {
  createEpisodeProjector,
  readEpisodeRecords,
  type EpisodeProjector,
  type EpisodeRecord,
} from "../org/learning/episode.js";
import {
  createLearningEventSink,
  learningEventPath,
  readLearningEvents,
  type LearningEvent,
} from "../org/learning/events.js";
import {
  computeSystemFingerprint,
  storeFingerprint,
} from "../org/learning/fingerprint.js";
import { loadRoles } from "../org/roles.js";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdLearn(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "learn");
  const [sub, ...rest] = common.rest;
  const homes = await resolveOperonHomes(common);
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
      await projectCaptureEvents({ stateHome, appStages });
      await projector.project();
      return show(stateHome, id);
    }
    case "report": {
      const json = rest.includes("--json");
      const projection = await projectCaptureEvents({ stateHome, appStages });
      await projector.project();
      return report(stateHome, projection, json);
    }
    default:
      throw new Error(
        'learn: expected a subcommand — inspect <episode-id> | emit [--episode <id>] | show <event-id> | report [--json]',
      );
  }
}

// ---------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------

async function inspect(
  homes: OperonHomes,
  episodeId: string,
  projection: CaptureProjectionResult,
): Promise<number> {
  const stateHome = homes.stateHome;
  const events = (await readLearningEvents(stateHome)).filter(
    (event) => event.episode_id === episodeId,
  );
  const record = (await readEpisodeRecords(stateHome)).find(
    (candidate) => candidate.episode_id === episodeId,
  );
  if (record === undefined && events.length === 0) {
    console.error(
      `learn: no captured events for ${episodeId}` +
        (projection.runsPending > 0
          ? ` (${projection.runsPending} run(s) still pending capture — not yet terminal)`
          : "") +
        "\nList known episodes with: operon learn report",
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
    lines.push(
      `Opened: ${record.opened}` + (record.closed !== undefined ? `   Closed: ${record.closed}` : ""),
    );

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
          `  [${gate.status}] ${gate.gate} (${gate.run_id})` +
            (gate.detail !== undefined ? ` — ${gate.detail}` : ""),
        );
      }
    }
  } else {
    lines.push(`Episode ${episodeId}`);
    lines.push(
      `App: ${events[0]?.app}   Events: ${events.length}` +
        "   (no projected record — its runs may be pruned or it never had any)",
    );
  }

  // Pass verdicts live only in capture events (spec §4) — render from there.
  const verdicts = events.filter((event) => event.type === "pass_verdict");
  if (verdicts.length > 0) {
    lines.push("", "Pass verdicts:");
    for (const verdict of verdicts) {
      lines.push(
        `  ${verdict.pipeline}/${verdict.pass}: ${compactPayload(verdict.payload)} (${verdict.run_id})`,
      );
    }
  }

  if (record?.outcome !== undefined) {
    const outcome = record.outcome;
    lines.push("", "Outcome:");
    lines.push(
      `  completed ${outcome.completed ? "yes" : "no"}` +
        (outcome.merged !== undefined ? `; merged ${outcome.merged ? "yes" : "no"}` : "") +
        (outcome.release_disposition !== null
          ? `; release disposition ${outcome.release_disposition}`
          : ""),
    );
    lines.push(
      `  review cycles ${outcome.review_cycles}; gate failures ${outcome.gate_failures}; ` +
        `human interventions ${outcome.human_interventions}`,
    );
    lines.push(
      `  cost ${outcome.cost_estimated ? "~" : ""}$${outcome.cost_usd.toFixed(2)} (org ledger)` +
        (outcome.unsettled_runs.length > 0
          ? `; UNSETTLED runs: ${outcome.unsettled_runs.join(", ")} — run operon budget --reconcile`
          : ""),
    );
  }

  if (record !== undefined && record.approvals.length > 0) {
    lines.push("", `Approvals: ${record.approvals.join(", ")}`);
  }
  if (record !== undefined && record.artifacts.length > 0) {
    lines.push("", `Artifacts: ${record.artifacts.join(", ")}`);
    for (const effect of record.side_effects) {
      lines.push(
        `  ${effect.kind} ${effect.ref} (${effect.reversible ? "reversible" : "irreversible"})`,
      );
    }
  }

  if (record !== undefined && record.kind === "build_ticket" && record.status === "closed") {
    lines.push("", ...(await capsuleLines(homes, record)));
  }

  if (record !== undefined && record.late_outcomes.length > 0) {
    lines.push("", "Late outcomes:");
    for (const late of record.late_outcomes) {
      lines.push(
        `  ${late.kind} ${late.ref} (recorded ${late.recorded})` +
          (late.note !== undefined ? ` — ${late.note}` : ""),
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

/** Replay-capsule section for a closed build episode: assembled best-effort
 *  (a broken roles.yaml or missing checkout degrades the fingerprint, never
 *  the inspect), always naming what is missing for trusted replay. */
async function capsuleLines(homes: OperonHomes, record: EpisodeRecord): Promise<string[]> {
  let fingerprintRef: string | undefined;
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
        ...(workdir !== undefined ? { workdir } : {}),
        ...(appEntry !== undefined ? { budgetUsdMonth: appEntry.budgetUsdMonth } : {}),
      },
      roles: Object.fromEntries(rolesFile.roles.map((role) => [role.name, role])),
    });
    fingerprintRef = await storeFingerprint(homes.stateHome, fingerprint);
  } catch {
    // Fingerprint is best-effort here; the capsule lists it as missing.
  }

  let capsule: ReplayCapsule;
  try {
    capsule = await createCapsuleBuilder({
      stateHome: homes.stateHome,
      repoByApp: Object.fromEntries(homes.appsFile.apps.map((app) => [app.name, app.repo])),
      ...(fingerprintRef !== undefined ? { fingerprintRef } : {}),
    }).assemble(record.episode_id);
  } catch (error) {
    return [`Replay capsule: not assembled — ${(error as Error).message}`];
  }
  return [
    `Replay capsule: ${capsule.capsule_id} — ${capsule.replayability}`,
    ...(capsule.missing.length > 0
      ? [`  missing for trusted replay: ${capsule.missing.join(", ")}`]
      : []),
    ...(capsule.seed.commit !== null ? [`  seed: ${capsule.seed.repo}@${capsule.seed.commit}`] : []),
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

  // Late outcomes are the record's one append-only lane (design §8.3):
  // routed through the projector so they fold into the EpisodeRecord.
  if (parsed.lateOutcome !== undefined) {
    if (parsed.episode === undefined || parsed.ref === undefined) {
      throw new Error(
        "learn emit: --late-outcome <kind> requires --episode <id> and --ref <ref>",
      );
    }
    await projectCaptureEvents({ stateHome, appStages });
    await projector.project();
    const event = await projector.recordLateOutcome(parsed.episode, {
      kind: parsed.lateOutcome,
      ref: parsed.ref,
      ...(parsed.note !== undefined ? { note: parsed.note } : {}),
    });
    console.log(`recorded late outcome ${event.event_id} against ${event.episode_id}`);
    console.log(`  it folds into the episode record on the next projection`);
    console.log(`  trace it with: operon learn show ${event.event_id}`);
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
        parsed.intervention ??= orUndefined(
          (await rl.question("Suggested intervention (optional): ")).trim(),
        );
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
      ...(parsed.cause !== undefined ? { cause_hypothesis_text: parsed.cause } : {}),
      ...(parsed.intervention !== undefined
        ? { suggested_intervention: parsed.intervention }
        : {}),
      ...(parsed.artifacts.length > 0 ? { artifacts: parsed.artifacts } : {}),
    },
  };
  await createLearningEventSink(stateHome).emit(event);
  console.log(`recorded ${event.event_id} against ${event.episode_id}`);
  console.log(`  ${learningEventPath(stateHome, event)}`);
  console.log(`  trace it with: operon learn show ${event.event_id}`);
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

async function show(stateHome: string, id: string): Promise<number> {
  const events = await readLearningEvents(stateHome);
  const match = events.find((event) => event.event_id === id);
  if (match === undefined) {
    console.error(
      `learn: no captured event with id ${id}` +
        (id.startsWith("cand_") || id.startsWith("int_")
          ? " — candidates and interventions do not exist until later milestones"
          : ""),
    );
    return 1;
  }
  console.log(JSON.stringify(match, null, 2));
  console.log("");
  console.log(`stored at: ${learningEventPath(stateHome, match)}`);
  console.log(
    match.type === "late_outcome"
      ? `disposition: folded into ${match.episode_id}'s record (late_outcomes) — inspect it with: operon learn inspect ${match.episode_id}`
      : "disposition: captured (M1) — no downstream consumer yet; classification and distillation land in M6",
  );
  return 0;
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

async function report(
  stateHome: string,
  projection: CaptureProjectionResult,
  json: boolean,
): Promise<number> {
  const events = await readLearningEvents(stateHome);
  const records = await readEpisodeRecords(stateHome);
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

  if (json) {
    console.log(
      JSON.stringify(
        {
          capture: projection,
          totals: { events: events.length, by_type: byType, by_app: byApp },
          episodes: records.map((record) => ({
            episode_id: record.episode_id,
            kind: record.kind,
            status: record.status,
            events: eventsByEpisode.get(record.episode_id) ?? 0,
            ...(record.outcome !== undefined
              ? {
                  completed: record.outcome.completed,
                  cost_usd: record.outcome.cost_usd,
                  release_disposition: record.outcome.release_disposition,
                }
              : {}),
          })),
          gate_failures: gateFailures,
          human_observations: humans.map((event) => event.event_id),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const lines: string[] = [];
  lines.push("Learning report (capture + episode substrate — nothing activates yet)");
  lines.push("");
  lines.push(
    `Projection: ${projection.runsProjected} run(s) newly captured, ` +
      `${projection.runsAlreadyProjected} already captured, ${projection.runsPending} pending (not yet terminal)`,
  );
  lines.push(`Events: ${events.length}`);
  for (const [type, n] of byType) lines.push(`  ${type}: ${n}`);
  lines.push("", `Episodes: ${records.length} (${open.length} open, ${closed.length} closed)`);
  for (const record of records) {
    const outcome =
      record.outcome !== undefined
        ? `; ${record.outcome.completed ? "completed" : "incomplete"}` +
          `; cost ${record.outcome.cost_estimated ? "~" : ""}$${record.outcome.cost_usd.toFixed(2)}`
        : "";
    lines.push(
      `  ${record.episode_id} — ${record.kind} ${record.status}${outcome}; ` +
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
  console.log(lines.join("\n"));
  return 0;
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
  if (!value || value.startsWith("--")) throw new Error(`learn emit: ${flag} requires a value`);
  return value;
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
