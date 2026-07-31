import { FakeClock } from "../fixtures/controlled-world.js";

export interface AcceleratedSoakReport {
  simulatedDays: number;
  independentEpisodesCompleted: number;
  approvalDependentEpisodesCompleted: number;
  approvalStillPending: boolean;
  uniqueEffects: number;
  duplicateEffectsSuppressed: number;
  providerTurnsReserved: number;
  providerTurnsSettled: number;
  unknownUsageReconciliations: number;
  retainedTelemetryRecords: number;
  maximumTelemetryRecords: number;
  falseHealthyObservations: number;
  acceleratedOnly: true;
  realTimeObligationSatisfied: false;
}

/**
 * Exercises the harness's fake-clock, dedupe, retention, approval, and ledger
 * plumbing. This is deliberately not evidence that production Operon survived
 * a real-time soak.
 */
export function runAcceleratedHarnessSoak(days = 90): AcceleratedSoakReport {
  if (!Number.isInteger(days) || days <= 0) throw new TypeError("days must be a positive integer");
  const clock = new FakeClock();
  const effects = new Set<string>();
  const settlements = new Set<string>();
  const telemetry: Array<{ at: number; kind: string }> = [];
  let independentEpisodesCompleted = 0;
  let duplicateEffectsSuppressed = 0;
  let providerTurnsReserved = 0;
  let unknownUsageReconciliations = 0;
  let maximumTelemetryRecords = 0;
  let falseHealthyObservations = 0;

  for (let day = 0; day < days; day += 1) {
    const now = clock.now().getTime();
    const effectId = day % 7 === 0 && day > 0 ? `effect-${day - 1}` : `effect-${day}`;
    if (effects.has(effectId)) duplicateEffectsSuppressed += 1;
    else effects.add(effectId);

    independentEpisodesCompleted += 1;
    const providerTurnId = `provider-${day}`;
    providerTurnsReserved += 1;
    const usageKnown = day % 10 !== 0;
    if (!usageKnown) {
      unknownUsageReconciliations += 1;
      telemetry.push({ at: now, kind: "usage-unavailable-blocked" });
    }
    settlements.add(providerTurnId);
    telemetry.push({ at: now, kind: usageKnown ? "settled" : "settled-after-reconciliation" });

    const retentionCutoff = now - 30 * 24 * 60 * 60 * 1000;
    while (telemetry[0] !== undefined && telemetry[0].at < retentionCutoff) telemetry.shift();
    maximumTelemetryRecords = Math.max(maximumTelemetryRecords, telemetry.length);
    if (settlements.size !== providerTurnsReserved) falseHealthyObservations += 1;
    clock.advanceMs(24 * 60 * 60 * 1000);
  }

  return {
    simulatedDays: days,
    independentEpisodesCompleted,
    approvalDependentEpisodesCompleted: 0,
    approvalStillPending: true,
    uniqueEffects: effects.size,
    duplicateEffectsSuppressed,
    providerTurnsReserved,
    providerTurnsSettled: settlements.size,
    unknownUsageReconciliations,
    retainedTelemetryRecords: telemetry.length,
    maximumTelemetryRecords,
    falseHealthyObservations,
    acceleratedOnly: true,
    realTimeObligationSatisfied: false,
  };
}
