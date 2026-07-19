# Narrative V1 — human-level causal observability (`operon narrative`)

Status: implemented (#129, workstream:narrative). This file is the surface's
authoritative contract, following the observe/report/scheduler precedent.

## 1. Purpose and non-goals

Telemetry answers "what did it cost", Observe answers "what is happening",
Reports answer "what happened, statistically". Narrative answers the question
a human actually asks: **"why does the product look like this?"** — this
prompt came in → produced this plan → which created these tickets → which the
builder built → which were reviewed and merged.

Non-goals, inherited deliberately:
- **No model-authored prose** (docs/reporting/design.md decision): the story
  is templated deterministically over durable records. Zero tokens, zero
  chance of a history that is subtly wrong about itself.
- **No workflow state**: a presentation-only leaf. Deleting `narrative/`
  loses captured quotes whose sources have since been retention-swept, but
  never affects a run.
- **No network**: renders from disk alone. (The permanent `Planned-by:`
  ticket trailer enables GitHub-side re-derivation later; V1 does not fetch.)

## 2. Story unit: the episode, not the day

One markdown file per episode; a time-ordered `INDEX.md` per app links into
them. A ticket spanning three days stays one unbroken arc; "show me July" is
an index slice. Date-bucketing is the right axis for logs, which is exactly
why it is the wrong axis for narrative.

## 3. Storage and retention

State home:
```
narrative/<app>/
  INDEX.md               time-ordered episode index (regenerated each render)
  <episode-slug>.json    story capture — the durable projection incl. quotes
  <episode-slug>.md      rendered story (derived from capture each render)
```
- `<episode-slug>` = episode id with path-unsafe chars collapsed, suffixed
  with an 8-hex sha256 of the exact id (`storySlug`, src/narrative/capture.ts)
  so unvalidated app names and `:`-bearing episode ids can never collide or
  escape the directory.
- The `.json` capture is the source of truth for the `.md`; markdown format
  can evolve without losing captured quotes.
- Retention: `narrativeDays: 1825` in `DEFAULT_STATE_RETENTION` — the
  longest window in the table; this is the institutional record the other
  subtrees feed. The sweeper ages a story pair by the capture's own
  `captured_at`, keeps torn files fail-safe, and never touches INDEX.md
  (src/org/retention.ts `sweepNarrative`).

## 4. Quote-at-write-time

`runs/` (all verbatim L1+L3) is swept at 30 days; the join IDs live 180–365.
A pure-hyperlink narrative reads beautifully for a month and then becomes
dead links. So the projector **inlines bounded, redacted excerpts at capture
time** and links to full forensics as a bonus that degrades gracefully:

- originating prompt (parent task `prompt.md`, or the planning brief goal)
- the plan thesis + published ticket list (`published-tickets.json`, #128)
- per pass: role, model, verdict summary, short output excerpt
- gate results, review findings, approval decisions
- merge/release outcome (ExecutionJournal stages + ticket transitions)

Rules:
- Every quoted byte passes through `scrubSecrets` (the ONE secret-regex
  list) — L3 is unredacted by design; narrative must be shareable.
- Excerpts are bounded (per-quote and per-story byte caps).
- **Merge, never overwrite**: re-render re-projects from live sources and
  keeps previously captured quotes whose sources are gone. An episode whose
  sources are fully swept renders unchanged from its capture.

## 5. Sources (all existing, all read-only)

| Hop | Source |
| --- | --- |
| originating prompt | `tasks/<taskId>/prompt.md` (180d) |
| support/company event → turn | `TurnJournal.event` |
| event → planner feed → planner turn | `standing-roles/<app>/planner-feeds/` receipts |
| planner run → tickets | `published-tickets.json` (#128) + `Planned-by:` trailer |
| ticket → episode | deterministic episode id |
| episode → turns/runs/passes | `learning/episodes/<id>.json` (unswept) |
| ticket build→review→merge | `efficiency/episodes/<hash>/execution-journal.json` (180d) |
| verbatim text | `runs/<app>/<runId>/{brief,prompt,output}.md` (30d) |
| cost | telemetry ledger rows (365d) |

Every reader tolerates absence (returns "expired/unknown", never throws the
render away) and surfaces corruption without masking it.

## 6. Module shape

`src/narrative/` (presentation leaf; imports org/loop/runtime, nothing
imports it except its CLI):
- `types.ts` — the v1 capture schema (`NarrativeStory`, moments, quotes)
- `sources.ts` — tolerant readers over the table above; every quoted byte
  passes `scrubSecrets`, corruption is collected into `problems[]`, never
  thrown away with the render
- `story.ts` — the pure fold: envelopes grouped by episode → stories;
  planning↔ticket join through #128 publication records, delivery from the
  execution journal, cost from settled ledger rows only
- `capture.ts` — merge-write `<slug>.json` (writeLoopFileAtomic): fresh
  structure wins, captured quotes/moments are never lost, corrupt captures
  are surfaced and never overwritten
- `render.ts` — deterministic markdown for stories and the INDEX; no
  wall-clock ("as of" derives from the capture's newest source timestamp)
- `src/cli/narrative.ts` — `operon narrative [--app <app>] [--episode <id>]
  [--json]`; one registry line in cli.ts. Default renders all apps found in
  apps.yaml ∪ runs/ ∪ narrative/; `--episode` prints one story without
  writing.

## 7. Scope V1 and follow-ups

V1: build episodes end-to-end (ticket → PR → merge) plus planning traces,
joined through #128. Standing-role episodes (SRE/Support/Marketing drafts
that never become tickets) and GitHub-side re-derivation are follow-ups.

## 8. Tests

Fixtures via `test/fixtures/orgHome.ts` + `fakeClock.ts`:
- byte-stable output on unchanged sources (determinism)
- quote preservation after deleting `runs/` (retention survival)
- seeded secret never reaches capture or render (redaction)
- corrupt/torn/missing source tolerance
- in-progress episode → completed transition (merge semantics)
- INDEX ordering and slug collision behavior
