# Proposed rev-2026-08-10 addendum (traceability conventions) — parked, NOT yet binding

<!-- Parked verbatim by the #402 restructure (2026-08-11) from AGENTS.md lines
743-812 at commit fa86238. Provenance: rev-2026-08-10 harness revision, AI
product-owner seat; ratification-package.md §12 is DRAFT pending real-human
ratification. The inner conventions block must land unedited IF adopted, and
its landing must carry the adjacent "layer-6 = L-ACC" gloss (stated inside).
Never represent this as landed policy.
verbatim-below -->

## Proposed rev-2026-08-10 addendum — traceability conventions and machine catalog

AGENTS.md is a human-ratified surface, so this is a **proposal with rationale**.
**Provenance of this addendum**: it comes from the rev-2026-08-10 harness revision, whose
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


> **Gloss (landing):** In this corpus, the design skill's "layer-6" name for the
> outcome-acceptance lane is `L-ACC`, configured at `validation-policy.yaml` →
> `l_acc_lane:` (a separate top-level block — there is no `L6` key under `layers:`).

**Adoption notes (proposal, not part of the verbatim block).**
Convention 9's phrase "a live **layer-6** campaign" uses the design skill's
six-layer taxonomy name for the outcome-acceptance lane: in THIS corpus that lane
is `L-ACC`, configured at `validation-policy.yaml` → `l_acc_lane:` (a separate
top-level block — there is no `L6` key under `layers:`). The verbatim block cannot
be edited, so this gloss lives here — **and the landing edit must carry it**: when
the conventions block lands in the real AGENTS.md, land this one-line gloss as an
adjacent line *outside* the frozen block in the same change, so the "layer-6"
phrase never appears without its resolution. 
`owner-backlog.md` (convention 7) has **no generator script by design** — it is a
consequence-language prose companion, regenerated by the editing human/agent
rewriting the affected entries from `harness-backlog.md`; the mechanical check
that you did it is the ticket-ID **set-equality** diff:
`grep -oE 'HB-[0-9P]+[0-9]*' <file> | sort -u` over both files must produce an
empty `comm -3` difference — both directions, so a stale owner-only ID fails too,
not just a missing one. 
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
permissive fallback with the structural one**: for
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

<!-- cormidia-authority:start -->
