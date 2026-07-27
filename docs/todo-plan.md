# Documentation reorg — todo plan

Status: **plan only**. Do not execute items here until we discuss and
explicitly green-light each one. PURPOSE → Decided remains the authority for
product decisions; this file is a working backlog for doc structure.

## Problem statement

`docs/` has grown into a flat pile of long, overlapping contracts. Operators
and agents cannot tell which file is the map, which is the deep dive, and
which is historical amendment. Several files restate the same boundary
(approvals, release, harness capabilities, development grants) at different
levels of detail. The existing topic folders (`learning-loop/`, `live-ui/`,
`narrative/`, `reporting/`) already show a better pattern; most of the
platform docs have not followed it yet.

We want fewer entry-point files at `docs/` root, topic folders for depth, and
no orphaned "amendment" docs once the design is live. We are **not** solving
the full split in this pass — only recording the backlog so we can discuss
sequencing and ownership.

---

## Todo

### 1. Retire `docs/approval-and-release-amendment.md`

Move whatever substance is still needed into `docs/architecture.md` (A4
`release:` schema, A1 threat / never-scopeable detail, A-002 content-bound
grant identity note, Stage 6 regression checklist as appropriate). Then
delete the amendment file and update path citations (AGENTS.md, PURPOSE
pointers, code comments, `docs/loop.md`, etc.).

Rationale: A1–A5 are ratified and implemented. PURPOSE already holds the
Decided summary; the standalone amendment is living as a third home.

Sequencing note (discuss): item 4 will later break architecture into topic
folders. Absorbing into architecture first is a deliberate interim landing so
we delete the orphan now; expect a second move when §4 (approvals) becomes
its own folder doc.

### 2. Adopt topic folder structure (details TBD)

Agreed direction from review:

| Proposed folder | Initial contents (illustrative) |
| --- | --- |
| `docs/harness/` | capability matrix (optionally renamed harness-capability-matrix), adding/updating harnesses |
| existing `learning-loop/`, `live-ui/`, `narrative/`, `reporting/` | keep; use as the pattern |
| further folders | approvals, loop, scheduler, efficiency, etc. — decide with item 4 |

Rename `capability-matrix.md` → something harness-scoped when it moves.
Sweep hardcoded paths (`scripts/eval/release-attestation.ts`, AGENTS.md,
README, wiki, runtime AGENTS, comments).

Optional related cleanup (same pass or follow-on): split the live matrix
table from the long qualification-evidence archaeology (that evidence belongs
near `research/evals/`, not in the day-to-day harness contract).

### 3. Shrink `docs/development.md`

Keep the file — it is the canonical developer control-plane policy and is
pinned by packaging/eval boundaries. Trim campaign-ephemeral material
(current Phase 6 grant path / command block and similar dated procedure) so
the durable policy remains: two control planes, standing grants, proportionate
evidence, incremental ladder, shipping discipline. Point ephemeral procedure
at the active auth YAML / efficiency notes instead of embedding it.

### 4. Decompose `docs/architecture.md` into topic folders

**Problem (for discussion, not execution yet):**

`architecture.md` (~1100+ lines) is both the high-level system map and a
dump of implementation sections that already have, or should have, peer docs:

| architecture.md section (today) | Natural peer / home |
| --- | --- |
| §0 Overview | stay in thin root `architecture.md` |
| §1 On-disk layout | stay or short `docs/` root note |
| §2 Dispatcher & scheduler | overlaps `scheduler.md` |
| §3 Turn lifecycle / worktrees / crash recovery | overlaps `loop.md` |
| §4 Approval surface | becomes approvals topic (after item 1 lands there) |
| §5 Context assembly | own folder or loop/org deep dive |
| §6 Memory & scorecards | learning-loop / org |
| §7 Multi-app / budget | org / apps |
| §8 EpisodePlanner boundary | loop / planning |
| §9 Greenfield / bootstrap | onboarding |
| §10 GitHub substrate | loop |
| §11–12 PURPOSE pointers / open questions | PURPOSE / issues |

Proposed end state (sketch):

- **Root docs stay thin and navigational:** `PURPOSE.md`, `VISION.md`,
  `development.md`, and a short `architecture.md` that is the high-level map
  + links into topic folders (same role PURPOSE plays for decisions).
- **Depth lives in folders**, same pattern as `learning-loop/`, `live-ui/`,
  `narrative/`: one concern per folder, one primary design/spec file, no
  second full copy in architecture.
- **Peer monoliths need the same treatment:** `loop.md` (~1200 lines) and
  `efficiency.md` (~500 lines) are part of the same readability problem —
  architecture is not the only offender. Reconcile overlaps so each fact has
  one home and architecture only indexes.

Open design questions before executing:

- What is the minimum viable root `architecture.md` (diagram + layer table +
  links only)?
- Do we merge overlapping prose into the folder doc and leave stubs, or keep
  a one-page summary in architecture and deep detail only in the folder?
- Order of moves relative to items 1–3 (avoid thrashing path citations twice
  where possible).

---

## Open questions (not yet todos)

### A. Remove `docs/wiki.html`?

Candidate for removal: hand-maintained HTML (~700 lines), linked from README
(“New to the code?”) and AGENTS.md as the code wiki. It duplicates
architecture/layer guidance and will drift as markdown reorgs.

Lean: **remove after** root markdown + folder navigation is good enough to
replace the onboarding path — or remove now and point README at
`architecture.md` if we accept losing the visual wiki. Decide explicitly;
do not orphan the README link.

### B. Move `research/` under `docs/`?

Lean: **no.** `research/` is dated decision records and eval campaign
evidence (~7.6M, including `research/evals/` artifacts). AGENTS.md treats it
as a separate repo-map entry from product docs. Putting it under `docs/`
blurs “how the system works” with “what we proved on date X,” and would pull
heavy evidence trees into the documentation tree.

Prefer: keep `research/` at repo root; from docs, link out where a contract
cites a dated record. If anything moves, it would be the opposite direction —
pulling long qualification archaeology *out* of docs into research (see
item 2 optional cleanup).

---

## Suggested discussion order

1. Confirm item 1 interim landing (architecture absorb → delete amendment).
2. Sketch folder names for item 2 + 4 together (so harness/approvals/loop
   land once).
3. Agree how thin root `architecture.md` should be (item 4 open questions).
4. Decide wiki.html (A) and research/ (B).
5. Execute in small PRs; update AGENTS.md navigation in the same change as
   each move.
