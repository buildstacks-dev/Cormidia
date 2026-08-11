# Golden sets — scaffolds (commitment precedes content)

Fourteen directories: twelve statistical golden sets (reviewer, planner, builder-quality,
sre, support, marketing-content, marketing-analysis, distiller, learning-reviewer,
selection-judge, validation-designer, **acceptance-grader** — the S-11 set, added
2026-08-07, first seeded case committed) +
one deterministic suite (builder-trajectory) + `brief-conditioning/` (conditioning
study — NOT a model golden set).
<!-- changelog 2026-08-10 (Phase 8 reader test 4, operator finding 6): counts were
stale ("Thirteen/eleven", omitting acceptance-grader) vs llm-eval-plan.md §7's
2026-08-07 changelog and the actual tree; on such drift the eval plan wins. --> **If a statistical scaffold here carries no numeric threshold at all, that is
deliberate, not an omission**: S-5/S-6/S-7/S-8 (support, marketing ×2, distiller,
learning-reviewer, selection-judge) were left bare-by-design under F-PT-011 so no
invented number could fossilize — their numbers get minted at the first
eval-campaign design review from observed data (rationale: llm-eval-plan.md's
header note). S-1/S-3/S-4 carry owner-voiced `[PROPOSED]` budgeting hypotheses;
S-11's deferral is separately human-ratified (rubric §5). <!-- changelog
2026-08-10 (reader test 10, new-engineer finding 4): the asymmetry rationale
lived only in the eval-plan header; now stated at this entry point too. -->
Every **statistical** scaffold records: rubric axes ·
threshold + sample-size status (`OPEN` with its owning finding where unknown;
where a provisional NUMBER exists it is not repeated in the per-directory README —
it lives at `validation-policy.yaml → proposed_register` under the
owning F-PT id <!-- changelog 2026-08-10 (reader test 15, new-engineer finding 6):
co-location pointer from the literal OPEN label to the numbers' single home -->) ·
cadence · qualifying tuple dimensions · case schema + provenance requirements · an
explicit `SCAFFOLD/UNPOPULATED` status. **Deterministic and study scaffolds are
exempt from rubric/threshold semantics and mark those fields N/A** — they never
provide model-swap or qualification quality evidence. Cases are authored per the
harness backlog, BEFORE any prompt tuning (skill rule 6); populated sets double as the
model-swap regression suite (plan §4).

**Decision-status rule (plan §9):** no hypothesis-status number here yields pass/fail;
until its finding is ratified, campaigns run in data-collection mode and report
`inconclusive` for threshold-dependent outcomes.

`human-validation.json` is the attributable RQ-1 review ledger for the currently
populated Reviewer, Planner, and Validation Designer corpora. It preserves agent
authorship, the human's exact confirmation statement/date, the source commit, and one
agent-computed canonical source-row digest per confirmed case.
