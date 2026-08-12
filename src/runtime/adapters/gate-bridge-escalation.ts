// F-PT-036 (owner-ratified 2026-08-12) / INV-015 adversarial seed (c):
// "classifier throws → deny + escalate". Every socket gate bridge's
// classifier-throw catch branch keeps its fail-closed denial AND appends a
// GateEscalation so a human sees the anomaly: silent denial can mask a
// persistently broken classifier as universal refusal with no signal —
// availability damage compounding into an observability hole.

import type { GateEscalation, ToolAction } from "../types.js";

/** Build the fail-closed denial a gate bridge answers when classification
 *  threw, recording the escalation as a side effect. `classifying` is the
 *  action under classification when the throw happened; when normalization
 *  itself threw there is no action yet, and a synthetic marker records that
 *  the payload never became classifiable. The reason carries the bridge's own
 *  fail-closed message, error text included, so the surfaced
 *  `escalation.raised` event names the anomaly. */
export function classifierThrowDenial(
  escalations: GateEscalation[],
  classifying: ToolAction | undefined,
  bridge: string,
  error: unknown,
): { allow: false; reason: string } {
  const reason = `Cormidia ${bridge} gate bridge failed closed: ${error instanceof Error ? error.message : String(error)}`;
  escalations.push({
    action: classifying ?? {
      tool: "unclassifiable",
      input: {},
      description: "gate bridge could not classify the payload",
    },
    reason,
  });
  return { allow: false, reason };
}
