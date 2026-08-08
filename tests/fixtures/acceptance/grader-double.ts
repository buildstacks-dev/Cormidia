// fixtures/acceptance/grader-double.ts — the scripted S-11 acceptance grader.
//
// The double is a real `Runtime` at the ratified adapter seam (B-02/03/04 —
// B-29 §"Grader transport" mints no new provider contract), so the campaign's
// own construction, disjointness and confinement code runs unmodified. Its
// `kind` is settable because provider FAMILY is the disjointness unit: a
// grader whose family equals the graded turn's is the CF-INV-ACC-2 negative
// control, and it can only be seeded by choosing the double's kind.
//
// It records every assembled input verbatim. Confinement (B-28 §2 clause 1) is
// then checked against what the grader was actually handed rather than against
// what the campaign intended to hand it.

import type { Runtime, RuntimeKind, TurnHooks, TurnRequest, TurnResult } from "../../../src/runtime/types.js";

/** The scripted output shapes. Each names a clause it exists to violate. */
export type GraderPayloadKind =
  | "well-formed"
  /** B-29 §3 — score without the mandatory evidence citation; discarded. */
  | "citation-less"
  /** B-29 §4 — unparseable output; typed error, axis `ungraded`. */
  | "malformed"
  /** B-29 §4 — two result markers in one output; never merged. */
  | "multi-marker"
  /** B-29 §3 — cites an artifact absent from the declared read set. */
  | "invents-artifact"
  /** Rubric §7 rule 4 — an O-5 payload asserting an unsupported claim. */
  | "fabricated-claim";

export interface ScriptedGraderResult {
  axis: string;
  kind?: GraderPayloadKind;
  score?: 0 | 1 | 2 | 3;
  justification?: string;
  citations?: string[];
  /** For `fabricated-claim`: the unsupported assertion the payload makes. */
  claim?: string;
}

export interface RecordedGraderTurn {
  axis: string;
  workdir: string;
  assembledInput: string;
  harness: RuntimeKind;
  model: string;
}

/** The exact bytes the grader is handed: prompt plus every context component
 *  an adapter would render. Confinement scans run over this string. */
export function assembledInputText(req: TurnRequest): string {
  return [req.task, ...req.context.taste, ...req.context.memoryExcerpts].join("\n");
}

function payload(result: ScriptedGraderResult): string {
  const axis = result.axis;
  const score = result.score ?? 2;
  const justification = result.justification ?? `${axis} is supported by the cited artifacts.`;
  const citations = result.citations ?? ["diff", "run-journal"];
  const body = (extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ axis, score, justification, citations, ...extra });
  switch (result.kind ?? "well-formed") {
    case "citation-less":
      return JSON.stringify({ axis, score, justification, citations: [] });
    case "malformed":
      return `{"axis":"${axis}","score":`;
    case "multi-marker":
      return `${body()}\n${body({ score: score === 3 ? 0 : 3 })}`;
    case "invents-artifact":
      return JSON.stringify({ axis, score, justification, citations: ["artifacts/never-declared.md"] });
    case "fabricated-claim":
      return body({ claim: result.claim ?? "every acceptance test passes on a clean clone" });
    default:
      return body();
  }
}

export class ScriptedGraderRuntime implements Runtime {
  readonly kind: RuntimeKind;
  readonly recorded: RecordedGraderTurn[] = [];

  constructor(
    private readonly results: readonly ScriptedGraderResult[],
    kind: RuntimeKind = "codex",
  ) {
    this.kind = kind;
  }

  async runTurn(req: TurnRequest, _hooks: TurnHooks): Promise<TurnResult> {
    const index = this.recorded.length;
    const scripted = this.results[index];
    if (scripted === undefined) {
      throw new Error(`ScriptedGraderRuntime: over-called — only ${this.results.length} axis result(s) scripted`);
    }
    this.recorded.push({
      axis: scripted.axis,
      workdir: req.workdir,
      assembledInput: assembledInputText(req),
      harness: req.assignment?.harness ?? req.role.runtime,
      model: req.assignment?.model ?? req.role.model,
    });
    return {
      status: "completed",
      summary: payload(scripted),
      artifacts: [],
      session: { runtime: this.kind, id: `grader-session-${index + 1}` },
      usage: {
        tokensIn: 4000,
        tokensOut: 300,
        costUsd: 0.12,
        subagentTurns: 0,
        wallClockMs: 2100,
        quality: "complete",
      },
      escalations: [],
    };
  }
}
