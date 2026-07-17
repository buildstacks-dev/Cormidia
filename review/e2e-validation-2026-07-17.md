# Live E2E validation of the Waves 0–4 remediation — 2026-07-17

Ran against a **fresh** org + app (not the read-only baseline `sonnet-org`), real providers, on the
merged remediation (`main` @ `8882818`, PR #81). Env: `OPERON_ORG_HOME`/`OPERON_STATE_HOME` under
`/Users/bikram/Build/operon-remediation-e2e`; app repo `bikramgupta/bs-remediation-e2e`.
**Total real spend: ~$0.78** (equivalent-cost estimate) of the $150 session cap.

## Structural findings validated live (the ones REPLICATION.md says reproduce reliably)

| Finding | Baseline behavior | Post-remediation (observed) | Verdict |
| --- | --- | --- | --- |
| **L-001** (app never reaches `live`; `verify` → raw `ENOENT`) | unhandled `ENOENT`, exit 1, no recovery | `app verify --json` returns a **typed** `blocked` result (check `lifecycle-record`, remediation text), exit 0; `new-app` writes `onboarding-source.json`; after push `verify` **synthesizes the lifecycle record** and 12/14 checks pass | **FIXED** |
| **L-002** (`dispatch` silently skips non-live apps) | `spawned=0 skipped=0 errors=0`, no per-app detail | `spawned=0 skipped=1 errors=0` + `skip bs-e2e: skipped, app not live (status: onboarding)` | **FIXED** |
| **L-004** (sensitive-domain deep floor can't fire) | user-data goal → 5 tickets, **0** domain labels, storage ticket `standard` | 5 tickets, **all** carry domain labels + `op:tier-deep`; the storage/PII ticket (#3, POST `/api/contact`) carries `domain:secret`+`domain:data`; the planner names it "the app's first untrusted write surface and PII sink" — **no hand-applied label** | **FIXED** |
| **L-008** (`plan --auto --explain-route` silent no-op) | exit 0, $0, 0 tickets, no warning | loud rejection: "`--explain-route` … cannot be combined with `--auto` … drop one" | **FIXED** |

L-004 detail (published to `bikramgupta/bs-remediation-e2e`): #1 `domain:data`/deep, #2 `domain:data`/deep,
#3 `domain:secret`+`domain:data`/deep, #4 `domain:data`/deep, #5 `domain:privacy`+`domain:data`/deep.
Dependency chain published: #1/#2 `op:ready`, #3–5 gated (the L-007 fixture).

## New findings surfaced by the E2E (filed, NOT fixed this session)

- **E2E-01 (confirms W0-ADJ-05, live):** even with L-001 fixed, a real npm app cannot reach
  `ready`/`live` — `app verify`'s `app-check-tests` runs in the managed clone with **no dependency
  install**, so `npm test` (`tsc`) fails. `verify` → `status: invalid`. The setup-gate ordering fix
  (L1-02) covers the build loop's worktree; it does **not** cover `verify`'s app-check gates. Promotion
  to `live` for a real npm app is still blocked. **This blocks the full L-001 acceptance** (`promote
  --to live` reaching `live`).
- **E2E-02:** discrepancy — `app verify`'s `runtime-codex` check reports **fail** while `operon doctor`
  reports codex **OK — ready** (`account=chatgpt plan=pro`, non-billable probe). The two readiness
  checks disagree; reconcile (verify may probe in the managed-clone context, or hit the known
  codex-auth fragility). Claude is ready in both.
- **E2E-03 (mild over-escalation, safe direction):** all 5 tickets got `op:tier-deep`, including #1
  "generalize test/lint gates" which is not itself a data surface but inherited `domain:data` + deep
  from the milestone's prose. Defensible (whole milestone is data-centric) and the safe direction, but
  the same W2-ADJ-02 family (generic keyword bleed). Worth confirming the floor isn't flooring the
  entire milestone on context alone.

## Deferred to a human-driven session (needs judgment at the approval queue + bug-planting)

These require the full loop (builder on codex, real merges) and per-ticket approval decisions —
inappropriate to auto-run (auto-approving critical ops defeats the hardened boundary):

- **L-003** (setup gate before builder baseline) — offline-validated by
  `test/loop/setup-gate-provision.test.ts` driving the real pass machinery; live validation needs a
  greenfield build tick (may hit W0-ADJ-04: `loadGateCommands` reads the sole-app entry while
  `new-app` writes top-level keys).
- **L-007** (dependency re-arm on merge) — fixture is live (#1/#2 ready, #3–5 gated); needs #1/#2 to
  actually merge via the loop, then confirm #3+ auto-promote to `op:ready`.
- **L-005 / ledger** (`terminal_unsettled_usage_passes: 0`) — needs a full run that hits a route-budget cap.
- **Wave 1 approval false-positive rate** — needs the campaign's approval queue populated by real
  review actions.

## Ready-to-run handoff for the paid ladder

Env is standing on disk (org + app + 5 published tickets, #1/#2 `op:ready`). To continue as a human
operator (`REPLICATION.md` Step 4+), from `/Users/bikram/Build/Operon`:

```bash
source /Users/bikram/Build/operon-remediation-e2e/e2e-env.sh   # sets OPERON_ORG_HOME/STATE_HOME
source /Users/bikram/Build/Operon/.env.local                   # OPERON_SELF_APPROVAL_SECRET
operon loop --app bs-e2e --once --allow-network                # run the first ready ticket
operon approvals list && operon approvals show <id>            # JUDGE each — do not blind-approve
```

App budget capped at `$50/month` in the E2E org's `apps.yaml` (raise toward the $150 session cap as
needed). The active-org pointer (`~/.operon/config`) was backed up to
`~/.operon/config.backup-remediation-e2e` and restored after this run.
