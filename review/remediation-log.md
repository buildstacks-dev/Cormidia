# Remediation log

Per-item record required by the remediation protocol. One entry per finding id: branch, diff
summary, acceptance criteria restated, verification (command + actual output), doc updates,
adjacent items filed. Baseline for every entry: `main` @ `f19fb6f`, `pnpm test` RED with exactly
9 failures (D-LIVE-01/02/03, E-LIVE-01/02, G-MET-01, I-ROLE-01/02/03 — ROOT-001, expected until
P0-07). Every item below was verified by an independent agent (not the implementer) and passed an
adversarial scope check. No branch is merged or pushed.

---

## Wave 0 — reachability/observability (2026-07-17)

Orchestration: one Workflow invocation (`wf_e963a442-f55`), 9 agents (3 implement / 3 verify /
3 scope-check), disjoint file scopes, isolated worktrees, one branch per finding.

---

### L0-01 (L-001, P0) — apps created via `new-app` can never reach `status: live`

**Branch:** `fix/l0-01-app-lifecycle-live` @ `793f384` (1 commit, off `f19fb6f`)

**Acceptance criteria (restated):**
1. `operon app verify <name> --json` returns a typed result (`ready`/`blocked`/`invalid` with
   named check IDs) — never a raw ENOENT/unhandled exception, including when the record is missing.
2. `new-app` writes the lifecycle record OR `verify` synthesizes/repairs it — one path owns it.
3. `operon app promote <name> --to live --execute` reaches `live` with no manual `apps.yaml` edit.
4. A documented recovery exists for an app already in the broken state.

**Design decision:** VERIFY owns record synthesis/repair. `new-app` runs before `git init`/push, so
at scaffold time no commit/remote/managed-clone exists — it *cannot* write a valid record. `verify`
already has the machinery (remote reads, clone recreation, hashing). `new-app` now writes an
`onboarding-source.json` pointer (same pattern as its `answers.json`); `verify` synthesizes
`record.json` from it after push, with a GitHub-slug fallback for pre-existing broken apps.

**Diff:** 6 files, +537/−2. `src/org/app-lifecycle.ts` (verify-time synthesis + typed
`unverifiableReport`; corrupt record → typed `lifecycle-record` fail), `src/org/onboarding-answers.ts`
(pointer schema/read/write), `src/org/new-app.ts` (write pointer), new
`test/lifecycle/greenfield-record.test.ts` (4 tests), `docs/architecture.md`,
`agent-skills/operon/SKILL.md`. (Note: commit message understates the diffstat as +366/−2; file set
is accurate.)

**Evidence reproduced first (baseline `f19fb6f`, temp trees, local remotes only):**
`pnpm dev new-app repro-app …` wrote `answers.json` but no `record.json`; then
`pnpm dev app verify repro-app --json` →
`ENOENT: no such file or directory, lstat '…/state/lifecycle/apps/repro-app/record.json'`, EXIT=1.

**Verification (independent agent, behavioral per sonnet-org/ISSUES.md Issue 1, token-free):**
- Gates: build clean; typecheck clean; `pnpm test` → `9 failed | 1586 passed (1595)`, exactly the
  ROOT-001 nine. `pnpm smoke:onboarding` PASS; `npm pack --dry-run` unchanged (208 files).
- Unpushed scaffold: `app verify --json` → `status: "blocked"`, check `lifecycle-record` with
  remediation text; EXIT=2. No exception.
- After push to a **local bare** origin: `verify` synthesized `record.json`, all 13 checks pass,
  `status: "ready"` (app test/lint scripts no-op'd and codex→claude in the *scratch org copy only*,
  to neutralize two pre-existing confounds unrelated to this diff — filed as W0-ADJ-05/-06).
- `app promote testapp --to live --execute` → `status: "promoted"`; `apps.yaml` onboarding→live with
  no hand edit; promotion committed/pushed the app-owned `.operon/config.yaml` status flip.
- Broken state (`record.json` deleted on a live app): the documented recovery in
  `agent-skills/operon/SKILL.md`, followed literally, works.
- Scope check: **approve** — mechanism resolved, minimal, in scope, no tests weakened.

**Docs updated:** `docs/architecture.md` (token-free verification/promotion + greenfield path +
recovery), `agent-skills/operon/SKILL.md` (greenfield flow + recovery; "do not hand-edit apps.yaml").

**Adjacent items filed:** W0-ADJ-04, W0-ADJ-05, W0-ADJ-06, W0-ADJ-07, W0-ADJ-08 (see fix-backlog.md).

---

### L1-01 (L-002, P1) — `dispatch` silently skips non-live apps

**Branch:** `fix/l1-01-dispatch-skip-visibility` @ `3a05d63` (1 commit, off `f19fb6f`)

**Acceptance criteria (restated):** `operon dispatch` output **or** the `state/invocations/*.jsonl`
row names the app and the reason (e.g. `buildstacks-site: skipped, app not live`). Baseline: 7 real
events including a critical health-alert → `spawned=0 skipped=0 errors=0`, identical under
`--dry-run`.

**Diff:** 3 files, +84/−2. `src/org/dispatch.ts` (the former line-371 bare `continue` becomes a
braced guard pushing `"<app>: skipped, app not live (status: <actual>)"` into `result.skipped` —
still **before** the event-store poll, so non-live apps still never trigger GitHub polling);
additive regression test in `test/dispatch.test.ts`; one sentence in `docs/architecture.md`.
No CLI change needed — `src/cli/dispatch.ts` already prints every `result.skipped` line.

**Evidence reproduced first (baseline, temp trees):** app at `status: onboarding`, valid
`support-feedback` event in the inbox → `dispatch: spawned=0 skipped=0 errors=0` (dry-run and real),
event left unpolled, ledger row `outcome:"no-due-triggers"` with zero per-app detail.

**Verification (independent agent, behavioral per ISSUES.md Issue 2):**
- Gates: build/typecheck clean; `pnpm test` → `9 failed | 1583 passed (1592)`, exactly the nine.
- Compiled CLI in scratch trees: `dispatch --dry-run` and real tick both print
  `dispatch: spawned=0 skipped=2 errors=0` + `skip onboarding-app: skipped, app not live (status:
  onboarding)` + `skip paused-app: skipped, app not live (status: paused)`. Event stays unconsumed;
  no network reached (guard still precedes `eventStore.poll`).
- Scope check: **approve** — one-line mechanism fix, minimal, in scope.

**Docs updated:** `docs/architecture.md` §2 trigger resolution (non-live app = named skip, never a
silent no-op).

**Adjacent items filed:** W0-ADJ-01 (ledger-side skip visibility), W0-ADJ-09 (tooling note),
plus a backlog-text nit recorded in W0-ADJ-09.

---

### L1-02 (L-003, P1) — setup gate unreachable before the builder's baseline check

**Branch:** `fix/l1-02-setup-gate-provision` @ `949bcc8` (1 commit, off `f19fb6f`)

**Acceptance criteria (restated):**
1. With `setup_command` configured and no pre-vendored `node_modules`, the first ticket's implement
   pass does not fail a missing-dependency baseline.
2. Run evidence shows a setup gate PASS before the implement pass begins.
3. `runSetupGate` becomes reachable at worktree provision; the post-implement re-run stays.
4. A provision-time setup failure surfaces loudly, never a silent proceed.
(The buildstacks-site vendored-`node_modules` revert is deliberately NOT here — sonnet-org is the
read-only baseline; that revert is the paid E2E replication's acceptance test.)

**Diff:** 4 files, +414/−1. `src/loop/loop.ts`: new exported `advanceProvisionSetup` (peer
state-machine step; own `provision-setup` phase run emitting `gate.started/gate.passed|failed` +
envelope `gate_results`; on failure posts a blocked-with-evidence comment, swaps
`op:building`→`op:returned`, returns `phase="returned"`). `src/loop/driver.ts`: `runLoopOnce` calls
it once at provision (engine path), right after `admitTicketEpisode`, before the pass loop.
`qgates.ts` untouched — the post-implement re-run at `:435` is intact. New
`test/loop/setup-gate-provision.test.ts`; `docs/loop.md` updated.

**Evidence reproduced first:** the new regression run against unfixed `f19fb6f` code fails both
ways the finding predicts: (1) `markerAtImplement === false` — setup had not run when the implement
pass executed; (2) the failure-path test crashes via
`runLoopOnce → advanceGates → runBuilderPipeline` — an implement turn was spent before the setup
failure was even discovered.

**Verification (independent agent, behavioral per ISSUES.md Issue 3):**
- Gates: build/typecheck clean; `pnpm test` → `9 failed | 1584 passed (1593)`, exactly the nine.
- Anti-D-003 check: the regression drives `runLoopOnce` + real driver state machine + real git
  worktrees + a real subprocess setup command (fake runtime supplies only model text). Reverting
  only the src/docs files to `main` while keeping the test makes both tests fail for
  defect-specific reasons; restoring the fix makes them pass.
- Event-order proof (millisecond timestamps): `provision-setup gate.passed 07:37:42.434Z` →
  `build-contract run.started 07:37:42.484Z` → `build-implement run.started 07:37:42.567Z`;
  `markerAtImplement === true`; provision-setup envelope carries
  `gate_results: [{"gate":"setup","status":"passed",…}]`.
- Post-implement re-run confirmed still present and executing (gates run shows setup→tests→lint→…).
- Loud failure: `setup_command: exit 1` → `phase="returned"`, zero implement calls, label
  `op:returned`, full evidence comment ("Blocked with evidence — setup failed at worktree
  provision", verbatim command + output tail).
- Scope check: **approve**, with two non-blocking concerns filed (W0-ADJ-02 resume-path behavior;
  live-repo closure deferred to the E2E replication) and one noted acceptance nuance (setup evidence
  lives in its own run record, chronologically before the implement run's — satisfied across
  records, not within one file).

**Docs updated:** `docs/loop.md` §5 (setup row + "Where gates run" item 0: provision-time run,
rationale, loud-failure path). AGENTS.md needed no edit — its existing claim "a setup gate installs
app deps in the fresh worktree first" is now *true*.

**Adjacent items filed:** W0-ADJ-02, W0-ADJ-03, W0-ADJ-04 (shared with L0-01).

---

### Wave 0 status

| Item | Branch | Implement | Verify (independent) | Scope check |
| --- | --- | --- | --- | --- |
| L0-01 | `fix/l0-01-app-lifecycle-live` @ 793f384 | completed | **pass** | **approve** |
| L1-01 | `fix/l1-01-dispatch-skip-visibility` @ 3a05d63 | completed | **pass** | **approve** |
| L1-02 | `fix/l1-02-setup-gate-provision` @ 949bcc8 | completed | **pass** | **approve** |

All three branches are independent, based on `f19fb6f`, unmerged, unpushed. Test-failure set on
every branch: exactly the ROOT-001 nine. Full behavioral closure of L-001/L-002/L-003 against a
real provider campaign belongs to the Wave 0–2 exit-criterion E2E replication (requires human
budget approval).

**Merged to `main` 2026-07-17 on Bikram's instruction** (cherry-picked to keep history linear):
L1-01 → `aab6fa1`, L0-01 → `22cc4dd`, L1-02 → `4ffb9dc` (checkpoint). Combined-tree gate on
`4ffb9dc`: build clean, typecheck clean, `pnpm test` → `9 failed | 1589 passed (1598)` — exactly
the ROOT-001 nine; `pnpm smoke:onboarding` PASS; `npm pack --dry-run` 208 files (unchanged).
Not pushed. Original branches retained as the verified audit trail.

**Human decisions recorded 2026-07-17 (plain-language Q&A):**
- **P0-05/A-002 migration:** cancel in-flight grants immediately when the fix lands — old-format
  grants stop matching (identity version bump); agents re-raise approvals; the failure mode must be
  a fresh approval item, never a crash.
- **L-006 / L1-05 `dimension_globs`:** make the `package.json` security trigger smarter — escalate
  only when the diff touches dependencies / install-run scripts, not on any touch of the file
  (implements in Wave 2).

**Known residual risk for the E2E goal (W0-ADJ-04):** `loadGateCommands` (`src/loop/driver.ts:863`)
reads gate commands from the sole app entry (`soleApp ?? raw`), while `new-app`'s
`appendGateCommands` writes TOP-LEVEL keys — so a fresh greenfield app's `setup_command` may never
reach the loop even with L1-02 fixed. This is P1-12's territory (config schema), but it likely
gates the L-003 pass condition of the E2E run. Decision needed on whether to pull that slice of
P1-12 forward.

---

## Wave 1 — the approval boundary as one piece (2026-07-17)

Orchestration: three workflows (base cluster+P0-03+P0-05, then a scope-concern fix-up round, then
two targeted A-005-completion rounds P0-04b/P0-04c), each implement → independent verify →
adversarial scope check. Every finding reproduced before fixing; every adversarial probe landed as a
permanent offline test. **Merged to `main` 2026-07-17**, 16 commits, `f19fb6f`(=Wave 0 base `4ffb9dc`)
→ `f03ac95`. Combined-tree gate: build clean, typecheck clean, `pnpm test` → exactly the ROOT-001
nine (1621 passing), observe-browser 5/5, smoke PASS, pack 208 files.

**Human decisions honored:** P0-05 cancels in-flight grants immediately via an `identityVersion` bump
(old-format grants stop matching → clean re-raise, no crash); the `package.json` "smarter trigger"
decision is Wave 2, not touched here.

### P0-01 (A-001) — forgeable self-approval HMAC · `855cd76` + `6027264`
Signs `operon-self-approval:<pr>:<headRefOid>` and verifies against the PR head at merge time;
`isMarkedSelfApproval` now checks `review.author`; the `self-merge-or-approve` gate rule matches all
`gh pr review`/`gh pr merge` regardless of flag (so the marker-bearing `--comment` classifies
critical). Probe reproduced first (marker replayable, `--comment` routine); after: replay at a new
commit rejected, `--comment` critical. Verify **pass**, scope **approve** (one non-blocking TOCTOU
note, documented in code by the fix-up).

### L1-05 (campaign #8, classifier half) — approvals classified prose, not action · `7004743` + `a49a120`
`classify()` no longer escalates on security words appearing in message/body flag *values*
(`withoutMessageArgs`), collapsing the campaign's prose false positives; genuinely dangerous actions
(writes to secret files, protocol-surface edits, the A-001 marker) still classify critical. The 9/9
FP reduction mechanism: a reviewer's `--approve` falls through to `self-merge-or-approve`, which is
forbidden-by-role → flat-denied → leaves the human queue entirely. **One sub-claim did not
reproduce** and is recorded as such: `cat .operon/config.yaml` does *not* escalate on filename
mention (reads never hit `protocol-self-edit`); the real mechanism was security words in `--body`
values, which is fixed. Fix-up closed a self-introduced false negative (`git commit -m "$(cat .env)"`
was being stripped to routine) by keeping message values that contain executable constructs
(`$(`, backtick, `${`) in the classification text. Verify **pass**, scope **approve**.

### P0-04 / P0-04b / P0-04c (A-005) — scoped-grant path bound matched attacker free text · `9710df6`, `accf03c`, `249435d`, `da6ed42`
`pathContains` is evaluated via `grantScopeText` (normalized paths + command with shell comments
**and** message-flag values stripped) instead of raw input JSON — across **all three**
`findMatchingGrantSync` callers (`gate-compose.ts` + both `release.ts` sites, the latter found
mid-wave and fixed in P0-04b). P0-04c closed the residual message-value vector on the general
`composeGate` path where scoped grants are actually minted, keeping grant-scope stripping
(unconditional) deliberately divergent from L1-05 classification (keeps executable values) — pinned
by a test in both directions. **Known residual, deliberately deferred:** the bash command *string*
is itself agent free text (`cat ~/.aws/credentials || : .npmrc`, heredoc bodies), which is the
A-006/P1-02 structural inversion (classify by resolved target path, not text) — an M-effort tuning
item, out of scope for the A-005 hotfix; the `grantScopeText` docstring overclaim was corrected to
say so (`da6ed42`). Verify **pass** ×3, scope **approve** ×2 + one **concerns** resolved by the
docstring/deferral.

### P0-02 (A-004) — one bad ledger row disabled the budget cap and un-paused a paused app · `23694b6` + `7d78d74`
A non-finite/absent `costUsd` now yields a distinct `status: "unknown"` treated as over-cap (fail
closed); `enforceBudgetOverlay` never transitions paused→ok on an unverified total; the report
projection coerces `unknown`→exceeded for schema stability while `operon budget` shows the honest
UNKNOWN; the guard reason names `operon budget --reconcile`. Probe reproduced ($150/$100 + bad row →
`ok` + un-pause) then fixed. Verify **pass**, scope **approve**.

### P0-03 (A-003) + P2-01 (A-007) — snake_case credentials leaked past redaction and commit gate · `22c7332`, `4ebdbf6`, `64ca8ea`
`\b` replaced with a zero-width lookbehind so `GITHUB_TOKEN=`, `DB_PASSWORD=`,
`aws_secret_access_key = …` are redacted; seven missing credential families added (Stripe/Slack/
Google/npm/etc.); both consumers (log scrubber + commit gate) stay on the one list. Fix-up bounded
the identifier segment loops to kill an O(n²) ReDoS the new pattern introduced (80KB base64url line:
~1.7s → <50ms), pinned by a perf-ceiling test. Verify **pass**, scope **approve**.

### P0-05 (A-002) — content-blind approval grants · `062094b` + `9e087c1`
`actionHash` now binds a payload-content digest (denylist of non-semantic input fields) for
payload-bearing tools, mirroring `publisher.ts`'s `final_diff_hash`; `findMatchingGrantSync` dedupes
on the enriched identity (a different-content raise creates a new pending item); classification stays
payload-blind. Migration per the human decision: an `ACTION_IDENTITY_VERSION` bump both inside the
hash and as a match-time field invalidates all in-flight grants → clean re-raise, no crash. Probe
reproduced (byte-identical hashes for benign vs malicious `roles.yaml`) then fixed. Fix-up corrected
an inverted maintenance comment and added a behavioral pin (each denylisted key must change the hash).
Verify **pass**, scope **approve**.

### Merge-integration fix · `f03ac95`
Merging P0-05 (grant `identityVersion`) with P0-04b's release fixture surfaced a 10th/11th failure:
`seededHome` hand-wrote a grant without `identityVersion`, which P0-05 correctly rejects. Reconciled
the fixture to mint under `ACTION_IDENTITY_VERSION` — the A-005 assertions are unchanged and now
exercise a valid, matchable grant. Suite back to exactly the ROOT-001 nine. (Test-fixture
reconciliation, not a product change or a weakened test.)

### Wave 1 adjacent findings filed (not fixed)
- **W1-ADJ-01 (→ A-006/P1-02):** the bash command string is agent free text; `|| : .npmrc` and
  heredoc bodies still widen a scoped grant. The structural fix is resolved-target-path classification.
- **W1-ADJ-02 (→ A-006/P1-02):** L1-05 and P0-04 both key on command *text*; a secret/protocol
  keyword inside a quoted command argument (`echo '.npmrc' && cat ~/.aws/credentials`) still reaches
  the classifier/grant text. Same inversion.
- **W1-ADJ-03 (secret patterns, → follow-up):** camelCase compound identifiers (`githubToken=…`),
  value-side `\b` anchoring on token prefixes (`FOO_sk_live_…`), and plural `secrets:` still miss.
- **W1-ADJ-04:** `AUTHORITY.md`/`.operon/AUTHORITY.md` edits classify routine (protocol-self-edit
  gap), pre-existing and out of L1-05 scope.
- **W1-ADJ-05:** budget `unknown` surfaces as generic `exceeded` in the public report schema (honest
  only via `operon budget`); a distinct report status would be clearer.
- **W1-ADJ-06:** `normalizeSemanticAction.effect` is computed but consumed by no classification rule,
  yet is now part of the actionHash identity surface (harmless dead input).
- **W1-ADJ-07:** no mechanical drift guard between `SEMANTIC_INPUT_KEYS` (approvals) and gate.ts's
  consumed-key set beyond the new behavioral pin; a future gate.ts change could re-open a gap.

### Wave 1 status

| Item | Commits | Verify | Scope |
| --- | --- | --- | --- |
| P0-01 (A-001) | 855cd76, 6027264 | pass | approve |
| L1-05 (#8) | 7004743, a49a120 | pass | approve |
| P0-04/b/c (A-005) | 9710df6, accf03c, 249435d, da6ed42 | pass ×3 | approve |
| P0-02 (A-004) | 23694b6, 7d78d74 | pass | approve |
| P0-03 + A-007 | 22c7332, 4ebdbf6, 64ca8ea | pass | approve |
| P0-05 (A-002) | 062094b, 9e087c1 | pass | approve |

All merged to `main` (`f03ac95`), unpushed.

---

## Wave 2 — safety proportionality (2026-07-17)

Orchestration: one base workflow (L0-02 + L1-05 dimension_globs, one branch two commits) + two
fix-up rounds, each implement → independent verify → adversarial scope. **Merged to `main`
2026-07-17** by cherry-picking the 5-commit chain (`e1cddb6`…`7e2dec6`). The Wave 2 branch was
built on the pre-Wave-1 base `f19fb6f` (stale-worktree checkout), so the combined Wave 0+1+2 tree was
never tested together until merge — cherry-pick auto-merged the `loop.ts`/`driver.ts`/`docs/loop.md`
overlaps with no manual conflicts; combined-tree gate: build clean, typecheck clean, `pnpm test` →
exactly the ROOT-001 nine (no other failure).

**Human decision honored:** the `package.json` security trigger is now "smarter" (content-gated).

### L0-02 (L-004, P0 safety) — the sensitive-domain deep floor could not fire · `e1cddb6` + `5111c46` + `7e2dec6`
The floor is implemented and correct in `route-policy.ts`, but `driver.ts` derives `sensitiveDomains`
from ticket labels nothing attaches, so it was dead. Fix (orchestrator-owned, Theme 6):
`plan-tickets.ts` now derives per-ticket domain labels from the ticket's own prose at publication and
floors a sensitive ticket to `op:tier-deep` (label + tier applied together to satisfy the route
consistency check); the existing route-time floor then fires with no hand-applied label. Verified
end-to-end through the real `publishTickets → itemFromIssue → routeDecisionForItem` chain.
**Two fix-up rounds were required** because the keyword matcher swung twice: the base used substring
matching (`database`/`metadata`/`src/data/**` spuriously floored — the exact cost-inversion mirrored),
fixed to strict word boundaries; those then *missed* `authentication`/`authorization`/`OAuth`/plural
`secrets`/`payments` (a "never less safe" regression), fixed with curated per-domain
term-and-inflection patterns. Both directions are now pinned by a 26-row fire/no-fire acceptance
matrix test. Verify **pass** (all 26 rows), scope **approve**.

### L1-05 dimension_globs half (L-006, P2) — `package.json` over-triggered the security dimension · `1590da1` + `8df7b13`
Any touch of `package.json` escalated security→deep (tripled budget on a test-glob edit). Now
`matchedDimensions` is content-gated: security fires on `package.json` only when the diff touches
dependency/script keys (`dependencies`/`devDependencies`/`optional`/`peer`/`scripts`), path-blunt
default preserved for other callers; `pnpm-lock.yaml` stays path-gated. A fix-up closed a Theme-1
fail-open (a git-show *failure* now escalates rather than collapsing to "no change", distinguished
from a legitimately-absent ref). Verify **pass**, scope **approve**.

### Wave 2 adjacent findings filed (not fixed)
- **W2-ADJ-01 (Theme 6 / under-detection):** the floor keys on the six-keyword regex over ticket
  prose, so a ticket that stores PII but never names a domain word still won't escalate; deriving
  `sensitiveDomains` from the diff's storage/PII file paths at route time was left out for minimality.
- **W2-ADJ-02:** `data-driven`/`data-first` still fire `data` (generic over-escalation, safe
  direction, unpinned by the matrix).
- **W2-ADJ-03:** prefix-compounds miss — `reauthorize`, `unauthorized`, `insecure`, `prepayment`,
  `repayment` don't fire the floor (mitigated by L1-05's file-path dimension giving auth/crypto
  surfaces high-tier gates at diff time).
- **W2-ADJ-04:** `token`/`credentials`/`password`/`PII`/`SSN` are outside the six-domain keyword set;
  notably the `domain:secret` label description says "secret/credential handling" but the regex
  matches neither `credential` nor `token` — a description/behavior mismatch worth aligning.
- **W2-ADJ-05:** `driver.ts` label reader `/auth|…|data/.test(label)` is substring over the label; a
  stray issue label like `metadata-migration` would spuriously populate `sensitiveDomains` (pre-existing).
- **W2-ADJ-06 (bootstrap exemption):** `validatePlan` forbids `bootstrap`-tier deep, so a greenfield
  scaffold that genuinely stores user data gets no floor — documented design decision, revisit later.

### Wave 2 status

| Item | Commits | Verify | Scope |
| --- | --- | --- | --- |
| L0-02 (deep floor) | e1cddb6, 5111c46, 7e2dec6 | pass (26/26 matrix) | approve |
| L1-05 dimension_globs | 1590da1, 8df7b13 | pass | approve |

Merged to `main`, unpushed. Combined tree green-to-baseline (ROOT-001 nine only).

---

## Wave 3 — the fail-open / cannot-determine sweep (2026-07-17)

Orchestration: one workflow, three independent branches (disjoint files), each implement → independent
verify → adversarial scope. All three: **verify pass, scope approve, no fix-up needed.** **Merged to
`main`** by cherry-picking six commits (`52e72b0`…`59c64c8`). Combined Wave 0–3 tree: build clean,
typecheck clean, `pnpm test` → exactly the ROOT-001 nine.

**Scoping decision:** P1-06's `harness.ts:98` sentinel half was deferred to Wave 5 (with P0-07/P1-09) —
it lives in Phase-6-hashed `test/transformation/**` and is the exact code producing the 9-failure
baseline; bundling that churn into the re-attestation wave avoids double re-attesting and baseline
destabilization. Wave 3 took only the real-money spend-guard half.

### P1-06 (C-001, Theme 1) — the eval spend guard admitted a third real-money campaign on a corrupt file · `52e72b0`
`priorFailedQualifications`/`priorStartedQualifications` in `development-authorization.ts` ended in
`catch { return false }`, folding "could not read this artifact" into "no prior failure/start" — a
torn `qualification*.json` in `.eval-artifacts/` silently admitted an extra full campaign. Now they
return `{matched, undeterminable}`: genuine ENOENT absence stays "none", a parse/read error on an
existing artifact becomes undeterminable → the guard **refuses** (`prior_qualification_undeterminable`).
The legitimately fail-closed sibling sites (`admissionResultsPassed`/`githubAdmissionPassed`) are kept
and annotated so the opposite safety directions are visible. Regression tests confirmed red against the
pre-fix `catch { return false }`. Verify **pass**, scope **approve**.

### P1-07 (D-001, Theme 1) — the Claude conformance suite exited 0 with zero assertions · `a3b3cb0` + `0118b36`
Claude — the primary provider running 5 of 8 roles incl. reviewer — had *no* offline conformance, and
its only (live) suite failed open: `probeAuth()` caught everything → skip → exit 0. Now a skipped live
suite exits **non-zero** unless `OPERON_ALLOW_SKIP_LIVE=1` is explicit, and a new **mocked Claude
conformance** (`test/adapters/claude.test.ts`) runs in `pnpm test`, pinning the contract without auth
(mirroring pi-mocked/codex). Verified token-free (probeAuth checks auth availability, spends nothing).
Verify **pass**, scope **approve**.

### L1-06 — three live papercuts · `faf4644` + `2b84aae` + `59c64c8`
- **L-008:** `plan --auto … --explain-route` no longer silently no-ops — the incompatible combo now
  errors loudly before any side effect (AGENTS.md command listing corrected to match).
- **L-009:** denial lessons are fixed at the **writer** (`src/org/denial-lessons.ts`) — it now
  serializes through the loader's own `validateFrontmatter`, so the doc can no longer be rejected by
  `memory.ts` (loader/validator unchanged — not weakened). A writer→loader round-trip test was added;
  its absence is why this shipped.
- **L-010:** `ensureClone` resolves the remote's advertised default branch (`ls-remote --symref` /
  `symbolic-ref`, as `app-lifecycle.ts` does) instead of hardcoding `git fetch origin main`, handling
  both `master` and `main`, or failing with a clear error.
Verify **pass**, scope **approve**.

### Wave 3 adjacent findings filed (not fixed)
- **W3-ADJ-01 (more hardcoded `main`, Theme 6):** `loop.ts:1464` `ensurePr` PR base, `loop.ts:1795`
  `durableWorkSummary` `origin/main`, `github.ts:699` `baseRefName` fallback — same family as L-010,
  out of its minimal scope (PR base can't be naively threaded — `baseRef` is a SHA for supplied checkouts).
- **W3-ADJ-02 (P1-07):** `probeAuth()` has no timeout and runs at top-level await, so a hung auth call
  stalls the entire live-suite collection (bounded only by the 180s hook timeout).
- **W3-ADJ-03 (P1-06):** `lineageEquivalentCost:216` `catch { continue }` skips a corrupt `campaign.yaml`
  during cost accounting and could undercount descendant spend — a separate Theme-1 site.
- **W3-ADJ-04 (P1-06):** the new `prior_qualification_undeterminable` error code is undocumented; a
  corrupt manifest of an *unrelated* grant also forces refusal (safe direction, operator-recoverable).

### Wave 3 status

| Item | Commits | Verify | Scope |
| --- | --- | --- | --- |
| P1-06 (spend-guard half) | 52e72b0 | pass | approve |
| P1-07 (Claude conformance) | a3b3cb0, 0118b36 | pass | approve |
| L1-06 (L-008/L-009/L-010) | faf4644, 2b84aae, 59c64c8 | pass | approve |

Merged to `main`, unpushed. Combined tree green-to-baseline. **Deferred to Wave 5:** P1-06 harness half.

---

## Wave 4 — durability & concurrency (2026-07-17)

The highest-risk wave (git-clone lock, turn lock, provider-settlement hot path). Orchestration: one
base workflow (three isolated branches) — **two agents hit transient `529 Overloaded`** (lock-trio
scope, settlement-rearm impl), recovered via a targeted verify+scope workflow (the settlement branch's
commits were intact; only the result capture was lost) — plus one blocking fix-up round. Every race
finding was required to ship a **genuine concurrency test** (Promise.all + fake clock, modeled on
`test/settlement/property.test.ts`); verifiers confirmed each new test is red on unpatched main.
**Merged to `main`** by cherry-picking the three branches (`267a6de`…`c2f665a`); all three
`telemetry.ts`/`AGENTS.md`/`docs/loop.md` overlaps auto-merged. Combined Wave 0–4 gate: build clean,
typecheck clean, `pnpm test` → exactly the ROOT-001 nine.

### Lock trio — P0-06 (F-001) + P1-18 (F-007) + P2-20 (F-008) · `267a6de` + `5fef444` + `96b4fa2`
- **P0-06 (F-001, the review's only durable-corruption finding):** `withAppGitLock` no longer
  force-breaks a live holder (max-wait raised above the staleness window and gated on the liveness
  check actually failing; a live PID is never broken → typed `AppGitLockBusyError`, caller retries)
  and no longer releases by path (a pid+nonce ownership token is verified before unlink). Both bugs
  reproduced red first (a successor's lock was deleted; a live lock was force-broken).
- **P1-18 (F-007):** `acquireLock` loops on the `O_EXCL` create; a concurrent-release ENOENT is now
  ordinary contention (tolerant read → retry), never an unhandled throw that aborts the dispatch tick.
  A 32-worker Promise.all race test was confirmed red against main's check-then-act.
- **P2-20 (F-008), partially delivered:** the git-clone lock is re-expressed onto a new shared
  `src/runtime/file-lock.ts` primitive (atomic O_EXCL, pid+nonce+timestamp, never-break-live,
  token-verified release). The **turn lock** and **settlement lock** were *not* re-expressed — see
  W4-ADJ-01.
Verify **pass** (genuine concurrency), scope **approve** (with the P2-20 residual noted).

### Retention — P1-14 (F-003) · `c2f665a`
Each of the six unbounded state subtrees (`telemetry/`, `efficiency/episodes/`, `invocations/`,
`tasks/`, `learning/`, `scheduler/evidence/`) now has a retention policy, swept daily from the dispatch
tick (not just the manual CLI). Hard guards: the ledger pruner never deletes within the reconciliation
window; committed `learning/**` governance state is never pruned; scheduler-evidence keeps enough for
status/doctor health. Verify **pass**, scope **approve**.

### Settlement + re-arm — L1-03 (L-005) + P1-13 (F-002) + L1-04 (L-007) · `393a299` + `fe5093d` + `b85fce1` + `d711726`
- **L1-03 (L-005):** a budget/route-cap abort now terminalizes cleanly (`op:returned` + evidence
  comment, PR left open, loop exits 0) instead of `throw "pipeline aborted"`. `isCapDrivenStop` gates
  only `cap_stop`/`provider_timeout`; a genuine `crash`/`cancelled` still throws loudly — the two are
  distinguished, not all-swallowed.
- **P1-13 (F-002):** the settlement call site is `try`-wrapped so a settlement failure emits a durable
  `telemetry.settle_failed` event (with `provider_turn_ids` for `--reconcile`) instead of discarding a
  paid-for turn — the live `terminal_unsettled_usage_passes: 1` bug. The load-bearing
  durable-before-throw ordering is intact (execution step finalized before settlement; ledger row
  written before the settled-key index). A keys-only sidecar index replaces the full-history
  multi-file JSON rescan. **F-SET-01 exactly-once race test is green and strengthened** (added a
  sidecar-consistency assertion + three F-SET-04 concurrent-distinct stress tests), never weakened.
  A blocking fix-up (`d711726`) relocated the sidecar out of `telemetry/` (it had broken three
  bare-`readdir` ledger enumerations, +5 failures) to `telemetry-index/` — production readers already
  filter `.jsonl`, so no production path was affected.
- **L1-04 (L-007):** dependency re-arm is now orchestrator-owned — `rearmDependents` runs
  deterministically from the merge transition (`driver.ts`, `item.phase === "merged"`), promoting a
  dependent to `op:ready` only when every predecessor is merged; no over-promotion, idempotent.
Verify **pass** (after the sidecar fix-up), scope **approve** (non-blocking concerns filed).

### Wave 4 adjacent findings filed (not fixed)
- **W4-ADJ-01 (P2-20 residual):** the **turn lock** (`src/org/locks.ts` `releaseLock`) still releases
  by bare `rm` with no token and no liveness probe — the same release-by-path class as F-001, still
  live on the turn lock (a hung-but-alive holder past the 120s heartbeat can be reclaimed by a
  successor, then the original's release deletes the successor's lock). Re-expressing it onto the new
  `FileLock` changes five call-site contracts (`dispatch.ts:258/555/688`, `app-reset.ts`,
  `recovery.ts`) — a P2 follow-up now that the shared primitive exists. The settlement lock is likewise
  un-unified (three lock styles mid-migration).
- **W4-ADJ-02 (lock minor):** after 8 vanished-lock retries `acquireLock` returns a synthetic stale
  holder (could route a live-but-churning lock into stale-recovery — extreme window); `reclaimIfStale`'s
  torn-write age fallback uses real `Date.now()` not the injected clock.
- **W4-ADJ-03 (P1-13 perf):** the sidecar index is a large constant-factor win (keys-only, no
  JSON.parse — stays under the 5s lock budget at 365k rows) but still reads the full index per
  settlement, so it is **not asymptotically O(1)**; the F-002 O(N²) tail is reduced, not eliminated.
- **W4-ADJ-04 (P1-13 durability):** neither the ledger append nor the index append is fsync'd and they
  are two files, so under power loss the index could flush before the ledger → index-leads-ledger →
  false-positive skip → a lost settlement. Pre-existing best-effort posture; not worsened.
- **W4-ADJ-05 (L1-04 edge):** `rearmDependents` treats a dependency as satisfied when it is "no longer
  open", which includes an issue **closed without merging** — could arm a dependent whose prerequisite
  never shipped. Deliberate, low-risk (PR merge closes via `Closes #N`); `selectReadyTickets` uses the
  stricter `phase === "merged"`.
- **W4-ADJ-06 (retention/sidecar merge interaction):** the retention pruner clears `telemetry/`
  day-files but not the sibling `telemetry-index/settled.keys`, so keys for pruned days persist —
  harmless (rebuildable, ledger-first, per-turn-unique), but a full O(N) reset or a periodic rebuild
  would keep it bounded.
- **W4-ADJ-07 (retention perf):** the daily sweep does a full-ledger `readSettledKeys` + full-efficiency
  scan once per winning UTC-day tick (the F-002 cost, synchronous before dispatch); a crashed sweep
  after the O_EXCL marker but before the completion record skips that day (fail-safe: keeps more).

### Wave 4 status

| Item | Commits | Verify | Scope |
| --- | --- | --- | --- |
| Lock trio (P0-06/P1-18/P2-20) | 267a6de, 5fef444, 96b4fa2 | pass | approve (P2-20 partial) |
| Retention (P1-14) | c2f665a | pass | approve |
| Settlement+re-arm (L1-03/P1-13/L1-04) | 393a299, fe5093d, b85fce1, d711726 | pass | approve |

Merged to `main`, unpushed.
