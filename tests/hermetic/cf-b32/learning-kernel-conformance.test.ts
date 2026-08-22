// CF-C-B32-L2 (L2, contract): the kernel's own conformance suites — part of
// its public API (governed-learning-loop AGENTS.md) — run unchanged against
// Cormidia's adapters on real temp homes: the kernel file store under the
// state home, the OKF concept destination on a temp org learning root, and
// the replay executor over a deterministic host runner. Every suite is
// injected the caller's { describe, expect, it } (runtime-safe /testing).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { candidateContentDigest, parseCandidate, sha256HexOfCanonicalJson } from "@cormidia/learning-loop";
import type { Candidate, PreparedEffect, PublicationDestination, PublicationReceipt } from "@cormidia/learning-loop";
import { createFileStore } from "@cormidia/learning-loop/node";
import {
  runLearningStoreConformance,
  runPublicationDestinationConformance,
  runReplayExecutorConformance,
} from "@cormidia/learning-loop/testing";
import { createOkfConceptDestination } from "../../../src/org/learning-loop/destination-okf.js";
import { learningLoopStateDir } from "../../../src/org/learning-loop/loop.js";
import { createCormidiaReplayExecutor } from "../../../src/org/learning-loop/replay-executor.js";
import { orgLearningRoot } from "../../../src/org/learning-loop/host/concepts.js";
import { makeTestClock } from "../../fixtures/clock.js";

const roots: string[] = [];
async function freshRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `cormidia-cf-b32-${label}-`));
  roots.push(root);
  return root;
}
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const testApi = { describe, expect, it };

describe("CF-C-B32-L2 kernel store conformance on the Cormidia state-home placement", () => {
  runLearningStoreConformance(async () => {
    const stateHome = await freshRoot("store");
    return createFileStore({ rootDir: join(learningLoopStateDir(stateHome), "store") });
  }, testApi);
});

describe("CF-C-B32-L2 OKF concept destination conformance on a temp org learning root", () => {
  runPublicationDestinationConformance(async () => {
    const root = await freshRoot("okf");
    const clock = makeTestClock("2026-08-21T10:00:00.000Z");
    return createOkfConceptDestination({
      id: "okf-concept:org",
      root: orgLearningRoot(join(root, "org-home")),
      receiptsDir: join(learningLoopStateDir(join(root, "state-home")), "receipts", "okf-concept-org"),
      defaultScope: "org",
      clock: { now: () => clock.nowIso() },
    });
  }, testApi);
});

describe("CF-C-B32-L2 replay executor conformance over a deterministic host runner", () => {
  runReplayExecutorConformance(
    () =>
      createCormidiaReplayExecutor({
        id: "deterministic-runner",
        version: "1.0.0",
        configurationDigest: sha256HexOfCanonicalJson({ runner: "deterministic" }),
        run: (request) =>
          Promise.resolve({
            status: "completed",
            measurements: [
              {
                metric: { name: "replay_completed", valueType: "boolean", unit: "pass", aggregation: "all" },
                value: request.arm === "control" || request.arm === "treatment",
              },
            ],
          }),
      }),
    testApi,
  );
});

/** The receipt-proof oracle the destination conformance suite applies (kernel
 *  `publicationReceiptMismatchReasons`): a receipt must name the destination,
 *  effect, target, payload digest, base, and key it was asked to apply. */
function receiptMismatches(
  receipt: PublicationReceipt,
  expected: { readonly destinationId: string; readonly effect: PreparedEffect; readonly idempotencyKey: string },
): string[] {
  const out: string[] = [];
  if (receipt.destinationId !== expected.destinationId) out.push("destinationId");
  if (receipt.effectId !== expected.effect.id) out.push("effectId");
  if (receipt.target !== expected.effect.target) out.push("target");
  if (receipt.payloadDigest !== expected.effect.payloadDigest) out.push("payloadDigest");
  if (receipt.idempotencyKey !== expected.idempotencyKey) out.push("idempotencyKey");
  if (receipt.expectedBase !== expected.effect.expectedBase) out.push("expectedBase");
  return out;
}

function syntheticCandidate(destinationId: string): Candidate {
  const bound = {
    scope: [{ type: "org", id: "acme" }],
    problem: "problem",
    hypothesis: "hypothesis",
    evidenceIds: ["cormidia-episodes/gate:ep_web_ticket_0042:0"],
    intervention: { destinationId, kind: "okf_concept", content: { text: "Lesson." }, rollbackIntent: "disable" },
    proposedRisk: "T1" as const,
  };
  return parseCandidate({
    ...bound,
    schemaVersion: 1,
    id: "cand-control",
    proposedBy: { id: "role:distiller", kind: "agent", independenceDomain: "runtime:codex" },
    proposerAttestationDigest: "c".repeat(64),
    proposedAt: "2026-08-21T12:00:00.000Z",
    contentDigest: candidateContentDigest(bound),
  });
}

describe("CF-C-B32-L2 receipt proof is red-capable against the real adapter", () => {
  it("negative control: a wrapper answering with another effect's receipt is caught by the receipt-proof oracle", async () => {
    const root = await freshRoot("control");
    const clock = makeTestClock("2026-08-21T10:00:00.000Z");
    const real = createOkfConceptDestination({
      id: "okf-concept:org",
      root: orgLearningRoot(join(root, "org-home")),
      receiptsDir: join(learningLoopStateDir(join(root, "state-home")), "receipts", "okf-concept-org"),
      defaultScope: "org",
      clock: { now: () => clock.nowIso() },
    });
    const [effect] = await real.prepare({ candidate: syntheticCandidate(real.id) });
    if (effect === undefined) throw new Error("prepare returned no effect");
    const honest = await real.applyEffect({ effect, idempotencyKey: "control-key" });
    expect(receiptMismatches(honest, { destinationId: real.id, effect, idempotencyKey: "control-key" })).toEqual([]);

    // Seeded violation: a destination that applies one effect but reports another's digest under a different key.
    const lying: PublicationDestination = {
      id: real.id,
      prepare: (input) => real.prepare(input),
      applyEffect: async (input) => ({
        ...(await real.applyEffect(input)),
        payloadDigest: "0".repeat(64),
        idempotencyKey: "other-key",
      }),
    };
    const forged = await lying.applyEffect({ effect, idempotencyKey: "control-key" });
    expect(receiptMismatches(forged, { destinationId: lying.id, effect, idempotencyKey: "control-key" })).toEqual([
      "payloadDigest",
      "idempotencyKey",
    ]);
  });
});
