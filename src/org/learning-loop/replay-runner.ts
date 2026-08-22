// Cormidia's worktree-isolated loop replay (src/org/learning-loop/host/replay.ts —
// host-kept: replay workspace and agent-provider execution, kernel contract
// §Cormidia) bound to the kernel's ReplayExecutor seam (replay-executor.ts).
// The kernel asks for one (episode, arm, repetition); the runner finds the
// trusted fixture that replays that episode, runs the bounded build/review
// replay under the arm, and grades the outcome into the typed measurements
// experiments.ts declared — the same definitions, so the kernel's exact
// metric-definition equality holds.

import { sha256HexOfCanonicalJson } from "@cormidia/learning-loop";
import type { ReplayAttemptRequest, ReplayAttemptResult } from "@cormidia/learning-loop";
import type { EvalFixture } from "./host/eval-fixture.js";
import type { ReplayExecutor as LoopReplayExecutor, ReplayExperimentContext } from "./host/replay.js";
import { REPLAY_METRICS, replayMetricDefinition } from "./experiments.js";
import type { CormidiaReplayOutcome, CormidiaReplayRunner } from "./replay-executor.js";

type Measurement = Extract<ReplayAttemptResult, { readonly status: "completed" }>["measurements"][number];

export const LOOP_REPLAY_RUNNER_ID = "loop-replay";
const RUNNER_VERSION = "1.0.0";

export interface LoopReplayRunnerInput {
  /** The worktree replay, resolved on first attempt: declaration needs only
   *  the runner's registration, never a checkout or a provider. */
  readonly executor: () => LoopReplayExecutor;
  readonly fixtures: readonly EvalFixture[];
  readonly context: ReplayExperimentContext;
  /** `full` (build, gates, review) by default; `targeted` is the cheap pre-check. */
  readonly mode?: "full" | "targeted";
}

/** The kernel's durable episode identity for a fixture: `ep_…` (primary projection). */
function episodeRefOf(request: ReplayAttemptRequest): string {
  return request.episodeIdentity.episodeId;
}

export function createLoopReplayRunner(input: LoopReplayRunnerInput): CormidiaReplayRunner {
  const mode = input.mode ?? "full";
  const byEpisode = new Map(input.fixtures.map((fixture) => [fixture.episode_ref, fixture]));
  return {
    id: LOOP_REPLAY_RUNNER_ID,
    version: RUNNER_VERSION,
    configurationDigest: sha256HexOfCanonicalJson({
      app: input.context.app,
      experiment: input.context.experimentId,
      mode,
      fixtures: [...input.fixtures].map((fixture) => fixture.fixture_id).sort(),
    }),
    run: async (request): Promise<CormidiaReplayOutcome> => {
      const episodeRef = episodeRefOf(request);
      const fixture = byEpisode.get(episodeRef);
      if (fixture === undefined) {
        return {
          status: "failed",
          diagnostics: [
            {
              code: "replay.fixture_missing",
              severity: "error",
              message: `no trusted fixture replays episode ${episodeRef}`,
            },
          ],
        };
      }
      const started = Date.now();
      try {
        const attempt = await input.executor().attempt({
          fixture,
          arm: request.arm,
          pair: request.repetition,
          mode,
          experiment: input.context,
        });
        const measurements: Measurement[] = [];
        measurements.push({ metric: REPLAY_METRICS.held_in_pass, value: attempt.heldInPass });
        for (const [name, value] of Object.entries(attempt.metrics)) {
          if (name === REPLAY_METRICS.held_in_pass.name) continue;
          const definition = replayMetricDefinition(name);
          measurements.push({
            metric: definition,
            value: definition.valueType === "boolean" ? value === 1 : value,
          });
        }
        return {
          status: "completed",
          measurements,
          cost: { amount: attempt.costUsd, currency: "USD" },
          durationMs: Date.now() - started,
        };
      } catch (error) {
        return {
          status: "failed",
          diagnostics: [
            {
              code: "replay.attempt_failed",
              severity: "error",
              message: error instanceof Error ? error.message : String(error),
            },
          ],
          durationMs: Date.now() - started,
        };
      }
    },
  };
}
