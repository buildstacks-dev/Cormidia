# Proposed AGENTS.md section — validation harness routing

> **Audience signpost** <!-- changelog 2026-08-10 (reader test 33, coding-agent
> finding 1): two unrelated audiences shared this file with no signpost — an
> ordinary feature/bugfix agent had to read ~90 lines of landing meta-procedure
> first; scoped same day (final-gate follow-up 27): "skip everything above the
> heading" over-skipped — two things in this block DO govern ordinary work -->:
> for ordinary feature or bug-fix work, **read three things below — the
> "How to treat each section" meta-rule (it governs new work: follow unlanded
> sections, never claim their gates exist in CI <!-- exemption added
> 2026-08-10 (final-gate follow-up 31): the skip previously swallowed this
> rule too -->), the section-status table, and the mixed-posture
> change-description rule — then
> skip everything else from here down to the
> `## Validation harness (replacement, designed 2026-07-31)` heading** <!--
> boundary made explicit 2026-08-10 (reader test 36, coding-agent finding 1):
> "skip the REST of this block" had no defined boundary — the skippable landing
> procedure (marker definition, mechanized check, comment-stripping) lives in
> the Status paragraph BELOW this blockquote, not inside it --> — that whole
> stretch (this blockquote's landing notes AND the Status paragraph after it)
> concerns ONLY the person landing this document itself into
> the repo's AGENTS.md, and never belongs in an ordinary change description.
> After the base section, **also read every section the status table below
> marks "Follow for new work: Yes" — currently all four** <!-- changelog
> 2026-08-10 (reader test 41, coding-agent finding 6): whether the addenda
> were also required reading was only inferable from the table, twenty lines
> away -->.

> **How to treat each section of this file (added 2026-08-10, Phase 8 reader test —
> coding-agent findings 1 and 4).** This file stacks one ratified section
> (2026-07-31) and dated addenda, each carrying its own landing status. One
> meta-rule covers ALL of them: **whether a section has landed in the repo's real
> `AGENTS.md`/`CLAUDE.md` (both at the **repo root**, beside `validation-design/`
> <!-- changelog 2026-08-10 (reader test 17, coding-agent finding 3): the one
> external anchor this file's activation logic depends on had no stated path -->)
> is verified against that file, never against this one** —
> this file records proposals and their ratification history. Until a section
> lands: read it, follow it for new work, and do not represent its gates as
> already existing in CI. That includes the rev-2026-08-10 traceability
> conventions: honor them for new work now (they are mechanical hygiene that costs
> nothing before enforcement); their CI enforcement arrives only with the
> `validation-trace` CLI landing.
>
> **Section status at a glance** <!-- changelog 2026-08-10 (reader test 11,
> coding-agent finding 3): the four postures previously lived only in each
> section's own preamble -->:
>
> | Section | Ratification posture | Follow for new work? |
> |---|---|---|
> | 2026-07-31 base section | Human-ratified (§9); landing verified against the repo's AGENTS.md | Yes |
> | 2026-08-03 addendum | Design accepted (§10.7); exact protocol-surface edit approval still pending | Yes |
> | 2026-08-07 addendum (jobs + L-ACC) | Proposal with rationale; owner engaged same-day on its findings | Yes |
> | rev-2026-08-10 addendum (traceability) | DRAFT — AI-stakeholder seat, pending real-human ratification (§12); block wording fixed if adopted | Yes (hygiene now; enforcement only with the trace CLI) |
>
> **Mixed-posture changes** <!-- changelog 2026-08-10 (reader test 23,
> coding-agent finding 3): no template existed for a change spanning sections
> with different postures -->: a change touching sections of more than one
> posture describes itself under the **most restrictive posture it touches**
> (DRAFT-pending beats proposal beats design-accepted beats ratified) and names
> each touched section's posture in its change description — never let the
> ratified section's status speak for the whole change. Mid-change re-check is
> one command: `grep -n 'Ratification posture' agents-md-contribution.md` jumps
> to this table <!-- changelog 2026-08-10 (reader test 24, coding-agent
> finding 4): posture bookkeeping had no mechanical hint, unlike the
> blocked-work scan -->. Worked example <!-- changelog 2026-08-10 (reader
> test 26, coding-agent finding 5): the format had no example, unlike the
> layer rule and HB-minting. Example replaced 2026-08-10 (final-gate
> follow-up 34): the first example (catalog row + spec header) contradicted
> the touching-definition below — those are COMPLIANCE, not section edits, and
> owe no posture label -->: a change that **corrects a sentence in the
> ratified base section AND amends the rev-2026-08-10 addendum's own text**
> (two genuine section edits, two postures)
> describes itself as — "DRAFT-posture change (most restrictive touched:
> rev-2026-08-10 traceability addendum, pending §12 ratification; also edits
> the ratified base section)". **What "touching" means,
> precisely** <!-- changelog 2026-08-10 (reader test 42, coding-agent
> finding 2): the example could be read as making nearly every spec-writing
> change DRAFT-posture -->: COMPLYING with a section's conventions (e.g.
> writing a spec header per the DRAFT addendum's hygiene rules) is NOT
> touching that section — touching means **editing the section's own text or
> landing its block**. Ordinary spec-writing work therefore owes no posture
> label at all; only changes to this file's sections themselves do.

Status: RATIFIED 2026-07-31 (ratification-package.md §9) for the Cormidia repo's
human-ratified `AGENTS.md` (and mirrored in `CLAUDE.md`) — the section below is
being landed. AGENTS.md is a ratified surface; this section carries the owner's
ratification. Present verbatim below the marker. **The marker, defined** <!--
changelog 2026-08-10 (reader test 30, coding-agent finding 1): "the marker" was
never named anywhere in the corpus; corrected same day (final-gate
follow-up 23): the first definition named a bare `## Validation harness`
heading that does not exist in the repo — the real heading carries a suffix,
and "create marker then land payload" would have produced duplicate H2s -->:
the **exact existing heading
`## Validation harness (replacement, designed 2026-07-31)`** in the repo-root
`AGENTS.md` (the section `case-catalog.md` §10 cites as "AGENTS.md →
Validation harness"). Landing **replaces that section's BODY with the
normalized (comment-stripped) payload minus the payload's own duplicate
heading line** — the payload below begins with the same suffixed H2, which is
NOT emitted a second time. Absent-marker case, explicitly: only if NO heading
starting `## Validation harness` exists anywhere in AGENTS.md does the landing
change append the payload whole (its own heading included) as a new top-level
section at the end of the file. **Mechanized check before choosing the
branch** <!-- changelog 2026-08-10 (reader test 31, coding-agent finding 2):
every other verification step here has an exact command; the highest-stakes
one didn't -->: from the repo root run
`grep -nF '## Validation harness (replacement, designed 2026-07-31)' AGENTS.md`
— a hit selects the replace-body branch at that line; on no hit, run
`grep -n '^## Validation harness' AGENTS.md` — any hit means a
differently-suffixed heading exists (STOP: that is a corpus finding, neither
branch applies until resolved); no hit at all selects the append-whole branch. **What "verbatim" ships** <!-- changelog 2026-08-10
(reader test 30, coding-agent finding 2): the base section is saturated with
corpus-process HTML changelog comments and nothing said whether they ship -->:
the normative text WITHOUT the `<!-- changelog … -->` / `<!-- ratification … -->`
HTML comments — those narrate THIS design artifact's revision history and are
meaningless in the repo's AGENTS.md; the landing change strips them all. The
rev-2026-08-10 frozen traceability block is unaffected by stripping (its
normative block text carries no embedded HTML comments; its glosses already
live adjacent, outside the frozen block, by that addendum's own rule).
<!-- ratification 2026-07-31: status flipped from PROPOSAL; spend digest amended
(release ≤24 turns/$100); blocked-work sentence narrowed to HB-P3/HB-P5;
Activation paragraph updated. -->

<!-- changelog 2026-07-31 (post reader test): added activation clause (coding-agent
finding 4); named risk-allocation/system-map/boundary-map + T-tag source (finding 2);
golden-set targeting pointer (finding 3); new-finding procedure + single-source rule
(findings 5, 8); structural-additions rule (finding 6); harness-backlog.md named
(finding 7); self-contained standing-rules digest replacing bare skill-rule citations
(finding 1). -->

---

## Validation harness (replacement, designed 2026-07-31)

**Activation.** The product owner worked through
`validation-design/ratification-package.md` on 2026-07-31 (its §9 is the ratification
record) and this section is being landed in AGENTS.md. Once
landed, it is binding. Until the landing merges, treat the design artifacts as
ratified but not yet wired: read them, follow them for new work, but do not
represent their gates as already existing in CI.

**Where truth lives.** The design artifacts are at the paths in
`validation-policy.yaml` → `artifacts:` (start at `validation-design/README.md`; the
set moves with the harness into `tests/`). **Path convention, whole file** <!--
changelog 2026-08-10 (reader test 6, coding-agent finding 2; scoped correctly at
reader test 9, coding-agent finding 1: the rule read as blanket but the addenda
cite repo-root paths) -->: bare *design-artifact* filenames resolve relative to
`validation-design/` — the closed rule is: **every artifact the policy
`artifacts:` block lists with a `./` prefix** (`case-catalog.md`,
`boundary-map.md`, `risk-allocation.md`, `contracts/…`, `llm-eval-plan.md`,
`system-map.md`, `harness-backlog.md`, and the rest — the list here is
illustrative, the `./`-prefix rule is exhaustive <!-- changelog 2026-08-10
(reader test 14, coding-agent finding 4) -->); paths that are plainly repo-root — `acceptance/**`,
`docs/**`, and the protocol surfaces (`TASTE.md`, `roles.yaml`, `pipelines.yaml`,
`prompts/**`, `PURPOSE.md`) — resolve from the repository root. **Scope of the
machine-readable resolver, precisely** <!-- changelog 2026-08-10 (reader
test 31, coding-agent finding 1): the previous sentence claimed the artifacts:
block records the five protocol surfaces; it does not — verified, none of the
five appear there -->: `validation-policy.yaml → artifacts:`'s `./` vs `../`
prefixes machine-resolve **only the artifacts that block actually lists**
(corpus files plus `../acceptance/**` and two `../docs/**` design contracts);
the five protocol surfaces are NOT registry entries — their repo-root
resolution is stated HERE, in prose, and they are governed by the
ratification rules above, not by the registry. This file lands in the repo-root AGENTS.md,
so keep both anchors in mind. **Two similarly-named state files exist —
never confuse them** <!-- changelog 2026-08-10 (reader test 31, coding-agent
finding 3) -->: `harness-design-state.md` (human-readable design/gate history;
the finding MIRROR this file tells you to update) vs `harness-state.yaml`
(machine-written run state; NEVER hand-edited — a grep for "harness state"
hits both). The policy file is the contract:
layer lanes, gates, spend bounds, verdict semantics, and open findings. **The policy
is tighten-only** — narrow a requirement if you must, never loosen one; gates and
golden sets are never weakened to make a change pass.

**Feature changes** — step zero, if your ticket does not already name the
affected structures <!-- changelog 2026-08-10 (reader test 33, coding-agent
finding 2): the routing assumed the code→boundary mapping was known; corrected
same day (final-gate follow-up 27): the first version cited a
module→source-path→boundary crosswalk that does not exist as described — the
module map is descriptive, not an exhaustive path index, and system-map
§1.3/§2 does not map modules to boundaries -->: the honest lookup is —
identify the module your change touches from `scope-and-module-map.md` §2's
descriptions (descriptive, not an exhaustive path index), then
**reverse-read `system-map.md` §3** (which journeys exercise that module) to
get module→journey, then resolve journey→boundary/contract through
`contracts/journey-acceptance.md`'s criteria and alias table. **If that chain
does not resolve your change to a named structure, that unresolved mapping is
itself a corpus gap — open a finding and escalate; never substitute
intuition.** Worked example of the chain <!-- changelog 2026-08-10 (reader
test 35, coding-agent finding 6): every other reader-test-hardened rule got a
worked example; the most-used lookup had none. Corrected same day (final-gate
follow-up 29): the first example misrouted GitHub — which
scope-and-module-map.md calls SUBSTRATE, not a module — through the module
chain and claimed J-04 uniquely, though B-01 spans nine journeys -->, **with
the substrate branch the chain needs — and the branches are ADDITIVE, not
mutually exclusive** <!-- refined same day (final-gate follow-up 30): the
first correction said FS/git/clock/scheduler changes "skip the module step
entirely", but the module map assigns related code to M6/M9/M10 and others —
only ownerless seam code skips it -->: (a) **shared seam/substrate code with
no module owner** (e.g. the GitHub transport itself — scope-map §2 calls
GitHub substrate) resolves **directly to its boundary** (GitHub retry/backoff
→ **B-01**), then read the boundary's own journey list in `boundary-map.md`
(B-01 lists nine) and narrow by your changed call sites and the ticket's
scope — **J-04 applies only when the ticket/path specifically scopes the
delivery loop**, not by default; (b) **module-owned code interacting with that
seam** (the module map assigns clock/FS/process-adjacent code to M6, M9, M10
and others) ALSO follows the module→journey chain (scope-map §2 descriptions →
reverse-read system-map §3 → journey-acceptance.md); and (c) **the affected
set is the UNION of what both branches yield** — run every branch your change
triggers. **If the reverse-read resolves over-broadly** (a busy module appears
in many journeys' Components-crossed cells) <!-- changelog 2026-08-10 (reader
test 38, coding-agent finding 6): the escape hatch covered failure-to-resolve
but not noisy resolution -->: narrow the same way the substrate branch does —
by your changed call sites and the ticket's scope; journeys your change cannot
actually reach drop out. If after narrowing the set is still ambiguous
(you cannot tell which journeys the change reaches), that ambiguity is the
escape hatch's territory: open a finding, never guess a subset. Either way, B-01's retry-budget
clause is the same worked example standing rule 1 uses for layer choice. Then
start from the affected journey's acceptance criteria
(`contracts/journey-acceptance.md`) and the affected boundary's contract
(`contracts/B-*.md`, `contracts/OP-*.md`, canonical `CORMIDIA-C-*` IDs — and note
that resolving by canonical ID matters: `contracts/provider-adapter-core.md`
(`CORMIDIA-C-CORE-001`) sits **outside** the `B-*`/`OP-*` filename shapes, and
B-02/B-03/B-04 reference it and never restate its clauses, so a literal glob
misses the shared provider core <!-- changelog 2026-08-10 (reader test 17,
coding-agent finding 2) -->). Derive the
change's cases with the derivation grammar rows (journey / state machine / invariant /
boundary / contract / interface / LLM site / ops — where "ops" means the §8
operational-obligation matrix, contention/soak/rotation/growth/abuse; it is NOT the
`contracts/OP-*.md` operation contracts, which feed the *contract* row, catalog §5
<!-- changelog 2026-08-10 (reader test 4, coding-agent finding 1): the ops/OP-*
name collision disambiguated at the point of use -->; the rows are the eight §1–§8
matrices of `case-catalog.md`, in that order <!-- changelog 2026-08-10 (reader
test 5, coding-agent finding 4): pointer added at the point of use -->; **the
one lane outside this grammar is L-ACC (§8b): a change touching the
outcome-acceptance lane starts from the rev-2026-08-10 addendum's convention 8
plus `validation-policy.yaml → l_acc_lane` — triggered-only, no per-commit
gate, thresholds owner-ratified — instead of assembling that routing from three
scattered mentions** <!-- changelog 2026-08-10 (reader test 21, coding-agent
finding 3): L-ACC feature routing had no single starting sentence -->), land each
at the cheapest layer that can falsify it (layer definitions:
`validation-policy.yaml` → `layers:` for L1–L5; **L-ACC's lane is the separate
top-level `l_acc_lane:` block**, not nested under `layers:` <!-- changelog
2026-08-10 (reader test 5, coding-agent finding 3): the pointer previously implied
all six layers lived under one key -->), and
update `case-catalog.md` traceability **and regenerate `case-catalog.yaml`** in the
same change (same generator command as the Bug-fixes paragraph below — note
`harness-backlog.md` is always one of its two inputs, even when your change never
touches the backlog <!-- changelog 2026-08-10 (reader test 6, coding-agent
finding 4) -->). A new family in a **triggered lane** (L3/L4/L-ACC) does not owe a
`case-catalog.md` §9.1 ledger bullet at derivation time — §9.1 is a curated
evidence ledger, updated when triggered-lane machinery or evidence actually lands
or fails, **and that update is owed in the SAME change that lands the machinery
or deposits the run's evidence record** (the implementing PR, or the campaign
record's deposit — never a later sweep <!-- changelog 2026-08-10 (reader
test 25, coding-agent finding 3): "updated when it lands" had no concrete
trigger pinned, unlike every other same-change obligation in this file -->),
and §9's closure counts are untouched by §10 rows and by ledger entries
alike. <!-- changelog 2026-08-10 (reader test 7, coding-agent finding 2): the rule
existed only for defect rows; now stated for feature-derived rows too. --> <!-- changelog 2026-08-10 (reader test 2, coding-agent findings 4/5):
layer-definition pointer added; the YAML-regeneration half was previously stated
only for bug fixes and in addendum convention 4 — it applies to every catalog
edit. -->
**Row tagging, with the "layer" collision flagged** <!-- changelog 2026-08-10
(reader test 40, coding-agent finding 1): this sentence previously said "layer
tags come from … system-map §5.2 (T-1…T-12)", colliding with the L1–L5
execution-layer meaning used everywhere else — T-control-points are NOT a
separate field; they ride inside the Risk column's parentheses, e.g.
`E1 (T-10)` -->: the **Layer column is the L1–L5/L-ACC execution layer**
(vocabulary: `validation-policy.yaml → layers:` / `l_acc_lane:`); **Risk tags
come from `risk-allocation.md` (E-1/E-2/E-3/STD/THIN/FLOOR/L4Q —
plus `REG`, reserved for §10.3 defect-register rows and defined in both
risk-allocation.md and the catalog legend <!-- changelog 2026-08-10 (reader
test 20, coding-agent finding 1): REG was on every precedent row agents are told
to imitate, but absent from this vocabulary -->)
and `system-map.md` §5.2 (T-1…T-12 control points — **which appear as
parenthetical annotations INSIDE the Risk column**, e.g. `E1 (T-10)`, never as
a field of their own <!-- changelog 2026-08-10 (reader test 40, coding-agent
finding 1) -->); the THIRD required row
field — **Oracle kind** — has its vocabulary in `case-catalog.md`'s
front-matter "Row/oracle/layer keys" legend: **seven atoms**
(`state`/`evid`/`refusal`/`diff`/`det`/`stat`/`live`) **plus the composition
grammar** — `+` combines atoms, `contract` is the §5 clause-complete macro,
`stat-envelope` the deterministic wrapper around a statistical lane, `mixed`
the CF-OPS-ABUSE placeholder, and parenthetical annotations like
`(non-gating)` qualify an atom <!-- changelog 2026-08-10 (reader test 26,
coding-agent finding 2); corrected same day (final-gate follow-up 18): the
first version claimed a bare seven-value vocabulary while 35 live rows use
compositions and aliases -->** — read those two files before
tagging a new catalog row, **read the affected boundary's failure-mode list in
`boundary-map.md` before deriving any boundary-row case** (the section label
varies by boundary — `Failure modes:`, `Failure modes to script:`, or split
forms like B-15's `Filesystem failure modes:`/`Git failure modes:` and B-27's
`Preflight failure modes:`/`Run/report failure modes:`; grep the boundary's
section for `ailure modes` rather than assuming one canonical heading <!--
changelog 2026-08-10 (reader test 22, coding-agent finding 2) -->)**, **and the
remaining derivation rows have read-first sources too** <!-- changelog
2026-08-10 (reader test 26, coding-agent finding 1): read-first sources were
stated for only boundary and invariant rows; §6/§7/§8 were silent -->:
interface-adapter rows (catalog §6) derive from `system-map.md` §1.4's
adapters-not-behaviors table; LLM-site rows (catalog §7) derive generally from
`llm-eval-plan.md`'s per-site tables (§2) — the golden-case pointer above
covers only the bad-output channel, **and feature-derived S-* quality cases
land as golden-set entries under the SAME emitting-call-site directory rule
the Bug fixes paragraph states** (target directory = the site's scaffold per
llm-eval-plan §1–2/§7) <!-- changelog 2026-08-10 (reader test 33, coding-agent
finding 3): the directory-targeting rule's cross-application to feature-derived
cases had to be inferred -->; ops rows (catalog §8) derive from
`risk-allocation.md` §6 (the §8 rows cite it directly, e.g. CF-OPS-SOAK/ABUSE);
journey, state-machine, and contract rows read their own §-named sources
(`system-map.md` §1.3; for state-machine rows, **the inventory IS
`case-catalog.md` §2's own row keys** — the machines were enumerated at
derivation time and live nowhere else in-corpus, so the pointer is
deliberately self-referential; read each machine's durable-state owner in
`system-map.md` §2.2 before deriving <!-- changelog 2026-08-10 (reader
test 41, coding-agent finding 5): "the state-machine inventory" pointed at no
locatable file/section -->; contract rows read the contract file itself), and read the invariant's
entry in `invariants.md` before deriving any invariant-row case — its ratified
adversarial seeds and falsifying-test shape are the row's starting material**
<!-- changelog 2026-08-10 (reader test 14, coding-agent finding 3): invariants.md
was the one derivation source without its own read-first pointer --> <!-- changelog 2026-08-10
(reader test 2, coding-agent finding 2): was a passive ownership note; the
failure-mode list shapes the case's content, not just its tags -->.

**Bug fixes** deposit their detector (a failing-then-passing test at layer 1 or 2 —
and if an injected-fake L2 rig genuinely cannot reproduce the defect (the rare
real-dependency-only race), that inability is itself finding-worthy: open a
finding, deposit the closest achievable L2 approximation with the gap named in
its spec, and add the real reproduction to the **EXISTING relevant L3 obligation
in `validation-policy.yaml`'s block (as a trigger/case note) — no new family, no
new ticket: the §10.3 row stays the single traceability row, its Layer column
recording the L2 approximation with the L3 pointer noted** <!-- changelog
2026-08-10 (reader test 28, coding-agent finding 5): whether the L3 side
folded into the same row or minted new structure was unstated --> —
**never skip the deposit silently** <!-- changelog 2026-08-10 (reader test 26,
coding-agent finding 4): the obligation was unconditional with no named path
for the residual case the B-01 fake-injection technique cannot reach -->) in
the same change, **and record the defect's traceability row in `case-catalog.md`
§10.3 — the defect register, not the §10.1/§10.2 ratified-revision tables —
regenerating `case-catalog.yaml` (command: `awk -f
validation-design/case-catalog-generator.awk validation-design/case-catalog.md
validation-design/harness-backlog.md` — the YAML's header states the regeneration
obligation; the exact command lives here and in the Adoption notes below
<!-- changelog 2026-08-10 (reader test 7, coding-agent finding 4): citation made
accurate — the header does not itself spell the command -->) in that same
change** <!-- changelog 2026-08-10 (reader test 3, coding-agent findings 2/3):
subsection made exact; regeneration mechanism stated at the obligation, not only
in the adoption notes --> — a defect whose cases
would need a new journey, boundary, invariant, **or LLM call site** <!--
changelog 2026-08-10 (reader test 27, coding-agent finding 2): this list
silently dropped "LLM call site" relative to the structural-additions trigger
list it imports; the omission was unintentional — the lists are one rule -->
is structural and re-enters
`harness-revision` instead of being force-fit into a row — and the **same
skill-unavailable rule as the structural-additions section applies on this path
too: stop and escalate to the human, never improvise the structural change
mid-fix** <!-- changelog 2026-08-10 (reader test 18, coding-agent finding 2):
the fallback was stated only in the structural-additions section; a mid-fix
agent had to infer it applied here -->. **May the CODE fix land before the
revision resolves?** <!-- changelog 2026-08-10 (reader test 28, coding-agent
finding 1 [blocking]): the unconditional deposit rule and the structural
re-entry rule were never reconciled for this exact scenario --> The mid-change
disposition's split rule applies here explicitly: the code fix may land first
**only if it stands alone without encoding the missing structure**, and its
detector deposit — being structure-dependent — is **parked in the change
description as pending-the-revision, citing the revision entry**; that parked
deposit is the one sanctioned exception to "never skip the deposit silently"
besides the L2-irreproducible race. A fix whose code itself encodes the new
structural truth cannot land before the revision at all. Worked example of the
fork <!-- changelog 2026-08-10 (reader test 39, coding-agent finding 5): every
other hardened rule got a worked example; the trickiest bug-fix judgment call
had none -->: a fix that corrects a provider-timeout calculation AND renames
before the 2026-08-12 ruling, renaming the emitted terminal status
`timed_out`→`interrupted` split exactly here —
the timeout-calculation part stands alone under existing structure (land it,
deposit its detector), while the rename encoded one side of F-PT-017's then-
contested enum (it could not land until the owner ratified it; HB-P6 later landed
that exact vocabulary and detector on 2026-08-12).
**A defect inside a `BLOCKED:<finding>`/PARKED area** <!-- changelog 2026-08-10
(reader test 29, coding-agent finding 7): the mandatory-deposit and
do-not-implement-blocked-items rules were never reconciled for their
intersection -->: if the defect lies in territory whose cases are
finding-parked, the fix and its detector may cover **only the un-contested
deterministic part** and must not encode either side of the parked question;
if the defect IS the contested behavior, do not fix it at machine speed — the
observation is **ratification evidence**: record it on the finding (the
pre-ratification F-PT-006 preserve-evidence pattern) and escalate. The deposit obligation
applies to what you may lawfully fix; it never licenses resolving a parked
question. <!-- changelog 2026-08-10
(Phase 8 reader test, coding-agent finding 2): the catalog-row half of the
obligation was stated only in case-catalog.md §10; now stated here and in the
policy's case_sourcing block too. -->
**Tagging a §10.3 row is simpler than tagging a feature row** <!-- changelog
2026-08-10 (reader test 20, coding-agent finding 2): the tag-sourcing and
read-first rules were stated only under "Feature changes"; the bug-fix
inheritance had to be inferred -->: Risk is always `REG`, Layer is where the
detector lands (L1/L2 per the deposit obligation), and the feature-path
read-first obligations (boundary failure-mode list, invariant seeds) apply only
insofar as the fix touches those rows — a §10.3 deposit inherits its context
from the defect, not from a fresh derivation.
**Write-back obligation for the read-first sources** <!-- changelog 2026-08-10
(reader test 21, coding-agent finding 1): the deposit obligation covered only
the catalog surfaces; nothing said whether boundary-map.md/invariants.md may be
left silently stale when a defect teaches a new failure mode -->: when a §10.3
deposit — or a deterministic defect surfaced by an L3/L4 run — reveals a
failure mode absent from the affected boundary's `Failure modes:` list, or an
adversarial shape absent from the invariant's `Adversarial seeds`, the **same
change appends it to that artifact** with a dated changelog comment. This is
additive enrichment of ratified text with observed reality — tighten-only, NOT
a structural event and NOT a finding. If instead the observation *contradicts*
the recorded text or shape, that is the clause-vs-shape routing above, not an
append. Leaving the read-first source silently out of date is a corpus bug;
these two files have no generator, so the append IS the regeneration
discipline.
**Ticket citation for an unplanned fix** <!-- changelog 2026-08-10 (reader
test 15, coding-agent finding 1): traceability convention 2 requires spec headers
to cite an owning HB ticket, which an unplanned fix lacks by construction -->:
the fix's spec cites its new `CF-REG-<issue>` family and **HB-139** — the
standing regression-deposit record ticket — as its owner, and the same change
appends the family to HB-139's list in `harness-backlog.md` (regenerating
`case-catalog.yaml`, which recomputes HB-139's families). No fresh ticket is
minted for an already-landed fix; that is the HB-137…139 retrospective-record
pattern.
**Minting a NEW `HB-…` ticket** (owed when traceability convention 3 leaves a
non-pruned, non-blocked family without a citing spec — e.g. a feature change
deriving a family it will not implement in the same change) <!-- changelog
2026-08-10 (reader test 15, coding-agent finding 2): the F-PT minting procedure
existed; the HB one did not -->: take the next unused sequential id — scan
`harness-backlog.md` and `case-catalog.yaml`'s tickets list, never trust memory;
place the ticket in the backlog section matching its provenance (an existing
revision section if it fits, else a new dated section — never inside a LANDED
wave's history); give it the standard Acceptance/Defends/Layer/Executor fields;
regenerate `case-catalog.yaml` and the owner-backlog companion in the same
change. **The ordinary same-PR feature case — the third ticket-acquisition
path, previously unstated** <!-- changelog 2026-08-10 (reader test 34,
coding-agent findings 1/2): the two stated procedures covered only
not-implemented-in-this-change families (mint) and unplanned bug fixes
(HB-139); the common case — a feature deriving AND implementing a new family
in one PR — had no stated procedure, and convention 3's "owns ≥1 citing spec"
wording could be misread as an alternative to convention 2's header
citation -->: **every citing/implementing SPEC needs an owning-ticket header
citation, no exceptions — while a PENDING family (no spec yet, by design)
instead requires its non-LANDED owning ticket to exist and declare it** <!--
corrected 2026-08-10 (final-gate follow-up 28): "every new family needs a
header citation" was literally unsatisfiable for pending families, which have
no spec/header until implemented -->. For a family derived and implemented in
the same PR, **mint the
HB ticket in that same PR** (same next-id scan procedure), cite it in the spec
header, and let its status reflect reality on merge; convention 3's
"owns ≥1 citing spec" describes what the trace CLI verifies, never a
substitute for the citation. **Sequencing default:** derivation-first is fine —
an HB ticket need not pre-exist derivation; convention 6's
ticket-→-enumeration workflow applies when a ticket already exists (backlog
work), while fresh feature work mints its ticket in-change. Related pointers
<!-- changelog 2026-08-10 (reader test 34, coding-agent finding 3) -->:
"pruned" is the `PRUNE-*` vocabulary defined in `case-catalog.md`'s front
matter; a "wave" is a `harness-backlog.md` section-heading token (the
generator derives ticket wave from the section a ticket sits in). And a wholly
new **module** is not a fifth trigger <!-- changelog 2026-08-10 (reader
test 34, coding-agent finding 4) -->: it is the SHAPE sense of the existing
structural triggers (a new state owner/failure domain); the
unresolved-mapping escape hatch is for when you cannot tell — if the answer
turns out to be "genuinely new structure," the two mechanisms converge on the
same structural path. Scope note <!-- changelog 2026-08-10 (final-gate follow-up 2): the
canonical-source sentence sat after the two new procedures and could be read as
claiming the policy contains them; it does not --> — the **detector/catalog-row
deposit obligation above** has its single source of truth at
`validation-policy.yaml` → `case_sourcing:` (this section and
`harness-backlog.md` merely reference it); the **HB-139 citation rule and the
HB-id minting procedure are canonical only HERE**, in this routing doc — other
artifacts (the ratification package's disposition records, the state file's
summaries) may record or summarize them, and this routing document wins on
disagreement <!-- changelog 2026-08-10 (final-gate follow-up 3): "appear in no
other artifact" was literally false against the §12.8n record; restated as a
canonical-vs-mirror rule -->. Bad LLM outputs observed in production become golden cases —
**target directory = the emitting call site's scaffold** per `llm-eval-plan.md` §1–2
(directory enumeration and authoring priority: its §7 "Golden-set scaffolds"
<!-- changelog 2026-08-10 (reader test 15, coding-agent finding 3) -->)
and the per-directory READMEs under `golden-sets/` (e.g. Reviewer → `reviewer/`).
A golden-case deposit needs **no new `case-catalog.md` row**: catalog traceability
is at family granularity and the per-site quality families (CF-S*-qual) in
**`case-catalog.md` §7 — the LLM call-site matrix, a DIFFERENT §7 from
`llm-eval-plan.md` §7 "Golden-set scaffolds" cited above** <!-- changelog
2026-08-10 (reader test 25, coding-agent finding 1): two files' §7s collided
in one paragraph with no flag, unlike the ops/OP-* collision which is
disambiguated at its point of use --> — already
exist — adding a case grows the set, not the matrix. Only a bad output that exposes
a NEW call site or a deterministic envelope defect touches the catalog — **and
these two branches have DIFFERENT autonomy**: the envelope defect is the
autonomous path (a §10.3 detector row in the same change), but a genuinely NEW
call site is a **structural change** — it mints a new S-id, so it routes
through `harness-revision` (or stop-and-escalate if that skill is unavailable)
exactly per the structural-additions section, and the catalog-§7 family change
lands as part of THAT revision, never as an in-change edit — and when the
revision mints the new S-id, the same never-trust-memory discipline as its HB/CF
siblings applies: **scan for the next unused id first**
(`grep -oE 'S-[0-9]+' llm-eval-plan.md | sort -u` <!-- pattern corrected
2026-08-10 (final-gate follow-up 32): `[0-9]*` matched zero digits and emitted
a spurious bare `S-` --> plus the catalog §7 rows and
`golden-sets/` directory names) <!-- changelog 2026-08-10 (reader test 37,
coding-agent finding 3): S-id minting was stated only as an outcome, with no
scan-first instruction like its two sibling id spaces --> <!-- changelog
2026-08-10 (reader test 27, coding-agent finding 1 [blocking]): this sentence
previously read as if both branches were autonomous, contradicting the
structural-additions rule that a new LLM call site re-enters harness-revision;
the structural rule wins -->. <!-- changelog 2026-08-10
(reader test 3, coding-agent finding 4): the golden-case channel's catalog
obligation was ambiguous relative to the bug-fix channel's; now explicit. -->

**Deterministic defects found by live (L3) or eval (L4) runs** also deposit L1/L2
detectors in the same change — a green live run proves that run, nothing more.

**Quality thresholds:** every number marked PROPOSED or owned by an open finding
(F-PT-009/010/011) is a budgeting hypothesis — **the numbers themselves live in
`validation-policy.yaml → proposed_register` (canonical) and are restated in
`llm-eval-plan.md` §8, governed by its §9 decision-status rule** <!-- changelog
2026-08-10 (reader test 30, coding-agent finding 3): the one cross-reference in
this file without a named target at the point of use -->. Threshold-dependent verdicts are
`inconclusive` until the finding ratifies — never report them as pass/fail, never as
release evidence.

**Spend:** live campaigns obey `validation-policy.yaml` spend bounds (≤2 turns/$5
pre-merge changed-adapter; ≤24 turns/$100 release — amended at ratification
2026-07-31; retries/repeat turns must not abort a campaign, and the ceiling is a hard
bound raisable only by a human policy edit). Ceiling exhaustion ⇒
completeness=incomplete, never green. Never forge human approval decisions; unattended
runs use only the ratified sandbox test-mode profile.

**Blocked work — this list is NOT exhaustive** <!-- changelog 2026-08-10 (reader
test 14, coding-agent finding 1): the paragraph previously read as the complete
blocked set -->: B-17's live cell is the oldest example; finding-parked work is
currently HB-P7; HB-P3/P5/P6 landed after the attributable 2026-08-12 owner rulings.
Blocked/parked work also includes HB-073 (hash-bound gate refuses until HB-072's human-authored threat model
exists), HB-055, and every F-PT-011-gated quality verdict. **Before picking up any
ticket, scan the WHOLE of `harness-backlog.md` for `BLOCKED`/`PARKED`/`Gate:`
markers and `case-catalog.md` for `BLOCKED:<finding>` cells** — no single section
is the complete set: the backlog's "Parked" section is complete only for the
**finding-parked P-tickets** (currently HB-P7; HB-P3/P5/P6 landed after the
attributable 2026-08-12 owner rulings), while other blocked items (HB-055,
HB-073) live inside their own wave sections, and the catalog's §9 blocked-cell
roll-up covers cells, not tickets. The scan is the guarantee; no list here is.
Mechanize it rather than reading the whole file <!-- changelog 2026-08-10
(reader test 18, coding-agent finding 6): the scan was manual with no pattern
named, in a corpus that documents a past failure of exactly this kind -->:
`grep -niE 'blocked|parked|gate:' harness-backlog.md` <!-- changelog 2026-08-10
(final-gate follow-up 8): the first version was case-sensitive and missed 29
lowercase blocked/parked lines, including the live #339 real-repo restriction —
case-insensitive is mandatory; the read-each-hit caveat absorbs the extra
historical matches --> and
`grep -n 'BLOCKED:' case-catalog.md` (the second catches both
`BLOCKED:F-PT-nnn` and non-finding tokens like `BLOCKED:B-17-L3`; catalog block
tokens are uppercase by grammar) from
`validation-design/`
surface every marker; read each hit's surrounding lines before treating a
ticket as pickable (the grep finds the markers — judging whether one blocks
YOUR ticket is still a read).
<!-- changelog 2026-08-10 (gate follow-up to reader test 14, coding-agent
finding 1): the first fix declared the list non-exhaustive but then called the
Parked section "complete" — itself wrong for HB-055/HB-073; completeness is now
scoped to the P-ticket category only. -->
Do not implement blocked items, and do not
encode any finding's "expected" behavior as truth before a human ratifies it.
(HB-P1/HB-P2/HB-P4 were unparked at ratification 2026-07-31 — their findings are
resolved and their contracts ratified.)

**Opening a new finding.** If your change surfaces a fresh product-truth or
architecture ambiguity — "the docs don't say," **or the ratified text says
something observed reality contradicts** (the dominant precedent: F-PT-012, -013,
-015, -016, -017 are all ratified-contract-vs-code conflicts; the contract is
never silently rewritten from implementation behavior, and the code is never
silently "fixed" to a contested clause) <!-- changelog 2026-08-10 (reader test 12,
coding-agent finding 1): the gloss literally covered only "docs are silent", not
the more common "docs are contradicted" shape -->: (1) add it to
`validation-policy.yaml` → `open_findings:` with the next `F-PT-nnn` id — **found
by scanning the registry (`grep -o 'id: F-PT-[0-9]*' validation-policy.yaml |
sort -u | tail -1`), never from memory, and a historically REFUSED use of an id
does not reserve the number** (F-PT-033's precedent: refused for one subject
2026-08-10, correctly minted for another the same day) <!-- changelog 2026-08-10
(reader test 25, coding-agent finding 2): the HB-minting procedure had the
scan-don't-trust-memory rule; its finding-minting sibling didn't --> — a one-line
subject, and status `open` — **the policy list is the single source of truth**;
**minting a NEW `CF-*` family id** (the third id space; its procedure was
implicit while its siblings' were spelled out <!-- changelog 2026-08-10 (reader
test 29, coding-agent finding 4) -->): CF ids are **semantically derived, never
sequential** — `CF-<source-row-key>-<discriminator>` where the source key is
the owning matrix row's key (journey `J04`, boundary `B01`, invariant, site
`S2`, ops, interface, or `REG-<issue>` for §10.3 deposits; observe the
precedent forms `CF-J04-S`, `CF-B01-L3`, `CF-S2-traj`, `CF-OPS-SOAK`,
`CF-IF-CLI`, `CF-REG-291`); before minting, **scan both catalog surfaces for
the proposed id** (`grep -n '<proposed-id>' case-catalog.md case-catalog.yaml`)
— a hit means collision or an existing family to extend instead; retired
families keep their ids forever, so never reuse one;
(2) mirror the one-liner into `harness-design-state.md`'s findings section; (3) park
any dependent cases as `BLOCKED:<finding>` in `case-catalog.md`; (4) never encode
your guess as behavior. A new finding is a question for the human, not a decision.

**Structural additions are not autonomous.** A change that needs a **new** journey,
boundary, or invariant — or a **new LLM call site** (the S-1…S-11 inventory in
`llm-eval-plan.md` §1 is registered structure; a new site mints a new S-id and owes
its golden-set scaffold per §1–2, same as the bug-fix channel's golden-case rule
<!-- changelog 2026-08-10 (reader test 8, coding-agent finding 3) -->) — not just
new cases against existing ones — is a structural
change to the design, exactly like a structural *mismatch* (the boundary map,
`system-map.md` §5.2's control points, or `risk-allocation.md`'s tiers contradict
the architecture; a lane mis-placed; invariants that no longer describe the system
<!-- changelog 2026-08-10 (reader test 8, coding-agent finding 4): the mismatch
trigger names all three structural artifacts, not only the boundary map -->).
Routing rule for **contract** contradictions specifically <!-- changelog
2026-08-10 (reader test 12, coding-agent finding 1) -->: a contradiction confined
to a single contract *clause* opens a finding and parks that clause's cases
`BLOCKED:<finding>` (the F-PT-017 pattern); one that invalidates the boundary's
*shape* — its ownership, failure domain, or existence — is a structural mismatch
and re-enters `harness-revision`. **The same split applies to invariants** <!--
changelog 2026-08-10 (reader test 19, coding-agent finding 1): the
clause-vs-shape rule was stated only for contracts/boundaries; the invariant
analogy had to be inferred -->: a conflict confined to a single invariant
*clause* (its text vs observed enforcement reality) is an ordinary finding — the
in-corpus precedent is **F-PT-014**, INV-003's never-scopeable clause with no
gate-rule mapping, opened as a finding rather than a redesign; an invariant that
no longer describes the *system* (its subject vanished, its ownership moved) is
the structural case from the trigger list above. **Worked precedent for the
SHAPE branch** <!-- changelog 2026-08-10 (reader test 32, coding-agent
finding 3): the clause branch had precedents (F-PT-017/014) but the branch that
forces a full revision had none -->: the 2026-08-07 jobs addition — a new
state owner and failure domain (M18, B-30, J-22/J-23) — correctly re-entered
`harness-revision` as a recorded revision rather than being force-fit as new
clauses on existing boundaries; when your contradiction is about WHO owns state
or WHERE a failure domain lies (not what a clause says), that is the shape you
are looking at.
Both require re-entering the `validation-harness-design` skill in `harness-revision`
mode with the existing artifacts as baseline. **What that mode produces (so this
trail does not go cold at the directory edge)** <!-- changelog 2026-08-10 (reader
test 28, coding-agent finding 2 [blocking]): the skill is external by design,
but the corpus never said what the mode outputs or how to test availability -->:
a harness-revision is a diff-scoped re-derivation that emits **surgical updates
to the named structural artifacts** (system-map/boundary-map/invariants →
case-catalog + regenerated YAML → backlog tickets → a ratification-package
section recording seat decisions and open findings), with inline changelogs and
reader/stakeholder gates — the recorded 2026-08-01/03/07/08/10 revisions in
`harness-design-state.md` are the worked precedents of exactly this shape.
**Availability test:** it is an invocable skill in your agent environment; if
you cannot invoke it by the name **`validation-harness-design`** <!-- referent
made explicit 2026-08-10 (reader test 36, coding-agent finding 4) -->, it is
unavailable — stop and escalate, never
approximate the revision by hand. **Escalation mechanics** <!-- changelog
2026-08-10 (reader test 29, coding-agent finding 5): "stop and escalate" named
no channel, unlike the exact commands given elsewhere -->: this is a
solo-operator install (system-map §0), so escalate = **halt the structural
work, record the blocker in the change description (PR body / commit message)
and — if it is product-truth-shaped — in a new or existing `F-PT` finding**;
there is no other person or channel to find, and the human reads exactly those
two surfaces.
**Mid-change disposition when you discover a structural mismatch** <!-- changelog
2026-08-10 (reader test 8, coding-agent finding 2): the route existed; the
what-about-my-branch answer did not -->: never merge code or tests that encode
either side of the contradiction. Split the change — parts that stand alone under
the *existing* ratified structure may land normally; **structure-dependent cases
and specs are parked in the change description as pending-the-revision**
(mirroring the `BLOCKED:<finding>` discipline), and the branch holding them
waits for the revision's outcome rather than guessing it <!-- changelog
2026-08-10 (final-gate follow-up 25): the round-31 definitional insertions had
displaced "as pending-the-revision" to after the combined-PR rule, making it
read as though both procedures were parked; reattached to its object -->.
Definitions used above: the change description is **the PR body, or the commit
message for direct commits** <!-- changelog 2026-08-10 (reader test 28,
coding-agent finding 6): the term was used throughout but never defined -->,
and "the same change" means the same unit — **one PR (all its commits
together), or the one commit in a direct-commit workflow** <!-- changelog
2026-08-10 (reader test 31, coding-agent finding 4) -->. Separately, the
general rule for mixed work: a PR that is BOTH a bug fix and a feature addition
runs BOTH procedures — a §10.3 row for the defect and §§1–8 rows for the
feature; the two paths are per-work-item, not mutually exclusive per-change
<!-- changelog 2026-08-10 (reader test 31, coding-agent finding 5) -->. **If that skill is not available in
your environment, stop and escalate to the human — do not improvise a redesign or
pile cases onto a wrong shape.** Case-level additions against existing structure are
the only autonomous path.

**Standing rules digest** (self-contained for the method rules themselves — you
never need the design skill's text to follow them; borderline LAYER calls still
consult `case-catalog.md`'s precedent rows, an in-corpus pointer, not skill
text <!-- framing scoped 2026-08-10 (reader test 36, coding-agent finding 5):
"self-contained" overclaimed — rule 1's borderline path needs the catalog -->). Three embedded rules from
the prose above, re-stated as actual bullets because they were easy to
skim past mid-sentence <!-- changelog 2026-08-10 (reader test 32, coding-agent
finding 1); the full clauses above stay canonical — this digest mirrors.
Corrected same day (final-gate follow-up 26): the first version was one
semicolon paragraph claiming to be bullets, omitted the parked-area split, and
folded grammar closure into a clause -->:

- **`REG` is reserved for §10.3 rows only** — never valid on a §§1–8 matrix
  row, and tier tags never valid on §10.3 rows.
- **The deposit obligation has exactly TWO exceptions**: the L2-irreproducible
  race (→ finding + closest L2 approximation + note on the existing L3
  obligation) and the structure-parked defect (→ detector parked in the change
  description pending-the-revision).
- **A defect in `BLOCKED:<finding>`/PARKED territory splits**: the un-contested
  deterministic part may be fixed and detected; the contested behavior is never
  fixed at machine speed — it becomes ratification evidence on the finding and
  escalates.

Separately: **the eight-row derivation grammar is closed** — a risk class that
maps to none of the eight rows is by definition a new derivation dimension,
i.e. a structural mismatch that re-enters `harness-revision` <!-- changelog
2026-08-10 (reader test 32, coding-agent finding 6): the grammar's own closure
was never stated -->. Jump targets for
the two unanchored decision points <!-- changelog 2026-08-10 (reader test 32,
coding-agent finding 2) -->: `grep -n 'May the CODE fix land' agents-md-contribution.md`
(land-before-revision rule) and `grep -n 'Routing rule for' agents-md-contribution.md`
(clause-vs-shape split); further anchors <!-- changelog 2026-08-10 (reader
test 34, coding-agent finding 5) -->:
`grep -niE '^\*\*minting a NEW.*(HB|CF)' agents-md-contribution.md` (reaches
BOTH minting procedures — the CF heading is lowercase, so the earlier
case-sensitive pattern hit only HB <!-- corrected 2026-08-10, final-gate
follow-up 28 -->; the same-PR feature rule sits beside the HB one), `grep -n 'Write-back obligation'
agents-md-contribution.md` (boundary-map/invariants enrichment), and
`grep -n 'SAME change that lands' agents-md-contribution.md` (§9.1 ledger
timing); `grep -n 'Feature changes' agents-md-contribution.md` (the
derivation-grammar entry point itself <!-- changelog 2026-08-10 (reader
test 35, coding-agent finding 8) -->); and two sub-obligation anchors <!--
changelog 2026-08-10 (reader test 36, coding-agent finding 3) -->:
`grep -n 'Ticket citation for an unplanned fix' agents-md-contribution.md`,
`grep -n 'Tagging a §10.3 row' agents-md-contribution.md`, and
`grep -n 'Escalation mechanics' agents-md-contribution.md` <!-- changelog
2026-08-10 (reader test 42, coding-agent finding 5): the skill-unavailable
escalation paragraph had no anchor -->. **A change that derives NO cases and
touches NO structural artifact — a pure refactor, tooling/CI change, or
dependency bump — owes nothing under this section** <!-- changelog 2026-08-10
(reader test 42, coding-agent finding 6): the no-op case was correct only by
omission -->: confirm by checking that no derivation-grammar trigger applies
(no new or changed behavior at any of the eight rows, no boundary/invariant
text touched); that confirmation is the whole obligation. **Working-directory convention for
every self-referential grep in this file** <!-- changelog 2026-08-10 (reader
test 35, coding-agent finding 7): some commands stated a directory, others
didn't — from repo root the bare filename fails -->: they assume your CWD is
`validation-design/`; from the repo root, prefix the path
(`validation-design/agents-md-contribution.md`). The backlog/catalog scans
that explicitly say "from `validation-design/`" already state this.

1. *Cheapest falsifying layer:* before placing a check at an expensive layer, ask
   whether a cheaper one could falsify it. Hermetic composition (L2) is where most
   risk dies; live runs are for seams no honest fake can prove. Worked example
   <!-- changelog 2026-08-10 (reader test 4, coding-agent finding 3) -->: the B-01
   retry-budget claim (3 attempts, jittered backoff) is fully falsifiable against
   the scripted GitHub double with an injected clock — L2, every commit; only what
   the double cannot honestly prove (the real auth handshake, real merge
   semantics) earns the spend-bounded L3 smoke. Borderline calls: imitate the
   layer-choice reasoning in `case-catalog.md`'s precedent rows — §10.3 is headed
   "Defect register," but using its rows as layer-placement precedent for feature
   cases is intended (they carry the densest worked layer/oracle reasoning in the
   corpus); the §§1–8 matrix rows serve the same way <!-- changelog 2026-08-10
   (reader test 6, coding-agent finding 3): the pointer's double duty made
   explicit -->. Remember the two bounds on a
   wrong call — every family needs its negative control, and no green by absence.
2. *Guardrails enforce; evals measure:* anything a model or vendor could violate at
   runtime is enforced in code, fail-closed, and you test the guardrail. An eval is
   never enforcement.
3. *Golden sets before tuning:* eval cases are committed before prompts are tuned,
   or the grader is tuned to itself.
4. *Negative controls:* every new detector family lands red-then-green against a
   seeded violation. A detector that has never fired is an assumption.
5. *The harness is itself tested:* fixtures have self-tests; sweeps fail on empty
   walks; the policy loader and CI lane are pinned by tests.
6. *Evidence is not a regression suite:* L3/L4 findings deposit L1/L2 detectors.
7. *No green by absence:* missing, skipped, or ceiling-stopped work reports
   incomplete/inconclusive — never pass.

**Never read, cite, run, or take design cues from `archive-do-not-read/**`**
(path note <!-- changelog 2026-08-10 (reader test 23, coding-agent finding 1):
this path comes from the policy's `protected_paths:` key, not `artifacts:`, so
the `./`-prefix resolution rule above does not determine its location -->: it
resolves from the **repo root**; either way the instruction is don't-touch, so
resolution never changes the obligation).

---

## Proposed 2026-08-03 routing addendum — design accepted; exact edit approval pending

The text below is the proposed standing-rule addition for the
roadmap/validation/delivery/batching harness revision. The design was accepted on
2026-08-03, but the owner's acceptance expressly retained separate approval for
protocol-surface changes. It is **not yet part of the ratified verbatim section above**
and must not be represented as landed policy until its exact diff is approved.

> **Roadmap, validation and execution-batch changes** start at J-03/J-20,
> C-OP-PLAN/C-OP-VALIDATION/C-OP-BATCH, B-20/B-21/B-22 and INV-016. Code work is
> always RoadmapPlan-accounted and delivered as one independently reviewed PR per
> delivery unit, even when complete structured input makes the roadmap or
> EpisodePlanner provider turn unnecessary. Complete non-code operational work may
> omit RoadmapPlan only through the direct `ExecutionUnit` contract; it still requires
> EpisodeIntent/EpisodePlan, validation/evidence policy, and separately exact approval
> plus acknowledgement for every external payload/effect.
>
> Labels and trailers—including `op:ready`, `op:tier-*` and any
> `planning:preplanned` projection—are discoverability/state projections, never plan,
> validation, routing or effect authority. Their referenced persisted artifact and hash
> must validate independently. Batch admission is deterministic and token-free;
> EpisodePlans are created lazily per admitted unit. Affinity/cache/session reuse may
> reorder compatible same-app units, but never changes membership, priority, routing,
> validation, one-PR atomicity, per-unit budget/evidence, effect grants, or Builder/
> Reviewer independence. Cache benefit is reported only from adapter evidence and has
> no correctness effect.
>
> Changes needing a new journey, boundary, invariant, or LLM call site — the
> exhaustive structural trigger list, one rule with the structural-additions
> section above <!-- changelog 2026-08-10 (final-gate follow-up 19): this
> 2026-08-03 addendum sentence was the third mirror of the trigger list and
> still omitted "LLM call site" after the round-27 unification --> — re-enter
> `validation-harness-design` in `harness-revision` mode. Changes to TASTE.md,
> roles.yaml, pipelines.yaml, prompts/** or PURPOSE.md remain proposal-only until a
> human explicitly ratifies the exact diff. **The MECHANIC when an ordinary
> ticket needs such an edit** <!-- changelog 2026-08-10 (reader test 42,
> coding-agent finding 1): the obligation was stated but the procedure was not,
> unlike every other decision point in this file -->: mirror the mid-change
> disposition — **draft the exact protocol-surface diff and park it in the
> change description as proposal-pending-ratification (never merge it); land
> the parts of the ticket that stand alone without it; escalate through the
> same solo-operator channel** (change description + F-PT finding if
> product-truth-shaped); the ratified diff lands in its own change once the
> human ratifies it verbatim.

---

## Proposed 2026-08-07 routing addendum — outcome acceptance (L-ACC) + jobs

AGENTS.md is a human-ratified surface, so this is a **proposal with rationale**, not a
landed edit. It is deliberately short: the ratified section above already carries the
standing rules, and this only routes an agent to the two things that are new.

> **Jobs (M18).** Work on `src/jobs/` or the `cormidia-job` binary starts at J-22/J-23,
> `CORMIDIA-C-B30-001…003` and `CORMIDIA-C-OPJOB-001`. `docs/jobs/design.md` §3 is the
> non-inherited-guarantee list and is never softened: a job has no reviewer, no typed
> verdicts, no ticket machine and no GitHub. "Completed" for a job step means the
> provider returned **and** every declared output check passed; a step with no declared
> outputs is `completed (unverified)`, never bare `completed`. The journal is the sole
> completion authority — never infer completion from an output file's presence. A config
> that changed under a live journal refuses; it never resumes. INV-016 is
> **delivery-scoped** and does not reach a job step (F-PT-031); that is the invariant's
> domain being written down, not an exemption, and it is not a licence to skip the
> declared checks.
>
> **The outcome-acceptance lane (L-ACC).** It is **built and has run once**: HB-120…132
> implemented the guardrails, runner and execution layer, and run 1 reached a terminal
> stop at the unchanged rubric §6 plan gate on 2026-08-08 with an entirely
> ungraded/inconclusive distribution (`acceptance/run-1-result.md`). Do not cite it as
> a gate or as release evidence — F-PT-029 (resolved 2026-08-07) keeps it permanently
> outside RQ-1 — and never start a new campaign without an exact per-campaign human
> authorization; F-PT-030 (resolved 2026-08-07) permits unattended plan-gate
> resolution only through a config's declared `plan_gate` policy under the unchanged
> criteria, and an undeclared policy refuses.
> <!-- changelog 2026-08-10 (consistency sweep): was "designed and not built: no
> runner, no campaign, no evidence … do not start HB-130 — parked behind … F-PT-029
> and F-PT-030" — stale on all three counts; the landed AGENTS.md was already ahead of
> this contribution doc. -->
> `acceptance/rubric.md` is human-ratified and **tighten-only**: you may narrow an axis or
> a rule, never loosen one, and **you may not introduce a threshold anywhere** — every
> threshold stays unratified until a campaign produces a **graded** distribution the
> owner can ratify against. (Run 1 terminated at the plan gate entirely ungraded, so
> that condition remains unmet: the trigger is the first graded run, not "run 1" by
> number. <!-- changelog 2026-08-10 (reader test 9, coding-agent finding 3): the
> original wording predated run 1 and became ambiguous once run 1 ended
> ungraded. -->) If a change
> seems to require loosening the rubric, stop and escalate rather than editing it.
>
> Two rules carry the whole lane and are easy to get wrong. **All campaign work runs
> through the PACKAGED `cormidia` and `cormidia-job` binaries** (`pnpm install:packaged
> --replace-source-links`; assert its exit status, never reimplement its checks) — a
> `link:local` binary is source-backed and measures the working tree, not the product.
> **And the supervisor never does the work**: an agent that runs `git`/`gh` itself, edits
> a scenario repo, or calls a provider SDK is simulating the org, and every score then
> measures the supervisor. Both are `CORMIDIA-INV-ACC-7a/7b`.
>
> Campaign invariants live in their own fenced registry (`CORMIDIA-INV-ACC-*`,
> `validation-policy.yaml` → `campaign_invariants`). They constrain the harness, never
> the product — never cite one as a product promise. All eight are mechanical guardrails
> at L1/L2 with negative controls; only the rubric's scored axes are lane work.
> `ungraded` is policy, not runner discretion (`verdict_semantics.axis_score`): it is
> never coerced to `0` and never enters an aggregate as a number.

**Rationale for landing it.** Without this addendum a coding agent reaching `src/jobs/`
has no route to B-30, and an agent reading `acceptance/` could reasonably conclude the
lane exists. Both are exactly the failure the routing deliverable exists to prevent.

---

## Proposed rev-2026-08-10 addendum — traceability conventions and machine catalog

AGENTS.md is a human-ratified surface, so this is a **proposal with rationale**.
**Provenance of this addendum** <!-- changelog 2026-08-10 (reader test 6,
coding-agent finding 1): the earlier addenda link their ratification records; this
one didn't -->: it comes from the rev-2026-08-10 harness revision, whose
product-owner seat was an **AI stakeholder agent** — its record is
`ratification-package.md` §12, which is DRAFT pending real-human ratification.
The "must land unedited" constraint below binds the block's *wording* if adopted;
whether to adopt it at all is the human's call, like every §12 item. Two
things are new: `case-catalog.yaml` (the machine-readable companion the
`validation-trace` CLI consumes) and the normative conventions below, which the
product repo's CI will enforce via that CLI. The block is included verbatim as
required and must land unedited.

**Traceability conventions** (normative — the `validation-trace` CLI enforces their mechanical closure subset in CI):

1. **Test directories are named by case-family ID.** Specs for `CF-INV-001` live under a directory whose name contains `cf-inv-001` (case-insensitive); likewise for every other family. Helpers and fixtures that are not family-scoped may sit beside them.
2. **Spec file headers cite the family and the owning backlog ticket.** The first comment block of every `*.test.*` / `*.spec.*` file names the `CF-…` family it exercises and the `HB-…` ticket that owns it (plus the contract/invariant section it binds to). A citation the catalog does not know is an orphan — the trace CLI turns red.
3. **Every implementable family owns ≥1 citing spec, or is declared pending with its wave.** Non-pruned, non-blocked families without a citing spec must appear on a backlog ticket whose status is not LANDED. A LANDED ticket whose families lack specs is a status-honesty failure.
4. **Traceability updates in the same change as the tests.** Adding, moving, or deleting a citing spec updates `case-catalog.yaml` (and the markdown catalog it must agree with) and the backlog's status annotations in the same change — never a follow-up.
5. **The machine-readable catalog is authoritative for tools.** `case-catalog.yaml` is the companion of `case-catalog.md`; disagreement between them is a corpus bug. The markdown catalog remains the human artifact.
6. **Implement tickets via the `implement-harness-ticket` skill.** That skill is the standard path from an HB ticket to landed specs: ticket → family → ratified enumeration → red-then-green tests, with the conventions above so `validation-trace` stays green. Do not invent a parallel workflow.
7. **Regenerate `owner-backlog.md` when the backlog changes.** The companion is non-normative and living; a backlog edit that leaves the companion's ticket-ID set stale is a corpus bug.
8. **Resolve outcome-acceptance families from `acceptance/`.** An `L-ACC` family binds realistic scenario briefs and human-ratified rubric axes. Mechanical campaign guardrails (sealed answers, producer↔grader independence, preflight, spend cutoff, intermediate-gate persistence) remain layer-1/2 detectors with negative controls; do not recast a scored axis as binary merely to make it easy to implement.
9. **Outcome campaigns require fresh human authorization.** Implementing their fixtures and mechanical preflights is ordinary ticket work; running a live layer-6 campaign is not. It names its target, scenario set, spend/time ceiling, and permitted effects, and incomplete inputs or missing grader calibration produce `inconclusive`, never green.

**Adoption notes (proposal, not part of the verbatim block).**
Convention 9's phrase "a live **layer-6** campaign" uses the design skill's
six-layer taxonomy name for the outcome-acceptance lane: in THIS corpus that lane
is `L-ACC`, configured at `validation-policy.yaml` → `l_acc_lane:` (a separate
top-level block — there is no `L6` key under `layers:`). The verbatim block cannot
be edited, so this gloss lives here — **and the landing edit must carry it**: when
the conventions block lands in the real AGENTS.md, land this one-line gloss as an
adjacent line *outside* the frozen block in the same change, so the "layer-6"
phrase never appears without its resolution. <!-- changelog 2026-08-10 (reader
test 12, coding-agent finding 2; survival-at-landing added reader test 14,
coding-agent finding 2). -->
`owner-backlog.md` (convention 7) has **no generator script by design** — it is a
consequence-language prose companion, regenerated by the editing human/agent
rewriting the affected entries from `harness-backlog.md`; the mechanical check
that you did it is the ticket-ID **set-equality** diff:
`grep -oE 'HB-[0-9P]+[0-9]*' <file> | sort -u` over both files must produce an
empty `comm -3` difference — both directions, so a stale owner-only ID fails too,
not just a missing one. <!-- changelog 2026-08-10 (reader test 9, coding-agent
finding 2; corrected at the gate follow-up: the first wording used one-directional
`comm -23`, which misses owner-only stale IDs. -->
`case-catalog.yaml` is DERIVED: regenerate it with
`awk -f validation-design/case-catalog-generator.awk validation-design/case-catalog.md validation-design/harness-backlog.md`
whenever either markdown changes — hand-editing the YAML is a corpus bug (its
header says so; HB-140 owes the CI check that enforces byte-identical
regeneration). **Fallback for convention 6 (added 2026-08-10, coding-agent
finding 3):** if the `implement-harness-ticket` skill is not available in your
environment, implement the ticket by hand following conventions 1–5 and the
red-then-green rule, and say so in the change description — the prohibition is on
inventing a *different* workflow, not on working without the skill; stop and
escalate only if the ticket's enumeration is ambiguous. **Do not confuse this
permissive fallback with the structural one** <!-- changelog 2026-08-10 (reader
test 32, coding-agent finding 4): two near-identically-phrased fallbacks for
two different skills sat 150+ lines apart uncross-linked -->: for
`implement-harness-ticket` (THIS rule) hand-implementation is permitted; for
`validation-harness-design`/`harness-revision` (the structural-additions
section above) hand-approximation is FORBIDDEN — stop and escalate. Ticket
work may proceed by hand; structural revision never may. Existing spec
directories already follow convention 1; convention 2's header citations are owed
incrementally — add them on touch, never in a bulk rewrite that would blur authorship.
Convention 3's current pending set is recorded in `case-catalog.yaml` (notably
CF-REVIEW-PROVIDER→HB-133, the F-PT-019 leg→HB-135, CF-J21-I→HB-136, and the
comparative-execution families→HB-090…094). A structural mismatch still re-enters
`validation-harness-design` in `harness-revision` mode, exactly as the ratified
section above requires.
