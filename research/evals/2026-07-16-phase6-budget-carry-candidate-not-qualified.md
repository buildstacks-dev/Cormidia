# Phase 6 fail-fast budget-carry candidate — retained not-qualified campaign (2026-07-16)

## Permanent disposition

The exact candidate at commit
`d92f7e6bbf113775a41dc8af866d6f72c8b37792` passed adapter and focused
admission, then stopped at the first terminal non-pass in final qualification.
The campaign is permanently retained as not qualified. No attempt is retried,
replaced, relabelled, or used for promotion, and its 19 later repetitions
remain deliberately unrun.

Candidate identity:

- package SHA-256: `26c2e90d95fc71b6e446b93ea2ca926534ae7249feb57c90dab526dfefdc6e55`
- suite SHA-256: `c276d2d7f65ebc225628e8ecea0fa838cacf64f64b27d299ae5a1f6f724508ae`
- release-package SHA-256: `b6eb35f46ff85f2c9aa22c444201f0d2eb65f33b24863481d02d7925aae5c2c0`
- executable-suite SHA-256: `5d9d01cb4fa68035f203f0c532a73509bec281ffeef367f11ac45e444dcb58aa`
- org fingerprint: `062b1374b8bb878f8dec1b13decfb2019ce1ef2cfae66f9191dd4de59160e3d3`
- system fingerprint: `8ad7aee67129d4647302f7cdda143958f1070548142c513ef5daf5d950362afc`

## Admissions

`adapter-harness-calibration-v1-20260716-107b6ba190a4`, campaign SHA-256
`96d966ae9d431c07bd019e5a6564278c44bab44ffea8f19ba4dabbed1f83f5b4`,
qualified without a retry: 20 provider turns = 20 settlements, three
mechanical steps, zero mechanical settlements, and $2.559503 equivalent
product cost. Its deterministic qualification SHA-256 is
`21bb6c5426474398c07bf476a20052a8352e7e2909423ffd693530506189cfa7`,
report SHA-256 is
`75586410d66612b18c5825e9873afb99bd1592adef563e8bd6adb576f07ccd6d`,
and archive-manifest SHA-256 is
`0745c655c6ad4e192fa86f6c40b04ebb16698d9a0788bc8bd4c25ef4ab386775`.

`focused-provider-admission-v1-20260716-107b6ba190a4`, campaign SHA-256
`70b2762769f65eb7b1b32a84e1e2993b320819d92b4201313f0dde6ba4fd8a22`,
qualified migration `mixed-d1` and approval `mixed-da` without a retry. Both
formerly failing reviewer boundaries passed. The campaign contains six
provider turns = six settlements, zero mechanical settlements, $13.56325
product equivalent cost, and $1.554861 evaluator equivalent cost. Its
qualification SHA-256 is
`caab0037b2ce95f97af7c458a9b02b0c6491c3e29a32de89fb5597097ed95182`,
report SHA-256 is
`9db7f165edb1f18ecfb5e55fa4b6431f6ed8fe98e954a8d3ff3626e4b5739ba1`,
and archive-manifest SHA-256 is
`8acaadad82452826d4013c9195989561b4a80e9f4fee6db5fa9f30784743d894`.

Both disposable private GitHub exercises and their identical idempotency
reruns passed. Cleanup was preview-only.

## Final candidate outcome

`candidate-qualification-v1-20260716-107b6ba190a4`, campaign SHA-256
`4d86dbd25e4d2944712322a0a4dfbd1eae0631a4ee1ec145f5ffd8b232469b1f`,
recorded 15 terminal attempts: 14 passed and one `budget_stop`. It used no
retry. Planning was 3/3, context delta was 6/6, and all five clean delivery
episodes passed before `quick/ignore-config/v1::mixed-q1` stopped the
campaign. Accounting is 32 provider turns = 32 settlements, zero mechanical
settlements, $33.0329 product equivalent cost, and $1.6384895 evaluator
equivalent cost.

The read-only outcome is `not_qualified`. Qualification SHA-256 is
`9530a460d6714b9529f6c44ba1ee3ce201c1d0fca0c58d4b8f30167f29d3c4ae`;
report SHA-256 is
`0160477fc93069b7099ec008316ceded819414c240b90939506f640124155a70`.
The private GitHub exercise and identical rerun passed in
`buildstacks-dev/operon-eval-candidate-qualification-v1-20260716-107b6ba190a4`.
The verified sanitized archive is
`/Users/bikram/Build/operon-eval-archives/candidate-qualification-v1-20260716-107b6ba190a4-4d86dbd2-evidence-v2`;
its archive-manifest SHA-256 is
`6446bd18b7bd9d5548ac255abad7c8238cdd1055c3c7706286b63c0c5ee727af`.
Cleanup was preview-only.

## Exact cause and correction

The $8 case ceiling was split into three fixed per-turn caps of
$2.6666666666666665. The contract turn used only $0.582835, but that unused
capacity was not carried forward. The implementation turn was therefore
stopped when its estimated $2.80136 crossed the fixed turn slice, even though
$7.417165 remained under the unchanged case ceiling. Total immutable attempt
cost was only $3.384195. This is a harness allocation defect, not a product,
grader, account, safety, or campaign-ceiling miss.

The correction retains every case and campaign threshold. Each next declared
turn receives only the case capacity that remains after all prior turns.
Unused capacity therefore carries forward without inventing a hidden equal-
slice threshold, while total attempt spend remains bounded by the original
case ceiling. An end-to-end fake
runtime regression uses costs $0.50, $2.80, and $0.40: the second turn exceeds
the old equal slice but the complete $3.70 attempt remains below $8. The
archive allowlist also retains the new immutable `campaign-stop.json`; the
first archive attempt failed closed on that missing class and is preserved as
the reason for this integration repair.

The first focused token-free run passed 31/32 assertions. Its only failure was
an exact test literal of `3.7` versus JavaScript's summed
`3.6999999999999997`; the monetary assertion now uses 12-digit tolerance and
the underlying three-turn settlement/outcome assertions were already green.
The focused rerun passed 32/32. The complete token-free funnel then passed
validation, 282/282 transformation tests, 425/425 deterministic tests, both
shuffled orders at 425/425, and 1,576/1,576 whole-product tests across 184
files. Typecheck, build, isolated onboarding smoke, and package dry-run passed.
Current strict mode retained exactly the nine Phase 6 provider contracts;
future-soak strict retained exactly `I-LIVE-01`; all 282 tests inside each
strict command passed.

Before another full qualification, the new exact candidate must pass adapter
admission and focused admission ordered as quick `mixed-q1`, migration
`mixed-d1`, and approval `mixed-da`. The focused campaign remains
non-promotable and keeps the original $8, $40, and $40 case ceilings. No
threshold, hidden grader, denominator, retry rule, safety boundary, assignment,
or accounting rule was weakened. No production state or outward effect was
mutated, and `I-LIVE-01` remains future-pending.
