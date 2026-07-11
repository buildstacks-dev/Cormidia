// `operon learn` — the episode-linked human review workflow, capture-only
// (learning-loop M1; docs/learning-loop/ design §10.1, spec §16).
//
// M1 surface: inspect (what capture knows about an episode), emit (a human
// observation with the three-field contract kept separate), show (trace one
// event id to its disposition), report (read-only capture totals). Every
// read subcommand refreshes the capture projection first, so output reflects
// the current run records. Distillation, candidates, and activation land in
// later milestones — this command never writes anything but human_correction
// events.

import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { readFile } from "node:fs/promises";
import { resolveOperonHomes } from "../org/home.js";
import { projectCaptureEvents, type CaptureProjectionResult } from "../org/learning/capture.js";
import {
  createLearningEventSink,
  learningEventPath,
  readLearningEvents,
  type LearningEvent,
} from "../org/learning/events.js";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdLearn(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "learn");
  const [sub, ...rest] = common.rest;
  const homes = await resolveOperonHomes(common);
  const stateHome = homes.stateHome;
  const appStages = Object.fromEntries(homes.appsFile.apps.map((app) => [app.name, app.status]));
  const appNames = homes.appsFile.apps.map((app) => app.name);

  switch (sub) {
    case "inspect": {
      const episodeId = positional(rest, "learn inspect", "<episode-id>");
      const projection = await projectCaptureEvents({ stateHome, appStages });
      return inspect(stateHome, episodeId, projection);
    }
    case "emit":
      return emit(stateHome, rest, appNames, appStages);
    case "show": {
      const id = positional(rest, "learn show", "<event-id>");
      await projectCaptureEvents({ stateHome, appStages });
      return show(stateHome, id);
    }
    case "report": {
      const json = rest.includes("--json");
      const projection = await projectCaptureEvents({ stateHome, appStages });
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
  stateHome: string,
  episodeId: string,
  projection: CaptureProjectionResult,
): Promise<number> {
  const events = (await readLearningEvents(stateHome)).filter(
    (event) => event.episode_id === episodeId,
  );
  if (events.length === 0) {
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
  const timestamps = events.map((event) => event.ts).sort();
  lines.push(`Episode ${episodeId}`);
  lines.push(`App: ${events[0]?.app}   Events: ${events.length}   ${timestamps[0]} … ${timestamps[timestamps.length - 1]}`);
  lines.push("(capture-only view — full episode record with costs and release disposition lands in M2)");

  // Human observations carry no turn — they render in their own section.
  const turns = new Map<string, LearningEvent[]>();
  for (const event of events) {
    if (event.turn_id === undefined) continue;
    turns.set(event.turn_id, [...(turns.get(event.turn_id) ?? []), event]);
  }
  lines.push("", "Turns:");
  for (const [turnId, turnEvents] of [...turns.entries()].sort()) {
    const roles = uniq(turnEvents.map((event) => event.agent_role ?? "?"));
    const passes = uniq(
      turnEvents.map((event) => `${event.pipeline ?? "?"}/${event.pass ?? "?"}`),
    );
    const runs = uniq(turnEvents.map((event) => event.run_id ?? "?"));
    lines.push(`  ${turnId} — role ${roles.join(", ")}; passes ${passes.join(", ")}; runs ${runs.join(", ")}`);
  }

  const gates = events.filter((event) => event.type === "gate_verdict");
  if (gates.length > 0) {
    lines.push("", "Gate outcomes:");
    for (const gate of gates) {
      const detail = typeof gate.payload?.["detail"] === "string" ? ` — ${gate.payload["detail"]}` : "";
      lines.push(`  [${gate.payload?.["status"]}] ${gate.payload?.["gate"]} (${gate.run_id})${detail}`);
    }
  }

  const verdicts = events.filter((event) => event.type === "pass_verdict");
  if (verdicts.length > 0) {
    lines.push("", "Pass verdicts:");
    for (const verdict of verdicts) {
      lines.push(`  ${verdict.pipeline}/${verdict.pass}: ${compactPayload(verdict.payload)} (${verdict.run_id})`);
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
}

async function emit(
  stateHome: string,
  args: string[],
  appNames: string[],
  appStages: Record<string, string>,
): Promise<number> {
  const parsed = parseEmitArgs(args);

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
    "disposition: captured (M1) — no downstream consumer yet; classification and distillation land in M6",
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
  const byType = count(events.map((event) => event.type));
  const byApp = count(events.map((event) => event.app));
  const byEpisode = count(events.map((event) => event.episode_id));
  const gateFailures = count(
    events
      .filter((event) => event.type === "gate_verdict" && event.payload?.["status"] === "fail")
      .map((event) => event.error_class ?? "unknown"),
  );
  const humans = events.filter((event) => event.type === "human_correction");

  if (json) {
    console.log(
      JSON.stringify(
        {
          capture: projection,
          totals: { events: events.length, by_type: byType, by_app: byApp },
          episodes: byEpisode,
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
  lines.push("Learning capture report (M1 — capture-only; nothing activates)");
  lines.push("");
  lines.push(
    `Projection: ${projection.runsProjected} run(s) newly captured, ` +
      `${projection.runsAlreadyProjected} already captured, ${projection.runsPending} pending (not yet terminal)`,
  );
  lines.push(`Events: ${events.length}`);
  for (const [type, n] of byType) lines.push(`  ${type}: ${n}`);
  lines.push("", "Episodes:");
  for (const [episode, n] of byEpisode) lines.push(`  ${episode} — ${n} event(s)`);
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
