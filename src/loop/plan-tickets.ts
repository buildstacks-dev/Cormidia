// Schema-validated, orchestrator-published planning tickets (Stage 4 of
// docs/proportionality-review.md). The 2026-07-10 episode's Planner invented
// a label taxonomy the loop does not implement, wiped 19 issue bodies with an
// agent-authored shell loop, and produced a 19-ticket serial graph for a
// personal website. Under this module the Planner emits a typed plan; the
// ORCHESTRATOR validates it against the loop's own label contract and a
// stage-based ticket budget, renders bodies the loop can parse, and publishes
// them — no agent-authored `gh` side effects, no invented taxonomy, and never
// decomposition for its own sake (P1/P2).

import type { GhOps } from "./github.js";
import { RELEASE_KINDS, type ReleaseKind } from "./types.js";

// ---------------------------------------------------------------------------
// The label contract — the ONE list the Planner prompt, publication, setup
// scripts, and the loop share. The loop's parsers already key off these.
// ---------------------------------------------------------------------------

export const STATE_LABELS = ["op:ready", "op:building", "op:in-review", "op:returned", "op:blocked"] as const;
export const TIER_LABELS = ["op:tier-quick", "op:tier-standard", "op:tier-deep"] as const;
export const PRIORITY_LABELS = ["p1", "p2", "p3"] as const;

export type TierLabel = (typeof TIER_LABELS)[number];
export type PriorityLabel = (typeof PRIORITY_LABELS)[number];

/** Sensitive risk domains retained in published ticket metadata. These labels
 *  remain useful to historical readers and the non-authoritative legacy route
 *  projection, but live workflow/safety authority comes from the validated
 *  EpisodePlan. Attaching them still preserves the Planner's risk signal as
 *  durable structured evidence instead of unowned prose (Theme 6). */
export const SENSITIVE_DOMAINS = ["auth", "security", "secret", "privacy", "payment", "data"] as const;
export type SensitiveDomain = (typeof SENSITIVE_DOMAINS)[number];

/** The published label for a sensitive domain. The name deliberately contains
 *  the bare keyword so the route policy's `/auth|.../` regex matches it. */
export function domainLabelName(domain: SensitiveDomain): string {
  return `domain:${domain}`;
}

/** Labels publication guarantees exist on the target repo before any issue
 *  is created — the episode's first claim failed because `op:building` did
 *  not exist. */
export const CANONICAL_LABELS: readonly { name: string; color: string; description: string }[] = [
  { name: "op:ready", color: "0e8a16", description: "Ready for the build loop to claim" },
  { name: "op:building", color: "fbca04", description: "Claimed by a build turn" },
  { name: "op:in-review", color: "1d76db", description: "PR open, review in progress" },
  { name: "op:returned", color: "d93f0b", description: "Returned for human/planner triage" },
  { name: "op:blocked", color: "b60205", description: "Waiting on a critical-op approval" },
  { name: "op:tier-quick", color: "c2e0c6", description: "Derived quick reporting/safety label" },
  { name: "op:tier-standard", color: "bfdadc", description: "Derived standard reporting/safety label" },
  { name: "op:tier-deep", color: "d4c5f9", description: "Derived deep reporting/safety label" },
  { name: "p1", color: "e11d21", description: "Priority 1" },
  { name: "p2", color: "eb6420", description: "Priority 2" },
  { name: "p3", color: "fef2c0", description: "Priority 3" },
  // Sensitive-domain labels — attached by the orchestrator when a ticket's own
  // content names a risk domain, so the route policy's sensitive-domain deep
  // floor can fire (see SENSITIVE_DOMAINS / applySensitiveDomainFloor).
  { name: "domain:auth", color: "5319e7", description: "Touches authn/authz surfaces" },
  { name: "domain:security", color: "5319e7", description: "Touches security-sensitive surfaces" },
  { name: "domain:secret", color: "5319e7", description: "Touches secret/credential handling" },
  { name: "domain:privacy", color: "5319e7", description: "Touches privacy-sensitive handling" },
  { name: "domain:payment", color: "5319e7", description: "Touches payment surfaces" },
  { name: "domain:data", color: "5319e7", description: "Touches user-data storage/handling" },
];

// ---------------------------------------------------------------------------
// Plan shape — the Planner's structured output
// ---------------------------------------------------------------------------

export type ProjectStage = "bootstrap" | "growth" | "mature";

export interface PlanTicket {
  title: string;
  tier: TierLabel;
  priority: PriorityLabel;
  /** Zero-based indexes into the plan's own ticket list. */
  dependsOn: number[];
  executionGroup: string;
  fileScope: string[];
  goal: string;
  context: string;
  acceptanceCriteria: string[];
  outOfScope: string;
  notesForBuilder: string;
}

export interface TicketPlan {
  stage: ProjectStage;
  /** P2: a plan must argue its own size — "why this many tickets". */
  ticketCountRationale: string;
  /** P7: every milestone names its release disposition and owner. */
  releaseDisposition: string;
  /** P7, machine-readable half (docs/approval-and-release-amendment.md A4):
   *  what the milestone requires at ship time. Rendered into every ticket
   *  body as a `Release-kind:` trailer; the ship gate cross-checks it
   *  against the app's declared `release:` mechanism. */
  releaseKind: ReleaseKind;
  tickets: PlanTicket[];
}

/** Orchestrator-owned provenance appended to every emitted ticket. Source
 * content never enters GitHub; only the content-bound ref/hash and exact
 * inclusion disposition cross the publication boundary. */
export interface PlanningSourceTicketEvidence {
  manifestSha256: string;
  sources: Array<{
    canonicalRef: string;
    sourceSha256: string;
    sourceBytes: number;
    includedBytes: number;
    inclusion: "full" | "truncated";
    trust: string;
  }>;
}

/** Stage-based ticket budgets (P1/P2): the smallest independently shippable
 *  milestone. A bootstrap is ONE observable milestone — the episode turned a
 *  personal website into 19 serial tickets gated on a foundation ticket that
 *  forbade product output. */
export const TICKET_BUDGETS: Record<ProjectStage, number> = {
  bootstrap: 3,
  growth: 5,
  mature: 7,
};

/** JSON schema for adapters with native structured output (TurnRequest.verdictSchema). */
export const PLAN_SCHEMA: Record<string, unknown> = {
  title: "TicketPlan",
  type: "object",
  required: ["stage", "ticketCountRationale", "releaseDisposition", "releaseKind", "tickets"],
  additionalProperties: false,
  properties: {
    stage: { type: "string", enum: ["bootstrap", "growth", "mature"] },
    ticketCountRationale: { type: "string" },
    releaseDisposition: { type: "string" },
    releaseKind: { type: "string", enum: [...RELEASE_KINDS] },
    tickets: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: [
          "title",
          "tier",
          "priority",
          "dependsOn",
          "executionGroup",
          "fileScope",
          "goal",
          "context",
          "acceptanceCriteria",
          "outOfScope",
          "notesForBuilder",
        ],
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          tier: { type: "string", enum: [...TIER_LABELS] },
          priority: { type: "string", enum: [...PRIORITY_LABELS] },
          dependsOn: { type: "array", items: { type: "integer", minimum: 0 } },
          executionGroup: { type: "string" },
          fileScope: { type: "array", items: { type: "string" } },
          goal: { type: "string" },
          context: { type: "string" },
          acceptanceCriteria: { type: "array", minItems: 1, items: { type: "string" } },
          outOfScope: { type: "string" },
          notesForBuilder: { type: "string" },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Validation — ALL of it before ANY GitHub mutation (transactional publication)
// ---------------------------------------------------------------------------

export interface PlanValidation {
  ok: boolean;
  problems: string[];
}

export function validatePlan(plan: TicketPlan): PlanValidation {
  const problems: string[] = [];
  const budget = TICKET_BUDGETS[plan.stage];
  if (plan.tickets.length === 0) problems.push("plan has no tickets");
  if (plan.tickets.length > budget) {
    problems.push(
      `${plan.tickets.length} tickets exceed the ${plan.stage} budget of ${budget} — ` +
        `decompose less, not more (P1); more requires explicit human ratification, not a bigger plan`,
    );
  }
  if (plan.ticketCountRationale.trim().length === 0) {
    problems.push("ticketCountRationale is empty — a plan must argue its own size (P2)");
  }
  if (plan.releaseDisposition.trim().length === 0) {
    problems.push("releaseDisposition is empty — every milestone names what ships and who owns it (P7)");
  }
  if (!RELEASE_KINDS.includes(plan.releaseKind)) {
    problems.push(
      `releaseKind "${String(plan.releaseKind)}" is not one of ${RELEASE_KINDS.join("/")} — ` +
        "the ship gate needs the machine-readable half of the disposition (P7)",
    );
  }
  if (plan.stage === "bootstrap" && plan.tickets.some((t) => t.tier === "op:tier-deep")) {
    problems.push(
      "bootstrap tickets must not be op:tier-deep — deep is for auth/payments/data-loss surfaces, " +
        "not a greenfield scaffold with no users (P2)",
    );
  }

  plan.tickets.forEach((ticket, index) => {
    const at = `ticket ${index} ("${ticket.title.slice(0, 40)}")`;
    if (ticket.title.trim().length === 0) problems.push(`${at}: empty title`);
    if (ticket.goal.trim().length === 0) problems.push(`${at}: empty goal`);
    if (ticket.acceptanceCriteria.length === 0) problems.push(`${at}: no acceptance criteria`);
    for (const criterion of ticket.acceptanceCriteria) {
      if (/^(works|improved|clean|reasonable)\.?$/i.test(criterion.trim())) {
        problems.push(`${at}: criterion "${criterion}" is not mechanically checkable`);
      }
    }
    for (const dep of ticket.dependsOn) {
      if (!Number.isInteger(dep) || dep < 0 || dep >= plan.tickets.length) {
        problems.push(`${at}: dependsOn index ${dep} is out of range`);
      }
      if (dep === index) problems.push(`${at}: depends on itself`);
    }
  });

  // A fully serial graph re-creates the episode's zero-yield day: at least
  // one ticket must be immediately startable, and a bootstrap milestone must
  // not gate everything behind one foundation ticket.
  const rootCount = plan.tickets.filter((t) => t.dependsOn.length === 0).length;
  if (plan.tickets.length > 0 && rootCount === 0) {
    problems.push("no dependency-free ticket — nothing could ever be claimed");
  }

  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Rendering — bodies the loop's own parsers read back
// ---------------------------------------------------------------------------

/** Durable causal identity of the planning execution that authored a ticket.
 *  Stamped into every published body as a `Planned-by:` trailer so the build
 *  episode the ticket later becomes can be joined back to the planning episode
 *  that created it — from the ticket body alone, after every local retention
 *  sweep (#128). The ids are the planner's episode/run/trace identities as the
 *  runlog recorded them. */
export interface PlanProvenance {
  episodeId: string;
  runId: string;
  traceId: string;
}

/** `issueNumbers[i]` is the created issue for plan ticket i; dependsOn indexes
 *  render as real `Depends-on: #<n>` references the scheduler parses.
 *  `releaseKind` renders as a `Release-kind:` trailer the ship gate reads
 *  back (P7) — undefined omits the line (pre-A4 bodies parse unchanged).
 *  `provenance` renders as a `Planned-by:` trailer (#128) — undefined omits
 *  the line (pre-provenance bodies parse unchanged). */
export function renderTicketBody(
  ticket: PlanTicket,
  issueNumbers: readonly (number | undefined)[],
  releaseKind?: ReleaseKind,
  planningSources?: PlanningSourceTicketEvidence,
  provenance?: PlanProvenance,
): string {
  const deps = ticket.dependsOn
    .map((dep) => issueNumbers[dep])
    .filter((n): n is number => n !== undefined)
    .map((n) => `Depends-on: #${n}`);
  return [
    ...(deps.length > 0 ? [deps.join("\n"), ""] : []),
    `Execution group: ${ticket.executionGroup}`,
    ...(releaseKind !== undefined ? [`Release-kind: ${releaseKind}`] : []),
    ...(provenance !== undefined
      ? [
          `Planned-by: episode=${encodeProvenanceId(provenance.episodeId)} ` +
            `run=${encodeProvenanceId(provenance.runId)} trace=${encodeProvenanceId(provenance.traceId)}`,
        ]
      : []),
    "",
    "## Goal",
    ticket.goal,
    "",
    "## Context",
    ticket.context,
    "",
    "## Acceptance criteria",
    ...ticket.acceptanceCriteria.map((criterion) => `- [ ] ${criterion}`),
    "",
    "## Scope",
    ...ticket.fileScope.map((path) => `- ${path}`),
    "",
    "## Out of scope",
    ticket.outOfScope,
    "",
    "## Notes for the builder",
    ticket.notesForBuilder,
    "",
    ...(planningSources !== undefined && planningSources.sources.length > 0
      ? [
          "## Planning sources consumed",
          `Manifest SHA-256: ${planningSources.manifestSha256}`,
          ...planningSources.sources.map(
            (source) =>
              `- \`${source.canonicalRef}\` — SHA-256 ${source.sourceSha256}; ` +
              `${source.includedBytes}/${source.sourceBytes} bytes; ${source.inclusion}; ${source.trust}`,
          ),
          "",
        ]
      : []),
  ].join("\n");
}

/** Read the `Release-kind:` trailer back from a published ticket body.
 *  Absent or unrecognized → undefined: pre-A4 tickets carry no release
 *  requirement, so the ship gate imposes none (back-compatible). */
export function parseReleaseKind(body: string): ReleaseKind | undefined {
  const match = /^Release-kind:\s*(\S+)\s*$/m.exec(body);
  const candidate = match?.[1];
  return RELEASE_KINDS.find((kind) => kind === candidate);
}

/** Minimal escaping so the space-delimited trailer round-trips ANY id:
 *  app names are unvalidated and embedded in episode/trace ids, so an app
 *  named "my app" must not render a trailer its own parser can never read
 *  back. Only `%` and whitespace are escaped — ordinary ids stay
 *  byte-identical. */
function encodeProvenanceId(id: string): string {
  return id.replace(/[%\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

/** Read the `Planned-by:` trailer back from a published ticket body (#128).
 *  Absent or malformed → undefined: pre-provenance tickets carry no planning
 *  identity, and a consumer must treat that as "unknown", never guess.
 *
 *  Only the HEADER block (before the first `## ` section) is searched:
 *  everything from `## Goal` on is planner-authored prose, and a
 *  trailer-shaped line inside it must not read back as provenance. The
 *  trailer is advisory, not authenticated — a GitHub body is editable by any
 *  repo writer, so the trusted half of the edge is the local
 *  published-tickets record, which this trailer merely cross-checks. */
export function parsePlannedBy(body: string): PlanProvenance | undefined {
  const header = body.split(/^## /m, 1)[0] ?? body;
  const match = /^Planned-by:\s*episode=(\S+)\s+run=(\S+)\s+trace=(\S+)\s*$/m.exec(header);
  if (match === null) return undefined;
  try {
    return {
      episodeId: decodeURIComponent(match[1]!),
      runId: decodeURIComponent(match[2]!),
      traceId: decodeURIComponent(match[3]!),
    };
  } catch {
    return undefined; // stray malformed %-escape → unknown, never a guess
  }
}

// ---------------------------------------------------------------------------
// Sensitive-domain deep floor — orchestrator-owned (L0-02 / Theme 6)
// ---------------------------------------------------------------------------

/** Per-domain match: the domain's real inflections as whole WORDS, so a
 *  generic term does not match inside an unrelated compound. Two failure modes
 *  are guarded against at once (L0-02, both directions):
 *
 *  Over-escalation (a raw substring floored ordinary work): `data` matched
 *  `database`, `metadata`, `dataset`, and every `data model` / `src/data/**`
 *  path. Word boundaries drop `database`/`metadata`/`dataset`, and the `data`
 *  pattern additionally excludes the technical compound `data model(s)` (a
 *  schema, not user-data handling) while still matching `user data`,
 *  `personal data`, `user-data`, etc.
 *
 *  Under-escalation (a too-strict `\bword\b` stem MISSED the dominant sensitive
 *  phrasings): a bare `\bauth\b` matched only the rare token "auth" and skipped
 *  `authentication`/`authorization`/`OAuth`; `\bsecret\b` skipped plural
 *  `secrets`; `\bpayment\b` skipped `payments`; `\bsecurity\b` skipped
 *  `secure`. Silently skipping the deep safety floor on genuine auth/secret/
 *  payment work violates "tiering makes the loop cheaper, never LESS safe", so
 *  each stem is a curated per-domain alternation covering the real inflections.
 *  The alternations still exclude the near-miss compounds: `author`/`authored`/
 *  `authoritative` are not `auth`, and `secretary` is not `secret`.
 *
 *  Auth/crypto FILE surfaces stay covered independently by the review
 *  dimension's path match (`dimension_globs.security`) at diff/route time
 *  (L1-05), so scanning prose rather than paths loses no overall signal. Every
 *  MUST-FIRE/MUST-NOT-FIRE row is pinned in `test/loop/plan-tickets.test.ts`. */
const DOMAIN_PATTERNS: Record<SensitiveDomain, RegExp> = {
  auth: /\b(auth|authn|authz|authentication|authenticate|authenticated|authorization|authorize|authorized|oauth)\b/i,
  security: /\b(security|secure|secured|securing)\b/i,
  secret: /\bsecrets?\b/i,
  privacy: /\bprivacy\b/i,
  payment: /\bpayments?\b/i,
  data: /\bdata\b(?!\s+models?\b)/i,
};

/** The sensitive domains a ticket touches, derived from the ticket's OWN
 *  PROSE (title, goal, context, out-of-scope, notes, acceptance) using the
 *  same keyword set the route policy's floor keys on, matched at WORD
 *  boundaries. A match means the work itself is about
 *  auth/security/secrets/privacy/payments/user-data — the Planner already
 *  writes this in prose; this reads it back deterministically so the
 *  orchestrator, not the prose, owns the escalation.
 *
 *  `fileScope` PATHS are deliberately NOT scanned: a path segment like
 *  `src/data/**` is too noisy to floor a whole ticket on, and genuine
 *  auth/crypto file surfaces are already caught by the review dimension's
 *  path match at diff/route time (L1-05). */
export function sensitiveDomainsForTicket(ticket: PlanTicket): SensitiveDomain[] {
  const prose = [
    ticket.title,
    ticket.goal,
    ticket.context,
    ticket.outOfScope,
    ticket.notesForBuilder,
    ...ticket.acceptanceCriteria,
  ]
    .join("\n")
    .toLowerCase();
  return SENSITIVE_DOMAINS.filter((domain) => DOMAIN_PATTERNS[domain].test(prose));
}

/** One ticket's publication shape: its (possibly tier-escalated) ticket plus
 *  the sensitive-domain labels to attach. */
export interface TicketPublication {
  ticket: PlanTicket;
  domainLabels: string[];
}

/** One immutable projection shared by operator output, run evidence, dry/no-
 *  publish results, and GitHub mutation. The Planner's requested tier remains
 *  visible even when the orchestrator raises the published tier. */
export interface FinalTicketProjection {
  index: number;
  ticket: PlanTicket;
  requestedTier: TierLabel;
  finalTier: TierLabel;
  escalationReason?: string;
  domainLabels: string[];
  labels: string[];
  ready: boolean;
}

export interface FinalPlanProjection {
  plan: TicketPlan;
  tickets: FinalTicketProjection[];
}

/** Apply the historical sensitive-domain tier projection to published tickets.
 *
 *  A ticket whose own content names a sensitive domain gets descriptive
 *  `domain:<d>` labels AND is projected as `op:tier-deep`. Historical readers
 *  therefore retain a self-consistent label/tier pair. Live execution does not
 *  derive a route or authorize turns from this projection; EpisodePlan policy
 *  validation owns those decisions.
 *
 *  Bootstrap is the deliberate exception: a greenfield scaffold "with no
 *  users" must not be deep (validatePlan enforces this, P2), so a bootstrap
 *  ticket keeps its tier and takes no domain label. */
export function applySensitiveDomainFloor(plan: TicketPlan): TicketPublication[] {
  return plan.tickets.map((ticket) => {
    const domains = plan.stage === "bootstrap" ? [] : sensitiveDomainsForTicket(ticket);
    if (domains.length === 0) return { ticket, domainLabels: [] };
    return {
      ticket: ticket.tier === "op:tier-deep" ? ticket : { ...ticket, tier: "op:tier-deep" },
      domainLabels: domains.map(domainLabelName),
    };
  });
}

/** Validate and freeze every deterministic publication transform once. */
export function finalizePlanForPublication(plan: TicketPlan): FinalPlanProjection {
  const validation = validatePlan(plan);
  if (!validation.ok) {
    throw new Error(`finalizePlanForPublication: plan failed validation:\n- ${validation.problems.join("\n- ")}`);
  }
  const floored = applySensitiveDomainFloor(plan);
  const tickets = floored.map(({ ticket, domainLabels }, index): FinalTicketProjection => {
    const requestedTier = plan.tickets[index]!.tier;
    const ready = ticket.dependsOn.length === 0;
    return {
      index,
      ticket,
      requestedTier,
      finalTier: ticket.tier,
      ...(requestedTier !== ticket.tier
        ? { escalationReason: `sensitive-domain floor: ${domainLabels.map((label) => label.replace("domain:", "")).join(", ")}` }
        : {}),
      domainLabels,
      labels: [ticket.tier, ticket.priority, ...domainLabels, ...(ready ? ["op:ready"] : [])],
      ready,
    };
  });
  return {
    plan: { ...plan, tickets: tickets.map(({ ticket }) => ticket) },
    tickets,
  };
}

// ---------------------------------------------------------------------------
// Publication — orchestrator-owned, validate-all-then-create
// ---------------------------------------------------------------------------

export interface PublishedTicket {
  index: number;
  issueNumber: number;
  title: string;
  ready: boolean;
  labels: string[];
}

export interface PublishResult {
  published: PublishedTicket[];
}

/** Publish a validated plan: ensure the canonical labels exist, create every
 *  issue (labels: tier + priority; `op:ready` only on dependency-free tickets
 *  — dependency-locked backlog stays stateless until its predecessors merge,
 *  when the merge transition arms it via `rearmDependents`, L-007), then
 *  back-fill real issue numbers into `Depends-on:` references. Throws on the
 *  first GitHub failure — by then all-local validation has already passed, so
 *  a failure is environmental, and everything created so far is reported in
 *  the error for manual reconciliation. */
export async function publishTickets(gh: GhOps, plan: TicketPlan): Promise<PublishResult> {
  return publishPlanProjection(gh, finalizePlanForPublication(plan));
}

/** Publish an already-finalized projection without recomputing any floor or
 *  label transform. This is the boundary runAutoPlan uses after its result
 *  surfaces have consumed the same object. */
export async function publishPlanProjection(
  gh: GhOps,
  projection: FinalPlanProjection,
  planningSources?: PlanningSourceTicketEvidence,
  provenance?: PlanProvenance,
): Promise<PublishResult> {
  for (const label of CANONICAL_LABELS) await gh.ensureLabel(label);

  const issueNumbers: (number | undefined)[] = projection.tickets.map(() => undefined);
  const published: PublishedTicket[] = [];
  try {
    for (const { index, ticket, labels, ready } of projection.tickets) {
      const issue = await gh.createIssue({
        title: ticket.title,
        body: renderTicketBody(ticket, issueNumbers, projection.plan.releaseKind, planningSources, provenance),
        labels,
      });
      issueNumbers[index] = issue.number;
      published.push({ index, issueNumber: issue.number, title: ticket.title, ready, labels: [...labels] });
    }
    // Second pass: tickets whose dependencies were created after them get
    // their real Depends-on references now that every number is known.
    for (const { index, ticket } of projection.tickets) {
      if (ticket.dependsOn.some((dep) => dep > index)) {
        await gh.updateIssueBody(
          issueNumbers[index]!,
          renderTicketBody(ticket, issueNumbers, projection.plan.releaseKind, planningSources, provenance),
        );
      }
    }
  } catch (error) {
    const created = published.map((t) => `#${t.issueNumber} ${t.title}`).join(", ") || "(none)";
    throw new Error(
      `publishTickets: GitHub failed mid-publication after creating ${created} — ` +
        `reconcile manually before re-running (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return { published };
}
