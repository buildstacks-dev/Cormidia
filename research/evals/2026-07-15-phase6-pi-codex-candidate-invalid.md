# Phase 6 pi-on-Codex qualification — retained adapter pass and invalid candidate (2026-07-15)

## Disposition

The exact-candidate adapter campaign
`adapter-harness-calibration-v1-20260715-6ed3b4ac8b87`, SHA-256
`74e1260fa224b165b10a9c4a26e016de2efcdb9af86fc7d311fef00775ccda9b`,
is permanently retained as `qualified`. The dependent candidate campaign
`candidate-qualification-v1-20260715-6ed3b4ac8b87`, SHA-256
`f871bb3bdc4530ff5c44e0cba094160c91be5a8890cbfd880a980bd676a6968d`,
is permanently retained as `invalid`. Neither campaign is retried or
overwritten, and the invalid candidate evidence cannot promote a contract.

Both campaigns bind candidate commit
`90ed219c505b217a13997ae10e0b00ced6f26b4a`, package SHA-256
`6a09d0afe206ee643a4c3861373e87c6864d95034b43b556cd9c2fd8abc1cc2f`,
suite SHA-256
`de7d723ee79b5d805cd99b01bfd5cf4eab389eefaa9f2bb09483b9356f301c3f`,
org fingerprint
`062b1374b8bb878f8dec1b13decfb2019ce1ef2cfae66f9191dd4de59160e3d3`,
and system fingerprint
`8ad7aee67129d4647302f7cdda143958f1070548142c513ef5daf5d950362afc`.
The installable release-package SHA-256 is
`ee530c9c6254ecc7b987aa4df94187a8bba4b32beaf5f315fa69028f51059f75`
and the executable-suite SHA-256 is
`c0c8137e75d63cea742a4c767db4f4698182bebfe3951af9eb936581f8ee93a7`.

## Qualified adapter admission

Claude Opus 4.8 through Claude, GPT-5.6-sol through Codex, and
`openai-codex/gpt-5.6-sol` through pi all passed at low effort without a
retry. The three results contain 20 provider turns, 20 ordinary settlements,
three mechanical steps, zero mechanical settlements, exact terminal
integrity, and $2.5776245 equivalent product cost. The read-only qualifier
returned `qualified` with three passes and no product, infrastructure,
harness, safety, budget, missing-attempt, or retry result.

The private GitHub exercise retained issue 1 and pull request 2 in
`buildstacks-dev/operon-eval-adapter-harness-calibration-v1-20260715-6ed3b4ac8b87`.
The identical second execution reused the first evidence and created no
duplicate remote state. Source evidence SHA-256 is
`2b8e4f507b11725a25bc357739c4ae78cb7fa56ceb43cc4615323d2395f26fff`;
the idempotence evidence SHA-256 is
`c898014e7264dd0f1abdd6cf82edc2b1df104738c915eac43adc9f9a7cf9e3e0`.

The report SHA-256 is
`f2e07d303740bad04b0acd35e7d9a15d53768f1cb48be22862cc7b2b6fd3354c`
and the immutable qualification JSON SHA-256 is
`1ecc7356eba3b7483295f9184ad2a6a387ed48d75055d22024af2c90fb3b0c7c`.
Both reproduced byte-for-byte. The verified 91-file
`sanitized-evidence/v3` archive is retained at
`/Users/bikram/Build/operon-eval-archives/adapter-harness-calibration-v1-20260715-6ed3b4ac8b87/adapter-harness-calibration-v1-20260715-6ed3b4ac8b87-74e1260f-evidence-v2`;
its archive-manifest SHA-256 is
`2afa159505bb86494d3edf0d44eb6d55ca0df08f39f01f42be5305c8e12538a5`.
The separately retained local archive-receipt SHA-256 is
`f795f77435c7fdb110f00785c33474e2ad0d10e3df081a1a0f96288b3f0101e9`.
Cleanup was previewed only.

## Candidate result and accounting

The candidate GitHub exercise retained issue 1 and pull request 2 in
`buildstacks-dev/operon-eval-candidate-qualification-v1-20260715-6ed3b4ac8b87`.
Its identical rerun reused source evidence SHA-256
`9ec8217e84c41af6489301768d976c8cf60db4f6e529ae636aef9ae8465fbb46`;
the idempotence evidence SHA-256 is
`61bfd42e274774de2f55ea060a168ed1a6af6cec288ec0d959562bc162be4043`.

The immutable candidate qualifier reports 34 terminal attempts: 24 passed,
two genuine `product_miss`, two `infra_invalid`, and six `harness_error`.
There were no safety stops, budget stops, retries, or unrun declared attempts.
All 59 provider turns reconcile to 59 ordinary settlements. The 2,022
mechanical steps created zero mechanical settlements. Product equivalent
cost is $63.216598 and independent evaluator equivalent cost is $4.1084805.
No attempt reports an outward effect, hidden-answer leakage, or production
path overlap.

The five clean quick episodes passed on the quick route in three turns each,
at $1.4762265–$2.2464645, with zero human decisions. In the mixed block, both
quick episodes, all three standard episodes, and the approval-semantics
episode passed; both deep episodes were product misses and both continuation
episodes were infrastructure-invalid. All observed routes remained their
original admitted route. Planning quality passed at quick, standard, and deep;
all six Claude, Codex, and pi context-delta repetitions passed; the seven-day
virtual soak passed mechanically; and the SRE, Support, and Marketing
provider repetitions passed with draft-only artifacts and zero outward
effects. The approval case passed with zero human decisions.

The six declared learning arms never constructed a provider. Each stopped at
the pristine visible gate, so all three pairs are invalid and no treatment
score, control score, hidden-guardrail result, action hash, activation, or
rollback evidence exists. Learning activation is therefore forbidden.

## Retained failures and corrections

Both deep actors implemented working local code and their ordinary checks
passed, but each changed a release-owned `package.json` script definition.
The content-bound app gate correctly rejected that drift, so both outcomes
remain genuine product misses. The corrected actor-visible deep task now
states that existing script definitions remain byte-for-byte unchanged and
that new tests must use the current test discovery. The pinned-script gate,
hidden grader, thresholds, route budgets, model assignments, and oracles are
unchanged; an adversarial task-contract test preserves the constraint.

Both continuation episodes performed a cancellation turn and a completed
recovery turn, and all four provider turns settled exactly once. The Codex
adapter first emits a session-only progress event and only later emits usage.
The harness cancelled on that session-only event, so the cancelled turns had
unavailable token/cost quality. Both attempts correctly remain invalid with
the exact missing cost-quality and input/output/quality denominators. The
corrected harness ignores session-only progress and injects cancellation only
after a usage-bearing progress event. If no such event occurs, continuation
fails closed as `continuation_not_recovered`; unavailable usage remains
invalid and is never coerced to zero. Focused tests retain all three paths.

The learning case declared network `forbidden`, but its pristine `npm test`
also discovered a loopback HTTP test. macOS correctly denied that socket, so
the harness rejected all six arms before provider construction. The corrected
case keeps network fully forbidden and runs the seed's focused non-network
test as its visible gate. The command passes inside the real macOS deny-network
sandbox, and a structural regression test prevents the broad loopback-bearing
script from returning to this no-network case.

These corrections change covered evaluator, task, case, and test bytes. The
qualified adapter admission above remains valid historical evidence for its
exact candidate but cannot admit the corrected descendant. Fresh adapter and
candidate identities require new immutable previews and separate exact
authorizations.

## Retained staged-admission infrastructure attempt

The first final staged-candidate rerun at 07:21:44 launched the transformation,
deterministic, nightly, and complete test suites concurrently. That operator
orchestration saturated the host: the transformation run retained eight
five-second test timeouts (253/261 passed), the complete run retained eighteen
timeouts (1,536/1,554 passed), and the first nightly order retained one timeout
(403/404 passed). The deterministic run likewise exited non-zero only on
fixed-timeout subprocess and filesystem-heavy cases. The failures included
candidate-drift, GitHub-drift, adapter-retry, doctrine CLI, lifecycle,
contract-evidence, provider-workflow, and virtual-soak checks; none reported a
merit assertion failure.

This infrastructure attempt remains part of the operator execution record and
is not relabelled green. The cause is corrected by executing the declared
heavyweight commands sequentially. No test timeout, threshold, grader,
denominator, model assignment, or safety rule is changed.

## Qualifier, archive, and continuation boundary

The candidate report SHA-256 is
`65ef79e22cc1b8a04eb0a19a29568207c94af73a1e4320861f77aae889045cd8`
and the immutable qualification JSON SHA-256 is
`17759889102ac60a84ff41101bec4a3121aa00811ad5d3b6f8e87796c4a96565`.
Both reproduced byte-for-byte. The verified 607-file
`sanitized-evidence/v3` archive is permanently retained at
`/Users/bikram/Build/operon-eval-archives/candidate-qualification-v1-20260715-6ed3b4ac8b87/candidate-qualification-v1-20260715-6ed3b4ac8b87-f871bb3b-evidence-v2`;
its archive-manifest SHA-256 is
`359bb801d29d99884c71bb8ac174e0ad8605193293b2cd97716520c72a90f052`.
The separately retained local archive-receipt SHA-256 is
`12496eb0e0947a1abe7bd558c83590448d259a1a53218a21eaf43591554bd645`.
The manifest excludes `provider-scratch/**` and raw L3 `state/runs/**`.
Cleanup was previewed only and was not executed.

No contract is promoted from this invalid campaign. At the time of this
retained run, the exact ten post-Phase-5 contracts remained known-red under one
strict view. The later 2026-07-15 ratified scope decision does not rewrite that
evidence: the nine non-soak provider contracts are now the current Phase 6
known-red set, while `I-LIVE-01` alone remains known-red in `future_soak` and
still requires the separate authorized 48-hour real-time campaign. No
production confirmation, scheduler installation, production mutation,
deployment, publication, message, learning activation, or real-time soak
occurred. Production evidence cannot repair or rewrite this sandbox outcome.

## Ratified continuation boundary

The corrected descendant must first qualify fresh exact-candidate adapter and
candidate campaigns. A qualified candidate may promote only `D-LIVE-01..03`,
`E-LIVE-01..02`, `G-MET-01`, and `I-ROLE-01..03`; current strict must then be
green. `I-LIVE-01` is neither passed nor current Phase 6 debt, and future-soak
strict must remain red for exactly that contract. The genuine future campaign
keeps every original 48-hour cadence, restart, safety, accounting, and evidence
requirement. Preview, deterministic virtual-soak evidence, manufactured
evidence, or bounded read-only production confirmation cannot promote it.
Phase 6 may ship with the future soak pending, but Operon may not claim to be a
fully proven “highly efficient organization” until that campaign passes. The
canonical boundary is
[`docs/efficiency.md`](../../docs/efficiency.md#phase-6-qualification-scope).
