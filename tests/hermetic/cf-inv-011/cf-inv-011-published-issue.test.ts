// CF-INV-011 — published issue bodies carry no secret: L2 composition on the
// gh double (HB-016, FLOOR — non-discretionary).
//
// CORMIDIA-INV-011 adversarial seed (a) (validation-design/invariants.md):
// "secret in ticket body → published issue". The invariant's ratified
// statement names published tickets as a lower-sensitivity surface that
// secret-bearing content must never cross into, with a guardrail at each
// egress — either a scrub or a refusal satisfies it.
//
// Composition under test: REAL `publishTickets` / `finalizePlanForPublication`
// (src/loop/plan-tickets.ts) through REAL `GhCliOps` (src/loop/github.ts)
// against the scripted gh double (fixtures/github-double) at the B-01
// process seam. Product code runs unmodified; no network, no tokens.
//
// PRODUCT DEFECT (HB-016) — FIXED, tripwire promoted: publication had NO
// secret guardrail — a synthetic seed planted in a ticket's goal flowed
// verbatim into the published issue body (renderTicketBody applied no scrub;
// validatePlan checked no patterns; the runAutoPlan caller added none). The
// fix (src/loop/plan-tickets.ts assertPublishableContentCarriesNoSecret,
// wired into publishPlanProjection) REFUSES the whole plan, typed
// (TicketPublicationSecretError) and loud, naming the matched pattern kind —
// never the secret — BEFORE any GitHub mutation, mirroring the
// src/org/episode-planner/brief.ts precedent (refuse > scrub at this seam: a
// silent scrub would publish content nobody wrote). The former it.fails
// tripwire is now the plain promoted detector below, extended to pin the
// all-or-nothing shape: title + body + every ticket, zero partial
// publication.

import { afterEach, describe, expect, it } from "vitest";
import { GhCliOps } from "../../../src/loop/github.js";
import {
  publishTickets,
  TicketPublicationSecretError,
  type PlanTicket,
  type TicketPlan,
} from "../../../src/loop/plan-tickets.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";
import { makeSyntheticSecret, type SyntheticSecret } from "../../fixtures/synthetic-secret.js";
import { detectSecretEgress, findSecretEgress, makeAllSeeds } from "../../unit/cf-inv-011/secret-egress-detector.js";

function ticket(overrides: Partial<PlanTicket>): PlanTicket {
  return {
    title: "Wire the connector",
    tier: "op:tier-standard",
    priority: "p2",
    dependsOn: [],
    executionGroup: "connector",
    fileScope: ["src/connector.ts"],
    goal: "Wire the connector end to end",
    context: "The connector is stubbed today.",
    acceptanceCriteria: ["pnpm test passes with the connector suite enabled"],
    outOfScope: "No UI changes.",
    notesForBuilder: "Keep the adapter seam injectable.",
    ...overrides,
  };
}

/** A structurally valid plan whose prose carries all 8 seeded kinds spread
 *  across every free-text ticket field a Planner model writes. */
function seededPlan(seeds: readonly SyntheticSecret[]): TicketPlan {
  const [aws, ghToken, sk, slack, npm, jwt, pem, generic] = seeds;
  if (!aws || !ghToken || !sk || !slack || !npm || !jwt || !pem || !generic) {
    throw new Error("expected all 8 synthetic seed kinds");
  }
  return {
    stage: "growth",
    ticketCountRationale: "two tickets: one connector, one docs follow-up",
    releaseDisposition: "merge to default; no deploy this milestone",
    releaseKind: "merge-only",
    tickets: [
      ticket({
        title: "Wire the connector",
        goal: `Use the provisioned token ${ghToken.value} for the connector`,
        context: `Staging currently exports ${generic.value} and ${aws.value}.`,
        acceptanceCriteria: [
          `works without ${sk.value} in the environment`,
          "pnpm test passes with the connector suite enabled",
        ],
        notesForBuilder: `The old webhook secret was ${slack.value}; rotate it.`,
      }),
      ticket({
        title: "Document the rollout",
        executionGroup: "docs",
        fileScope: ["docs/rollout.md"],
        goal: `Document the JWT flow (${jwt.value}) end to end`,
        context: `The CI job still prints ${npm.value} on failure.`,
        outOfScope: `Do not paste the signing key:\n${pem.value}`,
      }),
    ],
  };
}

/** A structurally valid, secret-free plan — the positive-control twin of
 *  seededPlan, proving the refusal is not indiscriminate. */
function cleanPlan(): TicketPlan {
  return {
    stage: "growth",
    ticketCountRationale: "two tickets: one connector, one docs follow-up",
    releaseDisposition: "merge to default; no deploy this milestone",
    releaseKind: "merge-only",
    tickets: [
      ticket({}),
      ticket({
        title: "Document the rollout",
        executionGroup: "docs",
        fileScope: ["docs/rollout.md"],
        goal: "Document the connector rollout end to end",
        context: "The rollout has no runbook yet.",
      }),
    ],
  };
}

describe("CF-INV-011 — published issue bodies carry no secret (L2 on gh double, HB-016)", () => {
  let handle: GithubDoubleHandle;

  afterEach(async () => {
    await handle.dispose();
  });

  // PROMOTED DETECTOR (was the HB-016 it.fails tripwire) — the fix landed in
  // src/loop/plan-tickets.ts: publishPlanProjection now refuses the whole
  // plan via the canonical pattern list before any GitHub mutation. The
  // original ratified-clause assertion (nothing leaks; refusal-or-clean) is
  // kept verbatim; the promotion adds the fix's pinned shape — typed refusal
  // naming the pattern kind, echoing no secret, creating nothing.
  it("a secret-bearing plan never reaches a published issue verbatim — publication refuses, typed and loud, before the first create (INV-011 seed a)", async () => {
    handle = await installGithubDouble({});
    const gh = new GhCliOps(handle.repo, handle.exec);
    const seeds = makeAllSeeds();

    let refusal: unknown;
    try {
      await publishTickets(gh, seededPlan(seeds));
    } catch (error) {
      refusal = error; // a refusal satisfies the invariant IF nothing leaked first
    }

    const issues = Object.values(handle.readState().issues);
    if (refusal === undefined) {
      // Publication claims success — then the issues must exist AND be clean.
      expect(issues.length).toBe(2);
    }
    for (const issue of issues) {
      detectSecretEgress(`published issue #${issue.number}`, `${issue.title}\n${issue.body}`, seeds);
    }

    // The fix's pinned shape: a typed, loud refusal…
    expect(refusal).toBeInstanceOf(TicketPublicationSecretError);
    const message = (refusal as TicketPublicationSecretError).message;
    // …naming the matched pattern kind (spot-check one per planted ticket)…
    expect(message).toContain("github-token");
    expect(message).toContain("private-key-block");
    // …never the secret itself…
    for (const seed of seeds) {
      expect(message).not.toContain(seed.value);
    }
    // …and BEFORE any GitHub mutation: zero issues, zero gh calls (not even
    // a label ensure) — no partial publication of a secret-bearing plan.
    expect(issues.length).toBe(0);
    expect(handle.callLog().length).toBe(0);
  });

  it("refusal covers title + body + EVERY ticket (all-or-nothing): one secret anywhere vetoes the whole plan with nothing created", async () => {
    handle = await installGithubDouble({});
    const gh = new GhCliOps(handle.repo, handle.exec);

    // One placement per published surface class: the TITLE (never part of
    // renderTicketBody, so a body-only guard misses it), a LAST-ticket prose
    // field (so a first-ticket-only or stop-at-first-create guard misses it),
    // and a LAST-ticket acceptance criterion (list-rendered, not paragraph
    // prose). Each placement uses a different seed kind.
    const placements: ReadonlyArray<{
      where: string;
      plant: (plan: TicketPlan, value: string) => void;
      kind: SyntheticSecret["kind"];
    }> = [
      {
        where: "first ticket title",
        kind: "sk-api-key",
        plant: (plan, value) => {
          plan.tickets[0]!.title = `Wire the connector against ${value}`;
        },
      },
      {
        where: "last ticket notesForBuilder",
        kind: "slack-token",
        plant: (plan, value) => {
          plan.tickets[1]!.notesForBuilder = `The old webhook secret was ${value}; rotate it.`;
        },
      },
      {
        where: "last ticket acceptance criterion",
        kind: "github-token",
        plant: (plan, value) => {
          plan.tickets[1]!.acceptanceCriteria.push(`works without ${value} in the environment`);
        },
      },
    ];

    for (const placement of placements) {
      const seed = makeSyntheticSecret(placement.kind);
      const plan = cleanPlan();
      placement.plant(plan, seed.value);
      let refusal: unknown;
      try {
        await publishTickets(gh, plan);
      } catch (error) {
        refusal = error;
      }
      expect(refusal, `no refusal for secret in ${placement.where}`).toBeInstanceOf(TicketPublicationSecretError);
      const message = (refusal as TicketPublicationSecretError).message;
      expect(message, `pattern kind not named for ${placement.where}`).toContain(seed.expectedPatternName);
      expect(message, `secret echoed for ${placement.where}`).not.toContain(seed.value);
      // All-or-nothing: after every refusal the remote is untouched — the
      // same double is reused across placements, so any create would persist
      // into the next iteration's assertion.
      expect(Object.values(handle.readState().issues).length).toBe(0);
      expect(handle.callLog().length).toBe(0);
    }
  });

  it("evidence pin: publication crosses the real B-01 seam (gh issue create) for a clean plan; a refused plan makes ZERO gh calls", async () => {
    // Pre-fix this pinned the leak's mechanism (the seeded bodies left
    // through the double's `gh` argv surface). Post-fix it pins the same
    // seam both ways: the refusal happens strictly BEFORE the seam (no calls
    // at all), and a clean plan still publishes through the exact `gh issue
    // create` argv surface production spawns (GhCliOps.createIssue) — so the
    // guard is proven non-vacuous AND non-indiscriminate at L2.
    handle = await installGithubDouble({});
    const gh = new GhCliOps(handle.repo, handle.exec);
    const seeds = makeAllSeeds();

    await expect(publishTickets(gh, seededPlan(seeds))).rejects.toThrow(TicketPublicationSecretError);
    expect(handle.callLog().length).toBe(0); // refusal precedes the seam entirely

    const result = await publishTickets(gh, cleanPlan());
    expect(result.published.length).toBe(2);
    const log = handle.callLog();
    expect(log.length).toBeGreaterThan(0); // non-empty: the seam was exercised
    expect(log.some((entry) => entry.op === "issue.create")).toBe(true);
    // And what actually published is clean per the family oracle.
    for (const issue of Object.values(handle.readState().issues)) {
      detectSecretEgress(`published issue #${issue.number}`, `${issue.title}\n${issue.body}`, seeds);
    }
  });

  it("negative control: a leaked issue body (seeded violation) makes the detector FIRE with the seed's family name", () => {
    const seeds = makeAllSeeds();
    const ghToken = seeds.find((seed) => seed.kind === "github-token");
    expect(ghToken).toBeDefined();
    const leakedBody = [
      "## Goal",
      `Use the provisioned token ${ghToken!.value} for the connector`,
      "",
      "## Acceptance criteria",
      "- [ ] connector suite green",
    ].join("\n");
    const findings = findSecretEgress(leakedBody, seeds);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.join("\n")).toContain("github-token");
  });
});
