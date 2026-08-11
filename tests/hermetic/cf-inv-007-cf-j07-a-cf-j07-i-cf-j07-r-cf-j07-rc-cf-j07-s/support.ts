// hermetic/cf-j07/support.ts — shared rig + detectors for the CF-J07 family
// (HB-022 + HB-P1; case-catalog §CF-J07-*; CORMIDIA-INV-007; F-PT-003 ratified
// 2026-07-31: pause holds; exactly one budget-exceeded item eventually).
//
// NOTE on the product seam this family drives (report obligation, HB-022):
// `enforceBudgetOverlay(orgHome, …)` in src/org/budget.ts names its first
// parameter `orgHome`, but every production caller passes the STATE home
// (src/org/dispatch.ts:156 `runtimeHome`, src/cli/loop.ts:340
// `homes.stateHome`, src/cli/budget.ts:44 `homes.stateHome`) — the ledger,
// overlay, and approval store all live under the state home. The same
// misnomer runs through `rollupBudgets`, `isOverlayPaused`,
// `rollupLearningSpend`, and `countUnmeasured`. These suites pass the state
// home (the actual contract) and never copy the misnomer into their own
// names. Reported upward in the ticket's defects list; renaming src is not
// authorized here.

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { ApprovalStore, type ApprovalItem } from "../../../src/org/approvals.js";
import { loadApps, type AppsFile } from "../../../src/org/apps.js";
import { dispatchTick, type DispatchSpawn, type DispatchTickResult } from "../../../src/org/dispatch.js";
import type { GitHubEventSource } from "../../../src/org/events.js";
import { recordTurn, type TurnRecord } from "../../../src/runtime/telemetry.js";
import type { TurnResult } from "../../../src/runtime/types.js";
import type { ScriptedTurnObservation } from "../../fixtures/adapters/scenario.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

export const APP = "budget-app";
export const ROLE = "sre";
export const TRIGGER = "hourly";
/** One fixed instant for the whole family — mid-month, mid-day UTC. */
export const FIXED_NOW = "2026-07-31T12:00:00.000Z";
export const MONTH = "2026-07";

/** The exact idempotency key src/org/budget.ts derives for the documented
 *  100%-pause approval item. If this format drifts from the product's, the
 *  convergence detector below goes red loudly (a recovery raise would mint a
 *  second item), so the coupling is self-checking. */
export function budgetItemKey(app: string, month: string = MONTH): string {
  return `budget-exceeded:${app}:${month}`;
}

export interface BudgetAppSpec {
  name?: string;
  budgetUsd?: number;
  status?: "live" | "paused" | "onboarding";
}

/** This org's own instance config (never the repo's ratified templates):
 *  live app(s) with an explicit monthly budget, and one scheduled role so the
 *  tick always has genuinely due work to refuse or admit. */
export function budgetAppsYaml(apps: BudgetAppSpec[] = [{}]): string {
  const blocks = apps.map((spec) =>
    [
      `  ${spec.name ?? APP}:`,
      `    repo: fixture/${spec.name ?? APP}`,
      `    status: ${spec.status ?? "live"}`,
      `    budget_usd_month: ${spec.budgetUsd ?? 100}`,
      "    cadence: {}",
      "    release:",
      "      kind: deploy",
      "      owner: sre",
      "      trigger: command",
      "      command: ./deploy.sh",
    ].join("\n"),
  );
  return [
    "schema_version: 1",
    "org:",
    "  name: budget-org",
    "  max_concurrent_turns: 2",
    "defaults:",
    "  budget_usd_month: 1000",
    "apps:",
    ...blocks,
    "",
  ].join("\n");
}

export const BUDGET_ROLES_YAML = [
  "defaults:",
  "  max_turn_budget_usd: 5",
  "roles:",
  "  planner:",
  "    runtime: claude",
  "    model: claude-scripted-model",
  "    effort: medium",
  "    delegation: {allow: []}",
  "    triggers: []",
  "    outputs: [tickets]",
  "  builder:",
  "    runtime: codex",
  "    model: codex-scripted-model",
  "    effort: medium",
  "    delegation: {allow: []}",
  "    triggers: []",
  "    outputs: [pr]",
  "  reviewer:",
  "    runtime: claude",
  "    model: claude-scripted-model",
  "    effort: medium",
  "    delegation: {allow: []}",
  "    triggers: []",
  "    outputs: [review]",
  "  support:",
  "    runtime: claude",
  "    model: claude-scripted-model",
  "    effort: medium",
  "    delegation: {allow: []}",
  "    triggers: []",
  "    outputs: [notes]",
  "  marketing:",
  "    runtime: claude",
  "    model: claude-scripted-model",
  "    effort: medium",
  "    delegation: {allow: []}",
  "    triggers: []",
  "    outputs: [notes]",
  "  distiller:",
  "    runtime: claude",
  "    model: claude-scripted-model",
  "    effort: medium",
  "    delegation: {allow: []}",
  "    triggers: []",
  "    outputs: [notes]",
  "  learning-reviewer:",
  "    runtime: claude",
  "    model: claude-scripted-model",
  "    effort: medium",
  "    delegation: {allow: []}",
  "    triggers: []",
  "    outputs: [review]",
  `  ${ROLE}:`,
  "    runtime: claude",
  "    model: claude-scripted-model",
  "    effort: medium",
  "    delegation: {allow: []}",
  "    triggers:",
  `      - schedule: "${TRIGGER}"`,
  "    outputs: [notes]",
  "",
].join("\n");

/** Hermetic event source: no GitHub, nothing due. */
export const NO_EVENTS: GitHubEventSource = {
  ticketReady: async () => [],
  prOpened: async () => [],
  ciFailed: async () => [],
  releaseShipped: async () => [],
};

/** Event source that records which apps were polled — a paused app must not
 *  even be polled for claimable work. */
export function recordingEventSource(): { source: GitHubEventSource; polledApps: string[] } {
  const polledApps: string[] = [];
  const source: GitHubEventSource = {
    ticketReady: async (app) => {
      polledApps.push(app.name);
      return [];
    },
    prOpened: async () => [],
    ciFailed: async () => [],
    releaseShipped: async () => [],
  };
  return { source, polledApps };
}

export interface BudgetOrg {
  org: TempOrgHome;
  appsFile: AppsFile;
}

export async function makeBudgetOrg(apps: BudgetAppSpec[] = [{}]): Promise<BudgetOrg> {
  const org = await makeTempOrgHome({ name: "budget-org" });
  await writeFile(join(org.orgHome, "apps.yaml"), budgetAppsYaml(apps), "utf8");
  await writeFile(join(org.orgHome, "roles.yaml"), BUDGET_ROLES_YAML, "utf8");
  const appsFile = await loadApps(join(org.orgHome, "apps.yaml"));
  return { org, appsFile };
}

/** Settle one well-formed spend row into the REAL ledger location via the
 *  product writer (src/runtime/telemetry.ts recordTurn). The exactly-once
 *  machinery is INV-006's family; this helper only plants month-to-date spend
 *  facts for admission tests. */
export async function seedSpend(
  stateHome: string,
  input: { app?: string; costUsd: number; at?: string; providerTurnId?: string },
): Promise<TurnRecord> {
  const record: TurnRecord = {
    at: input.at ?? FIXED_NOW,
    role: ROLE,
    runtime: "claude",
    model: "claude-scripted-model",
    status: "completed",
    tokensIn: 1000,
    tokensOut: 100,
    costUsd: input.costUsd,
    usageQuality: "complete",
    subagentTurns: 0,
    wallClockMs: 900,
    escalations: 0,
    app: input.app ?? APP,
    runId: `seed-${Math.random().toString(36).slice(2, 10)}`,
    ...(input.providerTurnId !== undefined ? { providerTurnId: input.providerTurnId } : {}),
  };
  await recordTurn(stateHome, record);
  return record;
}

/** Plant a parseable-but-malformed ledger row (the A-004 seed: a costUsd that
 *  is not a finite number). Raw append on purpose — the product writer would
 *  not produce it; the reader must fail CLOSED on it. */
export async function seedMalformedSpendRow(stateHome: string, app: string, at: string = FIXED_NOW): Promise<void> {
  const day = at.slice(0, 10);
  const path = join(stateHome, "telemetry", `${day}.jsonl`);
  await mkdir(dirname(path), { recursive: true });
  const row = { at, role: ROLE, status: "completed", costUsd: "NaN-ish", app };
  await appendFile(path, `${JSON.stringify(row)}\n`, "utf8");
}

export async function readOverlayFile(stateHome: string): Promise<{ pausedApps: string[] } | undefined> {
  const path = join(stateHome, "state", "budget-overlay.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8")) as { pausedApps: string[] };
}

/** All budget-exceeded items (pending + decided) carrying the app's
 *  month-keyed justification. */
export async function budgetItemsFor(
  stateHome: string,
  app: string = APP,
  month: string = MONTH,
): Promise<{ pending: ApprovalItem[]; decided: ApprovalItem[] }> {
  const store = new ApprovalStore(stateHome);
  const key = budgetItemKey(app, month);
  const match = (item: ApprovalItem) =>
    item.rule === "budget-exceeded" && item.app === app && item.justification === key;
  return {
    pending: (await store.listPending()).filter(match),
    decided: (await store.listDecided()).filter(match),
  };
}

// ---------------------------------------------------------------------------
// Detectors (each proven to FIRE by a "negative control: …" test)
// ---------------------------------------------------------------------------

/** F-PT-003 convergence detector: after recovery, the month owns EXACTLY ONE
 *  budget-exceeded item for the app — never zero (silent pause with no human
 *  surface), never several (a catch-up storm of duplicate decisions). */
export class BudgetItemConvergenceViolation extends Error {
  constructor(app: string, month: string, count: number, ids: readonly string[]) {
    super(
      `F-PT-003 violated: ${app} ${month} holds ${count} budget-exceeded item(s) ` +
        `(expected exactly one): [${ids.join(", ")}]`,
    );
    this.name = "BudgetItemConvergenceViolation";
  }
}

export async function assertExactlyOneBudgetItem(
  stateHome: string,
  app: string = APP,
  month: string = MONTH,
): Promise<ApprovalItem> {
  const { pending, decided } = await budgetItemsFor(stateHome, app, month);
  const all = [...pending, ...decided];
  if (all.length !== 1) {
    throw new BudgetItemConvergenceViolation(
      app,
      month,
      all.length,
      all.map((item) => item.id),
    );
  }
  return all[0]!;
}

/** Core §5 detector: a turn whose provider-reported cost crossed the per-turn
 *  cap must surface the stop — either the typed error_max_budget_usd result or
 *  the incident-note artifact. Crossing the cap silently (a "successful" turn
 *  that just spent more) is the seeded violation this detector exists for
 *  ("overrun = incident note, not silent spend", roles.yaml). */
export class SilentOverspendViolation extends Error {
  constructor(costUsd: number, capUsd: number) {
    super(
      `C-CORE §5 violated: provider turn spent $${costUsd} against a $${capUsd} per-turn cap ` +
        `with no typed budget stop and no incident note — silent overspend`,
    );
    this.name = "SilentOverspendViolation";
  }
}

export function assertOverrunSurfaced(result: TurnResult, capUsd: number): void {
  if (result.usage.costUsd <= capUsd) return;
  const typedStop = result.errorCode === "error_max_budget_usd";
  const incidentNote = result.artifacts.some(
    (artifact) => artifact.kind === "note" && artifact.ref.startsWith("budget-overrun/"),
  );
  if (!typedStop && !incidentNote) {
    throw new SilentOverspendViolation(result.usage.costUsd, capUsd);
  }
}

/** INV-006/core §5 detector: on a cap-crossed turn the envelope must retain
 *  the provider-reported overshoot — an adapter that clamps the recorded cost
 *  to the cap under-settles real spend. Ground truth is the scripted
 *  scenario's own terminal cost. */
export class OvershootClampViolation extends Error {
  constructor(reported: number, enveloped: number) {
    super(
      `INV-006 violated: provider reported $${reported} for the cap-crossed turn but the ` +
        `envelope carries $${enveloped} — overshoot must be retained and settled, never clamped`,
    );
    this.name = "OvershootClampViolation";
  }
}

export function assertOvershootRetained(observation: ScriptedTurnObservation, result: TurnResult): void {
  const outcome = observation.scenario.outcome;
  if (outcome.kind !== "success" && outcome.kind !== "failure") return;
  if (result.usage.costUsd !== outcome.costUsd) {
    throw new OvershootClampViolation(outcome.costUsd, result.usage.costUsd);
  }
}

/** Refusal detector: a paused app must never appear among a tick's spawned
 *  turns. Takes the tick RESULT so the negative control can seed a forged
 *  spawn and prove the detector is not vacuous. */
export class PausedAppSpawnViolation extends Error {
  constructor(app: string, turnIds: readonly string[]) {
    super(`INV-007 violated: paused app ${app} claimed spend — spawned turn(s) [${turnIds.join(", ")}]`);
    this.name = "PausedAppSpawnViolation";
  }
}

export function assertNoSpawnsForApp(tick: DispatchTickResult, app: string): void {
  const offending = tick.spawned.filter((turn) => turn.app === app);
  if (offending.length > 0) {
    throw new PausedAppSpawnViolation(
      app,
      offending.map((turn) => turn.turnId),
    );
  }
}

// ---------------------------------------------------------------------------
// Tick runner
// ---------------------------------------------------------------------------

export interface TickRun {
  tick: DispatchTickResult;
  spawned: Array<{ role: string; app: string; turnId: string; runtimeHome: string }>;
}

export async function runTick(
  org: TempOrgHome,
  now: () => Date,
  eventSource: GitHubEventSource = NO_EVENTS,
): Promise<TickRun> {
  const spawned: TickRun["spawned"] = [];
  const spawn: DispatchSpawn = async (input) => {
    spawned.push(input);
  };
  const tick = await dispatchTick({
    orgRoot: org.orgHome,
    runtimeHome: org.stateHome,
    now,
    eventSource,
    spawn,
  });
  return { tick, spawned };
}
