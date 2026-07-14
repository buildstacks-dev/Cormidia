import { existsSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readEfficiencyEvidence,
  settlementCoverage,
  unionDurationMs,
  type ExecutionStepRecord,
  type RouteRecord,
} from "../loop/efficiency.js";
import type { RunEnvelope } from "../runtime/runlog/envelope.js";
import { settlementIdentity, type TurnRecord } from "../runtime/telemetry.js";
import type { ContextManifest } from "../loop/context-manifest.js";
import type { LedgerRowSource } from "./ledger-source.js";
import type { ReportDetailFacts } from "./detail-source.js";
import type {
  ReportEfficiencyEpisodeV1,
  ReportEfficiencyV1,
  ReportEvidenceMetricV1,
  ReportRangeV1,
} from "./types.js";

export async function buildEfficiencyReport(input: {
  stateHome: string;
  rows: readonly LedgerRowSource[];
  details: ReportDetailFacts;
  range: ReportRangeV1;
  app?: string;
  duplicateKeys: string[];
}): Promise<ReportEfficiencyV1> {
  const from = new Date(input.range.from_inclusive).getTime();
  const to = new Date(input.range.to_exclusive).getTime();
  const envelopes = uniqueEnvelopes(input.details);
  const rows = input.rows.map((source) => source.record);
  const allEvidence = await readEfficiencyEvidence(input.stateHome);
  const evidence = allEvidence.filter((item) => {
    const route = item.route;
    const belongsToApp = input.app === undefined ||
      route?.app === input.app ||
      item.steps.some((step) => step.app === input.app) ||
      item.pending_started.some((receipt) => receipt.app === input.app);
    if (!belongsToApp) return false;
    const timestamps = [
      ...(route === null ? [] : [route.admitted_at, ...(route.terminal === null ? [] : [route.terminal.at])]),
      ...item.steps.map((step) => step.finished_at),
      ...item.pending_started.map((receipt) => receipt.started_at),
    ];
    return timestamps.some((stamp) => inRange(stamp, from, to)) ||
      (input.app === undefined && route === null && item.corrupt_files.length > 0);
  });
  const routeById = new Map(
    evidence.flatMap((item) => (item.route === null ? [] : [[item.route.episode_id, item.route] as const])),
  );
  const steps = evidence.flatMap((item) => item.steps).filter((step) => input.app === undefined || step.app === input.app);
  const pendingStarted = evidence.flatMap((item) => item.pending_started)
    .filter((receipt) => input.app === undefined || receipt.app === input.app);
  const stepsByRun = groupBy(steps, (step) => `${step.app}\0${step.run_id}`);
  const settlementsByRun = groupBy(rows, (row) => `${row.app ?? ""}\0${row.runId ?? ""}`);
  const envelopeByRun = new Map(envelopes.map((envelope) => [`${envelope.app}\0${envelope.run_id}`, envelope]));
  const providerStepIds = new Set(
    steps.flatMap((step) => step.provider_turn_id === null ? [] : [step.provider_turn_id]),
  );

  const inferredEpisodeByRun = new Map<string, string>();
  for (const envelope of envelopes) {
    inferredEpisodeByRun.set(
      `${envelope.app}\0${envelope.run_id}`,
      envelope.episode_id ?? legacyEpisodeId(envelope),
    );
  }

  const allEpisodeIds = new Set<string>([
    ...routeById.keys(),
    ...inferredEpisodeByRun.values(),
    ...steps.map((step) => step.episode_id),
    ...pendingStarted.map((receipt) => receipt.episode_id),
    ...rows.flatMap((row) => row.episodeId === undefined ? [] : [row.episodeId]),
  ]);
  const duplicateProviderTurnIds = duplicateValues(
    steps.flatMap((step) => step.provider_turn_id === null ? [] : [step.provider_turn_id]),
  );
  const duplicateExecutionStepIds = duplicateValues(steps.map((step) => step.execution_step_id));
  const issues: ReportEfficiencyV1["issues"] = {
    missing_route_episode_ids: [...allEpisodeIds].filter((episodeId) => !routeById.has(episodeId)),
    missing_context_manifest_run_ids: [],
    invalid_context_manifest_run_ids: [],
    missing_execution_step_run_ids: [],
    orphan_execution_step_ids: steps
      .filter((step) => !envelopeByRun.has(`${step.app}\0${step.run_id}`))
      .map((step) => step.execution_step_id),
    pending_execution_step_ids: pendingStarted.map((receipt) => receipt.execution_step_id),
    incomplete_run_ids: envelopes.filter((envelope) => envelope.status === "running").map(runLabel),
    unattributed_pass_ids: input.rows
      .filter(({ record }) =>
        record.app === undefined ||
        record.runId === undefined ||
        (!envelopeByRun.has(`${record.app}\0${record.runId}`) &&
          (record.providerTurnId === undefined || !providerStepIds.has(record.providerTurnId))),
      )
      .map(({ day, line }) => `ledger:${day}:${line}`),
    duplicate_settlement_keys: [...input.duplicateKeys],
    duplicate_provider_turn_ids: duplicateProviderTurnIds,
    duplicate_execution_step_ids: duplicateExecutionStepIds,
    unsettled_provider_step_ids: [],
    mechanical_with_settlement_step_ids: [],
    corrupt_evidence_files: evidence.flatMap((item) => item.corrupt_files),
    partial_or_unavailable_provider_turn_ids: rows
      .filter((row) => row.unmeasured === true || row.usageQuality === "partial" || row.usageQuality === "unavailable")
      .map((row) => row.providerTurnId ?? row.runId ?? "unattributed"),
    repeated_provider_step_ids: steps
      .filter((step) => step.kind === "provider" && step.repeated_from_step_id !== null)
      .map((step) => step.execution_step_id),
  };

  const contextTotals = new Map<string, { rendered_bytes: number; components: number; run_ids: Set<string> }>();
  const contextRuns = new Map<string, { app: string; runId: string; ref?: string }>();
  for (const envelope of envelopes) {
    const runKey = `${envelope.app}\0${envelope.run_id}`;
    const runSteps = stepsByRun.get(runKey) ?? [];
    if (runSteps.length === 0) issues.missing_execution_step_run_ids.push(runLabel(envelope));
    contextRuns.set(runKey, {
      app: envelope.app,
      runId: envelope.run_id,
      ...(envelope.refs.context_manifest !== undefined ? { ref: envelope.refs.context_manifest } : {}),
    });
  }
  for (const step of steps) {
    const runKey = `${step.app}\0${step.run_id}`;
    const current = contextRuns.get(runKey);
    if (current?.ref === undefined && step.context_manifest_ref !== null) {
      contextRuns.set(runKey, { app: step.app, runId: step.run_id, ref: step.context_manifest_ref });
    }
  }
  for (const receipt of pendingStarted) {
    const runKey = `${receipt.app}\0${receipt.run_id}`;
    const current = contextRuns.get(runKey);
    if (current?.ref === undefined && receipt.context_manifest_ref !== null) {
      contextRuns.set(runKey, {
        app: receipt.app,
        runId: receipt.run_id,
        ref: receipt.context_manifest_ref,
      });
    }
  }
  for (const contextRun of [...contextRuns.values()].sort((a, b) =>
    `${a.app}\0${a.runId}`.localeCompare(`${b.app}\0${b.runId}`),
  )) {
    const label = `${contextRun.app}/${contextRun.runId}`;
    const read = await readManifest(input.stateHome, contextRun);
    if (read.status === "missing") {
      issues.missing_context_manifest_run_ids.push(label);
    } else if (read.status === "invalid") {
      issues.invalid_context_manifest_run_ids.push(label);
    } else {
      for (const component of read.manifest.components) {
        const total = contextTotals.get(component.category) ?? {
          rendered_bytes: 0,
          components: 0,
          run_ids: new Set<string>(),
        };
        total.rendered_bytes += component.rendered_bytes;
        total.components += 1;
        total.run_ids.add(label);
        contextTotals.set(component.category, total);
      }
    }
  }

  const coverage = settlementCoverage(steps, rows);
  issues.unsettled_provider_step_ids.push(...coverage.missing);
  issues.mechanical_with_settlement_step_ids.push(...coverage.mechanical_with_settlement);

  const episodes: ReportEfficiencyEpisodeV1[] = [];
  for (const episodeId of [...allEpisodeIds].sort()) {
    const route = routeById.get(episodeId);
    const episodeEnvelopes = envelopes.filter(
      (envelope) => inferredEpisodeByRun.get(`${envelope.app}\0${envelope.run_id}`) === episodeId,
    );
    const episodeSteps = steps.filter((step) => step.episode_id === episodeId);
    const episodeRows = rows.filter(
      (row) => row.episodeId === episodeId ||
        (row.app !== undefined && row.runId !== undefined &&
          inferredEpisodeByRun.get(`${row.app}\0${row.runId}`) === episodeId),
    );
    const providerSteps = episodeSteps.filter((step) => step.kind === "provider");
    const episodePending = pendingStarted.filter((receipt) => receipt.episode_id === episodeId);
    const providerRows = episodeRows.filter((row) => row.runId !== undefined);
    const episodeIssues = episodeIssueLabels(episodeId, episodeEnvelopes, route, episodeSteps, issues);
    const usageKnown = providerRows.every(
      (row) =>
        row.unmeasured !== true &&
        row.usageQuality === "complete" &&
        row.costEstimated !== true,
    );
    if (!usageKnown && providerRows.length > 0) episodeIssues.push("nonqualifying_usage_quality");
    if (episodePending.length > 0) episodeIssues.push("pending_execution_step");
    const activeIntervals =
      episodeSteps.length > 0
        ? episodeSteps.map((step) => ({ start: step.started_at, end: step.finished_at }))
        : episodeEnvelopes.flatMap((envelope) =>
            envelope.finished_at === undefined ? [] : [{ start: envelope.started_at, end: envelope.finished_at }],
          );
    const productiveKnown = providerSteps.length > 0 && providerSteps.every((step) => step.productive !== null);
    const elapsedBounds = route === undefined
      ? {
          start: episodeEnvelopes.map((envelope) => envelope.started_at).sort()[0],
          end: episodeEnvelopes.map((envelope) => envelope.finished_at).filter((value): value is string => value !== undefined).sort().at(-1),
        }
      : { start: route.admitted_at, end: route.terminal?.at };
    const activeTime = activeIntervals.length === 0 ? null : unionDurationMs(activeIntervals);
    const elapsedTime =
      elapsedBounds.start === undefined || elapsedBounds.end === undefined
        ? null
        : Math.max(0, new Date(elapsedBounds.end).getTime() - new Date(elapsedBounds.start).getTime());
    episodes.push({
      episode_id: episodeId,
      app: route?.app ?? episodeEnvelopes[0]?.app ?? episodeRows[0]?.app ?? episodeSteps[0]?.app ?? episodePending[0]?.app ?? "(unattributed)",
      evidence: route === undefined ? "legacy_inferred" : "durable",
      planned_route: route?.planned_route ?? null,
      current_route: route?.current_route ?? null,
      final_route: route?.final_route ?? null,
      terminal_status: route?.terminal?.status ?? inferredTerminal(episodeEnvelopes),
      provider_turns: new Set(providerRows.map((row) => settlementIdentity(row)).filter((id): id is string => id !== undefined)).size,
      mechanical_steps:
        episodeSteps.filter((step) => step.kind === "mechanical").length ||
        episodeEnvelopes.filter((envelope) => isLegacyMechanical(envelope, settlementsByRun)).length,
      input_tokens: usageKnown ? providerRows.reduce((sum, row) => sum + row.tokensIn, 0) : null,
      output_tokens: usageKnown ? providerRows.reduce((sum, row) => sum + row.tokensOut, 0) : null,
      equivalent_cost_usd: usageKnown ? providerRows.reduce((sum, row) => sum + row.costUsd, 0) : null,
      active_time_ms: activeTime,
      elapsed_time_ms: elapsedTime,
      human_wait_ms: elapsedTime === null || activeTime === null ? null : Math.max(0, elapsedTime - activeTime),
      productive_provider_turns: productiveKnown ? providerSteps.filter((step) => step.productive).length : null,
      repeated_work_cost_usd: productiveKnown && usageKnown
        ? providerSteps.filter((step) => step.repeated_from_step_id !== null).reduce((sum, step) => sum + (step.usage?.costUsd ?? 0), 0)
        : null,
      route_variances: route?.reassessments.length ?? 0,
      issues: episodeIssues,
    });
  }

  const durableRoutes = [...routeById.values()];
  const terminalEpisodes = durableRoutes.filter((route) => route.terminal !== null);
  const terminalStepDenominator = steps.length + pendingStarted.length;
  const productiveSteps = steps.filter((step) => step.kind === "provider" && step.productive !== null);
  const unknownProductivity = steps.filter((step) => step.kind === "provider" && step.productive === null).map((step) => step.execution_step_id);
  const legacyProviderRows = rows.filter((row) => row.providerTurnId === undefined).map((row) => row.runId ?? "unattributed");
  const legacyTerminalEnvelopes = envelopes.filter(
    (envelope) => envelope.episode_id === undefined && envelope.status !== "running",
  );
  const legacyInferredEpisodes = episodes.filter((episode) => episode.evidence === "legacy_inferred");
  const legacySettledRows = rows.filter(
    (row) =>
      row.providerTurnId === undefined &&
      row.app !== undefined &&
      row.runId !== undefined &&
      envelopeByRun.has(`${row.app}\0${row.runId}`),
  );
  const repeatedCostKnown = episodes.every((episode) => episode.repeated_work_cost_usd !== null || episode.provider_turns === 0);
  return {
    episodes,
    metrics: {
      terminal_integrity: metric(
        terminalEpisodes.length + legacyInferredEpisodes.filter((episode) => episode.terminal_status !== null).length,
        durableRoutes.length + legacyInferredEpisodes.length,
        [],
        issues.missing_route_episode_ids.map((id) => `route admission missing for ${id}`),
      ),
      execution_step_terminal_integrity: metric(
        steps.length + legacyTerminalEnvelopes.length,
        terminalStepDenominator + envelopes.filter((envelope) => envelope.episode_id === undefined).length,
        [],
        [
          ...pendingStarted.map((receipt) => `terminal execution record missing for ${receipt.execution_step_id}`),
          ...issues.missing_execution_step_run_ids.map((id) => `durable execution step missing for ${id}`),
        ],
      ),
      ledger_coverage: metric(
        coverage.numerator + legacySettledRows.length,
        coverage.denominator + legacyProviderRows.length,
        [],
        [
          ...coverage.missing.map((id) => `settlement missing for ${id}`),
          ...coverage.duplicate.map((id) => `duplicate settlement for ${id}`),
          ...duplicateProviderTurnIds.map((id) => `duplicate provider-turn identity ${id}`),
          ...duplicateExecutionStepIds.map((id) => `duplicate execution-step identity ${id}`),
          ...coverage.mechanical_with_settlement.map((id) => `mechanical step has provider settlement ${id}`),
          ...legacyProviderRows.map((id) => `durable provider execution step missing for legacy settlement ${id}`),
        ],
      ),
      productive_pass_ratio: metric(
        productiveSteps.filter((step) => step.productive).length,
        productiveSteps.length,
        legacyProviderRows,
        [
          ...unknownProductivity.map((id) => `productive fingerprint classification missing for ${id}`),
          ...legacyProviderRows.map((id) => `productive fingerprint classification missing for legacy settlement ${id}`),
        ],
      ),
    },
    context_by_category: [...contextTotals.entries()]
      .map(([category, total]) => ({
        category,
        rendered_bytes: total.rendered_bytes,
        components: total.components,
        run_ids: [...total.run_ids].sort(),
      }))
      .sort((a, b) => a.category.localeCompare(b.category)),
    repeated_work_cost_usd: repeatedCostKnown
      ? episodes.reduce((sum, episode) => sum + (episode.repeated_work_cost_usd ?? 0), 0)
      : null,
    issues: mapSortedUnique(issues),
  };
}

function metric(
  numerator: number,
  denominator: number,
  excludedIds: string[],
  missingInputs: string[],
): ReportEvidenceMetricV1 {
  const missing = [...new Set(missingInputs)].sort();
  return {
    status: missing.length === 0 ? "valid" : "invalid_measurement",
    numerator,
    denominator,
    value: denominator === 0 || missing.length > 0 ? null : numerator / denominator,
    excluded_ids: [...new Set(excludedIds)].sort(),
    missing_inputs: missing,
  };
}

function uniqueEnvelopes(details: ReportDetailFacts): RunEnvelope[] {
  const map = new Map<string, RunEnvelope>();
  for (const { envelope } of details.envelopes.values()) map.set(`${envelope.app}\0${envelope.run_id}`, envelope);
  for (const { envelope } of details.unsettled) map.set(`${envelope.app}\0${envelope.run_id}`, envelope);
  return [...map.values()].sort((a, b) => runLabel(a).localeCompare(runLabel(b)));
}

async function readManifest(
  stateHome: string,
  input: { app: string; runId: string; ref?: string },
): Promise<
  { status: "ok"; manifest: ContextManifest } |
  { status: "missing" } |
  { status: "invalid" }
> {
  const ref = input.ref;
  if (ref === undefined) return { status: "missing" };
  if (ref !== "context-manifest.json") return { status: "invalid" };
  const path = join(stateHome, "runs", input.app, input.runId, ref);
  if (!existsSync(path)) return { status: "missing" };
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return { status: "invalid" };
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isContextManifest(value, input.app, input.runId)) return { status: "invalid" };
    return { status: "ok", manifest: value };
  } catch {
    return { status: "invalid" };
  }
}

function legacyEpisodeId(envelope: RunEnvelope): string {
  return envelope.ticket !== undefined
    ? `legacy:ticket:${envelope.app}:${envelope.ticket}`
    : `legacy:trace:${envelope.app}:${envelope.trace_id}`;
}

function inferredTerminal(envelopes: RunEnvelope[]): string | null {
  if (envelopes.length === 0 || envelopes.some((envelope) => envelope.status === "running")) return null;
  if (envelopes.some((envelope) => envelope.status === "failed")) return "failed";
  if (envelopes.some((envelope) => envelope.status === "cancelled")) return "cancelled";
  if (envelopes.some((envelope) => envelope.status === "timed_out")) return "timed_out";
  if (envelopes.some((envelope) => envelope.status === "blocked")) return "blocked";
  return "completed";
}

function isLegacyMechanical(envelope: RunEnvelope, rowsByRun: Map<string, TurnRecord[]>): boolean {
  return (rowsByRun.get(`${envelope.app}\0${envelope.run_id}`) ?? []).length === 0 &&
    envelope.usage === undefined &&
    (envelope.role.includes("gate") || envelope.pipeline.includes("gate") || envelope.pass.includes("gate"));
}

function episodeIssueLabels(
  episodeId: string,
  envelopes: RunEnvelope[],
  route: RouteRecord | undefined,
  steps: ExecutionStepRecord[],
  issues: ReportEfficiencyV1["issues"],
): string[] {
  const runIds = new Set([
    ...envelopes.map(runLabel),
    ...steps.map((step) => `${step.app}/${step.run_id}`),
  ]);
  const labels: string[] = [];
  if (route === undefined) labels.push("missing_route_record");
  if (route !== undefined && route.terminal === null) labels.push("missing_episode_terminal");
  if (envelopes.some((envelope) => envelope.status === "running")) labels.push("incomplete_run");
  if (issues.missing_context_manifest_run_ids.some((id) => runIds.has(id))) labels.push("missing_context_manifest");
  if (issues.invalid_context_manifest_run_ids.some((id) => runIds.has(id))) labels.push("invalid_context_manifest");
  if (issues.missing_execution_step_run_ids.some((id) => runIds.has(id))) labels.push("missing_execution_step");
  if (steps.some((step) => issues.unsettled_provider_step_ids.includes(step.execution_step_id))) labels.push("unsettled_provider_step");
  if (steps.some((step) => issues.orphan_execution_step_ids.includes(step.execution_step_id))) labels.push("orphan_execution_step");
  if (issues.missing_route_episode_ids.includes(episodeId)) labels.push("missing_route_record");
  return [...new Set(labels)].sort();
}

function inRange(stamp: string, from: number, to: number): boolean {
  const time = new Date(stamp).getTime();
  return Number.isFinite(time) && time >= from && time < to;
}

function runLabel(envelope: Pick<RunEnvelope, "app" | "run_id">): string {
  return `${envelope.app}/${envelope.run_id}`;
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const value of values) out.set(keyOf(value), [...(out.get(keyOf(value)) ?? []), value]);
  return out;
}

function duplicateValues(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value).sort();
}

function isContextManifest(value: unknown, app: string, runId: string): value is ContextManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Partial<ContextManifest>;
  return manifest.schema_version === 1 &&
    manifest.app === app &&
    manifest.run_id === runId &&
    typeof manifest.episode_id === "string" &&
    typeof manifest.render_sha256 === "string" &&
    typeof manifest.rendered_bytes === "number" &&
    Array.isArray(manifest.components) &&
    manifest.components.every((component) =>
      component !== null &&
      typeof component === "object" &&
      typeof component.component_id === "string" &&
      typeof component.source === "string" &&
      typeof component.source_sha256 === "string" &&
      typeof component.rendered_bytes === "number" &&
      typeof component.inclusion_reason === "string",
    );
}

function mapSortedUnique(issues: ReportEfficiencyV1["issues"]): ReportEfficiencyV1["issues"] {
  return Object.fromEntries(
    Object.entries(issues).map(([key, values]) => [key, [...new Set(values)].sort()]),
  ) as unknown as ReportEfficiencyV1["issues"];
}
