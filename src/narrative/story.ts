// The narrative fold (#129): envelopes + publication records + execution
// journal + settled ledger → one NarrativeStory per episode. Pure projection
// over the sources module — deterministic given the same bytes on disk, no
// wall clock (captured_at is the newest source timestamp folded in), no
// network, no writes.

import type { RunEnvelope } from "../runtime/runlog/envelope.js";
import { hashedFileStem } from "../runtime/runlog/paths.js";
import type { TurnRecord } from "../runtime/telemetry.js";
import {
  boundQuote,
  readAppRunSources,
  readDeliveryJournal,
  readLedgerRows,
  readRunQuote,
  readTaskOriginQuote,
  scrubCaptureText,
  MOMENT_QUOTE_MAX,
  ORIGIN_QUOTE_MAX,
} from "./sources.js";
import { formatDurableVerdictDigest, summarizeDurableVerdict } from "../loop/verdicts.js";
import {
  NARRATIVE_SCHEMA_VERSION,
  type NarrativeMoment,
  type NarrativeStory,
  type StoryKind,
  type StoryStatus,
} from "./types.js";
import { listPlannerPublications, type PlannerPublicationTransaction } from "../org/planner-publication.js";

export interface NarrativeFoldResult {
  stories: NarrativeStory[];
  problems: string[];
}

export async function foldAppStories(stateHome: string, app: string): Promise<NarrativeFoldResult> {
  const sources = await readAppRunSources(stateHome, app);
  const ledger = await readLedgerRows(stateHome);
  const publications = await listPlannerPublications(stateHome, app);

  // Group envelopes into episodes; a pre-episode envelope groups by trace.
  const groups = new Map<string, RunEnvelope[]>();
  for (const envelope of sources.envelopes) {
    const id = envelope.episode_id ?? `trace:${app}:${envelope.trace_id}`;
    const group = groups.get(id) ?? [];
    group.push(envelope);
    groups.set(id, group);
  }

  const stories: NarrativeStory[] = [];
  for (const [episodeId, envelopes] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    stories.push(
      await foldStory(
        stateHome,
        app,
        episodeId,
        envelopes,
        sources.publishedTickets,
        ledger,
        publications.find((publication) => publication.evidence.episode_id === episodeId),
      ),
    );
  }

  // Ticket stories join back to the planning execution that published them —
  // locally, from #128 records, never guessed from content.
  for (const story of stories) {
    const issue = ticketIssueNumber(story.ticket_ref);
    if (issue === undefined) continue;
    // The publication record carries the EXACT episode/run/trace identity —
    // byte-identical to the ticket body's Planned-by trailer (#128). Never
    // derive it by string-splitting an episode id.
    const record = findPublicationRecord(sources.publishedTickets, issue);
    if (record === undefined) continue;
    story.planned_by = {
      episode_id: record.episode_id,
      run_id: record.run_id,
      trace_id: record.trace_id,
    };
    const entry = record.published.find((t) => t.issue_number === issue);
    if (entry !== undefined && story.ticket_ref !== undefined) {
      story.title = `Ticket ${story.ticket_ref} — ${scrubCaptureText(entry.title)}`;
    }
  }
  return { stories, problems: sources.problems };
}

async function foldStory(
  stateHome: string,
  app: string,
  episodeId: string,
  envelopes: RunEnvelope[],
  publishedTickets: Map<string, import("../loop/plan-publication-record.js").PublishedTicketsRecord>,
  ledger: TurnRecord[],
  publication?: PlannerPublicationTransaction,
): Promise<NarrativeStory> {
  const ordered = [...envelopes].sort(
    (a, b) => a.started_at.localeCompare(b.started_at) || a.run_id.localeCompare(b.run_id),
  );
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const kind = storyKind(episodeId, ordered);

  const moments: NarrativeMoment[] = [];
  for (const envelope of ordered) {
    // Every quote path re-scrubs at capture time — verdict_summary was
    // scrubbed at write time, but with whatever pattern list existed THEN,
    // and captures outlive their sources by years.
    //
    // A structured verdict is quoted as its human digest (ENH-010): the raw
    // record stays authoritative in the run directory, but a narrative moment
    // whose quote is a JSON blob truncated mid-key tells an operator nothing
    // about what the reviewer actually concluded.
    const verdictQuote =
      envelope.verdict_summary !== undefined && envelope.verdict_summary.trim() !== ""
        ? formatVerdictQuote(envelope.verdict_summary)
        : undefined;
    const quote =
      verdictQuote !== undefined
        ? boundQuote(`runs/${app}/${envelope.run_id}/envelope.json`, verdictQuote, MOMENT_QUOTE_MAX)
        : await readRunQuote(stateHome, app, envelope.run_id, "output.md");
    moments.push({
      at: envelope.started_at,
      run_id: envelope.run_id,
      pipeline: envelope.pipeline,
      pass: envelope.pass,
      role: envelope.role,
      ...(envelope.model !== undefined ? { model: envelope.model } : {}),
      ...(envelope.plan_version !== undefined ? { plan_version: envelope.plan_version } : {}),
      ...(envelope.plan_step_id !== undefined ? { plan_step_id: envelope.plan_step_id } : {}),
      ...(envelope.assignment_source !== undefined ? { assignment_source: envelope.assignment_source } : {}),
      status: envelope.status,
      headline: `${envelope.pass} (${envelope.role}) — ${envelope.status}`,
      ...(quote !== undefined ? { quote } : {}),
      evidence: `runs/${app}/${envelope.run_id}/`,
    });
  }
  if (publication !== undefined) {
    moments.push({
      at: publication.updated_at,
      run_id: `publication:${publication.publication_id}`,
      pipeline: "planner-publication",
      pass: "publication",
      role: "planner",
      status: publication.state,
      headline:
        publication.state === "published"
          ? `publication durable (${publication.branch_created ? publication.branch : "read-only"})`
          : `${publication.state}: ${publication.error?.code ?? "incomplete"}`,
      evidence: `planning/publications/${hashedFileStem(publication.app)}/${publication.publication_id}.json`,
    });
    moments.sort((left, right) => left.at.localeCompare(right.at) || left.run_id.localeCompare(right.run_id));
  }

  // Planning stories carry the tickets they published (#128).
  const published = ordered
    .map((envelope) => publishedTickets.get(envelope.run_id))
    .filter((record): record is NonNullable<typeof record> => record !== undefined);
  const plannedTickets = published.flatMap((record) =>
    record.published.map((t) => ({ issue_number: t.issue_number, title: scrubCaptureText(t.title), ready: t.ready })),
  );

  // Origin: the delegated parent-task prompt when recorded, else the
  // planning brief head — captured now, while the sources still exist.
  const taskId = ordered.find((e) => e.parent_task_id !== undefined)?.parent_task_id;
  const origin =
    taskId !== undefined
      ? { kind: "parent_task" as const, ref: taskId, quote: await readTaskOriginQuote(stateHome, taskId) }
      : kind === "planning"
        ? {
            kind: "planning_brief" as const,
            quote: await readRunQuote(stateHome, app, first.run_id, "brief.md", ORIGIN_QUOTE_MAX),
          }
        : undefined;

  const journal = kind === "ticket" ? await readDeliveryJournal(stateHome, episodeId) : undefined;
  const delivery =
    journal === undefined
      ? undefined
      : {
          stages: journal.stages.map((stage) => ({
            boundary: stage.boundary,
            status: stage.status,
            at: stage.completed_at,
            attempt: stage.attempt,
          })),
          status: journal.status,
          ...(journal.status === "completed" &&
          journal.stages.some((s) => s.boundary === "merge" && s.status === "completed")
            ? { outcome: "merged" }
            : journal.stop !== null
              ? { outcome: scrubCaptureText(`${journal.stop.kind}: ${journal.stop.reason}`) }
              : {}),
        };

  const rows = ledger.filter((row) => row.episodeId === episodeId);
  const settled = rows.filter((row) => row.unmeasured !== true);
  const cost =
    rows.length === 0
      ? undefined
      : {
          usd: Math.round(settled.reduce((sum, row) => sum + row.costUsd, 0) * 10_000) / 10_000,
          provider_turns: settled.length,
          unmeasured_turns: rows.length - settled.length,
        };

  const timestamps = [
    ...ordered.flatMap((e) => [e.started_at, e.finished_at ?? e.started_at]),
    ...(journal !== undefined ? [journal.updated_at] : []),
    ...published.map((record) => record.published_at),
    ...(publication === undefined ? [] : [publication.updated_at]),
  ].sort();

  return {
    schema_version: NARRATIVE_SCHEMA_VERSION,
    story_id: episodeId,
    app,
    kind,
    title: storyTitle(kind, episodeId, ordered, plannedTickets.length),
    opened: first.started_at,
    ...(isTerminal(ordered) && last.finished_at !== undefined && publication?.state !== "publication_pending"
      ? { closed: last.finished_at }
      : {}),
    status:
      publication?.state === "publication_pending"
        ? "in_progress"
        : publication?.state === "refused"
          ? "failed"
          : storyStatus(ordered, journal?.status),
    ...(origin !== undefined
      ? {
          origin: {
            kind: origin.kind,
            ...(origin.ref !== undefined ? { ref: origin.ref } : {}),
            ...(origin.quote !== undefined ? { quote: origin.quote } : {}),
          },
        }
      : {}),
    ...(plannedTickets.length > 0 ? { planned_tickets: plannedTickets } : {}),
    ...(publication === undefined
      ? {}
      : {
          publication: {
            id: publication.publication_id,
            state: publication.state,
            branch: publication.branch,
            commit: publication.commit,
            branch_created: publication.branch_created,
            error: publication.error?.message ?? null,
            recovery_command: publication.recovery.command,
          },
        }),
    ...(first.ticket !== undefined ? { ticket_ref: normalizeTicketRef(first.ticket) } : {}),
    moments,
    ...(delivery !== undefined ? { delivery } : {}),
    ...(cost !== undefined ? { cost } : {}),
    captured_at: timestamps[timestamps.length - 1] ?? first.started_at,
  };
}

function storyKind(episodeId: string, envelopes: RunEnvelope[]): StoryKind {
  if (episodeId.startsWith("ticket:")) return "ticket";
  if (envelopes.some((e) => e.planning_route !== undefined || e.pipeline.startsWith("plan"))) return "planning";
  return "trace";
}

function storyTitle(kind: StoryKind, episodeId: string, envelopes: RunEnvelope[], published: number): string {
  const first = envelopes[0]!;
  if (kind === "ticket") {
    return `Ticket ${normalizeTicketRef(first.ticket ?? episodeId.split(":").pop() ?? "?")}`;
  }
  if (kind === "planning") {
    const suffix = published > 0 ? ` — published ${published} ticket(s)` : "";
    return `Planning (${first.pipeline})${suffix}`;
  }
  return `${first.pipeline} trace`;
}

/** Production envelopes carry ticket refs already `#`-prefixed
 *  (`loop.ts` ticketRef = `#${issue.number}`); planning-era paths may hand a
 *  bare number. Normalize once so `##41` can never exist in a capture. */
function normalizeTicketRef(ticket: string): string {
  return ticket.startsWith("#") ? ticket : `#${ticket}`;
}

function isTerminal(envelopes: RunEnvelope[]): boolean {
  return envelopes.every((e) => e.status !== "running");
}

function storyStatus(envelopes: RunEnvelope[], journalStatus?: string): StoryStatus {
  if (!isTerminal(envelopes)) return "in_progress";
  if (journalStatus === "running") return "in_progress";
  if (
    envelopes.some(
      (e) => e.status === "failed" || e.status === "blocked" || e.status === "cancelled" || e.status === "timed_out",
    )
  )
    return "failed";
  if (envelopes.every((e) => e.status === "completed")) return "completed";
  return "unknown";
}

function ticketIssueNumber(ticketRef: string | undefined): number | undefined {
  if (ticketRef === undefined) return undefined;
  const match = /^#?(\d+)$/.exec(ticketRef);
  return match === null ? undefined : Number(match[1]);
}

function findPublicationRecord(
  records: Map<string, import("../loop/plan-publication-record.js").PublishedTicketsRecord>,
  issue: number,
): import("../loop/plan-publication-record.js").PublishedTicketsRecord | undefined {
  for (const record of records.values()) {
    if (record.published.some((t) => t.issue_number === issue)) return record;
  }
  return undefined;
}

/** Prefer the human projection of a structured verdict; fall back to the raw
 *  durable text for prose verdicts and pre-structured records. */
function formatVerdictQuote(verdictSummary: string): string {
  const digest = summarizeDurableVerdict(verdictSummary);
  return digest === undefined ? verdictSummary : formatDurableVerdictDigest(digest);
}
