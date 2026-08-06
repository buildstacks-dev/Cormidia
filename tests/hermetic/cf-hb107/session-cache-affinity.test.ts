// HB-107 — immutable-prefix/delta manifests, exact session affinity, and
// cache telemetry. C-OP-BATCH §4–5; CORMIDIA-INV-003/005/006/008/016; B-22.

import { afterEach, describe, expect, it } from "vitest";
import { stableHash } from "../../../src/loop/episode-plan.js";
import type { TurnAssignment, TurnUsage } from "../../../src/runtime/types.js";
import {
  ExecutionAffinityError,
  cacheAffinityAdvice,
  cacheTelemetryFromUsage,
  createExecutionContextAffinityManifest,
  decideSessionReuse,
  prepareExecutionAffinityTurn,
  readExecutionAffinityRecord,
  recoverExecutionAffinityTurn,
  settleExecutionAffinityTurn,
  type ExecutionCompatibilityIdentity,
  type SessionReuseCandidate,
} from "../../../src/org/execution-affinity.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const AT = "2026-08-04T08:00:00.000Z";
const SETTLED_AT = "2026-08-04T08:01:00.000Z";
const ASSIGNMENT: TurnAssignment = {
  harness: "codex",
  model: "gpt-5.6-sol",
  effort: "high",
};
const homes: TempStateHome[] = [];

afterEach(async () => Promise.all(homes.splice(0).map((home) => home.cleanup())));

describe("HB-107 — exact session compatibility and cache evidence", () => {
  it("requires exact app/role/assignment/operation/prefix identity and never resumes Builder state as Reviewer", () => {
    const manifest = makeManifest("unit-a", "builder");
    const candidate = makeCandidate(manifest.compatibility, manifest.immutablePrefixSha256, "hit");
    expect(
      decideSessionReuse({
        candidate,
        requested: manifest.compatibility,
        immutablePrefixSha256: manifest.immutablePrefixSha256,
      }),
    ).toMatchObject({ reuse: true, session: { id: "builder-session" } });

    const mismatches: Array<[Partial<ExecutionCompatibilityIdentity>, string]> = [
      [{ app: "other-app" }, "app_mismatch"],
      // Seeded negative control: role is the only changed field. An unsafe
      // session-id-only selector would hand Builder state to Reviewer.
      [{ role: "reviewer" }, "role_mismatch"],
      [{ assignment: { ...ASSIGNMENT, model: "different-model" } }, "assignment_mismatch"],
      [{ operation: "delivery/review" }, "operation_mismatch"],
    ];
    for (const [change, reason] of mismatches) {
      const requested = { ...manifest.compatibility, ...change };
      const unsafeSessionIdOnlyReuse = candidate.session;
      expect(unsafeSessionIdOnlyReuse.id).toBe("builder-session");
      expect(
        decideSessionReuse({
          candidate,
          requested,
          immutablePrefixSha256: manifest.immutablePrefixSha256,
        }),
      ).toEqual({ reuse: false, reason });
    }
    expect(
      decideSessionReuse({
        candidate,
        requested: manifest.compatibility,
        immutablePrefixSha256: "f".repeat(64),
      }),
    ).toEqual({ reuse: false, reason: "immutable_prefix_mismatch" });
  });

  it("records hit/miss/unknown but cache evidence cannot change the reuse verdict", () => {
    expect(cacheTelemetryFromUsage(usage({ cacheReadTokens: 120 })).measurement).toBe("hit");
    expect(cacheTelemetryFromUsage(usage({ cacheReadTokens: 0 })).measurement).toBe("miss");
    expect(cacheTelemetryFromUsage(usage({})).measurement).toBe("unknown");
    expect(cacheTelemetryFromUsage(usage({ cacheReadTokens: 120, quality: "unavailable" })).measurement).toBe(
      "unknown",
    );

    const manifest = makeManifest("unit-a", "builder");
    const decisions = (["hit", "miss", "unknown"] as const).map((measurement) =>
      decideSessionReuse({
        candidate: makeCandidate(manifest.compatibility, manifest.immutablePrefixSha256, measurement),
        requested: manifest.compatibility,
        immutablePrefixSha256: manifest.immutablePrefixSha256,
      }),
    );
    expect(decisions.map((decision) => decision.reuse)).toEqual([true, true, true]);
    expect(
      cacheAffinityAdvice(makeCandidate(manifest.compatibility, manifest.immutablePrefixSha256, "hit").cache),
    ).toEqual({
      kind: "cost_affinity_only",
      advice: "observed_prefix_reuse",
      correctnessAuthority: false,
    });
  });

  it("survives crashes on both persistence sides and refuses incompatible settlement", async () => {
    const home = await stateHome();
    const manifest = makeManifest("unit-crash", "builder");
    const prepare = () =>
      prepareExecutionAffinityTurn({
        root: home.stateHome,
        recordId: "batch-a:unit-crash:build",
        batchId: "batch-a",
        episodeId: "episode-a",
        planVersion: 1,
        stepId: "build",
        manifest,
        preparedAt: AT,
      });
    await expect(
      prepareExecutionAffinityTurn({
        root: home.stateHome,
        recordId: "batch-a:unit-crash:build",
        batchId: "batch-a",
        episodeId: "episode-a",
        planVersion: 1,
        stepId: "build",
        manifest,
        preparedAt: AT,
        fault: () => {
          throw new Error("SIMULATED CRASH after prepare");
        },
      }),
    ).rejects.toThrow(/SIMULATED CRASH/);

    const afterPrepareCrash = await readExecutionAffinityRecord(home.stateHome, "batch-a:unit-crash:build");
    expect(afterPrepareCrash?.state).toBe("prepared");
    expect(recoverExecutionAffinityTurn(afterPrepareCrash!)).toEqual({
      action: "rerun_without_session",
      reason: "candidate_unsettled",
    });
    expect((await prepare()).state).toBe("prepared");

    // Seeded incompatible-session control: runtime identity is part of the
    // accepted assignment and cannot be repaired from cache evidence.
    await expectCode(
      () =>
        settleExecutionAffinityTurn({
          root: home.stateHome,
          recordId: "batch-a:unit-crash:build",
          providerTurnId: "turn-a",
          settlementId: "settlement-a",
          providerOutcome: "completed",
          session: { runtime: "claude", id: "wrong-runtime" },
          usage: usage({ cacheReadTokens: 500 }),
          settledAt: SETTLED_AT,
        }),
      "affinity_session_mismatch",
    );

    await expect(
      settleExecutionAffinityTurn({
        root: home.stateHome,
        recordId: "batch-a:unit-crash:build",
        providerTurnId: "turn-a",
        settlementId: "settlement-a",
        providerOutcome: "completed",
        session: { runtime: "codex", id: "builder-session" },
        usage: usage({ cacheReadTokens: 500 }),
        settledAt: SETTLED_AT,
        fault: () => {
          throw new Error("SIMULATED CRASH after settlement");
        },
      }),
    ).rejects.toThrow(/SIMULATED CRASH/);

    const afterSettlementCrash = await readExecutionAffinityRecord(home.stateHome, "batch-a:unit-crash:build");
    expect(afterSettlementCrash?.state).toBe("settled");
    const recovery = recoverExecutionAffinityTurn(afterSettlementCrash!);
    expect(recovery.action).toBe("consider_exact_reuse");
    if (recovery.action === "consider_exact_reuse") {
      expect(
        decideSessionReuse({
          candidate: recovery.candidate,
          requested: manifest.compatibility,
          immutablePrefixSha256: manifest.immutablePrefixSha256,
        }).reuse,
      ).toBe(true);
    }

    const suspendedManifest = makeManifest("unit-suspended", "builder");
    await prepareExecutionAffinityTurn({
      root: home.stateHome,
      recordId: "batch-a:unit-suspended:build",
      batchId: "batch-a",
      episodeId: "episode-suspended",
      planVersion: 1,
      stepId: "build",
      manifest: suspendedManifest,
      preparedAt: AT,
    });
    const suspended = await settleExecutionAffinityTurn({
      root: home.stateHome,
      recordId: "batch-a:unit-suspended:build",
      providerTurnId: "turn-suspended",
      settlementId: "settlement-suspended",
      providerOutcome: "suspended",
      session: { runtime: "codex", id: "same-pass-continuation-only" },
      usage: usage({ cacheReadTokens: 500 }),
      settledAt: SETTLED_AT,
    });
    expect(recoverExecutionAffinityTurn(suspended)).toEqual({
      action: "no_cross_unit_reuse",
      reason: "provider_not_completed",
    });
  });

  it("keeps required authority in the ordered prefix/delta manifest", () => {
    const first = makeManifest("unit-a", "builder");
    const reordered = createExecutionContextAffinityManifest({
      unitId: "unit-a",
      compatibility: first.compatibility,
      immutablePrefix: [...first.immutablePrefix].reverse().map(({ position: _position, ...entry }) => entry),
      unitDelta: first.unitDelta.map(({ position: _position, ...entry }) => entry),
      requiredAuthorityRefs: first.requiredAuthorityRefs,
    });
    expect(reordered.immutablePrefixSha256).not.toBe(first.immutablePrefixSha256);

    // Seeded eviction control: a prose reference in requiredAuthorityRefs is
    // not enough; the content-hashed component itself must remain present.
    expect(() =>
      createExecutionContextAffinityManifest({
        unitId: "unit-a",
        compatibility: first.compatibility,
        immutablePrefix: [
          {
            id: "shared",
            kind: "shared_context",
            sourceRef: "context:shared",
            sha256: stableHash("shared"),
          },
        ],
        unitDelta: [
          {
            id: "delta",
            kind: "unit_delta",
            sourceRef: "unit:delta",
            sha256: stableHash("delta"),
          },
        ],
        requiredAuthorityRefs: ["authority:unit-a"],
      }),
    ).toThrowError(expect.objectContaining({ code: "affinity_manifest_invalid" }));
  });
});

function makeManifest(unitId: string, role: string) {
  return createExecutionContextAffinityManifest({
    unitId,
    compatibility: {
      app: "campaign-app",
      role,
      assignment: ASSIGNMENT,
      operation: "delivery/build",
    },
    immutablePrefix: [
      {
        id: "org-authority",
        kind: "authority",
        sourceRef: "authority:org",
        sha256: stableHash("org authority"),
      },
      {
        id: "shared-context",
        kind: "shared_context",
        sourceRef: "context:shared",
        sha256: stableHash("shared context"),
      },
    ],
    unitDelta: [
      {
        id: "unit-authority",
        kind: "authority",
        sourceRef: `authority:${unitId}`,
        sha256: stableHash(`authority ${unitId}`),
      },
      {
        id: "unit-validation",
        kind: "validation",
        sourceRef: `validation:${unitId}`,
        sha256: stableHash(`validation ${unitId}`),
      },
    ],
    requiredAuthorityRefs: ["authority:org", `authority:${unitId}`, `validation:${unitId}`],
  });
}

function makeCandidate(
  compatibility: ExecutionCompatibilityIdentity,
  immutablePrefixSha256: string,
  measurement: "hit" | "miss" | "unknown",
): SessionReuseCandidate {
  const cache = cacheTelemetryFromUsage(
    measurement === "unknown" ? usage({}) : usage({ cacheReadTokens: measurement === "hit" ? 100 : 0 }),
  );
  return {
    recordId: `candidate-${measurement}`,
    compatibility: structuredClone(compatibility),
    immutablePrefixSha256,
    session: { runtime: compatibility.assignment.harness, id: "builder-session" },
    cache,
  };
}

function usage(overrides: Partial<TurnUsage>): TurnUsage {
  return {
    tokensIn: 1_000,
    tokensOut: 100,
    costUsd: 0.25,
    subagentTurns: 0,
    wallClockMs: 500,
    quality: "complete",
    ...overrides,
  };
}

async function stateHome(): Promise<TempStateHome> {
  const home = await makeTempStateHome({ name: "hb107" });
  homes.push(home);
  return home;
}

async function expectCode(operation: () => unknown | Promise<unknown>, code: string): Promise<void> {
  try {
    await operation();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ExecutionAffinityError);
    expect((error as ExecutionAffinityError).code).toBe(code);
  }
}
