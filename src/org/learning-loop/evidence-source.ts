// Cormidia episode records (state home `learning/episodes/*.json`, spec §5)
// onto the kernel's EvidenceSource port (kernel contract §Evidence source).
// The projection is read-only and page-stable: every page re-derives the
// source revision from the exact bytes of every episode file, so a record
// that changes under an import is reported as revision drift by the kernel,
// never folded silently. A file that fails Cormidia's own episode validator
// makes its page `corrupt` with a diagnostic naming the file — evidence
// health, never an empty success (AGENTS.md source-health rule).

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { sha256HexOfCanonicalJson, toJsonValue } from "@cormidia/learning-loop";
import type {
  Diagnostic,
  EvidencePage,
  EvidenceSource,
  MetricDefinition,
  ProjectedEpisode,
  ProjectedMeasurement,
  ProjectedObservation,
} from "@cormidia/learning-loop";
import { parseEpisodeEvidenceRecord, type EpisodeEvidenceRecord } from "./episode-evidence-record.js";
import { scopeFromLoopScope } from "./scope.js";

export const EPISODE_SOURCE_ID = "cormidia-episodes";
const ADAPTER_VERSION = "1.0.0";
const DEFAULT_PAGE_SIZE = 50;

export interface EpisodeEvidenceInput {
  readonly stateHome: string;
  readonly org: string;
  readonly pageSize?: number;
}

const METRICS = {
  episode_completed: { name: "episode_completed", valueType: "boolean", unit: "pass", aggregation: "all" },
  cost_usd: { name: "cost_usd", valueType: "number", unit: "usd", aggregation: "sum" },
  review_cycles: { name: "review_cycles", valueType: "number", unit: "count", aggregation: "sum" },
  gate_failures: { name: "gate_failures", valueType: "number", unit: "count", aggregation: "sum" },
  human_interventions: { name: "human_interventions", valueType: "number", unit: "count", aggregation: "sum" },
} as const satisfies Record<string, MetricDefinition>;

function episodesDir(stateHome: string): string {
  return join(stateHome, "learning", "episodes");
}

interface EpisodeFile {
  readonly name: string;
  readonly digest: string;
}

async function listEpisodeFiles(stateHome: string): Promise<EpisodeFile[]> {
  const dir = episodesDir(stateHome);
  if (!existsSync(dir)) return [];
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  const files: EpisodeFile[] = [];
  for (const name of names) {
    const bytes = await readFile(join(dir, name));
    files.push({ name, digest: createHash("sha256").update(bytes).digest("hex") });
  }
  return files;
}

function revisionOf(files: readonly EpisodeFile[]): string {
  return sha256HexOfCanonicalJson(files.map((file) => ({ name: file.name, digest: file.digest })));
}

function outcomeStatus(record: EpisodeEvidenceRecord): ProjectedEpisode["status"] {
  if (record.status !== "closed") return undefined;
  const outcome = record.outcome;
  if (outcome === undefined) return "unknown";
  if (outcome.terminal_reason === "cancelled" || outcome.terminal_reason === "reset_abandoned") return "cancelled";
  return outcome.completed ? "succeeded" : "failed";
}

function project(
  record: EpisodeEvidenceRecord,
  org: string,
): {
  readonly episode: ProjectedEpisode;
  readonly observations: ProjectedObservation[];
  readonly measurements: ProjectedMeasurement[];
} {
  const id = record.episode_id;
  const completeness = record.status === "closed" ? "complete" : "partial";
  const observations: ProjectedObservation[] = record.gates.map((gate, index) => ({
    sourceRecordId: `gate:${id}:${index}`,
    episodeId: id,
    kind: "cormidia.gate_result",
    data: toJsonValue({
      gate: gate.gate,
      status: gate.status,
      run_id: gate.run_id,
      ...(gate.detail !== undefined ? { detail: gate.detail } : {}),
    }),
    completeness,
  }));
  for (const [index, late] of record.late_outcomes.entries()) {
    observations.push({
      sourceRecordId: `late-outcome:${id}:${index}`,
      episodeId: id,
      occurredAt: late.recorded,
      kind: "cormidia.late_outcome",
      data: toJsonValue({ kind: late.kind, ref: late.ref, ...(late.note !== undefined ? { note: late.note } : {}) }),
      completeness,
    });
  }
  const measurements: ProjectedMeasurement[] = [];
  const outcome = record.outcome;
  if (outcome !== undefined) {
    const outcomeRecordId = `episode-outcome:${id}`;
    observations.push({
      sourceRecordId: outcomeRecordId,
      episodeId: id,
      ...(record.closed !== undefined ? { occurredAt: record.closed } : {}),
      kind: "cormidia.episode_outcome",
      data: outcome.raw,
      completeness,
    });
    const values: ReadonlyArray<readonly [MetricDefinition, number | boolean]> = [
      [METRICS.episode_completed, outcome.completed],
      [METRICS.cost_usd, outcome.cost_usd],
      [METRICS.review_cycles, outcome.review_cycles],
      [METRICS.gate_failures, outcome.gate_failures],
      [METRICS.human_interventions, outcome.human_interventions],
    ];
    for (const [metric, value] of values) {
      measurements.push({
        sourceRecordId: `measure:${id}:${metric.name}`,
        episodeId: id,
        metric,
        value,
        evidenceSourceRecordIds: [outcomeRecordId],
        ...(record.closed !== undefined ? { measuredAt: record.closed } : {}),
      });
    }
  }
  const status = outcomeStatus(record);
  const episode: ProjectedEpisode = {
    sourceRecordId: `episode:${id}`,
    episodeId: id,
    episodeClass: record.kind,
    completeness,
    scope: scopeFromLoopScope(org, `apps/${record.app}`),
    openedAt: record.opened,
    ...(record.closed !== undefined ? { closedAt: record.closed } : {}),
    ...(status !== undefined ? { status } : {}),
    measurementSourceRecordIds: measurements.map((measurement) => measurement.sourceRecordId),
  };
  return { episode, observations, measurements };
}

function corruptPage(
  sourceRef: string,
  pageRef: string,
  observedRevision: string,
  diagnostics: Diagnostic[],
): EvidencePage {
  return {
    sourceRef,
    pageRef,
    state: { status: "corrupt", observedRevision },
    observations: [],
    measurements: [],
    episodes: [],
    diagnostics,
  };
}

export function createEpisodeEvidenceSource(): EvidenceSource<EpisodeEvidenceInput> {
  return {
    descriptor: { id: EPISODE_SOURCE_ID, adapterVersion: ADAPTER_VERSION, maximumTrust: "observed" },
    probe: async (input) => {
      if (!existsSync(input.stateHome)) {
        return {
          supported: false,
          diagnostics: [
            { code: "source.missing", severity: "error", message: `state home ${input.stateHome} does not exist` },
          ],
        };
      }
      return { supported: true, sourceRevision: revisionOf(await listEpisodeFiles(input.stateHome)), diagnostics: [] };
    },
    read: async function* (input, cursor) {
      const sourceRef = episodesDir(input.stateHome);
      const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
      let start = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
      if (!Number.isInteger(start) || start < 0)
        throw new Error(`learning-loop: invalid episode cursor "${cursor ?? ""}"`);
      while (true) {
        const files = await listEpisodeFiles(input.stateHome);
        const sourceRevision = revisionOf(files);
        const slice = files.slice(start, start + pageSize);
        const pageRef = `${sourceRef}#${start}`;
        const nextStart = start + slice.length;
        const nextCursor = nextStart < files.length ? String(nextStart) : undefined;
        const diagnostics: Diagnostic[] = [];
        const episodes: ProjectedEpisode[] = [];
        const observations: ProjectedObservation[] = [];
        const measurements: ProjectedMeasurement[] = [];
        for (const file of slice) {
          try {
            const raw: unknown = JSON.parse(await readFile(join(sourceRef, file.name), "utf8"));
            const projected = project(parseEpisodeEvidenceRecord(raw, file.name), input.org);
            episodes.push(projected.episode);
            observations.push(...projected.observations);
            measurements.push(...projected.measurements);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            diagnostics.push({ code: "source.record_corrupt", severity: "error", message: `${file.name}: ${message}` });
          }
        }
        if (diagnostics.length > 0) {
          yield corruptPage(sourceRef, pageRef, sourceRevision, diagnostics);
          return;
        }
        if (files.length === 0) {
          diagnostics.push({
            code: "source.empty",
            severity: "info",
            message: `no episode records under ${sourceRef}`,
          });
        }
        yield {
          sourceRef,
          pageRef,
          state: { status: "available", sourceRevision, completeness: "complete" },
          ...(nextCursor !== undefined ? { nextCursor } : {}),
          observations,
          measurements,
          episodes,
          diagnostics,
        };
        if (nextCursor === undefined) return;
        start = nextStart;
      }
    },
  };
}
