# Traceability conventions

**Traceability conventions** (normative — the `validation-trace` CLI enforces their mechanical closure subset in CI):

1. **Exact model paths establish current implementation links.** Each test or
   evidence artifact appears under the matching family in
   `model/families.yaml` as an exact `planned_tests` or evidence path. An
   observed spec absent from the model is an orphan and turns closure red.
2. **Headers are human annotations, never authority.** Keep the first comment
   block's CF/HB/clause citation useful for readers, but historical or wrong
   header text cannot create, reject, or reassign a current model fact.
3. **Every implementable family owns ≥1 planned implementation, or remains
   honestly unfinished.** A missing implementation owned by a pending,
   blocked, or parked model ticket is partial/inconclusive. The same absence
   under a landed or unknown owner is red.
4. **Traceability updates land with the implementation.** Adding, moving, or
   deleting a spec updates `model/families.yaml`, its red-capable control, and
   `model/backlog.yaml` in the same change — never a follow-up.
5. **The checked graph is the sole machine authority.** Generated
   `case-catalog.md`, `harness-backlog.md`, `owner-briefing.md`,
   `owner-backlog.md`, `planned-trace.md`, and `compiler-report.json`
   must be regenerated with
   `pnpm exec validation-architect compile . --write` and never hand-edited.
6. **Implement tickets via the `implement-harness-ticket` skill.** That skill is the standard path from an HB ticket to landed specs: ticket → family → ratified enumeration → red-then-green tests, with the conventions above so `validation-trace` stays green. Do not invent a parallel workflow.
7. **Regenerate all projections together.** A model change that leaves any of
   the five Markdown views or the compiler report stale is a corpus bug.
8. **Resolve outcome-acceptance families from `acceptance/`.** An `L-ACC` family binds realistic scenario briefs and human-ratified rubric axes. Mechanical campaign guardrails (sealed answers, producer↔grader independence, preflight, spend cutoff, intermediate-gate persistence) remain layer-1/2 detectors with negative controls; do not recast a scored axis as binary merely to make it easy to implement.
9. **Outcome campaigns require fresh human authorization.** Implementing their fixtures and mechanical preflights is ordinary ticket work; running a live layer-6 campaign is not. It names its target, scenario set, spend/time ceiling, and permitted effects, and incomplete inputs or missing grader calibration produce `inconclusive`, never green.
