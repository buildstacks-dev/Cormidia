# L-ACC — design input for the harness-revision pass

***Status: CONSUMED 2026-08-07 — input, not design.*** *The revision pass this file
was written for has run; everything below is now registered in the ratified corpus.
Read it for the reasoning, not for the current IDs — §8 records the landing and the
three renumberings.*

*This file is what you carry into
`validation-harness-design` in **`harness-revision`** mode, with the existing
[`validation-design/`](../validation-design/) artifacts as baseline. It states the
structural additions L-ACC requires and the two questions the docs do not answer.
It is deliberately **not** a set of catalog rows — authoring those here would be
exactly the "piling cases onto a wrong shape" that AGENTS.md forbids.*

## 1. Why a revision is mandatory

AGENTS.md → Validation harness → *Structural additions are not autonomous*: a
change needing a **new journey, boundary, or invariant** — not just new cases
against existing ones — requires re-entering the design skill in
`harness-revision` mode. L-ACC needs all three.

There is also **pre-existing debt this pass should clear in the same pass**:
[`docs/jobs/design.md:495`](../docs/jobs/design.md:495) already records that
`J-JOB-1` and `J-JOB-2` are new journeys plus at least one new boundary (the job
config/journal contract), never entered into the catalog. Jobs and L-ACC overlap
heavily — S-ACC-3 *is* the L-JOB-LIVE campaign — so revising for both together
is cheaper and produces a coherent shape rather than two bolt-ons.

## 2. New journeys

Baseline is `J-01`..`J-20` ([`contracts/journey-acceptance.md`](../validation-design/contracts/journey-acceptance.md)).

| Proposed | Journey | Notes |
| --- | --- | --- |
| **J-21** | Outcome acceptance campaign | provision → plan arm → **plan gate** → build arm → grade → report → optional issue filing. Composite over `J-01`, `J-02`, `J-03`, `J-04`, `J-07`, `J-15`. The plan gate is a new state, not an alias of `J-06` approval-wait — it resolves on a *score*, not an approval row. |
| **J-JOB-1** | Job definition → dependency-ordered execution | Outstanding from [`docs/jobs/design.md`](../docs/jobs/design.md) §14. Not L-ACC-specific. |
| **J-JOB-2** | Job resumption across process death | Outstanding, ditto. |

## 3. New boundaries

Baseline is `B-01`..`B-26` ([`boundary-map.md`](../validation-design/boundary-map.md)).

| Proposed | Boundary | Why it is a boundary and not a case |
| --- | --- | --- |
| **B-27** | Acceptance campaign config / durable report | Owns the authorization envelope and report identity. Structurally parallel to the L3 config ([`tests/live/config.ts`](../tests/live/config.ts)) — reuse that shape; do not invent a second one. |
| **B-28** | **Sealed answer key** | A genuine *confidentiality* boundary: `## Plants` must never cross into a grader turn's input. Novel — no existing boundary governs "this committed repository content is withheld from a specific turn." This is the most interesting thing the revision has to place. |
| **B-29** | Grader independence | Provider-disjointness between grader and every builder in a scenario, enforced before turn construction. |
| **B-JOB** | Job config / journal contract | Outstanding from the jobs design. |

## 4. New invariants

Candidates, for the revision to sharpen into falsifiable form. Proposed risk tier
in brackets — all three E-3 candidates are there for the same reason: **a silent
violation invalidates every score the campaign produced, while the campaign still
reports green.** That is evidence-truth, which
[`risk-allocation.md`](../validation-design/risk-allocation.md) §2 assigns to E-3.

| Proposed | Invariant | Tier |
| --- | --- | --- |
| **INV-ACC-1** | No grader turn's assembled input contains any byte of a sealed `## Plants` section. | **E-3** |
| **INV-ACC-2** | For every scenario, the grader's provider ∉ {providers of every builder turn in that scenario}. Checked before provider construction, fail-closed. | **E-3** |
| **INV-ACC-3** | No L-ACC campaign resolves a sandbox app to this repository. (Guards the [`assertCampaignRepositoryBinding`](../tests/campaign/repository-binding.ts) trap — an app that edits Cormidia mid-campaign voids the campaign's own commit pin.) | **E-3** |
| **INV-ACC-4** | No scenario's build arm begins before its plan gate has resolved. | STD |
| **INV-ACC-5** | While a threshold is unratified, no L-ACC verdict is `pass` or `fail`; every threshold-dependent axis reports `inconclusive`, and `ungraded` is never coerced to `0`. | STD |
| **INV-ACC-6** | Ceiling exhaustion, scenario kill, or missing grader run ⇒ `completeness: incomplete` for that scenario. | STD |
| **INV-ACC-7a** | Every product-affecting action in a campaign is performed by the `cormidia` or `cormidia-job` binary. No commit, branch, PR, issue or file write in a scenario repo traces to the supervising agent's identity; no provider SDK is called outside a Cormidia turn. | **E-3** |
| **INV-ACC-7b** | Those binaries are the **packaged** ones. Neither `cormidia` nor `cormidia-job` resolves through PATH into this checkout; no campaign turn runs `pnpm dev`, `tsx src/…`, or a `link:local` symlink. | **E-3** |

**`INV-ACC-7` is the invariant the whole lane rests on**, and it has two halves
that fail independently.

**7a — the supervisor must not do the work.** An agent that runs `git`/`gh`
itself, edits a sandbox repo directly, or calls a provider SDK is *simulating* the
org rather than exercising it, and every score is then a measurement of the
supervisor. Detector seams: the invocation audit
([`src/cli/invocation-audit.ts`](../src/cli/invocation-audit.ts)) plus per-commit
authorship in each scenario repo, cross-checked against the run journal's turn
records.

**7b — the binary must be the shipped one.** `pnpm link:local` produces a
*source-backed* install: symlinks into `src/`, run through tsx, executing
TypeScript that `npm install -g cormidia` never ships
([`scripts/install-packaged.mjs:6`](../scripts/install-packaged.mjs:6)). A campaign
run against it measures the working tree, not the product.

**7b is already implemented — do not rebuild it.** `pnpm install:packaged
--replace-source-links` (#360, [`scripts/install-packaged.mjs`](../scripts/install-packaged.mjs))
does build → `npm pack` → global tarball install → skill links from the installed
root, and then *"resolves each binary through PATH and fails if either one still
resolves inside this checkout."* The campaign's B-27 preflight asserts that
script's exit status and records the installed version plus tarball identity in
the report. `--dry-run` classifies every interfering path before mutating
anything, so it is a complete preflight rehearsal.

Both halves are E-3 for the same reason as `INV-ACC-1`/`INV-ACC-2`: silent
violation invalidates all evidence while the campaign still reports green.

`INV-ACC-1`, `INV-ACC-2`, `INV-ACC-7a` and `INV-ACC-7b` each need a **negative
control** (standing rule 4): land red against a plant deliberately leaked into
grader input; against a grader provider deliberately set equal to the graded
turn's; against a hand-authored commit deliberately pushed to a scenario repo; and
against a campaign started while `link:local` symlinks are still in place. `O-5`'s
fabrication detector needs the same treatment — red against a seeded unsupported
claim.

## 5. Lane placement

L-ACC is a new lane, not L3 cases. L3's verdict algebra is deterministic
pass/fail against boundary clauses; L-ACC's is multi-axis scored with
`inconclusive` as the default state. Folding them would force either weakening
L3's pass semantics or reporting a score as a clause.

`INV-ACC-1`..`INV-ACC-3` are **mechanical and belong at L1/L2** — they are
guardrails, and standing rule 2 says a guardrail is enforced in code and tested,
never measured by an eval. Only the rubric axes themselves are L-ACC-lane work.
Getting this split right is most of the value of the revision pass: **the
expensive lane should contain only what no cheaper layer can falsify.**

## 6. Two questions the docs do not answer — open as findings

Per AGENTS.md → *Opening a new finding*, these go into
[`validation-policy.yaml`](../validation-design/validation-policy.yaml) →
`open_findings:` with status `open`, mirrored into `harness-design-state.md`, with
dependent cases parked `BLOCKED:<finding>`. **Neither guess is encoded as
behavior.** Next free id is **F-PT-029**.

**F-PT-029 — L-ACC's relationship to RQ-1.** The policy is explicit that
triggered lanes gate their own layer's claims and never gate merge. It says
nothing about whether a *scored* lane can ever contribute to release evidence, or
sits permanently outside RQ-1 as disclosed future assurance (where the seven-day
soak and threat model sit). This is load-bearing: it determines whether a bad
L-ACC result can ever block a release, and the answer is the owner's.

**F-PT-030 — plan-gate authority under unattended execution.** Rubric §6 lets the
gate resolve either by human decision or by a declared `plan_gate` policy in the
campaign config. Whether an unattended campaign may auto-continue past a scored
gate at all is undecided. It is adjacent to but **not** covered by the ratified
sandbox test-mode profile ([`src/org/validation-test-mode.ts`](../src/org/validation-test-mode.ts)),
whose only permitted auto-grant category is `campaign_budget`. Conservative
reading: the gate is human-only until decided. Do not implement auto-continue
before ratification.

## 7. Model matrix is a campaign dimension, not a config edit

The repo's [`roles.yaml`](../roles.yaml) is the **shipped default template**, and
a human-ratified surface whose model IDs were ratified 2026-07-15 with a research
record. L-ACC must not rewrite *it*. Configuring a campaign org's own matrix is a
different act and is ordinary configuration.

**Mechanism (verified, use this — do not invent a second one).** `roles.yaml` is
resolved from **org home**, per-org, at
[`src/org/app-lifecycle.ts:255`](../src/org/app-lifecycle.ts:255). Per-app
*assignment* variation is expressed by declaring every needed tuple once at org
level as `adaptive_assignments` candidates with stable role-local IDs, then having
each app's `allowed_assignments` narrow to its own IDs.
[`docs/org/apps.md:110`](../docs/org/apps.md:110) is explicit that unknown roles or
IDs fail configuration loading before execution, so **app config can only narrow
the org catalog, never widen it** — which is exactly the property that makes three
matrices in one org safe. Two orgs are not needed and should not be used.

The run-1 mirrored matrix is tabulated in [`README.md`](README.md). Three
constraints the revision should capture as B-27 report fields:

0. **Cross-family review is not optional.** An app arm whose planner, builder and
   reviewer are all one provider family collapses the builder ≠ reviewer pairing
   ([`roles.yaml:52`](../roles.yaml:52), AGENTS.md → Working rules). B-27 must
   reject such a config at **preflight**. This is why S-ACC-1's reviewer is
   `gpt-5.6-sol` rather than the template's Opus.

1. **Every score carries its matrix.** Without it, a poor outcome cannot be
   attributed between "Cormidia is broken" and "that builder was wrong for this."
2. **`effort: max` is harness-gated.** [`src/runtime/assignment.ts:82`](../src/runtime/assignment.ts:82)
   admits `max` only on `claude` and `opencode`. A campaign config naming
   `max` on `codex` or `pi` must fail **preflight**, not at the first turn —
   discovering it mid-campaign wastes the envelope. Run 1's OpenAI-family tuples
   therefore top out at `xhigh`.

3. **`qualification_ref` is provenance, not a lookup.** Every
   `adaptive_assignments` candidate carries `provider_family`, `capability_ref`,
   `qualification_ref` and a `conservative_estimate`; configuration loading
   validates the typed form and explicitly "does not claim to rerun or dereference
   an external campaign" ([`docs/org/apps.md:104`](../docs/org/apps.md:104)). Any
   run-1 tuple without a real ratified reference must be **disclosed as
   uncertified in the campaign report** — never given a plausible-looking
   reference. B-27 should carry the disclosure field so the omission is
   structurally impossible rather than a matter of diligence.

## 8. Follow-up when the lane actually lands

- Add an `acceptance/` row to the AGENTS.md repository map (deliberately **not**
  done now — the map should not advertise a subsystem that does not exist).
- Register `B-27`/`B-28`/`B-29` failure-mode lists in `boundary-map.md`.
- Add `case-catalog.md` traceability rows for every invariant in §4.
- ~~Record the ratification of [`rubric.md`](rubric.md) §8 with its exact
  confirming statement.~~ **Done 2026-08-07** — statement "I ratify", digest
  `0486996d…f167` over the exact ratified bytes, against tree
  `68a7595`. The rubric is now **tighten-only**: the revision pass may narrow an
  axis or a rule, never loosen one, and must not introduce a threshold — every
  threshold stays unratified until run 1's distribution exists (`rubric.md` §5).
- Carry the ratified verdict semantics into the policy: L-ACC campaigns report
  `inconclusive` for every threshold-dependent axis and `ungraded` where evidence
  is missing, and `ungraded` is never coerced to `0` (`INV-ACC-5`). The revision
  should make this expressible in `validation-policy.yaml`'s verdict vocabulary
  rather than left to the runner's discretion.

---

## 9. Landing record (2026-08-07)

The revision pass ran with this file as its input. What landed, and the three places
the landed shape differs from what §2–§4 proposed:

| Proposed here | Landed as | Why |
| --- | --- | --- |
| J-21 outcome acceptance | **J-21** | unchanged |
| J-JOB-1 / J-JOB-2 | **J-22 / J-23** (aliases retained) | the ratified journey namespace is numeric; the spoken names still resolve |
| B-27 / B-28 / B-29 | **B-27 / B-28 / B-29** | unchanged |
| **B-JOB** | **B-30** (alias `B-JOB` retained) | same reason — `B-01…B-30` stays numeric |
| INV-ACC-1 "no grader turn's *assembled input* contains any byte" | **tightened** to assembled input **plus** the grader's reachable surface | the grader is an agentic turn with file-read tools; a plant deleted from the working tree is still in `git log -p`. Narrowed-to-stronger under tighten-only |
| B-29 "grader independence" as a rule | **framed as a seam**: graded evidence set ↔ grader turn, with disjointness as its admission precondition | a constraint is not a boundary; the seam passes the boundary test in both directions, and transport stays B-02/03/04 |
| F-PT-029 / F-PT-030 | **opened, both `open`** | neither guessed; each carries a fail-closed interim explicitly labelled an interim |
| — | **F-PT-031** (new) | the INV-016 domain question the jobs debt required; its original numbering collided with #336's F-PT-025 |

§5's placement instruction was followed exactly: all eight campaign invariants are
mechanical guardrails at **L1/L2 with negative controls** (`case-catalog.md` §3.1), and
only the rubric's scored axes are lane work (§8b). §7's three constraints became B-27
preflight refusals, so a bad matrix fails before the envelope is spent rather than at
the first turn.

The §8 follow-ups are done except the first, which stays deliberately undone: the
AGENTS.md repository-map row for `acceptance/` waits until the lane exists, and the
routing text is a **proposal** in `validation-design/agents-md-contribution.md` because
AGENTS.md is human-ratified.
