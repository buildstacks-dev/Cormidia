// Composable org-home / app-repo temp fixture (build plan M0.3).
//
// docs/architecture.md §1 separates the installed package, committed org
// home, local runtime state, and target app repo. This fixture models the
// latter three; package templates are covered by org-home lifecycle tests.
//
// `makeOrgHome()` builds one temp directory that can stand in for *either*
// of the first two homes, one opt-in sub-tree at a time: a test that only
// needs `memory/roles/<role>/` (a git-org-home concern) and a test that only
// needs `state/schedule.json` (a runtime-state concern) both call
// `makeOrgHome`, each opting into just the slice it needs, and pass
// `fixture.root` as whatever root parameter the code under test expects.
// This is a deliberate simplification for tests only — in a real deployment
// those two roots usually differ (repo root vs `~/.operon/<org>/`); nothing
// here claims otherwise. See docs/loop.md §9 for `runs/<app>/<runId>/…`,
// which M2.4 extends this fixture to build in full — the `runs` sub-builder
// here is a namespace hook (per-app directories), not the run-record layout.
//
// `makeAppRepo()` builds the target-repo-side `.operon/` tree. Runtime-state
// concerns and org-level configuration never belong in that git-tracked tree.
//
// Both fixtures are directory trees only — no git repo is initialized here
// (that is M4.1's `gitRepo.ts` fixture, a separate concern with its own
// deps: — entry in the build plan).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as toYaml } from "yaml";
import { runPaths } from "../../src/runtime/runlog/paths.js";
import {
  efficiencyEpisodeDir,
  executionStepPath,
  routeRecordPath,
  type ExecutionStepRecord,
  type RouteRecord,
} from "../../src/loop/efficiency.js";
import {
  executionJournalPath,
  type ExecutionJournal,
} from "../../src/loop/execution-journal.js";

// ---------------------------------------------------------------------------
// Shared sub-builder option shapes
// ---------------------------------------------------------------------------

export interface MemoryDoc {
  /** Filename under the role's bundle dir, e.g. "prefer-fixture-factories".
   * A ".md" extension is appended automatically if missing. */
  name: string;
  content: string;
}

export interface MemoryRoleBundle {
  /** INDEX.md content — the always-included excerpt layer (architecture.md
   * §5, §6). Defaults to an empty index when omitted so the file still
   * exists (real readers assume every bundle has one). */
  index?: string;
  docs?: MemoryDoc[];
}

export interface MemoryOptions {
  /** memory/roles/<role>/ (or .operon/memory/<role>/ in an app repo, per
   * architecture.md §6): OKF bundles, one sub-dir per role. */
  roles?: Record<string, MemoryRoleBundle>;
}

export interface TasteOptions {
  /** Org-wide TASTE.md content at the tree root (architecture.md §1 — org
   * constitution, human-ratified). Defaults to a small placeholder body
   * when omitted so opting in always yields a real file. */
  org?: string;
  /** Per-role craft addenda written to taste/<role>.md (architecture.md §5
   * layer [2]). */
  roles?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// makeOrgHome — runtime-state-only sub-builders
// ---------------------------------------------------------------------------

export interface StateOptions {
  /** state/schedule.json — last-fired timestamp per (app, role, trigger)
   * (architecture.md §2). Caller supplies already-flattened keys, e.g.
   * `{"civic|builder|hourly": "2026-07-04T09:00:00.000Z"}`. */
  schedule?: Record<string, string>;
  /** state/turns/<turnId>.json — turn journals (architecture.md §3). */
  turns?: Record<string, unknown>;
  /** state/events/inbox/<name>.json — the file-drop event inbox
   * (architecture.md §2, `alert-webhook` row). */
  eventsInbox?: Record<string, unknown>;
  /** state/events/consumed.json — dedup keys already fired, so a tick never
   * refires an event (architecture.md §2). */
  consumedEventKeys?: string[];
  /** locks/<app>--<role>.lock (architecture.md §2 "Locking & concurrency").
   * Folded into `state` because both are dispatcher-owned scheduling state
   * and the item's sub-builder set has no separate `locks` key. Keyed as
   * `"<app>--<role>"`. */
  locks?: Record<string, unknown>;
}

export interface ApprovalsOptions {
  /** approvals/pending/<id>.json */
  pending?: Record<string, unknown>;
  /** approvals/decided/<id>.json */
  decided?: Record<string, unknown>;
  /** approvals/grants/<grantId>.json */
  grants?: Record<string, unknown>;
  /** approvals/log.jsonl — one JSON object per line, in order
   * (architecture.md §4: "append-only audit trail"). */
  log?: unknown[];
}

/** One run record's files (docs/loop.md §9). Only the pieces a test opts
 * into are written; the run directory itself always exists. */
export interface RunRecordOptions {
  /** envelope.json (L1). */
  envelope?: unknown;
  /** events.jsonl (L2) — one JSON object per line, in order. */
  events?: unknown[];
  /** brief.md (L3). */
  brief?: string;
  /** output.md (L3). */
  output?: string;
  /** session.log (L3). */
  sessionLog?: string;
}

export interface RunsOptions {
  /** runs/<app>/ — bare per-app namespace directories (no run records). */
  apps?: string[];
  /** Full run records, app → runId → files (M2.4). Paths come from the
   * REAL builder (src/runtime/runlog/paths.ts), so fixture layout and
   * production layout cannot drift apart. */
  records?: Record<string, Record<string, RunRecordOptions>>;
}

/** One efficiency episode as the orchestrator actually writes it (#142):
 * `efficiency/episodes/<sha256(episodeId)[0..32]>/{route.json,
 * execution-journal.json, steps/<sha256(stepId)>.json}`.
 *
 * Ids matter here more than anywhere else in this fixture. `episodeId` is the
 * EFFICIENCY-namespace id (`ticket:<app>:#2`, `trace:<app>:<trace>`) — the same
 * id the run envelope carries and the capture→projector seam matches steps on.
 * A fixture that invents a self-consistent id of its own cannot reproduce the
 * namespace mismatch that dropped 100% of production evidence (#137), which is
 * precisely why the pre-existing hand-built fixtures missed it. */
export interface EfficiencyEpisodeOptions {
  /** route.json. Merged over a valid minimal record, so a test states only
   * the fields it is about (usually `budget.equivalent_cost_usd`). */
  route?: Partial<RouteRecord> | false;
  /** execution-journal.json — omit for an episode with no journal, which is
   * the shape a cap firing inside the quality-gate repair loop leaves. */
  journal?: Partial<ExecutionJournal>;
  /** steps/<hash>.json, keyed by `execution_step_id`. Each is merged over a
   * valid minimal provider step bound to this episode. */
  steps?: Record<string, Partial<ExecutionStepRecord> & { run_id: string }>;
}

export interface EfficiencyOptions {
  /** Efficiency-namespace episode id → episode contents. */
  episodes?: Record<string, EfficiencyEpisodeOptions>;
}

export interface OrgHomeOptions {
  taste?: boolean | TasteOptions;
  memory?: boolean | MemoryOptions;
  state?: boolean | StateOptions;
  approvals?: boolean | ApprovalsOptions;
  runs?: boolean | RunsOptions;
  /** efficiency/episodes/<hash>/… (Phase 4 route/journal/step evidence). */
  efficiency?: boolean | EfficiencyOptions;
}

export interface OrgHomeFixture {
  /** Root of the temp tree. Pass this as the org-home / org-runtime-dir
   * parameter of whatever is under test. */
  root: string;
  paths: {
    taste: string;
    roleTaste(role: string): string;
    memoryRoleDir(role: string): string;
    memoryIndex(role: string): string;
    memoryDoc(role: string, name: string): string;
    schedule: string;
    turn(turnId: string): string;
    eventsInboxFile(name: string): string;
    consumedEvents: string;
    lock(app: string, role: string): string;
    approvalsPending(id: string): string;
    approvalsDecided(id: string): string;
    grant(grantId: string): string;
    approvalsLog: string;
    runsAppDir(app: string): string;
    runDir(app: string, runId: string): string;
    efficiencyEpisodeDir(episodeId: string): string;
    routeRecord(episodeId: string): string;
    executionJournal(episodeId: string): string;
    executionStep(episodeId: string, stepId: string): string;
  };
  /** Removes the entire temp tree. Safe to call more than once. */
  cleanup(): void;
}

export function makeOrgHome(options: OrgHomeOptions = {}): OrgHomeFixture {
  const root = mkdtempSync(join(tmpdir(), "operon-orghome-"));
  return buildOrgHomeAt(root, options);
}

/** Build taste, memory, state, approvals, and runs directly under `dir` — no
 * temp dir of its own, no `cleanup()` (the caller's fixture owns that). */
export function buildOrgHomeAt(dir: string, options: OrgHomeOptions = {}): OrgHomeFixture {
  const paths = orgHomePaths(dir);

  if (options.taste) buildTaste(paths, options.taste === true ? {} : options.taste);
  if (options.memory) buildMemory(dir, paths, options.memory === true ? {} : options.memory);
  if (options.state) buildState(dir, paths, options.state === true ? {} : options.state);
  if (options.approvals) {
    buildApprovals(dir, paths, options.approvals === true ? {} : options.approvals);
  }
  if (options.runs) buildRuns(dir, paths, options.runs === true ? {} : options.runs);
  if (options.efficiency) {
    buildEfficiency(dir, paths, options.efficiency === true ? {} : options.efficiency);
  }

  return {
    root: dir,
    paths,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function orgHomePaths(dir: string): OrgHomeFixture["paths"] {
  return {
    taste: join(dir, "TASTE.md"),
    roleTaste: (role) => join(dir, "taste", `${role}.md`),
    memoryRoleDir: (role) => join(dir, "memory", "roles", role),
    memoryIndex: (role) => join(dir, "memory", "roles", role, "INDEX.md"),
    memoryDoc: (role, name) => join(dir, "memory", "roles", role, withMdExt(name)),
    schedule: join(dir, "state", "schedule.json"),
    turn: (turnId) => join(dir, "state", "turns", `${turnId}.json`),
    eventsInboxFile: (name) => join(dir, "state", "events", "inbox", withJsonExt(name)),
    consumedEvents: join(dir, "state", "events", "consumed.json"),
    lock: (app, role) => join(dir, "locks", `${app}--${role}.lock`),
    approvalsPending: (id) => join(dir, "approvals", "pending", `${id}.json`),
    approvalsDecided: (id) => join(dir, "approvals", "decided", `${id}.json`),
    grant: (grantId) => join(dir, "approvals", "grants", `${grantId}.json`),
    approvalsLog: join(dir, "approvals", "log.jsonl"),
    runsAppDir: (app) => join(dir, "runs", app),
    runDir: (app, runId) => runPaths(dir, app, runId).dir,
    // Real path builders, like `runs` above: fixture layout and production
    // layout cannot drift apart.
    efficiencyEpisodeDir: (episodeId) => efficiencyEpisodeDir(dir, episodeId),
    routeRecord: (episodeId) => routeRecordPath(dir, episodeId),
    executionJournal: (episodeId) => executionJournalPath(dir, episodeId),
    executionStep: (episodeId, stepId) => executionStepPath(dir, episodeId, stepId),
  };
}

function buildTaste(paths: OrgHomeFixture["paths"], opts: TasteOptions): void {
  writeFile(paths.taste, opts.org ?? "# TASTE (fixture placeholder)\n");
  for (const [role, content] of Object.entries(opts.roles ?? {})) {
    writeFile(paths.roleTaste(role), content);
  }
}

function buildMemory(dir: string, paths: OrgHomeFixture["paths"], opts: MemoryOptions): void {
  const roles = opts.roles ?? {};
  if (Object.keys(roles).length === 0) {
    ensureDir(join(dir, "memory", "roles"));
    return;
  }
  for (const [role, bundle] of Object.entries(roles)) {
    ensureDir(paths.memoryRoleDir(role));
    writeFile(paths.memoryIndex(role), bundle.index ?? "");
    for (const doc of bundle.docs ?? []) {
      writeFile(paths.memoryDoc(role, doc.name), doc.content);
    }
  }
}

function buildState(dir: string, paths: OrgHomeFixture["paths"], opts: StateOptions): void {
  ensureDir(join(dir, "state", "events", "inbox"));
  ensureDir(join(dir, "state", "turns"));
  ensureDir(join(dir, "locks"));

  if (opts.schedule) writeJson(paths.schedule, opts.schedule);
  for (const [turnId, journal] of Object.entries(opts.turns ?? {})) {
    writeJson(paths.turn(turnId), journal);
  }
  for (const [name, event] of Object.entries(opts.eventsInbox ?? {})) {
    writeJson(paths.eventsInboxFile(name), event);
  }
  if (opts.consumedEventKeys) writeJson(paths.consumedEvents, opts.consumedEventKeys);
  for (const [key, lock] of Object.entries(opts.locks ?? {})) {
    const [app, role] = splitLockKey(key);
    writeJson(paths.lock(app, role), lock);
  }
}

function splitLockKey(key: string): [string, string] {
  const sep = key.indexOf("--");
  if (sep === -1) {
    throw new Error(`orgHome fixture: lock key "${key}" must be shaped "<app>--<role>"`);
  }
  return [key.slice(0, sep), key.slice(sep + 2)];
}

function buildApprovals(
  dir: string,
  paths: OrgHomeFixture["paths"],
  opts: ApprovalsOptions,
): void {
  ensureDir(join(dir, "approvals", "pending"));
  ensureDir(join(dir, "approvals", "decided"));
  ensureDir(join(dir, "approvals", "grants"));

  for (const [id, item] of Object.entries(opts.pending ?? {})) {
    writeJson(paths.approvalsPending(id), item);
  }
  for (const [id, item] of Object.entries(opts.decided ?? {})) {
    writeJson(paths.approvalsDecided(id), item);
  }
  for (const [grantId, grant] of Object.entries(opts.grants ?? {})) {
    writeJson(paths.grant(grantId), grant);
  }
  writeFile(paths.approvalsLog, toJsonLines(opts.log ?? []));
}

function buildRuns(dir: string, paths: OrgHomeFixture["paths"], opts: RunsOptions): void {
  ensureDir(join(dir, "runs"));
  for (const app of opts.apps ?? []) {
    ensureDir(paths.runsAppDir(app));
  }
  for (const [app, records] of Object.entries(opts.records ?? {})) {
    for (const [runId, record] of Object.entries(records)) {
      const rp = runPaths(dir, app, runId);
      ensureDir(rp.dir);
      if (record.envelope !== undefined) writeJson(rp.envelope, record.envelope);
      if (record.events !== undefined) writeFile(rp.events, toJsonLines(record.events));
      if (record.brief !== undefined) writeFile(rp.brief, record.brief);
      if (record.output !== undefined) writeFile(rp.output, record.output);
      if (record.sessionLog !== undefined) writeFile(rp.sessionLog, record.sessionLog);
    }
  }
}

function buildEfficiency(
  dir: string,
  paths: OrgHomeFixture["paths"],
  opts: EfficiencyOptions,
): void {
  ensureDir(join(dir, "efficiency", "episodes"));
  for (const [episodeId, episode] of Object.entries(opts.episodes ?? {})) {
    const app = appOf(episodeId);
    ensureDir(paths.efficiencyEpisodeDir(episodeId));
    if (episode.route !== false) {
      writeJson(paths.routeRecord(episodeId), {
        ...minimalRoute(episodeId, app),
        ...episode.route,
        // The episode's own id is never overridable: a route filed under a
        // different id is corruption, not a fixture option.
        episode_id: episodeId,
      });
    }
    if (episode.journal !== undefined) {
      writeJson(paths.executionJournal(episodeId), {
        ...minimalJournal(episodeId, app),
        ...episode.journal,
        episode_id: episodeId,
      });
    }
    for (const [stepId, step] of Object.entries(episode.steps ?? {})) {
      // The default is derived from the EFFECTIVE kind: a mechanical step must
      // carry `provider_turn_id: null` or the real reader rejects it as corrupt.
      writeJson(paths.executionStep(episodeId, stepId), {
        ...minimalStep(episodeId, app, stepId, step.run_id, step.kind ?? "provider"),
        ...step,
        execution_step_id: stepId,
        episode_id: episodeId,
      });
    }
  }
}

/** `ticket:alpha:#2` / `trace:alpha:t-1` → `alpha`. Keeps fixture episode ids
 *  and the app they belong to from being stated twice and disagreeing. */
function appOf(episodeId: string): string {
  return episodeId.split(":")[1] ?? "alpha";
}

function minimalRoute(episodeId: string, app: string): RouteRecord {
  return {
    schema_version: 1,
    episode_id: episodeId,
    app,
    policy_version: "fixture",
    admitted_at: "2026-07-12T10:00:00.000Z",
    planned_route: "standard",
    current_route: "standard",
    final_route: "standard",
    factors: [],
    authorized_passes: [],
    budget: {
      provider_turns: 5,
      equivalent_cost_usd: 15,
      active_time_ms: 45 * 60_000,
      human_decisions: null,
    },
    execution_bounds: null,
    reassessments: [],
    terminal: null,
  };
}

function minimalJournal(episodeId: string, app: string): ExecutionJournal {
  return {
    schema_version: 1,
    episode_id: episodeId,
    app,
    ticket_ref: episodeId,
    stages: [],
    status: "running",
    next_boundary: null,
    stop: null,
    updated_at: "2026-07-12T10:05:00.000Z",
  };
}

function minimalStep(
  episodeId: string,
  app: string,
  stepId: string,
  runId: string,
  kind: "provider" | "mechanical",
): ExecutionStepRecord {
  const mechanical = kind === "mechanical";
  return {
    schema_version: 1,
    execution_step_id: stepId,
    episode_id: episodeId,
    app,
    run_id: runId,
    kind,
    provider_turn_id: mechanical ? null : `turn-${stepId}`,
    operation: mechanical ? "gates/setup" : "build/implement",
    role: mechanical ? null : "builder",
    runtime: mechanical ? null : "codex",
    model: mechanical ? null : "fixture",
    effort: mechanical ? null : "medium",
    started_at: "2026-07-12T10:00:00.000Z",
    finished_at: "2026-07-12T10:05:00.000Z",
    status: "completed",
    error_code: null,
    reason: "fixture step",
    next_step: null,
    context_manifest_ref: null,
    input_fingerprint: `fp-in-${stepId}`,
    work_fingerprint_before: null,
    work_fingerprint_after: null,
    artifact_fingerprint: null,
    productive: false,
    repeated_from_step_id: null,
    tool_call_count: 0,
    usage: null,
  };
}

// ---------------------------------------------------------------------------
// makeAppRepo — target app repo's `.operon/` tree
// ---------------------------------------------------------------------------

export interface AppRepoOptions {
  /** .operon/TASTE.md — product charter (architecture.md §1, §5 layer [3]).
   * `true` writes a placeholder body. */
  taste?: boolean | string;
  /** .operon/config.yaml — this app's apps.yaml-schema entry (architecture.md
   * §1, §7), serialized with the `yaml` package (already a runtime
   * dependency — no new dependency added). `true` writes a minimal valid
   * stub with a `schema_version` field. */
  config?: boolean | Record<string, unknown>;
  /** .operon/memory/<role>/ — per-(role, app) domain bundles
   * (architecture.md §6). Same shape as the org-home memory sub-builder. */
  memory?: boolean | MemoryOptions;
}

export interface AppRepoFixture {
  /** Root of the temp app-repo tree (the repo root — `.operon/` lives under
   * it, matching the real target repo's layout). */
  root: string;
  /** Root of the `.operon/` tree specifically. */
  operonDir: string;
  paths: {
    taste: string;
    config: string;
    memoryRoleDir(role: string): string;
    memoryIndex(role: string): string;
    memoryDoc(role: string, name: string): string;
  };
  cleanup(): void;
}

export function makeAppRepo(options: AppRepoOptions = {}): AppRepoFixture {
  const root = mkdtempSync(join(tmpdir(), "operon-apprepo-"));
  return buildAppRepoAt(root, options);
}

/** Build the target-repo `.operon/` tree at a caller-owned path. This is used
 * by composed fixtures such as EvalWorld so all homes remain below one
 * auditable root while preserving the canonical app-repo builder. */
export function buildAppRepoAt(root: string, options: AppRepoOptions = {}): AppRepoFixture {
  const operonDir = join(root, ".operon");
  ensureDir(operonDir);

  const memoryRoot = operonDir; // .operon/memory/<role>/, not .operon/memory/roles/<role>/
  const paths = {
    taste: join(operonDir, "TASTE.md"),
    config: join(operonDir, "config.yaml"),
    memoryRoleDir: (role: string) => join(memoryRoot, "memory", role),
    memoryIndex: (role: string) => join(memoryRoot, "memory", role, "INDEX.md"),
    memoryDoc: (role: string, name: string) => join(memoryRoot, "memory", role, withMdExt(name)),
  };

  if (options.taste) {
    writeFile(paths.taste, options.taste === true ? "# App TASTE (fixture placeholder)\n" : options.taste);
  }
  if (options.config) {
    const config = options.config === true ? { schema_version: 1 } : options.config;
    writeFile(paths.config, toYaml(config));
  }
  if (options.memory) {
    buildAppMemory(memoryRoot, paths, options.memory === true ? {} : options.memory);
  }
  return {
    root,
    operonDir,
    paths,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function buildAppMemory(
  memoryRoot: string,
  paths: AppRepoFixture["paths"],
  opts: MemoryOptions,
): void {
  const roles = opts.roles ?? {};
  if (Object.keys(roles).length === 0) {
    ensureDir(join(memoryRoot, "memory"));
    return;
  }
  for (const [role, bundle] of Object.entries(roles)) {
    ensureDir(paths.memoryRoleDir(role));
    writeFile(paths.memoryIndex(role), bundle.index ?? "");
    for (const doc of bundle.docs ?? []) {
      writeFile(paths.memoryDoc(role, doc.name), doc.content);
    }
  }
}

// ---------------------------------------------------------------------------
// small fs helpers
// ---------------------------------------------------------------------------

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeFile(path: string, content: string): void {
  ensureDir(join(path, ".."));
  writeFileSync(path, content, "utf8");
}

function writeJson(path: string, data: unknown): void {
  writeFile(path, JSON.stringify(data, null, 2) + "\n");
}

function toJsonLines(items: unknown[]): string {
  return items.length === 0 ? "" : items.map((item) => JSON.stringify(item)).join("\n") + "\n";
}

function withMdExt(name: string): string {
  return name.endsWith(".md") ? name : `${name}.md`;
}

function withJsonExt(name: string): string {
  return name.endsWith(".json") ? name : `${name}.json`;
}
