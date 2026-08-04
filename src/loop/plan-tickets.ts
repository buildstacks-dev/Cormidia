// Schema-validated, orchestrator-published planning tickets (Stage 4 of
// the 2026-07-10 proportionality campaign). The 2026-07-10 episode's Planner invented
// a label taxonomy the loop does not implement, wiped 19 issue bodies with an
// agent-authored shell loop, and produced a 19-ticket serial graph for a
// personal website. Under this module the Planner emits a typed plan; the
// ORCHESTRATOR validates it against the loop's own label contract and a
// stage-based ticket budget, renders bodies the loop can parse, and publishes
// them — no agent-authored `gh` side effects, no invented taxonomy, and never
// decomposition for its own sake (P1/P2).

import { createHash } from "node:crypto";
import { SECRET_PATTERNS } from "../runtime/secret-patterns.js";
import type { GhOps } from "./github.js";
import { RELEASE_KINDS, type ReleaseConfig, type ReleaseKind } from "./types.js";

// ---------------------------------------------------------------------------
// The label contract — the ONE list the Planner prompt, publication, setup
// scripts, and the loop share. The loop's parsers already key off these.
// ---------------------------------------------------------------------------

export const STATE_LABELS = ["op:ready", "op:building", "op:in-review", "op:returned", "op:blocked"] as const;
export const TIER_LABELS = ["op:tier-quick", "op:tier-standard", "op:tier-deep"] as const;
export const PRIORITY_LABELS = ["p1", "p2", "p3"] as const;
/** Durable PR-routing decision. This deliberately does not share the op:*
 * phase namespace: state transitions swap one phase label at a time, while
 * this exclusion must survive every phase and be removable only by a human
 * re-routing the work. */
export const AUTONOMOUS_EXECUTION_EXCLUSION_LABEL = "routing:human-only" as const;

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

export type CanonicalLabelKind = "state" | "tier" | "priority" | "domain" | "routing";

export interface CanonicalLabelDefinition {
  name: string;
  color: string;
  description: string;
  kind: CanonicalLabelKind;
  /** The deterministic actor or boundary that normally attaches the label. */
  appliedBy: string;
  /** The human response expected when the label is visible in GitHub. */
  operatorResponse: string;
}

/** Labels publication guarantees exist on the target repo before any issue
 *  is created — the episode's first claim failed because `op:building` did
 *  not exist. */
export const CANONICAL_LABELS: readonly CanonicalLabelDefinition[] = [
  {
    name: "op:ready",
    color: "0e8a16",
    description: "Ready for the build loop to claim",
    kind: "state",
    appliedBy: "Planner publication, dependency rearming, or the operator's reviewed first issue",
    operatorResponse: "Leave it for the loop to claim; do not add another Cormidia state label",
  },
  {
    name: "op:building",
    color: "fbca04",
    description: "Claimed by a build turn",
    kind: "state",
    appliedBy: "The build loop when it durably claims an op:ready issue",
    operatorResponse: "Inspect the durable run if it stalls; do not manually rearm the label",
  },
  {
    name: "op:in-review",
    color: "1d76db",
    description: "PR open, review in progress",
    kind: "state",
    appliedBy: "The build loop after Builder output and mechanical gates produce a PR",
    operatorResponse: "Let review and ship gates continue; inspect the linked PR if progress stops",
  },
  {
    name: "op:returned",
    color: "d93f0b",
    description: "Returned for human/planner triage",
    kind: "state",
    appliedBy: "The loop after a bounded failure, exhausted correction allowance, or triage finding",
    operatorResponse:
      "Read the retained evidence; use cormidia loop rearm only for a non-terminal episode, or create a new ticket if terminal",
  },
  {
    name: "op:blocked",
    color: "b60205",
    description: "Waiting on a critical-op approval",
    kind: "state",
    appliedBy: "The loop when the exact durable continuation is waiting on critical-op approval",
    operatorResponse: "Review cormidia approvals; do not bypass the decision by editing labels",
  },
  {
    name: AUTONOMOUS_EXECUTION_EXCLUSION_LABEL,
    color: "b60205",
    description: "Excluded from autonomous Planner readiness and Builder claims",
    kind: "routing",
    appliedBy: "A human making the PR-level self-hosting routing decision",
    operatorResponse:
      "Keep the ticket out of the autonomous loop; remove only after a human explicitly re-routes the whole PR scope",
  },
  {
    name: "op:tier-quick",
    color: "c2e0c6",
    description: "Derived quick reporting/safety label",
    kind: "tier",
    appliedBy: "Planner publication after deterministic plan projection",
    operatorResponse: "Treat it as reporting metadata; the accepted EpisodePlan remains workflow authority",
  },
  {
    name: "op:tier-standard",
    color: "bfdadc",
    description: "Derived standard reporting/safety label",
    kind: "tier",
    appliedBy: "Planner publication after deterministic plan projection",
    operatorResponse: "Treat it as reporting metadata; the accepted EpisodePlan remains workflow authority",
  },
  {
    name: "op:tier-deep",
    color: "d4c5f9",
    description: "Derived deep reporting/safety label",
    kind: "tier",
    appliedBy: "Planner publication or the deterministic sensitive-domain floor",
    operatorResponse: "Preserve the risk signal and inspect the EpisodePlan; do not lower it to bypass safeguards",
  },
  {
    name: "p1",
    color: "e11d21",
    description: "Priority 1",
    kind: "priority",
    appliedBy: "Planner publication, or an operator making an explicit priority decision",
    operatorResponse: "Expect selection before eligible p2/p3 work; change only when priority genuinely changes",
  },
  {
    name: "p2",
    color: "eb6420",
    description: "Priority 2",
    kind: "priority",
    appliedBy: "Planner publication, or the generated reviewed first-issue command",
    operatorResponse: "Treat as normal priority and leave ordering to the dependency-aware scheduler",
  },
  {
    name: "p3",
    color: "fef2c0",
    description: "Priority 3",
    kind: "priority",
    appliedBy: "Planner publication, or an operator making an explicit priority decision",
    operatorResponse: "Expect eligible p1/p2 work to run first; raise only with an explicit reprioritization",
  },
  // Sensitive-domain labels — attached by the orchestrator when a ticket's own
  // content names a risk domain, so the route policy's sensitive-domain deep
  // floor can fire (see SENSITIVE_DOMAINS / applySensitiveDomainFloor).
  {
    name: "domain:auth",
    color: "5319e7",
    description: "Touches authn/authz surfaces",
    kind: "domain",
    appliedBy: "Planner publication when the ticket's own content names the auth domain",
    operatorResponse: "Preserve the label and verify the accepted plan covers authentication and authorization risk",
  },
  {
    name: "domain:security",
    color: "5319e7",
    description: "Touches security-sensitive surfaces",
    kind: "domain",
    appliedBy: "Planner publication when the ticket's own content names the security domain",
    operatorResponse: "Preserve the label and verify the accepted plan carries the required security review",
  },
  {
    name: "domain:secret",
    color: "5319e7",
    description: "Touches secret/credential handling",
    kind: "domain",
    appliedBy: "Planner publication when the ticket's own content names the secret domain",
    operatorResponse: "Preserve the label; confirm secret handling and redaction evidence before delivery",
  },
  {
    name: "domain:privacy",
    color: "5319e7",
    description: "Touches privacy-sensitive handling",
    kind: "domain",
    appliedBy: "Planner publication when the ticket's own content names the privacy domain",
    operatorResponse: "Preserve the label; confirm the plan covers privacy constraints and evidence",
  },
  {
    name: "domain:payment",
    color: "5319e7",
    description: "Touches payment surfaces",
    kind: "domain",
    appliedBy: "Planner publication when the ticket's own content names the payment domain",
    operatorResponse: "Preserve the label; confirm payment risk, rollback, and review are represented in the plan",
  },
  {
    name: "domain:data",
    color: "5319e7",
    description: "Touches user-data storage/handling",
    kind: "domain",
    appliedBy: "Planner publication when the ticket's own content names the data domain",
    operatorResponse: "Preserve the label; confirm user-data safety, migration, and rollback facts are covered",
  },
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
  /** P7, machine-readable half (docs/approvals/design.md A4):
   *  what the milestone requires at ship time. Rendered into every ticket
   *  body as a `Release-kind:` trailer; the ship gate cross-checks it
   *  against the app's declared `release:` mechanism. */
  releaseKind: ReleaseKind;
  /** The milestone's release version (`vX.Y.Z`), rendered as a
   *  `Release-version:` trailer. A `trigger: tag` app fixes its deploy tag from
   *  this at merge (the tag must be known when the approval binds), so the
   *  Planner declares it for deployable milestones; command/merge-only
   *  mechanisms ignore it. Optional: the ship gate (P7) enforces its presence
   *  only where the app's mechanism actually needs it. */
  releaseVersion?: string;
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

/** One durable, attributable human decision to admit ONE oversized
 *  decomposition (ENH-011). The refusal below has always prescribed "explicit
 *  human ratification"; this is the shape that decision takes, and
 *  `cormidia plan ratify-ticket-budget` is the verb that records it.
 *
 *  It is deliberately NOT a standing override and NOT a flag that skips the
 *  check. It names the exact stage, the exact ticket count a human read and
 *  accepted, and the content digest of the exact decomposition it was granted
 *  against. A later plan — even one the same planner produced for the same
 *  goal — has a different digest and is refused again. That is what keeps the
 *  ratified path narrower than the dishonest one (`--stage growth`), which
 *  raises the budget for every future plan by falsifying repository maturity. */
export interface TicketBudgetRatification {
  /** Stage whose default budget this decision raises. */
  stage: ProjectStage;
  /** Exact ticket count the human read and accepted. */
  ratifiedTicketCount: number;
  /** `ticketPlanDigest` of the exact decomposition that was read. */
  decompositionId: string;
  /** Who decided. Never inferred, never defaulted. */
  actor: string;
  /** Why. Never inferred, never defaulted. */
  reason: string;
  /** When, as an ISO-8601 instant. */
  ratifiedAt: string;
}

/** Stable content identity of a decomposition — the digest a ratification
 *  binds to. Object key order is canonicalized so a re-serialized identical
 *  plan keeps its identity, while any content change (one ticket, one
 *  acceptance criterion) mints a new one and voids the prior decision. */
export function ticketPlanDigest(plan: TicketPlan): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalPlanValue(plan)), "utf8")
    .digest("hex")
    .slice(0, 24);
}

function canonicalPlanValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalPlanValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalPlanValue(item)]),
    );
  }
  return value;
}

export interface TicketBudgetDecision {
  /** The stage default from TICKET_BUDGETS. */
  stageBudget: number;
  /** The budget actually enforced for this plan. */
  budget: number;
  /** Set when a ratification WAS supplied but does not apply. Fail closed:
   *  the stage default is enforced and the mismatch is reported, never
   *  silently ignored. */
  ratificationProblem?: string;
}

/** Resolve the ticket budget for one plan. This is the ONE place a ratified
 *  budget can raise the stage default, and it only ever does so for the exact
 *  attributable decomposition the ratification names. */
export function decideTicketBudget(
  plan: TicketPlan,
  ratification?: TicketBudgetRatification,
): TicketBudgetDecision {
  const stageBudget = TICKET_BUDGETS[plan.stage];
  if (ratification === undefined) return { stageBudget, budget: stageBudget };
  const digest = ticketPlanDigest(plan);
  const problems: string[] = [];
  if (ratification.stage !== plan.stage) {
    problems.push(
      `ratified stage "${String(ratification.stage)}" is not this plan's stage "${plan.stage}"`,
    );
  }
  if (ratification.decompositionId !== digest) {
    problems.push(
      `ratified decomposition ${ratification.decompositionId} is not this decomposition (${digest})`,
    );
  }
  if (
    !Number.isSafeInteger(ratification.ratifiedTicketCount) ||
    ratification.ratifiedTicketCount < stageBudget
  ) {
    problems.push(
      `ratified ticket count ${String(ratification.ratifiedTicketCount)} is not an integer at or above ` +
        `the ${plan.stage} budget of ${stageBudget}`,
    );
  }
  if (typeof ratification.actor !== "string" || ratification.actor.trim().length === 0) {
    problems.push("ratification names no attributable actor");
  }
  if (typeof ratification.reason !== "string" || ratification.reason.trim().length === 0) {
    problems.push("ratification records no reason");
  }
  if (typeof ratification.ratifiedAt !== "string" || Number.isNaN(Date.parse(ratification.ratifiedAt))) {
    problems.push("ratification records no valid decision time");
  }
  if (problems.length > 0) {
    return { stageBudget, budget: stageBudget, ratificationProblem: problems.join("; ") };
  }
  return { stageBudget, budget: Math.max(stageBudget, ratification.ratifiedTicketCount) };
}

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
    releaseVersion: { type: "string", pattern: "^v?\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$" },
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

/** Validate a plan against its stage budget, or against an exact human
 *  ratification of THIS decomposition when one is supplied. A supplied-but-
 *  inapplicable ratification is itself a problem: it must never silently
 *  degrade into "no ratification". */
export function validatePlan(
  plan: TicketPlan,
  ratification?: TicketBudgetRatification,
): PlanValidation {
  const decision = decideTicketBudget(plan, ratification);
  const problems = planProblems(plan, decision.budget);
  if (decision.ratificationProblem !== undefined) {
    problems.unshift(`ticket-budget ratification does not apply: ${decision.ratificationProblem}`);
  }
  return { ok: problems.length === 0, problems };
}

/** True when the ONLY thing standing between this decomposition and
 *  publication is the stage ticket budget — the exact case
 *  `cormidia plan ratify-ticket-budget` exists for. A plan that is also
 *  structurally invalid is never offered for ratification. */
export function isTicketBudgetOnlyRefusal(plan: TicketPlan): boolean {
  const stageBudget = TICKET_BUDGETS[plan.stage];
  if (plan.tickets.length <= stageBudget) return false;
  return (
    planProblems(plan, stageBudget).length > 0 &&
    planProblems(plan, plan.tickets.length).length === 0
  );
}

function planProblems(plan: TicketPlan, budget: number): string[] {
  const problems: string[] = [];
  if (plan.tickets.length === 0) problems.push("plan has no tickets");
  if (plan.tickets.length > budget) {
    problems.push(
      `${plan.tickets.length} tickets exceed the ${plan.stage} budget of ${budget} — ` +
        "decompose less, not more (P1); more requires explicit human ratification of this exact " +
        "decomposition (cormidia plan ratify-ticket-budget), not a bigger plan and not a falsified --stage",
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
  if (plan.releaseVersion !== undefined && !RELEASE_VERSION_RE.test(plan.releaseVersion)) {
    problems.push(
      `releaseVersion "${String(plan.releaseVersion)}" is not a vX.Y.Z version — a tag ` +
        "release fixes its git tag from this, so it must be a concrete semver (P7)",
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
  if (planHasDependencyCycle(plan.tickets)) {
    problems.push("ticket dependency graph contains a cycle — TicketPlan must be a DAG");
  }

  return problems;
}

function planHasDependencyCycle(tickets: readonly PlanTicket[]): boolean {
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (index: number): boolean => {
    if (visiting.has(index)) return true;
    if (visited.has(index)) return false;
    visiting.add(index);
    for (const dependency of tickets[index]?.dependsOn ?? []) {
      if (dependency >= 0 && dependency < tickets.length && visit(dependency)) return true;
    }
    visiting.delete(index);
    visited.add(index);
    return false;
  };
  return tickets.some((_, index) => visit(index));
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
  releaseVersion?: string,
  planningSources?: PlanningSourceTicketEvidence,
  provenance?: PlanProvenance,
  publicationIndex?: number,
): string {
  const deps = ticket.dependsOn
    .map((dep) => issueNumbers[dep])
    .filter((n): n is number => n !== undefined)
    .map((n) => `Depends-on: #${n}`);
  return [
    ...(deps.length > 0 ? [deps.join("\n"), ""] : []),
    `Execution group: ${ticket.executionGroup}`,
    ...(releaseKind !== undefined ? [`Release-kind: ${releaseKind}`] : []),
    ...(releaseVersion !== undefined ? [`Release-version: ${releaseVersion}`] : []),
    ...(provenance !== undefined
      ? [
          `Planned-by: episode=${encodeProvenanceId(provenance.episodeId)} ` +
            `run=${encodeProvenanceId(provenance.runId)} trace=${encodeProvenanceId(provenance.traceId)}`,
        ]
      : []),
    ...(publicationIndex === undefined ? [] : [`Plan-ticket-index: ${publicationIndex}`]),
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

/** A milestone's declared release version, validated to a strict `vX.Y.Z`
 *  (optionally a `-prerelease`) shape. The strictness is load-bearing: the
 *  value is interpolated into the git tag command Cormidia runs, so anything
 *  outside this character set (which cannot carry shell metacharacters) is
 *  rejected — a malformed version yields no release rather than an injection. */
const RELEASE_VERSION_RE = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function parseReleaseVersion(body: string): string | undefined {
  const match = /^Release-version:\s*(\S+)\s*$/m.exec(body);
  const candidate = match?.[1];
  return candidate !== undefined && RELEASE_VERSION_RE.test(candidate) ? candidate : undefined;
}

/** Normalize a declared version to its `vX.Y.Z` git-tag form. */
export function releaseTagFor(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

/** The executable release command for an app's mechanism given a merged
 *  ticket body, or `undefined` when nothing runs after merge: `merge-only`,
 *  or a `tag` mechanism whose milestone declared no valid `Release-version`.
 *  For `trigger: tag` Cormidia derives a git tag push (there is no app-declared
 *  command); for `command`/legacy it is the app's declared command. Both the
 *  loop (which queues the release) and crash-restore (which re-validates the
 *  durable trigger) resolve the command here so their fingerprints match. */
export function resolveReleaseCommand(release: ReleaseConfig, body: string): string | undefined {
  if (release.kind === "merge-only") return undefined;
  if (release.trigger === "tag") {
    const version = parseReleaseVersion(body);
    if (version === undefined) return undefined;
    const tag = releaseTagFor(version);
    return `git tag ${tag} -m "release ${tag}" && git push origin refs/tags/${tag}`;
  }
  return release.command;
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

/** Deterministic per-plan ticket identity used only with `Planned-by` to
 * reconcile a crash after GitHub accepted an issue create but before the
 * local published-tickets record committed. A bare index is never trusted. */
export function parsePlanTicketIndex(body: string): number | undefined {
  const header = body.split(/^## /m, 1)[0] ?? body;
  const matches = [...header.matchAll(/^Plan-ticket-index:\s*(\d+)\s*$/gm)];
  if (matches.length !== 1) return undefined;
  const index = Number(matches[0]![1]);
  return Number.isSafeInteger(index) ? index : undefined;
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

/** Validate and freeze every deterministic publication transform once. An
 *  exact `ratification` is the only way an oversized decomposition reaches
 *  publication, and it must name this decomposition's own digest. */
export function finalizePlanForPublication(
  plan: TicketPlan,
  ratification?: TicketBudgetRatification,
): FinalPlanProjection {
  const validation = validatePlan(plan, ratification);
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

/** Typed INV-011 refusal at the publication egress: a to-be-published title
 *  or body matched the canonical secret-pattern list. Findings name the
 *  ticket index, the surface, and the matched pattern KIND only — never the
 *  matched text, and never an excerpt of the ticket (the excerpt could BE the
 *  secret; validatePlan's title-slice convention is deliberately not followed
 *  here). */
export class TicketPublicationSecretError extends Error {
  readonly code = "error_ticket_publication_secret" as const;
  constructor(readonly findings: readonly string[]) {
    super(
      "publishTickets: refusing to publish — suspected secret material in planner-authored " +
        `ticket content (${findings.join("; ")}). No issue was created; remove the credential ` +
        "and re-plan. Publication refuses rather than scrubs: a silent scrub would publish " +
        "content nobody wrote (INV-011).",
    );
    this.name = "TicketPublicationSecretError";
  }
}

/** INV-011 guardrail (HB-016): scan EVERY to-be-published surface — each
 *  ticket's title and its exact rendered body — against the ONE canonical
 *  pattern list (src/runtime/secret-patterns.ts; never fork a second list)
 *  and refuse the WHOLE plan on any match, before the first GitHub mutation.
 *  Mirrors the episode-planner brief's refusal
 *  (src/org/episode-planner/brief.ts): planner-authored prose is untrusted
 *  input, and a published issue is the lower-sensitivity surface
 *  secret-bearing content must never cross into. All-or-nothing by
 *  construction: the scan completes over the full plan before anything is
 *  created, so a secret in the LAST ticket vetoes the FIRST — no partial
 *  publication to reconcile. Bodies are scanned exactly as they will render
 *  (minus `Depends-on: #<n>` back-references, which are orchestrator-derived
 *  issue numbers, not planner prose). */
function assertPublishableContentCarriesNoSecret(
  projection: FinalPlanProjection,
  planningSources?: PlanningSourceTicketEvidence,
  provenance?: PlanProvenance,
): void {
  const unnumbered: (number | undefined)[] = projection.tickets.map(() => undefined);
  const findings: string[] = [];
  for (const { index, ticket } of projection.tickets) {
    const surfaces = [
      ["title", ticket.title],
      [
        "body",
        renderTicketBody(
          ticket,
          unnumbered,
          projection.plan.releaseKind,
          projection.plan.releaseVersion,
          planningSources,
          provenance,
        ),
      ],
    ] as const;
    for (const [surface, text] of surfaces) {
      for (const { name, pattern } of SECRET_PATTERNS) {
        if (pattern.test(text)) findings.push(`ticket ${index} ${surface}: ${name}`);
      }
    }
  }
  if (findings.length > 0) throw new TicketPublicationSecretError(findings);
}

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
 *  back-fill real issue numbers into `Depends-on:` references. Refuses with
 *  `TicketPublicationSecretError` — before ANY GitHub mutation — when any
 *  to-be-published title or body matches the canonical secret-pattern list
 *  (INV-011). Otherwise throws on the first GitHub failure — by then
 *  all-local validation has already passed, so a failure is environmental,
 *  and everything created so far is reported in the error for manual
 *  reconciliation. */
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
  // INV-011: the WHOLE plan is proven secret-free before ANY GitHub mutation
  // (label ensures included) — a refusal must leave nothing behind, never a
  // partially published secret-bearing plan.
  assertPublishableContentCarriesNoSecret(projection, planningSources, provenance);

  const issueNumbers: (number | undefined)[] = projection.tickets.map(() => undefined);
  const published: PublishedTicket[] = [];
  const recoveredIssues = new Map<number, { state: string; labels: Set<string> }>();
  if (provenance !== undefined) {
    const existing = await gh.listIssues({ state: "all", limit: 1_000 });
    for (const issue of existing) {
      const owner = parsePlannedBy(issue.body);
      if (owner === undefined || !sameProvenance(owner, provenance)) continue;
      const index = parsePlanTicketIndex(issue.body);
      if (index === undefined || index < 0 || index >= projection.tickets.length) {
        throw new Error(`publishTickets: existing Planned-by issue #${issue.number} has no valid Plan-ticket-index`);
      }
      const expected = projection.tickets[index]!;
      if (issueNumbers[index] !== undefined || issue.title !== expected.ticket.title) {
        throw new Error(`publishTickets: existing Planned-by issue #${issue.number} conflicts at ticket index ${index}`);
      }
      issueNumbers[index] = issue.number;
      recoveredIssues.set(index, { state: issue.state, labels: new Set(issue.labels) });
      published.push({
        index,
        issueNumber: issue.number,
        title: issue.title,
        ready: expected.ready,
        labels: [...expected.labels],
      });
    }
  }

  for (const label of CANONICAL_LABELS) await gh.ensureLabel(label);

  try {
    // A create can succeed while label application/response fails. Recover
    // missing immutable classification labels, and restore op:ready only when
    // no later state label proves that the ticket has already advanced.
    for (const [index, issue] of recoveredIssues) {
      const expected = projection.tickets[index]!;
      const hasCurrentState = [...issue.labels].some((label) => STATE_LABELS.includes(label as (typeof STATE_LABELS)[number]));
      for (const label of expected.labels) {
        if (issue.labels.has(label)) continue;
        if (label === "op:ready" && (issue.state !== "OPEN" || hasCurrentState)) continue;
        await gh.addLabel(issueNumbers[index]!, label);
        issue.labels.add(label);
      }
    }
    for (const { index, ticket, labels, ready } of projection.tickets) {
      if (issueNumbers[index] !== undefined) continue;
      const issue = await gh.createIssue({
        title: ticket.title,
        body: renderTicketBody(ticket, issueNumbers, projection.plan.releaseKind, projection.plan.releaseVersion, planningSources, provenance, index),
        labels,
      });
      issueNumbers[index] = issue.number;
      published.push({ index, issueNumber: issue.number, title: ticket.title, ready, labels: [...labels] });
    }
    // Second pass: tickets whose dependencies were created after them get
    // their real Depends-on references now that every number is known.
    for (const { index, ticket } of projection.tickets) {
      if (ticket.dependsOn.some((dep) => dep > index) || provenance !== undefined) {
        await gh.updateIssueBody(
          issueNumbers[index]!,
          renderTicketBody(ticket, issueNumbers, projection.plan.releaseKind, projection.plan.releaseVersion, planningSources, provenance, index),
        );
      }
    }
  } catch (error) {
    const created = published.map((t) => `#${t.issueNumber} ${t.title}`).join(", ") || "(none)";
    throw new Error(
      `publishTickets: GitHub failed mid-publication after resolving ${created} — ` +
        `rerun with the same Planned-by identity to reconcile (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return { published: published.sort((left, right) => left.index - right.index) };
}

function sameProvenance(left: PlanProvenance, right: PlanProvenance): boolean {
  return left.episodeId === right.episodeId && left.runId === right.runId && left.traceId === right.traceId;
}
