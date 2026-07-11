// Ticket-lifetime state from durable artifacts (proportionality-review §5
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GhIssueComment, GhOps } from "./github.js";
import type { LoopItem } from "./types.js";
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
    };
  } catch {
    // A torn state file must not wedge claiming; it costs one lost count.
    return { claims: 0, outcomes: [] };
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
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** The parked-ticket digest: the assembled evidence a human needs to decide,
 *  instead of a bare label flip and a scroll through 80 label transitions. */
export function parkedDigestComment(input: {
  claims: number;
  maxClaims: number;
  outcomes: readonly string[];
  prNumber?: number;
  openFindings: readonly Finding[];
  hasContract: boolean;
}): string {
  const lines = [
    `## Parked after ${input.claims} claims`,
    "",
    `This ticket has been claimed ${input.claims} times (cap ${input.maxClaims}) without merging.`,
    "The loop will not claim it again until a human reviews this digest and re-arms it",
    "(`op:ready`) or closes it out.",
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
