# Qualification and release gating

> **Status 2026-08-04:** the replacement per-commit harness and the bounded
> L3/L4/L5 runners are implemented under `tests/`, with the current
> contract in `validation-design/validation-policy.yaml`. RQ-1 is active and
> fail-closed for versions after `0.1.1`: every exact candidate requires complete
> L1/L2 plus separately authorized, candidate-bound L3/L4 evidence. No paid campaign
> or release ran in the implementation change. The human threat model, HB-073,
> seven-day soak, and natural rotation remain visible future L5 assurance outside
> RQ-1. F-PT-018 remains an explicit merge-enforcement limitation bounded by
> protected human merge and the release-blocking exact-tag rerun.

## Replacement campaign contract

Every triggered runner requires a human-initiated, absolute reviewed config that pins
the exact commit, state home, policy, target, and spend envelope. Missing authorization
is a refusal/incomplete lane, never a skipped pass.
At entry, the runner also binds checked-out HEAD to that commit, requires the canonical
tracked `validation-design/validation-policy.yaml` blob to be byte-identical to HEAD,
and (for L4) applies the same tracked-blob check to every golden-set input. An arbitrary
absolute file cannot substitute for reviewed repository truth.

```bash
# L3: one exact campaign kind (changed adapter, GitHub, launchd, or release)
CORMIDIA_LIVE=1 CORMIDIA_LIVE_CONFIG=/absolute/live.json pnpm test:live

# L4: per-tuple data collection over committed golden sets
CORMIDIA_EVAL=1 CORMIDIA_EVAL_CONFIG=/absolute/eval.json pnpm test:eval

# L5: human-started, resumable seven-day laptop soak
CORMIDIA_SOAK=1 CORMIDIA_SOAK_CONFIG=/absolute/soak.json pnpm test:soak -- start
CORMIDIA_SOAK=1 CORMIDIA_SOAK_CONFIG=/absolute/soak.json pnpm test:soak -- checkpoint --id <id>
CORMIDIA_SOAK=1 CORMIDIA_SOAK_CONFIG=/absolute/soak.json pnpm test:soak -- finish
```

The L3 config schema is `tests/live/config.ts` and admits only four exact
campaign shapes: one changed adapter; one sandbox-GitHub smoke; one launchd proof; or
a release campaign containing all three adapters, sandbox GitHub, and the unattended
profile. RQ-1 currently requires the launchd proof in every release campaign: the
policy trigger is conditional, but there is not yet a ratified, content-bound prior
trigger baseline or material-host observation that can prove the condition absent.
Restoring conditional omission requires that separately ratified baseline; a caller
declaration is insufficient. A partial release cannot call itself complete. Bounds
are 2 turns/$5 for a changed-adapter
pre-merge campaign and 24 turns/$100 for release. GitHub operations use the ratified
three-attempt jittered exponential retry budget. Launchd proof requires exact loaded
identity, an attributable tick, and removal of exactly that definition inside the
recorded case. Each spending case reserves its worst-case turns and equivalent cost
before execution. If the callback throws before returning trustworthy usage, the
runner conservatively debits the entire reservation; unknown partial spend can reduce
remaining campaign capacity, but can never disappear and make the hard ceiling
exceedable.

Release preparation and exact-tag verification execute the offline Vitest lane with
its JSON reporter and derive the allowed skip inventory from executed assertions,
not source-text patterns. Before execution, the release assessor pins the exact root
Vitest config bytes; afterward, the report's file set must equal every tracked
non-live `tests/**/*.test.ts` file at the candidate commit. Every skipped, pending, or
todo assertion must carry exactly
one current `BLOCKED:F-PT-nnn` identity; aggregate-count drift, a missing binding, a
resolved or unknown finding, a duplicate identity, a failed test, or any mismatch
with the packet inventory refuses qualification. Aliases, bracket notation,
conditional and chained skips, suite skips, and test options cannot disappear from
this execution-derived inventory.

The L4 config schema is `tests/eval-runner/cli.ts`: exact tuples, absolute
committed golden-set files, a token ceiling, provider-turn/equivalent-cost ceilings,
and an optional dated rotating shard. Results never pool tuples. The Reviewer, Planner,
and Validation Designer sets retain their agent authors and carry attributable human
validation by `bikramgupta` as of 2026-08-04.
F-PT-009/010/011 and decision-register items 9–12 remain proposed, so
threshold-dependent results are always `inconclusive`; the command exits 2 rather than
misrepresenting data collection as a pass.

The L5 soak config schema is `tests/ops/soak-protocol.ts`: exact sandbox
org/apps/repos, commit, local time zone, and the same human authorization envelope.
The start command binds canonical config and policy digests into durable state; every
checkpoint and finalization refuses drift, and the CLI refuses a checked-out commit
different from the authorization.
The collector records actual checkpoints and requires seven elapsed days, at least
three real sleep/wake cycles including one overnight, missed-window reconciliation,
WIP/duplicate/orphan and settlement evidence, partial-usage settlement, state-growth
series, retention sweep sanity, source health, zero new human decisions, and at most
24 provider turns/$15. CF-OPS-ROT additionally needs a natural Codex auth-rotation
record with exact session and checkpoint preservation. Missing natural rotation makes
the campaign incomplete; it is never injected or inferred.

HB-072 remains future human work. `validation-design/threat-model-template.md` is only a
ten-surface worksheet, and `threat-model-status.yaml` intentionally says
`awaiting_human_author`. The admission gate hash-binds a human-authored and reviewed
artifact covering TM-01…TM-10 before HB-073 abuse cases can proceed. Neither item is
inside RQ-1 completeness, verdict, qualification, campaigns, or cost ceilings; absence
remains visible and can never be represented as pass.

Campaigns persist after every result at
`<state-home>/validation/campaigns/<campaign-id>/report.json`. The product schema keeps
`completeness` separate from `verdict`: proven violation ⇒ fail even if incomplete;
otherwise incomplete ⇒ inconclusive; proposed decisions ⇒ inconclusive; pass requires
complete evidence and a ratified/non-proposed decision. Status, terminal/HTML Reports,
and Observe all render inconclusive as **not a pass and not release evidence** and link
the operator runbook at `docs/qualification/validation-triage.md`.

## Retained historical qualification contract

The executable machinery named below (`scripts/eval/**`, `eval/**`, transformation
suite, and release-currency lane) is frozen under `archive-do-not-read/` and must not
be read or run. The historical text is retained as an acceptance floor and provenance
record; the replacement policy above is the current executable contract.

*Historically, how Cormidia itself earned the right to ship. A release candidate was proved by
**campaigns** — predeclared, immutable batches of evaluation runs — and this
document defines the rules those campaigns obey: what must be pinned before
the first model call, what attempts and outcomes may claim, how development
iterates without a re-approval loop, the exact Phase 6 scope boundary, the
isolation rules, and the attestation that ties a qualified result to the
bytes actually released. Nothing here is narrative: every rule is enforced by
the now-frozen machinery. Operating identities and
route budgets are [`docs/episodes/contract.md`](../episodes/contract.md);
developer lifecycle policy is [`docs/DEVELOPMENT.md`](../DEVELOPMENT.md); the
executable requirement inventory is `eval/contracts.yaml`. Ratification dates
live in [History](#history), details in `docs/PURPOSE.md` → Decided.*

## Campaign and result semantics

A campaign declares everything before its first model call: exact
code/package/suite hashes, org and system fingerprints, the ordered cases and
repetition counts, runtime/model/effort assignments, capability claims, the
price catalog, the randomization seed, side-effect allowlists,
retry/exclusion rules, evidence paths, spend caps, and stop rules. Mutating
the manifest after start invalidates the campaign. Campaigns are bounded by
equivalent cost, provider turns, active time, and human decisions — input
tokens are deliberately not a bound, because they are a byproduct of context
assembly and caching rather than a budget.

An attempt terminates as exactly one of `passed`, `product_miss`,
`safety_stop`, `budget_stop`, `infra_invalid`, `harness_error`, or `not_run`.
A campaign terminates as `qualified`, `not_qualified`, `invalid`, or
`incomplete`. A required case has no passing skip state. An infrastructure
retry links to and retains the original attempt; a merit failure is never
retried under the same attempt identity.

| Campaign | Hard cap |
| --- | ---: |
| Adapter and harness calibration | $15 |
| Pre-transformation provider baseline | $250 equivalent cost |
| Full candidate qualification | $375 |
| Real-time soak | Separately declared and ratified |

A template's cap is not authority to run. Live execution needs either an
exact campaign authorization or a content-bound standing development grant,
plus `CORMIDIA_EVAL_LIVE=1`, a validated immutable campaign identity, an
explicit `--max-usd`, the exact `--confirm <campaign-id>`, non-billable
readiness, the applicable disposable-GitHub proof, and production-path
separation. Under a standing grant, the environment switch and exact
confirmation are accident guards the developer supplies; the grant's
cumulative lineage ceiling is the human authority. Subscription-backed
dollar values (Claude Max, ChatGPT Pro) are equivalent-cost indicators, not
incremental API billing.

## Development qualification execution

The platform-development lifecycle is separate from the org runtime;
[`docs/DEVELOPMENT.md`](../DEVELOPMENT.md) defines it. A standing objective
grant may cover repaired candidate descendants without repeated human
approval, but it can never cross into an operated org, production, outward
effects, governed learning activation, or the future real-time soak.

Long provider runs are release evidence, not the ordinary debugging loop.
When a campaign fails: preserve the failure, reproduce it deterministically,
and admit whatever model uncertainty remains in the smallest non-promotable
focused campaign. The same exact candidate must then pass adapter and
focused admission before final qualification begins. Focused and final
campaigns keep the same thresholds, graders, assignments, retry rules,
measurements, safety, and accounting, and stop at the first terminal
non-pass; promotion rejects focused evidence. Within an unchanged case
ceiling, unused budget from an earlier declared turn carries forward across
the remaining declared turns — fixed equal slices must not manufacture a
premature budget stop — while total case and campaign ceilings stay
fail-closed.

Equivalent-cost accounting includes the full historical lineage and every
immutable descendant attempt; it is a circuit breaker even when providers
are subscription-backed. The current grant and its exact cumulative ceiling
live under `eval/development-authorizations/`; this execution policy never
alters the qualification thresholds themselves.

## Phase 6 qualification scope

Phase 6 is the platform's current qualification generation, and this section
is its canonical boundary. The boundary decides scope only — it never alters
a threshold, grader, retry rule, measurement, denominator, model assignment,
safety boundary, learning-efficacy rule, or provider-accounting requirement.

The contract inventory holds exactly 84 records, each declaring one
`qualification_scope`:

- `current` contains exactly 83 contracts. Candidate campaign
  `candidate-qualification-v1-20260716-9ccc03a2c582` qualified all 34
  declared attempts with exact 73/73 provider settlement agreement and
  supported the nine provider-evidence promotions: `D-LIVE-01..03`,
  `E-LIVE-01..02`, `G-MET-01`, and `I-ROLE-01..03`. With those content-bound
  projections landed, the current scope has no known-red contract.
- `future_soak` contains exactly `I-LIVE-01`. It stays required and
  known-red until a genuine, separately authorized 48–72 hour real-time
  scheduler campaign satisfies its unchanged cadence, restart, safety,
  accounting, and evidence contract. It is neither passed nor current
  Phase 6 debt, and the token-free future-soak strict result must stay
  non-zero for exactly `I-LIVE-01` until that campaign is validly promoted.

The current strict command may exclude only the declared `future_soak`
contract; inventory validation fails on any missing, duplicate, unscoped,
foreign-scoped, or additionally future-scoped record. A preview, a local
passing marker, the deterministic seven-day virtual soak, or manufactured
evidence cannot promote `I-LIVE-01`; read-only production confirmation
reports production facts but cannot replace the future soak or repair
sandbox qualification. The token-free views are
`pnpm test:transformation:strict` for `current` and
`pnpm test:transformation:future-soak-strict` for `future_soak`.

Completing the current scope may be reported as **"Phase 6 efficiency
qualification complete; future real-time soak pending."** Cormidia must not be
described as a fully proven "highly efficient organization" until
`I-LIVE-01` passes the genuine future campaign. Phase 6 completion and that
broader organizational claim are deliberately distinct.

## Isolation and qualification

Eval actors run in fresh synthetic homes, an `Cormidia-Eval-<campaign-id>`
org, immutable content-addressed sparse/library/service templates, and
managed clones. Hidden graders, answer keys, reference patches, and mutants
stay outside actor context and tool-visible paths. GitHub writes are limited
to predeclared private `cormidia-eval-*` repositories. No eval publishes,
sends, changes DNS or cloud infrastructure, deploys to production, or
performs an irreversible data operation.

The exact candidate package qualifies only after deterministic contracts,
fixture/grader calibration, disposable GitHub behavior, required provider
conformance, five fresh quick episodes, and ten predeclared mixed-route
episodes satisfy all hard invariants and distribution thresholds. Production
is separately reported, read-only confirmation; it cannot rewrite
qualification.

Qualification stays attached to the prepared candidate commit. A later
release may descend from it only by adding evidence, and only through a
deterministic attestation. The attestation requires the qualified candidate
commit to be present — failing closed when it is absent, as in a shallow CI
checkout — and preserves the candidate's installable-package hash,
executable-eval-suite hash, org fingerprint, and every prepared campaign
hash. It rejects deletes and any unallowlisted change to the packaged
artifact or the sanitized-evidence namespace, and it content-binds each
sanitized promotion file. Non-packaged, non-evidence files — docs other than
the two packed docs, review notes, `.github/` other than the qualification
workflow, and install/build-environment config such as
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, and `tsconfig.json` — are outside
qualification scope and do not invalidate it.

The executable-eval-suite hash deliberately covers more than the eval code:
beyond the `scripts/eval`, `test`, and `eval` trees and the workflow, it
includes the test-runner and grading configs (`vitest.config.ts`,
`vitest.live.config.ts`, `playwright.observe.config.ts`) that decide which
tests run — so a post-qualification edit cannot silently skip the red
contract tests. Contract projections then independently recompute the
qualifier and portable report and verify the archive receipt,
GitHub/idempotence evidence, exact cases and repetitions, hidden-grader
evidence, route admission, terminal integrity, and provider/settlement
agreement. The descendant never becomes a new qualified candidate: it cannot
change source, eval executable bytes, fixtures, graders, campaigns, package
inputs, lockfiles, roles, pipelines, or prompts.

The attestation separates two concerns. Evidence **integrity** — the
attestation is well-formed, bound to its committed campaign, pinned to that
campaign's qualified package/suite hashes, self-consistent, and lists only
allowlisted promotion paths — is deterministic and asserted by the offline
suite (`pnpm test`, `test:transformation`): it stays green whenever the
committed evidence is intact, and a legitimate source change cannot redden
it. Product **currency** — whether the live `npm pack`, executable suite,
org surfaces, on-disk promotion bytes, and git changed-path scope still
match the qualified pin — is recomputed from the working tree and enforced
fail-closed only at the release gate: `eval:attest-release` refuses to mint
for a moved product, `eval:promote` and `eval:release-verify` refuse to
verify one, and a dedicated `release-currency` CI job (release tags and
manual dispatch only) runs `eval:release-verify`. A moved product therefore
cannot be minted, promoted, or released without a new qualification
campaign, while per-commit CI stays honest-green.

## Phase 6 learning-efficacy measurement

The paired-learning proof asks one question: does a governed learning
intervention measurably improve a later comparable episode? For Phase 6 the
intervention is the predeclared T1 procedure at
`eval/treatments/learning-t1-v1.md`, pinned by the candidate campaign's
`learning_treatment.content_sha256`. Only treatment-arm builder context
receives those bytes; the six provider artifacts and their independent
hidden-grader records supply the three AB/BA/AB paired measurements.

The primary metric is an integer artifact-quality score from zero through
eight: grounded error classes, a causal hypothesis, a bounded/reversible
intervention, and measurable guardrails each contribute zero through two
points. Each arm's independent provider review must end in exactly one
`VERDICT: APPROVE` or `VERDICT: REJECT` marker, retained with the reviewer
artifact hash; a rejection is a valid guardrail failure and cannot be
normalized into an approval. A declared or copied verdict is not a
measurement.

The outcome is `improved` only when all three treatment scores strictly
exceed their paired controls and every hidden guardrail passes. Any negative
delta or guardrail failure is `regressed`; nonnegative pairs with any zero
delta are `inconclusive`; missing, mismatched, or infrastructure-corrupt
evidence is `invalid`.

**Candidate qualification and learning activation are decoupled.** A
candidate qualifies on any valid, guardrail-clean, non-regressing
measurement — `improved` and `inconclusive` both satisfy it, while
`regressed` and `invalid` fail it. Strict improvement (`improved`) is
required only for the separately-authorized *activation*: after all pairs
terminate, a token-free preview binds the exact candidate, pair-evidence
hash, reviewer-artifact hashes, and one isolated publish/activate/rollback
action, and executing that action requires its own exact candidate and
action-hash authorization — L5 provider-spend authorization does not cover
it. Learning *capture* (100% eligible capture) remains the operations SLO
for the loop.

## History

Evaluation semantics ratified 2026-07-12 (the baseline cap was amended the
same day from the initial $125 recommendation to $250); organization-wide
operating doctrine 2026-07-13; the Phase 6 scope boundary 2026-07-15; the
attestation integrity/currency split and the learning
qualification/activation decouple 2026-07-17; input tokens retired as an
admission dimension 2026-07-20. This file is the qualification half of what
was `docs/efficiency.md` until the 2026-07-26 topic-folder reorg. Full
decision history: `docs/PURPOSE.md` → Decided.
