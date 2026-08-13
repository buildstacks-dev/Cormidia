// Shared scaffolding for the CF-B30 / CF-J22 / CF-J23 jobs families (M18).
//
// Renumbered at the 2026-08-07 harness revision: the jobs boundary is B-30
// and the jobs journeys are J-22/J-23. B-23 is now the OpenCode adapter and
// J-21 the L-ACC campaign, so the old ids named the wrong things.
//
// The double sits at the ratified adapter boundary (B-02/03/04): it is a real
// `Runtime` implementation whose scripted turns may write files, because a job
// step's whole observable effect is the files it leaves behind. Product code
// under test runs unmodified.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { Runtime, RuntimeKind, TurnRequest, TurnResult, TurnHooks } from "../../../src/runtime/types.js";
import type { RoleConfig } from "../../../src/runtime/types.js";
import { terminalStopFields } from "../../../src/runtime/types.js";

/** One scripted step outcome: files it writes, then the turn it returns. */
export interface ScriptedJobTurn {
  /** Relative path -> content, written into the job workdir before returning. */
  writes?: Record<string, string>;
  status?: TurnResult["status"];
  summary?: string;
  costUsd?: number;
  errorCode?: string;
  /** Throw instead of returning, to exercise the provider-error branch. */
  throws?: string;
}

export interface RecordedJobTurn {
  task: string;
  harness: RuntimeKind;
  model: string;
  effort: string;
}

export class ScriptedJobRuntime implements Runtime {
  readonly kind: RuntimeKind;
  readonly recorded: RecordedJobTurn[] = [];

  constructor(
    private readonly turns: ScriptedJobTurn[],
    private readonly workdir: string,
    kind: RuntimeKind = "claude",
  ) {
    this.kind = kind;
  }

  async runTurn(req: TurnRequest, _hooks: TurnHooks): Promise<TurnResult> {
    const index = this.recorded.length;
    const scripted = this.turns[index];
    this.recorded.push({
      task: req.task,
      harness: req.assignment?.harness ?? req.role.runtime,
      model: req.assignment?.model ?? req.role.model,
      effort: req.assignment?.effort ?? req.role.effort,
    });
    if (scripted === undefined) {
      throw new Error(`ScriptedJobRuntime: over-called — only ${this.turns.length} turn(s) scripted`);
    }
    if (scripted.throws !== undefined) throw new Error(scripted.throws);

    for (const [path, content] of Object.entries(scripted.writes ?? {})) {
      const target = join(this.workdir, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }

    return {
      ...terminalStopFields({
        status: scripted.status ?? "completed",
        ...(scripted.status === "interrupted" ? { interruptedReason: "time_limit" as const } : {}),
      }),
      summary: scripted.summary ?? `step ${index + 1} done`,
      artifacts: [],
      session: { runtime: this.kind, id: `session-${index + 1}` },
      usage: {
        tokensIn: 1000,
        tokensOut: 200,
        costUsd: scripted.costUsd ?? 0.25,
        subagentTurns: 0,
        wallClockMs: 1234,
        quality: "complete",
      },
      escalations: [],
      ...(scripted.errorCode === undefined ? {} : { errorCode: scripted.errorCode }),
    };
  }
}

/** The proposed `operator` role: delegation closed, ceiling at the owner-approved
 * bound. Tests bind to this shape so a roles.yaml change surfaces here. */
export function operatorRole(): RoleConfig {
  return {
    name: "operator",
    runtime: "claude",
    model: "claude-opus-4-8",
    effort: "high",
    delegation: { allow: [] },
    triggers: [{ manual: true }],
    outputs: ["job-step-artifacts"],
    maxTurnBudgetUsd: 50,
  };
}

export interface JobWorkspace {
  workdir: string;
  cleanup(): Promise<void>;
}

export async function makeJobWorkdir(): Promise<JobWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-job-work-"));
  return {
    workdir: root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** A monotonic clock so journal timestamps are ordered and deterministic. */
export function tickingClock(start = "2026-08-07T09:00:00.000Z"): () => Date {
  let ms = new Date(start).getTime();
  return () => {
    ms += 1000;
    return new Date(ms);
  };
}
