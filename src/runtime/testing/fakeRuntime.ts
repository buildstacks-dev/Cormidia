// The canonical scriptable Runtime test double (build plan M0.2).
//
// PURPOSE.md's "single-runtime orgs are a first-class profile" decision makes
// the gate and per-turn telemetry *adapter-level conformance requirements* —
// every Runtime (claude/codex/pi, and every test that stands in for one) must
// satisfy the same contract. FakeRuntime is that contract's reference
// implementation: exactly one scriptable double exists in this repo (see
// TODO.md item M0.2's grep check), reused by adapter-conformance tests
// (M0.4) and any later test that needs a Runtime with zero SDK/network
// dependency.
//
// See src/runtime/types.ts (Runtime/TurnRequest/TurnHooks contract) and
// docs/loop.md §2 (fresh session per pass; hooks.gate must see every tool
// action including subagents'; adapters must transport multi-hundred-KB
// task payloads intact).

import type {
  GateDecision,
  Runtime,
  RuntimeKind,
  ToolAction,
  TurnEvent,
  TurnHooks,
  TurnRequest,
  TurnResult,
} from "../types.js";

/** One tool action a scripted turn attempts, routed through `hooks.gate` in
 *  declaration order. Marking `fromSubagent` makes FakeRuntime emit
 *  `onEvent({type:"subagent", ...})` immediately before the gate call, so a
 *  test can prove the gate sees a subagent-issued action exactly like a
 *  top-level one (TurnHooks.gate's doc comment; docs/loop.md §2). */
export interface ScriptedToolAction {
  action: ToolAction;
  fromSubagent?: boolean;
}

/** One scripted response to a single `runTurn()` call. When `toolActions` is
 *  given, each is played through `hooks.gate`, in order, before `result` is
 *  returned; every denial with `escalate: true` becomes an entry in the
 *  returned TurnResult's `escalations` — computed from what the gate
 *  actually decided, not hand-duplicated. When `toolActions` is omitted,
 *  `result` (including whatever `escalations` it carries) is returned
 *  verbatim. */
export interface ScriptedTurn {
  toolActions?: ScriptedToolAction[];
  result: TurnResult;
}

/** Everything FakeRuntime observed for one `runTurn()` call: the full
 *  TurnRequest/TurnHooks recording later tests (and the M0.4 conformance
 *  harness) assert against. */
export interface RecordedCall {
  req: TurnRequest;
  hooks: TurnHooks;
  /** Events FakeRuntime emitted via `hooks.onEvent`, in emission order. */
  events: TurnEvent[];
  /** Every `hooks.gate` invocation made during this call, paired with the
   *  decision the (test-supplied) gate returned, in call order. */
  gateCalls: { action: ToolAction; decision: GateDecision }[];
}

/**
 * The canonical scriptable `Runtime` double. Construct with an ordered list
 * of `ScriptedTurn`s; each `runTurn()` call consumes the next one. Calling it
 * more times than scripted throws a clear error rather than returning
 * `undefined` or silently reusing the last script.
 */
export class FakeRuntime implements Runtime {
  readonly kind: RuntimeKind;
  /** One entry per `runTurn()` call so far, in call order. */
  readonly calls: RecordedCall[] = [];

  private readonly turns: ScriptedTurn[];

  constructor(turns: ScriptedTurn[], kind: RuntimeKind = "claude") {
    this.turns = turns;
    this.kind = kind;
  }

  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    const index = this.calls.length;
    const turn = this.turns[index];
    if (turn === undefined) {
      throw new Error(
        `FakeRuntime: over-called — only ${this.turns.length} scripted turn(s) ` +
          `but this is call #${index + 1}. Script one ScriptedTurn per expected runTurn() call.`,
      );
    }

    const record: RecordedCall = { req, hooks, events: [], gateCalls: [] };
    this.calls.push(record);

    if (turn.toolActions === undefined) {
      return turn.result;
    }

    const escalations: TurnResult["escalations"] = [];
    for (const scripted of turn.toolActions) {
      if (scripted.fromSubagent) {
        const event: TurnEvent = {
          type: "subagent",
          detail: `subagent attempting: ${scripted.action.tool}`,
        };
        record.events.push(event);
        hooks.onEvent?.(event);
      }

      const decision = hooks.gate(scripted.action);
      record.gateCalls.push({ action: scripted.action, decision });
      if (!decision.allow && decision.escalate) {
        escalations.push({ action: scripted.action, reason: decision.reason });
      }
    }

    return { ...turn.result, escalations };
  }
}
