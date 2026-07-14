# Current-schema pre-transformation baseline invalidation and repair — 2026-07-13

## Verdict

Campaign `pre-transformation-baseline-v2-20260714-72e5c855d725`, canonical
SHA-256 `0bf48530095422e4297454860eb3e873211be89ce69e9c68e1eaeb8f8df041f2`,
is an immutable **invalid eval-system sample**. Its product evidence remains
useful and must not be rewritten: one attempt passed and four attempts were
honest `product_miss` outcomes. The deep attempt was a `harness_error` before
any provider turn, so the campaign cannot satisfy the T4 replacement-baseline
gate.

The campaign pinned clean detached merged-main commit
`5f14d9c37b3196aa79642ca9c5691f7e20efb2b9`, candidate package SHA-256
`fcb7f5ddab4326c9f11f443ff252a1fcefb2218a410a48ce3529f40c6dc3d741`,
suite SHA-256
`a0020f824e57ce202e9bf902bdf8b79f2a677be3987df01a4291fd5b5b6f2378`,
Codex `gpt-5.5` as high-effort Builder, Claude `claude-opus-4-8` as
high-effort Reviewer, and a $250 equivalent-cost cap.

## Retained lifecycle and accounting

L4 passed twice against the retained private repository
`buildstacks-dev/operon-eval-pre-transformation-baseline` (repository id
`R_kgDOTWcSxw`). The first run created issue #3 and PR #4, pushed commit
`fecf096043e214f460d3f39fe5b2677886607cf3`, recorded comments and a
non-approving review, squash-merged, closed the issue, and deleted the branch.
The second run reverified that remote state and persisted
`github-idempotence-0bf48530.json` bound to the first evidence hash.

All six declared attempts are present:

| Attempt | Outcome | Provider turns | Equivalent cost | Classification |
| --- | --- | ---: | ---: | --- |
| `quick-ignore-config-v1-q1` | `passed` | 3 | $1.378632 | Product pass |
| `quick-ignore-config-v1-q2` | `product_miss` | 2 | $1.164050 | Product behavior |
| `standard-slug-options-v1-s1` | `product_miss` | 2 | $1.422855 | Product behavior |
| `deep-auth-migration-v1-d1` | `harness_error` | 0 | $0 | Eval system |
| `learning-closure-v1-l1` | `product_miss` | 0 | $0 | Product behavior |
| `learning-closure-v1-l2` | `product_miss` | 0 | $0 | Product behavior |

The read-only qualifier reports `invalid`: one pass, four product misses, one
harness error, zero safety/budget/infrastructure stops, and zero missing
attempts. Seven provider turns join to seven exactly-once settlements; three
mechanical steps join to zero provider settlements. Product equivalent cost is
$3.651080 and evaluator equivalent cost is $0.314457, for $3.965537 total.

The portable report SHA-256 is
`08a49dcc5ce6d582b592c546c86e99977f20891b17f9bb77e369294feb179689`.
The 86-file schema-v2 sanitized archive is retained at
`/Users/bikram/Build/operon-eval-archives/pre-transformation-baseline-v2-20260714-72e5c855d725-0bf48530-evidence-v2`.
The cleanup verifier rechecked its full per-file inventory and accepted the
receipt whose archive-manifest SHA-256 is
`1cebf08b1030079e56d5da0730b89121fe22056320fd5c14bd379c2b89233d6d`.
Provider scratch remains structurally excluded.

## Harness root cause and repair

The service seed and all three visible commands pass outside the eval sandbox.
The live app-gate sandbox used `(deny network*)` for every case, including
cases whose reviewed side-effect policy is `loopback_only`. Both `npm test`
and `npm run e2e` start the fixture server on `127.0.0.1`; macOS therefore
returned `listen EPERM` during the pristine pre-provider gate. This is an eval
harness policy mismatch, not an Operon deep-product outcome.

The repair keeps forbidden-network app gates fully network-dark and adds only
specific localhost inbound/outbound allowances for `loopback_only` and
`provider_and_loopback_only` case policies. Service preflight in the L6 runner
uses the same loopback-only gate. No grader, fixture expectation, product code,
or outcome was changed. A real macOS production-path probe now passes the
service test/lint/e2e commands under the loopback profile and rejects the same
e2e command under the forbidden profile.

Because this repair changes eval-harness bytes, the prior adapter admission
snapshot cannot admit a replacement baseline under the content-hash policy.
A fresh adapter campaign and separate fresh baseline campaign must each be
prepared, previewed, and exactly authorized. The invalid campaign above stays
terminal and will never be retried or backfilled.

## Offline verification

The repaired detached tree passed the complete token-free preflight on
2026-07-13:

- `pnpm eval:validate`: 84/84 executable requirements, 56 case links, 14
  cases, 12 benchmark families, 60 fault boundaries, 13 graders, 3
  capabilities, and zero orphans.
- `pnpm test:transformation`: 29 files and 396 tests passed; the contract
  runner reported the exact declared 72 known-red requirements and no other
  failure.
- `pnpm eval:deterministic`: 38 files and 468 tests passed.
- `pnpm test`: 159 files and 1,583 tests passed.
- `pnpm typecheck` and `pnpm build`: passed.
- `pnpm test:transformation:strict`: all 396 executable tests passed and the
  command exited 1 solely because the same 72 known-red contracts remain.

## Replacement-baseline classification defects

Fresh adapter campaign `adapter-harness-calibration-v1-20260714-fb96dfa288e8`
qualified all three provider probes on repaired commit `4a550455` with 20
provider turns, 20 settlements, and $2.3119345 equivalent cost. The first
replacement baseline on those bytes,
`pre-transformation-baseline-v2-20260714-fb96dfa288e8` (SHA-256
`3029995150f03dcd31a0fd0e5b3d5dcfd84504395a5869d14c684fbe123abf65`),
remains another immutable invalid eval-system sample. Its product evidence is
two quick passes and three honest product misses. The deep attempt completed
two provider turns but a rejected async hidden-grader promise escaped its
wrapper because the deep branch returned rather than awaited it, misclassifying
a missing product export as `harness_error` instead of `product_miss`.

Archiving that terminal sample also failed closed before copying bytes because
an isolated actor-worktree source file contained a secret-like assignment.
The archive policy previously attempted to copy cache-free actor worktrees
verbatim, despite those trees being untrusted output. The follow-up repair
awaits the deep grader and upgrades sanitized evidence so canonical secret
matches in actor-worktree files are redacted in the external copy while exact
source hashes and archived-byte hashes are both retained. Secret matches in
durable results, state, reports, or control evidence continue to fail closed.
No grader, reference, mutant, fixture expectation, or product implementation
was changed.

The replacement campaign's L4 lifecycle passed twice in the retained private
repository: issue #5 and PR #6 were created, commented, non-approvingly
reviewed, squash-merged, closed, branch-cleaned, and then reverified
idempotently. Its six terminal attempts contain two passes, three product
misses, and the one misclassified deep harness error. Ten provider turns join
to ten settlements; two mechanical steps join to zero provider settlements.
Product equivalent cost is $8.137450 and evaluator equivalent cost is
$0.765008, for $8.902458 total.

The portable invalid-sample report SHA-256 is
`99d501ac085cea67fbb789aa95a8125a096fb4c19886c8fc1ead381b28594f25`.
After the archive-policy repair, the actual campaign produced a 109-file
schema-v2 sanitized archive at
`/Users/bikram/Build/operon-eval-archives/pre-transformation-baseline-v2-20260714-fb96dfa288e8-30299951-evidence-v2`;
its archive-manifest SHA-256 is
`c70a51bc2f685120bdf48b9f35fe9bbffe683825873cf1ce232ee254e4981280`.
Cleanup preview revalidated that receipt without deleting local evidence, and
the upgraded verifier also continued to accept the prior schema-v2
`sanitized-evidence/v1` adapter archive.

The second repair passed the full token-free preflight: `eval:validate`
reported 84/84 executable requirements, 56 case links, 14 cases, 12 benchmark
families, 60 fault boundaries, 13 graders, 3 capabilities, and zero orphans;
`test:transformation` passed 29 files/396 tests; `eval:deterministic` passed 38
files/468 tests; the complete suite passed 159 files/1,583 tests; typecheck and
build passed. The strict gate ran all 396 tests successfully and exited 1 only
for the exact same 72 declared known-red production contracts.
