# Fix Backlog — Operon architecture review 2026-07-16

Derived from `review/architecture-review-2026-07-16.md`. **55 items** (P0×9, P1×22, P2×24).
P3s are not queued — see the master report's table.

> **AMENDED 2026-07-17 — 10 new L-items from live-campaign evidence
> (`review/live-campaign-crossref-2026-07-17.md`). The sequencing changed materially:**
> - **L0-01 and L0-02 now precede everything.** Half the product (SRE/Support/Marketing) is
>   unreachable and spent zero tokens. Until that's fixed, most of this backlog is unverifiable
>   because the code paths never execute.
> - **P0-01…P0-05 (the security P0s) must be sequenced *with* L1-05**, not before it. The campaign's
>   **9/9 false-positive** approval rate is A-001/A-002's delivery mechanism — same classifier, same
>   defect. Fixing the exploit while leaving the operator trained to rubber-stamp fixes half the risk.
> - **Adopt the campaign's verification standard**, verbatim from its `ISSUES.md`: *"Confirm the code
>   changed is not a verification step."* Every item below is verified **behaviorally**, against a
>   running system. `/Users/bikram/Build/sonnet-org/ISSUES.md` carries a ready-made re-run for each
>   L-item — **use those, they are better than anything this review wrote.**
> - **Preserve `/Users/bikram/Build/sonnet-org/` as the pre-remediation baseline.** Do not remediate
>   against it: it is the only before-picture, its ledger is L-005's evidence, and its vendored
>   `node_modules` is L1-03's acceptance test. Replicate a fresh org from its `REPLICATION.md` instead.

**This is a queue, not an instruction to execute.** Nothing here has been started. Each item is
self-contained and claimable independently unless a dependency is stated.

**Read before claiming anything:**
- Acceptance criteria are derived from the evidence in the track files. If you cannot reproduce the
  evidence first, do not "fix" the item — the finding may be wrong, and confirming it is step one.
- `pnpm test` is currently **RED** (9 failures, ROOT-001). Do not treat green as your baseline until
  P0-07 lands. Until then, verify against the 9-failure baseline.
- `pnpm test` silently requires `pnpm build` at the current commit (ROOT-002 / P1-01).
- **Sequencing constraint:** `scripts/eval/**` and `test/**` bytes are hashed into
  `executable_suite_sha256`. Any edit there invalidates committed Phase 6 evidence and must be
  sequenced with a re-attestation. This affects P1-01, P1-06, P1-09, P2-09, P2-10, P2-11 and the
  formatting item. Coordinate with P0-07.
- Several fixes will make currently-green things red **by design** (P0-07, P1-07). That is success.

---

## L0 — Live-campaign P0s: do these before anything else

### L0-01 · Make an onboarded app able to reach `status: live` (L-001)
**Goal:** An app created the way the docs instruct must be promotable to `live`, so SRE/Support/
Marketing exist at all. Today they spent **zero tokens** across an entire $43.61 campaign.
**Acceptance criteria:**
- `operon app verify <name> --json` returns a **typed** result (`ready` / `blocked` / `invalid` with
  named check IDs) — never a raw `ENOENT` or unhandled exception.
- `operon new-app` writes the lifecycle record, **or** `verify` synthesizes/repairs it — one path owns it.
- `operon app promote <name> --to live --execute` transitions status to `live` **with no manual
  `apps.yaml` edit**.
- A documented recovery exists for an app already in the broken state (three sanctioned attempts failed
  in the campaign; today there is none).
**Files in scope:** `src/org/app-lifecycle.ts:187-222`, `src/org/new-app.ts`, `src/cli/app.ts`.
**Verification:** `/Users/bikram/Build/sonnet-org/ISSUES.md` Issue 1 — behavioral, no source reading.
**Blocks:** L0-02, L1-06, and *all* SRE/Support/Marketing testing. Nothing about those roles is
currently known.

### L0-02 · Make the sensitive-domain deep floor able to fire (L-004)
**Goal:** A goal explicitly about storing user data must receive elevated scrutiny. Today it receives
less than a typo fix.
**Acceptance criteria:**
- At least one ticket from *"Add a contact form that stores submissions, and a docs page explaining how
  we handle that user data"* carries a label matching `auth|security|secret|privacy|payment|data`
  (today: **0 of 5**), and the ticket touching the HTTP/storage surface is `op:tier-deep`.
- `sensitiveDomains` is populated by something — either domain labels attached at plan publication from
  the Planner's own risk prose (it already names the highest-risk ticket correctly), or derived from the
  diff at route time. `route-policy.ts:195` reads it from `input`; nothing supplies it, so
  `profile.sensitiveDomains.length > 0` at `:83`/`:92`/`:170`/`:209` is **always false**.
- Regression test: a ticket touching a storage/PII surface routes deep **without** a hand-applied label.
**Files in scope:** `src/loop/route-policy.ts:195`, `src/org/plan-auto.ts` (label publication),
`pipelines.yaml` / `docs/policy.yaml.template`.
**Verification:** ISSUES.md Issue 4. **Safety item** — AGENTS.md promises "tiering makes the loop
cheaper, never less safe"; measured, it did the opposite ($9.80 typo vs $3.05 user-data).

---

## P0 — Do these first

### P0-01 · Bind the self-approval HMAC to the reviewed commit (A-001)
**Goal:** Make a published self-approval marker non-replayable, so a builder cannot forge merge
authorization.
**Acceptance criteria:**
- `signSelfApproval` signs `"operon-self-approval:<pr>:<headRefOid>"`; verification resolves the PR
  head at merge time and rejects a marker minted for a different commit.
- `isMarkedSelfApproval` checks `review.author` (mirroring `isIndependentApproval`).
- The `self-merge-or-approve` gate rule matches **all** `gh pr review` / `gh pr merge` invocations
  regardless of flag — `--comment` must classify `critical`, matching the Claude deny pattern in
  `role-shaping.ts:33-34`.
- New test: replay of a **legitimately published** marker at a new commit is rejected. (Today only a
  *guessed* secret is tested — `test/loop.test.ts:547`.)
**Files in scope:** `src/loop/github.ts` (148-150, 471-477), `src/loop/loop.ts` (408, 1468-1498),
`src/runtime/gate.ts` (178-185), `test/loop.test.ts`, `test/gate.test.ts`.
**Verification:** `pnpm test`; add a gate case for `--comment` (per AGENTS.md: every new gate rule
needs a critical case *and* a routine near-miss). Reproduce the original probe first.

### P0-02 · Fail closed when the budget total cannot be computed (A-004)
**Goal:** One malformed ledger row must not disable the monthly cap or un-pause a paused app.
**Acceptance criteria:**
- A non-finite/absent `costUsd` yields `status: "unknown"` (or equivalent) and is treated as **over**
  cap, never `ok`.
- `budget.ts:173` never transitions paused → ok on an unverified total.
- Test: a $150 spend against a $100 budget with one row missing `costUsd` reports not-ok and does not
  un-pause.
**Files in scope:** `src/org/budget.ts`, `test/` budget coverage.
**Verification:** Reproduce Track A's probe ($150/$100 → `ok`) before and after. `pnpm test`.

### P0-03 · Fix secret-pattern word boundaries for snake_case credentials (A-003)
**Goal:** `GITHUB_TOKEN=…`, `DB_PASSWORD=…`, `aws_secret_access_key=…` must be redacted.
**Acceptance criteria:**
- `\b` replaced with explicit boundaries (`(^|[^A-Za-z0-9_])`) or a `[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|KEY)[A-Z0-9_]*\s*[:=]` shape.
- Both consumers (log scrubber, commit gate) are covered by the single list — verify the invariant
  still holds after the change.
- Tests cover snake_case, SCREAMING_SNAKE, hyphenated, and spaced-assignment forms, incl. the
  `aws_secret_access_key = …` case the source comment at `secret-patterns.ts:43-46` already claims.
- **Fold in P2-01 (A-007)** — add the six missing credential families in the same pass.
**Files in scope:** `src/runtime/secret-patterns.ts`, redaction + qgates consumers, their tests.
**Verification:** Reproduce Track A's leak probe. `pnpm test`.

### P0-04 · Evaluate scoped-grant path bounds against normalized paths, not raw JSON (A-005)
**Goal:** A grant scoped to `.npmrc` must not authorize `~/.ssh/id_rsa`.
**Acceptance criteria:**
- `pathContains` is evaluated against `normalizeSemanticAction(action).paths`, never the raw input JSON.
- Test: `cat ~/.aws/credentials # same idea as .npmrc` does **not** match a `.npmrc`-scoped grant.
**Files in scope:** `src/org/gate-compose.ts:39`, `src/runtime/gate.ts` (normalization), tests.
**Dependency:** Coordinate with P0-05 — identity and predicate should read the same normalized structure.
**Verification:** Reproduce the probe. `pnpm test`.

### P0-05 · Bind approval-grant identity to payload content (A-002)
**Goal:** A human approving payload X must not authorize payload Y.
**Acceptance criteria:**
- `actionHash` includes a content hash for payload-bearing tools (Write/Edit/patch/body), mirroring
  `publisher.ts:268-280`'s `final_diff_hash`.
- `findPendingEquivalentSync` dedupes on the enriched identity — a different-content raise creates a
  **new** pending item rather than collapsing into the one the human is reading.
- Test: benign and malicious `roles.yaml` writes produce **different** hashes (today: identical
  `61f09557d58c…`) and the malicious one is not covered by the benign grant.
- A migration/expiry story for in-flight grants is written down (the identity change invalidates them).
**Files in scope:** `src/org/approvals.ts` (479-491, 569-582), `src/runtime/gate.ts` (28-67), tests.
**Note:** Do **not** add content to the *classification* projection — discarding payload there is
correct (`gate.ts:25-27`). This is an authorization-identity change only.
**Verification:** Reproduce the byte-identical-hash probe. `pnpm test`.

### P0-06 · Make `withAppGitLock` safe: no live-lock breaking, no release-by-path (F-001)
**Goal:** Two roles must never run `git reset --hard` concurrently on one clone; releasing must not
delete someone else's lock.
**Acceptance criteria:**
- Force-break deadline is **above** the staleness window and gated on the liveness check actually
  failing (today: 60s break vs 120s staleness, and `:1112-1116` unlinks a live-PID lock anyway).
- The lock file carries an ownership token (pid+nonce); release verifies the token before unlink.
- Test: the documented interleaving (Planner A holds through a >60s clone; Builder B due same tick)
  results in B waiting, not breaking — and A's release does not remove B's lock.
**Files in scope:** `src/org/turn-runner.ts` (1070-1116), `test/` lock coverage.
**Dependency:** Read F-008/P2-20 first — the ledger's lock already has liveness + stale reclamation
and is the better model. Consider unifying rather than fixing twice.
**Verification:** New concurrent test modeled on `test/settlement/property.test.ts:45` — the repo's
only genuine race test.

### P0-07 · Make the Phase 6 attestation fail closed, and give it its input (ROOT-001)
**Goal:** The release gate must verify, or fail — never silently skip.
**Acceptance criteria:**
- `release-attestation.ts:180` no longer guards on `commitExists`; `changedPaths` is called
  unconditionally and `release_attestation_candidate_commit_unavailable` (`:283`) is allowed to throw.
- The candidate commit is **reachable** in CI: `fetch-depth: 0` in the workflow, and the candidate
  commit preserved by a tag (squash-merge orphans it — `c6834cf` lives only on
  `codex/phase6-incremental-qualification`).
- A `push:` trigger on `main` exists, so merges are verified (today `main` is only ever tested by the
  nightly cron, also shallow, also fail-open).
- Test: with the candidate commit absent, the verifier **throws** rather than passing. This test would
  fail today.
**Expected consequence — read this before starting:** fixing this correctly will turn the suite **RED**
in CI and require re-cutting the attestation. That is the point. **Whether `docs/**` belongs in
`ALLOWED_PROMOTION_PATHS`, or whether the changed-path rule should bind only to files affecting the
packaged artifact, is a human decision** (it changes what "qualified" means) — it belongs in
`docs/PURPOSE.md` and must be settled before this item is closed.
**Files in scope:** `scripts/eval/release-attestation.ts` (27-37, 180-182, 283, 319-327),
`.github/workflows/efficiency-qualification.yml` (3-7, 17), `research/evals/phase6-release-attestation.json`.
**Verification:** Reproduce the full ladder in `review/context-brief.md` §Signal 3 — especially the
ref-deletion experiment (9 fail → 30 pass). After the fix, that experiment must yield a **throw**.

---

## P1 — Structural

### P1-01 · Typecheck the other 45% of the repo, and fix the 21 errors it hides (ROOT-002)
**Goal:** The release gate must be compiled by the same compiler as the product.
**Acceptance criteria:**
- A `tsconfig.check.json` extends the base with `include: ["src/**","scripts/**","test/**","eval/**"]`,
  `noEmit: true`, no `rootDir`. `pnpm typecheck` uses it; `pnpm build` keeps the current config.
- All 21 errors fixed. Specifically: `attest-release.ts:6` `.map(resolve)` → `.map((p) => resolve(p))`;
  `evidence.ts:364` dead branch resolved (decide: is v1 back-compat still needed, or delete it?);
  `adapter-calibration.ts:38` `TurnHooks` import restored.
- CI runs the check.
- **`pnpm eval:attest-release -- --campaign <file>` executes without `TypeError`.**
**Files in scope:** `tsconfig.json`, new `tsconfig.check.json`, `package.json`, `scripts/eval/**`,
`.github/workflows/efficiency-qualification.yml`.
**Sequencing:** touches `scripts/eval/**` → re-attestation. Coordinate with P0-07.
**Verification:** `npx tsc --noEmit -p tsconfig.check.json` → 0 errors. Run the attest command.

### P1-02 · Invert the critical-ops gate from spelling-denylist to path-allowlist (A-006)
**Goal:** Classify what a command *does*, not what it's named.
**Acceptance criteria:** Protocol-surface writes classify `critical` regardless of verb (`git apply`,
alternate write verbs, `gh pr review --comment`). Classification keyed on resolved target paths from
`normalizeSemanticAction`. Escalation-rate impact measured and tuned.
**Files in scope:** `src/runtime/gate.ts`, `src/org/gate-compose.ts`, `test/gate.test.ts`.
**Verification:** Every new rule gets a critical case + a routine near-miss (AGENTS.md). Reproduce
Track A's synonym probes.
**Note:** vocabulary expansion is S and can ship first; the inversion is M.

### P1-03 · State the real module DAG once and enforce it with a test (M-01 = B-001 + E-001)
**Goal:** The invariant that keeps the loop extractable should be a property, not authorship.
**Acceptance criteria:** The full DAG (`cli → {observe → report} → org → org/learning → loop → runtime`,
plus `scripts/eval`) is stated in one place. A ~30-line test asserts the edge set and fails on a new
violating import (no new dependency). `docs/PURPOSE.md:291` ("is enforced") and `AGENTS.md:283`
("not lint-enforced yet") are reconciled — **reality matches AGENTS.md**, so PURPOSE.md is the one to fix.
**Files in scope:** `AGENTS.md`, `docs/PURPOSE.md`, new `test/architecture/imports.test.ts`.
**Verification:** Test fails when a deliberate violating import is added.

### P1-04 · Declare `scripts/eval/` a layer and cut its illegal edges (B-002)
**Goal:** The release gate must not reach past the boundaries it certifies.
**Acceptance criteria:** `scripts/eval` imports `src` public entry points only — not ten
`src/org/learning/` internals (`learning-activation-core.ts:3-12`, incl. `publisher.ts`, `approvals.ts`).
The `scripts/eval ↔ test/conformance` cycle (`adapter-calibration.ts:3` vs 53 reverse imports) is broken
by moving shared cases to a neutral module. Invariant #9 is then arguable over the right boundary.
**Files in scope:** `scripts/eval/**`, `test/conformance/cases.ts`.
**Dependency:** Fold into P1-03's edge test. Sequencing: touches `scripts/eval/**`.

### P1-05 · Break the `canary → episode → resolver → canary` runtime cycle (B-005)
**Goal:** `operon learn` must not depend on function-hoisting to start.
**Acceptance criteria:** No value-level cycle in `src/org/learning/`. Converting any of the three
targets from `function` to `const` does not throw `ReferenceError` at import.
**Files in scope:** `src/org/learning/{canary,episode,resolver}.ts`.
**Verification:** Cycle detection in P1-03's test. Manually flip one declaration to `const` and confirm
startup survives.

### P1-06 · Give "cannot determine" a representation; stop fail-open sentinels (C-001, +D-004)
**Goal:** No guard may fold "I could not check" into "false"/"fine". **This is the Theme-1 fix and the
highest-leverage item in the backlog.**
**Acceptance criteria:**
- `development-authorization.ts:415` and `:433` return a third state; a corrupt `qualification*.json`
  makes the spend guard **refuse**, not admit. (`:369`/`:395` legitimately mean "refuse" — keep, but
  mark the distinction explicitly.)
- `harness.ts:98` propagates the verifier's real error code instead of collapsing 14 causes into
  `"invalid_contract_observation"`.
- Where a swallow is correct, a rationale comment is required (the existing `src/` convention —
  `src/org/scheduler/evidence.ts:621` is the model).
- Tests: a corrupt evidence file causes refusal, not admission.
**Files in scope:** `scripts/eval/development-authorization.ts` (313, 369, 395, 415, 433),
`test/transformation/contracts/harness.ts`.
**Sequencing:** touches `scripts/eval/**` and `test/**` → re-attestation. Coordinate with P0-07.
**Related (same theme, separately claimable):** P0-02 (A-004), P1-07 (D-001), P1-14 (E-002).

### P1-07 · Make the Claude conformance suite prove something (D-001)
**Goal:** Invariant #12 must be enforced for the provider running 5 of 8 roles, including reviewer.
**Acceptance criteria:** A skipped live suite is **not** a pass — `probeAuth()` failure exits non-zero
unless `OPERON_ALLOW_SKIP_LIVE=1` is explicit. A mocked Claude conformance runs in the **offline**
suite so the contract is pinned without auth (`fake`, `pi-mocked`, `codex-mocked` already exist; Claude
is the gap).
**Files in scope:** `test/adapters/claude-sdk.live.test.ts:82`, `vitest.config.ts:9`,
`vitest.live.config.ts`, `test/conformance/`.
**Expected consequence:** may surface real Claude adapter gaps. That is the point.
**Verification:** Confirm today's zero-assertion exit-0 in scratchpad first, then that it fails after.

### P1-08 · Kill the `learn-cli` ordering dependency and widen the shuffle tripwire (D-002)
**Goal:** No shared mutable module-scope fixture; the tripwire must cover the code with the bug.
**Acceptance criteria:** `test/learning/learn-cli.test.ts` passes under `--sequence.shuffle` at seeds
424242, 987654321, and 1 (today: 3–4 failures). `ROOT` becomes a per-test fixture
(`test/fixtures/orgHome.ts` exists for this). `eval:deterministic:nightly` shuffles **all** of `test/`,
not six directories.
**Files in scope:** `test/learning/learn-cli.test.ts`, `package.json` (nightly script).
**Verification:** Run the three named seeds before and after.

### P1-09 · Make the contract tests test the product (D-003)
**Goal:** Stop asserting on the harness's own classifiers.
**Acceptance criteria:** `definePublicSurfaceDebt` is **deleted** (zero call sites repo-wide — the
entire CLI-spawning half of the harness is dead). The 20 classifier-only assertions collapse to a
couple of genuine unit tests for the classifier. Contract cases assert on real verifier outcomes and
error codes (which P1-06 makes available).
**Files in scope:** `test/transformation/contracts/harness.ts`, `workstream-{d,e,g,i}.test.ts`.
**Sequencing:** touches `test/**` → re-attestation. Coordinate with P0-07 and P1-06.

### P1-10 · Implement or remove `critical_ops` (E-002)
**Goal:** No documented safety control may be absent.
**Acceptance criteria:** **Either** `composeGate` reads `critical_ops` from `.operon/config.yaml` and
extends the rule set as `docs/architecture.md:1077-1079` and the generated file header both promise,
**or** the bootstrap prompt, the file key, and every claim are removed. `src/org/bootstrap.ts:931`
defers to "M7" while `docs/architecture.md:65,68` marks M7 implemented — resolve that too.
**Files in scope:** `src/org/bootstrap.ts:931`, `src/org/gate-compose.ts`, `docs/architecture.md`.
**Verification:** If implemented: gate test proving an operator-declared critical op is gated.

### P1-11 · Make `pnpm dev roles` validate the repo's file (E-003)
**Goal:** The prescribed check for a human-ratified surface must check the file being edited.
**Acceptance criteria:** A `--file`/repo-root mode validates the repo template, not the active org home
(which printed `Bikram-Org/roles.yaml` with `gpt-5.5` while the template says `gpt-5.6-sol`). It fails
on a bad edit and errors clearly on a fresh clone. `AGENTS.md:369` is corrected.
**Files in scope:** `src/cli/roles.ts`, `src/cli/pipelines.ts`, `AGENTS.md`.
**Related:** P2-02 (A-008) — this also routes platform dev through an operated org home.

### P1-12 · Write down `.operon/config.yaml`'s real schema and emit `setup_command` (E-004)
**Goal:** A file whose values reach `/bin/sh -lc` must have a validated schema.
**Acceptance criteria:** The effective schema — five command keys plus the undocumented nested
`commands:` map (`src/loop/driver.ts:863-908`) — is documented and validated on load. Bootstrap emits
`setup_command`, so a fresh app gets the `setup` gate AGENTS.md promises.
**Files in scope:** `src/loop/driver.ts`, `src/org/bootstrap.ts`, `docs/architecture.md`.
**Dependency:** Informs P0-05 (this path is the RCE target).

### P1-13 · Index the ledger; stop full-scanning per settlement (F-002)
**Goal:** Exactly-once settlement must not be O(N²).
**Acceptance criteria:** `recordTurnOnce` consults an index, not a full-history rescan. At 365k rows a
settlement is ~O(1) (today: 582ms; 4 concurrent = 2,247ms of a 5s lock budget). The settlement call
site (`pipeline.ts:816`) is wrapped in `try` so a settlement failure cannot discard a paid-for turn.
Invariants #5/#6 hold at 365k rows.
**Files in scope:** `src/org/budget.ts` / ledger writer, `src/loop/pipeline.ts:816`.
**Note:** `node:sqlite` is stable on the Node 26 floor and already contemplated by the learning-loop
upgrade path — but an append-only sidecar index may be enough. Adding a dependency is a decision
(TASTE.md §3).
**Dependency:** P1-14 removes the growth that makes this urgent.

### P1-14 · Retention for every state subtree, run by the scheduler (F-003)
**Goal:** State must not grow forever unattended.
**Acceptance criteria:** `telemetry/`, `efficiency/episodes/`, `invocations/`, `tasks/`, `learning/`,
`scheduler/evidence/` each have a retention policy (today only `runs/` does, via manual `prune-runs`).
Pruning runs from the scheduler tick. Ledger retention respects the reconciliation window.
**Files in scope:** `src/cli/prune-runs.ts`, `src/org/scheduler/`, `docs/scheduler.md`.
**Why it matters:** Phase 5 ships an autonomous scheduler writing these continuously with no operator
in the loop.

### P1-15 · Guard, back off, and batch observe's GitHub poll (F-004)
**Goal:** A presentation-only leaf must not be able to throttle the production path it observes.
**Acceptance criteria:** In-flight guard (no overlapping ticks over a job whose worst case is ~1,000s/app
against a 20s interval). Exponential backoff driven by the health signal already computed and currently
ignored. Per-PR fan-out (~302 `gh` spawns/poll at 3 apps × 50 PRs) batched into one GraphQL query.
**Files in scope:** `src/observe/github-source.ts`, `src/observe/live-source.ts`.
**Verification:** `pnpm test:observe-browser`, plus build/smoke/pack per AGENTS.md.

### P1-16 · Give `gh` spawns a real timeout (F-005)
**Goal:** A hung `gh` must not hang the build loop or orphan processes.
**Acceptance criteria:** `defaultGhExec` passes `timeout` + `killSignal` so the **child** is killed, not
just the promise raced. 403/429 handled with backoff.
**Files in scope:** `src/loop/github.ts:590-615`, `src/observe/` `bounded()`.
**Verification:** Test that a simulated hang terminates the child.

### P1-17 · Bound the report cache by bytes; stop rebuilding per page (F-006)
**Goal:** "Lazy bounded" must mean bounded memory.
**Acceptance criteria:** Cache bounded by size, not entry count. A paginated page does not rebuild the
whole report. `runs/` scanning is incremental/date-keyed.
**Files in scope:** `src/report/service.ts`, `src/report/project.ts`.
**Verification:** Per AGENTS.md, report changes need browser/build/smoke/pack + UTC-boundary,
pagination-resync, and read-only tests.

### P1-18 · Make lock acquisition atomic, not check-then-act (F-007)
**Goal:** Ordinary contention must not crash a dispatch tick.
**Acceptance criteria:** `acquireLock`/`ensureTurnLock` use the `O_EXCL`-create result as the
acquisition signal; `ENOENT`/`EEXIST` are ordinary contention outcomes, not unhandled throws. Two roles
due in one tick (the documented expected case) → one waits.
**Files in scope:** `src/org/locks.ts`, `src/org/turn-runner.ts`.
**Dependency:** Do with P0-06 and P2-20 — one lock story, not three.

---

## L1 — Live-campaign P1/P2s

### L1-01 · Make `dispatch` say why it skipped (L-002) — **highest value-per-effort in the backlog**
**Goal:** An operator must be able to learn why events are ignored, without source access.
**Acceptance criteria:** `operon dispatch` output **or** the `state/invocations/*.jsonl` row names the
app and the reason (e.g. `buildstacks-site: skipped, app not live`). Today `dispatch.ts:371` is a bare
`continue` while `result.skipped.push` is used at **199/213/227/243/248** for every other skip reason.
7 real events — including a critical health-alert against a genuinely killed server — produced
`spawned=0 skipped=0 errors=0`, identical under `--dry-run`.
**Files in scope:** `src/org/dispatch.ts:371`.
**Verification:** ISSUES.md Issue 2. **Effort: S — one line.** Ship it with L0-01.

### L1-02 · Run the setup gate before the builder's baseline check (L-003; deepens E-004/P1-12)
**Goal:** A greenfield app must not be guaranteed to fail its first ticket.
**Acceptance criteria:** With `setup_command: npm install` correctly nested and **no** pre-vendored
`node_modules`, the first ticket's `build/implement` does not fail on a missing-dependency baseline.
`envelope.json`'s `previews.output` contains no dependency-resolution error, and `events.jsonl` shows a
`setup`/`gate.*` **pass before** the implement pass begins. `runSetupGate` (`qgates.ts:189`, sole call
site `:435`) becomes reachable at worktree provision; the post-implement re-run stays.
**Files in scope:** `src/loop/qgates.ts`, `src/loop/loop.ts:236` (`advanceGates`), `createWorktree()`.
**Also:** once fixed, revert the operator's 26MB vendored `node_modules` on `buildstacks-site` `main`
and restore `.gitignore` — that revert **is** the acceptance test.
**Verification:** ISSUES.md Issue 3.

### L1-03 · Make budget exhaustion a clean terminal state, not a crash (L-005)
**Goal:** A cap firing correctly must not crash the loop or orphan a mergeable PR — or drop a paid-for turn.
**Acceptance criteria:** At the cap, the ticket transitions to a correctly-labeled terminal state
(`op:returned` + budget-exhaustion evidence comment) instead of `loop.ts:773`
`throw new Error("ship pipeline aborted before completion")` exiting 1. The label must not read "PR open,
review in progress" when the loop will never touch it again. `--resume-episode` either executes or states
plainly that it previews (confirmed read-only today: budget unchanged before/after).
**Coupled to P1-13:** the crash unwinds past the settlement `pipeline.ts:816` doesn't wrap in `try`.
Live ledger: `unsettled_passes: 8`, `terminal_unsettled_usage_passes: 1` — **money spent, never
recorded, at 48 turns.** Invariant #5 is already violated. Fix both together.
**Files in scope:** `src/loop/loop.ts:773`, `src/loop/pipeline.ts:816`, `src/cli/loop.ts`.
**Verification:** ISSUES.md Issue 5, plus `report --json` showing `terminal_unsettled_usage_passes: 0`.

### L1-04 · Make dependency re-arm orchestrator-owned (L-007)
**Goal:** A multi-ticket milestone must complete unattended when every ticket succeeds.
**Acceptance criteria:** T2 carries `op:ready` shortly after T1 merges, **with no manual label edit**.
Confirmed broken 3× — including after two *clean* merges (#12 after #11, #16 after #15). The one
documented mechanism ("the Planner's groom pass") is described in Operon's **own retro** as *"advisory
prompt language, unenforced."* `src/loop/scheduling.ts` already models the graph
(`selectReadyTickets`/`parseDependsOn`) — the transition needs an owner, not a new design.
**Files in scope:** `src/loop/scheduling.ts`, `src/loop/loop.ts` (merge transition), `src/org/dispatch.ts`.
**Verification:** ISSUES.md Issue 7. **Theme 6** — this is the direct cause of 10/17 tickets never
being claimed and the app reaching ~25% of its goal.

### L1-05 · Classify approvals by action, not prose (L-006 + campaign #8) — **sequence with P0-01…P0-05**
**Goal:** The approval queue must escalate what an action *does*, not what its text *says*.
**Acceptance criteria:**
- A `gh pr review --approve --body "…"` whose body merely *discusses and rules out* a security concern
  does **not** appear in the queue. Today, probe-confirmed: it classifies **CRITICAL/`secrets-or-auth`**
  — that is 7 of the campaign's 9 false positives. A read-only `cat .operon/config.yaml` likewise must
  not escalate on filename mention alone.
- The **same** change must not re-open the A-001 hole: `gh pr review --comment` carrying a self-approval
  marker classifies **routine** today and must become critical (P0-01).
- `dimension_globs.security` predicates on the diff (`dependencies`, `scripts.*`), not a bare
  `package.json` path match (`docs/policy.yaml.template:60`) — or the bluntness is recorded as a
  deliberate decision (ISSUES.md Issue 6 explicitly permits this).
- Target: false-positive rate well below the measured **9/9 (100%)**, with **no** new false negatives.
**Files in scope:** `src/runtime/gate.ts`, `src/org/gate-compose.ts`, `docs/policy.yaml.template:60`,
`test/gate.test.ts`.
**Why it is P0-adjacent despite being rated P2 by the campaign:** the false positives are the *delivery
mechanism* for A-001/A-002. An operator with a 100%-false-alarm queue (0 denials) approves the tenth
item. **Do not ship P0-01…P0-05 without this.**
**Verification:** ISSUES.md Issue 8 + re-run the §2.1 probe in the crossref.

### L1-06 · Fix the remaining live papercuts (L-008, L-009, L-010)
**Goal:** Three independent Theme-1/Theme-6 papercuts, each effort **S**, each with a ready re-run.
**Acceptance criteria:**
- **L-008:** `plan --auto --goal … --explain-route` either plans *and* explains, or **errors loudly** on
  the incompatible combination. Silent no-op (exit 0, $0, 0 tickets, no warning) is the only
  unacceptable outcome — and it is the campaign doc's own Phase 3 instruction. *(ISSUES.md Issue 9)*
- **L-009:** the orchestrator's `denial-lessons.md` passes its own loader — no `skipping malformed
  memory doc` warning (`memory.ts:88`/`:145`). Add a **writer→loader round-trip test**; its absence is
  why this shipped. Until fixed, AGENTS.md's "durable denial lessons" does not close the loop.
  *(ISSUES.md Issue 10)*
- **L-010:** the loop respects the repo's actual default branch, or fails with a clear error naming the
  mismatch — not a raw `git fetch` stack trace. `driver.ts:929` hardcodes `main`; `baseBranch` exists in
  the type system, unexposed. `app-lifecycle.ts:683` already resolves it via `ls-remote --symref`.
  *(ISSUES.md Issue 11)*
**Files in scope:** `src/cli/plan.ts`, `src/org/memory.ts`, `src/loop/driver.ts:929`.

---

## P2 — Maintainability / consistency

| id | Goal | Acceptance criteria | Files | Verify |
| --- | --- | --- | --- | --- |
| **P2-01** (A-007) | Cover six missing credential families | Stripe/Slack/Google/npm/etc. patterns added + tested | `src/runtime/secret-patterns.ts` | **Fold into P0-03** |
| **P2-02** (A-008) | Mechanically enforce invariant #18 | A check prevents the repo being bootstrapped as an operated org (root instructions/grants/eval state/CI authority never enter an org) | `src/org/home.ts`, `src/org/bootstrap.ts` | New test; relates to P1-11 |
| **P2-03** (B-004) | Stop shipping test scaffolding | `src/runtime/testing/**` excluded from the published package | `package.json` `files`, `src/runtime/testing/` | `npm pack --dry-run`; `pnpm smoke:onboarding` |
| **P2-04** (B-006) | Make adding a Runtime compiler-forced | All 7 sites exhaustive (today 2 forced, 5 silently stale, incl. a fallthrough mislabeling a new provider as **Claude**) | `src/runtime/`, adapters | Add a 4th provider stub; compiler must catch every site |
| **P2-05** (B-007) | Stop the gate attesting itself; de-duplicate policy | `PHASE6_CONTRACT_IDS` sourced from `eval/contracts.yaml`, not a hardcoded Set. Document/justify the verifier-attests-itself loop | `scripts/eval/release-attestation.ts:21-49` | **Sequence with P0-07** |
| **P2-06** (M-02 = B-008+C-006) | Decompose the two real hotspots | `runPass` (520 lines, 59 branches, 4 `try`, 29 `await`, on every provider turn) extracted along the seams its own comments name: `authorizeRoute`, `captureReplaySeed`, `withHeartbeat`, `classifyFailure`, `settleAndRecord`. `learn report` (406) likewise. **Do not touch the durable-before-throw ordering at `pipeline.ts:960`** — it is load-bearing and commented as such | `src/loop/pipeline.ts:461-980`, `src/cli/learn.ts:897-1302` | `pnpm test`; `src/loop/loop.ts` is the model to copy, **not** a target |
| **P2-07** (B-009) | One module per subcommand, one source of truth | Convention applied consistently; help text generated from the registry, not hand-copied | `src/cli/`, `src/cli.ts` | Fold with P2-19 |
| **P2-08** (B-010) | Make invariant #10 structural, as claimed | The policy validator runs on the **default-construction** path, not only where tests call it | `src/org/learning/policy.ts` | Test that a T3 canary is refused via default construction |
| **P2-09** (C-002) | Report which check failed | Mega-predicates (23 clauses / 1160 chars at `learning-activation-core.ts:184`; 23 / 958 at `learning-evidence.ts:86`; 13 at `contract-evidence.ts:200`) become accumulate-then-report lists. The pattern already exists in `core.ts` (`validateCampaign`/`validateResult` return `string[]`) | `scripts/eval/**` (25 lines) | **Sequence with P0-07**; pairs with P1-06 |
| **P2-10** (C-003) | One error protocol | A single `code`-carrying error type (or `const CODES` union) so `tsc` checks codes and tests assert on `err.code`. Retire Protocol 4 — `report/service.ts:51` makes HTTP status depend on a message prefix | `src/**`, `scripts/**` (647 sites) | Large; stage by area. **Sequence with P0-07** |
| **P2-11** (C-004) | One `digest`, one `repositoryRelative` | The three `digest()` **compute** clones deleted in favour of `core.ts:158 sha256()`; the surviving formatter renamed (`withSha256Prefix`) so it cannot read as "compute". `repositoryRelative` (a path-escape guard, triplicated verbatim) moved to `core.ts` taking the error code as a param | `scripts/eval/{contract-evidence,release-attestation,promotion,learning-efficacy,fault-worker,virtual-soak}.ts`, `core.ts` | **Sequence with P0-07.** Highest value-per-effort in P2 — a traversal fix today lands in 1 of 3 copies |
| **P2-12** (C-005) | Validate what `validateEvalFixture` claims | The five sub-objects get real field validation; all 4 `as unknown as` deleted. `fixtureTrustGaps:321` gets the same `undefined` defense as `:322` | `src/org/learning/eval-fixture.ts:362-415`, `validate.ts` | Test: `expected_outcome: { review_cycles: "3" }` must be **rejected** (today it passes: `2 > "3"` → false) |
| **P2-13** (D-005) | Recover 61% of test wall-clock | Worker cap raised from 2 after measuring; AGENTS.md's contention rationale updated with numbers (108.4s → 42.1s at 8, zero flake, byte-identical). Note the cap is **not** what protects determinism (P1-08 proves the ordering bug survives 2 workers) | `vitest.config.ts`, `package.json`, `AGENTS.md` | 3 runs at the new count, byte-identical results; land **after** P1-08 |
| **P2-14** (D-006) | CI and developers run the same command | CI runs `pnpm test` (not `vitest run --maxWorkers=2 --testTimeout=15000`, 3× the developer timeout), or the difference is documented and justified | `.github/workflows/efficiency-qualification.yml:30` | Compare CI vs local invocation |
| **P2-15** (D-007) | Fix over-mocked boundaries | See `review/track-d-findings.md` D-007 | per finding | `pnpm test` |
| **P2-16** (D-008) | Lift the parallelism floor | `test/lifecycle/faults.test.ts` (41.11s of a 42.06s wall at 8 workers) split — vitest parallelizes per **file**, so no worker count helps. 15 of 43 tests spend ~1.8s each in `bootstrapReachable` | `test/lifecycle/faults.test.ts` | Wall time at 8 workers; land after P2-13 |
| **P2-17** (D-009) | Test the lock primitive as concurrent | `src/org/locks.ts` gets a genuine concurrent race test — today one sequential test a TOCTOU bug would also pass. **1 of 185 files** runs a real race: `test/settlement/property.test.ts:45` is the model | `test/` lock coverage | Test must fail against today's `acquireLock` (P1-18) |
| **P2-18** (E-005) | Onboarding doc that isn't 100 files behind | `docs/wiki.html` updated **or archived with a pointer**. It still says the scheduler is "launchd now, systemd later" — it's a shipped 7-module subsystem with its own contract doc | `docs/wiki.html` | Human read-through |
| **P2-19** (E-006, E-007) | One answer to "what do I run" | The three inconsistent docs reconciled (only the CI workflow has the order right). Add a `pretest` that builds, or remove the `dist/` dependence. `operon capabilities` generated from the command registry (it is hand-copied and **omits itself**) | `AGENTS.md`, `README.md`, `package.json`, `src/cli/capabilities.ts` | A fresh clone: follow the docs literally and reach green |
| **P2-20** (F-008) | One lock implementation | The two divergent implementations unified on the ledger's model (liveness check + stale reclamation), which the turn lock lacks | `src/org/locks.ts`, `src/org/turn-runner.ts` | **Do with P0-06 + P1-18** |

---

## Suggested sequencing — REVISED 2026-07-17

**Wave 0 — make the product reachable and observable.** `L0-01` + `L1-01` (+`L1-02`). Half the system
currently never runs; most of this backlog is **unverifiable** until it does, because the code paths
don't execute. `L1-01` is one line and turns "invisibly broken" into "broken", which is a prerequisite
for every behavioral verification below. **Expect new findings** once SRE/Support/Marketing wake for the
first time — their cost and quality are entirely unmeasured today, and a clean bill would be surprising.

**Wave 1 — close the approval boundary as one piece.** `L1-05` **together with** `P0-01`, `P0-03`,
`P0-04`, `P0-02`, then `P0-05`. Four of these are one-to-few-line fixes closing four P0s — the highest
impact-to-effort in the review. **Do not ship the exploit fixes without the false-positive fix:** the
9/9 false-alarm rate is what trains the operator to approve the tenth item. Same classifier, same defect,
one change.

**Wave 2 — safety proportionality.** `L0-02` (the deep floor cannot fire) + `L1-05`'s
`dimension_globs` half. These are the two halves of "tiering makes the loop cheaper, never less safe",
which measured backwards ($9.80 typo vs $3.05 user-data).

**Wave 3 — the fail-open/fail-silent sweep.** `P1-06` + `P1-07` + `L1-06` — the "cannot determine"
state. **One decision, applied at ~nine sites.** This is Theme 1 wholesale and the highest-leverage
change in the codebase.

**Wave 4 — durability.** The lock trio as one piece (`P0-06` + `P1-18` + `P2-20`), then `L1-03` +
`P1-13` together (the crash and the missing `try` are one bug reached from two directions), then
`P1-14` before `P1-13`'s scaling work (it removes the pressure). `L1-04` (re-arm) belongs here too.

**Wave 5 — the release gate.** `P0-07` + `P1-01`. Deliberately *later* than the original plan: the
attestation gates *releases*, and there is no point certifying a product whose SRE half has never run.
Settle the `ALLOWED_PROMOTION_PATHS` decision with the humans first; expect red.

**Wave 6 — everything else** (P2 cleanups, decomposition, docs).

**Still true:** do not start with P2 cleanups in `scripts/eval/**` — they invalidate Phase 6 evidence
and will need re-attesting twice if sequenced before `P0-07`.

---

## Verification protocol (adopted from the campaign, 2026-07-17)

The campaign's `ISSUES.md` sets the standard and it is better than anything this review wrote:

> *"'Confirm the code changed' is not a verification step; these are behavioral checks against the
> running system."*

**Rules for remediation:**
1. **Reproduce before you fix.** If you cannot reproduce the evidence, the finding may be wrong.
   Confirming it is step one, and "the finding was wrong" is a legitimate outcome to report.
2. **Verify behaviorally, on a running system.** Green unit tests are necessary, never sufficient —
   D-003 exists precisely because 20 of 30 contract tests assert on their own harness.
3. **Preserve `/Users/bikram/Build/sonnet-org/` as the pre-remediation baseline.** Do not remediate
   against it. It is the only before-picture; its ledger is L-005's evidence; its vendored
   `node_modules` is L1-02's acceptance test. Replicate a fresh org from its `REPLICATION.md` (Steps
   0-9, expected failures called out per finding) for a true A/B.
4. **Cost anchor:** the baseline campaign was **$43.61 of a $400 ceiling (10.9%)** — 48 turns, 17
   tickets, 4 merged PRs. A verification replication is ~**$45-90**. Budget was never the constraint;
   **every** limitation in that campaign was a defect. Do not let cost shape this decision.
5. **Two gaps replication will not close** — close them deliberately:
   - **The A-series needs adversarial probes, not a cooperative run.** A replication re-tests
     L-001…L-010; it will not re-test A-001…A-005 or F-001. Those probes are token-free and exist
     already (crossref §2.1, and each P0's acceptance criteria) — **land them in the offline suite**,
     where they become permanent regression tests rather than one-off findings.
   - **F-001 needs concurrency.** The campaign ran one app sequentially and never triggered it. Model
     the interleaving in a test (`test/settlement/property.test.ts:45` is the only genuine race test in
     185 files — copy it).

---

## Adjacent findings filed during remediation (not fixed — per protocol rule 4)

### Filed during Wave 0 (2026-07-17; sources: implementer/verifier/scope-check reports, `review/remediation-log.md`)

- **W0-ADJ-01** (from L1-01) · The invocations ledger row still carries no skip detail:
  `src/cli/dispatch.ts:45-54` `recordInvocation` builds `outcome` only from `result.spawned` and
  `result.errors`, so a skip-only tick writes `outcome:"no-due-triggers"` even now that
  `result.skipped` is populated. L1-01's criterion was an OR, satisfied via CLI output; an operator
  reconstructing history from `invocations/*.jsonl` alone still cannot see skip reasons. The
  scope-check echo: the non-live skip is also not pushed into the `blocked[]` decision array (unlike
  the overlay-paused branch), so scheduler decision evidence omits it. Effort S.
- **W0-ADJ-02** (from L1-02 scope check) · `advanceProvisionSetup` runs on every engine
  `runLoopOnce`, including a resumed ticket rehydrated to `phase="gates"` (open PR). A transient
  install failure during resume would return an already-in-review ticket to `op:returned` —
  defensible (deps are required; post-implement re-run would fail similarly) but behavior the
  finding did not request; could abandon a healthy open PR on an install blip. Consider skipping the
  provision run (or downgrading failure to retry) when rehydrating past `building`. Effort S.
- **W0-ADJ-03** (from L1-02) · The env preflight's "offline-install trap" (`src/loop/preflight.ts:96-107`)
  only warns that a setup command would fail offline; now that provision setup actually installs,
  the two overlap for install-shaped commands. Reconcile (e.g. let the provision gate's real result
  subsume the warning). Also: `gateRunlog` (`src/loop/driver.ts`) derives its episode id from
  `${ticketRef}-gates` while `admitTicketEpisode` uses `${ticketRef}`, so gate/provision-setup run
  records attach to a separate deterministic-route episode — pre-existing, worth unifying. Effort S.
- **W0-ADJ-04** (from L0-01, **compounds L1-02 / fold into P1-12**) · `loadGateCommands`
  (`src/loop/driver.ts:863`) reads gate commands from the sole app entry (`soleApp ?? raw`), so the
  TOP-LEVEL `setup_command`/`test_command`/`lint_command` that `new-app`'s `appendGateCommands`
  writes are silently ignored whenever the config has exactly one app — dead config. A fresh
  greenfield app's `setup_command` therefore never reaches the loop even after L1-02. **Likely
  gates the E2E replication's L-003 pass condition** — decide whether to pull this slice of P1-12
  forward before the paid run. Effort S–M.
- **W0-ADJ-05** (from L0-01) · `operon app verify`'s app-check gates (`app-check-tests`/`app-check-lint`)
  run in the managed clone without any dependency install, so a real npm-based scaffold cannot reach
  `ready` without a manual install in the managed clone — the L-003 mechanism surfacing on the
  verify path. Consider running the setup gate before app checks in `verifyApp`. Effort S–M.
- **W0-ADJ-06** (from L0-01) · `app verify`/`app promote` cannot reach `ready` when a configured
  adapter package is not installed/resolvable (observed: `runtime-codex` fails when
  `@openai/codex` doesn't resolve; it ships bin-only with no main/exports under this pnpm layout),
  and the CLI offers no runtime-readiness injection (only programmatic `verifyApp` does). Worth a
  typed "adapter package not installed" remediation and/or a documented flow. Effort S.
- **W0-ADJ-07** (from L0-01) · The GitHub-slug synthesis fallback (pre-existing broken apps with no
  onboarding pointer) attempts a network clone of `https://github.com/<slug>.git` with no
  local-remote override — fails typed (not a crash) on private repos without auth, and is not
  offline-testable. Acceptable for real apps; noted for test/design debt. Effort S.
- **W0-ADJ-08** (from L0-01 scope check, pre-existing) · `verifyApp` record synthesis (and the
  pre-existing `recreateManagedClone`/synchronize path) mutates state without
  `acquireLifecycleOperationLock`; two concurrent `operon app verify` invocations could race on the
  clone/record write. Fold into the Wave 4 lock work (P0-06/P1-18/P2-20 family). Effort S.
- **W0-ADJ-09** (tooling/doc nits, no product change) · (a) `pnpm dev` (tsx 4.23.0) crashes with
  `listen EINVAL … .pipe` when TMPDIR is a long path (macOS unix-socket length limit) — the
  temp-HOME/TMPDIR isolation pattern breaks the dev entrypoint; compiled `dist/cli.js` is
  unaffected. (b) This backlog's L1-01 line inventory of `skipped.push` sites (199/213/227/243/248)
  is partial — dispatch.ts also pushes named skips at 403/417/435.

### Filed during Waves 1–4 (full detail per item in `review/remediation-log.md`)

**Wave 1 (approval boundary):** W1-ADJ-01/02 — the bash command *string* is agent free text
(`|| : .npmrc`, quoted args, heredocs) still reaches the classifier/grant text ⇒ **A-006/P1-02** is
the real structural fix (classify by resolved target path, not text); W1-ADJ-03 — camelCase/plural/
value-side-`\b` credential forms still miss redaction; W1-ADJ-04 — `AUTHORITY.md` edits classify
routine (protocol-self-edit gap); W1-ADJ-05 — budget `unknown` shows as generic `exceeded` in the
report schema; W1-ADJ-06 — `normalizeSemanticAction.effect` is dead input in the identity surface;
W1-ADJ-07 — no mechanical drift guard between `SEMANTIC_INPUT_KEYS` and gate.ts's consumed keys.

**Wave 2 (safety proportionality):** W2-ADJ-01 — the deep floor still misses a PII ticket that names
no domain keyword (diff-derived `sensitiveDomains` at route time left out); W2-ADJ-02 —
`data-driven`/`data-first` over-fire `data`; W2-ADJ-03 — prefix-compounds (`reauthorize`,
`unauthorized`, `prepayment`) miss (mitigated by the L1-05 file-path dimension); W2-ADJ-04 —
`token`/`credentials`/`password`/`PII`/`SSN` outside the six-keyword set (and the `domain:secret`
label description overclaims); W2-ADJ-05 — `driver.ts` label reader is substring over labels;
W2-ADJ-06 — bootstrap tier is exempt from the floor by design.

**Wave 3 (fail-open sweep):** W3-ADJ-01 — more hardcoded `main` (`loop.ts:1464` PR base, `:1795`
`durableWorkSummary`, `github.ts:699` `baseRefName`); W3-ADJ-02 — `probeAuth()` has no timeout (a
hung auth stalls live-suite collection); W3-ADJ-03 — `lineageEquivalentCost:216` `catch { continue }`
could undercount descendant spend; W3-ADJ-04 — the new `prior_qualification_undeterminable` code is
undocumented and an unrelated grant's corrupt manifest also forces refusal.

**Wave 4 (durability):** W4-ADJ-01 — **the turn lock still releases by bare `rm`** (F-001's
release-by-path class, live on the turn lock; re-express onto the new `src/runtime/file-lock.ts`, a
5-call-site change) and the settlement lock is un-unified (F-008 only partially met); W4-ADJ-02 —
lock edge cases (8-retry synthetic stale holder; torn-write age uses real `Date.now()`); W4-ADJ-03 —
the P1-13 sidecar index is a constant-factor win, **not asymptotically O(1)** (F-002 tail reduced,
not eliminated); W4-ADJ-04 — no fsync on ledger/index (power-loss could yield index-leads-ledger →
lost settlement); W4-ADJ-05 — `rearmDependents` treats closed-without-merge as satisfied; W4-ADJ-06 —
the retention pruner doesn't clear the sibling `telemetry-index/` sidecar; W4-ADJ-07 — the daily
retention sweep does a full-ledger scan per UTC-day tick.

### Deferred to Wave 5 (release gate — this session stopped before it, per plan)

- **P0-07** (ROOT-001) — make the Phase 6 attestation fail closed + give it its input. **Blocked on a
  human decision** (should `docs/**` be in `ALLOWED_PROMOTION_PATHS`, or should the changed-path rule
  bind only to files affecting the packaged artifact? → `docs/PURPOSE.md`). Deliberately turns the
  suite red and requires re-cutting the attestation.
- **P1-01** (ROOT-002) — typecheck `scripts/**`+`test/**` (21 hidden errors incl. the broken
  `attest-release` command); the `tsconfig.check.json` split.
- **P1-06 harness half** — propagate the verifier's real error code at `harness.ts:98` instead of
  collapsing 14 causes into `invalid_contract_observation` (this is the 9-failure baseline's code).
- **P1-09** (D-003) — delete `definePublicSurfaceDebt` (dead), make the contract tests assert on real
  verifier outcomes (uses P1-06's error codes).
- All of these touch `scripts/eval/**` or `test/transformation/**` (Phase-6-hashed) and must be
  sequenced with the P0-07 re-attestation — one re-cut, not four.

**Wave 5 completed (2026-07-17):** all four deferred items above shipped (P1-09 carries the P1-06
harness half) plus E2E-01. Integrated onto `remediation/wave-5`, unpushed. `pnpm test` → the same nine
ROOT-001 failures, now naming the real code `release_attestation_package_mismatch`. The nine cannot be
greened token-free — the product moved past qualified candidate `c6834cf0`, so `attest-release` refuses
with `release_package_bytes_changed_after_qualification` (captured verbatim in
`review/remediation-log.md`). Re-qualification is a human-authorized, token-spending decision
(Options 1/2/3 in the log).

### Filed during Wave 5 (release gate; 2026-07-17; sources: implementer/verifier/scope-check reports)

- **W5-ADJ-01 (P0-07 install-config exemption rationale overbroad):** the exemption for `pnpm-lock.yaml`
  from the executable-suite changed-path rule is justified by "resolved runtime deps are pinned by
  `system_fingerprint`," but `system_fingerprint` reads only `package.json` `dependencies` (the 4
  runtime deps) and is not recomputed at verify. The test-**grading** toolchain (`vitest`, `tsx`,
  `@playwright/test`) is in `devDependencies`, pinned by `pnpm-lock.yaml` alone, which is now exempt and
  covered by no attestation hash — a post-qualification lockfile toolchain swap sits in the exact
  "report the suite green" plane ROOT-001 targets. Low residual risk (a committed lockfile change is
  review-visible; primary Phase-6 evidence is content-hashed under `eval/`, which IS suite-governed).
  Correct the stated rationale and decide whether `pnpm-lock.yaml` / `.npmrc` should join the executable
  suite.
- **W5-ADJ-02 (P1-01 `evidence.ts:364` v1-branch deletion is a fail-closed runtime change):** the
  removed `sanitized-evidence/v1` branch was reachable at runtime (v1 is in `LEGACY_ARCHIVE_POLICIES`,
  admitted at line 329); the `TS2367` existed only because `ArchiveManifest.policy_version` is declared
  v3-only. A v1 archive now falls through to the v3-structured path and is rejected. Fail-closed and
  AC-sanctioned, but leaves the code incoherent (v1 admitted then always rejected). Either drop v1 from
  `LEGACY_ARCHIVE_POLICIES` too, or widen `ArchiveManifest.policy_version` to the union (fixes `TS2367`
  AND preserves v1 back-compat).
- **W5-ADJ-03 (P1-01 no regression test for the attest-release crash):** the `.map(resolve)` variadic
  crash the AC foregrounds is guarded only by the config-surface test, not the command itself, so it
  could silently regress. Minor (a clean offline pass-test is hard now that the command reaches the
  legitimate package-mismatch domain error).
- **W5-ADJ-04 (P1-01 docs):** AGENTS.md documents `pnpm typecheck`; typecheck now covers
  `src`/`scripts`/`test`/`eval` via `tsconfig.check.json` — a one-line note arguably merits inclusion.
  Minor; command name unchanged, no hard maintenance-rule violation.
- **W0-ADJ-04 (fixed by E2E-01, recorded here for the chain):** `loadGateCommands` read gate commands
  only from the sole app entry, so the top-level `setup_command`/`test_command`/`lint_command` that
  `new-app` writes were dead config that never reached `verify` or the loop. Fixed in `088301b`.
