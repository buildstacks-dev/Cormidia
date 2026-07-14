# Operon evaluation suite

This tree is the portable, evidence-preserving qualification layer for the
highly efficient organization contract in `docs/efficiency.md`. Ordinary
validation and deterministic execution are token-free. Provider-backed work
is a separate, explicitly enabled, content-hashed, confirmed, and budget-capped
campaign.

## Safety boundary

- Never target the active production org, state home, app checkout, or GitHub
  work.
- Every attempt uses a synthetic home, disposable eval org, immutable app seed,
  managed actor worktree, and verifier tree outside actor-readable paths.
- Hidden graders, answers, reference patches, and mutants never enter prompts,
  context, actor worktrees, environment, or visible Git history.
- GitHub writes require a predeclared private owner and `operon-eval-*` repo.
- No eval publishes, sends, deploys to production, mutates DNS/cloud resources,
  or performs irreversible data operations.
- Every admitted attempt is retained. A retry links to rather than replaces it.

## Commands

- `pnpm test:transformation` checks required contracts and the exact known-red
  set without tokens.
- `pnpm test:transformation:strict` requires no known-red contracts.
- `pnpm eval:validate` validates manifests, fixtures, graders, hashes, and
  hidden-answer separation, and emits the complete requirement → case →
  executable-evidence map.
- `pnpm eval:deterministic` runs L0–L3 without providers or external GitHub.
- `pnpm eval:github` is the explicit L4 disposable-GitHub harness.
- `pnpm eval:live -- --campaign <file> --max-usd <n> --confirm <id>` is the
  provider campaign entrypoint. Adapter-conformance campaigns exercise all
  configured runtimes before product episodes. Both calibration scenarios and
  product attempts use Operon's ordinary pass executor, six-file run records,
  gate, progress checkpoints, and exactly-once ledger. Every calibration
  result references all scenario run ids and preserves observed turns if later
  validation or persistence fails. Delivery episodes settle a bounded contract
  pass before implementation and a separate cross-provider review; a
  non-completed contract prevents both later passes. Calibration records
  top-level action-rule fidelity and delegated gate traversal for adapters that
  claim intra-turn fanout; pi records the pinned no-fanout capability instead
  of fabricating delegated evidence. Safety and role-shaping qualification use
  a token-free mechanical probe through each adapter's real production
  interception point (Claude PreToolUse, the Codex hook subprocess/socket, and
  pi's tool-call extension). Provider prompts remain behavioral observations;
  a model declining to attempt a forbidden action cannot create a false miss.
- `pnpm eval:soak -- --campaign <file>` previews L6 without mutation. Execution
  additionally requires `OPERON_EVAL_SOAK=1`, `--execute`, `--max-usd`, and an
  exact `--confirm`. The runner persists every five-minute tick, spreads only
  the declared useful turns across 48–72 hours, exits at the declared restart
  hour, and resumes after a distinct process records `--record-restart` with
  the same confirmation. `--once` supports an external scheduler; omitting it
  follows the campaign until restart or terminal state.
- `pnpm eval:qualify -- --campaign <id>` is immutable-evidence-only and cannot
  invoke a provider, reconcile state, or mutate GitHub.
- `pnpm eval:archive -- --campaign <prepared-file> --out <archive-root>` writes
  a schema-v2 sanitized evidence archive with a per-file checksum manifest.
  Durable evidence and a cache-free worktree snapshot are retained;
  `provider-scratch/**`, provider credentials, dependency caches, Git metadata,
  and prior receipts are structurally excluded. Secret-like spans in isolated
  actor-worktree files are replaced with canonical redaction markers in the
  archive while the manifest retains both exact source hashes and archived-byte
  hashes. A secret match in durable results, state, reports, or control evidence
  still fails closed instead of being silently rewritten.
- `pnpm eval:cleanup -- --campaign <id>` previews removal of generated
  worktrees/provider scratch. Execution requires `--execute --confirm <id>`;
  it also requires a verified schema-v2 external archive receipt created by
  `eval:archive`. Cleanup rechecks campaign identity, every archived hash,
  extra/missing files, forbidden paths, and current retained-source parity;
  legacy v1 receipts are deliberately not accepted. Manifests, locks, GitHub
  evidence, attempts, reports, and the GitHub repo are always preserved.

Raw attempts, prompts, provider sessions, remotes, and worktrees are local
artifacts and ignored by git. Committed summaries are redacted and hashed.
Archive a terminal campaign before cleanup. Cleanup removes only generated
worktrees and provider scratch; the manifest, lock, attempts, reports, GitHub
evidence, and disposable repository remain available for audit.

## External campaign sequence

Preparation and every preview are non-billable and do not mutate GitHub:

```bash
pnpm eval:validate
pnpm test:transformation
pnpm eval:deterministic
pnpm eval:prepare -- --campaign <template> --github-owner <exact-owner>
pnpm eval:github -- --campaign <prepared-file> --repo <exact-owner>/operon-eval-<name>
pnpm eval:live -- --campaign <prepared-file> --max-usd <cap> --confirm <exact-campaign-id>
```

After a human authorizes that exact identity, private repository, operations,
models, and cap, L4 uses `OPERON_EVAL_GITHUB=1` plus `--execute --confirm`; L5
uses `OPERON_EVAL_LIVE=1` plus `--execute --max-usd --confirm`. L4 creates an
absent allowlisted private repo or initializes an empty one, retains it, and
proves the complete issue/branch/commit/push/PR/comment/review/squash-merge/
branch-cleanup lifecycle twice. The first run writes immutable lifecycle
evidence; the second writes a separate content-bound idempotence receipt after
re-verifying the retained remote state. L5 first reruns the complete deterministic
validator and non-billable adapter readiness probes. A failed readiness,
pristine app gate, GitHub proof, campaign lock, separation check, or remaining
budget prevents the next provider turn.

L5 stages an allowlisted copy of provider authentication and model-cache files
under the content-hashed campaign root, then replaces the provider process
environment for the duration of the run. Personal histories, instructions,
plugins, skills, project configuration, ambient API keys, GitHub credentials,
and active Operon homes are excluded. On macOS, Claude.ai subscription OAuth is
Keychain-backed and cannot be copied into scratch. Only the Claude subprocess
retains the authenticated default HOME/config context; it loads no filesystem
settings, personal skills, or plugins. Ordinary profiles persist no session.
Adapter conformance alone enables a resumable transcript for the continuation
probe, then deletes every observed session through the SDK under the same
authenticated environment after grader evidence is durable. Its fail-closed
tool sandbox denies host-home reads while re-allowing the eval worktree and
confines writes to that cwd. Operon's gate independently rejects every tool
path outside the worktree. Pi's rotating OAuth credential is first resolved
through its source file-backed auth store by a non-billable readiness probe, so
a refresh is persisted before the usable credential is copied into isolated
campaign scratch. All staged auth remains ephemeral provider scratch and is
never copied into the sanitized archive.

Readiness is request-auth readiness, not account-metadata presence. A
first-party Claude account needs either a concrete token/API-key source or an
authoritative `claude auth status --json` result from the exact subprocess
environment; durable email or subscription metadata is insufficient. Pi must
resolve a concrete non-empty API key after its cheap configured-auth check.
Expired, inaccessible, or metadata-only credentials therefore stop the
campaign before its first provider turn and are retained as failed readiness
evidence.

The first external action creates or verifies the immutable campaign lock;
GitHub, provider, and soak executors all reject an in-memory/file/hash race.
Committed operator fixtures bind any L2/L4 scripted action by SHA-256 and
scope, while L5 and L6 decisions remain explicitly human-required and every
real deploy/publication/message/DNS/cloud/destructive-data effect is forbidden.

App gates treat provider-modifiable code as untrusted: npm script definitions
must still match the pinned seed, the subprocess receives an isolated HOME and
TMP plus a credential-free environment, and live macOS runs deny network for
the full gate process tree. The default is fully network-dark; a case whose
reviewed side-effect policy declares loopback receives only local inbound and
outbound socket access while external networking remains denied. A live
platform without that network sandbox fails closed instead of executing
actor-authored checks with ambient access.

Run adapter calibration before product episodes. Infrastructure retries are
limited to one campaign-wide declared retry; the original attempt and any
partial settlements remain immutable. Its multi-hundred-KB transport scenario
uses whitespace-only padding: the bytes still cross the real SDK/CLI channel,
but filler does not consume a large semantic-token budget. The cancellation
scenario waits up to 20 seconds for the first provider usage checkpoint before
its bounded fallback, so slow App Server startup does not manufacture
zero/unavailable accounting. Ordinary scenario caps consume 94% of one adapter
allowance (transport 25%, gate 17%, delegated gate 20%, continuation 19%,
cancellation 5%, and role shaping 8%), leaving 6% for the intentional final
budget-stop probe. Claude session persistence is enabled only for
this adapter-conformance profile so the continuation probe can resume. After
immutable grader evidence is written, the harness deletes each exact eval
session through the Claude SDK using the isolated fixture worktree as the
project directory; cleanup evidence retains only deletion counts and
session-ID hashes. A terminal calibration failure performs the same exact
deletion and writes a failure-path cleanup receipt. When execution finishes:

```bash
pnpm eval:qualify -- --campaign <prepared-file> --html <campaign-root>/report-final.html
pnpm eval:archive -- --campaign <prepared-file> --out <archive-root>
pnpm eval:cleanup -- --campaign <exact-campaign-id>        # preview
pnpm eval:cleanup -- --campaign <exact-campaign-id> --execute --confirm <exact-campaign-id>
```

Qualification reports preserve all canonical measurement populations:
provider/mechanical settlement, tokens and usage quality, context bytes by
source, cost, elapsed/active/human-wait time, human decisions, productive and
repeated work from verifier-owned artifact hashes, continuation, approval
precision/recurrence, scheduler reliability, and learning capture/effect.

## Operating cadence

The checked-in workflow runs validation, transformation contracts, the L0-L3
deterministic campaign, the complete offline suite, and typechecking on every
pull request. Its nightly schedule adds the repeated deterministic flake
tripwire. Credentialed work is deliberately an operator runbook rather than an
automatic spending job:

| Cadence | Exact operator action | Admission rule |
| --- | --- | --- |
| GitHub nightly or scheduled | Prepare the current L4 campaign, retain both previews, then run `eval:github` twice against the exact allowlisted private repository | A human must authorize the campaign hash, repository, operations, and GitHub mutation before execution |
| Weekly/manual calibration | Prepare and preview adapter calibration, then run L4 followed by the capped L5 calibration sample | A human must authorize the exact campaign identity, models, repository, and equivalent-cost cap; missing auth is incomplete evidence |
| Release candidate | Build and pack the exact candidate, run the complete L0-L5 sequence, qualify/archive it, then prepare and start the separate L6 campaign | Candidate and soak require separate exact authorizations; neither may borrow a prior campaign's confirmation |
| Post-release | Run read-only production confirmation and compare the rolling report to the archived sandbox qualification | Production never supplies calibration data or rewrites qualification thresholds |

For each cadence event, create a fresh prepared manifest after the exact
candidate commit is fixed. Any source, fixture, grader, price-catalog, or
campaign change invalidates the prepared identity and requires new previews
and authorization. Record the dated command results, provider usage quality,
equivalent-cost spend, GitHub effects, report hashes, archive receipt, and any
incomplete readiness item in `research/evals/`.
