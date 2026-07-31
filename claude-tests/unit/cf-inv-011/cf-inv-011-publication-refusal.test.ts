// CF-INV-011 — ticket publication refuses secret-bearing plans: L1 guardrail
// (HB-016 fix detector, deposited with the fix per AGENTS.md → policy
// case_sourcing).
//
// OPERON-INV-011: secret-bearing content never crosses into the published
// GitHub issue surface, and every egress guards through the ONE canonical
// pattern policy (src/runtime/secret-patterns.ts). The guard under test is
// the REAL product path `publishTickets` → `publishPlanProjection`
// (src/loop/plan-tickets.ts), whose INV-011 refusal fires before any GhOps
// method is touched — so at L1 the GitHub side needs no fake at all: an
// untouchable Proxy proves fail-before-side-effect by construction. The
// positive-control twin proves a clean plan reaches the seam (the refusal is
// not indiscriminate); the full clean-publish composition lives at L2
// (hermetic/cf-inv-011/cf-inv-011-published-issue.test.ts, real gh double).
//
// Layer: 1 (pure product functions, zero I/O, zero network, zero tokens).

import { describe, expect, it } from "vitest";
import type { GhOps } from "../../../src/loop/github.js";
import {
  publishTickets,
  TicketPublicationSecretError,
  type PlanTicket,
  type TicketPlan,
} from "../../../src/loop/plan-tickets.js";
import {
  makeSyntheticSecret,
  SYNTHETIC_SECRET_KINDS,
} from "../../fixtures/synthetic-secret.js";

/** A GhOps that must never be reached: any property access throws a
 *  non-refusal error, so a guard that fires late (or not at all) fails the
 *  `toBeInstanceOf(TicketPublicationSecretError)` assertion loudly. This is
 *  not a fake crossing the B-01 seam — it is the assertion that the seam is
 *  never crossed. */
function untouchableGh(): GhOps {
  return new Proxy({} as GhOps, {
    get(_target, property) {
      throw new Error(
        `INV-011 probe: GhOps.${String(property)} reached — publication passed the secret guard`,
      );
    },
  });
}

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

function planOf(...tickets: PlanTicket[]): TicketPlan {
  return {
    stage: "growth",
    ticketCountRationale: "smallest shippable slice for this milestone",
    releaseDisposition: "merge to default; no deploy this milestone",
    releaseKind: "merge-only",
    tickets,
  };
}

async function publishRefusal(plan: TicketPlan): Promise<unknown> {
  try {
    await publishTickets(untouchableGh(), plan);
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("CF-INV-011 — publication refuses secret-bearing plans before the GitHub seam (L1, HB-016)", () => {
  it("negative control: EVERY canonical seed kind planted in ticket prose makes the refusal FIRE, naming the kind, never the value", async () => {
    expect(SYNTHETIC_SECRET_KINDS.length).toBeGreaterThan(0); // non-empty walk over kinds
    for (const kind of SYNTHETIC_SECRET_KINDS) {
      const seed = makeSyntheticSecret(kind);
      const refusal = await publishRefusal(
        planOf(ticket({ goal: `Rotate the credential ${seed.value} out of staging` })),
      );
      expect(refusal, `kind ${kind} was not refused`).toBeInstanceOf(TicketPublicationSecretError);
      const typed = refusal as TicketPublicationSecretError;
      expect(typed.code).toBe("error_ticket_publication_secret");
      expect(
        typed.findings.join("\n"),
        `refusal for ${kind} does not name its pattern kind`,
      ).toContain(seed.expectedPatternName);
      expect(typed.message, `refusal for ${kind} echoes the secret`).not.toContain(seed.value);
    }
  });

  it("a secret in a ticket TITLE alone is refused — titles publish too, so a rendered-body-only scan would leak them", async () => {
    const seed = makeSyntheticSecret("sk-api-key");
    const refusal = await publishRefusal(
      planOf(ticket({ title: `Wire the connector against ${seed.value}` })),
    );
    expect(refusal).toBeInstanceOf(TicketPublicationSecretError);
    const typed = refusal as TicketPublicationSecretError;
    expect(typed.findings.join("\n")).toContain("ticket 0 title");
    expect(typed.findings.join("\n")).toContain(seed.expectedPatternName);
    expect(typed.message).not.toContain(seed.value);
  });

  it("all-or-nothing: a secret in the LAST ticket vetoes the whole plan — the first (clean) ticket is never created", async () => {
    const seed = makeSyntheticSecret("github-token");
    const refusal = await publishRefusal(
      planOf(
        ticket({}),
        ticket({
          title: "Document the rollout",
          executionGroup: "docs",
          fileScope: ["docs/rollout.md"],
          goal: "Document the connector rollout end to end",
          context: "The rollout has no runbook yet.",
          notesForBuilder: `The old provisioned token was ${seed.value}; rotate it.`,
        }),
      ),
    );
    // The untouchable GhOps makes the create-nothing claim structural: had
    // publication created ticket 0 before scanning ticket 1, the error here
    // would be the Proxy's, not the typed refusal.
    expect(refusal).toBeInstanceOf(TicketPublicationSecretError);
    expect((refusal as TicketPublicationSecretError).findings.join("\n")).toContain("ticket 1");
  });

  it("positive control: a clean plan sails past the guard to the GitHub seam — the refusal is not indiscriminate", async () => {
    const refusal = await publishRefusal(planOf(ticket({})));
    expect(refusal).not.toBeInstanceOf(TicketPublicationSecretError);
    // The first thing publication does AFTER the guard is ensure the label
    // contract — the Proxy proves exactly that point was reached.
    expect(String(refusal)).toContain("GhOps.ensureLabel");
  });
});
