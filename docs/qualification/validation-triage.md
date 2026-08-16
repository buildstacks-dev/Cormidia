# Validation campaign triage

This is the operator runbook for durable L3/L4/L5 campaign reports under
`<state-home>/validation/campaigns/`. It is not evidence itself. Preserve the report,
its referenced artifacts, the exact commit, and target identity before changing or
retrying anything. `inconclusive` is **not a pass** and is never release evidence.
New reports use schema v2 and bind both the Cormidia host-policy bytes and the
ordered selected Validation Architect authority bytes. Historical schema-v1
reports remain readable for triage but cannot satisfy current release evidence.

Severity follows the concentrated control points in
`validation-design/system-map.md` §5.2. SEV-0 means possible authority, secret,
cross-app, merge, or irreversible-effect harm; SEV-1 means false-green, accounting,
adapter-enforcement, or durable-state integrity risk; SEV-2 means bounded campaign
incompleteness without a proven product violation; INFO is an expected safe refusal.

## First response

1. Stop only the scoped campaign. Do not disable a product gate, delete evidence,
   widen a sandbox target, or increase spend without a new human authorization.
2. Copy the campaign `report.json`, referenced evidence, exact host-policy and
   selected validation-authority bytes, commit, target config, and
   provider/GitHub/launchd identities to an immutable incident folder.
3. If any collected evidence already proves a violation, preserve `verdict=fail` even
   when later cases are missing. Otherwise missing work stays `incomplete/inconclusive`.
4. For deterministic defects found by L3/L4/L5, deposit the cheapest L1/L2 detector in
   the same fix. Never use a green rerun as the regression test.

## Alert → action map

| Reported class / matching code | Severity / control point | Immediate action | Resume condition |
| --- | --- | --- | --- |
| Campaign report unreadable, schema/digest/path mismatch, corrupt campaign directory | SEV-1 · T-9 | Quarantine bytes; compare directory identity, policy digest, and writer logs. Do not replace with an empty report. | Parser accepts preserved/repaired evidence and missing coverage remains explicit. |
| `campaign_running`, missing case IDs, interrupted case, `case_execution_error:*` | SEV-2 · T-9 | Preserve partial evidence; identify the exact uncollected case and whether retry is side-effect-free. | Same authorized target/commit remains valid and the case has an idempotent retry path. |
| `spend_reservation_refused`, `*_ceiling_exhausted`, token reservation refusal | SEV-2 · T-5/T-9 | Stop provider calls. Do not raise the ceiling in code/config. | Human edits the policy/authorization or accepts incomplete evidence. |
| Observed spend, turns, usage quality, or settlement exceeds/disagrees with its envelope | SEV-1 · T-5 | Stop the campaign; preserve ledger, run envelope, execution step, and provider receipt. Reconcile token-free only. | Exact settlement is repaired and a detector covers the failure; new spend needs authorization. |
| Proven gate/profile widening, human-decision-row creation, self-approval, non-sandbox target, external publication | SEV-0 · T-1/T-2/T-3/T-12 | Stop all unattended activity for that org; revoke exposed grants; inspect effects and approval log. | Human incident disposition plus a failing-then-passing guardrail detector. |
| Secret/canary leak or gitleaks failure | SEV-0 · T-4 | Treat credential as exposed, rotate/revoke it, preserve only scrubbed evidence. Never add a broad allowlist. | Secret removed/rotated and the canary detector still fires. |
| Cross-org/app/repo/state-home/worktree identity mismatch | SEV-0 · T-3/T-6/T-8 | Stop every affected org turn; preserve both homes/worktrees; inspect sibling damage before cleanup. | Exact ownership is restored and isolation detector passes. |
| GitHub conformance `github_clause_failed:*`, wrong default/base/head/review/merge identity, cleanup failure | SEV-0 for merge/authorization (T-7/T-12); otherwise SEV-1 · T-9 | Freeze the sandbox repo; record issue/PR/branch/label IDs; do not blind-retry a write. | Readback proves exact expected state or human disposes ambiguous effect. |
| GitHub conformance `github_clause_inconclusive:*`, `case_incomplete:CF-B01-L3` | SEV-2 · T-9 | Preserve the clause code/error hash and external artifact identities; verify cleanup; do not reinterpret a bounded observation gap as product failure or pass. | A fresh, separately authorized campaign observes the required projection, or the human narrows the claim through an explicit evidence disposition. |
| Adapter conformance violation (gate hook, exact-session resume, usage, auth rotation) | SEV-1 · T-5/T-11; SEV-0 if a critical tool escaped · T-1/T-12 | Stop that adapter tuple; preserve native session/checkpoint IDs and raw provider classification without secrets. | Offline adapter detector passes and the human authorizes a fresh real-adapter run. |
| Launchd identity/hash/cadence/load mismatch, missing attributable tick, scoped removal failure | SEV-1 · T-9 | Inspect the exact scheduler ID and definition; do not call a definition file “healthy.” Remove only proven-owned definition. | Loaded identity, attributable tick, and exact removal all have evidence. |
| Eval golden set empty/invalid, human reference pending, tuple pooling, shard gap, token ceiling | SEV-2 · T-9/T-11 | Keep verdict inconclusive; preserve tuple-level results and missing shard IDs. | Golden cases are committed, human references validated where required, and rotation covers the bounded set. |
| Threshold-dependent eval while F-PT-009/010/011 is open | INFO · T-9 | Report measurements only. Never convert a score into pass/fail. | Human ratifies the owning finding in policy. |
| Contention: WIP >2, duplicate `(app,role)`, priority drift, vanished candidate, no reconsideration, duplicate decision/episode | SEV-1 · T-6/T-9 | Stop scheduler dispatch for the sandbox; preserve decisions, locks, journals, runs, and tick IDs. | All six CF-OPS-CONT obligations pass with seeded negative control. |
| Orphaned lock/journal/run/settlement or provider-turn/settlement disagreement | SEV-1 · T-5/T-9 | Do not delete the orphan. Reconcile from durable identities; never assume zero or settled. | Joined scheduler evidence is valid with zero orphans and exact agreement. |
| Soak duration/checkpoint/sleep/overnight evidence missing | SEV-2 · T-9 | Continue ordinary laptop use only within the existing authorization; do not synthesize timestamps. | Seven real days and three observed sleep/wake cycles including overnight. |
| `natural_codex_rotation_unobserved` | SEV-2 · T-11 | Preserve the soak as incomplete; do not inject a fake rotation and call it natural. | Same-session/checkpoint preservation is observed across a real Codex rotation window. |
| Soak missed-window/partial-usage/retention/source-health evidence absent | SEV-2 · T-5/T-9 | Name the missing sub-obligation; do not infer it from uptime. | Required durable checkpoint evidence exists. |
| Soak duplicate/WIP/orphan/settlement/retention/source-health violation | SEV-1 · T-5/T-6/T-9 | Stop the soak campaign and retain state-growth snapshots and sweep records. | Cheapest detector lands and the defect is repaired. |
| Soak human approval delta after sleep (`sleep_permission_delta`) | SEV-0 · T-2/T-3/T-9 | Stop unattended operation; inspect every new decision/grant and resulting effect. | Human confirms provenance and the profile proves sleep created no authority. |
| Threat-model gate blocked, digest drift, missing surface or abuse case | INFO for future L5 assurance; SEV-0 if the abuse gate is bypassed · T-1…T-12 | Keep HB-073 blocked. Do not “complete” the template as an agent. This lane is outside RQ-1. | Human-authored and reviewed ten-surface artifact is hash-bound in status. |
| Abuse-lane violation (after HB-072) | Severity is the mapped abuse case's T-point, minimum SEV-1 | Follow the human threat model disposition; isolate affected trust boundary. | Mitigation detector passes and human residual-risk owner accepts/reviews. |
| CI lane missing, skipped, timed out, empty walk, gitleaks canary absent | SEV-1 · T-4/T-9 | Treat the lane as incomplete/red; do not merge based on absence. | Full required walk and harness self-tests run under the 15-minute core ceiling. |
| Per-commit duration exceeds the five-minute optimization target only | INFO | Record timing and investigate regressions; do not change verdict/completeness. | Optimization addressed or consciously accepted; the 15-minute ceiling still applies. |
| Parked `BLOCKED:F-PT-*` case | INFO · T-9 | Leave it parked; ask the product owner the recorded product-truth question. | Policy finding is human-ratified and companion contracts are updated. |

## Escalation record

Record campaign ID, commit, host-policy SHA-256, ordered validation-authority
path/digest set, exact target and tuple, first bad evidence reference, affected
T-point(s), spend at stop, known side effects, missing cases, and the human who
authorized any retry. Never copy raw secrets or provider transcripts into an issue;
use hashes and scrubbed excerpts.
