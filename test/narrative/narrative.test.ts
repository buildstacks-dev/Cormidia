// Narrative V1 (#129; docs/narrative/design.md): the fold from durable
// sources, quote-at-capture redaction, merge-never-lose semantics, and
// deterministic rendering. All offline, temp state homes, no wall clock in
// any assertion (captured_at derives from source timestamps).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executionJournalPath } from "../../src/loop/execution-journal.js";
import {
  listCapturedStories,
  mergeStory,
  readCapturedStory,
  storySlug,
  writeCapturedStory,
} from "../../src/narrative/capture.js";
import { renderIndexMarkdown, renderStoryMarkdown } from "../../src/narrative/render.js";
import { foldAppStories } from "../../src/narrative/story.js";
import type { NarrativeStory } from "../../src/narrative/types.js";

const APP = "greenfield";
const PLAN_EPISODE = "trace:greenfield:plan-greenfield-1000";
const TICKET_EPISODE = "ticket:greenfield:41";
const PLAN_RUN = "20260711-090000-plan-bootstrap-bootstrap-plan";
const BUILD_RUN = "20260712-100000-build-standard-implement";

describe("narrative fold", () => {
  let stateHome: string;
  afterEach(() => rmSync(stateHome, { recursive: true, force: true }));

  function envelope(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      schema_version: 1,
      run_id: BUILD_RUN,
      trace_id: "turn-1",
      app: APP,
      pipeline: "build-standard",
      pass: "implement",
      role: "builder",
      status: "completed",
      started_at: "2026-07-12T10:00:00.000Z",
      finished_at: "2026-07-12T10:20:00.000Z",
      refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
      ...overrides,
    };
  }

  function seedRun(runId: string, envelopeJson: Record<string, unknown>, files: Record<string, string> = {}): void {
    const dir = join(stateHome, "runs", APP, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "envelope.json"), JSON.stringify(envelopeJson, null, 2));
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  }

  function seedFixture(): void {
    stateHome = mkdtempSync(join(tmpdir(), "operon-narrative-"));
    // Planning episode: one pass, a published-tickets record (#128), a brief.
    seedRun(
      PLAN_RUN,
      envelope({
        run_id: PLAN_RUN,
        trace_id: "plan-greenfield-1000",
        episode_id: PLAN_EPISODE,
        pipeline: "plan-bootstrap",
        pass: "bootstrap-plan",
        role: "planner",
        model: "claude-opus-4-8",
        started_at: "2026-07-11T09:00:00.000Z",
        finished_at: "2026-07-11T09:05:00.000Z",
        verdict_summary: "quick plan validated: one scaffold ticket",
        planning_route: { policy_version: "planning-depth/v2", depth: "quick", risk_tier: "low", factors: {}, decision_factors: [], selected_passes: [], skipped_passes: [], estimated_cost_usd: null, estimated_cost_upper_bound_usd: 1, estimate_basis: "test" },
      }),
      { "brief.md": "# Pass: bootstrap-plan\nGoal: A personal website for the founder.\n" },
    );
    writeFileSync(
      join(stateHome, "runs", APP, PLAN_RUN, "published-tickets.json"),
      JSON.stringify({
        schema_version: 1,
        app: APP,
        episode_id: PLAN_EPISODE,
        run_id: PLAN_RUN,
        trace_id: "plan-greenfield-1000",
        published_at: "2026-07-11T09:06:00.000Z",
        published: [{ index: 0, issue_number: 41, title: "Ship the scaffold", ready: true, labels: ["op:ready"] }],
      }),
    );
    // Build episode: one implement pass on ticket 41, with an L3 output
    // containing a seeded secret that must never reach a quote. The ticket
    // field is PRODUCTION-shaped — loop.ts stamps `#${issue.number}` — the
    // review-fix regression is that a bare "41" fixture masked a ##41 bug.
    seedRun(
      BUILD_RUN,
      envelope({
        episode_id: TICKET_EPISODE,
        ticket: "#41",
        plan_version: 4,
        plan_step_id: "build-ticket-41",
        assignment_source: "configured",
      }),
      { "output.md": "Implemented the scaffold. Never log sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa again.\n" },
    );
    // Execution journal for the build episode.
    const journalPath = executionJournalPath(stateHome, TICKET_EPISODE);
    mkdirSync(join(journalPath, ".."), { recursive: true });
    writeFileSync(
      journalPath,
      JSON.stringify({
        schema_version: 1,
        episode_id: TICKET_EPISODE,
        app: APP,
        ticket_ref: "#41",
        stages: [
          { boundary: "implementation", status: "completed", artifact_sha256: "a", completed_at: "2026-07-12T10:20:00.000Z", attempt: 1 },
          { boundary: "merge", status: "completed", artifact_sha256: "b", completed_at: "2026-07-12T11:00:00.000Z", attempt: 1 },
        ],
        status: "completed",
        next_boundary: null,
        stop: null,
        updated_at: "2026-07-12T11:00:00.000Z",
      }),
    );
    // Settled ledger rows join per episode.
    mkdirSync(join(stateHome, "telemetry"), { recursive: true });
    writeFileSync(
      join(stateHome, "telemetry", "2026-07-12.jsonl"),
      [
        JSON.stringify({ at: "2026-07-12T10:20:00.000Z", role: "builder", runtime: "claude", model: "m", status: "completed", tokensIn: 10, tokensOut: 5, costUsd: 2.5, usageQuality: "complete", subagentTurns: 0, wallClockMs: 1, escalations: 0, app: APP, episodeId: TICKET_EPISODE }),
        JSON.stringify({ at: "2026-07-11T09:05:00.000Z", role: "planner", runtime: "claude", model: "m", status: "completed", tokensIn: 9, tokensOut: 3, costUsd: 0.9, usageQuality: "complete", subagentTurns: 0, wallClockMs: 1, escalations: 0, app: APP, episodeId: PLAN_EPISODE }),
      ].join("\n") + "\n",
    );
  }

  it("folds planning and ticket stories, joins them through #128, and settles cost from the ledger", async () => {
    seedFixture();
    const { stories, problems } = await foldAppStories(stateHome, APP);
    expect(problems).toEqual([]);
    expect(stories).toHaveLength(2);

    const planning = stories.find((s) => s.story_id === PLAN_EPISODE)!;
    expect(planning.kind).toBe("planning");
    expect(planning.planned_tickets).toEqual([{ issue_number: 41, title: "Ship the scaffold", ready: true }]);
    expect(planning.origin?.kind).toBe("planning_brief");
    expect(planning.origin?.quote?.text).toContain("A personal website for the founder");
    expect(planning.cost).toEqual({ usd: 0.9, provider_turns: 1, unmeasured_turns: 0 });
    // captured_at folds the newest source timestamp (the publication).
    expect(planning.captured_at).toBe("2026-07-11T09:06:00.000Z");

    const ticket = stories.find((s) => s.story_id === TICKET_EPISODE)!;
    expect(ticket.kind).toBe("ticket");
    // Production `ticket: "#41"` normalizes once — never "##41" (review fix).
    expect(ticket.ticket_ref).toBe("#41");
    expect(ticket.title).toBe("Ticket #41 — Ship the scaffold");
    expect(ticket.planned_by).toEqual({
      episode_id: PLAN_EPISODE,
      run_id: PLAN_RUN,
      trace_id: "plan-greenfield-1000",
    });
    expect(ticket.delivery?.outcome).toBe("merged");
    expect(ticket.delivery?.stages.map((s) => s.boundary)).toEqual(["implementation", "merge"]);
    expect(ticket.cost).toEqual({ usd: 2.5, provider_turns: 1, unmeasured_turns: 0 });
    expect(ticket.status).toBe("completed");
    expect(ticket.moments[0]).toMatchObject({
      plan_version: 4,
      plan_step_id: "build-ticket-41",
      assignment_source: "configured",
    });
    expect(planning.moments[0]).not.toHaveProperty("plan_version");
    expect(planning.moments[0]).not.toHaveProperty("plan_step_id");
    expect(planning.moments[0]).not.toHaveProperty("assignment_source");
  });

  it("rejects envelopes whose identity does not bind to their run dir (review fix)", async () => {
    seedFixture();
    // A copied/tampered run dir whose envelope claims a foreign run_id must
    // never reach path joins (readRunQuote) or collapse onto another moment.
    seedRun("20260713-000000-build-standard-copy", envelope({ run_id: "../escape/target" }));
    seedRun("20260713-000001-build-standard-foreign", envelope({ run_id: "20260713-000001-build-standard-foreign", app: "other-app" }));
    const { stories, problems } = await foldAppStories(stateHome, APP);
    expect(stories).toHaveLength(2); // both intruders skipped, base stories intact
    expect(problems.filter((p) => p.includes("not a valid v1 envelope for this run dir"))).toHaveLength(2);
  });

  it("re-scrubs verdict summaries with the CURRENT pattern list at capture time (review fix)", async () => {
    seedFixture();
    seedRun(
      "20260713-000002-build-standard-verify",
      envelope({
        run_id: "20260713-000002-build-standard-verify",
        episode_id: TICKET_EPISODE,
        ticket: "#41",
        pass: "verify",
        started_at: "2026-07-13T00:00:00.000Z",
        finished_at: "2026-07-13T00:01:00.000Z",
        verdict_summary: "PASS — but found sk-ant-api03-bbbbbbbbbbbbbbbbbbbbbbbb in a log line",
      }),
    );
    const { stories } = await foldAppStories(stateHome, APP);
    const ticket = stories.find((s) => s.story_id === TICKET_EPISODE)!;
    const verify = ticket.moments.find((m) => m.pass === "verify")!;
    expect(verify.quote!.text).toContain("PASS");
    expect(verify.quote!.text).not.toContain("sk-ant-api03");
  });

  it("a partial fold (earliest sources swept) never regresses captured story fields (review fix)", async () => {
    seedFixture();
    const first = await foldAppStories(stateHome, APP);
    const capturedTicket = first.stories.find((s) => s.story_id === TICKET_EPISODE)!;
    expect(capturedTicket.title).toBe("Ticket #41 — Ship the scaffold");

    // Simulate: planning runs + ledger swept; the ticket run alone survives,
    // plus a NEW later verify run (so the fresh fold is genuinely fresh but
    // its view of planning-derived fields regressed).
    rmSync(join(stateHome, "runs", APP, PLAN_RUN), { recursive: true, force: true });
    rmSync(join(stateHome, "telemetry"), { recursive: true, force: true });
    const second = await foldAppStories(stateHome, APP);
    const fresh = second.stories.find((s) => s.story_id === TICKET_EPISODE)!;
    expect(fresh.title).toBe("Ticket #41"); // regressed: publication record gone
    expect(fresh.cost).toBeUndefined(); // regressed: ledger swept

    const merged = mergeStory(capturedTicket, fresh);
    expect(merged.title).toBe("Ticket #41 — Ship the scaffold"); // enrichment kept
    expect(merged.cost).toEqual(capturedTicket.cost); // settlement kept
    expect(merged.planned_by).toEqual(capturedTicket.planned_by);
    expect(merged.opened).toBe(capturedTicket.opened);

    // And a PARTIAL fold (fresh missing a captured run) can never flip a
    // terminal status or shrink the moment set.
    const partial = { ...fresh, moments: [], status: "failed" as const };
    const guarded = mergeStory(capturedTicket, partial);
    expect(guarded.status).toBe(capturedTicket.status);
    expect(guarded.moments.length).toBe(capturedTicket.moments.length);
  });

  it("never lets a seeded secret reach a quote (L3 is unredacted; narrative is shareable)", async () => {
    seedFixture();
    const { stories } = await foldAppStories(stateHome, APP);
    const ticket = stories.find((s) => s.story_id === TICKET_EPISODE)!;
    const quote = ticket.moments[0]!.quote!;
    expect(quote.text).toContain("Implemented the scaffold");
    expect(quote.text).not.toContain("sk-ant-api03");
    expect(JSON.stringify(stories)).not.toContain("sk-ant-api03");
  });

  it("merge preserves captured quotes and moments after the run dirs are swept", async () => {
    seedFixture();
    const first = await foldAppStories(stateHome, APP);
    for (const story of first.stories) await writeCapturedStory(stateHome, story);

    // Retention sweeps runs/ — the fold now sees nothing for these episodes.
    rmSync(join(stateHome, "runs"), { recursive: true, force: true });
    const second = await foldAppStories(stateHome, APP);
    expect(second.stories).toHaveLength(0);

    const captured = await listCapturedStories(stateHome, APP);
    expect(captured.problems).toEqual([]);
    const ticket = captured.stories.find((s) => s.story_id === TICKET_EPISODE)!;
    expect(ticket.moments).toHaveLength(1);
    expect(ticket.moments[0]!.quote!.text).toContain("Implemented the scaffold");

    // A fresh fold that HAS the story but lost a moment's quote source
    // keeps the captured quote through the merge.
    const { quote: _dropped, ...bare } = ticket.moments[0]!;
    const fresh: NarrativeStory = { ...ticket, moments: [bare] };
    const merged = mergeStory(ticket, fresh);
    expect(merged.moments[0]!.quote!.text).toContain("Implemented the scaffold");
  });

  it("renders byte-stable markdown and a month-grouped, newest-first index", async () => {
    seedFixture();
    const { stories } = await foldAppStories(stateHome, APP);
    const ticket = stories.find((s) => s.story_id === TICKET_EPISODE)!;
    const one = renderStoryMarkdown(ticket);
    expect(one).toBe(renderStoryMarkdown(ticket));
    expect(one).toContain("# Ticket #41 — Ship the scaffold");
    expect(one).toContain("| merge | completed |");
    expect(one).toContain(`Planned by: [\`${PLAN_EPISODE}\`](${storySlug(PLAN_EPISODE)}.md)`);
    expect(one).toContain("plan v4 · step `build-ticket-41` · assignment `configured`");
    expect(one).toContain("$2.50 settled across 1 provider turn(s)");

    const index = renderIndexMarkdown(APP, stories);
    expect(index).toBe(renderIndexMarkdown(APP, stories));
    expect(index).toContain("## 2026-07");
    // Newest first: the ticket story (07-12) precedes the planning story (07-11).
    expect(index.indexOf("Ticket #41")).toBeLessThan(index.indexOf("Planning (plan-bootstrap)"));
    expect(index).toContain("published #41");
  });

  it("surfaces corrupt captures without overwriting them and tolerates torn envelopes", async () => {
    seedFixture();
    // Torn envelope alongside the good ones.
    seedRun("20260713-000000-build-standard-verify", { schema_version: 99 } as never);
    const { stories, problems } = await foldAppStories(stateHome, APP);
    expect(stories).toHaveLength(2);
    expect(problems.some((p) => p.includes("20260713-000000-build-standard-verify"))).toBe(true);

    // Corrupt capture: reported by the lister, thrown by the reader.
    const dir = join(stateHome, "narrative", APP);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${storySlug(TICKET_EPISODE)}.json`), "{ torn");
    const captured = await listCapturedStories(stateHome, APP);
    expect(captured.problems.some((p) => p.includes("unreadable"))).toBe(true);
    await expect(readCapturedStory(stateHome, APP, TICKET_EPISODE)).rejects.toThrow(/not valid JSON/);
    expect(await readFile(join(dir, `${storySlug(TICKET_EPISODE)}.json`), "utf8")).toBe("{ torn");
  });
});
