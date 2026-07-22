// Ticket-lifetime state from durable artifacts (proportionality campaign
// Stage 2). Every re-claim used to rebuild its loop item from labels alone —
// contract, findings, cycles, and attempt counters reset to zero, so 21
// claims produced 20 identical contract passes. The durable data was on the
// issue the whole time: the contract comment, the structured review verdicts,
// the open PR. This module reads it back so a new process continues at the
// artifact boundary the last one reached, instead of re-deriving it.
//
// Loop layer only: consumes GhOps and plain file paths handed in by the
// caller; never imports src/org.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { isTurnAssignment } from "../runtime/assignment.js";
import type { GhIssueComment, GhOps } from "./github.js";
import type { LoopContinuation, LoopItem } from "./types.js";
import { parseVerdict, type Finding, type FindingResolution } from "./verdicts.js";

// ---------------------------------------------------------------------------
// Durable comment markers
// ---------------------------------------------------------------------------

const CONTRACT_MARKER_PREFIX = "<!-- operon:contract body-sha256:";
export const REVIEW_VERDICT_HEADING = "## Structured review verdict";
export const FIX_RESOLUTIONS_HEADING = "## Fix resolutions";

/** The ticket body is the contract's input; its hash decides whether an
 *  existing contract still applies after a body edit. Normalized so label
 *  churn and trailing-whitespace edits don't invalidate a valid contract. */
export function hashTicketBody(body: string): string {
  return createHash("sha256").update(body.replace(/\r\n/g, "\n").trim(), "utf8").digest("hex");
}

export function contractMarker(bodyHash: string): string {
  return `${CONTRACT_MARKER_PREFIX}${bodyHash} -->`;
}

function contractHashFrom(comment: string): string | undefined {
  const start = comment.indexOf(CONTRACT_MARKER_PREFIX);
  if (start < 0) return undefined;
  const rest = comment.slice(start + CONTRACT_MARKER_PREFIX.length);
  const end = rest.indexOf(" -->");
  return end > 0 ? rest.slice(0, end).trim() : undefined;
}

/** Render the fix pass's per-finding dispositions as a durable issue comment
 *  (the verdict itself only lives in the run log). */
export function renderFixResolutionsComment(resolutions: readonly FindingResolution[]): string {
  const lines = resolutions.map((r) => `- ${r.outcome} ${r.location} -- ${r.note}`);
  return `${FIX_RESOLUTIONS_HEADING}\n\n${lines.join("\n")}`;
}

const RESOLUTION_COMMENT_LINE = /^\s*-\s+(fixed|rebutted)\s+(\S+)\s+(?:--|—)\s+(.+?)\s*$/i;

function parseResolutionsComment(body: string): FindingResolution[] {
  const resolutions: FindingResolution[] = [];
  for (const line of body.split("\n")) {
    const match = RESOLUTION_COMMENT_LINE.exec(line);
    if (match === null) continue;
    resolutions.push({
      outcome: match[1]!.toLowerCase() as FindingResolution["outcome"],
      location: match[2]!,
      note: match[3]!,
    });
  }
  return resolutions;
}

// ---------------------------------------------------------------------------
// Findings ledger
// ---------------------------------------------------------------------------

/** Ledger identity for a finding: category + location. Descriptions get
 *  reworded between rounds; the place and kind of defect do not. */
function findingKey(finding: Pick<Finding, "category" | "location">): string {
  return `${finding.category} ${finding.location}`;
}

/** Merge every review round's findings into the open set, honoring later
 *  fix-pass resolutions. Chronological semantics (comments arrive oldest
 *  first): a resolution closes every earlier raise of that location; a review
 *  round re-raising it later REOPENS it. A finding a later round silently
 *  dropped stays open — that silence is exactly the failure mode this ledger
 *  exists to prevent (the episode's pin-the-actions finding vanished after
 *  round one and never got fixed). */
export function openFindings(
  events: readonly ({ kind: "raise"; findings: Finding[] } | { kind: "resolve"; resolutions: FindingResolution[] })[],
): Finding[] {
  const open = new Map<string, Finding>();
  for (const event of events) {
    if (event.kind === "raise") {
      for (const finding of event.findings) open.set(findingKey(finding), finding);
    } else {
      for (const resolution of event.resolutions) {
        for (const [key, finding] of open) {
          if (finding.location === resolution.location) open.delete(key);
        }
      }
    }
  }
  return [...open.values()];
}

// ---------------------------------------------------------------------------
// Rehydration
// ---------------------------------------------------------------------------

export interface RehydratedState {
  /** The still-applicable contract comment text, when one exists. */
  contract?: string;
  /** Findings raised by any review round and not yet fixed/rebutted. */
  findings: Finding[];
  /** Review rounds already spent (structured verdict comments posted). */
  cycles: number;
  /** The ticket's open PR, when one exists for its branch. */
  prNumber?: number;
}

export interface RehydrateOptions {
  gh: GhOps;
  /** Branch the loop derives for this ticket (branchNameForIssue). */
  branch: string;
}

/** Read the ticket's durable artifacts back into loop-item state. Network
 *  errors are the caller's to see — rehydration failing silently would
 *  recreate the blank-slate behavior it exists to fix. */
export async function rehydrateTicketState(
  item: Pick<LoopItem, "issueNumber" | "body">,
  options: RehydrateOptions,
): Promise<RehydratedState> {
  const comments = await options.gh.listIssueComments(item.issueNumber);
  const state: RehydratedState = { findings: [], cycles: 0 };

  const bodyHash = hashTicketBody(item.body);
  const ledger: Parameters<typeof openFindings>[0][number][] = [];
  for (const comment of comments) {
    const contractHash = contractHashFrom(comment.body);
    if (contractHash !== undefined) {
      // Latest contract wins; it applies only while the body it was derived
      // from is unchanged. A stale contract is re-derived, never reused.
      if (contractHash === bodyHash) state.contract = comment.body;
      else delete state.contract;
      continue;
    }
    if (comment.body.startsWith(REVIEW_VERDICT_HEADING)) {
      state.cycles += 1;
      const parsed = parseVerdict("review", verdictSection(comment.body));
      if (parsed.ok) ledger.push({ kind: "raise", findings: parsed.verdict.findings });
      continue;
    }
    if (comment.body.startsWith(FIX_RESOLUTIONS_HEADING)) {
      ledger.push({ kind: "resolve", resolutions: parseResolutionsComment(comment.body) });
    }
  }
  state.findings = openFindings(ledger);

  const openPrs = await options.gh.listPRsForBranch(options.branch, { state: "open" });
  if (openPrs.length > 0) state.prNumber = openPrs[0]!.number;
  return state;
}

function verdictSection(commentBody: string): string {
  return commentBody.slice(REVIEW_VERDICT_HEADING.length);
}

// ---------------------------------------------------------------------------
// Claim-attempt accounting (parked-after-N)
// ---------------------------------------------------------------------------

export interface TicketClaimState {
  claims: number;
  lastClaimAt?: string;
  outcomes: string[];
  /** Absolute claim allowance after an explicit human re-arm. Absent means
   * the route-policy default remains authoritative. */
  claimAllowance?: number;
  active?: {
    claimId: string;
    claimNumber: number;
    ownerPid: number;
    acquiredAt: string;
    phase: "acquiring" | "claimed" | "provider_started";
    resume: boolean;
    providerStartedAt?: string;
  };
  continuation?: LoopContinuation & {
    status: "waiting_approval" | "ready";
    claimNumber: number;
    pauseCount: number;
    pauseCostUsd: number;
  };
  rearms?: TicketRearmRecord[];
  events?: TicketClaimEvent[];
}

export interface TicketRearmRecord {
  rearmId: string;
  app: string;
  issueNumber: number;
  reason: string;
  actor: string;
  priorAllowance: number;
  intendedAllowance: number;
  priorLabel: string;
  status: "prepared" | "completed";
  preparedAt: string;
  completedAt?: string;
}

export interface TicketClaimEvent {
  at: string;
  kind:
    | "claim_acquired"
    | "provider_started"
    | "approval_paused"
    | "approval_resumed"
    | "automatic_recovery"
    | "manual_rearm"
    | "claim_terminal";
  claimNumber: number;
  detail: string;
  costUsd?: number;
  repeatedCostUsd?: number;
}

export interface TicketClaimStateEntry {
  app: string;
  issueNumber: number;
  state: TicketClaimState;
}

/** `<runlogRoot>/tickets/<app>/<issue>.json` — the only cross-claim counter
 *  in the system. Everything else resets per turn by design; this must not,
 *  or nothing ever says "this ticket has bounced N times; stop and summon
 *  the human" (the episode's human performed all 20 re-arms by hand). */
export function ticketStatePath(runlogRoot: string, app: string, issueNumber: number): string {
  return join(runlogRoot, "tickets", app, `${issueNumber}.json`);
}

export function readTicketClaimState(
  runlogRoot: string,
  app: string,
  issueNumber: number,
): TicketClaimState {
  const path = ticketStatePath(runlogRoot, app, issueNumber);
  if (!existsSync(path)) return { claims: 0, outcomes: [] };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<TicketClaimState>;
    return {
      claims: typeof raw.claims === "number" ? raw.claims : 0,
      ...(typeof raw.lastClaimAt === "string" ? { lastClaimAt: raw.lastClaimAt } : {}),
      outcomes: Array.isArray(raw.outcomes) ? raw.outcomes.map(String) : [],
      ...(typeof raw.claimAllowance === "number" && Number.isInteger(raw.claimAllowance)
        ? { claimAllowance: raw.claimAllowance }
        : {}),
      ...(validActiveClaim(raw.active) ? { active: raw.active } : {}),
      ...(validContinuation(raw.continuation) ? { continuation: raw.continuation } : {}),
      ...(Array.isArray(raw.rearms) ? { rearms: raw.rearms.filter(validRearm) } : {}),
      ...(Array.isArray(raw.events) ? { events: raw.events.filter(validClaimEvent) } : {}),
    };
  } catch (error) {
    // Claim allowance is a safety/accounting boundary. Treating corrupt state
    // as zero silently loses attempts and can repeat paid work; fail closed
    // with an actionable path while atomic writes prevent new torn files.
    throw new Error(
      `ticket claim state is unreadable at ${path}; restore or explicitly archive it before re-arming`,
      { cause: error },
    );
  }
}

export function writeTicketClaimState(
  runlogRoot: string,
  app: string,
  issueNumber: number,
  state: TicketClaimState,
): void {
  const path = ticketStatePath(runlogRoot, app, issueNumber);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 12)}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

/** Diagnostic enumeration for `operon status`. Ticket state remains the
 * source of truth; this adds no index or second store. Corrupt files stay out
 * of the projection rather than being rewritten by a read-only command. */
export function listTicketClaimStates(runlogRoot: string, app?: string): TicketClaimStateEntry[] {
  const root = join(runlogRoot, "tickets");
  if (!existsSync(root)) return [];
  const apps = app === undefined ? readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : [app];
  const entries: TicketClaimStateEntry[] = [];
  for (const appName of apps.sort()) {
    const dir = join(root, appName);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((name) => /^\d+\.json$/.test(name)).sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)))) {
      const issueNumber = Number(file.slice(0, -5));
      try {
        entries.push({ app: appName, issueNumber, state: readTicketClaimState(runlogRoot, appName, issueNumber) });
      } catch {
        // Read-only diagnostics never mutate corrupt state. The owning command
        // fails closed when it targets this ticket; status simply omits it.
      }
    }
  }
  return entries;
}

function validActiveClaim(value: unknown): value is NonNullable<TicketClaimState["active"]> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const active = value as NonNullable<TicketClaimState["active"]>;
  return typeof active.claimId === "string" && Number.isInteger(active.claimNumber) &&
    Number.isInteger(active.ownerPid) && typeof active.acquiredAt === "string" &&
    ["acquiring", "claimed", "provider_started"].includes(active.phase) && typeof active.resume === "boolean";
}

function validContinuation(value: unknown): value is NonNullable<TicketClaimState["continuation"]> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const continuation = value as NonNullable<TicketClaimState["continuation"]>;
  const planIdentityValid =
    (continuation.planVersion === undefined && continuation.planStepId === undefined) ||
    (Number.isInteger(continuation.planVersion) &&
      (continuation.planVersion ?? 0) > 0 &&
      typeof continuation.planStepId === "string" &&
      continuation.planStepId.length > 0);
  return typeof continuation.pipeline === "string" && typeof continuation.pass === "string" &&
    typeof continuation.role === "string" && continuation.session !== undefined &&
    (continuation.assignment === undefined || isTurnAssignment(continuation.assignment)) &&
    planIdentityValid &&
    typeof continuation.session.id === "string" && ["claude", "codex", "pi"].includes(continuation.session.runtime) &&
    Array.isArray(continuation.completedPasses) && typeof continuation.contextFingerprint === "string" &&
    typeof continuation.runId === "string" && typeof continuation.pausedAt === "string" &&
    Array.isArray(continuation.decisions) && ["waiting_approval", "ready"].includes(continuation.status) &&
    Number.isInteger(continuation.claimNumber) && Number.isInteger(continuation.pauseCount) &&
    typeof continuation.pauseCostUsd === "number";
}

function validRearm(value: unknown): value is TicketRearmRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as TicketRearmRecord;
  return typeof record.rearmId === "string" && typeof record.app === "string" &&
    Number.isInteger(record.issueNumber) && typeof record.reason === "string" &&
    typeof record.actor === "string" && Number.isInteger(record.priorAllowance) &&
    Number.isInteger(record.intendedAllowance) && typeof record.priorLabel === "string" &&
    ["prepared", "completed"].includes(record.status) && typeof record.preparedAt === "string";
}

function validClaimEvent(value: unknown): value is TicketClaimEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as TicketClaimEvent;
  return typeof event.at === "string" && typeof event.kind === "string" &&
    Number.isInteger(event.claimNumber) && typeof event.detail === "string";
}

/** The parked-ticket digest: the assembled evidence a human needs to decide,
 *  instead of a bare label flip and a scroll through 80 label transitions. */
export function parkedDigestComment(input: {
  app: string;
  issueNumber: number;
  claims: number;
  maxClaims: number;
  outcomes: readonly string[];
  prNumber?: number;
  openFindings: readonly Finding[];
  hasContract: boolean;
}): string {
  const command =
    `operon loop rearm --app ${input.app} --ticket ${input.issueNumber} ` +
    `--reason <reason> --actor <actor> --from-allowance ${input.maxClaims} ` +
    `--to-allowance ${input.maxClaims + 1} --execute --confirm ${input.app}#${input.issueNumber}`;
  const lines = [
    `## Parked after ${input.claims} claims`,
    "",
    `This ticket has been claimed ${input.claims} times (cap ${input.maxClaims}) without merging.`,
    "The loop will not claim it again until a human reviews this digest and uses the durable re-arm command",
    `(a label-only \`op:ready\` change does not raise the claim allowance):`,
    "",
    `\`${command}\``,
    "",
    "**Prior claim outcomes:**",
    ...(input.outcomes.length > 0 ? input.outcomes.map((o) => `- ${o}`) : ["- (none recorded)"]),
    "",
    `**Contract:** ${input.hasContract ? "derived and still applicable" : "none applicable"}`,
    `**Open PR:** ${input.prNumber !== undefined ? `#${input.prNumber}` : "none"}`,
    `**Open findings:** ${input.openFindings.length}`,
    ...input.openFindings.map(
      (f) => `- ${f.category}/${f.severity} ${f.location} — ${f.description}`,
    ),
  ];
  return lines.join("\n");
}
