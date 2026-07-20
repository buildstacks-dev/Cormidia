// Regression coverage for ISSUE-011's actor-retry lifecycle break. The exact
// legacy fixture is seeded as stored by the onboarding run: the grant was
// consumed and later revoked while the approval still claimed zero attempts.
// All tests are local file/state-machine exercises; no provider, network, or
// GitHub client is constructed.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACTION_IDENTITY_VERSION,
  ApprovalStore,
  actionHash,
} from "../src/org/approvals.js";
import { composeGate } from "../src/org/gate-compose.js";
import { defaultGate } from "../src/runtime/gate.js";
import type { TurnEvent } from "../src/runtime/types.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

const ACTION = {
  tool: "bash",
  input: {
    command:
      "gh pr create --repo fixture/app --base trunk --head op/change --draft --title Fix",
  },
};
const APPROVAL_ID = "20260720T111411Z-3app";
const GRANT_ID = `grant-${APPROVAL_ID}`;
const APPROVED_AT = "2026-07-20T16:50:00.000Z";
const CONSUMED_AT = "2026-07-20T16:53:14.796Z";
const REVOKED_AT = "2026-07-20T16:57:37.483Z";

describe("actor-retry approval lifecycle", () => {
  it("repairs the exact consumed/unused/revoked legacy record without filesystem surgery", async () => {
    const home = makeOrgHome({
      approvals: {
        decided: {
          [APPROVAL_ID]: decidedFixture(),
        },
        grants: {
          [GRANT_ID]: {
            ...grantFixture(),
            uses: 0,
            consumedAt: CONSUMED_AT,
            revokedAt: REVOKED_AT,
          },
        },
      },
    });
    const store = new ApprovalStore(home.root);
    try {
      await store.reconcile();

      expect((await store.show(APPROVAL_ID)).item.execution).toMatchObject({
        state: "ambiguous",
        executor: "actor-retry",
        attempts: 1,
        attemptedAt: CONSUMED_AT,
        failureCause: "legacy_actor_outcome_unacknowledged",
        nextAction: "reconcile",
      });
      const grant = JSON.parse(readFileSync(home.paths.grant(GRANT_ID), "utf8")) as {
        uses: number;
        consumedAt?: string;
        revokedAt?: string;
      };
      expect(grant).toMatchObject({ uses: 0, revokedAt: REVOKED_AT });
      expect(grant).not.toHaveProperty("consumedAt");

      await store.dispositionExecution({
        id: APPROVAL_ID,
        disposition: "executed",
        reason: "PR #2 was created out of band with the exact approved payload",
        actor: "human/operator",
        now: new Date("2026-07-20T17:00:00.000Z"),
      });
      expect((await store.show(APPROVAL_ID)).item.execution).toMatchObject({
        state: "executed",
        actor: "human/operator",
        nextAction: "none",
      });
    } finally {
      home.cleanup();
    }
  });

  it("claims before consuming, records one attempt, and fails only on an exact explicit outcome", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => APPROVAL_ID });
    const now = new Date(CONSUMED_AT);
    try {
      await store.raise({
        app: "fixture-app",
        role: "builder",
        rule: "external-publishing",
        action: ACTION,
        now: new Date(APPROVED_AT),
      });
      await store.decide(APPROVAL_ID, {
        decision: "approved",
        now: new Date(APPROVED_AT),
      });
      const gate = composeGate(defaultGate, store, {
        app: "fixture-app",
        role: "builder",
        turnId: "retry-turn-1",
        now: () => now,
      });

      expect(gate(ACTION)).toEqual({ allow: true });
      expect((await store.show(APPROVAL_ID)).item.execution).toMatchObject({
        state: "executing",
        attempts: 1,
        actor: "actor-retry/builder/retry-turn-1",
        attemptedAt: CONSUMED_AT,
      });
      expect((await store.show(APPROVAL_ID)).grant).toMatchObject({
        uses: 0,
        consumedAt: CONSUMED_AT,
      });

      const wrongAction: TurnEvent = {
        type: "tool_use",
        name: "bash",
        detail: "different command",
        args: { command: "gh pr list --repo fixture/app" },
        success: false,
      };
      const failedAction: TurnEvent = {
        type: "tool_use",
        name: "bash",
        detail: "approved command",
        args: ACTION.input,
        success: false,
      };
      const settled = await store.settleActorRetryExecutions({
        actor: "actor-retry/builder/retry-turn-1",
        events: [wrongAction, failedAction],
        now,
      });

      expect(settled).toHaveLength(1);
      expect(settled[0]?.execution).toMatchObject({
        state: "failed",
        attempts: 1,
        failureCause: "actor_tool_failed",
        nextAction: "retry_with_disposition",
      });
      expect(gate(ACTION)).toMatchObject({ allow: false, escalate: false });
      expect(await store.listPending()).toEqual([]);
    } finally {
      home.cleanup();
    }
  });

  it("makes a pre-execution/no-outcome actor event ambiguous rather than guessing success", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => APPROVAL_ID });
    const now = new Date(CONSUMED_AT);
    try {
      await store.raise({
        app: "fixture-app",
        role: "builder",
        rule: "external-publishing",
        action: ACTION,
        now: new Date(APPROVED_AT),
      });
      await store.decide(APPROVAL_ID, { decision: "approved", now: new Date(APPROVED_AT) });
      const gate = composeGate(defaultGate, store, {
        app: "fixture-app",
        role: "builder",
        turnId: "retry-turn-2",
        now: () => now,
      });
      expect(gate(ACTION)).toEqual({ allow: true });

      await store.settleActorRetryExecutions({
        actor: "actor-retry/builder/retry-turn-2",
        events: [{
          type: "tool_use",
          name: "bash",
          detail: "pre-execution only",
          args: ACTION.input,
        }],
        now,
      });
      expect((await store.show(APPROVAL_ID)).item.execution).toMatchObject({
        state: "ambiguous",
        attempts: 1,
        failureCause: "actor_outcome_unacknowledged",
        nextAction: "reconcile",
      });
    } finally {
      home.cleanup();
    }
  });

  it("revoking an unused grant terminalizes its approved execution without a consumed+revoked state", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => APPROVAL_ID });
    try {
      await store.raise({
        app: "fixture-app",
        role: "builder",
        rule: "external-publishing",
        action: ACTION,
        now: new Date(APPROVED_AT),
      });
      await store.decide(APPROVAL_ID, { decision: "approved", now: new Date(APPROVED_AT) });
      const revoked = store.revokeGrantSync(GRANT_ID, new Date(REVOKED_AT));
      expect(revoked).toMatchObject({ uses: 0, revokedAt: REVOKED_AT });
      expect(revoked).not.toHaveProperty("consumedAt");
      expect((await store.show(APPROVAL_ID)).item.execution).toMatchObject({
        state: "failed",
        attempts: 0,
        failureCause: "grant_revoked",
        nextAction: "none",
      });
    } finally {
      home.cleanup();
    }
  });

  it("disposition closes the crash window after claim but before grant consumption", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => APPROVAL_ID });
    try {
      await store.raise({
        app: "fixture-app",
        role: "builder",
        rule: "external-publishing",
        action: ACTION,
        now: new Date(APPROVED_AT),
      });
      await store.decide(APPROVAL_ID, { decision: "approved", now: new Date(APPROVED_AT) });
      // beginExecution reproduces a crash immediately after the execution
      // claim: item=executing while the exact grant still has one use.
      await store.beginExecution(APPROVAL_ID, "actor-retry/builder/crash-turn", new Date(CONSUMED_AT));
      await store.dispositionExecution({
        id: APPROVAL_ID,
        disposition: "failed",
        reason: "confirmed no remote effect after the interrupted claim",
        actor: "human/operator",
        now: new Date(REVOKED_AT),
      });

      expect((await store.show(APPROVAL_ID)).item.execution).toMatchObject({
        state: "failed",
        failureCause: "human_disposition",
        nextAction: "none",
      });
      expect((await store.show(APPROVAL_ID)).grant).toMatchObject({
        uses: 0,
        revokedAt: REVOKED_AT,
      });
      expect(store.findMatchingGrantSync({
        app: "fixture-app",
        role: "builder",
        actionHash: actionHash(ACTION),
        now: new Date(REVOKED_AT),
      })).toBeUndefined();
    } finally {
      home.cleanup();
    }
  });
});

function decidedFixture() {
  return {
    id: APPROVAL_ID,
    app: "fixture-app",
    role: "builder",
    turnId: "original-builder-turn",
    rule: "external-publishing",
    action: ACTION,
    raisedAt: APPROVED_AT,
    status: "approved",
    decidedAt: APPROVED_AT,
    decision: "approved",
    grantId: GRANT_ID,
    execution: {
      state: "approved",
      executor: "actor-retry",
      idempotencyKey: `approval:${APPROVAL_ID}:${actionHash(ACTION)}`,
      attempts: 0,
      nextAction: "actor_retry",
    },
  };
}

function grantFixture() {
  return {
    grantId: GRANT_ID,
    approvalId: APPROVAL_ID,
    app: "fixture-app",
    role: "builder",
    actionHash: actionHash(ACTION),
    identityVersion: ACTION_IDENTITY_VERSION,
    expiresAt: "2026-07-21T16:50:00.000Z",
    uses: 1,
    createdAt: APPROVED_AT,
  };
}
