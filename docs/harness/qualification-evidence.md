# Harness qualification evidence

*Dated campaign archaeology for the live contract in
[`capability-matrix.md`](capability-matrix.md): which adapter calibrations
qualified, which are intentionally invalid, and what each retained ledger
proves. Promotion campaigns append here; the matrix itself never restates
evidence.*

Provider capability claims are campaign inputs, not inferred successes. An
efficiency campaign pins the runtime/model/effort and capability reference,
records cache and usage quality exactly as observed, and treats unsupported or
unobservable fields as unavailable rather than zero. Missing required auth or
usage makes the campaign incomplete/invalid.

The 2026-07-12 baseline non-billable probe confirmed Claude Max first-party
authentication and a ChatGPT Pro Codex account. Its dollar values are
equivalent-cost indicators because both turns used subscriptions. Codex usage
remained `estimated`; Claude usage remained provider-complete. The dated result
is `research/evals/2026-07-12-pre-transformation-baseline.md`.

The retained 2026-07-13 adapter campaigns
`adapter-harness-calibration-v1-20260713-524ab18c52d8` and
`adapter-harness-calibration-v1-20260713-dd84b826242c` are intentionally
invalid. The first preserved 20 ledger settlements and $5.118445 while its
attempt summaries were incomplete or misleading. The exactly authorized
post-repair run preserved six settlements and $1.55126, then exposed
metadata-only readiness, dropped Codex hook-trust activation, and an
undersized continuation cap. Both repair rounds are covered offline and
documented in `research/evals/2026-07-13-adapter-calibration-repair.md`; none of
the repaired claims was qualified at that stage. The final content-hashed
campaign below supplies that proof.

The later prepared and authorized campaigns
`adapter-harness-calibration-v1-20260713-0fdc5399d224` and
`adapter-harness-calibration-v1-20260713-d11efc466a7f` were invalidated before
any GitHub mutation or provider turn. Comparing the same Claude CLI inside and
outside the execution sandbox showed that the host was authenticated all
along; the restricted process could not access Keychain, and the original
provider scratch also replaced the HOME/config context that selects the
Keychain credential. Both manifests spent zero and are not calibration
evidence.

The auth-correct campaign
`adapter-harness-calibration-v1-20260713-473eb4f39381` proved that Claude could
authenticate and execute a tool under the repaired boundary, but remained
invalid overall. Its token-dense 300 KB transport filler caused Claude and
Codex budget stops; pi returned the same external third-party-extra-usage HTTP
400 on both its primary and declared retry. Seven settlements reconciled at
$5.47642. The transport probe now keeps the byte-size proof with whitespace
padding. For the fresh calibration, the operator switched pi to its existing
`openai-codex/gpt-5.5` OAuth route; the explicit provider prefix avoids an
ambiguous bare-model lookup in pi's multi-provider registry. The terminal
campaign is evidence, never a rerun target.

The fresh pi-over-Codex campaign
`adapter-harness-calibration-v1-20260713-d5992688efa1` passed pi's complete
applicable calibration surface, but was invalid overall. Claude continuation
exposed the harness contradiction between a resume claim and
`persistSession: false`; Codex exposed that a 1.5-second cancellation fallback
could precede its first usage checkpoint. The latter is now 20 seconds and an
executor double-count of invalid-attempt cost is repaired. The retained ledger
has 24 exactly-once settlements and $3.06913525 equivalent cost. A fresh
campaign still required an explicit safe storage choice for Claude's
Keychain-authenticated resumable transcript. The harness subsequently enabled
bounded persistence only for the declared calibration profile and exact SDK
session cleanup, without extracting a Keychain credential.

Campaign `adapter-harness-calibration-v1-20260713-72690b61e12b` then passed the
Codex and pi surfaces and proved Claude transport, gate, continuation, and
cancellation behavior, but an undersized Claude role-shaping allocation made
the overall result a validly recorded `budget_stop`, not a qualified campaign.
That allocation and the L4 idempotence receipt were repaired without rewriting
the terminal evidence.

The final content-hashed campaign
`adapter-harness-calibration-v1-20260713-9c3b336d6842` qualified all declared
adapter claims. Claude, Codex, and pi passed without retry; L4 passed twice with
a durable idempotence receipt; and L5 retained 20 provider turns, 20
exactly-once settlements, three real mechanical permission-boundary proofs,
and $2.26656275 total equivalent cost. Claude continuation and native role
shaping passed, and all six exact SDK sessions were deleted after grading. This
qualifies adapter admission for the content-hashed snapshot. It does not
qualify the broader product, the replacement baseline, candidate evaluation,
or L6 soak.

Phase 6 changes covered harness, grader, candidate-hash, safety, and package
bytes, so every retained historical calibration remains evidence but cannot
admit the new candidate by resemblance. A fresh adapter campaign must be
prepared and separately authorized for the exact candidate. Its preview pins
the candidate, package/suite identities, org/system fingerprints, assignments,
turn ceiling, retry rule, stop rules, and private GitHub target; missing
readiness or an unavailable required model remains incomplete/invalid rather
than a skip.

The scope-split exact-candidate adapter run later qualified Claude, Codex, and
pi with 20 turns equal to 20 settlements, but its dependent candidate was
invalid and therefore changes to covered executor bytes require another fresh
admission. It remains historical evidence only; exact identity, accounting,
and archive hashes are in
`research/evals/2026-07-15-phase6-scope-split-candidate-invalid.md`.

The final candidate campaign
`candidate-qualification-v1-20260716-9ccc03a2c582` qualified Claude, Codex,
and pi execution, including pi on `openai-codex/gpt-5.6-sol`, with 73 provider
turns equal to 73 settlements. Its bound standing-role results promote
`I-ROLE-01..03`; the five D/E provider contracts and `G-MET-01` are promoted
from their own mapped cases. `I-LIVE-01` remains the sole pending
`future_soak` contract and cannot be inferred from this campaign, virtual soak,
or read-only production evidence. The canonical distinction is
[`docs/qualification/design.md`](../qualification/design.md#phase-6-qualification-scope).

The authorized 2026-08-04 replacement-harness campaign
`cormidia-maintenance-l3-ec60cd33e7c7` is retained **failed evidence**, not a
qualification. It collected all six required L3 cases in six provider turns
and $0.7284 equivalent spend, then reported four deterministic violations:
Codex CLI 0.144.4 exposed code-mode `exec` outside the Bash-only hook matcher
(#271), the real-GitHub stale-review fence trusted a lagging PR projection
(#272), the label-filtered issue search was sampled without the suite's
readback tolerance (#273), and the Vitest process failed to reflect the
durable failing verdict (#274). The immutable report SHA-256 is
`709739891a8baf05a9cd2a48666ad8bd8c0b36bf19462e060ea3fbccb7bfbc48`.
The report and sandbox are preserved; neither can qualify any repaired
successor candidate.
