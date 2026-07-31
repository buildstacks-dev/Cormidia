// CF-INV-011 — published issue bodies carry no secret: L2 composition on the
// gh double (HB-016, FLOOR — non-discretionary).
//
// OPERON-INV-011 adversarial seed (a) (validation-design/invariants.md):
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
// PRODUCT DEFECT (deposited as an it.fails tripwire below): as of HB-016 the
// publication path has NO secret guardrail at all — a synthetic seed planted
// in a ticket's goal flows verbatim into the published issue body
// (renderTicketBody applies no scrub; validatePlan checks no patterns; the
// runAutoPlan caller adds none — contrast src/org/episode-planner/brief.ts,
// which REFUSES secret-bearing input with the same canonical list). The
// tripwire asserts the ratified clause: it stays green while the defect
// exists and flips red the moment publication scrubs or refuses, at which
// point it must be promoted to a plain `it`.

import { afterEach, describe, expect, it } from "vitest";
import { GhCliOps } from "../../../src/loop/github.js";
import { publishTickets, type PlanTicket, type TicketPlan } from "../../../src/loop/plan-tickets.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";
import type { SyntheticSecret } from "../../fixtures/synthetic-secret.js";
import {
  detectSecretEgress,
  findSecretEgress,
  makeAllSeeds,
} from "../../unit/cf-inv-011/secret-egress-detector.js";

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

describe("CF-INV-011 — published issue bodies carry no secret (L2 on gh double, HB-016)", () => {
  let handle: GithubDoubleHandle;

  afterEach(async () => {
    await handle.dispose();
  });

  // PRODUCT DEFECT TRIPWIRE — asserts the RATIFIED clause; `it.fails` keeps
  // it green while the product still leaks. When a fix lands (scrub OR
  // refusal at the publication seam), this flips red: promote it to `it` and
  // delete this note.
  it.fails("TRIPWIRE (product defect): a secret-bearing plan never reaches a published issue verbatim — publication scrubs or refuses (INV-011 seed a)", async () => {
    handle = await installGithubDouble({});
    const gh = new GhCliOps(handle.repo, handle.exec);
    const seeds = makeAllSeeds();

    let refused = false;
    try {
      await publishTickets(gh, seededPlan(seeds));
    } catch {
      refused = true; // a refusal satisfies the invariant IF nothing leaked first
    }

    const issues = Object.values(handle.readState().issues);
    if (!refused) {
      // Publication claims success — then the issues must exist AND be clean.
      expect(issues.length).toBe(2);
    }
    for (const issue of issues) {
      detectSecretEgress(
        `published issue #${issue.number}`,
        `${issue.title}\n${issue.body}`,
        seeds,
      );
    }
  });

  it("evidence pin: the leak crosses the real B-01 seam (gh issue create), not a fixture artifact", async () => {
    // Documents the defect's mechanism without encoding it as CORRECT: the
    // double's call log proves the body bytes left the product through the
    // same `gh` argv surface production uses. This test does NOT assert the
    // leak itself and survives the fix unchanged.
    handle = await installGithubDouble({});
    const gh = new GhCliOps(handle.repo, handle.exec);
    const seeds = makeAllSeeds();
    try {
      await publishTickets(gh, seededPlan(seeds));
    } catch {
      // A refusing fix is fine — the seam assertion below still holds for
      // whatever calls were made before the refusal.
    }
    const log = handle.callLog();
    expect(log.length).toBeGreaterThan(0); // non-empty: the seam was exercised
    // Whatever the guardrail's future shape, ticket publication reaches
    // GitHub through `gh issue create` — the exact argv surface production
    // spawns (GhCliOps.createIssue).
    expect(log.some((entry) => entry.op === "issue.create")).toBe(true);
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
