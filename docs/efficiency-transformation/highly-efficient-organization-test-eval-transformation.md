# Operon Highly Efficient Organization Test and Evaluation Transformation

| Field | Value |
| --- | --- |
| Status | T0–T5 readiness and production Phases 1–5 complete; corrected exact-candidate Phase 6 evidence is pending, and `I-LIVE-01` is a separately deferred future campaign |
| Evidence date | 2026-07-15 |
| Source charter | `docs/efficiency-transformation/highly-efficient-organization-transformation.md` |
| Primary implementation repo | `/Users/bikram/Build/Operon` |
| Production evidence only | `/Users/bikram/Build/Bikram-Org`, `/Users/bikram/Build/buildstacks.dev` |
| Intended order | Implement this suite before transformation production code |

## New-session mandate

Use this document to build the test and evaluation system for Operon's highly
efficient organization transformation. Do not implement the transformation
features while building the suite. The suite must first establish observable
contracts, isolated fixtures, trusted graders, an honest known-red baseline,
and a provider-backed baseline report.

The source transformation charter remains the product vision. This companion
reviews it from a verification perspective and makes its claims executable.
Where this document identifies a contradiction or measurement ambiguity, do
not silently choose an interpretation in code. Ratify the proposed resolution
in Phase T0, then keep one canonical definition.

The test suite may spend real model tokens only in explicitly enabled eval
campaigns. It must never use the active production org, its state home, a
production app checkout, or production GitHub work as an eval target.

## Current implementation and handoff status

This section is the authoritative continuation point for a new session. It
supersedes the original start-from-T0 instructions in §17–§18 wherever they
describe work that is now complete. The overall test-suite readiness gate is
**complete**. The current-schema adapter calibration is qualified, and the
retained pre-transformation provider baseline exercises the complete evidence
lifecycle while honestly returning a product verdict of `not_qualified`.
This is permission to begin the separately reviewed transformation
implementation, not a product qualification result.

### Ratified Phase 6 scope

The 2026-07-15 decision separates current Phase 6 qualification from the
future real-time soak without weakening either. The complete 84-contract
inventory has 83 `current` contracts and exactly one `future_soak` contract,
`I-LIVE-01`. Current Phase 6 may finish after the unchanged candidate matrix,
nine valid promotions, read-only production confirmation, CI, release
equivalence, and shipping. `I-LIVE-01` remains required and known-red until a
genuine separately authorized 48–72 hour campaign passes; preview, virtual
soak, manufactured evidence, and production confirmation cannot promote it.
The broader fully proven “highly efficient organization” claim remains
reserved until then. The sole normative boundary is
[`docs/efficiency.md`](../efficiency.md#phase-6-qualification-scope); older
handoff text below is historical where it grouped all ten contracts into one
Phase 6 gate.

### Completed locally

| Phase | Status | Evidence |
| --- | --- | --- |
| T0 | Complete | TE-01 through TE-08 are ratified in `docs/PURPOSE.md`, `docs/efficiency.md`, and `docs/efficiency-transformation/t0-eval-ratification-proposal.md`; all five A contracts are required and green. |
| T1 | Complete | `EvalWorld`, schemas, immutable campaign/result writes, candidate drift guards, production/provider tripwires, qualification, archive, and cleanup paths are executable. |
| T2 | Complete | Sparse/library/service fixtures, content-addressed seeds, 13 hidden graders, references/mutants, corpora, operator fixtures, and three adapter capability declarations validate. |
| T3 | Complete | All 84 A–J requirements have real executable evidence; 14 cases cover all 12 §9.1 benchmark families; all 60 §7.5 fault boundaries execute; deterministic lifecycle, continuation, standing-role, learning, and seven-day virtual-soak harnesses are operational. |
| T4 adapter admission | Complete | Campaign `adapter-harness-calibration-v1-20260714-e52bf4335e81` (SHA-256 `e10fdc628aedf937949f28451fc0ca7d91f38af66cfdbcc3a060cb3873f9f0b1`) qualified Claude, Codex, and pi with 20/20 exactly-once settlements, three mechanical permission-boundary proofs, and $2.158391 equivalent cost. |
| T4 provider baseline | Complete | Campaign `pre-transformation-baseline-v2-20260714-e52bf4335e81` (SHA-256 `5bddc84c58683e69167c0afbbf1b93de893d0d4032432da52991678f1579458f`) retained all six attempts, returned one pass and five honest `product_miss` outcomes, reconciled 9/9 provider settlements, and produced zero harness, infrastructure, safety, budget, or missing-attempt failures. |
| T5 implementation and gate | Complete | Package scripts, PR/nightly/manual-release wiring, reporting, L6 preview/execute boundary, archive/cleanup, runbooks, Agent Skill, and `AGENTS.md` expectations execute. A fresh operator can run the token-free suite, preview external boundaries without spend, and reproduce the final baseline qualifier/report from its stored prepared manifest. |
| Production Phase 1 | Complete | Durable route admission, terminal provider/mechanical execution-step evidence, exactly-once settlement/reconciliation, efficiency reporting, context-manifest foundations, and settlement properties promote B, E-CTX-01/02, and F-SET-01/02/03. |
| Production Phase 2 | Complete | Additive archived org upgrade, normalized answer recovery, typed reset remediation, immutable-checkout onboarding, deterministic clone convergence, token-free verification, and journaled promotion pass `LIFE-LEGACY-001` plus every lifecycle fault/security/isolation contract. C-LIFE-01–04 are required. |
| Production Phase 3 | Complete | Factor-backed routes, context budgets/deltas, token-free preflight, durable execution journals, bounded repair, semantic approvals, denial recurrence, and reset-abandonment closure are executable. |
| Production Phase 4 | Complete | Typed trusted efficiency evidence, exactly-once repairable capture, app/role recurrence, explainable dispositions, declared efficacy, governed sandbox activation/rollback, and independent learning-health dimensions promote all ten H contracts without a provider campaign. |
| Production Phase 5 | Complete | Scheduler lifecycle/status, exact-once dispatch evidence, deterministic standing-role paths, and the seven-day production virtual soak promote the five deterministic I contracts without host scheduler mutation or provider work. |
| Phase 6 local hardening | Complete before external execution | Exact package/suite identity and evidence-only release attestation, immutable qualification JSON, sanitized archive import, adversarial contract promotion, provider-path grader/accounting evidence, production route admission, content-hashed treatment-only paired learning with a separately authorized candidate/action-bound activation, independent standing-role verification, L6 reconciliation, and unconditional strict release CI are implemented and token-free tested. No contract is promoted without matching authorized evidence. |

The L6 real-time soak path is implemented and tested as an explicitly
authorized 48–72 hour boundary. It has not been executed and is not authorized
by the work recorded here.

The historical adapter admission remains retained evidence, but Phase 6
changes covered harness, grader, evaluator, candidate-hash, and package bytes.
The first authorized fresh campaign,
`adapter-harness-calibration-v1-20260715-00530744c9ae`, qualified all three
adapters with 20/20 settlements and $2.378309 equivalent cost. Archive
verification then found that the claimed sanitized archive contained raw L3
`state/runs/**` prompts, outputs, and session logs. The campaign and invalid
archive remain retained and cleanup was not executed. The corrected
`sanitized-evidence/v3` policy structurally excludes both `provider-scratch/**`
and `state/runs/**`; because this correction changes covered suite bytes, final
adapter admission requires a fresh prepared identity and authorization. The
same applies independently to candidate GitHub/provider execution and the
future L6 GitHub/soak boundaries. Until fresh candidate evidence qualifies and
its schema-v2 archive is imported and verified, the exact nine current-scope
provider contracts remain known-red. `I-LIVE-01` separately remains known-red
in `future_soak` until its own genuine terminal campaign qualifies.

A subsequent safely archived adapter campaign,
`adapter-harness-calibration-v1-20260715-ac31a40c7d61` (SHA-256
`b72ef578cd98bda30acc6e84923a3f36fcab563d85038ac9c10a51831efbe7df`),
qualified Claude, Codex, and pi with 20/20 settlements, zero mechanical
settlements, $2.36184225 equivalent cost, and a verified
`sanitized-evidence/v3` archive. The separately authorized candidate campaign
`candidate-qualification-v1-20260715-ac31a40c7d61` (SHA-256
`b4e18a288a897cab16292bdb92618d3c2af538944c8655ef37554c08d316a098`)
is permanently `invalid`: 11 attempts passed, eight were genuine product
misses, three were infrastructure-invalid, and the remaining cases are
incomplete. Its 42 provider turns reconcile to 42 settlements; product and
evaluator costs are $35.684715 and $1.711014. It is qualified read-only and
retained in a verified 370-file archive; cleanup was not executed.

The product misses expose three public compatibility gaps: exact
repository-local `.pnpm-store/` syntax, collapsing repeated underscores under
`preserveUnderscores`, and preservation of the existing `normalizeApiKey`
export. The halted continuation attempt also exposed a harness failure on
unavailable provider token totals. Corrected task contracts and adversarial
tests pin the product behavior, while the harness now records unavailable
usage as missing invalid evidence rather than zero or an exception. The two pi
context attempts remain blocked by the external Claude account's “extra
usage” requirement; no model is substituted. See
`research/evals/2026-07-15-phase6-candidate-qualification-invalid.md` for the
immutable report, archive, GitHub, attempt, cost, and settlement hashes.
Because these are covered-byte changes, a fresh adapter identity and fresh
candidate identity require new exact authorizations. No contract is promoted
from the invalid campaign. Under the later ratified scope, current strict mode
is red for the exact nine non-soak provider contracts, while future-soak
strict is independently red only for `I-LIVE-01`.

The next exact latest-model adapter campaign,
`adapter-harness-calibration-v1-20260715-7d36fc5f3d3f` (SHA-256
`7184ed7001fc9cb7adbc678b72a945821a0e7b7d3891e4b9adec67c5916edf7a`),
is also permanently `invalid`. Claude passed; Codex's original attempt and
its one linked infrastructure retry were rejected because the pinned 0.142.5
Codex runtime was too old for `gpt-5.6-sol`; and pi's Sonnet 5 attempt proved
that the external account still lacks funded third-party “extra usage.” All
ten provider turns reconcile to ten settlements, four mechanical steps have
zero mechanical settlements, and the verified 67-file archive is retained.
The repository now pins `@openai/codex` 0.144.4, which invalidates the
unexecuted matching candidate manifest. The operator subsequently ratified an
eval-only reassignment of every pi probe, Support case, and Marketing case to
pi's exact `openai-codex/gpt-5.6-sol` model; production `roles.yaml` remains
unchanged. The local pi SDK is pinned to 0.80.7 so that exact provider/model is
available to the embedded adapter. This covered-byte change makes the later
`20260715-0794dd5378ed` previews and authorizations stale before execution. See
`research/evals/2026-07-15-phase6-latest-model-adapter-invalid.md` for exact
GitHub, qualifier, report, archive, cost, attempt, and settlement evidence.

The subsequent pi-on-Codex adapter campaign,
`adapter-harness-calibration-v1-20260715-6ed3b4ac8b87` (SHA-256
`74e1260fa224b165b10a9c4a26e016de2efcdb9af86fc7d311fef00775ccda9b`),
qualified Claude, Codex, and pi without a retry: 20 provider turns equal 20
settlements, three mechanical steps produced zero mechanical settlements, and
equivalent cost was $2.5776245. Its dependent candidate campaign,
`candidate-qualification-v1-20260715-6ed3b4ac8b87` (SHA-256
`f871bb3bdc4530ff5c44e0cba094160c91be5a8890cbfd880a980bd676a6968d`),
is permanently `invalid`: 24 attempts passed, both deep episodes were genuine
product misses, both continuation episodes were infrastructure-invalid, and
all six learning arms stopped at a pristine-gate harness error. All 59
provider turns reconcile to 59 settlements, 2,022 mechanical steps created
zero settlements, and product/evaluator costs were $63.216598/$4.1084805.
The corrected deep task preserves pinned package scripts, continuation waits
for usage-bearing progress before cancellation, and the fully network-dark
learning case uses a focused non-loopback seed test. Those covered-byte
corrections require fresh adapter and candidate identities. Both terminal
campaigns and their byte-stable reports are retained in verified
`sanitized-evidence/v3` archives; cleanup was not executed. See
`research/evals/2026-07-15-phase6-pi-codex-candidate-invalid.md`.

The next scope-split adapter campaign,
`adapter-harness-calibration-v1-20260715-c6b9b4885527` (SHA-256
`d48af84381dbfa7ab7ad270552a06b6dd501dd1f0a6f516cec06691187e0e9`),
qualified all three adapters without retry: 20 provider turns equal 20
settlements, three mechanical steps produced zero settlements, and equivalent
cost was $2.503884. Its dependent candidate,
`candidate-qualification-v1-20260715-c6b9b4885527` (SHA-256
`d32dd98932364bb07ee6a40aad78d3454f1267c065db28a170e80ddaabc9ed70`),
is permanently `invalid`: 31 of 34 attempts passed, with one context safety
stop, one deep product miss, and one learning product miss. All 71 provider
turns reconcile to 71 settlements; the virtual soak contributed 2,016
mechanical steps and zero settlements; product/evaluator equivalent costs
were $68.12762825/$7.1732735. The exact retained failures and fail-closed
corrections are recorded in
`research/evals/2026-07-15-phase6-scope-split-candidate-invalid.md`. No
learning activation, contract promotion, production confirmation, or
real-time soak occurred. The covered-byte corrections require fresh adapter
and candidate identities.

### Latest retained pre-scope-split deterministic verification

The corrected Phase 6 pre-external gate on 2026-07-15, in the isolated candidate
worktree, produced:

- `pnpm eval:validate`: valid, with 84 requirements, 84 executable evidence
  paths, 14 cases, 12 benchmark families, 60 fault boundaries, 13 graders,
  three capability declarations, and zero orphaned records;
- `pnpm test:transformation`: 32 files and 259 tests passed, then the
  non-strict runner reported exactly the ten post-Phase-5 known-red contracts;
- `pnpm eval:deterministic`: 53 files and 402 tests passed;
- `pnpm eval:deterministic:nightly`: both declared shuffled seeds passed 53
  files and 402 tests, including the production seven-day virtual soak;
- `pnpm test`: 181 files and 1,552 tests passed after retaining and correcting
  the invalid-calibration integration-timeout miss described below;
- `pnpm typecheck`, `pnpm build`, neutral-cwd `pnpm smoke:onboarding`, and
  `npm pack --dry-run` passed; the dry-run package contains 208 files;
- the fresh-HOME/TMPDIR/org/state/app/eval/provider-scratch Phase 6 subset
  passed 31 files and 182 tests after retaining and correcting a zsh wrapper
  variable error; production-path, hidden-answer, provider-construction,
  accounting, archive, promotion, and scheduler tripwires were green;
- the isolated alpha, beta, gamma, and delta app suites passed; alpha, gamma,
  and delta lint passed, and gamma's token-free SRE, Support, and Marketing
  artifact smokes passed with no GitHub target;
- the then-unscoped `pnpm test:transformation:strict` passed all 259 executable
  tests and exited non-zero for the ten post-Phase-5 contracts. The later
  ratified split replaces that result with separate current and future-soak
  strict views; it does not relabel the retained run.

The first full deterministic attempt after adding the final L6 denominator
checks retained one local failure: the nine-projection self-verification case
exceeded Vitest's five-second timeout under full-suite load. The cause was
repacking the identical release candidate once per projection. Batch
verification now computes that exact packed identity once while every
projection still independently recomputes its qualification, archive, result,
grader, accounting, and mapping evidence. The formerly timing-sensitive case
runs in about one second, and the complete deterministic and shuffled-seed
runs above passed without changing a threshold or retrying campaign evidence.
The first complete offline-suite run after the ratified learning-score binding
also retained a single five-second test timeout: the eight-attempt specialized
provider-path integration case completed in 5.2 seconds under full-suite
contention. It now declares a 15-second integration-test timeout; the next full
run passed all 1,541 tests with unchanged cases, assertions, campaign rules,
graders, and denominators.

The first complete offline-suite run for the corrected invalid-campaign
harness retained one further five-second timeout. The filesystem-backed
invalid-calibration accounting case completed in 5.219 seconds under full
suite contention. It now has the same explicit 15-second integration timeout
as the larger provider-workflow case; all unavailable-usage, retained-cost,
attempt, settlement, and equality assertions are unchanged. The corrected
full run passed all 1,548 tests. The first fresh-root focused wrapper also
retained a post-test zsh error from assigning the reserved `status` variable;
the same 182 tests had already passed. Changing only that wrapper variable to
`rc` produced an exit-zero run on a new fresh root.

This gate spent no provider tokens and performed no external GitHub,
scheduler, production-org/state, canary, publication, deployment, or outward
operation. Fresh adapter calibration, candidate qualification, and L6 remain
separately authorized work; the strict gate is not green and no Phase 6
contract is promoted.

The complete Phase 2 local pass on 2026-07-14 produced:

- `pnpm eval:validate`: valid; 84 requirements, 84 executable evidence paths,
  14 cases, 12 benchmark families, 60 fault boundaries, 13 graders, three
  capability declarations, and zero orphaned records;
- `pnpm test:transformation`: 28 files and 347 tests passed; the non-strict
  contract runner reported no unexpected failures;
- `pnpm eval:deterministic`: 43 files and 480 tests passed, including the
  production lifecycle replay and all 43 restart-boundary cases;
- `pnpm test`: 167 files and 1,606 tests passed;
- `pnpm typecheck`: passed;
- `pnpm build`, `pnpm smoke:onboarding`, and `npm pack --dry-run`: passed;
- the isolated alpha, beta, gamma, and delta app suites passed (including all
  available lint and gamma role smokes), and isolated Delta scan/bootstrap,
  plan dry-run, and loop dry-run completed without a provider turn;
- `pnpm test:transformation:strict`: all 347 test cases passed, then the command
  exited non-zero only because the exact 52 post-Phase-2 production contracts
  below remain deliberately known-red.

After the deterministic production Phase 4 slice, the exact known-red set is
15 contracts. The D/E live contracts and G-MET-01 remain red because their
provider campaigns were not authorized, not because their deterministic
production paths are absent:

- D (3): `D-LIVE-01`–`D-LIVE-03`;
- E (2): `E-LIVE-01`–`E-LIVE-02`;
- G (1): `G-MET-01`;
- I (9): `I-INSTALL-01`–`I-INSTALL-02`, `I-SOAK-01`–`I-SOAK-03`,
  `I-ROLE-01`–`I-ROLE-03`, `I-LIVE-01`.

The 69 required contracts in A–H and J are green. Historical provider baseline
results remain the pre-transformation comparison and are not relabeled, and no
live result is inferred from deterministic evidence.

The Phase 3 offline gate on 2026-07-14 produced:

- `pnpm eval:validate`: valid, with 84/84 executable evidence paths and no
  orphaned records;
- `pnpm test:transformation`: 28 files and 267 tests passed; the non-strict
  runner reported the exact 25 known-red contracts and no unexpected failure;
- `pnpm eval:deterministic`: 45 files and 398 tests passed;
- `pnpm test`: 172 files and 1,540 tests passed;
- `pnpm typecheck`, `pnpm build`, `pnpm smoke:onboarding`, and `npm pack
  --dry-run`: passed;
- alpha, beta, gamma, and delta app suites passed, including every available
  lint check and gamma SRE/Support/Marketing role smoke; an isolated Delta
  HOME/org/state/app completed scan, bootstrap, quick plan dry-run, and loop
  dry-run with zero provider turns;
- `pnpm test:transformation:strict`: all 267 tests passed, then exited non-zero
  only for the exact 25 contracts above; the disposable GitHub merge e2e was
  not run because `GH_SANDBOX_REPO` was unset.

No calibration, baseline, qualification, soak, or other provider campaign was
run for Phase 3.

The Phase 4 offline gate on 2026-07-14 proved the ten H contracts through
production imports. The closure fixture copied its immutable historical inputs
into temporary state, projected all eligible provider runs or exact blockers,
formed deterministic recurrence, exercised independent review and declared
efficacy, rejected sham/harmful treatments, restored stable lineage on
disable/rollback, and produced byte-stable health. Capture, repair,
clustering, disposition, and reporting constructed no provider runtime and
wrote no telemetry. No calibration, baseline, qualification, live replay,
canary, soak, or other provider campaign was run for Phase 4. Phase 5 scheduler
management is next.

The recorded deterministic Phase 4 validation was:

- `pnpm eval:validate`: valid, 84 requirements with 84 executable evidence
  paths, 14 cases, 12 benchmark families, 60 fault boundaries, and no orphan;
- `pnpm test:transformation`: 28 files and 238 tests passed, then the contract
  runner reported exactly 15 known-red IDs and no unexpected failure;
- `pnpm eval:deterministic`: 45 files and 369 tests passed;
- `pnpm test`: 173 files and 1,516 tests passed;
- `pnpm typecheck`, `pnpm build`, `pnpm smoke:onboarding`, and `npm pack
  --dry-run`: passed;
- isolated alpha (55 tests + lint), beta (4 tests), gamma (45 tests + lint +
  SRE/Support/Marketing smokes), and delta (53 tests + lint) passed with clean
  worktrees afterward;
- the temporary-HOME/TMPDIR Phase 4 closure replay passed 4 files and 12 tests;
- `pnpm test:transformation:strict` passed all 238 executable test cases, then
  exited non-zero only for the exact 15 D/E/G-live and I IDs above.

The Phase 5 deterministic gate promotes the production-backed
`I-INSTALL-01..02` and `I-SOAK-01..03` contracts. Scheduler lifecycle and
status operate on temporary definitions through an injected manager; the
production virtual-soak module records 2,016 five-minute decisions across
seven days, 1,758 executed receipt-bearing decisions and matching settlements,
four restart/crash boundaries, zero duplicate decisions or
episodes, zero silent misses, zero orphaned locks/journals/runs/settlements,
zero cross-app budget leakage, zero mechanical-provider leakage, and zero
unapproved outward effects. Stable evidence replay is byte-identical.

Standing-role deterministic production paths persist source-hashed, draft-only
SRE/Support/Marketing artifacts plus an exact-once Planner feed for each,
reject wrong-app/stale/unprovenanced payloads, and park deploy-shaped SRE work
at the ordinary approval boundary. Three ordinary FakeRuntime pass executions
produce three exact telemetry settlements. This is necessary deterministic coverage,
not provider-result evidence. No provider standing-role campaign, real
scheduler mutation, real-time L6 soak, or Phase 6 qualification was run. The
exact post-Phase-5 known-red set is ten: `D-LIVE-01..03`, `E-LIVE-01..02`,
`G-MET-01`, `I-ROLE-01..03`, and `I-LIVE-01`.

The recorded deterministic Phase 5 validation was:

- `pnpm eval:validate`: valid, with 84 requirements, 84 executable evidence
  paths, 14 cases, 12 benchmark families, 60 fault boundaries, 13 graders,
  three capability declarations, and zero orphaned records;
- `pnpm test:transformation`: 28 files and 223 tests passed; the contract
  runner reported exactly the ten known-red IDs above and no unexpected
  failure;
- `pnpm eval:deterministic`: passed, including production lifecycle,
  continuation, efficiency, standing-role, and scheduler suites;
- `pnpm test`: 177 files and 1,514 tests passed;
- `pnpm typecheck`, `pnpm build`, neutral-cwd `pnpm smoke:onboarding`, and
  `npm pack --dry-run` passed; the package contains `docs/scheduler.md` and all
  scheduler runtime/CLI modules;
- the fresh-HOME/TMPDIR scheduler gate passed 7 files and 23 tests without a
  real host manager; the production projection reported 2,016/2,016 reasoned
  decisions, 1,758/1,758 receipt settlements, four restarts, and zero
  duplicates, silent misses, orphans, leakage, or outward effects;
- isolated alpha (55 tests + lint), beta (4 tests), gamma (45 tests + lint +
  SRE/Support/Marketing smokes), and delta (53 tests + lint) passed with clean
  worktrees afterward;
- the L6 command ran in preview mode only and retained 48 hours, five-minute
  cadence, 12 useful turns, a 24-hour restart receipt, and a $40 cap;
- `pnpm test:transformation:strict` passed all 223 executable test cases, then
  exited non-zero only because the exact ten provider/real-time contracts
  above remain known-red.

### Retained external evidence and findings

The final admitted adapter campaign
`adapter-harness-calibration-v1-20260714-e52bf4335e81` is valid and
`qualified`. Its L4 lifecycle ran twice in the retained private repository
`buildstacks-dev/operon-eval-adapter-calibration`: issue #19, PR #20, content
commit `76daadcedf0e92d1745a5a4687b25d26eaa3559d`, comments, one
non-approving review, squash merge, issue closure, branch deletion, and exact
idempotent replay. Claude passed seven settled turns for $0.971383, Codex
passed seven for $1.022430, and pi passed six for $0.164578. The 20 provider
turns join to 20 settlements; three mechanical probes have no provider
settlement. The reproducible report SHA-256 is
`4d424ebd4cdac477e15788a6af89af0ef1dc3ae00d8e301c1a21b9272ec96fff`.
Its 150-file sanitized archive is retained under
`/Users/bikram/Build/operon-eval-archives/adapter-harness-calibration-v1-20260714-e52bf4335e81-e10fdc62-evidence-v2/`
with archive-manifest SHA-256
`81a0bab3415138d736c13c27cf7019ba95203a6325be9290174d4d6cbba7d11e`;
cleanup preview revalidated the receipt without deleting evidence.

The admitted provider baseline
`pre-transformation-baseline-v2-20260714-e52bf4335e81` is valid eval-system
evidence and a `not_qualified` product result. Its L4 lifecycle ran twice in
`buildstacks-dev/operon-eval-pre-transformation-baseline`: issue #7, PR #8,
content commit `b13bbb0ce211b45da08453d18bfdf671c0aa4942`, comments, one
non-approving review, squash merge, issue closure, branch deletion, and exact
idempotent replay. The six attempts are one pass and five `product_miss`
outcomes, with zero harness, infrastructure, safety, budget, or missing
results. Nine provider turns join to nine settlements; two mechanical steps
have no provider settlement. Product equivalent cost is $10.480130 and
evaluator equivalent cost is $0.439821, for $10.919951 total. Qualifying the
stored prepared manifest reproduces the verdict without a model turn or
GitHub mutation. The portable report reproduces byte-for-byte at SHA-256
`f2e61615e14bea59d386a6efa829a7e1063761ceaa1ba4fcdcbf8f0995205fd2`.
Its 104-file sanitized archive is retained under
`/Users/bikram/Build/operon-eval-archives/pre-transformation-baseline-v2-20260714-e52bf4335e81-5bddc84c-evidence-v2/`
with archive-manifest SHA-256
`b61ed6d0760d78ed4248be0032d377d0ccf106cad031855a40930e3fbc95e5e6`;
cleanup preview revalidated the receipt without deleting evidence. These
expected product misses satisfy the baseline evidence gate; they do not make
the unimplemented transformation product-ready.

The earlier provider baseline
`pre-transformation-baseline-v2-20260712-72cadfa9` remains documented in
`research/evals/2026-07-12-pre-transformation-baseline.md`. It recorded one
pass, four product misses, one safety stop, and $8.729971 equivalent cost, but
the hardened reader correctly invalidates that old result schema. It is
historical evidence, not the T4 replacement baseline.

The latest hardened adapter campaign
`adapter-harness-calibration-v1-20260713-524ab18c52d8` (SHA-256
`dcb29ea4fb9691bc3e77289083f35e7bfd5190f3bfb69aafd1e641ffac764d83`;
candidate package
`f36be1749c3c4f6156c2bbc19a24d5f37d575bd0f18ca7dea04396fd45ec9434`,
suite `8bf7527a64a6edb834518a6b9cd100aabc6ac9cd3624d26ed14f72cad25d855f`)
successfully proved the full L4
lifecycle in the retained private repository
`buildstacks-dev/operon-eval-adapter-calibration`: issue #3, PR #4, commit
`21286ad97fc9f4db4d6c7cc0e5b7893c0f5e513c`, a non-approving review,
squash-merge, issue closure, branch deletion, and an exact idempotent rerun.
The earlier `453aaa4f` campaign and both `54862199` prepared manifests remain
historical; none may be reused after the repairs below.

The `524ab18c52d8` provider calibration did **not** pass:

- Claude yielded an explicit terminal max-budget result with usage, then the
  Agent SDK iterator rejected when its owned CLI exited non-zero. The adapter
  discarded the terminal result, so the attempt became a zero-turn
  `harness_error` instead of an attributed provider stop;
- Codex retained a primary and linked retry with seven observed scenarios each,
  but cancellation occurred before the first usage checkpoint. That made the
  aggregate usage unavailable, and the later result-schema failure replaced
  the attempt summaries with zeros even though grader evidence and ledger rows
  existed. The gate probes also exposed that approval callbacks alone do not
  observe the App Server's auto-approved command path;
- pi's provider returned terminal authentication errors in all six scenarios,
  but the adapter treated assistant `stopReason: "error"` messages as
  completed zero-token turns. Readiness had also loaded an in-memory auth copy,
  so a rotating OAuth refresh could not be persisted safely;
- the ledger nevertheless contains 20 unique provider settlements (14 Codex,
  six pi), 1,011,173 input tokens, 2,086 output tokens, and $5.118445
  equivalent cost. The immutable summaries do not reconcile with that ledger;
  this is disqualifying evidence and must not be backfilled or described as
  valid calibration.

Repairs now retain Claude terminal error results, map pi terminal provider/auth
errors to honest failures, use file-backed pi readiness, isolate provider
auth/environment in campaign scratch, wait for a usage checkpoint before the
cancellation probe, preserve all observed turns across downstream failures,
and execute every calibration scenario through the ordinary pass executor so
it gets a six-file run record plus exactly one ledger settlement. Codex now
routes supported simple Bash, `apply_patch`, and MCP `PreToolUse` calls through
a fail-closed per-turn bridge into the real Operon gate while disabling tool
paths the official hook does not completely intercept. OpenAI explicitly calls
that hook a guardrail rather than a complete enforcement boundary, so the
claim remains limited to the constrained App Server surface and requires a new
live calibration. The focused and complete offline gate sets pass; fresh live
proof remains outstanding. See
`research/evals/2026-07-13-adapter-calibration-repair.md`.

The exactly authorized post-repair campaign
`adapter-harness-calibration-v1-20260713-dd84b826242c` then passed its complete
L4 lifecycle twice but remained invalid at L5. It retained one unauthenticated
Claude settlement, four Codex settlements ending in a continuation budget
stop, and one unauthenticated pi settlement: 303,838 input tokens, 1,069 output
tokens, and $1.55126 estimated equivalent cost. Its stale readiness artifact
had incorrectly accepted Claude account metadata and an expired pi OAuth
record, while Codex CLI 0.142.5's App Server path had dropped the global hook
trust-bypass flag. Those defects and the scenario allocations are repaired and
the focused plus complete offline gates pass; the immutable campaign remains
invalid, baseline stayed stopped, and another fresh content hash is required.

The next prepared and authorized campaign
`adapter-harness-calibration-v1-20260713-0fdc5399d224` was stopped before any
GitHub mutation or provider turn. An intermediate readiness hardening rejected
blank and `"none"` token/API-key source sentinels. That source edit made the
manifest stale; it spent zero and is not calibration evidence.

The subsequently prepared and authorized campaign
`adapter-harness-calibration-v1-20260713-d11efc466a7f` (SHA-256
`20bae9ae7c88375116d6e16e9e5161459e9ddaed83d2a554918b48295065c7ca`)
also stopped before any GitHub mutation or provider turn and spent zero. The
operator correctly challenged the claim that Claude was logged out. The same
Claude binary reported a valid Claude.ai Max login outside the command sandbox
but logged out when the eval harness replaced `HOME` and set
`CLAUDE_CONFIG_DIR`. On macOS, Claude Code stores credentials in Keychain; the
harness's copied `.credentials.json` model could not preserve that session.
The repair now gives only the Claude child the authenticated host `HOME` with
`CLAUDE_CONFIG_DIR` unset, while retaining a sanitized environment, disabling
settings/skills/plugins/session persistence, denying source-home reads and
confining writes to the worktree in Claude's sandbox, and independently denying
outside-worktree paths in the Operon actor gate. Exact-environment token-free
readiness now reports Claude, Codex, and pi ready. The `d11efc466a7f` manifest
is stale after this repair and must not be reused.

The auth-correct campaign
`adapter-harness-calibration-v1-20260713-473eb4f39381` (SHA-256
`f3355c92a9538f366aa2398ece90ab391ebb18826424af1180e98bf30b989a93`)
passed L4 twice with an idempotent replay (issue #7, PR #8), then remained
invalid at L5. Claude successfully authenticated and exercised a read tool but
the token-dense 300 KB repeated-`x` transport prompt crossed its scenario cap;
Codex completed three scenarios before the same large retained context crossed
its continuation cap. Pi's authenticated provider returned HTTP 400 twice
because third-party apps now require Claude extra usage rather than plan-limit
usage. The seven settlements reconcile at 422,591 input tokens, 1,103 output
tokens, and $5.47642 equivalent cost. The baseline stayed stopped. The harness
now preserves the 300 KB + 1 byte transport proof with whitespace-only padding,
removing semantic filler cost; the terminal campaign is immutable and stale
after that edit. The operator selected pi's authenticated
`openai-codex/gpt-5.5` OAuth route for the fresh run instead of adding Claude
extra usage. The provider-qualified id prevents pi's multi-provider registry
from resolving the same bare model id to another provider.

The resulting campaign
`adapter-harness-calibration-v1-20260713-d5992688efa1` (SHA-256
`dfb6761ce10e700e7022076eb3424aeb50add95518e5fe398f7433abcc1e1f8c`)
passed L4 twice with idempotent evidence reuse (issue #9, PR #10), but remained
invalid at L5. Pi-over-Codex passed all six applicable calibration scenarios.
Claude failed only when the harness attempted to resume a session after having
set `persistSession: false`; Codex's primary and retry each completed seven
settled turns, but the 1.5-second cancellation fallback preceded the first
usage checkpoint and made aggregate usage quality unavailable. The ledger has
24 unique settlements, 693,112 input tokens, 3,677 output tokens, and
$3.06913525 equivalent cost. The executor's initial $5.21361525 summary
double-counted both invalid Codex attempts; the immutable attempts and ledger
did not. The accounting increment and cancellation fallback are repaired and
covered offline. Baseline remained stopped. The next repair enabled bounded
session persistence only for the declared Claude calibration profile, retained
exact SDK session cleanup, and did not extract a Keychain credential.

Campaign `adapter-harness-calibration-v1-20260713-72690b61e12b` then proved
those storage and mechanical boundaries: Codex and pi passed, and Claude passed
transport, both gate scenarios, continuation, and cancellation. Its final
role-shaping turn correctly stopped at an undersized per-scenario budget, so
the immutable qualifier returned `not_qualified`. That terminal campaign
retained 19/19 exactly-once settlements and $2.20937175 equivalent cost. The
scenario allocation and durable L4 idempotence receipt were repaired offline;
the campaign was not rewritten or reused.

The final content-hashed campaign
`adapter-harness-calibration-v1-20260713-9c3b336d6842` (canonical SHA-256
`f63518ae0c47c527cff165e9793036ebad2909b9aade5ebb7fc9ce6b2cef8e16`)
qualified the adapter admission gate. L4 passed twice against the retained
private repository (issue #15, PR #16) with a persisted idempotence receipt.
L5 passed Claude, Codex, and pi without retry: 20 provider turns, 20
exactly-once settlements, three mechanical permission-boundary proofs, 567,599
input tokens, 3,836 output tokens, and $2.26656275 total equivalent cost. The
qualifier recorded three passes and zero missing attempts, product misses,
safety stops, budget stops, infrastructure invalidations, or harness errors.
Exact Claude SDK sessions were deleted after grader evidence, retaining only
ID hashes. See `research/evals/2026-07-13-adapter-calibration-repair.md`.

This proves the content-hashed adapter/eval admission snapshot, not that the
future Git commit or the broader Operon product is qualified. At that historical
checkpoint all 72 declared transformation contracts remained known-red; the
current Phase 1–2 inventory is recorded above. A new adapter campaign is required
only if adapter, harness, fixture, grader, schema, or declared campaign-profile
bytes change before relying on this admission result.

### Remaining work and exact order

1. Start from the merged `main` tree without discarding unrelated local work,
   especially `docs/architecture/conceptual-overview.md`.
2. Treat the qualified adapter result as current only while adapter, harness,
   fixture, grader, schema, and declared profile bytes remain unchanged. Run
   the applicable deterministic gates after any edit. Do not rerun adapter
   calibration merely because the product remains known-red.
3. Prepare and preview a fresh `pre-transformation-baseline`; obtain one exact
   confirmation for its campaign id, SHA, private repository
   `buildstacks-dev/operon-eval-pre-transformation-baseline`, provider
   assignments, expected turns, and $250 equivalent-cost cap. Never reuse the
   historical baseline manifest or evidence.
4. Execute L4 twice to prove lifecycle idempotency, then run the provider
   baseline. Judge the eval system separately from the product: expected
   `product_miss` outcomes are valid baseline evidence when all declared
   attempts, graders, run records, settlements, accounting, and GitHub effects
   are complete and reconcile. Missing/corrupt evidence, a harness error, or
   irreconcilable accounting invalidates the eval run and must be repaired; a
   product miss must be retained, not fixed in the suite or rewritten as a
   pass.
5. Run the read-only qualifier, reproduce the portable report from retained
   evidence, create a checksum-verified sanitized archive, and update the dated
   research/status documentation. Then audit the T5 readiness gate and verify
   strict mode differs from green only by the exact declared known-red set.
6. Keep full candidate qualification, the 48–72 hour L6 soak, and the separate
   `pnpm test:live` command pending until each has its own preview and explicit
   authorization. Their product-level failures may be honest eval outcomes;
   their harness and evidence paths must still work.

Provider execution uses the human's existing subscriptions. Dollar figures in
this work are equivalent-cost accounting caps and measurements, not
incremental charges. Do not reopen or repeatedly ask about credential mode.

## 1. Review verdict

The transformation charter is directionally strong and should proceed after
the amendments below. Its most important decision is correct: efficiency is a
correctness property, not a dashboard optimization. It also correctly joins
proportional routing, deterministic mechanics, durable continuation, precise
approvals, learning efficacy, and autonomous operation. Testing only one of
those surfaces would recreate the historical failure in a different form.

The charter is not yet precise enough to implement a gold-standard suite
literally. Eight ambiguities could make a test pass while the organization is
still inefficient, or make reporting internally inconsistent.

### 1.1 Required clarifications

| ID | Ambiguity in the source charter | Resolution this suite must enforce |
| --- | --- | --- |
| TE-01 | “Every provider and mechanical pass settles exactly once” can be read as putting mechanical work in the provider accounting ledger. Current reporting correctly permits a mechanical pass without provider settlement. | Keep two identities: every **provider turn** settles once in the accounting ledger; every **execution step**, provider or mechanical, reaches one terminal execution record. A mechanical step creates no provider settlement and cannot inflate turn or cost counts. |
| TE-02 | The quick lane allows a plan/contract, Builder, review, and repair, but its budget is at most three model turns. Those can total four or more; the current build protocol also separates contract and implement turns. | A nominal quick episode may use at most three turns. A repair after a three-turn quick route is a recorded route reassessment to standard/deep, not a successful quick episode. The report preserves both `planned_route` and `final_route`. No required review is skipped merely to preserve the quick label. |
| TE-03 | “Productive pass,” “active wall time,” “human decision,” “approval precision,” and “repeated work” lack exact denominators. | Use the formulas in §4. Metrics are computed from orchestrator-owned state and artifact fingerprints, never agent self-report. Unknown inputs produce `invalid_measurement`, not zero or pass. |
| TE-04 | Cost and token budgets are compared across providers whose prices, cache semantics, and usage fidelity differ. | Version the model assignment, provider capability claim, and price catalog in every campaign. Cost is evaluated with its quality (`reported`, `estimated`, `partial`, `unavailable`); unavailable required usage invalidates qualification. Do not infer per-context-source tokens when only rendered bytes are known. |
| TE-05 | Five consecutive clean runs followed by ten mixed runs permits optional stopping, hidden retries, and cherry-picking unless the sequence is declared first. | Predeclare campaign, ordered cases, repetitions, models, exclusions, spend cap, and stop rules. Every attempt remains in the report. An infrastructure retry is linked to the failed attempt and never replaces it. |
| TE-06 | The learning benchmark asks for one injected occurrence of each anomaly, while the ratified default distiller requires two recurring events for an actionable cluster. | Inject at least two comparable episodes per recurrence-based error class, or one explicitly trusted human observation where policy permits it. Run against the production policy; do not lower the threshold just to pass the eval. |
| TE-07 | The lifecycle replay starts with pending approvals, but reset is ratified to refuse pending approvals. The stated sequence jumps directly from preview to execute. | The benchmark must first prove refusal, then resolve or archive the eval-only approvals through an explicit operator fixture, rerun the plan, and only then execute reset. Refusal is a passing safety result, not benchmark friction. |
| TE-08 | The charter says efficiency thresholds become release gates, but single stochastic runs cannot safely gate a release and auth skips can look green in the current live suite. | Hard safety/integrity invariants gate every run. Efficiency is evaluated over a predeclared distribution plus per-episode admission bounds. A required live case that skips, lacks auth, loses usage, or exceeds the campaign cap makes the campaign `invalid` or `incomplete`, never passing. |

These are test-contract clarifications, not unilateral amendments to
`docs/PURPOSE.md`. Phase T0 must put the accepted meanings in the canonical
efficiency contract before transformation code begins.

### 1.2 What should not change

The suite must preserve and strengthen these existing decisions:

- critical operations remain human-governed;
- independent review remains mandatory where risk requires it;
- one turn operates on exactly one app;
- provider adapters share one conformance contract;
- GitHub and durable files remain workflow authority;
- replay and reporting remain projections, not second workflow stores;
- learning activation stays content-bound and human-operated;
- sandbox proof precedes production confirmation;
- outcome misses remain evidence and are never rewritten as passes.

## 2. Current-suite audit

The repository already has unusually strong component coverage. On
2026-07-12, `pnpm test -- --reporter=dot` completed with **118 files and
1,097 tests passing in 13.25 seconds**. That result is the starting baseline,
not a claim that the transformation is covered.

| Surface | Valuable assets to retain | Gap relative to the transformation |
| --- | --- | --- |
| Offline suite | Fast Vitest suite; real filesystem/process/git fixtures; `FakeRuntime`; `FakeGhOps`; fake clock; torn-file and idempotency cases | No canonical transformation contract inventory, campaign identity, or cross-workstream qualification report |
| Runtime conformance | Shared gate/payload/session harness; full Claude live conformance; cache probe; unit budget tests for all adapters | Codex and pi live files are opt-in no-tool smokes, not behavioral parity; missing auth currently skips rather than invalidating a required campaign |
| Loop | Pipeline, gates, review, merge, continuation, bounded cycles, cancellation, partial usage, and runlog integration | No episode-wide route admission/budget controller, context manifest, or distribution-level efficiency assertion |
| Lifecycle | Strong isolated onboarding smoke; reset tests; org/app/state separation | No legacy-org upgrade, answer recovery, verify/promote transaction, exhaustive crash boundary, or complete zero-provider lifecycle replay |
| Approval boundary | Exhaustive critical/routine action corpus, structured-output exemption, scoped grants, role shaping, denial lessons | No campaign-level approval precision/recurrence score and no provider-backed semantic-action matrix across all adapters |
| Learning | Capture, episode, capsule, candidate, experiment, paired replay, canary, publisher, budget, and M6 distillation tests | Replay uses scripted model behavior for ordinary CI; anomaly coverage does not yet prove the new efficiency error classes reach measured intervention efficacy |
| GitHub e2e | Disposable private-repo state-machine test with real git/GitHub | It injects implementation and approval; it does not run real planning/build/review behavior or measure route economics |
| Sandbox apps | Alpha, beta, gamma, and delta cover healthy, sparse, service, and from-scratch shapes | They are mutable external repos and manual verification targets, not pinned, hermetic, repeatable eval cases with hidden graders |
| Historical benchmark | Stage 7 runbook and round-one/round-two evidence show a real improvement from 55 passes/$266.41 to 6 passes/$6.83 | One successful episode is not a reusable regression suite; the later 28-pass/$51.60 workflow proved that point |
| Reporting/Observe | Deterministic, ledger-first, read-only projections with rich corruption/security tests | Efficiency route, context, repeated-work, human-load, and learning-efficacy projections do not yet have one canonical source schema |
| Scheduler | Dispatch, locks, due-turn logic, and doctor plist inspection are tested | No install/status/uninstall contract, deterministic multi-day simulation, or real isolated soak |

### 2.1 Audit conclusion

Do not rewrite the current 1,097-test suite wholesale. Preserve it as the
component safety net, remove duplication only when a new shared fixture has
proven equivalence, and add a qualification layer above it. The missing
product is not “more unit tests.” It is a reproducible test world that joins
the existing proofs into comparable episodes with trusted outcomes and
explicit cost.

## 3. Verification doctrine

### 3.1 Rules

1. **Test behavior before implementation shape.** Up-front transformation
   contracts assert CLI output, durable artifacts, Git/GitHub state, provider
   invocation count, and reports. They must not force an internal class or
   module layout that implementation has not earned.
2. **Deterministic claims get deterministic tests.** Route policy, migrations,
   reconciliation, idempotency, projection, classification, and settlement do
   not need a model judge.
3. **Behavioral claims use real models.** Planning proportionality, context
   sufficiency, Builder success, Reviewer detection, and learned-behavior
   efficacy require provider-backed evals after cheaper gates pass.
4. **Outcome quality precedes efficiency.** An episode with bad code, missing
   evidence, weakened review, or an unsafe action fails even if it is cheap.
5. **The actor never sees the answer key.** Hidden tests, expected outcomes,
   grader code, and treatment identity stay outside the actor worktree and
   prompt/context bytes.
6. **The evaluator is not the worker.** Agent prose and self-reported
   completion are evidence inputs only. Mechanical gates, hidden verifiers,
   durable state, and independent adjudication decide.
7. **Every miss is retained.** No rerun erases a failed, timed-out, cancelled,
   over-budget, or invalid attempt.
8. **Production is confirmation, never calibration.** Tune and qualify on
   disposable eval assets. Production evidence is read-only and reported
   separately.
9. **No silent skip.** A locally optional live suite may report `not_run`; a
   release-required campaign with a skipped case is incomplete.
10. **No second workflow database.** Eval manifests and results are portable,
    content-addressed evidence files. Operon state remains authoritative for
    the workflow that ran.

### 3.2 Oracle hierarchy

Use the highest available oracle and record it for every assertion:

1. exact state/schema/hash/exit-status assertion;
2. real local process, git, hidden test, or property verifier;
3. disposable GitHub/API evidence;
4. calibrated deterministic rubric over artifacts;
5. blinded model grader for qualitative residue;
6. human adjudication for material ambiguity.

A model grader can never overrule a failed mechanical or safety guardrail.
Before a model grader becomes trusted, it must pass a labeled calibration set,
remain blind to arm/cost/outcome labels, and report disagreement for human
review. Do not use an uncalibrated “LLM-as-judge” as a release gate.

### 3.3 Test-first without a permanently red main branch

The suite is intentionally implemented before the features. Do not hide the
missing behavior behind `skip`, `todo`, empty assertions, or mocks that return
the desired future state.

Create a versioned `eval/contracts.yaml` inventory. Each future contract has:

- stable case id and charter requirement;
- executable test or eval case;
- current state `known_red` or `required`;
- exact expected failure class, never an arbitrary exception string;
- owning workstream and phase;
- evidence path and promotion criteria.

`pnpm test:transformation` executes all contracts. It succeeds only when the
observed known-red set exactly matches the inventory and all required cases
pass. A known-red case that unexpectedly passes is a loud result requiring
review and promotion; a new or differently failing case fails the command.
`pnpm test:transformation:strict` requires zero known-red contracts in the
declared `current` scope. `pnpm test:transformation:future-soak-strict`
independently evaluates `future_soak` and remains non-zero for exactly
`I-LIVE-01` until its genuine campaign passes. Both validate all 84 inventory
records before filtering; the canonical scope definition is
[`docs/efficiency.md`](../efficiency.md#phase-6-qualification-scope).

This is an explicit executable debt ledger, not a waiver. The known-red count
may only decrease. The transformation implementation PR that satisfies a
contract changes that contract to `required`; it does not author the test for
the first time.

## 4. Canonical measurement contract

### 4.1 Identities

| Entity | Meaning | Authority |
| --- | --- | --- |
| Campaign | Predeclared set and order of cases, repetitions, fingerprints, budget, exclusions, and stop rules | Eval campaign manifest |
| Case | Versioned starting conditions, task, side-effect policy, oracle, and route expectation | Committed case manifest |
| Episode | End-to-end unit responsible for an outcome: ticket, incident, feedback thread, campaign, or lifecycle transaction | Existing process-owned state plus projection |
| Execution step | One terminal provider pass or deterministic mechanical operation within an episode | Run/step envelope and L2 events |
| Provider turn | One adapter invocation that can consume tokens | Telemetry accounting ledger, exactly once |
| Mechanical step | Deterministic execution step with no adapter invocation | Execution record only; never a provider ledger row |
| Attempt | One case repetition, including invalid/failed infrastructure attempts | Eval result manifest; immutable |

An execution step id is unique within an episode. A provider execution step
must join to exactly one provider settlement. A mechanical execution step must
join to zero provider settlements. Both must have one terminal execution
record. This does not authorize another global ledger: extend/reuse existing
run/phase envelopes, L2 events, and invocation evidence as appropriate.

### 4.2 Metric formulas

| Metric | Required computation |
| --- | --- |
| Model turns | Count unique provider settlements attributed to the episode. Eval graders and replay orchestration are reported separately, never charged to the product route. |
| Input/output tokens | Sum adapter-reported provider settlements by quality. Cache-read/cache-write are components of input, never added to input a second time. |
| Context by source | Rendered bytes from the context manifest by category. Adapter total tokens remain a separate observation unless an authoritative tokenizer attribution exists. |
| Equivalent cost | Sum provider-reported cost where native; otherwise the versioned conservative price catalog estimate. Report quality and catalog id. Unknown cost is not `$0`. |
| Elapsed time | Terminal episode timestamp minus admission timestamp, including waits. |
| Active wall time | Union of intervals in which an Operon process, mechanical step, or provider turn is executing. Parallel intervals count once. Human wait is excluded and reported separately; provider latency is included. |
| Human decisions | Operator actions that change episode authority or state: approval/denial, criteria sign-off, route/budget override, or material clarification. Starting a declared campaign and passive observation are not episode decisions. |
| Productive model pass | A provider turn that creates a new required decision artifact, advances durable workflow state, creates a code artifact, resolves/rebuts a finding with evidence, or adds required independent verification. Artifact/state hashes decide; agent claims do not. |
| Productive-pass ratio | Productive model passes / all episode model passes. Adapter-start failures and repeated unchanged reasoning remain in the denominator. |
| Repeated-work cost | Cost of a pass whose intended decision/artifact fingerprint already existed and was still valid, plus any downstream repetition it caused. |
| Artifact continuation | Eligible interruptions resumed without rerunning a still-valid productive pass / all eligible injected or observed interruptions. |
| Approval precision | Unique approval requests whose typed action semantics genuinely require the matched rule / all unique approval requests. Flat role-forbidden denials are not approval requests. |
| Approval recurrence | Materially identical requests after a prior unchanged denial, keyed by normalized semantic action and scope. Target is zero in the next comparable episode. |
| Terminal integrity | Episodes and execution steps with one truthful terminal record / all admitted episodes and started steps. |
| Ledger coverage | Provider execution steps with exactly one settlement / all provider execution steps. Mechanical steps are checked separately for zero settlement. |
| Scheduler reliability | Due ticks that execute or emit a durable typed skipped/blocked reason / all due ticks. Duplicate execution is a separate zero-tolerance guardrail. |
| Learning capture | Eligible finalized provider runs projected exactly once / all eligible finalized provider runs. Reserved replay runs remain explicitly ineligible. |

Metric code must expose numerator, denominator, excluded records, and missing
data. A percentage without those fields is not a qualification metric.

### 4.3 Route budget semantics

- Admission records `planned_route`, policy version, risk/uncertainty factors,
  expected pass set, context/model/human budgets, and lower/upper cost before
  constructing a runtime.
- `planned_route` is immutable evidence. `current_route` may escalate after a
  new finding. `final_route` records what actually completed.
- A route escalation preserves prior valid artifacts and records the factor,
  remaining budget, and newly authorized budget.
- An episode that begins quick and exceeds the quick boundary is not counted
  as a quick target hit, even when an honest standard-route escalation later
  succeeds.
- A cap never authorizes false completion. It parks or reassesses with
  evidence.
- Nominal quick sequences are at most three turns. For the current separate
  contract/implement protocol, contract + implement + independent review uses
  all three. A review finding therefore triggers reassessment; it does not
  silently consume a fourth “quick” turn.

### 4.4 Three kinds of thresholds

1. **Hard invariants:** safety, outcome oracle, terminal integrity, exact
   settlement, deterministic token leakage, hidden-answer isolation, and
   no unapproved outward effect. One violation fails immediately.
2. **Per-episode admission bounds:** declared model/context/cost/human limits.
   Crossing one produces a route variance or escalation, never a hidden pass.
3. **Distribution SLOs:** productive ratio, median/p90 context and cost,
   approval precision, continuation, and scheduler reliability. Evaluate over
   a predeclared campaign and rolling windows, not one lucky run.

The initial numerical budgets remain those proposed in the source charter
until ratification. They must live in one canonical efficiency policy and be
referenced by case manifests rather than copied into test code.

## 5. Suite architecture

### 5.1 Layers

| Layer | Name | Real GitHub | Real models | Primary purpose | Default cadence |
| --- | --- | ---: | ---: | --- | --- |
| L0 | Contract/static | No | No | Schema, terminology, doc links, case/manifest validation, import-direction rules | Every PR |
| L1 | Pure/property | No | No | Route policy, classifiers, metrics, projection, serialization, deterministic metamorphic properties | Every PR |
| L2 | Component integration | No | No | Real filesystem/git/processes with fake runtime/GitHub and exhaustive fault injection | Every PR |
| L3 | Hermetic system | Local bare remotes | No | Built/linked CLI from neutral cwd; separate package/org/state/app homes; crash/restart and zero-provider lifecycle | Every PR or nightly by duration |
| L4 | Disposable GitHub | Yes, private eval repos | No | Real labels/issues/PRs/branches/merge/idempotency with scripted actors | Nightly and release candidate |
| L5 | Provider behavioral eval | Yes where the case requires it | Yes | Planning/build/review/context/approval/learning behavior and unit economics | Explicit baseline, weekly calibration, release candidate |
| L6 | Soak/confirmation | Eval GitHub/service; production read-only only | Bounded | Scheduler autonomy, drift, and final production confirmation | Release candidate / deliberate campaign |

No upper layer substitutes for a lower one. Real-model success does not excuse
a deterministic invariant failure, and a fake-runtime green path does not
prove behavioral quality.

### 5.2 Proposed commands

| Command | Contract |
| --- | --- |
| `pnpm test` | Existing required offline suite plus promoted transformation unit/component tests; always token-free |
| `pnpm test:transformation` | Executes required and exact known-red transformation contracts; token-free |
| `pnpm test:transformation:strict` | Requires every current Phase 6 contract green; final current-scope gate |
| `pnpm test:transformation:future-soak-strict` | Requires the future real-time-soak contract green; deliberately non-zero for `I-LIVE-01` until genuine evidence exists |
| `pnpm eval:validate` | Validates fixtures, graders, fingerprints, manifests, checksums, hidden-answer separation, and result schemas |
| `pnpm eval:deterministic` | Runs L0-L3 transformation benchmarks, including virtual-time soak; token-free |
| `pnpm eval:github` | Runs L4 against an explicitly allowlisted disposable private-repo namespace |
| `pnpm eval:live -- --campaign <file> --max-usd <n> --confirm <campaign-id>` | Runs the predeclared provider campaign; never implicit |
| `pnpm eval:qualify -- --campaign <prepared-file>` | Computes qualification from immutable results; performs no model turn, reconciliation, or GitHub mutation |
| `pnpm eval:soak -- --campaign <file>` | Starts/resumes an isolated soak whose schedule and stop rules are declared in the manifest |

An implementation may refine command names during T0, but the behavioral
separation is mandatory: validation and qualification are read-only;
provider-backed execution is explicit and budget-capped.

## 6. Hermetic test organization and applications

### 6.1 `EvalWorld`

Replace ad-hoc temp scaffolds for transformation tests with one composable
fixture that extends, rather than forks, `makeOrgHome`, `makeAppRepo`,
`makeBareWithClone`, and `FakeClock`.

```text
<tmp>/operon-eval-<campaign>/
  home/                    synthetic user HOME and active pointer
  package/                 exact candidate package/link identity
  org/                     committed eval org home (its own git repo)
  state/                   eval state home
  remotes/                 local bare remotes for L3
  apps/
    sparse/                human/source checkout; immutable input
    library/
    service/
  managed/                 Operon-owned clones/worktrees
  verifier/                hidden graders and answer keys, outside actor cwd
  artifacts/               campaign/results/evidence; preserved on failure
  provider-scratch/        provider session scratch when explicitly enabled
```

Every subprocess receives explicit `HOME`, `OPERON_ORG_HOME`,
`OPERON_STATE_HOME`, provider-home variables where applicable, `PATH`, and a
neutral cwd. Tests must assert that no resolved path is under the developer's
active org/state or any production app. The only shareable external resource
in L5 is explicitly selected provider authentication and a least-privilege
GitHub credential; secrets are never copied into results.

The harness records the real path and hash of the `operon` executable it used.
It must not accidentally test an older global install.

### 6.2 One disposable eval org

Each campaign creates `Operon-Eval-<campaign-id>` from the candidate package.
It never calls `operon org use` against the user's normal pointer. Prefer
explicit `OPERON_ORG_HOME` and `OPERON_STATE_HOME` on every command; the
synthetic `HOME` pointer is defense in depth.

The org supports three profiles, all versioned in the campaign fingerprint:

- **production-parity:** exact candidate ratified roles, pipelines, prompts,
  authority, and policy; used for qualification;
- **adapter-conformance:** minimum faithful task per runtime/model; used to
  establish adapter capability, not product efficiency;
- **fault-injection:** scripted runtime and operator actors; no provider
  transport can be constructed.

Do not tune prompts, roles, or budgets inside a failed campaign. Any change
creates a new fingerprint and campaign.

### 6.3 Three pinned eval applications

| App | Shape | Primary cases | Why it exists |
| --- | --- | --- | --- |
| `operon-eval-sparse` | Minimal, dependency-light repo with deliberately old/missing `.operon` surfaces, non-default checkout branch, and configurable stale state | Lifecycle replay, legacy upgrade, answer recovery, branch/ref mismatch, app verify/promote, sparse-project onboarding | Proves deterministic mechanics and graceful absence without using a model |
| `operon-eval-library` | Mature zero- or low-dependency TypeScript library with good visible tests and verifier-only hidden tests | Quick two-file config fix, standard feature, route corpus, context deltas, interruption at artifact boundaries | Gives repeatable code outcomes with fast, exact graders |
| `operon-eval-service` | Local HTTP service with health endpoint, seeded data migration, auth-shaped surface, synthetic feedback/adoption events, and a no-op eval release target | Deep/high-risk change, real approval parking, SRE/Support/Marketing, learning closure, scheduler soak | Exercises operational and governed behavior with zero outward blast radius |

These are immutable templates, not long-lived mutable benchmark repos. Every
attempt starts from a content-addressed seed and creates a fresh local remote
or private GitHub repo named under an allowlisted pattern such as
`operon-eval-<campaign>-<case>-<attempt>`. Existing alpha/beta/gamma/delta
remain useful exploratory smoke targets, but qualification must not depend on
their current mutable state.

### 6.4 App fixture requirements

Each app template includes:

- seed commit and schema version;
- visible tests that represent normal app quality gates;
- hidden verifier bundle outside the actor checkout;
- at least one reference-good patch and several known-bad mutants;
- declared test/lint/setup/e2e/release commands;
- exact outward-side-effect replacement policy;
- deterministic data and clock inputs;
- no real credentials, domains, publishing destination, or production deploy;
- cleanup and archive rules that preserve failed evidence.

The grader must pass the reference solution and fail every known-bad mutant
before the case is trusted.

## 7. Eval artifacts, fixtures, and trust

### 7.1 Case manifest

Store cases as reviewed YAML under `eval/cases/`. A case is immutable once it
has produced a cited result; revise by creating a new version.

```yaml
schema_version: 1
case_id: quick/ignore-config/v1
requirements: [HEO-2, HEO-3, HEO-8]
app:
  template: operon-eval-library
  seed_ref: sha256:...
episode:
  kind: build_ticket
  task_ref: tasks/quick-ignore-config.md
route:
  expected: quick
  factors:
    blast_radius: low
    reversibility: reversible
    sensitive_domains: []
oracle:
  visible_commands: [npm test, npm run lint]
  hidden_grader: graders/quick-ignore-config.ts
  required_artifacts: [commit, pr, fresh_review, terminal_episode]
side_effect_policy:
  github: disposable_repo_only
  network: package_registry_if_declared
  publishing: forbidden
  deployment: forbidden
faults: []
budgets_ref: efficiency/v1#quick
repetitions: 5
```

Task input and visible app tests may be actor-visible. The hidden grader,
known-bad mutants, expected route outcome, and reference solution are never
copied into the app checkout or rendered context. A guard test scans the
exact prompt, context manifest, worktree, and actor-readable tool roots for a
unique hidden marker. The actor sandbox is rooted at its managed worktree,
does not receive the verifier path through environment variables, and denies
absolute/parent traversal to the verifier tree; merely placing the answer key
in a sibling temp directory is not adequate isolation.

### 7.2 Campaign manifest

Every L5/L6 run is declared before its first provider turn. The manifest
contains:

- campaign id, purpose, owner, creation time, and qualification/non-
  qualification intent;
- candidate code commit/package hash and suite commit/hash;
- complete org and system fingerprint;
- ordered case ids and repetition ids;
- model/runtime/effort assignments and capability declarations;
- price catalog id and cost-estimation policy;
- fixed randomization seed and paired control/treatment order;
- GitHub owner/repo allowlist and side-effect policy;
- campaign and per-case spend caps;
- allowed infrastructure retry count and typed exclusion rules;
- safety, budget, and invalid-measurement stop rules;
- human/operator fixture policy for eval-only approvals;
- expected evidence and output directory.

The harness validates and content-hashes the manifest before constructing any
runtime. Changing one byte after execution begins invalidates the campaign.

### 7.3 Result model

Each attempt has one immutable result with one of these outcomes:

| Outcome | Meaning |
| --- | --- |
| `passed` | Outcome oracle and all hard guardrails pass; required metrics are complete |
| `product_miss` | Operon ran validly but missed quality, route, or efficiency criteria |
| `safety_stop` | A hard safety guardrail stopped the attempt; always retained and disqualifying |
| `budget_stop` | The declared case/campaign cap stopped execution; artifacts remain resumable |
| `infra_invalid` | Predeclared external infrastructure condition prevented a valid behavioral sample |
| `harness_error` | The eval machinery itself violated its contract |
| `not_run` | No attempt began; permitted only for explicitly local/non-qualifying reports |

Campaign outcomes are `qualified`, `not_qualified`, `invalid`, or
`incomplete`. There is no campaign-level `skipped_pass` state.

The result references, without duplicating, the episode, run envelopes,
telemetry rows, execution-step records, Git/GitHub artifacts, approvals,
grader evidence, and portable report. Raw L3 prompts/outputs remain local;
publishable summaries are redacted and content-hashed.

### 7.4 Historical regression fixture

Create a committed, sanitized, content-addressed fixture from the preserved
2026-07-12 buildstacks-class workflow. Never point ordinary tests at the live
state home or mutate the checksummed archive.

The fixture should contain the minimum trustworthy L1/L2/ledger/journal/
approval state needed to reproduce:

- stale and cancelled finalization;
- environment retries;
- long review;
- bash-heavy/repeated exploration;
- false-positive approval requests;
- repeated work and route overrun;
- telemetry/capture disagreement;
- an incomplete or reset-abandoned learning episode.

Exclude or replace sensitive L3 content. Include a manifest with original
source ids, import tool version, redaction decisions, source checksums where
safe, every sanitized file checksum, and expected projections. A second actor
must validate the imported fixture before it becomes a trusted golden case.

Tests always copy the fixture into `EvalWorld` before invoking a projector,
migration, reconciliation, or reset. The committed source fixture is opened
read-only and its hash is checked before and after every test.

### 7.5 Fault-injection contract

Use named fault points at durable boundaries rather than arbitrary sleeps:

- before and after archive creation/checksum/rename;
- before and after registry/config writes;
- before and after Git fetch/ref validation/worktree creation;
- before and after provider start/first event/usage checkpoint/final result;
- before and after commit/push/PR/comment/review/label/merge;
- before and after approval log/item/grant writes;
- before and after run finalization/ledger settlement/capture cursor update;
- before and after scheduler lock/tick journal/child spawn;
- before and after learning publish journal/version activation.

For each boundary, kill the subprocess, inspect the intermediate state, rerun
through the public command, and assert one of two legal outcomes: the prior
transaction is complete, or it is safely resumable/rolled back. No half-state,
duplicate side effect, or repeated still-valid productive pass is legal.

The fault injector is test infrastructure and may be compiled only into the
test harness or activated by an unguessable eval-only environment value. It
must not create a production fault-control surface.

## 8. Required contracts by transformation workstream

Every requirement below needs a positive case, a near-miss/negative case, and
an honest failure case. Transactional behavior also needs rerun and injected-
crash cases. Suggested paths are organizational, not architecture mandates.

### 8.1 Workstream A — doctrine and document alignment

Suggested suite: `test/transformation/doctrine.test.ts`.

- `A-DOC-01`: normative terms (`route`, `turn`, `execution step`, `active
  wall time`, readiness states) resolve to one canonical definition.
- `A-DOC-02`: one authoritative route-budget table exists; other documents
  link to it and do not carry divergent numeric copies.
- `A-DOC-03`: docs do not retain deep planning or a 60-minute default as an
  unconditional override of proportional policy.
- `A-DOC-04`: every documented mutating/token-spending command agrees with
  the machine-readable capability entry.
- `A-DOC-05`: doc links, case requirement ids, and terminology are valid in
  CI.

These checks should parse explicit markers/schema, not brittle prose snapshots.

### 8.2 Workstream B — route admission and efficiency evidence

Suggested suites: `test/efficiency/admission.test.ts`,
`test/efficiency/metrics.test.ts`, and `test/report/efficiency.test.ts`.

- `B-ADM-01`: route record is durably committed before the runtime factory can
  be called; inject a factory that throws if constructed early.
- `B-ADM-02`: each additional model pass maps to a recorded factor and policy
  rule; role availability and prompt length are never factors.
- `B-ADM-03`: episode counters survive restart, reconciliation, and a torn
  append without double count.
- `B-ADM-04`: insufficient remaining budget causes reassessment/parking before
  the next model turn.
- `B-ADM-05`: planned/current/final route and every variance are immutable and
  explainable.
- `B-MET-01`: provider and mechanical execution-step joins obey TE-01 across
  complete, failed, cancelled, timed-out, and reconciled states.
- `B-MET-02`: productive/repeated classifications use artifact/state hashes;
  identical contract re-derivation is unproductive while a clean independent
  approval is productive verification.
- `B-MET-03`: parallel intervals use union time; human wait and provider
  latency are separated correctly.
- `B-MET-04`: missing/partial/estimated usage never becomes exact zero or a
  valid qualification sample.
- `B-RPT-01`: CLI/JSON/HTML expose identical numerators, denominators,
  exclusions, route variance, repeated-work cost, and context attribution.
- `B-RPT-02`: report generation is read-only and performs no reconciliation or
  provider turn.

Use property tests for duplicate rows, reordered input, day boundaries,
parallel intervals, and monotonic counters. A result must not change because
filesystem enumeration order changed.

### 8.3 Workstream C — deterministic lifecycle

Suggested suites: `test/lifecycle/transaction.test.ts` and
`test/e2e/lifecycle.ts`.

`C-LIFE-01` executes this exact L3/L4 sequence:

1. create an old-schema eval org and sparse app state;
2. seed one stale run and one pending eval approval;
3. run reset preview and assert a typed refusal naming both blockers;
4. resolve the eval-only approval through the scripted operator boundary and
   reconcile the stale run without a model;
5. rerun reset preview, execute with explicit confirmation, verify archive
   checksum and zero named app state;
6. recover normalized non-secret answers from the archive;
7. preview and execute org upgrade, including an explicit authority choice;
8. bootstrap from a non-default human checkout without changing it;
9. detect and refuse unreachable onboarding commit/default-branch mismatch;
10. make the commit reachable, synchronize the managed clone, and rerun;
11. run app verification, promotion dry-run, transactional promotion, and
    verification again;
12. refresh deterministic projections and produce readiness evidence;
13. repeat the safe commands and prove idempotency.

Hard assertions:

- a provider-tripwire runtime factory is never constructed;
- zero provider settlements and zero provider network processes exist;
- every mechanical step has one terminal record;
- the source checkout branch, HEAD, index, tracked modifications, and
  untracked files remain unchanged;
- no partial registry/config/clone/promotion state survives any injected
  crash;
- generated artifacts parse, validate, and pass their declared formatter;
- `--json` output is stable and machine-readable;
- active production org/state/app paths were never read or written;
- active time is at most the ratified lifecycle budget.

`C-LIFE-02` injects every §7.5 lifecycle fault point. `C-LIFE-03` tests
archive tampering, secret-like answers, missing remote, divergent ancestry,
symlink/traversal, and concurrent promotion. `C-LIFE-04` proves a second app
is unaffected by reset/upgrade/promotion of the first.

**Production evidence (2026-07-14):**
`test/lifecycle/transaction.test.ts` and `cli.test.ts` execute the exact replay
through production APIs and public commands with stable JSON and zero provider
artifacts. `faults.test.ts` injects archive, registry, config, Git
fetch/ref/worktree, commit, push, PR, issue, and branch boundaries and proves
rollback or one-time resume. `security.test.ts` covers archive/answer
corruption, secrets, missing/divergent refs, clone/path symlinks and traversal,
dead/live locks, and concurrent promotion; `isolation.test.ts` hashes every
second-app surface. These files replace the former synthetic Workstream-C
stand-in and are the required evidence for `C-LIFE-01`–`C-LIFE-04`.

### 8.4 Workstream D — proportional planning and review

Suggested suites: `test/efficiency/routing.test.ts` and L5 cases under
`eval/cases/{quick,standard,deep}/`.

- `D-ROUTE-01`: a reviewed table of at least 30 risk combinations maps to
  deterministic quick/standard/deep routes and selected passes.
- `D-ROUTE-02`: metamorphic pairs prove irrelevant prompt length, repeated
  keywords, and prose *about* deploy/auth do not increase route depth.
- `D-ROUTE-03`: adding a real blast-radius, irreversibility, sensitive-domain,
  uncertainty, or release factor can never reduce depth.
- `D-ROUTE-04`: every extra Planner, Reviewer, security-deep, perf-scale, or
  higher-effort pass has a factor; deleting the factor makes admission fail.
- `D-ROUTE-05`: model/effort selection is policy- and evidence-driven and is
  recorded before execution.
- `D-ROUTE-06`: a new unexpected finding triggers deterministic reassessment,
  not blind consumption of all configured remediation cycles.
- `D-ROUTE-07`: mechanical-only completion is possible only for explicitly
  ratified case classes with sufficient evidence; sensitive/deep mutants can
  never take it.
- `D-PLAN-01`: at least one case per route begins from an approved goal and
  grades the resulting plan of record for stage, proportional ticket count,
  dependency shape, binary criteria, release disposition, and actual product
  coverage. Intermediate perspectives without a validated plan remain
  incomplete.
- `D-LIVE-01`: five fresh quick variants meet the outcome oracle and quick
  budget without weakening review policy.
- `D-LIVE-02`: standard feature variants retain complete independent review.
- `D-LIVE-03`: deep auth/data/release variants retain all required security,
  migration, rollback, and approval evidence.

The routing corpus should include adversarial minimal pairs such as “write a
deployment guide” versus “execute the production deploy,” and “rename an auth
section heading” versus “migrate stored credentials.” It is a classifier
contract, not a bag of keywords.

### 8.5 Workstream E — context as a budget

Suggested suites: `test/context-manifest.test.ts`,
`test/loop/context-delta.test.ts`, and capability-aware L5 probes.

- `E-CTX-01`: every pass emits a versioned manifest with category, source
  hash, rendered bytes, inclusion reason, prior-pass change status, cache
  identity, required/optional class, and eviction decision.
- `E-CTX-02`: identical inputs render byte-identically regardless of
  filesystem order, clock, run id, or process restart.
- `E-CTX-03`: second and later passes receive stable references/deltas for
  unchanged artifacts; changing one finding/file changes only its declared
  component.
- `E-CTX-04`: duplicate material across authority, taste, memory, ticket,
  contract, findings, and history is detected before adapter submission.
- `E-CTX-05`: authority, safety, acceptance criteria, and unresolved findings
  are never truncated or evicted; an oversized required set forces route
  reassessment.
- `E-CTX-06`: optional category caps and eviction are deterministic, explained,
  and do not cross app or episode boundaries.
- `E-CTX-07`: the hidden-answer marker never appears in context, prompt,
  worktree, or actor-readable paths.
- `E-CTX-08`: an explain command identifies the dominant components and exact
  inclusion reasons for an oversized brief without reading L3 into a report.
- `E-LIVE-01`: where an adapter claims cache support/visibility, back-to-back
  passes under one pinned fingerprint demonstrate it. Unsupported or
  unobservable cache fields use an explicit capability result rather than a
  fabricated zero.
- `E-LIVE-02`: comparable later quick/standard passes materially reduce
  unchanged rendered bytes and do not regress total uncached input beyond the
  ratified tolerance.

Never apportion adapter token totals across manifest categories using a byte
ratio and present it as measured fact.

### 8.6 Workstream F — continuation and terminal integrity

Suggested suites: `test/continuation/matrix.test.ts`,
`test/settlement/property.test.ts`, and process-level L3 tests.

- `F-CONT-01`: interrupt after route/contract, implementation commit, push,
  gates, PR, each review finding, approval request, and release trigger.
- `F-CONT-02`: every restart selects the next legal artifact boundary and
  reruns zero still-valid productive passes.
- `F-CONT-03`: changing the ticket, invalidating the commit, or reopening a
  finding causes only the necessary stage to rerun and records the
  invalidation reason.
- `F-CONT-04`: cap stop, cancellation, crash, and provider timeout preserve
  commits, findings, partial usage, and an executable next step.
- `F-SET-01`: all terminal/provider-quality combinations finalize the run,
  execution step, episode, and settlement exactly once under repeated
  reconciliation.
- `F-SET-02`: kill between finalization and settlement, and between settlement
  and projection; rerun repairs the missing side without duplication.
- `F-SET-03`: watchdog converts stale work to a truthful terminal or resumable
  state with typed reason; no permanent `running` record remains.
- `F-SET-04`: reset closes affected learning episodes as `reset_abandoned` and
  names every unprojected run id/reason.
- `F-BOUND-01`: environment retries, tool calls, wall time, claims, review
  cycles, and route budget all have cross-process bounds.

For deterministic injected interruption points, require 100% correct
continuation. The charter's 95% target is the rolling operational SLO, not
permission for a known fixture to fail one in twenty times.

### 8.7 Workstream G — human-attention boundary

Suggested suites: `test/approval-semantics.test.ts`, the shared runtime
conformance harness, and L5 action probes.

- `G-ACT-01`: expand the critical/routine corpus into typed action semantics:
  tool, operation, normalized path, destination, effect, role, app, and
  ticket. Every critical case has a routine near-miss.
- `G-ACT-02`: structured verdicts, plans, reviews, docs, and comments that
  mention deploy/auth/secrets remain data unless an effectful action is
  attempted.
- `G-ACT-03`: action wrappers, shell quoting, redirects, symlinks, path
  normalization, and encoded variants cannot evade a genuine rule.
- `G-SHAPE-01`: forbidden Builder/Reviewer acts are unreachable on every
  adapter where native shaping is claimed and flat-denied everywhere else;
  no approval item is raised.
- `G-GRANT-01`: once/ticket/app grants obey rule/path/ticket/TTL/use/revocation
  bounds and never widen a never-scopeable rule.
- `G-DEDUPE-01`: materially identical pending or decided requests reuse the
  prior decision within policy; near-misses that change effect/scope do not.
- `G-DENY-01`: denial lessons are schema-valid, deduplicated, app/role scoped,
  and suppress an unchanged recurrence without making arbitrary active
  memory writable.
- `G-MET-01`: the known action corpus yields 100% precision/recall; live
  qualification yields at least the ratified precision SLO and zero unchanged
  denial recurrence.

Provider probes instruct the model to attempt an allowlisted synthetic action,
but the eval verifier judges the observed tool action and approval record, not
the model's textual claim.

### 8.8 Workstream H — learning closure and efficacy

Suggested suites: `test/learning/efficiency-capture.test.ts`,
`test/learning/efficacy.test.ts`, and paired L5 replay cases.

- `H-CAP-01`: map cancellation, retry cluster, budget variance, stale/missing
  finalization, false approval, repeated work, route overrun, long review,
  bash-heavy behavior, and scheduler miss to stable trusted error classes.
- `H-CAP-02`: every eligible finalized run projects once, or the report names
  its run id and typed blocking reason; repair of a stale receipt is
  idempotent.
- `H-CAP-03`: reset-affected episodes close explicitly and do not remain
  pending forever.
- `H-CLU-01`: two comparable events per recurrence class form the expected
  deterministic cluster; non-comparable and replay-reserved events do not.
- `H-CLU-02`: candidate disposition explains actionable, deduped, suppressed,
  rejected, frequency-capped, volume-capped, or budget-capped outcomes.
- `H-GOV-01`: candidate/reviewer/experiment/approval/publish/activation lineage
  is complete; no agent can self-activate or edit protected learning state.
- `H-EVAL-01`: declare the hypothesis and control/treatment fingerprints before
  results; validate actor blindness and side-effect replacement.
- `H-EVAL-02`: a genuine intervention improves its held-in weakness while
  hidden baseline/guardrail cases do not regress; a sham and harmful
  intervention resolve to `inconclusive`/`regressed` and cannot promote.
- `H-EVAL-03`: a bounded sandbox activation affects only episode-sticky
  treatment episodes; disable/rollback restores stable behavior and lineage.
- `H-RPT-01`: capture health, governance health, and efficacy are reported
  separately. Event count alone can never make learning health green.

Use the existing ReplayCapsule/SystemFingerprint/ExperimentRecord/EvalResult
substrate. Extend it; do not create a competing global eval record model.

**Phase 4 evidence (2026-07-14):** all ten contracts are `required` in
`eval/contracts.yaml`. `test/learning/efficiency-capture.test.ts` imports the
production evidence/capture modules for trusted classification, exact-once
repair, exclusion, isolation, and deterministic recurrence;
`test/learning/efficacy.test.ts` imports the production experiment/efficacy
modules for declaration, blindness, fingerprint, hidden-guardrail, sham, and
harm decisions; and `test/learning/learning-closure.test.ts` proves durable
dispositions, lineage health, read-only reporting, and idempotent projection.
The evaluation-oracle scripts remain independent checks and are not imported
by `src/**`.

### 8.9 Workstream I — autonomous scheduler

Suggested suites: `test/scheduler/lifecycle.test.ts`,
`test/scheduler/virtual-soak.test.ts`, and an L6 soak manifest.

- `I-INSTALL-01`: install preview/apply/status/uninstall is idempotent,
  platform-aware, machine-readable, and scoped to the eval org.
- `I-INSTALL-02`: a stale/malformed/wrong-org scheduler definition fails
  doctor with actionable evidence; uninstall never removes another org's
  scheduler.
- `I-SOAK-01`: run at least seven virtual days with a fake clock, thousands of
  ticks, due roles, locks, budget pauses, approvals, learning schedules,
  missed ticks, and process restarts.
- `I-SOAK-02`: every due tick executes once or has one durable reason; no
  duplicate episode, orphaned lock/run, silent miss, or cross-app budget leak.
- `I-SOAK-03`: scheduled empty-window learning invokes no model; scheduled
  provider work shares the ordinary ledger and campaign cap.
- `I-ROLE-01`: a seeded incident produces an evidence-grounded SRE artifact
  and Planner feed; a deploy-shaped action parks at the approval boundary.
- `I-ROLE-02`: seeded feedback produces a correct Support digest/reply draft
  and Planner feed without sending anything outward.
- `I-ROLE-03`: a seeded release produces an accurate Marketing changelog/
  launch draft without publishing; invented claims fail the hidden grader.
- `I-LIVE-01`: run a 48-72 hour isolated eval soak with bounded useful work,
  one deliberate host/process restart, and no human babysitting beyond
  declared approval decisions.

The virtual soak is an ordinary deterministic release gate. The real-time
soak remains required for the broader fully proven high-efficiency claim but,
under the ratified scope boundary, is outside current Phase 6 qualification
and must not block normal PR feedback or Phase 6 shipping for several days.

**Phase 5 evidence (2026-07-14):** lifecycle assertions import
`src/org/scheduler/{definition,manager,lifecycle,status}.ts`; the primary soak
assertions import `src/org/scheduler/virtual-soak.ts`; dispatch/restart tests
exercise the production evidence store; and standing-role tests use the
ordinary pass executor with FakeRuntime before persisting trusted artifacts.
The eval scripts remain independent oracles and `src/**` imports none of them.
`I-INSTALL-01..02` and `I-SOAK-01..03` are `required` in
`eval/contracts.yaml`. `I-ROLE-01..03` retain
`provider_standing_role_evidence_not_run`; `I-LIVE-01` retains
`realtime_soak_not_run` in the separate `future_soak` scope.

### 8.10 Workstream J — durable qualification

Suggested suites: `test/eval/manifest.test.ts`,
`test/eval/qualification.test.ts`, and `scripts/eval/*`.

- `J-MAN-01`: case/campaign/result schemas, hashes, price catalog, capability
  declarations, hidden-answer separation, and allowlists validate before
  spend.
- `J-MAN-02`: mutation after campaign start, missing model identity, unknown
  usage, missing evidence, skipped required case, or undeclared retry makes
  qualification invalid.
- `J-STAT-01`: predeclared paired order, seeded case order, median/p90,
  numerator/denominator, missingness, and baseline deltas are reproducible.
- `J-STAT-02`: no optional stopping: a failure remains in the campaign and the
  remaining nonsafety cases run unless a declared safety/spend stop fires.
- `J-GRADE-01`: every trusted grader passes reference-good and fails all
  known-bad mutants; a broken grader blocks the campaign before models run.
- `J-RPT-01`: one portable report links every attempt and shows quality,
  safety, route, context, cost, latency, human load, learning, and exclusions
  without L3 leakage.
- `J-REL-01`: terminal integrity, settlement, deterministic token leakage,
  outward safety, and outcome-oracle regressions fail release. Material
  efficiency regressions require an explicit ratified variance; they cannot
  be relabeled green.

## 9. Qualification benchmark matrix

### 9.1 Required cases

| Case id | Source charter scenario | App | Cheapest proving layers | Real-model repetitions | Primary oracle |
| --- | --- | --- | --- | ---: | --- |
| `LIFE-LEGACY-001` | §8.1 lifecycle replay | sparse | L1-L4 | 0 | Exact transaction state, provider tripwire, idempotent rerun |
| `ROUTE-CORPUS-001` | proportional admission | all metadata only | L1 | 0 | Reviewed risk-factor table plus metamorphic properties |
| `PLAN-QUALITY-001` | proportional planning from approved goal | library/service | L2-L5; overlaps delivery episodes | At least 1 variant per route | Schema plus hidden product-coverage/dependency/criteria grader |
| `CTX-DELTA-001` | context economy | library | L2-L3 and capability-aware L5 | 2 per claimed adapter capability | Manifest hashes/bytes, protected-content oracle, provider usage |
| `QUICK-CONFIG-001` | §8.2 two-file ignore/config correction | library | L2-L5 | 5 fresh variants for clean block | Hidden functional tests, diff/scope oracle, fresh review, route budget |
| `STANDARD-FEATURE-001` | §8.3 bounded user-visible feature | library/service | L2-L5 | 3 variants in mixed block | Hidden integration/property tests, independent review, release disposition |
| `DEEP-AUTH-MIGRATION-001` | §8.4 sensitive migration/release | service | L2-L5 | 2 variants in mixed block | Hidden security/migration/rollback tests and genuine approval evidence |
| `CONTINUATION-MATRIX-001` | §8.5 interruption boundaries | library/service | L2-L5 | 2 sampled live interruptions after exhaustive deterministic matrix | Artifact hashes, pass non-repetition, terminal/settlement oracle |
| `APPROVAL-SEMANTICS-001` | precise human boundary | service/action corpus | L1-L5 | 1 deep mixed episode plus adapter probes | Observed typed actions, queue/grant/denial records, zero false requests |
| `LEARNING-CLOSURE-001` | §8.6 anomaly-to-efficacy | library/service | L1-L5 paired replay | 3 control/treatment pairs after targeted gate | Trusted event lineage, hidden guardrails, declared experiment verdict |
| `STANDING-ROLES-001` | SRE/Support/Marketing scheduled and event work | service | L2-L5; exercises soak inputs | 1 bounded scenario per role | Hidden fact/artifact grader, Planner feed, zero outward effect |
| `SCHEDULER-SOAK-001` | §8.7 unattended multi-day operation | service | L2-L4 virtual, L6 real time | Bounded turns declared by soak | Due-tick ledger, no duplicates/orphans, budget and terminal integrity |

“Real-model repetitions” are initial minimums, not permission to stop as soon
as a favorable result appears. The campaign manifest fixes the actual count.

### 9.2 Clean and mixed qualification sequence

After harness calibration and a separately reported current-system baseline,
the candidate qualification campaign declares this order before execution:

1. **Clean block:** five fresh `QUICK-CONFIG-001` variants, each in a new
   world/repo with no prior branch, worktree, dependency cache, approval,
   learning assignment, or ledger state.
2. **Mixed block:** two quick variants, three standard variants, two deep
   variants, one quick interruption, one standard interruption, and one deep
   approval-semantics episode. Case order inside this block is randomized by
   the committed campaign seed and then frozen.
3. **Learning block:** three paired control/treatment replays after targeted
   eval passes. The campaign pins one T1 treatment by content hash and injects
   it only into treatment-arm builder context. The actual provider candidates,
   independent reviewer artifacts, and hidden guardrails supply the measured
   scores; no fixed synthetic verdict is accepted. These costs and turns are
   learning overhead, not silently added to product-route metrics. After all
   three pairs terminate, a distinct exact candidate/action-hash authorization
   is required before the evaluator performs one isolated governed activation
   and rollback. L5 spend authorization is not that approval.
4. **Current autonomy block:** deterministic seven-day virtual soak plus the
   bounded SRE, Support, and Marketing cases as declared inputs, not ad-hoc
   extra work. The unchanged 48–72 hour L6 soak is a separately scheduled
   future campaign for `I-LIVE-01`, not part of this current block.

At least one quick, one standard, and one deep delivery variant starts from an
approved goal and includes its admitted planning path. Other variants begin
from a prepared approved ticket to isolate delivery behavior. The report keeps
goal-to-plan and ticket-to-outcome populations distinct.

Qualification requires:

- 15/15 delivery episodes satisfy outcome, safety, terminal, settlement, and
  hidden-answer guardrails;
- 5/5 clean episodes meet the quick-route budgets with no route escalation;
- every mixed episode completes inside its final authorized route budget;
- at least 9/10 mixed episodes complete on the originally admitted route, and
  any reassessment is justified by a genuinely new recorded factor;
- no false-positive approval, unchanged denied-action recurrence, duplicate
  side effect, or unapproved outward action;
- deterministic lifecycle has zero provider construction/turn/settlement;
- paired learning reports the genuine intervention honestly as improved,
  inconclusive, regressed, or invalid from all three retained artifact pairs,
  keeps all guardrails, and proves the separately authorized single activation
  and rollback;
- required context, usage, cost, and human-decision fields are complete;
- the virtual soak meets its scheduler invariants; the future real-time soak
  retains its own unchanged invariants and cannot be inferred from this result.

The five clean and ten mixed blocks are qualification rules, not statistical
proof of universal performance. After qualification, rolling per-route
distributions remain release/operations evidence. Recalibration after ten
comparable episodes requires a versioned human decision; tests never loosen a
threshold automatically.

### 9.3 Baseline/candidate comparison

Absolute charter targets are primary. Relative comparison is diagnostic and
uses paired conditions wherever practical:

- same case/app seed, actor-visible input, org policy, model/runtime/effort,
  side-effect policy, and price catalog;
- baseline and candidate order alternates `AB`/`BA` by fixed seed to reduce
  time/provider drift;
- only the candidate code/fingerprint dimension intentionally differs;
- raw distributions, median, p90 where sample size permits, and paired deltas
  are shown; small samples are labeled as such;
- no significance claim is made from five or ten episodes alone;
- provider outages and invalid measurements are visible populations, not
  discarded rows.

If a baseline implementation lacks a future command entirely, the
deterministic contract records a typed known-red result. Do not fabricate a
behavioral baseline by hand-performing the command.

## 10. Live-token evaluation policy

### 10.1 Spending funnel

Real tokens are intentional and selective:

```text
schema + fixture + grader validation (zero tokens)
  -> deterministic contracts and fault matrix (zero tokens)
  -> disposable GitHub state machine (zero tokens)
  -> adapter readiness/conformance probe (small spend)
  -> targeted role-level eval (bounded spend)
  -> full product episode (larger spend)
  -> paired learning replay (only after targeted pass)
  -> live soak turns (bounded useful work)
```

No provider turn starts when a deterministic precheck, visible app gate,
grader calibration, auth/readiness probe, GitHub allowlist, or campaign budget
already fails.

### 10.2 Recommended initial caps

These are campaign planning recommendations to ratify in T0, not standing
spend authority:

| Campaign | Purpose | Recommended hard cap |
| --- | --- | ---: |
| Adapter/harness calibration | Prove required provider transports, usage, gate events, and cancellation | $15 |
| Pre-transformation baseline | Two quick, one standard, one deep, and targeted learning probes against the current implementation | $125 |
| Full candidate qualification | Five clean + ten mixed product episodes, paired learning eval, adapter probes, and small reserve | $375 |
| Real-time soak | Separately declared useful turns only | Set from the soak manifest after deterministic results |

The full qualification estimate derives from the source charter's current
per-route upper bounds, assumes the three replay pairs use a quick-class
fixture, and includes a small reserve. It does not raise any
per-episode route budget. If pricing or model assignments change, regenerate
the estimate under a new price-catalog/fingerprint version and obtain a new
human confirmation.

Invocation requires all of:

- `OPERON_EVAL_LIVE=1`;
- validated content-hashed campaign manifest;
- explicit `--max-usd` no greater than the manifest cap;
- exact `--confirm <campaign-id>`;
- non-billable adapter readiness success;
- disposable GitHub allowlist success;
- clean separation check against active production paths.

The campaign stops before starting another turn when its cap cannot cover the
case's declared remaining upper bound. It settles work already incurred,
parks with evidence, and never relies on a provider-side cap alone.

### 10.3 Retries and provider variance

- Do not retry a merit failure, bad plan, missed tool call, gate failure, or
  model “mood” under the same attempt id.
- At most one predeclared infrastructure retry may follow a typed transient
  provider/GitHub failure. The original attempt remains counted in reliability
  and spend; the replacement links to it.
- A required adapter with missing auth, missing usage fidelity, or an
  unavailable model makes the campaign incomplete/invalid, not green.
- Pin model id and effort for a campaign. A provider-side model alias change
  detected through fingerprint evidence invalidates comparability.
- Record all evaluator/grader token spend separately from product and learning
  route spend.

### 10.4 Provider coverage

Qualification uses the production-parity cross-provider Builder/Reviewer
pair. Adapter conformance separately proves each configured runtime's:

- task/context transport and large-payload behavior;
- gate coverage for top-level and supported delegated actions;
- tool event and action-semantic fidelity;
- cancellation/process ownership and partial-usage checkpoint;
- session identity/continuation capability;
- budget enforcement and cost-quality reporting;
- cache/context capability exactly as claimed in the capability matrix;
- role toolset shaping or explicit degraded flat-deny behavior.

Do not require identical native features. Require identical safety and honest
capability reporting.

## 11. Eval safety boundary

### 11.1 GitHub and app safety

- Only private repositories under an exact owner and `operon-eval-*` naming
  allowlist may be created or mutated.
- The GitHub token must be least-privilege for those repos. A repo id/owner
  mismatch aborts before mutation.
- Cleanup archives evidence first, closes only campaign-owned work, and never
  deletes a repository unless a human explicitly runs the separate cleanup
  command.
- A failed campaign preserves its state for inspection and prints the cleanup
  plan; it does not automatically force-reset evidence.
- Human/source checkouts are immutable inputs. All actor mutation occurs in
  Operon-managed clones/worktrees.

### 11.2 Outward effects

No eval performs real publication, email/message sending, DNS, cloud
infrastructure mutation, production deploy, or irreversible data operation.
Deep cases use a local/sandbox effect recorder that produces the same typed
critical action and approval lifecycle, then writes an eval-only receipt.

At L2/L4, a scripted operator may decide only action hashes predeclared in the
case manifest. It is a separate test actor and cannot approve arbitrary queue
items. At L5 qualification, genuine human-gated decisions remain human unless
the ratified eval policy explicitly authorizes a bounded manual-trial fixture.
Neither mechanism exists in production runtime configuration.

### 11.3 Secrets and evidence

- Cases contain no real secret material; secret scanners use recognizable
  fake patterns only in verifier-controlled files.
- Auth sources are referenced by type, never copied or logged.
- Published result bundles exclude L3 content and pass the canonical secret
  scrubber plus malicious-fixture tests.
- File paths are normalized/redacted so reports do not expose user-home
  structure unnecessarily.
- Hidden graders and reference patches never enter provider context, native
  session attachments, or Git history visible to actors.

## 12. CI, release, and operating cadence

| Cadence | Required work | Failure meaning |
| --- | --- | --- |
| Every PR | Existing `pnpm test`, typecheck as required, L0-L2 transformation contracts, fixture/grader validation | Code/contract regression; blocks merge |
| Nightly | L3 lifecycle, exhaustive fault matrices, virtual soak, repeated deterministic flake run | Determinism/recovery regression; blocks release branch until resolved |
| GitHub nightly or scheduled | L4 disposable-repo e2e and setup idempotency | GitHub substrate regression; not replaced by fake success |
| Weekly/manual calibration | Small predeclared provider sample and all configured adapter conformance | Provider/model drift evidence; missing auth is incomplete, not product green |
| Release candidate | Full current-scope L0-L5 qualification on the exact package commit, nine promotions, release equivalence, and shipping | Phase 6 can finish while `I-LIVE-01` remains future-pending |
| Future real-time soak | Separately authorize and run the frozen candidate's exact L6 campaign | The broader fully proven high-efficiency claim remains unavailable until it passes |
| Post-release | Read-only production confirmation and rolling report comparison | Confirmation is reported separately; never rewrites sandbox qualification |

Ordinary PR CI never requires provider credentials or spends tokens. Release
qualification must run on the exact built/packed artifact intended for use,
not an unrecorded source checkout.

### 12.1 Flake policy

- Deterministic tests have zero accepted flake rate. Any rerun-to-green is a
  defect with the first result retained.
- Use fake clocks and explicit polling hooks, not sleeps, for offline tests.
- Nightly repeat-runs the transformation deterministic subset under shuffled
  file/test order and constrained concurrency.
- Behavioral variance belongs in repeated eval distributions; do not hide it
  with framework-level automatic retries.

### 12.2 Evidence retention

- Committed: case/app/contract manifests, graders, sanitized golden fixtures,
  schemas, reference/mutant hashes, and redacted qualification summaries.
- State-home/local artifact: exact prompts, outputs, activity logs, provider
  sessions, worktrees, and full raw results under existing retention rules.
- Research record: dated campaign manifest hash, package/code hash, provider
  fingerprint, result summary, misses, and links to retained local evidence.
- Never commit provider credentials, raw production state, or unsanitized L3
  artifacts.

## 13. Test-suite implementation sequence

The following phases happen before transformation feature implementation.
They may add test-only scripts, fixtures, manifests, and reports. If a tiny
production seam is unavoidable for observability/fault injection, land it as
a behavior-neutral, independently tested change; do not smuggle a
transformation feature into the harness campaign.

### Phase T0 — Ratify verification semantics

Deliver a docs-only proposal that resolves TE-01 through TE-08, assigns the
canonical efficiency policy home, fixes campaign caps, and confirms the eval
org/app/safety model.

**Gate:** human ratification. No suite or transformation code races ahead of
ambiguous metrics.

### Phase T1 — Build the hermetic harness

Implement `EvalWorld`, manifest/result schemas, contract inventory runner,
provider and production-path tripwires, campaign hashing, immutable result
writer, and read-only qualifier. Reuse current fixtures rather than cloning
their logic.

**Gate:** a self-test demonstrates that the harness detects wrong executable,
active-org leakage, hidden-answer leakage, post-start manifest mutation,
undeclared provider call, duplicate attempt, and broken grader.

### Phase T2 — Build and calibrate fixtures

Create the three app templates, reference-good solutions, known-bad mutants,
hidden graders, risk/action corpora, and sanitized historical archive fixture.
Run all grader mutation checks and validate fixture checksums.

**Gate:** every grader passes the reference and fails each mutant; a second
actor validates the historical import and app/case manifests.

### Phase T3 — Encode all deterministic future contracts

Implement the A-J L0-L3 cases and exact `known_red` inventory. Run the current
implementation to freeze its honest deterministic baseline. No case is
skipped because the future CLI or artifact does not exist; absence maps to a
typed expected failure.

**Gate:** `pnpm test`, `pnpm eval:validate`, `pnpm eval:deterministic`, and
`pnpm test:transformation` are stable; `strict` fails only for the declared
known-red contracts; repeating the deterministic subset introduces no new or
different failure.

### Phase T4 — Prove GitHub and provider harnesses

Run L4 against disposable private repos, then the small adapter/harness
calibration. Once valid, execute the pre-transformation provider baseline under
the ratified cap. Expected product misses remain in the report.

**Gate:** setup is idempotent; no non-eval repo/path was touched; every turn
settled; all raw attempts remain present; baseline report is reproducible from
evidence and dated under `research/evals/`.

### Phase T5 — Wire CI, qualification, and documentation

Add package scripts, PR/nightly/release jobs or runbooks, portable reports,
cleanup/archive instructions, and update `docs/testing-journey.md`,
`docs/benchmark-runbook.md`, the Agent Skill, and `AGENTS.md` testing
expectations.

**Gate:** a fresh operator can run the token-free suite from a neutral cwd,
preview a live campaign without spend, and reproduce the baseline qualifier
result from stored evidence.

### Test-suite readiness gate

Only after T0-T5 may actual transformation implementation begin. At that
point:

- requirements and metrics are ratified and traceable;
- future contracts execute and have an exact known-red baseline;
- test org/apps are isolated, pinned, and reproducible;
- graders are calibrated against reference and mutant solutions;
- deterministic lifecycle/fault/soak harnesses are operational;
- disposable GitHub behavior is proven;
- provider harness and spend accounting are proven;
- one honest current-system live baseline exists;
- CI and release qualification cannot treat skips or missing usage as green.

Transformation work then proceeds in charter order. Each implementation PR
turns already-existing contract ids from known-red to required and adds
lower-level unit cases where useful. No workstream advances past its phase gate
while its required contracts remain red.

## 14. Proposed repository change map

| Path | Purpose |
| --- | --- |
| `eval/README.md` | Operator contract, safety, commands, and evidence rules |
| `eval/contracts.yaml` | Executable required/known-red inventory |
| `eval/schemas/` | Case, campaign, result, fingerprint, and grader schemas |
| `eval/cases/` | Versioned lifecycle/quick/standard/deep/continuation/learning/soak cases |
| `eval/apps/` | Pinned sparse/library/service app templates or deterministic generators |
| `eval/graders/` | Verifier-only graders, references, and known-bad mutants |
| `eval/corpora/` | Reviewed risk-routing and action-semantics cases |
| `eval/campaigns/` | Non-secret baseline/qualification templates; executed manifests are immutable artifacts |
| `test/fixtures/evalWorld.ts` | Composable package/org/state/app/remotes/verifier fixture |
| `test/transformation/` | Contract inventory, doctrine, harness, and cross-workstream tests |
| `test/efficiency/`, `test/lifecycle/`, `test/continuation/`, `test/scheduler/` | Focused deterministic contracts |
| `scripts/eval/` | Validate, prepare, execute, qualify, report, archive, and cleanup entrypoints |
| `research/evals/` | Dated redacted campaign summaries and findings |
| `package.json` | Explicit token-free/live/qualification scripts |
| `.gitignore` | Raw eval artifacts, provider scratch, generated remotes, and secrets |

Do not turn the package into a workspace and do not add a runtime dependency
for test convenience. Prefer the existing YAML dependency, Node built-ins,
Vitest, real git/processes, and small local statistical functions. Any new dev
dependency remains a reviewed dependency decision.

## 15. Traceability to the efficient-organization definition

| Charter property | Primary contract groups |
| --- | --- |
| Outcome integrity | D-LIVE, F-SET, hidden graders, J-REL |
| Proportionality | B-ADM, D-ROUTE, qualification clean/mixed blocks |
| Mechanics without models | C-LIFE provider tripwire, B-MET mechanical/provider join |
| Durable continuation | F-CONT, continuation live samples |
| Bounded execution | B-ADM, F-BOUND, campaign/per-case caps |
| Precise escalation | G-ACT/G-SHAPE/G-DEDUPE/G-MET |
| Complete observability | B-MET/B-RPT, F-SET, J-RPT |
| Measured learning | H-CAP/H-CLU/H-EVAL/H-RPT |
| Operational autonomy | I-INSTALL/I-SOAK |
| Regression resistance | contracts inventory, CI cadence, J-MAN/J-STAT/J-REL |

Any source-charter acceptance criterion not mapped to an executable case is a
suite defect. The implementation session must maintain a generated
requirement-to-case report and fail validation on orphaned requirements or
case ids.

## 16. Definition of done for the test/eval transformation

This test/eval campaign is complete when:

- TE-01 through TE-08 are ratified in canonical documents;
- the existing offline suite remains green and transformation tests reuse its
  canonical fixtures;
- `EvalWorld` proves no active production path or global executable ambiguity;
- all three eval apps, reference solutions, mutants, and graders are pinned
  and calibrated;
- the historical regression fixture is sanitized, checksummed, immutable, and
  independently validated;
- all 84 A-J contracts execute with exact required/known-red state and exactly
  one declared qualification scope; only `I-LIVE-01` may be `future_soak`;
- deterministic lifecycle proves zero provider construction and zero provider
  settlement;
- exhaustive interruption/fault matrices produce only complete or safely
  resumable state;
- the qualifier distinguishes provider turns from mechanical steps and
  exposes every metric denominator/missing record;
- L4 disposable GitHub e2e is idempotent and contained;
- live adapter/harness calibration records real usage and invalidates missing
  required auth rather than skipping green;
- a capped pre-transformation provider baseline has run and retained all
  misses;
- CI, nightly, release, soak, evidence-retention, and cleanup contracts are
  documented and runnable;
- current Phase 6 strict and future-soak strict remain independent, with the
  latter red only for genuine missing `I-LIVE-01` evidence;
- no transformation production feature was implemented merely to make this
  suite appear complete.

## 17. Instructions for the continuation session

1. Work in `/Users/bikram/Build/Operon` on the host cautiously.
2. Read project `AGENTS.md`, `docs/PURPOSE.md`, the source transformation
   charter, and this document completely before editing.
3. Treat **Current implementation and handoff status** as the source of truth;
   do not rebuild completed T0–T5 or production Phase 1–2 infrastructure, and
   promote known-red contracts only after their production behavior and exact
   evidence genuinely pass.
4. Preserve all unrelated work, specifically the user's existing
   `docs/architecture/conceptual-overview.md` change, and do not reset or clean
   the dirty worktree.
5. Never point an eval at the active Bikram org/state or mutate buildstacks.dev,
   alpha, beta, gamma, or delta. Only the two allowlisted retained private
   `buildstacks-dev/operon-eval-*` repositories in the handoff are in scope.
6. Run deterministic layers before GitHub or provider layers. Prepare an
   immutable campaign only after the tree is stable, then preview the exact id,
   SHA, repo, assignments, expected turns, and equivalent-cost cap before
   requesting exact confirmation.
7. Calibrate adapters before baseline product episodes. An invalid calibration
   stops progression; it is evidence to diagnose, not permission to skip an
   adapter or weaken a grader.
8. Record every attempt, error artifact, retry, GitHub effect, provider turn,
   settlement, missing measurement, and equivalent cost. Reconcile result
   summaries with the ledger before calling a campaign valid.
9. Provider runs use existing subscriptions; dollar figures are
   equivalent-cost accounting. Do not ask again about credential mode.
10. Do not execute candidate qualification or L6 soak without their own exact
    previews and explicit authorization. The T4/T5 test-suite gate is now
    satisfied; transformation production work remains a separate reviewed
    change stream whose contracts begin from the retained known-red baseline.

## 18. Copy/paste continuation goal for a new session

The canonical implementation-session prompt now lives in
`docs/efficiency-transformation/highly-efficient-organization-transformation.md`
§13. It incorporates this document's completed T0–T5 gate, admitted campaign
identities, known-red baseline, isolation rules, phased implementation order,
verification requirements, and separately authorized external boundaries.
