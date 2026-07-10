# Bugs To Be Fixed

Working backlog for defects and UX gaps found during dogfooding. This file is
intentionally lightweight so we can collect issues as they appear and fix them
in one focused pass later.

## CLI command sanity checks and help

- `operon bootstrap` accepts a GitHub URL where it expects a local repo path.
  Repro:

  ```bash
  corepack pnpm dev bootstrap https://github.com/buildstacks-dev/buildstacks.dev --org-home /Users/bikram/Build/Operon
  ```

  Actual behavior: treats the URL as a relative filesystem path and creates
  artifacts under a path like:

  ```text
  /Users/bikram/Build/Operon/https:/github.com/buildstacks-dev/buildstacks.dev/.operon
  ```

  It can also register a bogus app entry such as `repo: OWNER/buildstacks.dev`
  because there is no real `.git/config` at that accidental path.

  Expected behavior: fail before writing anything with a clear message such as:

  ```text
  bootstrap expects a local repository path, not a GitHub URL. Clone the repo
  first, then run bootstrap against the local checkout.
  ```

- Add input sanity checks for every CLI command. Commands should validate path
  arguments, URL-vs-path mistakes, required files, existing output paths,
  incompatible flags, and missing prerequisites before doing writes.

- Add or audit `--help` / `-h` support for every CLI command. Help output should
  include examples and clarify whether each positional argument is a local path,
  GitHub repo slug, URL, app name, or org-home path.

- `operon bootstrap --org-home <path>` should validate that `<path>` is an
  existing org home before collecting questionnaire answers or writing app
  artifacts. At minimum, it should check for `<path>/apps.yaml` and fail with a
  direct explanation if missing.

## Bootstrap publication workflow

- Add an explicit post-review command such as `operon bootstrap publish
  <app-name>`. Today, `operon bootstrap` generates app-owned `.operon/`
  artifacts and updates the org's `apps.yaml`, but the user must manually
  create branches, commit, push, and open the corresponding pull requests.

  Expected behavior: after the human reviews the generated artifacts, the
  publish command validates Git/GitHub authentication and both worktrees,
  stages only the bootstrap-owned changes, creates dedicated branches and
  commits, pushes them, and opens coordinated draft PRs for the app repo and
  org repo. It should support a dry run, fail safely on unrelated worktree
  changes, and report both PR URLs. It must not approve or merge its own PRs;
  final ratification remains a separate human-controlled action.

## Managed app clone freshness before planning

- `operon plan <app>` can plan from a stale managed clone even after the app's
  remote default branch has advanced. Reproduced 2026-07-10 with
  `buildstacks.dev`:

  1. GitHub `main` and the sibling checkout were at `68276c2`, containing the
     ratified product overview, requirements, design spec, prototype, testing
     strategy, runbook, and agent guide.
  2. Operon's managed clone at
     `~/.operon/Bikram-Org/repos/buildstacks.dev` still had `main` and
     `origin/main` at the original bootstrap commit `73ca5ec`.
  3. A live `operon plan buildstacks.dev --topic ...` created its worktree from
     `73ca5ec`. The Planner therefore concluded that none of the ratified docs
     existed and created no milestone tickets.

  Expected behavior: before creating a planning or role worktree, Operon should
  fetch the registered repo, prune stale refs, resolve the remote default
  branch, and fast-forward or reset only the managed clone's clean base branch
  to that exact remote commit. It must fail clearly if the managed clone is
  dirty or cannot refresh; silently planning from stale product truth is not
  acceptable.

  Additional observed behavior: the Planner reported the missing-input outcome
  in prose and the overall command exited `0`, despite producing no durable
  plan or tickets. A live planning command should expose a structured
  `completed | blocked | failed` result and return nonzero (or a clearly
  machine-readable blocked status) when the requested plan was not produced.

## Co-planning cannot publish tickets non-interactively

- `operon plan <app>` shells out to the native `claude` CLI with inherited
  terminal permissions. In a normal coding-agent/non-interactive invocation,
  Planner attempts to use `gh` are denied by Claude's permission layer even
  when host `gh auth status` is valid and the user explicitly authorized issue
  creation. Reproduced twice on 2026-07-10 for `buildstacks.dev`.

  Actual behavior: the Planner can read the repo and produce a detailed ticket
  decomposition in terminal prose, but cannot inspect labels or create GitHub
  issues. `operon plan` persists neither the plan nor its tickets, records a
  zero-token/zero-cost synthetic telemetry row, leaves the worktree behind, and
  exits `0` because the native CLI exited normally.

  Expected behavior: coding-agent callers need a non-interactive planning mode
  using the real `ClaudeRuntime`/gate/approval machinery and a structured plan
  result. Ticket creation should be an orchestrator-owned GitHub operation from
  validated structured output, not an agent-authored `gh` shell side effect.
  The command should persist the planning artifact, create or explicitly stage
  the issues, record real SDK usage/cost, clean up no-op worktrees, and return a
  blocked/failed status when durable outputs were not produced. Interactive
  human co-planning can remain available as a separate explicit mode.

## Planner output is not validated against the loop label contract

- A live Planner turn for `buildstacks.dev` created a coherent 19-ticket
  dependency graph but invented a label taxonomy that the Operon loop does not
  implement. It created `op:in-progress`, `op:done`,
  `tier:routine|structural|critical`, and `priority:p0|p1|p2`; it did not create
  the runtime-required `op:building`, `op:returned`,
  `op:tier-quick|standard|deep`, or `p1|p2|p3` labels. It also used
  `op:blocked` for every dependency-locked backlog issue even though the loop
  contract reserves that state for an approval-queue wait.

  This makes the apparently ready backlog unsafe to dispatch: the very first
  `op:ready -> op:building` claim can fail because `op:building` does not exist,
  and the invented tier labels silently fall back to the standard pass set.

  Expected behavior: Planner output must be schema-validated before GitHub is
  mutated. State, priority, and tier labels should come from one shared typed
  contract used by the Planner prompt, publication code, setup scripts, and the
  loop. Operon should ensure the canonical labels exist, reject unknown
  workflow labels, keep dependency-locked backlog issues stateless until groom
  makes them ready, and fail the plan with an actionable diff rather than
  publishing an incompatible taxonomy.

## Planner ticket publication is not transactional

- During the same live planning turn, a shell word-splitting error in the
  agent-authored placeholder substitution produced 19 empty temporary body
  files. The Planner then pushed those empty files over all 19 GitHub issue
  bodies before detecting the mistake. It recovered from the intact source
  files, regenerated every body, re-pushed them, and independently verified the
  final state, but the issues briefly had empty bodies and that intermediate
  corruption remains visible in their edit history.

  Expected behavior: publication should be orchestrator-owned and
  transactional. Render and validate all issue payloads locally first (nonempty
  body, no unresolved placeholders, valid references, accepted labels), then
  publish. Updates to existing issues should use a preflight plus rollback or
  compare-and-swap strategy so one bad batch cannot partially corrupt the live
  backlog.

- The correction turn reproduced the same class of failure while applying the
  canonical labels: the Planner stored a newline-delimited mapping in a shell
  variable and iterated with `for row in $MAP`. Because the native runtime was
  zsh, the value did not split into rows as the agent assumed, so the first
  pass attempted one malformed update and reported `# 2 FAILED`. The Planner
  recovered by explicitly running the batch under bash and then audited all 19
  issues, but correctness depended on the agent noticing and repairing a shell
  portability bug. Orchestrator-owned publication should not depend on an
  agent-authored shell loop or the caller's interactive shell semantics.

## Planner memory branch is pushed without a review handoff

- The live Planner correctly wrote its end-of-turn memory under
  `.operon/memory/planner/`, committed it, and pushed the generated plan branch,
  but it did not open a pull request or otherwise surface a ratification action.
  `operon plan` exited successfully while the durable memory remained on an
  unmerged remote branch that future main-based turns will not read.

  Expected behavior: when a planning turn changes committed app artifacts,
  Operon should either open a draft PR (and report its URL), place the change in
  an explicit staged-review queue, or clearly report that no durable memory was
  landed. A successful plan should not describe memory as recorded when it is
  unreachable from the app's default branch.

## Builder cannot install dependencies in its offline Codex sandbox

- The first live Builder turn for `buildstacks.dev` ticket #2 implemented the
  requested Astro scaffold, but `pnpm install` failed with
  `ERR_PNPM_META_FETCH_FAIL` for `registry.npmjs.org`. Operon's Codex adapter
  hard-coded legacy `workspace-write` sandboxing, whose network access defaults
  to false, and exposed no CLI or turn-level way for an explicitly authorized
  build to opt in. The Builder correctly returned the ticket with evidence, but
  all greenfield Node builds requiring a new lockfile were otherwise impossible.

  Fix implemented locally: `operon loop --allow-network` now propagates an
  explicit per-turn grant through the loop/pipeline runtime contract. The Codex
  adapter maps it to the current App Server `workspaceWrite` sandbox policy
  with `networkAccess: true` while retaining the ticket worktree as the sole
  writable root. Omitting the flag keeps network disabled. This should remain a
  deliberate orchestration-boundary opt-in and gain live regression coverage
  for a registry fetch; mocked adapter tests alone only prove parameter mapping.

## Greenfield scaffold deadlocks on baseline-before-changes protocol

- After ticket #2 was requeued with working registry access, the Builder
  immediately returned it again because the implement prompt requires the full
  test suite to run before any edit, while the ticket itself creates the first
  test/lint commands. The brief correctly said `Test command: (not configured)`
  and `Lint command: (not configured)`, leaving no possible baseline command.

  Fix implemented locally in the package and active org prompt: when the brief
  explicitly reports that no test command is configured and the ticket creates
  the first one, the Builder records the baseline as unavailable and proceeds.
  This is not treated as a red baseline, and the final full-suite requirement
  remains mandatory. A root-pipeline regression test protects the exception's
  presence and its final-verification language.

## Per-turn budget abort strands resumable Builder work

- A live Codex Builder implement pass for `buildstacks.dev` ticket #2 crossed
  the role's $15 estimated-cost cap at $15.5009 after successfully installing
  dependencies and creating the lockfile. Operon killed the pass, reported only
  `build pipeline aborted before completion`, classified the run as
  `failed(error_unknown)`, and emitted an `escalation.raised` event whose reason
  incorrectly said `critical op (secrets-or-auth) requires human approval`.
  The ticket/worktree contained useful resumable work, but the CLI did not say
  how to resume it or transition the ticket into a retryable state.

  Expected behavior: budget exhaustion needs its own stable error/status code
  and truthful telemetry, must never be described as a secrets/auth approval,
  and should preserve plus explicitly requeue resumable work (or provide a
  first-class resume command). Before starting an expensive pass, Operon should
  also compare the role cap and remaining app budget against an estimate for the
  selected tier so it can request a cap change before spending most of a turn.
  Subscription-backed Codex usage should remain clearly identified as an
  internal equivalent-cost estimate rather than a provider charge.

  Recurred 2026-07-10 at the raised $30 cap: the final fix pass was marked
  `failed` on budget overrun even though it had already committed and pushed
  its fix (`3dbd9d0`, the head of the ticket's PR). Terminal status must
  distinguish "the turn was stopped" from "the work was lost" — here the
  work had landed and the status invited a needless full re-run.

## Manual loop gate denials bypass the approval store

- The successful resumed Builder pass for `buildstacks.dev` #2 attempted
  `pnpm exec prettier --write` over the ticket's scoped files, including the
  repo-local `.npmrc` containing only `engine-strict=true`. The broad
  `secrets-or-auth` classifier denied the command because `.npmrc` appeared in
  its arguments. The Builder recovered with scoped manual edits, ran every
  gate green, committed `4ea393e`, and returned a structured `done` verdict.
  Nevertheless, the Codex adapter retained the recovered escalation and the
  pipeline ended `blocked_on_gate`.

  Worse, `src/cli/loop.ts` supplied raw `defaultGate`, unlike dispatched turns
  which use `composeGate(defaultGate, ApprovalStore, context)`. The denial
  therefore created no pending approval: `operon approvals list` showed zero,
  while ticket #2 was moved to `op:blocked`. There was no Operon-interface path
  to grant and resume the denied action.

  Fix implemented locally: manual loop passes now receive a role-aware gate
  factory composed with the durable approval store, so Builder, Reviewer, and
  ship-check denials are attributed to the actual role and appear in
  `operon approvals`. Add regression coverage that a manual-loop critical
  action creates a pending item and that pipeline passes select their
  role-specific gate. A separate calibration improvement should distinguish a
  known credential-free project `.npmrc` formatting operation from real secret
  material without weakening protection for user/global npm credentials.

## Interactive Planner can stall indefinitely and still exit successfully

- A narrowly scoped recovery turn was started to move only
  `buildstacks.dev` ticket #2 from its stranded `op:building` state back to
  `op:ready`. After an unnecessary out-of-scope filesystem read was denied,
  the Claude Planner accepted two explicit recovery instructions but produced
  no further output or tool activity for several minutes. The session required
  two interrupts to terminate. `operon plan` then exited with status 0 and only
  reported the abandoned worktree, even though it had not performed or verified
  the requested state transition.

  Expected behavior: interactive planning needs an inactivity watchdog and a
  non-success exit when the provider session is interrupted or ends without a
  structured completion result. Operon should also report whether any requested
  external mutations were actually completed. The immediate recovery had to be
  applied as the exact single GitHub label change outside the stalled Planner,
  after which `operon loop --dry-run` correctly identified #2 as the sole ready
  ticket.

## Budget ledger omits spend from aborted and gate-blocked loop turns

- Before retrying ticket #2, `operon budget` reported `$0.00` spent against the
  app's `$300.00` cap. The preceding contract and implementation passes had
  emitted substantial equivalent-cost estimates, including one pass killed at
  `$15.5009` and one successful implementation estimated above `$20`, plus
  several contract passes. Because those pipelines ended in budget aborts or a
  recovered gate denial rather than publication, none of their consumption was
  reflected in the app ledger.

  Expected behavior: every provider turn must settle its measured equivalent
  cost exactly once, regardless of the pipeline's terminal status. Failed,
  interrupted, denied, and blocked attempts consume budget too. The budget
  command should reconcile durable run records and make clear that this is an
  internal estimate for subscription-backed providers, not necessarily a
  separately invoiced API charge.

## Quality gates use a stale pre-claim command snapshot

- Ticket #2 introduced its first app-owned `test_command` and `lint_command`
  in `.operon/config.yaml`. Builder recorded the change and all local gates
  passed, but the quality-gates phase had loaded commands once from the clean
  main clone before claiming the ticket. It therefore reported both commands
  as unconfigured and dispatched an unnecessary remediation turn.

  Fix implemented locally: quality-gate and shipping phases now reload gate
  commands from the ticket worktree immediately before execution. The loader
  also understands the registry-style nested `apps.<name>` config emitted by
  bootstrap, including its `commands` map. Regression tests cover nested config
  precedence and worktree reload behavior.

## New Planner tickets deadlock on unchecked human-ratified criteria

- Planner creates GitHub tickets with every acceptance criterion unchecked, as
  it should. Yet the first quality-gates pass requires every criterion to
  already be checked and runs before a PR exists, so a clean Builder result
  automatically burns all bounded remediation attempts and moves the ticket to
  `op:returned`. Builder cannot correct it because the checklist is correctly
  treated as human-ratified.

  Expected behavior: before a build is dispatched, Operon should surface a
  dedicated acceptance-ratification approval item (with implementation/test
  evidence where available), or defer the checkbox requirement until the human
  review stage. It must not spend Builder turns attempting to repair a
  governance-only failure. The app owner explicitly authorized criterion
  ratification for this run and future verified tickets; #2 was checked only
  after the relevant build, test, lint, budget, security, and CI-config
  evidence existed.

## Read-only repository inspection over `.npmrc` is a false secrets gate

- A later #2 contract pass was blocked by `secrets-or-auth` for a read-only
  `wc -l` command that enumerated ticket files, including the tracked
  project-local `.npmrc` containing only `engine-strict=true`. The durable
  approval store correctly captured the request and the owner approved it, but
  this classification interrupts routine analysis and invites needless
  approval churn.

  Expected behavior: secret rules should protect reads of credential-bearing
  locations and writes/exfiltration, not a repository-local `.npmrc` merely
  named in an aggregate metadata command. Calibration should recognize a
  credential-free repo `.npmrc`, while retaining the stricter treatment for
  user/global npm credentials and commands that actually expose secret values.

## Interrupted Reviewer turns cannot resume from `op:in-review`

- PR #23 passed its CI gates and entered Operon's independent Reviewer pass.
  The Claude SDK session was interrupted after an extended period without a
  result, leaving the GitHub issue correctly labelled `op:in-review` but with
  no resumable loop item. `operon loop --once --dry-run` selects only
  `op:ready` tickets, and `operon dispatch --dry-run` found no work, so the
  only operational recovery was to relabel the unchanged ticket `op:ready`
  and repeat the expensive Builder pipeline before review could be retried.

  Expected behavior: persist sufficient phase state (branch, PR number,
  review pass/session handle, findings, and approval head SHA) to let
  `operon loop --resume` or a normal scheduler tick continue from
  `op:in-review` after an interrupted provider session. Re-running Builder
  should be reserved for a real review finding or rebase, never for a review
  transport interruption.

## Runtime briefs keep stale gate commands after Builder configures them

- The first gate reload fix made `quality-gates` correctly discover the
  Builder's `pnpm test` and `pnpm lint` commands from the worktree, but
  `enginePhaseOptions` still passed its original pre-claim command snapshot
  into Builder, Reviewer, and ship briefs. Those briefs reported `Test command:
  (not configured)` even after `.operon/config.yaml` recorded the real commands.
  On a replay, Builder attempted a redundant baseline `pnpm install` and
  returned the ticket when pnpm refused to purge a reused modules directory in
  a non-TTY session.

  Fix implemented locally: all runtime pipeline passes now resolve commands
  from their current ticket worktree, just as quality and shipping gates do.
  The targeted driver/pipeline/CLI regression suite, typecheck, and build pass.

## Same-account GitHub review rejection breaks the findings path

- Builder branches and Reviewer API calls use the same GitHub identity in this
  org. GitHub therefore rejects `gh pr review --request-changes` on an Operon
  PR with “Can not request changes on your own pull request.” The Reviewer had
  already produced a structured findings verdict and a durable comment review,
  but `runReviewPipeline` threw instead of returning the ticket to Builder.

  Fix implemented locally: `GhCliOps.createReview` falls back to a marked
  comment review for same-account changes requests (parallel to the existing
  self-approval fallback), and `runReviewPipeline` bounces directly from its
  trusted structured findings to `op:building`. Approval freshness remains
  fail-closed for merges; the fallback only enables rework, not self-merge.
  Targeted GitHub and loop integration tests, typecheck, and build pass.

## Quality gates cache pre-ticket commands and reject a newly scaffolded app

- Ticket #2 created the first `package.json` scripts and recorded `pnpm test`
  and `pnpm lint` in the app-owned `.operon/config.yaml`. The Builder completed
  green, but the quality-gate phase used the empty command set loaded from the
  pre-claim `main` clone. It reported both commands as unconfigured and launched
  a remediation pass. That pass could edit the worktree config but could never
  change the command object already cached by the running loop, so all bounded
  retries were guaranteed to fail.

  Fix implemented locally: gate and shipping phases now reload command
  configuration from the built ticket worktree immediately before execution,
  with worktree values overriding the initial snapshot. Command discovery also
  understands bootstrap's registry-shaped `.operon/config.yaml` (a sole nested
  app entry and its `commands` map), while retaining the legacy top-level and
  package-script fallbacks. Regression coverage exercises nested discovery and
  stale-snapshot replacement.

## Bootstrap tests leak the host's active-org pointer

- Running the full Operon suite on a host with an active org produced two false
  failures in `test/bootstrap.test.ts`. Tests that assert the no-active-org
  behavior resolved `/Users/bikram/Build/Bikram-Org` through the real HOME
  pointer, so `--scan-only` joined that org and the noninteractive bootstrap
  failed later on missing answers instead of failing on missing org state.
  Re-running the same file with an isolated HOME passed all eight tests.

  Expected behavior: these tests must inject an isolated home/state resolver
  themselves rather than depending on the developer machine's active Operon
  configuration. Full-suite results should be deterministic on both clean CI
  workers and actively used Operon hosts.

## Process-gate run records discard the failing command's output

- After worktree command reload was fixed, the first real setup gate executed
  `pnpm install --frozen-lockfile` and failed because pnpm will not replace an
  existing modules directory without a TTY unless `CI=true` is set. The gate
  envelope and event stream retained only `setup failed (exit 1)`; neither the
  command nor pnpm's explanatory stderr was available in the durable gate run.
  A costly Builder remediation turn had to reproduce the failure to discover
  the actual cause.

  Expected behavior: process-gate results and remediation briefs should retain
  a bounded, redacted output tail plus the exact configured command. This is
  essential evidence for deterministic remediation and should use the same
  size/redaction rules already applied to provider logs.

## Manual-loop approvals omit the ticket identity

- Durable approvals raised from manual `operon loop` runs now correctly record
  the app, Builder role, rule, action hash, and turn id, but both ticket #2
  requests displayed `ticket: (none)`. The loop item already knows `#2`, and
  the surrounding run records are ticket-attributed.

  Expected behavior: the role-aware gate context should include the active
  ticket reference so approval review, audit history, and later revocation can
  be tied to the exact unit of work without correlating timestamps manually.

## Packaged skill installs only into the Codex skills home

- `agent-skills/operon` is correctly packaged in the repo, but
  `scripts/link-local.mjs` links it only at `$CODEX_HOME/skills/operon`.
  Claude Code sessions resolve skills from `~/.claude/skills`, where no
  `operon` entry exists, so Claude-side agents cannot discover the CLI
  workflow the skill documents.

  Expected behavior: the local install (and any future packaged install)
  links or copies the skill from the repo source into every supported
  provider skills home — at minimum `$CODEX_HOME/skills/operon` and
  `~/.claude/skills/operon` — and `pnpm smoke:onboarding` verifies both.

## Reviewer findings are not carried forward across review cycles

- During the 2026-07-10 buildstacks.dev episode, a first-round security
  finding (pin GitHub Actions to immutable commit SHAs) disappeared from the
  subsequent review rounds without being fixed or rebutted. The final PR
  branch still uses mutable `@v4` tags. Each review round re-derives its
  findings from scratch; nothing reconciles them against the previous
  round's list.

  Expected behavior: findings live in a durable per-ticket ledger. Every
  finding carries forward until it is marked fixed (with evidence) or
  rebutted (with rationale); a review round that silently drops an open
  finding should fail validation.

## Approval escalations kill the pass instead of pausing it

- When a gate rule escalates mid-pass, the provider turn terminates. After
  the human approves, nothing resumes: the grant enables a future attempt,
  and the loop re-runs the pipeline from the beginning. The human pays for
  the decision and then again for the restart. The final fix pass of the
  2026-07-10 episode burned 5.9M input tokens looping against a
  `secrets-or-auth` escalation before the per-turn cap killed it.

  Expected behavior: an escalation suspends the pending action and parks the
  pass; an approval resumes execution from the approved action within the
  same pass (or a checkpointed continuation of it). Denials should return
  structured guidance to the same pass rather than ending it.

## No token-free environment preflight before model turns

- Three environment failures were each discovered inside expensive model
  turns: npm registry access blocked by the default offline sandbox, `pnpm
  install` refusing to replace `node_modules` without a TTY (`CI=true`
  unset), and missing network grants after a requeue. Each cost a full
  Builder pass to diagnose.

  Expected behavior: before the first model turn of a pipeline, the
  orchestrator runs cheap deterministic probes in the ticket worktree —
  registry reachability under the granted network policy, non-interactive
  install viability, required commands present — and fails the preflight
  with the probe output instead of spending a provider turn.
