// Tests schema-validated, orchestrator-published planning tickets in
// src/loop/plan-tickets.ts (Stage 4 of docs/proportionality-review.md).
// Covers stage ticket budgets, tier calibration, criterion quality,
// dependency sanity, body rendering the loop's own parsers read back, label
// guarantees, ready-labeling, and forward-dependency back-fill.
// Uses FakeGhOps; no network, auth, real GitHub state, or wall clock.

import { describe, expect, it } from "vitest";
import {
  CANONICAL_LABELS,
  applySensitiveDomainFloor,
  finalizePlanForPublication,
  publishTickets,
  renderTicketBody,
  sensitiveDomainsForTicket,
  validatePlan,
  type PlanTicket,
  type TicketPlan,
  parseReleaseKind,
} from "../../src/loop/plan-tickets.js";
import { itemFromIssue, parseAcceptanceCriteria } from "../../src/loop/loop.js";
import { routeDecisionForItem } from "../../src/loop/driver.js";
import { parseDependsOn, parseScope } from "../../src/loop/scheduling.js";
import { FakeGhOps } from "../support/fakeGhOps.js";

function ticket(overrides: Partial<PlanTicket> = {}): PlanTicket {
  return {
    title: "Ship the scaffold with a visible landing page",
    tier: "op:tier-standard",
    priority: "p1",
    dependsOn: [],
    executionGroup: "g1",
    fileScope: ["src/**", "package.json"],
    goal: "A deployable site with real content on the landing page.",
    context: "Greenfield repo; product docs in README.",
    acceptanceCriteria: ["pnpm test exits 0", "the landing page renders the product name"],
    outOfScope: "Analytics, RSS, custom domains.",
    notesForBuilder: "Keep dependencies boring.",
    ...overrides,
  };
}

function plan(overrides: Partial<TicketPlan> = {}): TicketPlan {
  return {
    stage: "bootstrap",
    ticketCountRationale: "One coherent milestone: scaffold plus first visible content ships together.",
    releaseDisposition: "Deploys to the owner's static host; the orchestrator triggers CI deploy after merge.",
    releaseKind: "deploy" as const,
    tickets: [ticket()],
    ...overrides,
  };
}

describe("validatePlan", () => {
  it("accepts a proportional bootstrap plan", () => {
    expect(validatePlan(plan())).toEqual({ ok: true, problems: [] });
  });

  it("rejects a plan over the stage budget — the 19-ticket website can never validate", () => {
    const oversized = plan({ tickets: Array.from({ length: 19 }, () => ticket()) });
    const result = validatePlan(oversized);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes("budget of 3"))).toBe(true);
  });

  it("rejects deep-tier tickets at bootstrap stage (tier follows surface, not ceremony)", () => {
    const result = validatePlan(plan({ tickets: [ticket({ tier: "op:tier-deep" })] }));
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes("op:tier-deep"))).toBe(true);
  });

  it("requires the plan to argue its size and name its release disposition", () => {
    const result = validatePlan(plan({ ticketCountRationale: " ", releaseDisposition: "" }));
    expect(result.problems.some((p) => p.includes("argue its own size"))).toBe(true);
    expect(result.problems.some((p) => p.includes("release"))).toBe(true);
  });

  it("rejects an unrecognized releaseKind (P7 needs the machine-readable half)", () => {
    const result = validatePlan(plan({ releaseKind: "someday" as never }));
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes("releaseKind"))).toBe(true);
  });

  it("rejects vague criteria, bad dependency indexes, and a fully serial graph", () => {
    const result = validatePlan(
      plan({
        tickets: [
          ticket({ acceptanceCriteria: ["works"], dependsOn: [0] }),
          ticket({ dependsOn: [5] }),
        ],
      }),
    );
    expect(result.problems.some((p) => p.includes("not mechanically checkable"))).toBe(true);
    expect(result.problems.some((p) => p.includes("depends on itself"))).toBe(true);
    expect(result.problems.some((p) => p.includes("out of range"))).toBe(true);
    expect(result.problems.some((p) => p.includes("no dependency-free ticket"))).toBe(true);
  });
});

describe("renderTicketBody", () => {
  it("renders a body the loop's own parsers read back", () => {
    const body = renderTicketBody(ticket({ dependsOn: [0] }), [41]);

    expect(parseDependsOn(body)).toEqual([41]);
    expect(parseScope(body)).toEqual(["src/**", "package.json"]);
    const criteria = parseAcceptanceCriteria(body);
    expect(criteria).toHaveLength(2);
    expect(criteria.every((c) => !c.checked)).toBe(true);
  });

  it("renders and reads back the Release-kind trailer (P7)", () => {
    const body = renderTicketBody(ticket(), [], "deploy");
    expect(body).toContain("Release-kind: deploy");
    expect(parseReleaseKind(body)).toBe("deploy");
  });

  it("pre-A4 bodies carry no release requirement", () => {
    const body = renderTicketBody(ticket(), []);
    expect(body).not.toContain("Release-kind:");
    expect(parseReleaseKind(body)).toBeUndefined();
    expect(parseReleaseKind("Release-kind: yolo\n")).toBeUndefined();
  });
});

describe("publishTickets", () => {
  it("ensures canonical labels, publishes with tier/priority, arms only dependency-free tickets", async () => {
    const gh = new FakeGhOps();
    const twoTickets = plan({
      ticketCountRationale: "Second ticket is rollback-isolated deploy config.",
      tickets: [ticket(), ticket({ title: "Wire the deploy", dependsOn: [0], priority: "p2" })],
    });

    const { published } = await publishTickets(gh, twoTickets);

    expect(published).toHaveLength(2);
    for (const label of CANONICAL_LABELS) expect(gh.repoLabels.has(label.name)).toBe(true);
    const issues = await gh.listIssues({ state: "all", limit: 10 });
    const first = issues.find((i) => i.number === published[0]!.issueNumber)!;
    const second = issues.find((i) => i.number === published[1]!.issueNumber)!;
    expect(first.labels).toEqual(expect.arrayContaining(["op:tier-standard", "p1", "op:ready"]));
    // Dependency-locked backlog stays stateless until groom arms it.
    expect(second.labels).not.toContain("op:ready");
    expect(parseDependsOn(second.body)).toEqual([first.number]);
  });

  it("back-fills forward dependencies with real issue numbers after creation", async () => {
    const gh = new FakeGhOps();
    const forward = plan({
      ticketCountRationale: "Parallel pair with a cross-check ticket.",
      tickets: [ticket({ title: "A", dependsOn: [1] }), ticket({ title: "B" })],
    });

    const { published } = await publishTickets(gh, forward);
    const a = (await gh.listIssues({ state: "all", limit: 10 })).find(
      (i) => i.number === published[0]!.issueNumber,
    )!;
    expect(parseDependsOn(a.body)).toEqual([published[1]!.issueNumber]);
  });

  it("renders the plan's Release-kind into every published body", async () => {
    const gh = new FakeGhOps();
    const { published } = await publishTickets(gh, plan());
    const issue = (await gh.listIssues({ state: "all", limit: 10 })).find(
      (i) => i.number === published[0]!.issueNumber,
    )!;
    expect(parseReleaseKind(issue.body)).toBe("deploy");
  });

  it("refuses to touch GitHub when validation fails", async () => {
    const gh = new FakeGhOps();
    await expect(
      publishTickets(gh, plan({ tickets: Array.from({ length: 5 }, () => ticket()) })),
    ).rejects.toThrow(/failed validation/);
    expect(await gh.listIssues({ state: "all", limit: 10 })).toEqual([]);
    expect(gh.repoLabels.size).toBe(0);
  });
});

// L0-02 (L-004): the sensitive-domain deep floor is implemented and correct in
// route-policy.ts but was dead because nothing attached the domain labels
// routeDecisionForItem reads sensitiveDomains from. The orchestrator now
// attaches them (and floors the ticket to op:tier-deep) at publication from the
// ticket's own content — the mirror image of over-service. The match is at
// WORD boundaries over PROSE only, so it fires on genuine sensitive work and
// NOT on compound words (`database`/`metadata`/`data model`) or noisy scope
// paths (`src/data/**`) — those are the over-escalation the L0-02 fixup removes.
const DOMAIN_RE = /auth|security|secret|privacy|payment|data/;

/** A growth-stage plan pairing a genuinely sensitive ticket with a plain
 *  near-miss control. Ticket 0 touches the HTTP/storage surface for user data
 *  (mirroring ISSUES.md Issue 4's goal) and must floor to deep. Ticket 1 is an
 *  ordinary reference docs page whose prose names only the compound terms that
 *  a raw substring match used to trip on (`metadata`, `data model`,
 *  `database`) and whose scope includes a `src/data/**` path — under
 *  word-boundary + prose-only matching it must NOT floor. */
function storagePlan(overrides: Partial<TicketPlan> = {}): TicketPlan {
  return plan({
    stage: "growth",
    ticketCountRationale: "Contact form plus a plain reference docs page: two coherent slices.",
    tickets: [
      ticket({
        title: "Add a contact form that stores submissions",
        tier: "op:tier-standard",
        fileScope: ["src/server/contact.ts", "src/db/submissions.ts"],
        goal: "Accept contact submissions over HTTP and persist them to storage.",
        context: "The form collects a name, email, and message and stores each submission.",
        acceptanceCriteria: ["a POST to /contact stores the submission", "the stored row includes the email"],
        notesForBuilder: "Validate the email before storing user data.",
      }),
      ticket({
        title: "Add a reference docs page for the contact form",
        tier: "op:tier-quick",
        priority: "p2",
        // A `src/data/**` path in scope used to floor the ticket by itself; the
        // fixup no longer scans fileScope paths.
        fileScope: ["docs/handling.md", "src/data/models.ts"],
        goal: "Document the retention window and the metadata the form records.",
        context: "A plain docs page describing the data model and the database columns.",
        acceptanceCriteria: ["the docs page renders", "it names the retention window"],
        notesForBuilder: "Keep it short.",
      }),
    ],
    ...overrides,
  });
}

describe("sensitiveDomainsForTicket", () => {
  it("reads risk domains from a ticket's own content, using the route-policy keyword set", () => {
    expect(
      sensitiveDomainsForTicket(
        ticket({ goal: "Persist user data", notesForBuilder: "no auth needed" }),
      ),
    ).toEqual(["auth", "data"]);
    // A vanilla scaffold ticket names none of them.
    expect(
      sensitiveDomainsForTicket(
        ticket({
          title: "Landing page",
          goal: "Render the product name",
          context: "greenfield",
          acceptanceCriteria: ["the page renders"],
          fileScope: ["src/index.ts"],
          notesForBuilder: "boring deps",
          outOfScope: "analytics",
        }),
      ),
    ).toEqual([]);
  });

  it("matches keywords at WORD boundaries over prose, not raw substrings (L0-02 over-escalation fix)", () => {
    // Genuine sensitive phrasing still fires — the floor stays "never less safe".
    expect(sensitiveDomainsForTicket(ticket({ goal: "explaining how we handle that user data" }))).toEqual(["data"]);
    expect(sensitiveDomainsForTicket(ticket({ goal: "store the user's payment details" }))).toEqual(["payment"]);
    expect(sensitiveDomainsForTicket(ticket({ notesForBuilder: "mint and rotate the auth token" }))).toEqual(["auth"]);
    expect(sensitiveDomainsForTicket(ticket({ context: "publish a privacy policy" }))).toEqual(["privacy"]);

    // Compound words / technical terms that merely CONTAIN a keyword must NOT
    // fire: `database`/`metadata`/`dataset` lack a word boundary after `data`,
    // `data model` is a schema (not user-data handling), and `author` is not
    // `auth`. These were the exact spurious floors the substring match caused.
    for (const benign of [
      "Add a database index for faster lookups",
      "Store request metadata for the audit log",
      "Run the data model migration",
      "Refactor the dataset loader",
      "Refresh the author bio page",
    ]) {
      expect(sensitiveDomainsForTicket(ticket({ goal: benign }))).toEqual([]);
    }

    // fileScope PATHS are not scanned — a `src/data/**` path alone must not floor.
    expect(
      sensitiveDomainsForTicket(ticket({ goal: "Split the model file", fileScope: ["src/data/models.ts"] })),
    ).toEqual([]);
  });
});

// L0-02 anti-under-escalation regression matrix. The first L0-02 fixup fixed
// over-escalation (compounds no longer floor) but over-corrected: too-strict
// `\bword\b` stems (`\bauth\b`, `\bsecret\b`, `\bpayment\b`, `\bsecurity\b`)
// then MISSED the dominant sensitive phrasings, so genuine auth/secret/payment
// work SILENTLY SKIPPED the deep safety floor — "tiering makes the loop
// cheaper, never LESS safe" broken in the dangerous direction. This matrix
// pins BOTH directions permanently: every phrasing that must reach the floor,
// and every near-miss compound that must not. Each phrase is single-signal and
// carried in a single prose field (the `ticket()` defaults name no domain), so
// the returned domain set is exactly the row's expectation.
const MUST_FIRE: ReadonlyArray<[string, string]> = [
  // auth — the inflections a bare `\bauth\b` used to miss.
  ["authentication", "auth"],
  ["authorization", "auth"],
  ["authorize the user", "auth"],
  ["OAuth login", "auth"],
  ["auth token", "auth"],
  // security — `secure`/`secured` a bare `\bsecurity\b` used to miss.
  ["security review", "security"],
  ["secure the endpoint", "security"],
  // secret — the plural `secrets` a bare `\bsecret\b` used to miss.
  ["rotate the secret", "secret"],
  ["manage API secrets", "secret"],
  // privacy.
  ["privacy policy", "privacy"],
  // payment — the plural `payments` a bare `\bpayment\b` used to miss.
  ["process a payment", "payment"],
  ["process payments", "payment"],
  // data — including the hyphenated form.
  ["how we handle your user data", "data"],
  ["personal data", "data"],
  ["user-data", "data"],
];
const MUST_NOT_FIRE: ReadonlyArray<string> = [
  "database",
  "databases",
  "metadata",
  "dataset",
  "data model",
  "data models",
  "data model migration",
  "author",
  "authored",
  "authoritative source",
  "secretary",
];

describe("sensitive-domain match matrix (L0-02 anti-under-escalation regression)", () => {
  it.each(MUST_FIRE)(
    "fires the sensitive-domain floor for %j → domain:%s",
    (phrase, expectedDomain) => {
      // The phrase alone determines the domain set (defaults are benign).
      expect(sensitiveDomainsForTicket(ticket({ goal: phrase }))).toEqual([expectedDomain]);
      // …and at publication the ticket is floored to op:tier-deep and labeled,
      // so route-policy's `sensitiveDomains.length > 0` deep floor can fire.
      const [published] = applySensitiveDomainFloor(
        plan({ stage: "growth", tickets: [ticket({ tier: "op:tier-standard", goal: phrase })] }),
      );
      expect(published!.ticket.tier).toBe("op:tier-deep");
      expect(published!.domainLabels).toContain(`domain:${expectedDomain}`);
    },
  );

  it.each(MUST_NOT_FIRE)("does NOT fire on the near-miss compound %j", (phrase) => {
    expect(sensitiveDomainsForTicket(ticket({ goal: phrase }))).toEqual([]);
    // The tier the Planner chose is preserved — no spurious escalation.
    const [published] = applySensitiveDomainFloor(
      plan({ stage: "growth", tickets: [ticket({ tier: "op:tier-quick", priority: "p2", goal: phrase })] }),
    );
    expect(published!.ticket.tier).toBe("op:tier-quick");
    expect(published!.domainLabels).toEqual([]);
  });

  it("does NOT fire when the only `data` signal is a fileScope path", () => {
    // Paths are never scanned; a `src/data/**` scope alone must not floor.
    const t = ticket({ tier: "op:tier-quick", priority: "p2", goal: "Split the model file", fileScope: ["src/data/models.ts"] });
    expect(sensitiveDomainsForTicket(t)).toEqual([]);
    const [published] = applySensitiveDomainFloor(plan({ stage: "growth", tickets: [t] }));
    expect(published!.ticket.tier).toBe("op:tier-quick");
    expect(published!.domainLabels).toEqual([]);
  });
});

describe("applySensitiveDomainFloor", () => {
  it("freezes requested/final tiers, reasons, and canonical labels for a mixed plan", () => {
    const projection = finalizePlanForPublication(storagePlan());
    expect(projection.plan.tickets.map((item) => item.tier)).toEqual(["op:tier-deep", "op:tier-quick"]);
    expect(projection.tickets).toEqual([
      expect.objectContaining({
        requestedTier: "op:tier-standard",
        finalTier: "op:tier-deep",
        escalationReason: "sensitive-domain floor: data",
        labels: expect.arrayContaining(["op:tier-deep", "domain:data", "op:ready"]),
      }),
      expect.objectContaining({
        requestedTier: "op:tier-quick",
        finalTier: "op:tier-quick",
        labels: expect.arrayContaining(["op:tier-quick"]),
      }),
    ]);
    expect(projection.tickets[1]?.escalationReason).toBeUndefined();
  });

  it("floors a genuinely sensitive growth ticket to op:tier-deep and labels it; leaves a plain near-miss page alone", () => {
    const publications = applySensitiveDomainFloor(storagePlan());
    // Ticket 0 genuinely stores user data ("storing user data") → floored + labeled.
    expect(publications[0]!.ticket.tier).toBe("op:tier-deep");
    expect(publications[0]!.domainLabels).toContain("domain:data");
    // Ticket 1 is a plain reference docs page: its prose only names the
    // compounds `metadata`, `data model`, and `database`, and its scope holds a
    // `src/data/**` path. Under the L0-02 fixup (word-boundary + prose-only) it
    // is NOT floored — the earlier assertion that this docs page reached deep
    // encoded the over-escalation bug.
    expect(publications[1]!.ticket.tier).toBe("op:tier-quick");
    expect(publications[1]!.domainLabels).toEqual([]);
    const vanilla = applySensitiveDomainFloor(
      plan({
        stage: "growth",
        tickets: [ticket({ goal: "Render the landing page", notesForBuilder: "boring" })],
      }),
    );
    expect(vanilla[0]!.ticket.tier).toBe("op:tier-standard");
    expect(vanilla[0]!.domainLabels).toEqual([]);
  });

  it("does NOT floor bootstrap tickets — a greenfield scaffold must not be deep (P2)", () => {
    // A bootstrap ticket keeps its tier and takes no domain label: a label
    // without the matching deep tier would break the route consistency check,
    // and bootstrap-deep is forbidden by validatePlan.
    const publications = applySensitiveDomainFloor(
      plan({ stage: "bootstrap", tickets: [ticket({ notesForBuilder: "handles user data" })] }),
    );
    expect(publications[0]!.ticket.tier).toBe("op:tier-standard");
    expect(publications[0]!.domainLabels).toEqual([]);
  });
});

describe("publishTickets — sensitive-domain deep floor (L0-02)", () => {
  it("attaches a domain label and publishes the storage ticket as op:tier-deep, with no hand-applied label", async () => {
    const gh = new FakeGhOps();
    const { published } = await publishTickets(gh, storagePlan());
    const issues = await gh.listIssues({ state: "all", limit: 10 });

    // At least one ticket carries a domain label (today's baseline was 0 of 5).
    expect(issues.some((i) => i.labels.some((l) => DOMAIN_RE.test(l)))).toBe(true);

    // The ticket touching the HTTP/storage surface is op:tier-deep.
    const storage = issues.find((i) => i.number === published[0]!.issueNumber)!;
    expect(storage.labels).toContain("op:tier-deep");
    expect(storage.labels).toContain("domain:data");
    expect(storage.labels).not.toContain("op:tier-standard");
  });

  it("the published storage ticket routes DEEP via the sensitive-domain floor — no hand-applied label", async () => {
    const gh = new FakeGhOps();
    const { published } = await publishTickets(gh, storagePlan());
    const storage = (await gh.listIssues({ state: "all", limit: 10 })).find(
      (i) => i.number === published[0]!.issueNumber,
    )!;

    const item = itemFromIssue(storage, gh.repo);
    expect(item.tier).toBe("deep");
    expect(item.labels.some((l) => DOMAIN_RE.test(l))).toBe(true);

    const decision = routeDecisionForItem(item);
    expect(decision.route).toBe("deep");
    expect(decision.profile.sensitiveDomains.length).toBeGreaterThan(0);
    expect(decision.decisionRules).toContain("sensitive_domain");
  });

  it("a vanilla growth ticket still routes standard — the floor does not over-fire", async () => {
    const gh = new FakeGhOps();
    const vanilla = plan({
      stage: "growth",
      ticketCountRationale: "One ordinary content ticket.",
      tickets: [ticket({ title: "Render the landing page", goal: "Show the product name", notesForBuilder: "boring deps" })],
    });
    const { published } = await publishTickets(gh, vanilla);
    const issue = (await gh.listIssues({ state: "all", limit: 10 })).find(
      (i) => i.number === published[0]!.issueNumber,
    )!;
    expect(issue.labels.some((l) => DOMAIN_RE.test(l))).toBe(false);
    const decision = routeDecisionForItem(itemFromIssue(issue, gh.repo));
    expect(decision.route).toBe("standard");
    expect(decision.decisionRules).not.toContain("sensitive_domain");
  });
});
