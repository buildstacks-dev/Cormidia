// hermetic/cf-c-b08-cf-j09-*/support.ts — shared scheduler-admission world +
// detectors for HB-142 (CF-J09-S, CF-J09-R, CF-J09-I, CF-J09-A, CF-C-B08).
//
// Spec sources: contracts/B-08-tick-turn.md (closed 20-member vocabulary per
// F-PT-034, owner ruling 2026-08-12), docs/scheduler/design.md → "Outcomes and
// reason codes" (the canonical table), contracts/journey-acceptance.md J-09.
//
// Existing evidence deliberately NOT re-owed here: cf-j09-rc (double-fire
// race, HB-021), tests/hermetic/cf-inv-014/ (HB-149 admission/bookkeeping
// evidence legs), tests/hermetic/cf-reg-231/ + tests/unit/cf-sched-claim/
// (due-window settlement identity), tests/hermetic/cf-reg-228/ (paid-turn
// eligibility), tests/hermetic/cf-reg-209/ (health classification).

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { dispatchTick, type DispatchSpawn, type DispatchTickResult, type DueTurn } from "../../../src/org/dispatch.js";
import { inboxEventKey, type GitHubEventSource } from "../../../src/org/events.js";
import { SchedulerEvidenceStore, type SchedulerDecisionRecord } from "../../../src/org/scheduler/evidence.js";
import { ScheduleDueClaimStore } from "../../../src/org/scheduler/due-window-claims.js";
import { schedulerIdentity, schedulerOrgId, type SchedulerReasonCode } from "../../../src/org/scheduler/model.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

/** One fixed instant for the whole family: mid-month, mid-day UTC. */
export const FIXED_NOW = new Date("2026-08-12T16:00:00.000Z");

/** The CLOSED execution/admission vocabulary (F-PT-034, owner ruling
 * 2026-08-12): exactly the Execution/admission row of docs/scheduler/design.md
 * → "Outcomes and reason codes", restated in contracts/B-08-tick-turn.md §2.
 * `satisfies` pins every member to the product type: dropping a member from
 * `SchedulerReasonCode` breaks this file at compile time. */
export const B08_CLOSED_VOCABULARY = [
  "executed",
  "no_due_work",
  "no_actionable_input",
  "not_due",
  "already_claimed",
  "already_settled",
  "explicit_retry",
  "retry_exhausted",
  "fresh_lock",
  "wip_limit",
  "budget_paused",
  "approval_blocked",
  "channel_gated",
  "no_subscriber",
  "empty_learning_window",
  "missed_window_reconciled",
  "spawn_failure",
  "post_spawn_bookkeeping_failure",
  "scheduler_definition_failure",
  "scheduler_state_failure",
] as const satisfies readonly SchedulerReasonCode[];

export type WorldTrigger = { schedule: string } | { event: string } | { manual: true };

export interface WorldRoleSpec {
  name: string;
  triggers: readonly WorldTrigger[];
}

export interface WorldAppSpec {
  name: string;
  budgetUsdMonth?: number;
  /** Declared support/marketing channels (omitted ⇒ channel-gated audience roles). */
  channels?: { support?: readonly string[]; marketing?: readonly string[] };
  /** Declare a deploy surface so a scheduled SRE window is actionable (#228). */
  release?: boolean;
  /** Per-role cadence override — REPLACES the role's own triggers (architecture §7). */
  cadence?: Readonly<Record<string, readonly WorldTrigger[]>>;
}

export interface WorldSpec {
  name?: string;
  maxConcurrentTurns?: number;
  apps: readonly WorldAppSpec[];
  roles: readonly WorldRoleSpec[];
}

export const ORG_NAME = "b08-org";

function renderTrigger(trigger: WorldTrigger, indent: string): string {
  if ("schedule" in trigger) return `${indent}- schedule: "${trigger.schedule}"`;
  if ("event" in trigger) return `${indent}- event: ${trigger.event}`;
  return `${indent}- manual: true`;
}

function renderApp(app: WorldAppSpec): string[] {
  const lines = [
    `  ${app.name}:`,
    `    repo: fixture/${app.name}`,
    "    status: live",
    ...(app.budgetUsdMonth === undefined ? [] : [`    budget_usd_month: ${app.budgetUsdMonth}`]),
  ];
  if (app.cadence === undefined || Object.keys(app.cadence).length === 0) {
    lines.push("    cadence: {}");
  } else {
    lines.push("    cadence:");
    for (const [role, triggers] of Object.entries(app.cadence)) {
      if (triggers.length === 0) {
        lines.push(`      ${role}: []`);
      } else {
        lines.push(`      ${role}:`);
        for (const trigger of triggers) lines.push(renderTrigger(trigger, "        "));
      }
    }
  }
  if (app.channels !== undefined) {
    lines.push("    channels:");
    if (app.channels.support !== undefined) lines.push(`      support: [${app.channels.support.join(", ")}]`);
    if (app.channels.marketing !== undefined) lines.push(`      marketing: [${app.channels.marketing.join(", ")}]`);
  }
  if (app.release !== false) {
    lines.push(
      "    release:",
      "      kind: deploy",
      "      owner: sre",
      "      trigger: command",
      "      command: ./deploy.sh",
    );
  }
  return lines;
}

function renderRole(role: WorldRoleSpec): string[] {
  const lines = [
    `  ${role.name}:`,
    "    runtime: claude",
    "    model: claude-scripted-model",
    "    effort: medium",
    "    delegation: {allow: []}",
  ];
  if (role.triggers.length === 0) {
    lines.push("    triggers: []");
  } else {
    lines.push("    triggers:");
    for (const trigger of role.triggers) lines.push(renderTrigger(trigger, "      "));
  }
  lines.push("    outputs: [notes]");
  return lines;
}

export interface SchedulerWorld {
  home: TempOrgHome;
  orgId: string;
  evidence: SchedulerEvidenceStore;
  dueClaims: ScheduleDueClaimStore;
  /** Every spawn the injected default spawner observed, in order. */
  spawns: Array<{ app: string; role: string; turnId: string }>;
  tick(options?: WorldTickOptions): Promise<DispatchTickResult>;
  seedInboxEvent(input: { kind: string; id: string; app: string; channel?: string }): Promise<string>;
  corruptScheduleState(bytes?: string): Promise<void>;
  corruptBudgetOverlay(bytes?: string): Promise<void>;
  cleanup(): Promise<void>;
}

export interface WorldTickOptions {
  at?: Date;
  spawn?: DispatchSpawn;
  eventSource?: GitHubEventSource;
  explicitScheduleRetries?: readonly string[];
  schedulerFault?: (boundary: string) => void | Promise<void>;
  openIssues?: ReadonlyArray<{ number: number; title: string; labels: string[] }>;
}

const NO_EVENTS: GitHubEventSource = {
  ticketReady: async () => [],
  prOpened: async () => [],
  ciFailed: async () => [],
  releaseShipped: async () => [],
};

export async function makeSchedulerWorld(spec: WorldSpec): Promise<SchedulerWorld> {
  const home = await makeTempOrgHome({ name: spec.name ?? ORG_NAME });
  await writeFile(
    join(home.orgHome, "apps.yaml"),
    [
      "schema_version: 1",
      "org:",
      `  name: ${ORG_NAME}`,
      `  max_concurrent_turns: ${spec.maxConcurrentTurns ?? 2}`,
      "defaults:",
      "  budget_usd_month: 1000",
      "apps:",
      ...spec.apps.flatMap(renderApp),
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(home.orgHome, "roles.yaml"),
    ["defaults:", "  max_turn_budget_usd: 5", "roles:", ...spec.roles.flatMap(renderRole), ""].join("\n"),
    "utf8",
  );
  const orgId = schedulerOrgId(ORG_NAME, home.orgHome);
  const evidence = new SchedulerEvidenceStore({
    stateHome: home.stateHome,
    orgName: ORG_NAME,
    orgHome: home.orgHome,
    schedulerId: schedulerIdentity(ORG_NAME, home.orgHome),
  });
  const spawns: SchedulerWorld["spawns"] = [];
  const world: SchedulerWorld = {
    home,
    orgId,
    evidence,
    dueClaims: new ScheduleDueClaimStore(home.stateHome),
    spawns,
    async tick(options: WorldTickOptions = {}) {
      const at = options.at ?? FIXED_NOW;
      const openIssues = options.openIssues;
      const source: GitHubEventSource =
        options.eventSource ??
        (openIssues === undefined ? NO_EVENTS : { ...NO_EVENTS, openIssues: async () => [...openIssues] });
      return dispatchTick({
        orgRoot: home.orgHome,
        runtimeHome: home.stateHome,
        now: () => at,
        eventSource: source,
        spawn:
          options.spawn ??
          (async (input) => {
            spawns.push({ app: input.app, role: input.role, turnId: input.turnId });
          }),
        ...(options.explicitScheduleRetries === undefined
          ? {}
          : { explicitScheduleRetries: options.explicitScheduleRetries }),
        ...(options.schedulerFault === undefined ? {} : { schedulerFault: options.schedulerFault }),
      });
    },
    async seedInboxEvent(input) {
      // changelog 2026-08-12 (HB-P3, F-PT-006): the returned key is the ratified
      // CONTENT identity, not the delivery filename. The file is still written
      // under `<id>.json` — the point of the ruling is that the name does not
      // decide identity (B-13 §2).
      const file = `${input.id}.json`;
      const inbox = join(home.stateHome, "state", "events", "inbox");
      await mkdir(inbox, { recursive: true });
      const envelope = {
        kind: input.kind,
        id: input.id,
        app: input.app,
        occurred_at: FIXED_NOW.toISOString(),
        source: "fixture",
        summary: `seeded ${input.kind} event`,
      };
      const body =
        input.kind === "adoption-signal"
          ? { ...envelope, metric: "weekly-installs", direction: "up" }
          : { ...envelope, severity: "high", channel: input.channel ?? "email" };
      await writeFile(join(inbox, file), `${JSON.stringify(body)}\n`, "utf8");
      return inboxEventKey(body);
    },
    async corruptScheduleState(bytes = "{ this is not json") {
      const path = join(home.stateHome, "state", "schedule.json");
      await mkdir(join(home.stateHome, "state"), { recursive: true });
      await writeFile(path, bytes, "utf8");
    },
    async corruptBudgetOverlay(bytes = "{ torn overlay") {
      const path = join(home.stateHome, "state", "budget-overlay.json");
      await mkdir(join(home.stateHome, "state"), { recursive: true });
      await writeFile(path, bytes, "utf8");
    },
    cleanup: () => home.cleanup(),
  };
  return world;
}

// ---------------------------------------------------------------------------
// Evidence projections
// ---------------------------------------------------------------------------

/** The initiator-independent identity + terminal shape of one decision. Every
 * field here must be a pure function of (org, window, app, role, trigger,
 * event) and the observed world — never of who invoked the tick. */
export interface DecisionProjection {
  decision_id: string;
  app: string;
  role: string;
  trigger_kind: string;
  trigger: string;
  event_key: string | null;
  cadence_window: string;
  episode_id: string | null;
  stage: string;
  outcome: string | null;
  classification: string;
  reason_code: string | null;
  schedule_claim_id: string | undefined;
  schedule_claim_attempt: number | undefined;
}

export function projectDecision(row: SchedulerDecisionRecord): DecisionProjection {
  return {
    decision_id: row.decision_id,
    app: row.app,
    role: row.role,
    trigger_kind: row.trigger_kind,
    trigger: row.trigger,
    event_key: row.event_key,
    cadence_window: row.cadence_window,
    episode_id: row.episode_id,
    stage: row.stage,
    outcome: row.outcome,
    classification: row.classification,
    reason_code: row.reason_code,
    schedule_claim_id: row.schedule_claim_id,
    schedule_claim_attempt: row.schedule_claim_attempt,
  };
}

export async function decisionProjections(world: SchedulerWorld): Promise<DecisionProjection[]> {
  return (await world.evidence.listDecisions())
    .map(projectDecision)
    .sort((a, b) => a.decision_id.localeCompare(b.decision_id));
}

export function mustFind<T>(items: readonly T[], predicate: (item: T) => boolean, what: string): T {
  const found = items.find(predicate);
  if (found === undefined) throw new Error(`expected to find ${what}`);
  return found;
}

// ---------------------------------------------------------------------------
// Detectors (each proven to FIRE by a "negative control: …" test)
// ---------------------------------------------------------------------------

/** J-09/B-08 §2: at most one spawn per (app, role, trigger, due window) across
 * ANY number of ticks — the cross-tick duplicate is the second asymmetric
 * nightmare's temptation (post-spawn bookkeeping failure). */
export class DuplicateSpawnViolation extends Error {
  constructor(key: string, count: number) {
    super(`B-08 violated: ${key} spawned ${count} times across ticks in one due window`);
    this.name = "DuplicateSpawnViolation";
  }
}

export function assertNoDuplicateSpawnAcrossTicks(results: readonly DispatchTickResult[]): void {
  const counts = new Map<string, number>();
  for (const result of results) {
    for (const turn of result.spawned) {
      const key = spawnKey(turn);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of counts) {
    if (count > 1) throw new DuplicateSpawnViolation(key, count);
  }
}

function spawnKey(turn: DueTurn): string {
  return [turn.app, turn.role, turn.triggerKind, turn.trigger, turn.cadenceWindow, turn.eventKey ?? ""].join("|");
}

/** CF-J09-A: manual `cormidia dispatch` and the timer-fired tick are the same
 * boundary — identical worlds must yield identical decision evidence no matter
 * which initiator (or arrival instant inside the window) drove the tick. */
export class InitiatorDivergenceViolation extends Error {
  constructor(detail: string) {
    super(`CF-J09-A violated: manual and timer dispatch diverged: ${detail}`);
    this.name = "InitiatorDivergenceViolation";
  }
}

export function assertInitiatorParity(
  timer: readonly DecisionProjection[],
  manual: readonly DecisionProjection[],
): void {
  if (timer.length !== manual.length) {
    throw new InitiatorDivergenceViolation(`decision counts differ (timer=${timer.length}, manual=${manual.length})`);
  }
  for (const [index, left] of timer.entries()) {
    const right = manual[index];
    if (right === undefined || JSON.stringify(left) !== JSON.stringify(right)) {
      throw new InitiatorDivergenceViolation(
        `decision ${left.decision_id}: ${JSON.stringify(left)} != ${JSON.stringify(right)}`,
      );
    }
  }
}

/** CF-C-B08 §2 / CF-J09-R: the vocabulary is CLOSED (F-PT-034). Any reason
 * outside the ratified 20 is a contract violation; any member the matrix never
 * produced leaves the enumeration incomplete. */
export class VocabularyViolation extends Error {
  constructor(detail: string) {
    super(`B-08 §2 closed vocabulary violated: ${detail}`);
    this.name = "VocabularyViolation";
  }
}

export function assertWithinClosedVocabulary(observed: ReadonlySet<string>): void {
  const closed = new Set<string>(B08_CLOSED_VOCABULARY);
  const foreign = [...observed].filter((reason) => !closed.has(reason)).sort();
  if (foreign.length > 0) throw new VocabularyViolation(`unratified reason(s): ${foreign.join(", ")}`);
}

export function assertVocabularyExercised(observed: ReadonlySet<string>): void {
  const missing = B08_CLOSED_VOCABULARY.filter((reason) => !observed.has(reason));
  if (missing.length > 0)
    throw new VocabularyViolation(`members never produced on their trigger: ${missing.join(", ")}`);
}

/** F-PT-034: a malformed definition or corrupt scheduler state must terminate
 * as a NAMED, evidenced non-admission — a tick that rejects (crashes) instead
 * is the pre-fix behavior this detector exists to catch. */
export class CrashInsteadOfNamedDecisionViolation extends Error {
  constructor(cause: unknown) {
    super(
      `F-PT-034 violated: the dispatch tick crashed instead of terminating the entry in a named reason: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "CrashInsteadOfNamedDecisionViolation";
  }
}

export async function tickWithoutCrash(tick: Promise<DispatchTickResult>): Promise<DispatchTickResult> {
  try {
    return await tick;
  } catch (error) {
    throw new CrashInsteadOfNamedDecisionViolation(error);
  }
}

// ---------------------------------------------------------------------------
// Corpus agreement: the two ratified surfaces carry the SAME closed set
// ---------------------------------------------------------------------------

function repoPath(relative: string): string {
  return fileURLToPath(new URL(`../../../${relative}`, import.meta.url));
}

function backtickedTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(/`([a-z_]+)`/g)) {
    const token = match[1];
    if (token !== undefined) tokens.push(token);
  }
  return tokens;
}

/** The Execution/admission row of docs/scheduler/design.md → "Outcomes and
 * reason codes" — the canonical table per F-PT-034. */
export async function designDocExecutionAdmissionRow(): Promise<string[]> {
  const text = await readFile(repoPath("docs/scheduler/design.md"), "utf8");
  const row = text.split("\n").find((line) => line.startsWith("| Execution/admission |"));
  if (row === undefined) throw new Error("docs/scheduler/design.md lost its Execution/admission reason-code row");
  return backtickedTokens(row);
}

/** The closed enumeration in contracts/B-08-tick-turn.md §2 (between the
 * "exactly" opener and the "same 20-member set" closer). */
export async function contractClosedVocabulary(): Promise<string[]> {
  const text = await readFile(repoPath("validation-design/contracts/B-08-tick-turn.md"), "utf8");
  const match = /which is \*\*CLOSED\*\*[\s\S]*?exactly([\s\S]*?)— the same 20-member/.exec(text);
  const enumeration = match?.[1];
  if (enumeration === undefined) throw new Error("contracts/B-08-tick-turn.md §2 lost its closed enumeration");
  return backtickedTokens(enumeration);
}
