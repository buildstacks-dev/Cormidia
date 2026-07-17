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

/** The sensitive risk domains — the ONE keyword set shared with the route
 *  policy's deep floor. `routeDecisionForItem` (src/loop/driver.ts) derives
 *  `sensitiveDomains` from `item.labels` with exactly this alternation
 *  (`/auth|security|secret|privacy|payment|data/`); a ticket carrying a
 *  `domain:<d>` label is what makes `route-policy.ts`'s always-implemented
 *  sensitive-domain floor able to fire. Attaching these labels at publication
 *  is the orchestrator ENCODING the Planner's own risk identification as a
 *  durable label instead of relying on prose that no owner reads (Theme 6). */
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
  { name: "op:tier-quick", color: "c2e0c6", description: "Quick tier: implement only" },
  { name: "op:tier-standard", color: "bfdadc", description: "Standard tier: contract + implement" },
  { name: "op:tier-deep", color: "d4c5f9", description: "Deep tier: full pass set + human sign-off" },
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

/** `issueNumbers[i]` is the created issue for plan ticket i; dependsOn indexes
 *  render as real `Depends-on: #<n>` references the scheduler parses.
 *  `releaseKind` renders as a `Release-kind:` trailer the ship gate reads
 *  back (P7) — undefined omits the line (pre-A4 bodies parse unchanged). */
export function renderTicketBody(
  ticket: PlanTicket,
  issueNumbers: readonly (number | undefined)[],
  releaseKind?: ReleaseKind,
): string {
  const deps = ticket.dependsOn
    .map((dep) => issueNumbers[dep])
    .filter((n): n is number => n !== undefined)
    .map((n) => `Depends-on: #${n}`);
  return [
    ...(deps.length > 0 ? [deps.join("\n"), ""] : []),
    `Execution group: ${ticket.executionGroup}`,
    ...(releaseKind !== undefined ? [`Release-kind: ${releaseKind}`] : []),
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

/** Apply the orchestrator-owned sensitive-domain deep floor to a plan.
 *
 *  A ticket whose own content names a sensitive domain gets descriptive
 *  `domain:<d>` labels AND is floored to `op:tier-deep`, so the route
 *  policy's sensitive-domain floor (`route-policy.ts`) fires: at loop time
 *  `routeDecisionForItem` reads `sensitiveDomains` from these labels and a
 *  deep tier keeps the structured decision consistent (a domain label on a
 *  still-`standard` ticket would make that consistency check throw — the
 *  label and the deep tier are one escalation, applied together).
 *
 *  Bootstrap is the deliberate exception: a greenfield scaffold "with no
 *  users" must not be deep (validatePlan enforces this, P2), so a bootstrap
 *  ticket keeps its tier and takes no domain label — attaching one without
 *  the matching deep tier would break the loop's route consistency check. */
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

// ---------------------------------------------------------------------------
// Publication — orchestrator-owned, validate-all-then-create
// ---------------------------------------------------------------------------

export interface PublishedTicket {
  index: number;
  issueNumber: number;
  title: string;
  ready: boolean;
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
  const validation = validatePlan(plan);
  if (!validation.ok) {
    throw new Error(`publishTickets: plan failed validation:\n- ${validation.problems.join("\n- ")}`);
  }
  for (const label of CANONICAL_LABELS) await gh.ensureLabel(label);

  // Orchestrator-owned sensitive-domain floor: derive domain labels and floor
  // risky tickets to op:tier-deep from the tickets' own content (L0-02). The
  // ticket bodies still render from the original ticket text; only the tier
  // label and the extra domain labels change.
  const publications = applySensitiveDomainFloor(plan);
  const issueNumbers: (number | undefined)[] = plan.tickets.map(() => undefined);
  const published: PublishedTicket[] = [];
  try {
    for (const [index, { ticket, domainLabels }] of publications.entries()) {
      const ready = ticket.dependsOn.length === 0;
      const issue = await gh.createIssue({
        title: ticket.title,
        body: renderTicketBody(ticket, issueNumbers, plan.releaseKind),
        labels: [ticket.tier, ticket.priority, ...domainLabels, ...(ready ? ["op:ready"] : [])],
      });
      issueNumbers[index] = issue.number;
      published.push({ index, issueNumber: issue.number, title: ticket.title, ready });
    }
    // Second pass: tickets whose dependencies were created after them get
    // their real Depends-on references now that every number is known.
    for (const [index, ticket] of plan.tickets.entries()) {
      if (ticket.dependsOn.some((dep) => dep > index)) {
        await gh.updateIssueBody(issueNumbers[index]!, renderTicketBody(ticket, issueNumbers, plan.releaseKind));
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
