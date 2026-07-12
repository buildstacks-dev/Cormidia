# Operon Live UI implementation and acceptance evidence — 2026-07-12

## Scope and environment

- Host execution (`/.dockerenv` absent); repository `/Users/bikram/Build/Operon`.
- Installed CLI `/Users/bikram/.local/bin/operon`, source-linked to this checkout.
- Org `Bikram-Org`; org home `/Users/bikram/Build/Bikram-Org`; state home `/Users/bikram/.operon/Bikram-Org`.
- App `buildstacks.dev`, checkout `/Users/bikram/Build/buildstacks.dev`, repository `buildstacks-dev/buildstacks.dev`, lifecycle left `onboarding`.
- Original operator prompt SHA-256: `07104971c270a7ade0451c488d3ec259339ab86b1c2e30369b3d3457b17b5b4f`.
- Correlated parent task: `live-ui-buildstacks-20260712`.
- No deployment, DNS, cloud, infrastructure, app reset, approval decision, or app-status promotion was executed.

## Offline disposable sandbox proof

State was isolated under `/tmp/operon-live-ui-sandbox-proof-20260712`; the app repository was read-only input.

- Initial snapshot and browser render succeeded.
- A new run became live from durable envelope/events only; no CLI output was piped into the UI.
- Ten watcher-latency samples were `893, 94, 101, 103, 99, 102, 97, 107, 130, 100 ms`; p95/max was 893 ms.
- A heartbeat older than 180 seconds rendered `stalled`.
- An injected failed review envelope rendered as a failure with terminal evidence.
- Browser refresh and observer stop/restart reconstructed the same state without affecting the run.
- The pass drawer exposed prompt/output deliberately and labeled `session.log` “Activity log—not transcript.”

Screenshots: `screenshots/sandbox-{initial,live,stale,failure,restarted}.png`.

## buildstacks.dev live flow

### Planning and queue

Observer startup preceded planning. Planning command:

```sh
OPERON_PARENT_TASK_ID=live-ui-buildstacks-20260712 \
  operon plan buildstacks.dev --auto \
  --goal 'Establish a bounded implementation slice from the approved buildstacks design' \
  --stage bootstrap --depth standard --risk low --ambiguity low \
  --coupling medium --reversibility reversible --external-consequence none \
  --expected-tickets 1-2 --workdir /Users/bikram/Build/buildstacks.dev
```

Trace `plan-buildstacks.dev-1783849049033` published:

- #30 `op:ready`: clean-checkout pipeline proof.
- #31 dependency-blocked on #30: 360 px prototype/quality-floor verification.

The observer was refreshed and restarted during an active Planner pass. Planning continued, and the restarted process reconstructed the live and completed passes.

### Returned work and replanning

Ticket #30 used three bounded claims:

1. Offline Codex sandbox: npm registry `ENOTFOUND`; returned.
2. Same result after host cache recovery; returned.
3. Normal `operon loop --allow-network`: install/check passed, then `format:check` scanned the sandbox-created `.pnpm-store/`; returned at the claim cap.

Ticket #30 remains open with `op:returned`; it was never represented as complete.

The normal Planner publication path then ran with trace `plan-buildstacks.dev-1783850371002` and published dependency-free #32: add `.pnpm-store/` to `.prettierignore` and `.gitignore`, prove the full pipeline with the local store present, merge-only.

### Builder, gates, review, and terminal outcome

- Initial quick-tier #32 claim committed `5c6b8b5a408cc4a60a2508cb36ba338183d5137e`; its completeness gate correctly failed because quick routing had no contract criterion map. A redundant fix pass was cancelled, durable work preserved, and the ticket was reclassified to standard rather than weakening the gate.
- Standard re-claim ran contract and implement, then all quality gates. PR #33 opened.
- First complete review approved, but the bare same-account fallback was intentionally untrusted because no merge HMAC secret was present. A redundant review was cancelled.
- The explicitly authorized merge-only re-claim used a fresh, non-persisted per-process `OPERON_SELF_APPROVAL_SECRET`; no secret value was printed or stored.
- Independent review found two actionable issues: PR base `main` made the apparent two-file change a 53-file diff, and the PR body lacked pasted acceptance evidence.
- Builder pushed the existing integration branch `build/buildstacks-v1`, retargeted PR #33 to it, pasted the pre-fix and ordered green evidence, and left the code head unchanged.
- Fresh verify + security-deep review approved exact head `5c6b8b5` with zero findings. GitHub `validate` was green.
- Operon squash-merged PR #33 into `build/buildstacks-v1` at `263b79dc88b68edebb5a51f468c428e9c85b4291` on `2026-07-12T10:49:16Z`.
- Because the PR base is non-default, GitHub did not apply `Closes #32`. Operon had already removed the workflow label and checked all acceptance boxes, then cleanup targeted a newer snapshot clone and failed. Manual fallback closed only the already-merged #32 and pruned the stale worktree registration from its owning snapshot.
- Parent task finished `completed`, `execution_mode: mixed`, implementation complete, CI green, Operon review approved, PR merged. Completion integrity intentionally remains false for pure Operon end-to-end because the manual finalization and interrupted gate/review envelopes are durable.
- #31 remains open and dependency-blocked. Eight `production-deploy` / `secrets-or-auth` approvals remain pending and untouched.
- Final budget: `$51.60 / $1000.00`; telemetry records 28 passes, including 8 Planner, 9 Builder, 7 Reviewer, and 4 Orchestrator gate records.

GitHub evidence:

- Issue #30: <https://github.com/buildstacks-dev/buildstacks.dev/issues/30>
- Issue #31: <https://github.com/buildstacks-dev/buildstacks.dev/issues/31>
- Issue #32: <https://github.com/buildstacks-dev/buildstacks.dev/issues/32>
- PR #33: <https://github.com/buildstacks-dev/buildstacks.dev/pull/33>

### Final reconciliation

Commands:

```sh
operon telemetry --app buildstacks.dev --date 2026-07-12 --json
operon telemetry --app buildstacks.dev --date 2026-07-12 --html research/2026-07-12_live-ui/buildstacks-telemetry.html
operon status
operon analyze --app buildstacks.dev
operon budget
operon approvals
gh issue view 30 --repo buildstacks-dev/buildstacks.dev --json number,state,labels,url
gh issue view 31 --repo buildstacks-dev/buildstacks.dev --json number,state,labels,url
gh issue view 32 --repo buildstacks-dev/buildstacks.dev --json number,state,labels,url
gh pr view 33 --repo buildstacks-dev/buildstacks.dev --json state,mergedAt,mergeCommit,baseRefName,headRefOid,statusCheckRollup,reviews,url
```

The final observer snapshot agrees on #30 returned, #31 backlog/dependency-blocked, #32 merged, PR #33 head/merge/check state, 8 pending approvals, `$51.599868` recorded cost, and parent-task mixed fallback. The observer deliberately reports signed same-account GitHub review integrity as `unknown`: it does not possess the ephemeral HMAC secret and therefore does not convert an unverifiable comment marker into approval. Local Reviewer run evidence remains explicit and complete.

`operon analyze` reports the expected incomplete artifacts: stale running gate envelope `20260712-100738-gates-quality-gates`, cancelled fix/review runs, long review passes, and shell-heavy remediation. These are preserved rather than rewritten.

Artifacts:

- `buildstacks-final-snapshot.json` — strict V1 final snapshot.
- `buildstacks-telemetry.html` and `buildstacks-telemetry.evidence/` — portable report plus exact local evidence.
- `buildstacks-final-converged.png` — final merged/returned/backlog browser view.
- `buildstacks-finalization-integrity.png` — merged-PR/open-issue integrity warning before manual finalization.
- Other PNGs capture planning, restart, Builder, gates/fix, Reviewer, and terminal states.

Selected SHA-256 hashes:

- `buildstacks-final-snapshot.json`: `3e437db5483f50f34ba774425bfbddc2f1b2e8946ef0a94891d016644cd5534e`
- `buildstacks-telemetry.html`: `fb261d5377cc0bf7ce77070d1670cd641dfd247a2e08a22b1d92957e1c3e83f3`
- `buildstacks-final-converged.png`: `864f1ddbda2eb6ca7decda6df393a26d736c0b11ec8d65654b2b02df8b0a68d0`
- `screenshots/sandbox-stale.png`: `747542b1a014da09d758849657b41bd0cfe5e6bc0e780aff44288a52c1bb61c1`

## Known discrepancies retained as evidence

1. GitHub polling cold start is bounded but sequential per historical PR for reviews/checks; the live repo took about 24–27 seconds for an initial 50-PR projection.
2. A cancelled remediation left a gate wrapper with `status: running` and no terminal timestamp; telemetry/analyze and the UI expose it as incomplete rather than repairing history.
3. Exact-head signed same-account review is not asserted by an observer that lacks the HMAC secret; the PR card says review `unknown`, while local structured review passes and the parent task record approval separately.
4. PR merge into a non-default integration branch required manual issue close because GitHub closing keywords apply on the default branch. This is recorded as mixed execution, not a pure Operon completion.
5. The app remains `onboarding`; no release/deployment action occurred.

## Final offline and packaging verification

Executed from `/Users/bikram/Build/Operon` after the final live-correlation fix:

| Command | Result |
| --- | --- |
| `pnpm test` | PASS — 113 files, 1,071 tests, 12.59 s |
| `pnpm typecheck` | PASS — `tsc --noEmit` |
| `pnpm build` | PASS — `tsc` plus executable `dist/cli.js` |
| `pnpm test:observe-browser` | PASS — 2 Playwright tests in 8.2 s (keyboard/artifacts/SSE plus reduced-motion/360 px) |
| `pnpm smoke:onboarding` | PASS from neutral temporary cwd; includes installed observer health/security/start/stop proof |
| `npm pack --dry-run` | PASS — 170 files, 418.1 kB packed, 1.5 MB unpacked, shasum `dcf5ba8350c680307ecdb6792a0403743e5c9f36` |
