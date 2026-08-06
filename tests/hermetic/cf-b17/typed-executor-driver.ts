// CF-B17 typed-executor driver — drives the REAL ApprovalStore execution
// lifecycle against the scripted external target, step for step along the
// ratified B-17 contract (contracts/B-17-typed-executor.md §1–§5). Durable
// state lives ONLY in the product store (claim, grant consumption, terminal
// acknowledgement, audit log); this module owns nothing durable.
//
// Why a driver exists at all: the product has no non-GitHub external-target
// executor yet — exactly why the boundary's live cell is BLOCKED:B-17-L3.
// The store's typed execution machine (approved → executing → executed |
// failed | ambiguous, at-most-once claims, single-use grants) IS product
// truth and is what these suites falsify; the driver supplies only the
// contract-mandated glue an executor for this boundary must have. Each rule
// below cites its clause; none encodes a guess beyond the ratified text.
// (The durable record keeps the executor kind the product minted — there is
// no non-GitHub executor kind to claim, and inventing one would encode
// unratified product truth.)

import { ApprovalStore, actionHash } from "../../../src/org/approvals.js";
import { grantScopeText } from "../../../src/org/gate-compose.js";
import {
  ScriptedExternalTarget,
  TargetAuthError,
  TargetConnectionLostError,
  type TargetMarker,
} from "./scripted-target.js";

export const TYPED_EXECUTOR_ACTOR = "orchestrator/typed-external";

export type TypedExecutionOutcome =
  | { status: "executed"; remoteRef: string }
  /** Accepted by the asynchronous target; completion is a separately verified
   *  fact (§2) — the durable record deliberately remains `executing`. */
  | { status: "accepted" }
  | { status: "ambiguous"; reason: string }
  | { status: "failed"; cause: string }
  | { status: "skipped"; reason: string };

export interface TypedExecutionInput {
  store: ApprovalStore;
  approvalId: string;
  target: ScriptedExternalTarget;
  now?: () => Date;
}

function describeMarkers(markers: readonly TargetMarker[]): string {
  return markers.map((marker) => (marker.type === "completion" ? `completion:${marker.ref}` : "acceptance")).join(", ");
}

export async function executeTypedExternalAction(input: TypedExecutionInput): Promise<TypedExecutionOutcome> {
  const clock = input.now ?? (() => new Date());
  const { store, target, approvalId } = input;
  const { item } = await store.show(approvalId);
  const execution = item.execution;
  if (item.decision !== "approved" || execution === undefined) {
    return { status: "skipped", reason: "not an approved execution record" };
  }
  const key = execution.idempotencyKey;

  /** §4 marker reconciliation, shared by the crashed-attempt path and the
   *  pre-attempt check. `from` is the durable state being reconciled. */
  const reconcile = async (from: "executing" | "ambiguous"): Promise<TypedExecutionOutcome> => {
    const markers = target.markers(key);
    const completions = markers.filter((marker) => marker.type === "completion");
    if (markers.length === 1 && completions.length === 1) {
      // §4: a completion marker/evidence → executed. Converts a crashed
      // attempt (executing) AND closes a previously recorded ambiguity.
      const ref = completions[0]!.type === "completion" ? completions[0]!.ref : "";
      await store.finishExecution({
        id: approvalId,
        state: "executed",
        actor: `${TYPED_EXECUTOR_ACTOR}-reconcile`,
        result: "completion marker recovered from the external target",
        remoteRef: ref,
        now: clock(),
      });
      return { status: "executed", remoteRef: ref };
    }
    if (markers.length > 1) {
      // §3: idempotency-marker disagreement → ambiguous with BOTH states
      // recorded — the machine never picks the greener story.
      const reason = `marker disagreement: our record is ${from}; target holds [${describeMarkers(markers)}]`;
      if (from === "executing") {
        await store.finishExecution({
          id: approvalId,
          state: "ambiguous",
          actor: `${TYPED_EXECUTOR_ACTOR}-reconcile`,
          result: reason,
          failureCause: "marker_disagreement",
          now: clock(),
        });
      }
      return { status: "ambiguous", reason };
    }
    // Zero markers, or a single ACCEPTANCE marker: §4 "acceptance marker →
    // acceptance recorded, execution still incomplete; inability to establish
    // completion → ambiguous". Never executed, never a blind re-submit (§3).
    const reason =
      markers.length === 0
        ? "no marker at the external target; the effect cannot be established"
        : "acceptance marker only: submission accepted, completion unestablished";
    if (from === "executing") {
      await store.finishExecution({
        id: approvalId,
        state: "ambiguous",
        actor: `${TYPED_EXECUTOR_ACTOR}-reconcile`,
        result: reason,
        failureCause: "completion_unestablished",
        now: clock(),
      });
    }
    return { status: "ambiguous", reason };
  };

  if (execution.state === "executed") return { status: "skipped", reason: "already executed" };
  if (execution.state === "failed") return { status: "skipped", reason: "terminally failed" };
  if (execution.state === "executing" || execution.state === "ambiguous") {
    return reconcile(execution.state);
  }

  // state === "approved": this driver owns the attempt. At-most-once is the
  // store's per-item claim (§4) — a lost race returns undefined, never a
  // second performance.
  const claimed = await store.beginExecution(approvalId, TYPED_EXECUTOR_ACTOR, clock());
  if (claimed === undefined) {
    return { status: "skipped", reason: "claim contention: another executor holds the attempt" };
  }

  // §1: each execution consumes exactly one matching decided grant.
  const grant = store.findMatchingGrantSync({
    app: item.app,
    role: item.role,
    actionHash: actionHash(item.action),
    rule: item.rule,
    actionText: grantScopeText({ tool: item.action.tool, input: item.action.input }),
    ...(item.ticketRef !== undefined ? { ticketRef: item.ticketRef } : {}),
    now: clock(),
  });
  if (grant === undefined) {
    await store.finishExecution({
      id: approvalId,
      state: "failed",
      actor: TYPED_EXECUTOR_ACTOR,
      result: "approved action has no live matching grant; nothing was executed",
      failureCause: "grant_unavailable",
      now: clock(),
    });
    return { status: "failed", cause: "grant_unavailable" };
  }
  store.consumeGrantSync(grant.grantId, clock());

  // §4: markers checked BEFORE any attempt — a pre-existing completion means
  // exactly-once is achieved by NOT submitting.
  const pre = target.markers(key);
  if (pre.length > 0) return reconcile("executing");

  let result;
  try {
    result = target.submit(key, actionHash(item.action));
  } catch (error) {
    if (error instanceof TargetAuthError) {
      // §3: target auth failure → failed; the grant/use/attempt evidence
      // stays in audit and the consumed grant does NOT become reusable.
      await store.finishExecution({
        id: approvalId,
        state: "failed",
        actor: TYPED_EXECUTOR_ACTOR,
        result: `target authentication failed before any effect: ${error.message}`,
        failureCause: "target_authentication_failure",
        now: clock(),
      });
      return { status: "failed", cause: "target_authentication_failure" };
    }
    if (error instanceof TargetConnectionLostError) {
      // §3: lost response after possible effect → ambiguous,
      // terminal-until-reconciled, never a blind retry.
      await store.finishExecution({
        id: approvalId,
        state: "ambiguous",
        actor: TYPED_EXECUTOR_ACTOR,
        result: `response lost after the target may have recorded the effect: ${error.message}`,
        failureCause: "lost_response",
        now: clock(),
      });
      return { status: "ambiguous", reason: "lost response after possible effect" };
    }
    throw error;
  }

  if (result.kind === "completed") {
    await store.finishExecution({
      id: approvalId,
      state: "executed",
      actor: TYPED_EXECUTOR_ACTOR,
      result: "external target acknowledged completion",
      remoteRef: result.ref,
      now: clock(),
    });
    return { status: "executed", remoteRef: result.ref };
  }

  // §2 accept-vs-complete split: "accepted" (e.g. 202) is recorded as
  // accepted — the record NEVER jumps to `executed` on acceptance alone.
  // Durably the attempt stays `executing` (in flight at the asynchronous
  // target, nextAction reconcile); completion is established only by a later
  // marker reconciliation.
  return { status: "accepted" };
}
