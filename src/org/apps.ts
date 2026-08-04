// apps.yaml loader + validation — the app registry (docs/architecture.md §7).
// Mirrors the roles.ts patterns: parse YAML, validate strictly, return plain
// typed data. Multi-app exists only at this org layer and in human surfaces —
// never inside a turn (docs/PURPOSE.md → One turn, one app).

import { existsSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse, parseDocument, stringify } from "yaml";
import type { RoleConfig, Trigger } from "../runtime/types.js";
import { isAssignmentCandidateId } from "../runtime/assignment.js";
import { ASSIGNMENT_MODES, type AssignmentMode } from "../loop/episode-plan.js";
import { assertCanonicalGateCommandPlacement } from "../loop/gate-config.js";
import { RELEASE_KINDS, RELEASE_OWNERS, RELEASE_TRIGGERS, type ReleaseConfig, type ReleaseKind, type ReleaseOwner, type ReleaseTriggerMode } from "../loop/types.js";
import { writeFileAtomic } from "./atomic.js";
import {
  loadRoles,
  resolveApprovedAssignmentCandidates,
} from "./roles.js";
import {
  appRuntimePolicyYaml,
  normalizeAppRuntimePolicy,
  parseAppRuntimePolicy,
  shippedAppRuntimePolicy,
  type AppRuntimePolicy,
} from "./app-execution-policy.js";

export type AppStatus = "live" | "paused" | "onboarding";
export type AppAssignmentMode = AssignmentMode;

const STATUSES: AppStatus[] = ["live", "paused", "onboarding"];

/** App-owned assignment policy. This selects how an already-required provider
 * turn receives its atomic assignment; it is deliberately not a planning
 * enable/disable switch. `allowedAssignments` only narrows role-local,
 * org-approved candidate IDs. Membership is validated where app and role
 * configuration are assembled; this loader owns syntax and normalization. */
export interface AppExecutionConfig {
  assignmentMode: AppAssignmentMode;
  allowedAssignments: Record<string, string[]>;
  runtimePolicy?: AppRuntimePolicy;
}

/** Feedback/publishing channels an app exposes (docs/PURPOSE.md → "Support
 *  and Marketing are disabled per app until that app has real feedback or
 *  adoption channels"). Shared apps.yaml / `.cormidia/config.yaml` schema:
 *  `channels.support` gates Support turns, `channels.marketing` gates
 *  Marketing turns. Absent or empty list = that role stays disabled for the
 *  app regardless of its schedule/event triggers (see resolveTriggerRoute). */
export interface AppChannels {
  support?: string[];
  marketing?: string[];
}

export interface AppEntry {
  name: string;
  /** GitHub slug (`owner/repo`) — the app's identity. */
  repo: string;
  /** Operational policy, not code: "one live app at a time" is expressed
   *  here; the org-level WIP limit is what code enforces. */
  status: AppStatus;
  budgetUsdMonth: number;
  /** Per-role trigger overrides. When a role has an entry here it REPLACES
   *  (never merges with) that role's roles.yaml triggers; an empty list
   *  disables the role for this app. See resolveTriggers(). */
  cadence: Record<string, Trigger[]>;
  /** Channel-presence gate source. `loadApps` always populates it (`{}` when
   *  the app declares none); optional here so hand-built entries (tests,
   *  registration) may omit it — the dispatcher treats absent as `{}`, i.e.
   *  Support/Marketing gated off. Read by resolveTriggerRoute. */
  channels?: AppChannels;
  /** Declared release mechanism (A4). Absent = the app declares none: any
   *  milestone whose plan requires deploy/package fails the ship gate (P7). */
  release?: ReleaseConfig;
  /** Assignment policy. `loadApps` always resolves omission to fixed mode;
   *  optional here for legacy hand-built/test entries. */
  execution?: AppExecutionConfig;
}

export interface AppsFile {
  /** Present when the file carries the public-contract version field
   *  (architecture.md §1 — `.cormidia/config.yaml` shares this schema). */
  schemaVersion?: number;
  org: { name: string; maxConcurrentTurns: number };
  defaults: { budgetUsdMonth: number };
  apps: AppEntry[];
}

export interface FindExistingOrgOptions {
  /** Explicit org home, e.g. CLI `--org-home`. */
  orgHome?: string;
  /** Environment source; defaults to process.env. */
  env?: Partial<Pick<NodeJS.ProcessEnv, "CORMIDIA_ORG_HOME" | "CORMIDIA_HOME">>;
  /** Home dir for the pointer-file lookup; defaults to the current user. */
  homeDir?: string;
  /** Override for tests; defaults to `${homeDir}/.cormidia/config`. */
  pointerPath?: string;
}

export interface AppRegistration {
  name: string;
  repo: string;
  status?: AppStatus;
  budgetUsdMonth?: number;
  cadence?: Record<string, Trigger[]>;
  channels?: AppChannels;
  execution?: AppExecutionConfig;
}

export interface JoinExistingOrgResult {
  orgHome: string;
  appsPath: string;
  app: AppEntry;
}

export interface RemoveExistingAppResult {
  orgHome: string;
  appsPath: string;
  app: AppEntry;
}

export interface UpdateAppStatusResult {
  orgHome: string;
  appsPath: string;
  before: AppStatus;
  after: AppStatus;
  changed: boolean;
}

export async function loadApps(path: string): Promise<AppsFile> {
  const raw = parse(await readFile(path, "utf8")) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") throw new Error(`${path}: not a YAML mapping`);
  assertCanonicalGateCommandPlacement(raw, path);

  const orgRaw = raw["org"];
  if (!orgRaw || typeof orgRaw !== "object") {
    throw new Error(`${path}: missing top-level "org" mapping`);
  }
  const orgSpec = orgRaw as Record<string, unknown>;
  const orgName = orgSpec["name"];
  if (typeof orgName !== "string" || orgName.length === 0) {
    throw new Error(`${path}: org.name is required`);
  }
  const org = {
    name: orgName,
    maxConcurrentTurns: numberOr(orgSpec["max_concurrent_turns"], 2),
  };

  const defaultsRaw = (raw["defaults"] ?? {}) as Record<string, unknown>;
  const defaults = {
    budgetUsdMonth: numberOr(defaultsRaw["budget_usd_month"], 1000),
  };

  const appsRaw = raw["apps"];
  if (!appsRaw || typeof appsRaw !== "object" || Array.isArray(appsRaw)) {
    throw new Error(`${path}: missing top-level "apps" mapping`);
  }

  const apps: AppEntry[] = [];
  for (const [name, specUnknown] of Object.entries(appsRaw as Record<string, unknown>)) {
    apps.push(parseApp(name, specUnknown, defaults.budgetUsdMonth, path));
  }
  const file: AppsFile = { org, defaults, apps };
  if (typeof raw["schema_version"] === "number") file.schemaVersion = raw["schema_version"];
  return file;
}

function parseApp(
  name: string,
  specUnknown: unknown,
  defaultBudget: number,
  path: string,
): AppEntry {
  const err = (msg: string) => new Error(`${path}: app "${name}": ${msg}`);
  if (name === "learning-replay") {
    // Reserved runlog namespace (learning-loop M5, src/org/learning/capture.ts):
    // an app under this name would have every run silently excluded from
    // learning capture and episode projection — refuse at registration, not
    // by degradation at projection time.
    throw err('the name "learning-replay" is reserved for the learning loop\'s replay runs');
  }
  if (!specUnknown || typeof specUnknown !== "object") throw err("not a mapping");
  const spec = specUnknown as Record<string, unknown>;
  const allowedFields = new Set([
    "repo",
    "status",
    "budget_usd_month",
    "cadence",
    "channels",
    "release",
    "execution",
    // Bootstrap-owned app extension consumed by the gate-extension loader;
    // the registry intentionally preserves but does not interpret it here.
    "critical_ops",
  ]);
  const unknownFields = Object.keys(spec).filter((key) => !allowedFields.has(key));
  if (unknownFields.length > 0) {
    throw err(`unknown field(s): ${unknownFields.sort().join(", ")}`);
  }

  const repo = spec["repo"];
  if (typeof repo !== "string" || repo.length === 0) {
    throw err("repo is required (GitHub owner/repo slug)");
  }

  const status = spec["status"];
  if (typeof status !== "string" || !STATUSES.includes(status as AppStatus)) {
    throw err(`status must be one of ${STATUSES.join(" | ")}`);
  }

  const cadence: Record<string, Trigger[]> = {};
  if (spec["cadence"] !== undefined && spec["cadence"] !== null) {
    const cadenceRaw = spec["cadence"];
    if (typeof cadenceRaw !== "object" || Array.isArray(cadenceRaw)) {
      throw err("cadence must be a mapping of role -> trigger list");
    }
    for (const [role, listUnknown] of Object.entries(cadenceRaw as Record<string, unknown>)) {
      if (!Array.isArray(listUnknown)) {
        throw err(`cadence.${role} must be a list (empty list disables the role)`);
      }
      const triggers: Trigger[] = [];
      for (const t of listUnknown as Record<string, unknown>[]) {
        const trigger: Trigger = {};
        if (t && typeof t === "object") {
          if (typeof t["schedule"] === "string") trigger.schedule = t["schedule"];
          if (typeof t["event"] === "string") trigger.event = t["event"];
          if (t["manual"] === true) trigger.manual = true;
        }
        if (!trigger.schedule && !trigger.event && !trigger.manual) {
          throw err(`cadence.${role}: trigger needs schedule, event, or manual`);
        }
        triggers.push(trigger);
      }
      cadence[role] = triggers;
    }
  }

  const release = parseRelease(spec["release"], err);
  return {
    name,
    repo,
    status: status as AppStatus,
    budgetUsdMonth: numberOr(spec["budget_usd_month"], defaultBudget),
    cadence,
    channels: parseChannels(spec["channels"], err),
    execution: parseExecution(spec["execution"], err),
    ...(release !== undefined ? { release } : {}),
  };
}

/** Resolve legacy omission and validate the in-memory registration form.
 * Exported so lifecycle mirror checks compare effective behavior rather than
 * YAML spelling (`execution` omitted === explicit fixed with no narrowing). */
export function normalizeAppExecution(
  execution: AppExecutionConfig | undefined,
  errorPrefix = "execution",
): AppExecutionConfig {
  if (execution === undefined) {
    return {
      assignmentMode: "fixed",
      allowedAssignments: {},
      runtimePolicy: shippedAppRuntimePolicy(),
    };
  }
  const err = (msg: string) => new Error(`${errorPrefix}: ${msg}`);
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) {
    throw err("must be an object");
  }
  const spec = execution as unknown as Record<string, unknown>;
  for (const key of Object.keys(spec)) {
    if (key !== "assignmentMode" && key !== "allowedAssignments" && key !== "runtimePolicy") {
      throw err(`unknown key "${key}" (allowed: assignmentMode, allowedAssignments, runtimePolicy)`);
    }
  }
  if (!ASSIGNMENT_MODES.includes(execution.assignmentMode)) {
    throw err(`assignmentMode must be one of ${ASSIGNMENT_MODES.join(" | ")}`);
  }
  return {
    assignmentMode: execution.assignmentMode,
    allowedAssignments: parseAllowedAssignments(
      execution.allowedAssignments,
      err,
      "allowedAssignments",
    ),
    runtimePolicy: execution.runtimePolicy === undefined
      ? shippedAppRuntimePolicy()
      : normalizeAppRuntimePolicy(execution.runtimePolicy, err),
  };
}

export function runtimePolicyForApp(
  app: Pick<AppEntry, "execution">,
): AppRuntimePolicy {
  return normalizeAppExecution(app.execution).runtimePolicy!;
}

/** Convert normalized in-memory spelling to the shared apps.yaml /
 * `.cormidia/config.yaml` public schema. */
export function appExecutionYaml(
  execution: AppExecutionConfig | undefined,
): Record<string, unknown> {
  const normalized = normalizeAppExecution(execution);
  const out: Record<string, unknown> = { assignment_mode: normalized.assignmentMode };
  if (Object.keys(normalized.allowedAssignments).length > 0) {
    out["allowed_assignments"] = normalized.allowedAssignments;
  }
  Object.assign(out, appRuntimePolicyYaml(normalized.runtimePolicy!));
  return out;
}

function parseExecution(raw: unknown, err: (msg: string) => Error): AppExecutionConfig {
  if (raw === undefined) {
    return {
      assignmentMode: "fixed",
      allowedAssignments: {},
      runtimePolicy: shippedAppRuntimePolicy(),
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw err("execution must be a mapping");
  }
  const spec = raw as Record<string, unknown>;
  for (const key of Object.keys(spec)) {
    if (
      key !== "assignment_mode" &&
      key !== "allowed_assignments" &&
      key !== "permission_modes" &&
      key !== "limits"
    ) {
      throw err(
        `execution: unknown key "${key}" ` +
          "(allowed: assignment_mode, allowed_assignments, permission_modes, limits)",
      );
    }
  }

  const mode = spec["assignment_mode"] === undefined ? "fixed" : spec["assignment_mode"];
  if (typeof mode !== "string" || !ASSIGNMENT_MODES.includes(mode as AppAssignmentMode)) {
    throw err(`execution.assignment_mode must be one of ${ASSIGNMENT_MODES.join(" | ")}`);
  }

  return {
    assignmentMode: mode as AppAssignmentMode,
    allowedAssignments: parseAllowedAssignments(
      spec["allowed_assignments"] === undefined ? {} : spec["allowed_assignments"],
      err,
      "execution.allowed_assignments",
    ),
    runtimePolicy: parseAppRuntimePolicy(
      { permissionModes: spec["permission_modes"], limits: spec["limits"] },
      err,
    ),
  };
}

function parseAllowedAssignments(
  raw: unknown,
  err: (msg: string) => Error,
  field: string,
): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw err(`${field} must be a mapping of role -> assignment ID list`);
  }

  const result: Record<string, string[]> = {};
  for (const [role, idsRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (role.trim().length === 0 || role !== role.trim()) {
      throw err(`${field} role keys must be non-empty and contain no surrounding whitespace`);
    }
    if (!Array.isArray(idsRaw)) {
      throw err(`${field}.${role} must be a list of assignment IDs`);
    }
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const [index, id] of idsRaw.entries()) {
      if (typeof id !== "string" || !isAssignmentCandidateId(id)) {
        throw err(
          `${field}.${role}[${index}] must be a stable lowercase assignment ID ` +
            "(1-128 alphanumeric/./_/- characters; punctuation cannot lead or trail)",
        );
      }
      if (seen.has(id)) throw err(`${field}.${role} contains duplicate assignment ID "${id}"`);
      seen.add(id);
      ids.push(id);
    }
    result[role] = ids;
  }
  return result;
}

/** Parse the optional `release:` block (docs/approvals/design.md
 *  A4). Absent → undefined: the app declares no mechanism, and the ship gate
 *  fails any milestone whose plan requires one (P7). Loud on malformation —
 *  a wrong declaration must fail at load, not at ship time. */
function parseRelease(raw: unknown, err: (msg: string) => Error): ReleaseConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw err("release must be a mapping (kind, command, owner, trigger)");
  }
  const spec = raw as Record<string, unknown>;
  for (const key of Object.keys(spec)) {
    if (!["kind", "command", "owner", "trigger"].includes(key)) {
      throw err(`release: unknown key "${key}" (allowed: kind, command, owner, trigger)`);
    }
  }
  const kind = spec["kind"];
  if (typeof kind !== "string" || !RELEASE_KINDS.includes(kind as ReleaseKind)) {
    throw err(`release.kind must be one of ${RELEASE_KINDS.join(" | ")}`);
  }
  const command = spec["command"];
  const owner = spec["owner"] ?? "orchestrator";
  if (typeof owner !== "string" || !RELEASE_OWNERS.includes(owner as ReleaseOwner)) {
    throw err(`release.owner must be one of ${RELEASE_OWNERS.join(" | ")}`);
  }
  const rawTrigger = spec["trigger"];
  if (rawTrigger !== undefined) {
    if (typeof rawTrigger !== "string" || !RELEASE_TRIGGERS.includes(rawTrigger as ReleaseTriggerMode)) {
      throw err(`release.trigger must be one of ${RELEASE_TRIGGERS.join(" | ")}`);
    }
    if (rawTrigger === "branch") {
      throw err("release.trigger: branch is planned but not yet supported; use tag or command");
    }
  }

  if (kind === "merge-only") {
    if (command !== undefined) {
      throw err("release.command is meaningless for merge-only (nothing runs after merge)");
    }
    if (rawTrigger !== undefined) {
      throw err("release.trigger is meaningless for merge-only (nothing runs after merge)");
    }
    return { kind, owner: owner as ReleaseOwner };
  }

  // deploy | package. An explicit trigger wins; otherwise a declared command
  // infers `command` (back-compat for pre-trigger apps) and its absence
  // defaults to `tag` — the mechanism Cormidia fires by pushing the version tag.
  const trigger: ReleaseTriggerMode =
    rawTrigger === "tag" || rawTrigger === "command"
      ? rawTrigger
      : command !== undefined
        ? "command"
        : "tag";
  if (trigger === "command") {
    if (typeof command !== "string" || command.trim().length === 0) {
      throw err('release.command is required for trigger "command" (deploy command or CI workflow ref)');
    }
  } else if (command !== undefined) {
    throw err("release.command is not used with trigger: tag (Cormidia pushes the version tag itself)");
  }
  return {
    kind: kind as ReleaseKind,
    owner: owner as ReleaseOwner,
    trigger,
    ...(typeof command === "string" ? { command } : {}),
  };
}

/** Parse the optional `channels` block. Absent → `{}` (role stays gated off).
 *  Only the `support`/`marketing` keys are recognised; each must be a list of
 *  channel identifiers. Mirrors the bootstrap emitter (src/org/bootstrap.ts). */
function parseChannels(raw: unknown, err: (msg: string) => Error): AppChannels {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw err("channels must be a mapping of support/marketing -> channel list");
  }
  const spec = raw as Record<string, unknown>;
  const channels: AppChannels = {};
  for (const key of ["support", "marketing"] as const) {
    if (spec[key] === undefined) continue;
    if (!Array.isArray(spec[key]) || (spec[key] as unknown[]).some((v) => typeof v !== "string")) {
      throw err(`channels.${key} must be a list of channel identifiers (strings)`);
    }
    channels[key] = spec[key] as string[];
  }
  return channels;
}

/** Effective triggers for a role on one app (docs/architecture.md §2, §7):
 *  a cadence override REPLACES the role's roles.yaml triggers when present
 *  (never merges); an empty override list disables the role for that app;
 *  no override falls back to the role's own triggers. */
export function resolveTriggers(role: RoleConfig, app: AppEntry): Trigger[] {
  return app.cadence[role.name] ?? role.triggers;
}

export type OrgIdentityStopCode =
  | "symlinked_org_home"
  | "state_home_org_mismatch"
  | "state_home_identity_unreadable";

/**
 * Stable machine-readable identity stop (contracts/B-10-config-resolver.md
 * §2, B-10a): the resolved (org home, state home, org id) triple is
 * incoherent — a symlinked org-home path, a state home recorded for a
 * different org, or an unreadable pairing record. "Correct config from the
 * wrong org" is an identity failure: resolution stops with remediation
 * instead of proceeding (INV-004; fail-closed per INV-015). Mirrors
 * NoActiveOrgError's shape (src/org/home.ts) so JSON-aware callers branch on
 * `code` without matching prose.
 */
export class OrgIdentityError extends Error {
  readonly code: OrgIdentityStopCode;
  readonly publicMessage: string;
  readonly remediation: string;

  constructor(fields: {
    code: OrgIdentityStopCode;
    publicMessage: string;
    remediation: string;
    message: string;
  }) {
    super(fields.message);
    this.name = "OrgIdentityError";
    this.code = fields.code;
    this.publicMessage = fields.publicMessage;
    this.remediation = fields.remediation;
  }
}

/** Detect an existing org home (architecture §9 step 4): explicit
 * `--org-home` wins, then CORMIDIA_ORG_HOME, then a pointer file at
 * `~/.cormidia/config`. The pointer file accepts YAML/JSON with `org_home`
 * or `orgHome`, or a plain path. CORMIDIA_HOME remains a deprecated final
 * fallback for pre-packaging installations; runtime state uses
 * CORMIDIA_STATE_HOME and never consults CORMIDIA_HOME. Whatever source wins,
 * the selected path itself must not be a symbolic link — a symlinked org
 * home is a typed OrgIdentityError stop (B-10 §2), never a resolution. */
export async function findExistingOrg(
  options: FindExistingOrgOptions = {},
): Promise<string | undefined> {
  if (options.orgHome !== undefined) return assertOrgHomePathNotSymlink(resolve(options.orgHome));

  const env = options.env ?? process.env;
  if (env.CORMIDIA_ORG_HOME && env.CORMIDIA_ORG_HOME.length > 0) {
    return assertOrgHomePathNotSymlink(resolve(env.CORMIDIA_ORG_HOME));
  }

  const pointerPath = options.pointerPath ?? join(options.homeDir ?? homedir(), ".cormidia", "config");
  if (!existsSync(pointerPath)) {
    if (env.CORMIDIA_HOME && env.CORMIDIA_HOME.length > 0) {
      return assertOrgHomePathNotSymlink(resolve(env.CORMIDIA_HOME));
    }
    return undefined;
  }

  const text = (await readFile(pointerPath, "utf8")).trim();
  if (text.length === 0) return undefined;

  const parsed = parsePointer(text);
  return parsed ? assertOrgHomePathNotSymlink(resolve(parsed)) : undefined;
}

/** B-10a identity guard: the org-home path ITSELF must be a real entry —
 * symlinks elsewhere on the filesystem are out of scope. An org addressed
 * through a link would resolve under two identities while the pointer,
 * audit rows, and state-home pairing record the alias; refuse typed instead
 * of following it. An absent path passes through: completeness is
 * validateOrgHome's concern, and callers still need the selected path to
 * name WHICH org home is missing. */
async function assertOrgHomePathNotSymlink(orgHome: string): Promise<string> {
  let selected: Awaited<ReturnType<typeof lstat>>;
  try {
    selected = await lstat(orgHome);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return orgHome;
    throw error;
  }
  if (selected.isSymbolicLink()) {
    throw new OrgIdentityError({
      code: "symlinked_org_home",
      publicMessage: "org home path is a symbolic link",
      remediation:
        "Point the selection (--org-home, CORMIDIA_ORG_HOME, or `cormidia org use`) at the real directory, not a link to it.",
      message:
        `cormidia: org home path is a symbolic link: ${orgHome} — an org is addressed by its real path only, ` +
        "so one org never resolves under two identities; re-select the real directory with " +
        "`cormidia org use <real path>` (or point --org-home/CORMIDIA_ORG_HOME at it)",
    });
  }
  return orgHome;
}

function parsePointer(text: string): string | undefined {
  try {
    const raw = parse(text) as unknown;
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const spec = raw as Record<string, unknown>;
      for (const key of ["org_home", "orgHome", "home", "path"]) {
        if (typeof spec[key] === "string" && spec[key].length > 0) return spec[key];
      }
    }
  } catch {
    // Fall through to plain-path handling.
  }
  return text.includes("\n") || text.includes(":") ? undefined : text;
}

/** Register a new app in an existing org home by appending one YAML block to
 * `apps.yaml`. Existing bytes are preserved exactly; duplicates fail before
 * any write, so second-app bootstrap joins the org instead of forking it. */
export async function joinExistingOrg(
  orgHomeIn: string,
  registration: AppRegistration,
): Promise<JoinExistingOrgResult> {
  const orgHome = resolve(orgHomeIn);
  const appsPath = join(orgHome, "apps.yaml");
  const before = await readFile(appsPath, "utf8");
  const file = await loadApps(appsPath);

  if (file.apps.some((a) => a.repo === registration.repo)) {
    throw new Error(
      `bootstrap: repo ${registration.repo} is already registered in ${appsPath} ` +
        `(duplicate repo slugs are not allowed)`,
    );
  }
  if (file.apps.some((a) => a.name === registration.name)) {
    throw new Error(`bootstrap: app "${registration.name}" is already registered in ${appsPath}`);
  }

  const status = registration.status ?? "onboarding";
  const cadence = registration.cadence ?? {};
  const execution = normalizeAppExecution(registration.execution, "bootstrap: execution");
  const entry: AppEntry = {
    name: registration.name,
    repo: registration.repo,
    status,
    budgetUsdMonth: registration.budgetUsdMonth ?? file.defaults.budgetUsdMonth,
    cadence,
    channels: registration.channels ?? {},
    execution,
  };
  await validateRegistrationAssignments(orgHome, entry);

  const blockSpec: Record<string, unknown> = {
    repo: registration.repo,
    status,
  };
  if (registration.budgetUsdMonth !== undefined) {
    blockSpec["budget_usd_month"] = registration.budgetUsdMonth;
  }
  blockSpec["cadence"] = cadence;
  blockSpec["execution"] = appExecutionYaml(execution);
  if (registration.channels !== undefined && Object.keys(registration.channels).length > 0) {
    blockSpec["channels"] = registration.channels;
  }

  const block = stringify({ [registration.name]: blockSpec })
    .trimEnd()
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  // `cormidia org init` deliberately starts with an empty mapping. Expand that
  // canonical form in place for the first app; later registrations retain the
  // byte-preserving EOF append used for human-edited registries.
  const emptyAppsLine = /^apps:\s*\{\}\s*$/m;
  const next = emptyAppsLine.test(before)
    ? `${before.replace(emptyAppsLine, `apps:\n${block}`).trimEnd()}\n`
    : `${before.endsWith("\n") ? before : `${before}\n`}${block}\n`;
  await writeFileAtomic(appsPath, next);

  // The 2-space EOF append assumes `apps:` is the last top-level key at 2-space
  // indent. apps.yaml is a human-ratified surface, so a reorder/reindent can
  // make the new block nest under the wrong mapping (app silently dropped) or
  // produce invalid YAML (loadApps throws on the next tick, org offline).
  // Re-parse and confirm the new app landed; on any failure, roll the file back
  // to its exact prior bytes so a bad append never corrupts the registry.
  try {
    const reloaded = await loadApps(appsPath);
    const landed = reloaded.apps.some((a) => a.name === entry.name && a.repo === entry.repo);
    if (!landed) {
      throw new Error(`app "${entry.name}" is not present after append (non-canonical apps.yaml layout?)`);
    }
  } catch (error) {
    await writeFileAtomic(appsPath, before);
    throw new Error(
      `bootstrap: appending "${entry.name}" to ${appsPath} produced an invalid registry; ` +
        `rolled back. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { orgHome, appsPath, app: entry };
}

/** Validate behavior-affecting app narrowing before the registry is touched.
 * Syntax-only validation is insufficient here: an unknown role/candidate
 * would otherwise be persisted successfully and fail later when the complete
 * org home is assembled. Fixed legacy registrations with no narrowing remain
 * compatible and do not require an eager roles.yaml read. */
async function validateRegistrationAssignments(
  orgHome: string,
  app: Pick<AppEntry, "name" | "execution">,
): Promise<void> {
  const execution = normalizeAppExecution(
    app.execution,
    `bootstrap: app "${app.name}" execution`,
  );
  const narrowedRoles = Object.keys(execution.allowedAssignments).sort();
  if (execution.assignmentMode === "fixed" && narrowedRoles.length === 0) return;

  const roles = (await loadRoles(join(orgHome, "roles.yaml"))).roles;
  const roleByName = new Map(roles.map((role) => [role.name, role]));
  const unknownRoles = narrowedRoles.filter((role) => !roleByName.has(role));
  if (unknownRoles.length > 0) {
    throw new Error(
      `bootstrap: app "${app.name}" execution.allowed_assignments references ` +
        `unknown role(s): ${unknownRoles.join(", ")}`,
    );
  }
  for (const roleName of narrowedRoles) {
    resolveApprovedAssignmentCandidates(
      roleByName.get(roleName)!,
      execution.allowedAssignments[roleName],
    );
  }
  if (!roleByName.has("planner")) {
    throw new Error(
      `bootstrap: app "${app.name}" adaptive assignment requires a configured planner boot role`,
    );
  }
}

/** Remove one explicitly named app from the org registry. This is the local
 * half of `cormidia app reset`: a human-authorized lifecycle operation, never an
 * agent action. `parseDocument` retains comments and surrounding hand-edited
 * structure far better than a parse/stringify rewrite; the post-write reload
 * is the same fail-safe contract as registration — on any problem, restore
 * the exact original bytes. */
export async function removeExistingApp(
  orgHomeIn: string,
  appName: string,
): Promise<RemoveExistingAppResult> {
  const orgHome = resolve(orgHomeIn);
  const appsPath = join(orgHome, "apps.yaml");
  const before = await readFile(appsPath, "utf8");
  const file = await loadApps(appsPath);
  const app = file.apps.find((entry) => entry.name === appName);
  if (app === undefined) throw new Error(`app reset: unknown app "${appName}" in ${appsPath}`);

  const document = parseDocument(before);
  if (document.errors.length > 0) {
    throw new Error(
      `app reset: ${appsPath} cannot be edited because it is invalid YAML: ` +
        document.errors.map((error) => error.message).join("; "),
    );
  }
  if (!document.hasIn(["apps", appName])) {
    throw new Error(`app reset: ${appsPath} has no editable apps.${appName} entry`);
  }
  document.deleteIn(["apps", appName]);
  const next = document.toString();
  await writeFileAtomic(appsPath, next);

  try {
    const reloaded = await loadApps(appsPath);
    if (reloaded.apps.some((entry) => entry.name === appName)) {
      throw new Error(`app "${appName}" is still present after removal`);
    }
  } catch (error) {
    await writeFileAtomic(appsPath, before);
    throw new Error(
      `app reset: removing "${appName}" from ${appsPath} produced an invalid registry; ` +
        `rolled back. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { orgHome, appsPath, app };
}

/** Human-invoked lifecycle promotion updates only one existing status scalar.
 * The exact original bytes are restored if the edited registry does not
 * round-trip through the authoritative loader. */
export async function updateAppStatus(
  orgHomeIn: string,
  appName: string,
  status: AppStatus,
): Promise<UpdateAppStatusResult> {
  const orgHome = resolve(orgHomeIn);
  const appsPath = join(orgHome, "apps.yaml");
  const beforeBytes = await readFile(appsPath, "utf8");
  const file = await loadApps(appsPath);
  const app = file.apps.find((entry) => entry.name === appName);
  if (app === undefined) throw new Error(`app promote: unknown app "${appName}" in ${appsPath}`);
  if (app.status === status) return { orgHome, appsPath, before: app.status, after: status, changed: false };
  const document = parseDocument(beforeBytes);
  if (document.errors.length > 0 || !document.hasIn(["apps", appName])) {
    throw new Error(`app promote: ${appsPath} has no valid editable apps.${appName} entry`);
  }
  document.setIn(["apps", appName, "status"], status);
  await writeFileAtomic(appsPath, document.toString());
  try {
    const reloaded = await loadApps(appsPath);
    if (reloaded.apps.find((entry) => entry.name === appName)?.status !== status) {
      throw new Error(`app status did not round-trip as ${status}`);
    }
  } catch (error) {
    await writeFileAtomic(appsPath, beforeBytes);
    throw new Error(`app promote: invalid registry edit rolled back: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { orgHome, appsPath, before: app.status, after: status, changed: true };
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
