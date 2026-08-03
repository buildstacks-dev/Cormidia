# Phase 6 Codex shell-wrapper candidate — retained terminal miss (2026-07-16)

## Permanent disposition

Candidate commit `12bb14d304fae9d8e67350fd534acf5d3033c61b` passed its
exact-candidate adapter and focused admissions, but full campaign
`candidate-qualification-v1-20260716-c309f15ecafc`, campaign SHA-256
`ac3317bf5877df9cc56c1021e7ada81f5ed78e26ae2f37b70515a2559047007f`,
is permanently not qualified. Its terminal `product_miss` is not retried,
relabelled, rescored, or used for promotion. Cleanup was preview-only.

Candidate identity:

- package SHA-256: `ac4248ae236532dd530749d80e267ab00d1659d30d09c02519c09718391c3db9`;
- suite SHA-256: `a25fb58fb37410eb9590cce6c0152aeed0d601a04b6fa461090fcb7d8dc6d4d8`;
- release-package SHA-256: `113e7adbbe714bd35fa5239c7b5db7a7baf4c08dcaf6ce649c3eb59668c3ad1b`;
- executable-suite SHA-256: `4a6687d335dd59c0eb3a155e864a6963f3586821629584f208c36d6dea9424d5`;
- org fingerprint: `062b1374b8bb878f8dec1b13decfb2019ce1ef2cfae66f9191dd4de59160e3d3`;
- system fingerprint: `8ad7aee67129d4647302f7cdda143958f1070548142c513ef5daf5d950362afc`.

## Exact-candidate admissions

Adapter campaign `adapter-harness-calibration-v1-20260716-c309f15ecafc`,
campaign SHA-256
`3d128ae45d1284248850d5205b90b03c78b274fac81751e141f27324bd3cfbaf`,
qualified without retry. Its private GitHub exercise and identical rerun
passed. It contains 20 provider turns and 20 settlements, three mechanical
steps, zero mechanical settlements, and `$2.7172295` product equivalent cost.
Qualification SHA-256 is
`b66e5a966bc3c432dba025cededdf58a2f6bf96d686351d322f833a0b9c83f2b`;
report SHA-256 is
`f8760f4430591659bc7471c9b92aad51d548819ba6d360b7ca1ebe019e16db1e`;
archive-manifest SHA-256 is
`e9c2de9d0af43ae3af4b0ee4791b336b8ada51ae772f983bc8938ce527067acf`.

Focused campaign `focused-provider-admission-v1-20260716-c309f15ecafc`,
campaign SHA-256
`1873e4b88c38d42f598236b190b9bd772ebc621b6550269d2afa6acbef144796`,
qualified quick, deep, approval, SRE, Support, and Marketing without retry.
It contains 12 provider turns and 12 settlements, zero mechanical
settlements, `$18.185424` product equivalent cost, and `$1.490189` evaluator
equivalent cost. Qualification SHA-256 is
`b3d83945a97a92b6f1a891eb8d6dfe2c686195465672b3825b7eb24a7a2d2b15`;
report SHA-256 is
`ae1afa170f2d6474e3faeee24fb717107e2fd905b0f325a5430fd96ccffa9c24`;
archive-manifest SHA-256 is
`55bb48ec1bb8b866818ae9943b810749d166061f7476720f812d1bceeecfaff7`.

Both admission cleanups were preview-only. The pi assignment remained
`openai-codex/gpt-5.6-sol`.

## Full-candidate outcome and accounting

The private GitHub exercise and its identical idempotence rerun passed. The
provider campaign then completed 20 terminal cases: 19 passed and
`deep/auth-migration/v1::mixed-d1` ended in a genuine `product_miss`. The
declared fail-fast boundary left every later case unrun. No merit retry or
typed infrastructure retry was used; there was no safety stop, budget stop,
infrastructure-invalid result, harness error, missing usage, provider
settlement gap, production overlap, hidden-answer leakage, or outward effect.

The retained attempts contain 47 provider turns and 47 settlements, zero
mechanical steps and zero mechanical settlements, `$56.0992065` product
equivalent cost, and `$3.699033` evaluator equivalent cost. The full campaign
therefore adds `$59.7982395`. Including the conservative `$40` unavailable-
usage reservation, cumulative lineage use becomes `$997.209058` against the
ratified `$2000` ceiling.

The read-only qualifier reproduced byte-for-byte. Qualification SHA-256 is
`9da3c564850d1992478681cfcd50b8f9fff1879a95279d9debbd9b9717762553`;
report SHA-256 is
`8a5e951ca389eb5d255cc1e4d90668ed9b9f26de14f9fde53abb9176e4a69cf3`.
The 350-file `sanitized-evidence/v3` archive is retained at
`/Users/bikram/Build/cormidia-eval-archives/candidate-qualification-v1-20260716-c309f15ecafc-ac3317bf-evidence-v2`;
its archive-manifest SHA-256 is
`0095b69c5c16a7b1bfb50aa23f926f700ce80946cfcaa278c54a807526bb4977`.
The local archive-receipt SHA-256 is
`8994e85fe837d7a87ec17562a56ce77d84423082726f3702cfae657ac7560028`.

## Genuine cause

The implementation provider attempted each declared executable check, but
Codex App Server rejected every one before process startup with the exact
result `exec command rejected by user`. Read-only shell inspection remained
available. The provider consequently completed with truthful
`verification_pending` evidence. The harness-owned visible gate later ran the
unchanged `npm test` itself and found 9 passing tests plus one failure: a
provider-authored SQLite validation test invoked a registered function with
the wrong arity, so SQLite raised `wrong number of arguments to function
api_key_fingerprint()` before the intended `invalid API-key fingerprints`
guard. The visible and hidden gates correctly remained red.

The in-process Cormidia gate classifies raw `npm test` as routine and allowed.
The rejection instead came from the approval callback representation. Codex
App Server 0.144.4 wraps an untrusted command as `/bin/zsh -lc 'npm test'`.
`makeEvalActorGate` scanned the absolute transport launcher `/bin/zsh` as if
it were an actor-selected file target outside the eval worktree and flat-
denied it. Auto-trusted read commands did not traverse that approval callback,
which explains the apparently selective failure.

## Corrected descendant

The correction normalizes only an exact leading `/bin/{bash,dash,ksh,sh,zsh}`
approval transport launcher before actor-path analysis. It retains the full
inner command. Deterministic tests preserve the exact
`/bin/zsh -lc 'npm test'` regression and adversarial near-misses for an inner
absolute `/etc/passwd` path, parent traversal, and the exact forbidden verifier
root. The regression proves the declared local check can start; every near-
miss remains a flat non-escalating denial. The sandbox, gate classifier,
forbidden roots, hidden grader, visible commands, model assignments, effort,
case ceilings, thresholds, retry rule, accounting, and fail-fast policy are
unchanged.

The failed candidate remains immutable. Any new full qualification must first
pass the complete token-free sequence and fresh exact-candidate adapter and
focused admissions under a newly committed candidate identity.

## Repaired-descendant token-free admission

The shell-wrapper normalization, exact regression, adversarial near-misses,
security-boundary documentation, and permanent failure handoff passed the
complete pre-provider sequence in order:

- `pnpm eval:validate`: 84 requirements and 84 executable evidence links;
- `pnpm test:transformation`: 35 files and 286 tests passed, retaining the
  exact ten pre-provider known-red contracts;
- `pnpm eval:deterministic`: 56 files and 429 tests passed;
- `pnpm eval:deterministic:nightly`: both declared shuffle seeds passed the
  same 56 files and 429 tests independently;
- `pnpm test`: 185 files and 1,580 tests passed;
- `pnpm typecheck`, `pnpm build`, and `pnpm smoke:onboarding`: passed;
- `npm pack --dry-run`: passed with 208 files, a 557.3 kB package, and a
  2.1 MB unpacked package;
- current strict: every one of the 286 tests passed and the command exited one
  only for `D-LIVE-01..03`, `E-LIVE-01..02`, `G-MET-01`, and
  `I-ROLE-01..03`;
- future-soak strict: every one of the 286 tests passed and the command exited
  one only for `I-LIVE-01`.

There was no unexpected first failure and therefore no rerun-to-green. No
provider campaign ran during this repaired-descendant admission.

## Retained operational first failures

- The first live launch command used inline shell assignments whose values
  were expanded before assignment. The CLI received empty campaign, ID, and
  authorization arguments and exited at usage validation before a provider
  process or campaign attempt started. Host exclusivity was rechecked before
  the literal-bound launch.
- The first read-only qualifier wrote its stable JSON and HTML, but a stdout
  `jq` summary saw pnpm's command-echo line and failed to parse it as JSON.
  Direct artifact verification and the second qualifier invocation proved
  identical bytes; no evidence was regenerated or changed.
- The first post-archive receipt hash used the obsolete
  `archive-receipt.json` filename. The missing-path failure stopped the chained
  cleanup preview. The actual content-bound
  `archive-receipt-v2-ac3317bf.json` was then hashed and cleanup was previewed
  separately. No cleanup execution occurred.

No production mutation, scheduler installation, deployment, publication,
customer communication, learning activation, or real-time soak occurred.
No contract was promoted; `I-LIVE-01` remains future-pending.
