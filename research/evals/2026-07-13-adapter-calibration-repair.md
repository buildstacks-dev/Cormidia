# Adapter calibration invalidation and repair — 2026-07-13 UTC

## Verdict

The retained campaigns
`adapter-harness-calibration-v1-20260713-524ab18c52d8` and
`adapter-harness-calibration-v1-20260713-dd84b826242c` are invalid and cannot
admit the pre-transformation baseline. Their disposable GitHub lifecycles
passed twice, but the first campaign's summaries do not reconcile with its
immutable grader evidence and ledger, while the authorized post-repair
campaign exposed authentication-readiness, hook-activation, and
scenario-budget defects. No result was edited or backfilled.

Campaign identity:

- manifest SHA-256:
  `dcb29ea4fb9691bc3e77289083f35e7bfd5190f3bfb69aafd1e641ffac764d83`;
- candidate package SHA-256:
  `f36be1749c3c4f6156c2bbc19a24d5f37d575bd0f18ca7dea04396fd45ec9434`;
- suite SHA-256:
  `8bf7527a64a6edb834518a6b9cd100aabc6ac9cd3624d26ed14f72cad25d855f`;
- private repository: `buildstacks-dev/operon-eval-adapter-calibration`;
- L4 evidence: issue #3, PR #4, commit
  `21286ad97fc9f4db4d6c7cc0e5b7893c0f5e513c`, non-approving review,
  squash-merge, issue closure, branch deletion, then exact idempotent replay;
- assignments: Claude `claude-opus-4-8`, Codex `gpt-5.5`, pi
  `claude-sonnet-4-6`;
- authorized equivalent-cost cap: $15.

The org ledger has 20 unique settlements (14 Codex, six pi), 1,011,173 input
tokens, 2,086 output tokens, and $5.118445 equivalent cost. The result files
report zero turns for Claude and both Codex attempts, and six zero-token turns
for pi. That mismatch is the central invalidation fact.

## Authorized post-repair campaign

The fresh, exactly authorized campaign
`adapter-harness-calibration-v1-20260713-dd84b826242c` retained a valid lock
with manifest SHA-256
`80dab924f2d952708179d9f17a799eaad198078c72d111f4c86b7552c05edda0`.
It targeted the private repository
`buildstacks-dev/operon-eval-adapter-calibration` under a $15 equivalent-cost
cap. Candidate package SHA-256 was
`ad37cb4e32dc32a6688ba09ffc832783f69396f70e38e82e078e69ee795379b1` and
suite SHA-256 was
`facc600f14f42f2161190064c2878c7d5a07890e8d54f52c353111899f7d9cfd`.

The L4 lifecycle passed and was then replayed idempotently: repository id
`R_kgDOTWn4rw`, issue #5, pull request #6, content-addressed commit
`e869fa3e21e496adf8d888a044ab490364fe8fd2`, comments, a non-approving review,
squash merge, issue closure, and branch deletion all verified. The first proof
remains the immutable `github-evidence-80dab924.json`; the second invocation
reported `idempotent_rerun: true` without rewriting that artifact.

L5 stopped before baseline admission with three immutable attempts and six
exactly-once provider settlements:

- Claude: `infra_invalid`, one failed zero-cost settlement. The provider
  returned `Not logged in · Please run /login` even though the persisted
  non-billable readiness artifact had claimed
  `provider=firstParty; auth=none` as ready.
- Codex: `budget_stop`, four settlements, 303,838 input tokens, 1,069 output
  tokens, and $1.55126 estimated equivalent cost. Transport, gate, and
  delegated scenarios completed, but continuation's first accounting update
  cost $0.468325 and crossed its obsolete $0.1875 scenario cap.
- pi: `infra_invalid`, one failed zero-cost settlement. Its first provider
  turn returned `No API key for provider: anthropic` even though readiness had
  treated an expired OAuth record as resolved.

The campaign stayed below the authorized cap and never ran the baseline. Its
readiness/result/run/ledger disagreement is diagnostic evidence, not a pass.

## Root causes

1. Claude produced a terminal max-budget SDK result, then its iterator rejected
   because the owned CLI exited non-zero. `ClaudeRuntime` threw away the
   already-observed terminal result and its usage.
2. Codex's cancellation probe aborted before a usage checkpoint. The grader
   correctly marked aggregate usage unavailable; result validation then failed
   and the executor's catch path replaced all observed turns with a zeroed
   summary. Approval callbacks also failed to see auto-approved command paths,
   so they could not by themselves substantiate gate fidelity.
3. Pi emitted terminal assistant errors for unusable authentication, but
   `PiRuntime` interpreted the resolved prompt as successful completion and
   reported zero usage. Its readiness probe copied auth into memory, so a
   rotating OAuth refresh could not update the source credential safely.
4. Calibration called adapters directly and synthesized ledger rows instead of
   using the ordinary pass executor. That made its forensic contract weaker
   than the product path it was meant to qualify.
5. Provider processes inherited more host configuration and environment than
   a hermetic eval needs.

## Repairs

- Claude now retains an explicit non-success terminal result and usage if the
  SDK subsequently rejects; success-followed-by-rejection still fails loudly.
- Pi now maps terminal assistant `stopReason: "error"` messages to `failed`,
  classifies authentication-like failures as `error_auth`, and preserves honest
  zero usage rather than inventing completion.
- Pi readiness uses its file-backed auth store. Live eval resolves a rotating
  credential in that source store before copying the usable auth into fresh
  campaign scratch.
- Calibration scenarios run through the ordinary one-pass executor. Each gets
  `envelope.json`, `events.jsonl`, `brief.md`, `prompt.md`, `output.md`, and
  `session.log`, one exactly-once ledger settlement, and a result `run:` ref.
- The cancellation probe waits for its first usage checkpoint, with a bounded
  fallback, and downstream validation/persistence failures retain every
  observed turn.
- Codex starts a per-turn fail-closed Unix-socket bridge. Supported simple Bash,
  `apply_patch` (every changed file), and MCP `PreToolUse` calls reach the real
  Operon gate; approval callbacks remain a backstop. The launch disables
  `unified_exec`, apps, plugins, in-app browser, web search, and image viewing.
- Live provider work runs with allowlisted authentication/model-cache files and
  campaign-local provider, temp/XDG, and Operon homes. Codex and pi also use a
  campaign-local `HOME`. On macOS, only the Claude child retains the source
  `HOME` needed for Keychain lookup, with the protected-home controls described
  below. Ambient API keys, GitHub credentials, histories, instructions,
  plugins, skills, and personal project configuration are not copied.

The authorized rerun exposed four additional defects, now repaired offline:

- Claude readiness no longer treats durable `email` or `subscriptionType`
  account metadata as a first-party credential. It accepts a concrete SDK
  `tokenSource`/`apiKeySource`, or an authoritative logged-in Claude CLI status
  obtained in the exact child-process environment; third-party providers still
  use their documented external credential chain.
- pi readiness no longer stops at `hasConfiguredAuth()`. After OAuth/config
  resolution it requires the concrete non-empty API key that pi passes to its
  provider stream, so an expired record that resolves as `ok: true` with no
  key is `unauthenticated` before any provider turn.
- Codex CLI 0.142.5 parses `--dangerously-bypass-hook-trust`, but its
  `app-server` command path drops that global flag instead of forwarding it to
  effective config. Operon now also sets the equivalent
  `-c bypass_hook_trust=true` session override. A token-free real App Server
  `config/read` plus `hooks/list` check confirms a `sessionFlags` origin, the
  intended enabled `PreToolUse` matcher, and no warnings or errors.
- Scenario caps now reflect the retained gpt-5.5 costs: transport 28%, gate
  17%, delegated gate 20%, continuation 19%, cancellation 5%, and shaping 5%
  of one adapter allowance. The ordinary scenarios total 94%, leaving 6% for
  the deliberately over-budget final probe while the campaign-wide cap remains
  authoritative.

The Codex boundary is intentionally narrow. OpenAI documents that
`PreToolUse` intercepts simple Bash, `apply_patch`, and MCP, but is a guardrail
rather than a complete enforcement boundary; interception of `unified_exec`,
WebSearch, and other non-shell/non-MCP paths is incomplete. The implementation
therefore disables those alternate paths and does not claim universal Codex
tool interception. Sources: [Codex hooks](https://developers.openai.com/codex/hooks)
and [Codex configuration reference](https://developers.openai.com/codex/config-reference).

## Pre-execution auth-context audit and repair

The next prepared and authorized manifest,
`adapter-harness-calibration-v1-20260713-0fdc5399d224`, had canonical campaign
SHA-256
`efc84076ed6c21080dd29ab8b420ce013c438b580dcca2ddbeecb333d3d01207`.
Candidate integrity passed, but no GitHub mutation or provider turn ran and
equivalent-cost spend remained zero. An intermediate predicate hardening made
readiness reject blank or case-insensitive `"none"` SDK credential-source
sentinels. That edit invalidated the prepared manifest before external
execution; it must never be reused.

The subsequently prepared and authorized manifest,
`adapter-harness-calibration-v1-20260713-d11efc466a7f`, had canonical campaign
SHA-256
`20bae9ae7c88375116d6e16e9e5161459e9ddaed83d2a554918b48295065c7ca`.
It likewise caused no GitHub mutation, provider turn, or equivalent-cost spend.
Before execution, the operator correctly challenged the Claude authentication
diagnosis. The resulting audit found that:

- the restricted command sandbox reported `loggedIn: false`, while the same
  Claude 2.1.207 binary outside that sandbox reported `loggedIn: true`,
  `authMethod: claude.ai`, first-party provider, and a Max subscription;
- the Agent SDK in the authenticated host context reported first-party account
  metadata but null `tokenSource` and `apiKeySource`, so those fields cannot by
  themselves distinguish a live macOS subscription session from stale account
  metadata;
- the eval harness replaced `HOME` and set `CLAUDE_CONFIG_DIR` to a campaign
  scratch directory. Reproducing that exact environment made the CLI report
  logged out even though the host session was valid;
- Codex remained ready through ChatGPT Pro, and pi remained ready through its
  file-backed Anthropic credential.

Claude Code stores credentials in the macOS Keychain, whereas
`CLAUDE_CONFIG_DIR` overrides its configuration directory. Copying a
`.credentials.json` file into an isolated macOS home was therefore the wrong
authentication model. Sources: [Claude Code authentication](https://code.claude.com/docs/en/team)
and [Claude Code environment variables](https://code.claude.com/docs/en/env-vars).

The repaired harness leaves the campaign-wide, Codex, and pi environments in
scratch. On macOS only, the Claude child receives the source `HOME` with
`CLAUDE_CONFIG_DIR` unset so the signed-in Keychain identity resolves. It still
receives a sanitized environment; disables project/user settings, skills,
plugins, and session persistence; and uses a fail-closed Claude tool sandbox
that denies source-home reads while explicitly re-allowing the turn worktree
and confines writes to that cwd. The Operon actor gate independently rejects
absolute, tilde, `$HOME`, and `${HOME}` paths outside that worktree for every
tool.

Readiness now combines SDK initialization with `claude auth status --json` in
that exact child environment instead of inferring subscription auth from SDK
account metadata. A token-free exact-environment probe reports Claude
(`auth=claude.ai`), Codex (ChatGPT Pro), and pi (Anthropic) ready without a
model turn. This repair invalidated `d11efc466a7f` before execution; it too must
never be reused.

## Auth-correct live campaign

The freshly prepared and exactly authorized campaign
`adapter-harness-calibration-v1-20260713-473eb4f39381` had canonical SHA-256
`f3355c92a9538f366aa2398ece90ab391ebb18826424af1180e98bf30b989a93`.
Its L4 lifecycle passed twice against the same private repository: issue #7,
pull request #8, commit `69ce8cf2e6579d03711ba5062bf093c499969c42`,
one non-approving review, squash merge, issue closure, and branch deletion.
The identical second invocation reported `idempotent_rerun: true` and reused
the first evidence.

L5 passed all three token-free readiness probes, including Claude through the
authenticated `claude.ai` host context. It then retained seven exactly-once
provider settlements, 422,591 input tokens, 1,103 output tokens, and $5.47642
equivalent cost under the authorized $15 cap. The immutable qualifier reported
`invalid`:

- Claude reached a real provider turn, performed the requested read tool, and
  retained $3.330375 provider-reported cost, proving the prior auth defect was
  fixed. Its 300 KB repeated-`x` transport prompt crossed the $1.05 scenario
  cap before completion.
- Codex completed transport, top-level gate, and delegated-gate scenarios, then
  the resumed continuation crossed its $0.7125 scenario cap at a $0.93694
  estimate. Its four turns retained 422,591 input tokens, 1,103 output tokens,
  and $2.146045 equivalent cost.
- Pi's authenticated provider returned HTTP 400 twice: third-party apps now
  draw from Claude extra usage rather than plan limits, and the account needs
  additional usage balance. Both zero-cost attempts are retained as an
  unrecovered external infrastructure failure.

The baseline remained stopped. The budget stops exposed a harness-efficiency
defect rather than an adapter failure: multi-hundred-KB channel transport does
not require multi-hundred-KB of semantic filler. The transport probe now uses
the same exact byte count of whitespace padding, which still crosses the
SDK/CLI stdin or JSON channel but avoids paying for repeated `x` tokens. A unit
test pins both the 300 KB + 1 padding length and its whitespace-only property.
This edit makes `473eb4f39381` stale; it cannot be rerun. Rather than purchasing
Claude extra usage for pi, the operator selected pi's already configured
`openai-codex/gpt-5.5` OAuth route. The provider-qualified model id is required:
pi's registry contains the same bare model id under multiple providers, so a
bare `gpt-5.5` assignment would not reliably select Codex. A fresh prepared
manifest and exact authorization remain required before another live proof.

## Pi-over-Codex campaign: pi passed, campaign invalid

The exactly authorized campaign
`adapter-harness-calibration-v1-20260713-d5992688efa1` had canonical SHA-256
`dfb6761ce10e700e7022076eb3424aeb50add95518e5fe398f7433abcc1e1f8c`.
Its L4 lifecycle passed twice against the retained private repository: issue
#9, pull request #10, commit `731d49d70d543713923b296c591014a2b93ceaaf`,
one non-approving review, squash merge, issue closure, and branch deletion.
The second invocation reused the evidence with `idempotent_rerun: true`.

All three exact-environment readiness probes passed without a model turn.
L5 retained 24 unique provider settlements, 693,112 input tokens, 3,677 output
tokens, and $3.06913525 equivalent cost under the $15 cap. Pi through
`openai-codex/gpt-5.5` passed all six applicable scenarios, including
transport, gate semantics, cancellation, continuation, budget enforcement,
cache reporting, and degraded flat-deny role shaping. Claude retained four
turns and then failed continuation because the eval runtime explicitly set
`persistSession: false`; the SDK cannot resume a session that it was told not
to store. Codex retained seven turns in both the primary and declared retry,
but the 1.5-second cancellation fallback fired before the first App Server
usage notification, making the otherwise retained attempt usage quality
unavailable. The qualifier therefore reported one pass, two infrastructure
invalids, and one harness error. The baseline remained stopped.

The live executor initially printed $5.21361525 even though the immutable
attempts and ledger reconcile at $3.06913525. Result validation happened after
adding the observed cost, then the catch path added the same partial turns a
second time. Accounting now increments only after a valid result persists;
the catch path remains the single increment for invalid attempts. A regression
test reconciles the executor aggregate to retained attempt costs. The
cancellation fallback is now 20 seconds so a slow provider can emit its first
usage checkpoint while the scenario remains bounded.

The operator approved ephemeral Claude session persistence under the host
Claude config. The repair enables it only for the `adapter-conformance`
profile; ordinary live-eval cases retain their prior non-persistent behavior.
The harness writes immutable grader evidence first, then calls the Claude
SDK's `deleteSession` once for every distinct Claude session ID with the
isolated fixture worktree passed as `dir`. Cleanup evidence retains only the
deleted count and SHA-256 hashes of the IDs, and cleanup failure fails the
attempt closed. No Keychain credential is read, exported, or copied.

## Verification before fresh live proof

Passed:

- `pnpm exec vitest run test/eval/provider-scratch.test.ts test/adapters/codex-gate-bridge.test.ts test/eval/adapter-calibration.test.ts test/runtime/claude-budget.unit.test.ts test/runtime/pi-budget.unit.test.ts test/runtime/readiness.test.ts` — 6 files, 29 tests;
- `pnpm exec vitest run test/adapters test/runtime test/conformance` — 16 files,
  103 tests;
- `pnpm typecheck`.

A token-free real App Server initialization plus `hooks/list` check also
confirmed that the exact session launch configuration parses and loads the
intended `PreToolUse` hook. It did not send a model turn and is not behavioral
conformance evidence.

The complete post-repair offline gate then passed:

- `pnpm eval:validate` — valid; 84 requirements, 84 executable evidence paths,
  14 cases, 12 benchmark families, 60 fault boundaries, 13 graders, three
  capability declarations, zero orphaned records;
- `pnpm test:transformation` — 28 files, 379 tests, no unexpected contract
  failures;
- `pnpm eval:deterministic` — 37 files, 451 tests;
- `pnpm test` — 158 files, 1,564 tests;
- `pnpm typecheck` and `pnpm build` — passed;
- `pnpm test:transformation:strict` — all 379 executable tests passed and the
  command exited non-zero only for the exact declared 72 known-red production
  contracts.

Post-authorized-rerun repair verification also passed:

- `pnpm exec vitest run test/runtime/readiness.test.ts test/adapters/codex-gate-bridge.test.ts test/eval/adapter-calibration.test.ts` — three files, 18 tests;
- `pnpm eval:validate` — valid; 84 requirements, 84 executable evidence paths,
  56 case links, 14 cases, 12 benchmark families, 60 fault boundaries, 13
  graders, three capability declarations, and zero orphaned records;
- `pnpm test:transformation` — 28 files, 379 tests;
- `pnpm eval:deterministic` — 37 files, 451 tests;
- `pnpm test` — 158 files, 1,564 tests;
- `pnpm typecheck` and `pnpm build` — passed;
- `pnpm test:transformation:strict` — all 379 executable tests passed; exit 1
  was solely the exact declared 72 known-red contracts.

The token-free real App Server `config/read` plus `hooks/list` probe also
confirmed `bypass_hook_trust` came from `sessionFlags`, the intended
`PreToolUse` matcher was enabled, and warnings/errors were empty. It sent no
model turn and is not behavioral conformance evidence.

The pre-execution sentinel hardening then passed the complete offline gate
again:

- `pnpm exec vitest run test/runtime/readiness.test.ts` — one file, eight tests;
- real token-free readiness in the then-current isolated environment rejected
  the missing Claude credential rather than sending a model turn;
- `pnpm eval:validate` — valid; 84 requirements, 84 executable evidence paths,
  56 case links, 14 cases, 12 benchmark families, 60 fault boundaries, 13
  graders, three capabilities, and zero orphaned records;
- `pnpm test:transformation` — 28 files, 379 tests, no unexpected contract
  failures;
- `pnpm eval:deterministic` — 37 files, 451 tests;
- `pnpm test` — 158 files, 1,564 tests;
- `pnpm typecheck` and `pnpm build` — passed;
- `pnpm test:transformation:strict` — all 379 executable tests passed; exit 1
  was solely the exact declared 72 known-red contracts.

The later macOS auth-context repair added focused coverage for exact child
environments, protected-home sandboxing, and actor path rejection. Its final
verification was:

- focused readiness/provider-scratch/actor-gate/Claude-runtime/provider-workflow
  coverage — five files, 46 tests passed;
- exact token-free isolated readiness — Claude ready through `claude.ai`,
  Codex ready through ChatGPT Pro, and pi ready through Anthropic; zero model
  turns;
- `pnpm eval:validate` — valid; 84 requirements, 84 executable evidence paths,
  56 case links, 14 cases, 12 benchmark families, 60 fault boundaries, 13
  graders, three capabilities, and zero orphaned records;
- `pnpm test:transformation` — 28 files, 380 tests, no unexpected contract
  failures;
- `pnpm eval:deterministic` — 37 files, 452 tests;
- `pnpm test` — 158 files, 1,566 tests;
- `pnpm typecheck` and `pnpm build` — passed;
- `pnpm test:transformation:strict` — all 380 executable tests passed; exit 1
  was solely the exact declared 72 known-red contracts.

Still required after the tree is stable:

1. a newly prepared, previewed, and exactly authorized content-hashed adapter
   campaign after the pi third-party extra-usage entitlement is available (all
   pre-repair and auth-correct manifests are stale or terminal after these
   edits);
2. valid immutable results that reconcile with run records and the ledger;
3. only then, a separate fresh baseline campaign.

`pnpm test:live` is not run here: it spends provider quota and the repair edits
invalidate the previous authorization. The fresh exact calibration is the
targeted live proof; any separate live-suite execution also requires explicit
authorization and must be recorded rather than silently skipped.

## Mechanically grounded campaign: two adapters passed, Claude exposed a cap allocation miss

The exactly authorized campaign
`adapter-harness-calibration-v1-20260713-72690b61e12b` had canonical campaign
SHA-256
`6f5134a66e42f9d99318fda9e3b9d5d6eab0973b9ff4ae1fc68ad2c2b4b31e0e`,
candidate package SHA-256
`bb2d9c9ecf27dabe3a16e3394c8f2cdf5b8c41cecbf28dc12ac3a3083a444cac`,
and suite SHA-256
`e25f0f909facd2aa8478e543f93e09c69a9ffeb0b7bee0c36fdc3894962d36ae`.
Its $15 cap covered Claude `claude-opus-4-8`, Codex `gpt-5.5`, and pi
`openai-codex/gpt-5.5` against the retained private repository.

L4 passed twice. The first invocation created issue #13 and pull request #14,
pushed commit `96ab764f27dd8f227db55aa20fc08d795324db28`, recorded comments and a
non-approving review, squash-merged, closed the issue, and deleted the branch.
The second invocation re-verified the merged/closed/deleted remote state and
reported `idempotent_rerun: true`. It also revealed that this second result was
printed but not persisted separately; the first immutable evidence file still
said `idempotent_rerun: false`.

L5 settled 19 of 19 provider turns exactly once for $2.20937175 equivalent
cost:

- Codex passed seven provider turns and its real hook-process/socket boundary
  probe for $1.03115.
- pi passed six provider turns and its real tool-call extension boundary probe
  for $0.254993; delegated gating was honestly not applicable because the
  pinned adapter exposes no intra-turn fanout.
- Claude completed transport, top-level gate, delegated gate, same-session
  continuation, and cancellation. The 307,453-byte transport and continuation
  concretely proved the session-persistence repair. Its builder-shaped turn
  then stopped at the assigned $0.1875 per-turn cap after retaining $0.218839
  of provider-reported cost. The Claude attempt retained $0.92322875 total.

All three token-free mechanical boundary artifacts passed. The immutable
qualifier correctly returned `not_qualified` solely because Claude was a
`budget_stop`; this was a harness allocation miss, not a failed Operon gate or
adapter budget boundary. The terminal campaign was rendered to
`report-final.html` and preserved as a 142-file schema-v2 sanitized archive at
`/Users/bikram/Build/operon-eval-archives/adapter-harness-calibration-v1-20260713-72690b61e12b-6f5134a6-evidence-v2`.
Provider scratch and credential files were structurally excluded.

The live campaign exposed four additional evidence/accounting defects, now
repaired offline:

- ordinary scenario shares remain bounded to 94%, but transport moves from
  28% to 25% and role shaping from 5% to 8%. Under the same exact plan that
  gives Claude $0.30 for the observed $0.218839 checkpoint while transport
  remains capped at $0.9375 for its observed $0.441194 cost; the campaign cap
  is unchanged and provider budget failure remains fatal;
- the second L4 invocation writes a separate immutable idempotence receipt,
  content-bound to the original lifecycle evidence, after remote verification;
- a failed adapter attempt now retains its already-completed mechanical
  boundary reference, mechanical-step count, transported byte count, and an
  exact Claude SDK session-deletion receipt;
- a positive-cost Claude terminal result with no token breakdown is classified
  as partial accounting rather than complete accounting.

Post-repair token-free verification passed:

- focused budget/evidence/cleanup/idempotence coverage — four files, 29 tests;
- `pnpm eval:validate` — valid; 84 requirements and 84 executable evidence
  paths, 56 case links, 14 cases, 12 benchmark families, 60 fault boundaries,
  13 graders, three capability declarations, and zero orphans;
- `pnpm test:transformation` — 29 files, 395 tests;
- `pnpm eval:deterministic` — 38 files, 467 tests;
- `pnpm test` — 159 files, 1,582 tests;
- `pnpm typecheck` — passed;
- `pnpm test:transformation:strict` — all 395 executable tests passed and the
  command exited non-zero solely for the exact declared 72 known-red production
  contracts.

These edits change the candidate bytes. The terminal `72690b61e12b` campaign
cannot be retried or reused; the next live proof requires a fresh prepared
manifest and exact authorization.

## Final adapter calibration: qualified

The freshly prepared and exactly authorized campaign
`adapter-harness-calibration-v1-20260713-9c3b336d6842` had canonical SHA-256
`f63518ae0c47c527cff165e9793036ebad2909b9aade5ebb7fc9ce6b2cef8e16`,
candidate package SHA-256
`66fb6580b9b3b878c84ac111a8f8e590e53ccd4891237f2d2ab419b755c5d9b3`,
and suite SHA-256
`a19417c29941ab67e6b31f4b389c3eedd8acc061976d595f8c014d66843345f7`.
The exact private repository and $15 cap were unchanged.

L4 passed twice. The first invocation created issue #15 and pull request #16,
pushed commit `26ab8dba7d851b62b5f2424a788b7e5ffd8ce2bc`, recorded comments and a
non-approving review, squash-merged, closed the issue, and deleted the branch.
The second invocation re-verified the remote state and persisted
`github-idempotence-f63518ae.json`, content-bound to the original lifecycle
evidence. The repository remains private and retained.

L5 passed every declared adapter attempt without a retry:

- Claude: seven provider turns plus its native-hook mechanical proof,
  $0.93218775 equivalent cost; same-session continuation passed, native role
  shaping passed, and six exact SDK sessions were deleted after grader evidence
  with only ID hashes retained;
- Codex: seven provider turns plus its hook-process/socket mechanical proof,
  $1.046045 equivalent cost;
- pi over the pinned OpenAI Codex provider: six provider turns plus its
  tool-call-extension mechanical proof, $0.28833 equivalent cost.

The campaign retained 20 provider turns, 20 exactly-once settlements, three
mechanical steps, 567,599 input tokens, 3,836 output tokens, and $2.26656275
total equivalent cost. The immutable qualifier returned `qualified`: three
passes, zero product misses, safety stops, budget stops, infrastructure
invalidations, harness errors, or missing attempts.

The final report is retained at
`.eval-artifacts/adapter-harness-calibration-v1-20260713-9c3b336d6842/report-final.html`.
A 150-file schema-v2 sanitized archive is retained at
`/Users/bikram/Build/operon-eval-archives/adapter-harness-calibration-v1-20260713-9c3b336d6842-f63518ae-evidence-v2`;
provider scratch was structurally excluded. The verified cleanup preview can
remove only campaign `world/` and `provider-scratch/` while preserving all
canonical evidence, but destructive cleanup was not executed without a
separate exact confirmation.

This closes the adapter-calibration admission gate. It does not promote the 72
declared transformation known-red contracts or authorize the separate
pre-transformation baseline, candidate qualification, or L6 soak campaigns.
