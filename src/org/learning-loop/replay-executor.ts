// Cormidia replay execution onto the kernel's ReplayExecutor port (kernel
// contract §Replay and outcomes; decision 0028). The kernel mints the
// executor through defineReplayExecutor and verifies that every completed
// attempt attests exactly the request it was given plus this executor's exact
// registration; this adapter builds that attestation faithfully and delegates
// the actual isolated run to a host runner seam. The production runner —
// Cormidia's worktree-isolated loop replay (src/org/learning/replay.ts) —
// binds here in migration phase B; phase A ships the seam and its conformance.

import { defineReplayExecutor, sha256HexOfCanonicalJson } from "@cormidia/learning-loop";
import type {
  Diagnostic,
  Money,
  ReplayAttemptRequest,
  ReplayAttemptResult,
  ReplayAttestation,
  ReplayExecutor,
} from "@cormidia/learning-loop";

type CompletedAttempt = Extract<ReplayAttemptResult, { readonly status: "completed" }>;

export type CormidiaReplayOutcome =
  | {
      readonly status: "completed";
      readonly measurements: CompletedAttempt["measurements"];
      readonly cost?: Money;
      readonly durationMs?: number;
    }
  | {
      readonly status: "failed";
      readonly diagnostics: readonly Diagnostic[];
      readonly cost?: Money;
      readonly durationMs?: number;
    };

/** The host seam: one isolated attempt for one request, graded into typed measurements. */
export interface CormidiaReplayRunner {
  readonly id: string;
  readonly version: string;
  /** Digest of the runner's exact configuration (policy, roles, fixtures roots). */
  readonly configurationDigest: string;
  run(request: ReplayAttemptRequest): Promise<CormidiaReplayOutcome>;
}

interface Registration {
  readonly id: string;
  readonly version: string;
  readonly registrationDigest: string;
}

/** The attestation the kernel verifies: every request digest plus the exact registration. */
export function attestRequest(request: ReplayAttemptRequest, registration: Registration): ReplayAttestation {
  return {
    executor: { ...registration },
    experimentId: request.experimentId,
    definitionDigest: request.definitionDigest,
    episodeId: request.episodeId,
    arm: request.arm,
    repetition: request.repetition,
    fingerprintDigest: request.fingerprintDigest,
    fixtureDigest: request.fixtureDigest,
    baselineSnapshotDigest: request.baselineSnapshotDigest,
    graderDigest: request.graderDigest,
    sideEffectPolicyDigest: request.sideEffectCapability.policyDigest,
    attestationNonce: request.sideEffectCapability.attestationNonce,
  };
}

export function createCormidiaReplayExecutor(runner: CormidiaReplayRunner): ReplayExecutor {
  let registration: Registration | undefined;
  const executor = defineReplayExecutor({
    id: `cormidia/${runner.id}`,
    version: runner.version,
    configurationDigest: sha256HexOfCanonicalJson({
      kind: "cormidia-replay-executor",
      runner: runner.configurationDigest,
    }),
    attempt: async (request) => {
      if (registration === undefined) throw new Error("learning-loop: replay executor used before registration");
      const attestation = attestRequest(request, registration);
      const outcome = await runner.run(request);
      const costAndDuration = {
        ...(outcome.cost !== undefined ? { cost: outcome.cost } : {}),
        ...(outcome.durationMs !== undefined ? { durationMs: outcome.durationMs } : {}),
      };
      if (outcome.status === "failed") {
        return { status: "failed", attestation, diagnostics: outcome.diagnostics, ...costAndDuration };
      }
      return { status: "completed", attestation, measurements: outcome.measurements, ...costAndDuration };
    },
  });
  registration = { id: executor.id, version: executor.version, registrationDigest: executor.registrationDigest };
  return executor;
}
