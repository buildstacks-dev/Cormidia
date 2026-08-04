# Planner publication qualification plan (#230 / #232)

Status: **prepared, not executed**. No command in this document is authorized
by its presence here. The live runner still requires a separate human-initiated,
absolute reviewed config, and the live-org walk requires approval of the exact
disposable repo, org, commit, time window, and cleanup action.

## Candidate and hard bounds

Replace the bracketed values only after this change has merged, then review the
completed files byte-for-byte:

- candidate: the exact 40-character squash-merge commit on `origin/main`;
- target: one newly created private disposable repository, never
  `cormidia/Cormidia` and never an operated product repository;
- state: one fresh temporary org home and state home containing only that app;
- external writes: at most two fixture issues, the labels needed by onboarding,
  one Planner branch, and artifacts created by the existing CF-B01-L3 surface;
- provider allowance: one Planner turn, one retry reservation, at most two turns
  and USD 5 total. A second scheduler reconciliation must use zero turns;
- no merge, release, deployment, scheduler installation, eval, soak, public
  repository, or non-sandbox app;
- stop immediately on target/commit/policy drift, an unexpected approval, a
  second Planner provider run for the same due-window identity, spend above the
  bound, cleanup ambiguity, or any write outside the disposable target.

## Phase A — existing real-GitHub boundary

Create `/absolute/reviewed/planner-github-smoke.json` with this exact closed
shape after substituting the reviewed values:

```json
{
  "schema_version": 1,
  "campaign_id": "planner-publication-github-<MERGED_COMMIT_12>",
  "campaign_kind": "github_smoke",
  "human_authorization": {
    "human_initiated": true,
    "authorized_by": "<HUMAN_IDENTITY>",
    "authorized_at": "<ISO_INSTANT>",
    "purpose": "CF-B01-L3 boundary evidence for #230/#232 on one disposable private repo"
  },
  "state_home": "<ABSOLUTE_FRESH_STATE_HOME>",
  "policy_path": "<ABSOLUTE_CANDIDATE>/validation-design/validation-policy.yaml",
  "commit": "<MERGED_40_HEX>",
  "sandbox": {
    "org": "planner-publication-qualification",
    "app": "planner-publication-fixture",
    "repo": "<EXACT_OWNER/DISPOSABLE_REPO>"
  },
  "adapters": [],
  "github": { "enabled": true, "repo": "<EXACT_OWNER/DISPOSABLE_REPO>" },
  "launchd": { "enabled": false, "label": "not-selected" },
  "unattended": { "enabled": false, "permitted_auto_grant_categories": ["campaign_budget"] }
}
```

From the clean candidate checkout, run exactly:

```bash
CORMIDIA_LIVE=1 \
CORMIDIA_LIVE_CONFIG=/absolute/reviewed/planner-github-smoke.json \
pnpm test:live
```

Required evidence is the durable L3 campaign report with `CF-B01-L3`, zero
provider turns, zero equivalent spend, all GitHub clauses passing, and verified
cleanup. This proves the changing real GitHub boundary, not the end-to-end
Planner scheduler lifecycle.

## Phase B — one live sandbox-org Planner lifecycle

This phase is a separately authorized operated-sandbox walk. Before it starts,
record the candidate commit, complete org/app configuration, provider tuple,
fresh state-home path, exact due-window identity, operator-checkout tree hash,
and the two issue payloads below in the campaign evidence. Do not reuse a real
org. Use one routine issue with complete `Goal`, `Context`, `Acceptance
criteria`, `Scope`, `Out of scope`, `Depends-on: none`, and `Execution group:
planner-publication-qual`; use one `op:tier-deep` issue with the same structural
fields. Neither starts with `op:ready`, `manual-review`, or
`routing:human-only`.

1. Run one due Planner dispatch against the fresh sandbox state. Reserve at
   most two turns/USD 5, but admit only the one configured Planner turn unless
   the runner records a retry within the same campaign identity.
2. Capture the provider run ID and the resulting
   `planning/publications/<app-hash>/<publication-id>.json` before any second
   reconciliation.
3. Run one more dispatch in the same due window. It must reconcile or observe
   the same publication identity with zero additional provider turns.
4. Run `cormidia publication list --app planner-publication-fixture --json`,
   `cormidia status --app planner-publication-fixture --json`, and
   `cormidia narrative --app planner-publication-fixture --json`.
5. Read back the exact remote branch ref and both issue labels through GitHub.
   Do not merge the branch.

The two dispatches and read-only projections use these exact command shapes
from the candidate checkout (the reviewed fresh paths replace the brackets):

```bash
CORMIDIA_STATE_HOME=<ABSOLUTE_FRESH_STATE_HOME> pnpm dev dispatch \
  --apps <ABSOLUTE_FRESH_ORG_HOME>/apps.yaml \
  --roles <ABSOLUTE_FRESH_ORG_HOME>/roles.yaml
CORMIDIA_STATE_HOME=<ABSOLUTE_FRESH_STATE_HOME> pnpm dev dispatch \
  --apps <ABSOLUTE_FRESH_ORG_HOME>/apps.yaml \
  --roles <ABSOLUTE_FRESH_ORG_HOME>/roles.yaml
pnpm dev publication list --app planner-publication-fixture \
  --org-home <ABSOLUTE_FRESH_ORG_HOME> --state-home <ABSOLUTE_FRESH_STATE_HOME> --json
pnpm dev status --app planner-publication-fixture \
  --org-home <ABSOLUTE_FRESH_ORG_HOME> --state-home <ABSOLUTE_FRESH_STATE_HOME> --json
pnpm dev narrative --app planner-publication-fixture \
  --org-home <ABSOLUTE_FRESH_ORG_HOME> --state-home <ABSOLUTE_FRESH_STATE_HOME> --json
```

The phase passes only when all of these facts agree:

- exactly one Planner provider output hash and run-ID set is bound to exactly
  one publication transaction;
- the transaction is `published`; its remote branch equals its exact commit;
- the routine issue is ready and the deep issue remains unready with typed
  evidence;
- current BacklogSnapshot, RoadmapPlan, routine ValidationContract, and
  DeliveryUnitReadiness refs/hashes are all present and mutually bound;
- batching sees the ready unit while both autonomous-exclusion labels remain
  independently enforced;
- the second dispatch has zero provider turns and creates no competing branch;
- status and narrative show the same publication and recovery identity;
- the pre-recorded operator checkout tree hash and bytes are unchanged.

Crash-before-push, lost acknowledgement, concurrent duplicate resume, remote
conflict, protected/credential refusal, and permanent denial remain the L2
fault-injection obligations; this live walk must not manufacture destructive
external failures merely to repeat deterministic evidence.

## Cleanup and verdict

After evidence is copied into the campaign report, separately approve cleanup
of exactly the recorded fixture issues, branch, conformance artifacts, and
disposable repository. Preserve the campaign report and Planner state before
cleanup. Any missing cleanup evidence makes the campaign incomplete.

Report Phase A and Phase B separately. Phase A cannot substitute for Phase B;
neither can upgrade unrun L4/L5 or threshold-owned findings to green. Until a
human authorizes and runs both phases, #230's real-GitHub criterion and the
broader live-org lifecycle evidence remain **incomplete**, not failed and not
passed.
