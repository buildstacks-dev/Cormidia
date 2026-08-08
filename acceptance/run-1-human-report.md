# L-ACC run 1 — human-readable campaign report

> **Derivative, non-normative review report.** This document explains the first
> live outcome-acceptance campaign in ordinary language. It does not replace the
> immutable machine report, change any score, create a release signal, or ratify
> a threshold.

## The question this report answers

The campaign was meant to answer a practical question: can a real Cormidia
organization, using the same packaged binaries a user installs, turn messy
human requests into sound plans and then into useful software or research
outputs—without the supervising operator quietly doing the work for it?

Run 1 answered only the first part. It proved that the live campaign could move
from an authorized configuration through real provisioning, real provider
turns, the plan-quality gate, spend settlement, reconciliation, and an atomic
final report. The plan gate then required the campaign to stop. Consequently,
the run produced valuable evidence about planning, provider compatibility, and
the campaign harness, but no application build or research-job outcome.

The strongest reason for confidence is that the run used real packaged
`cormidia` and `cormidia-job` binaries, real private GitHub repositories, and
real Claude and Codex turns under hard spending ceilings. The most important
limitation is that every official measurement row is `ungraded`, all three
scenarios are `incomplete`, and the overall verdict is `inconclusive`.

This evidence is outside release qualification (`RQ-1`). It says nothing about
release readiness and authorizes no deployment.

## A small vocabulary

**L-ACC** is Cormidia's outcome-acceptance lane. Unlike a deterministic test
that checks one protocol rule, L-ACC asks whether the organization produced a
good plan and a good result from realistic input.

A **scenario** is one isolated task in a disposable repository. An app scenario
has a plan arm followed, if allowed, by a build arm. A job scenario has a
dependency-ordered research/build graph and no Planner or Reviewer. Scenario
identifiers use the `S-ACC-n` family, where the number distinguishes the three
authorized tasks.

An **axis** is one measurement dimension. Plan axes use the prefix `P-`, app
outcome axes use `O-`, and job-specific axes use `J-`. Scores, when valid, range
from 0 (absent) to 3 (strong).

Each brief contains hidden test cases called **plants**: contradictions, missing
information, buried requirements, and distracting tangents. The campaign
extracts these into a sealed answer key. Models grading the work cannot read the
key; mechanical checks apply it afterwards. This prevents a grader from being
told the expected answer.

The **plan gate** is a deliberate cost and quality boundary. Every app scenario
must reach at least 1, meaning “attempted,” on requirement extraction (`P-1`)
and ticket executability (`P-5`) before any build tokens may be spent. Stopping
at this gate is a successful campaign termination, but it is not a passing
quality result.

The status words are intentionally different:

- `ungraded` means no valid numeric measurement survived. It is not zero.
- `inconclusive` means run 1 has no ratified pass/fail thresholds.
- `incomplete` means some authorized work or required evidence did not finish.

## What the campaign was supposed to do

The complete campaign lifecycle was:

1. Validate the human authorization, commit pin, policy, model assignments,
   repository identities, spending ceilings, and grader independence.
2. Prove that a fresh packaged install—not a source-linked development CLI—was
   selected.
3. Provision three private disposable repositories under one campaign owner.
4. Extract and seal each scenario's hidden plants.
5. Run the two app planning tasks through `cormidia plan --auto`.
6. Score plan coverage mechanically and grade plan executability and
   decomposition with a provider family different from the Planner's.
7. Apply the declared plan-gate policy.
8. Only if both app plans cleared the gate, run the two app build/review loops
   and the research job, then grade their outcomes.
9. Reconcile packaged-CLI invocations, provider-turn telemetry, and repository
   authorship; settle spend; write the final report atomically.

The gate stopped the sequence after step 7. Steps 8's build and job arms were
therefore correctly unreachable in run 1.

## The three human tasks

| Scenario | Human request | What a successful full arm would have produced |
| --- | --- | --- |
| `S-ACC-1` — greenfield app | Build **Clearing**, a responsive web app for freelance time tracking and invoicing. It needed a timer, manual entries, client records, historical hourly rates, correct timezone handling, printable invoices, authentication, and a public landing page. The plan also had to surface contradictory pricing instructions, park an undecided multi-currency policy, and reject mobile-app, project-management, CRDT, and PDF scope creep. | A clean-clone-buildable app and a scripted walk proving that an invoice spanning a rate change uses the historical rate. |
| `S-ACC-2` — brownfield app | Assess ten deliberately stale tutorials one by one, preserving material that still worked, repairing broken examples, merging overlapping monorepo tutorials, and retiring obsolete material only with the required approval. Rewritten samples were meant to become executable tests, and each rewrite required review by someone other than its author. | A disposition table for all ten tutorials, a clean-clone sample-execution suite, protected content left unchanged, justified retirements, and independent-review evidence. |
| `S-ACC-3` — dependency-ordered job | Fan out three research passes, synthesize their inputs, and create one self-contained HTML comparison. The job was meant to preserve conflicting source claims, retain a tool present in only one input, admit when no weakness was known, choose a visualization after seeing the merged data, and avoid unrelated trend/auth-provider work. | Three checked research artifacts, a checked merged dataset, one standalone HTML file, and a per-step spend and handoff ledger. |

The two app scenarios deliberately mirrored provider families: Claude planned
and built `S-ACC-1` under Codex review, while Codex planned and would have built
`S-ACC-2` under Claude review. This was intended to compare a cheaper builder at
high effort while preserving cross-provider review independence. The comparison
never reached a build outcome, so no conclusion about that hypothesis is
available.

## What was going to be measured

The plan measurements were requirement coverage (`P-1`), contradiction handling
(`P-2`), honest handling of missing information (`P-3`), scope discipline
(`P-4`), ticket executability (`P-5`), and sensible decomposition (`P-6`).

Had the app builds run, the outcome measurements would have covered whether the
product built and started (`O-1`), whether its obvious user path worked (`O-2`),
engineering integrity (`O-3`), governance and independent review (`O-4`),
honesty of claims (`O-5`), cost (`O-6`), and unplanned human intervention
(`O-7`).

The job replaced the first three outcome axes with artifact completeness
(`J-1`), faithful use of upstream outputs (`J-2`), and final-deliverable quality
(`J-3`). Governance, honesty, cost, and autonomy still applied, adjusted for the
fact that an ad-hoc job has no Reviewer, tickets, pull requests, or typed review
verdicts.

Run 1 was data collection only. No numeric threshold had been ratified, so even
a complete axis would have remained `inconclusive` rather than becoming a pass
or fail.

## What actually happened

### 1. The live environment was established

The work ran from the fresh worktree
`/Users/bikram/Build/Cormidia-worktrees/codex-l-acc-run-1`, not from `main`.
The campaign configuration carried the exact authorized ceilings of 4,000,000
output tokens and $520 equivalent exposure. Its mutation-free dry run passed.

The campaign had a real organization, three private disposable repositories,
and working credentials for both provider families. All three repositories were
provisioned before arm execution. The tutorial and research inputs came from
committed deterministic manifests, so later runs can recreate the same initial
material.

The installed package was `cormidia@0.1.1`, built from campaign commit
`e52b304ac8f6a00be973e265b84af8533c59dd72`. The exact tarball was
`cormidia-0.1.1.tgz`, SHA-256
`e2eb2650156d65158242f783560f0eaaa0837ae805b751890ef10f9cb772183a`.
The packaged install temporarily displaced the developer's source links; after
the campaign, `pnpm link:local` restored them.

### 2. `S-ACC-1` produced a real plan

The first Claude Episode Planner attempt exposed a provider-boundary schema
incompatibility before model construction. The Claude adapter was repaired so
only unsupported dialect metadata was removed at the provider boundary; the
canonical Cormidia validator remained unchanged. The resumed live planner then
completed.

The raw mechanical plan observations were:

| Axis | Raw observation | Plain-language reading |
| --- | ---: | --- |
| `P-1` | 0 | The ticket set did not cover all planted hard requirements. This alone was enough to block the build. |
| `P-2` | 3 | The plan strongly surfaced the planted contradiction. |
| `P-3` | 3 | The plan strongly handled missing information without inventing policy. |
| `P-4` | 2 | Scope discipline was adequate but not strong. |

The two independent Codex graders each returned a raw score of 3 for ticket
executability (`P-5`) and decomposition (`P-6`). Those two values did not become
official scores: the real `run-role` CLI wrapped its JSON terminal result in a
summary line that the harness's scripted-binary tests had not modeled.

Final reconciliation then found a settled provider turn from an earlier
pre-report process that the resumed process's in-memory invocation driver could
not join. The fail-closed rule did what it was designed to do: it voided every
numeric score for `S-ACC-1` instead of publishing a result whose execution chain
could not be proven. All `S-ACC-1` axes therefore appear officially as
`ungraded: reconciliation-open`.

### 3. `S-ACC-2` failed before producing a plan

The Codex Episode Planner rejected the canonical episode-plan schema before
model construction. Its strict structured-output dialect required explicit
scalar types, supported `anyOf` rather than nested `oneOf`, required every object
property, and represented optional values as nullable.

Because the plan command failed, the harness correctly avoided spending money
on graders for a nonexistent plan. Every `P-` axis became
`ungraded: arm-command-failed`; every outcome axis remained
`ungraded: evidence-missing`.

### 4. The plan gate stopped the campaign

The declared policy applied the ratified gate and recorded shortfalls at
`S-ACC-1/P-1`, `S-ACC-1/P-5`, `S-ACC-2/P-1`, and `S-ACC-2/P-5`. The app build
arms did not run. Since the job arm was required to wait for the campaign-level
app gate, `S-ACC-3` did not run either.

This was the correct terminal behavior. Continuing would have spent most of the
envelope on outcomes that could not be interpreted against adequate plans.

### 5. The final report was written without upgrading uncertainty

The durable report was finalized at
`/Users/bikram/Build/l-acc-run-1-20260807/campaign/acceptance/l-acc-run-1/report.json`.
Its SHA-256 is
`d0bb9e39bfe7483ced132e228f7e0615378df15192532b2e8a4a98e03c94f200`.

The official result is:

| Scenario | Official result | Why |
| --- | --- | --- |
| `S-ACC-1` | All `P-1`…`P-6` and `O-1`…`O-7` ungraded; incomplete | Reconciliation did not close, and no build arm ran. |
| `S-ACC-2` | `P-1`…`P-6` ungraded because the arm command failed; `O-1`…`O-7` ungraded because evidence was missing; incomplete | No model plan was constructed and no build arm ran. |
| `S-ACC-3` | `J-1`…`J-3` and `O-4`…`O-7` ungraded; incomplete | The job correctly waited behind the failed app plan gate. |

There are no official numeric scores or citations. The overall verdict is
`inconclusive`, and `release_signal` is `null`.

## What was achieved

Run 1 achieved more as an execution and harness-discovery campaign than as an
outcome measurement:

- It completed the first real config-to-report L-ACC invocation through the
  packaged product path.
- It exercised real private GitHub provisioning, app registration and
  verification, provider construction, plan execution, independent plan
  grading, spend settlement, the plan gate, final reconciliation, and durable
  report storage.
- It produced a genuine `S-ACC-1` plan-quality finding: hard-requirement
  extraction was insufficient even though contradiction and uncertainty
  handling were strong.
- It proved that a failed plan arm does not get translated into a low score or
  trigger wasteful grader turns.
- It proved that a failed gate prevents all build and job spend and that the
  report preserves every missing scenario and axis rather than silently dropping
  them.
- It found four product defects and eighteen harness findings. All four product
  defects were repaired; fifteen harness defects were repaired, one was retained
  as an expected grader-independence gap, one was documented as a dry-run
  limitation, and one remains an open reproducibility improvement.
- Every deterministic defect repair received an offline regression detector.
  The final post-run commit was
  `4ef9acf660484dbb17c182fd7a5ca2236d3af3aa`.

The open harness improvement is that the eight-pass build bound exists in the
live composition but is not serialized in the immutable campaign configuration
or report. It did not affect this run because no build arm began, but it should
be made explicit before a future build-capable campaign.

## What was verified, and at what evidence level

### Verified live with real external systems

- The exact packaged tarball installed successfully and both campaign binaries
  resolved outside the source checkout.
- The authorized private GitHub organization and all three disposable
  repositories satisfied campaign identity checks.
- Claude and Codex credentials were usable for the turns that were reached.
- The Claude provider-boundary schema repair succeeded in a resumed real plan
  turn.
- A real `S-ACC-1` plan and two independent real plan-grader turns completed.
- The `S-ACC-2` Codex schema incompatibility was a real provider-boundary
  failure, not a scripted fixture result.
- The plan gate stopped all build and job arms before they spent tokens.
- Unknown provider usage was conservatively debited rather than represented as
  zero.
- The campaign produced an atomic final report carrying exact package identity,
  model matrices, gaps, spend, completeness, preview commands, and no release
  signal.
- Deployment remained unreachable.

### Repaired and verified offline after the terminal stop

Three final defects were fixed after the immutable report was written:

1. Codex strict-schema translation now recursively converts the canonical
   schema into the provider-supported subset while retaining canonical return
   validation.
2. The grader parser now accepts either bare JSON or the exact caller-bound
   `run-role` terminal wrapper, while continuing to reject arbitrary progress
   text.
3. Reconciliation now scopes historical turn rows to the current driver's
   scenario-attempt window, while still detecting an unrecorded turn interleaved
   during that window.

These repairs were not live-retried because run 1 had already reached its
terminal gate, and rerunning to improve the result was forbidden. They are
verified by deterministic tests, not by a second live campaign.

The post-run repository gate passed:

- `pnpm check`: formatting/lint, strict TypeScript checking, exact dependency
  pins, import direction, and size/export ratchet all passed.
- `pnpm test`: 256 test files passed; 2,039 tests passed and one intentional
  policy skip remained.
- The worktree was clean after commit, and source-backed CLI and skill links
  were restored.

### Not verified by run 1

Run 1 provides no evidence that:

- Clearing builds, starts, or completes its invoice workflow;
- the tutorial corpus was repaired correctly or its examples execute;
- the research job preserves handoffs or produces a useful standalone HTML
  visualization;
- either cheap-builder/provider-family hypothesis improves quality or cost;
- any `O-` or `J-` outcome axis meets a quality bar;
- the post-run Codex schema, grader-wrapper, or reconciliation repairs work in a
  second real campaign;
- any numeric pass/fail threshold should be ratified;
- Cormidia is release-ready or should be deployed.

## Spend and provenance

| Dimension | Observed | Conservative unknown debit | Total consumed | Authorized ceiling | Remaining |
| --- | ---: | ---: | ---: | ---: | ---: |
| Output tokens | 28,884 | 240,000 | 268,884 | 4,000,000 | 3,731,116 |
| Equivalent USD | $2.0649095 | $45.00 | $47.0649095 | $520.00 | $472.9350905 |

The unknown debit covers two response-schema failures whose providers supplied
no usable metering. Each was charged its full conservative failure allowance.
No ceiling was exhausted, and no reservation was refused.

The campaign configuration hash was
`908624d479ad66f5d5a58f3e824929e494eba975ab6f57b6f879547beea34ac3`.
The install proof was recorded at `2026-08-08T06:43:48Z`, and the final report
was recorded at `2026-08-08T06:52:42.824Z`.

## Review findings to resolve before another campaign

The evidence supports accepting run 1 as a successful plan-gate and harness-
discovery exercise. It does not support accepting it as an outcome-quality run.
A future campaign would be a new authorization, not a retry that edits run 1.

Before such a campaign, the reviewer should press these points:

1. **Exercise the three post-run repairs under a newly authorized live run.**
   Their offline detectors are strong, but only the Claude-side repair was
   demonstrated against a real provider after repair.
2. **Serialize the build-pass bound.** The current eight-pass maximum belongs in
   the immutable config and report rather than only in live wiring.
3. **Resolve scenario-document status.** All three committed scenario files
   still label themselves “DRAFT,” “Unratified,” and say no lane exists, while
   the current acceptance overview and final report record a ratified lane and a
   completed live run. The briefs were authorized as run inputs, but their
   headers are stale and could mislead the next operator.
4. **Reconcile the `S-ACC-3` fixture domain.** Its brief asks for local-first and
   sync-engine research, but its deterministic seed notes describe generic
   fictional build, test, formatting, bundling, and migration tools. Since the
   job never ran, the mismatch did not affect this result; if left unchanged it
   could make deliverable-quality scoring measure fixture incoherence rather
   than job performance.
5. **Correct job-axis metadata in future reports.** The ratified rubric and
   campaign plan declare `J-1` and `J-2` mechanical, but the terminal report's
   synthesized ungraded rows mark both as `mechanical: false`. Their scores
   remain correctly ungraded, so the verdict is unchanged, but the report
   metadata is inconsistent.
6. **Do not infer thresholds from this run.** Because no official numeric score
   survived, run 1 supplies no distribution from which a defensible pass/fail
   threshold can be ratified.

## Recommendation

Accept run 1 as evidence that the campaign can safely reach and enforce its
plan gate through real packaged binaries, and as a useful defect-discovery run.
Retain its official `inconclusive`/`incomplete` result unchanged.

Do not use it as evidence of product outcome quality, release readiness,
provider superiority, or deployment fitness. A next run is reasonable only
after the review findings above are dispositioned and a fresh human
authorization names its exact token and equivalent-dollar ceilings.

## Source coverage and status

This report synthesized 19 sources: the ratified rubric; campaign template;
three scenario briefs; two deterministic seed manifests; the acceptance lane
overview; the terminal evidence index; the product/harness issue ledger; the
three campaign boundary contracts; the campaign invariant corpus; the harness
backlog work-item (`HB-`) family, especially `HB-120`…`HB-132`; the live campaign composition and entry
point; the immutable final report; and the packaged-install proof.

The immutable report and install proof govern facts about what ran. The rubric,
contracts, and invariants govern intended semantics. The issue ledger governs
repair disposition. Scenario briefs and manifests describe the tasks and test
fixtures; their stale status headers and the `S-ACC-3` domain mismatch are
reported above rather than treated as authoritative status.

No source was unreadable. Repository policy excluded
`archive-do-not-read/**`; no file under that path was inventoried, read, or used.
The three unresolved source inconsistencies are the stale scenario headers, the
`S-ACC-3` brief/seed domain mismatch, and the `J-1`/`J-2` mechanical-metadata
mismatch in the final report.
