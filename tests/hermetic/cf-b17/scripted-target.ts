// CF-B17 scripted external target — an owned fake of the B-17 boundary's far
// side (contracts/B-17-typed-executor.md; boundary-map B-17). The real
// non-GitHub round-trip is BLOCKED:B-17-L3 (no disposable real target;
// validation-policy.yaml obligation B-17-L3), so this L2 stand-in models the
// contract-relevant behaviors of an ASYNCHRONOUS external target:
//
//   - submit() may COMPLETE synchronously, may merely ACCEPT (the 202 case:
//     effect pending, completion a separately verified fact), may lose the
//     response AFTER recording the acceptance (effect possibly in flight),
//     or may reject authentication BEFORE any effect;
//   - markers are TYPED by what they prove (§4): an acceptance marker proves
//     only that the submission was accepted; a completion marker proves the
//     effect. Disagreement (multiple markers) is representable so the
//     never-the-greener-story clause (§3) can be exercised;
//   - the script is finite and drained-checked: an unscripted submit throws
//     loudly, because a silent default success would hide a duplicate
//     execution — and an undrained script would be green by absence
//     (tests/README.md rules 3/4).

export type SubmitBehavior = "complete" | "accept" | "lost-after-accept" | "auth-reject";

export type SubmitResult = { kind: "completed"; ref: string } | { kind: "accepted" };

export type TargetMarker =
  | { type: "acceptance"; key: string }
  | { type: "completion"; key: string; ref: string };

/** Credential rejection BEFORE any effect (B-17 §3 "target auth/credential
 *  failure → failed"). */
export class TargetAuthError extends Error {
  constructor() {
    super("target rejected authentication: HTTP 401 unauthorized");
    this.name = "TargetAuthError";
  }
}

/** Response lost AFTER the target may have recorded the operation (B-17 §3
 *  "lost response after possible effect"). */
export class TargetConnectionLostError extends Error {
  constructor() {
    super("connection lost before a response was read; the operation may have been recorded");
    this.name = "TargetConnectionLostError";
  }
}

interface TargetOperation {
  key: string;
  payloadHash: string;
  phase: "accepted" | "completed";
  ref?: string;
}

export class ScriptedExternalTarget {
  private readonly script: SubmitBehavior[];
  private readonly operations: TargetOperation[] = [];
  private refSeq = 0;
  /** Every submission that REACHED the target, in order — the at-most-once
   *  oracle for the suite. */
  readonly submits: Array<{ key: string; payloadHash: string; behavior: SubmitBehavior }> = [];

  constructor(script: readonly SubmitBehavior[]) {
    this.script = [...script];
  }

  submit(key: string, payloadHash: string): SubmitResult {
    const behavior = this.script.shift();
    if (behavior === undefined) {
      throw new Error(
        `scripted target: submit(${key}) with no scripted behavior left — an over-submission ` +
          "(possible duplicate execution); a silent default would hide it",
      );
    }
    if (behavior === "auth-reject") {
      // Refusal before any effect: NOTHING is recorded target-side.
      this.submits.push({ key, payloadHash, behavior });
      throw new TargetAuthError();
    }
    this.submits.push({ key, payloadHash, behavior });
    if (behavior === "accept") {
      this.operations.push({ key, payloadHash, phase: "accepted" });
      return { kind: "accepted" };
    }
    if (behavior === "lost-after-accept") {
      this.operations.push({ key, payloadHash, phase: "accepted" });
      throw new TargetConnectionLostError();
    }
    const ref = this.nextRef();
    this.operations.push({ key, payloadHash, phase: "completed", ref });
    return { kind: "completed", ref };
  }

  /** Asynchronous target progress: a previously accepted operation completes
   *  out of band. Throws when no accepted operation exists — completing
   *  nothing must never look like completing something. */
  completeAsync(key: string): string {
    const op = this.operations.find((entry) => entry.key === key && entry.phase === "accepted");
    if (op === undefined) {
      throw new Error(`scripted target: completeAsync(${key}) found no accepted operation`);
    }
    op.phase = "completed";
    op.ref = this.nextRef();
    return op.ref;
  }

  /** Typed markers for one idempotency key — derived strictly from what the
   *  target durably holds, typed by what they prove (B-17 §4). */
  markers(key: string): TargetMarker[] {
    return this.operations
      .filter((op) => op.key === key)
      .map((op) =>
        op.phase === "completed"
          ? ({ type: "completion", key, ref: op.ref! } satisfies TargetMarker)
          : ({ type: "acceptance", key } satisfies TargetMarker),
      );
  }

  /** Disagreement seeding for negative controls (B-17 §3): a SECOND completed
   *  operation appears under the same key — our record and the target state
   *  can no longer be joined one-to-one. */
  seedDuplicateCompletion(key: string): string {
    const ref = this.nextRef();
    this.operations.push({ key, payloadHash: "seeded-duplicate", phase: "completed", ref });
    return ref;
  }

  /** Pre-existing completion under a key (the effect already happened before
   *  this executor's first attempt) — the §4 marker-precheck case. */
  seedCompletion(key: string): string {
    return this.seedDuplicateCompletion(key);
  }

  /** Harness self-test hook: throws when scripted behaviors were never
   *  consumed — a scripted-but-unexercised target is green by absence. */
  assertScriptDrained(): void {
    if (this.script.length > 0) {
      throw new Error(
        `scripted target: ${this.script.length} scripted behavior(s) never consumed: ${this.script.join(", ")}`,
      );
    }
  }

  private nextRef(): string {
    this.refSeq += 1;
    return `target-op-${this.refSeq}`;
  }
}
