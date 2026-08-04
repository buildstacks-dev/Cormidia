// CF-INV-005 — ticket claim uniqueness and accounting commit-point races
// (Wave 2, HB-021). Claims are provisional until provider start, and a manual
// re-arm is never inferred from a label-only edit.

import { afterEach, describe, expect, it } from "vitest";
import {
  beginTicketClaim,
  markTicketProviderStarted,
  planTicketRearm,
} from "../../../src/loop/claim-recovery.js";
import type { GhOps } from "../../../src/loop/github.js";
import {
  readTicketClaimState,
  type TicketClaimState,
} from "../../../src/loop/rehydrate.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const APP = "claim-race-app";
const ISSUE = 41;
const AT = new Date("2026-07-31T12:00:00.000Z");

class ClaimUniquenessViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimUniquenessViolation";
  }
}

function assertSingleProviderCommit(state: TicketClaimState, claimNumber: number): void {
  const commits = (state.events ?? []).filter(
    (event) => event.kind === "provider_started" && event.claimNumber === claimNumber,
  );
  if (commits.length !== 1 || state.claims !== claimNumber) {
    throw new ClaimUniquenessViolation(
      `claim ${claimNumber} has ${commits.length} provider-start commits and durable claims=${state.claims}`,
    );
  }
}

describe("CF-INV-005 — claim uniqueness and re-arm refusal (L2, HB-021)", () => {
  let state: TempStateHome | undefined;

  afterEach(async () => {
    await state?.cleanup();
    state = undefined;
  });

  it("two simultaneous begin attempts produce one lease; provider start commits the claim exactly once", async () => {
    state = await makeTempStateHome({ name: "cf-inv-005-race" });
    const input = {
      root: state.stateHome,
      app: APP,
      issueNumber: ISSUE,
      defaultAllowance: 3,
      now: AT,
    };

    const raced = await Promise.allSettled([beginTicketClaim(input), beginTicketClaim(input)]);
    const winners = raced.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof beginTicketClaim>>> =>
        result.status === "fulfilled" && result.value.allowed,
    );
    const losers = raced.filter((result) => result.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(String((losers[0] as PromiseRejectedResult).reason)).toContain("already has active claim");

    const lease = winners[0]!.value.lease!;
    const provisional = readTicketClaimState(state.stateHome, APP, ISSUE);
    expect(provisional.claims).toBe(0); // acquisition is not paid-work accounting
    expect(provisional.active?.claimId).toBe(lease.claimId);

    const mutation = { root: state.stateHome, app: APP, issueNumber: ISSUE, claimId: lease.claimId, now: AT };
    await Promise.all([markTicketProviderStarted(mutation), markTicketProviderStarted(mutation)]);
    const committed = readTicketClaimState(state.stateHome, APP, ISSUE);
    expect(() => assertSingleProviderCommit(committed, 1)).not.toThrow();
  });

  it("a label-only op:ready edit cannot re-arm durable allowance", async () => {
    state = await makeTempStateHome({ name: "cf-inv-005-rearm" });
    const gh = {
      readIssue: async () => ({
        number: ISSUE,
        title: "fixture",
        body: "fixture",
        labels: ["op:ready"],
      }),
    } as unknown as GhOps;

    await expect(
      planTicketRearm({
        root: state.stateHome,
        app: APP,
        issueNumber: ISSUE,
        reason: "retry after inspection",
        actor: "human",
        priorAllowance: 3,
        intendedAllowance: 4,
        gh,
        now: AT,
      }),
    ).rejects.toThrow("is not parked");
    expect(readTicketClaimState(state.stateHome, APP, ISSUE).claimAllowance).toBeUndefined();
  });

  it("negative control: duplicate provider-start commits make the uniqueness detector FIRE", () => {
    const forged: TicketClaimState = {
      claims: 2,
      outcomes: [],
      events: [
        { at: AT.toISOString(), kind: "provider_started", claimNumber: 1, detail: "first" },
        { at: AT.toISOString(), kind: "provider_started", claimNumber: 1, detail: "duplicate" },
      ],
    };
    expect(() => assertSingleProviderCommit(forged, 1)).toThrow(ClaimUniquenessViolation);
  });
});
