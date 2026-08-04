# Findings

Assessment: `20260804T164335Z-abe087e950dc`

## Summary

| Severity | Open | Resolved | Accepted | Deferred |
|---|---:|---:|---:|---:|
| BLOCKER | 0 | 0 | 0 | 0 |
| HIGH | 0 | 12 | 0 | 0 |
| MEDIUM | 1 | 0 | 0 | 0 |
| NOTE | 1 | 0 | 0 | 0 |

### FND-001 — Concurrent recovery had no publication-scoped serialization

- Severity: `HIGH`
- Status: `resolved`
- Classification: `case-level`
- Affected claims/components: `CLM-EXACTLY-ONCE`, `COMP-PUB`
- Observation: scheduler and manual resume could enter the same pending
  transaction concurrently; remote compare-and-swap limits Git damage but
  downstream label/authority acknowledgements had no one-writer boundary.
- Consequence: duplicate external calls or competing transaction file writes.
- Remediation: wrap preparation and recovery in the shared nonce/liveness-aware
  file lock keyed by app and publication ID.
- Verification: concurrent `Promise.all` resume produces one push, one label
  application, one provider evidence set, and two published results.
- Residual risk: external filesystem semantics are the shared lock primitive's
  already-tested boundary.

### FND-002 — Planner branch publication lacked a canonical credential scan

- Severity: `HIGH`
- Status: `resolved`
- Classification: `case-level`
- Affected claims/components: `CLM-PUBLICATION-SAFETY`, `COMP-PUB`
- Observation: protected paths were refused but changed diff bytes were not
  checked against the repository's one credential-pattern source.
- Consequence: a provider-created credential could reach a remote branch.
- Remediation: scan the exact base-to-commit binary patch with
  `SECRET_PATTERNS`, persist only matched family names, and permanently refuse
  before push.
- Verification: real local Git seeded `sk-` content is refused, the message
  names `sk-api-key`, and the credential bytes are not echoed.
- Residual risk: pattern scanners are finite; existing CF-INV-011 governance
  controls updates to the single canonical source.

### FND-003 — Scheduled replanning preserved `backlog-unplanned` forever

- Severity: `HIGH`
- Status: `resolved`
- Classification: `case-level`
- Affected claims/components: `CLM-LIFECYCLE`, `COMP-SCHED`
- Observation: predecessor preservation caused a later Planner execution group
  to exclude an already represented unplanned issue.
- Consequence: complete intake could never move parked backlog into executable
  delivery authority.
- Remediation: displace newly planned members, preserve stable unit IDs for
  unchanged membership, append move evidence when membership changes, and
  rebuild workstreams/frontier.
- Verification: HB-103/105 production test moves #702 from the parked
  workstream into the scheduled Planner workstream without violating stable-ID
  or predecessor rules.
- Residual risk: multi-unit live evolution remains covered only hermetically.

### FND-004 — Completeness-bound intake could still construct a provider

- Severity: `HIGH`
- Status: `resolved`
- Classification: `case-level`
- Affected claims/components: `CLM-INTAKE`, `COMP-SCHED`
- Observation: the new 10,001-source diagnostic was generated but absent from
  the turn runner's pre-provider refusal set.
- Consequence: the scheduler could spend on an intake already known not to be
  complete, then fail during publication.
- Remediation: add `backlog_completeness_bound` to the pre-provider terminal
  diagnostic path and pin it in the production lifecycle detector.
- Verification: CF-REG-230 seeded bound plus source-wiring detector.
- Residual risk: real GitHub list behavior remains FND-005.

### FND-005 — Real-GitHub and live-org evidence is not collected

- Severity: `MEDIUM`
- Status: `open`
- Classification: `case-level`
- Affected claims/components: `CLM-EXTERNAL`, `COMP-GIT`, `COMP-PUB`, `COMP-SCHED`
- Observation: this session explicitly prohibited live/provider-backed
  campaigns; no disposable exact target was authorized.
- Consequence: offline evidence cannot establish changing GitHub auth/network
  semantics or one real scheduler/provider walk.
- Required remediation: separately authorize and execute
  `docs/qualification/planner-publication-qualification.md`, retain campaign
  reports and verified cleanup.
- Owner/acceptance authority: human product owner and campaign operator.
- Assurance impact: does not block the stated deterministic ordinary-merge
  target; blocks #230 closure and broad live-operation claims.

### FND-007 — Normal publication reread the complete backlog twice

- Severity: `HIGH`
- Status: `resolved`
- Classification: `case-level`
- Affected claims/components: `CLM-INTAKE`, `CLM-LIFECYCLE`, `COMP-PUB`
- Observation: RoadmapPlan publication and routine validation each called the
  complete-open-backlog seam during one uninterrupted resume.
- Consequence: avoidable GitHub cost and violation of #233's no repeated
  full-backlog rediscovery acceptance direction.
- Remediation: retain the one current issue read across roadmap and validation
  stages; only a later crash recovery rereads changing external truth.
- Verification: CF-REG-232 asserts exactly two list calls total—one original
  intake and one complete publication read.
- Residual risk: recovery deliberately rereads after interruption rather than
  trusting stale issue/routing state.

### FND-008 — Permanent remote-discovery refusal escaped durable state

- Severity: `HIGH`
- Status: `resolved`
- Classification: `case-level`
- Affected claims/components: `CLM-EXACTLY-ONCE`, `COMP-PUB`
- Observation: a permanent failure from the initial remote-ref read was
  rethrown while a permanent push failure was recorded as `refused`.
- Consequence: scheduler reconciliation could lose the required durable human
  recovery evidence for one permanent-refusal boundary.
- Remediation: route every remote-ref/push failure through the shared durable
  failure recorder after the transaction exists.
- Verification: seeded permanent discovery refusal persists `refused`, exact
  commit/error/recovery evidence, and performs zero pushes.
- Residual risk: real authentication behavior remains FND-005.

### FND-009 — Recovery identity did not bind planning intent

- Severity: `HIGH`
- Status: `resolved`
- Classification: `case-level`
- Affected claims/components: `CLM-EXACTLY-ONCE`, `CLM-PUBLICATION-SAFETY`, `COMP-PUB`
- Observation: recovery identity bound repository/branch/commit but not intake,
  readiness decisions, provider-output evidence, intended effects, or the exact
  displayed recovery command.
- Consequence: edited durable state could retain a superficially valid recovery
  identity while changing the effect requested from the reconciler.
- Remediation: bind all content hashes and intended effects into the recovery
  identity, recompute the intake manifest, strictly parse nested readiness
  evidence/effect shapes, and require the deterministic command bytes.
- Verification: seeded command and readiness-intent edits are rejected before
  reconciliation.
- Residual risk: state identity is content integrity, not a cryptographic MAC;
  filesystem authority remains the org-state access boundary.

### FND-010 — Standalone Planner routes created a branch eagerly

- Severity: `HIGH`
- Status: `resolved`
- Classification: `case-level`
- Affected claims/components: `CLM-ISO`, `COMP-GIT`, `COMP-SCHED`
- Observation: standalone creator routing took the generic attached-worktree
  branch before the role-specific Planner selection.
- Consequence: a read-only Planner route could manufacture a branch despite the
  detached publication contract.
- Remediation: select the Planner worktree for every route before considering
  generic standalone-role checkout behavior.
- Verification: the production seam detector pins the role-first expression;
  the real Git test proves detached/read-only behavior.
- Residual risk: live scheduler route selection remains FND-005.

### FND-011 — Roadmap acknowledgement loss could publish a successor

- Severity: `HIGH`
- Status: `resolved`
- Classification: `case-level`
- Affected claims/components: `CLM-EXACTLY-ONCE`, `CLM-LIFECYCLE`, `COMP-PUB`
- Observation: after the RoadmapPlan pointer became durable but before its ref
  entered the transaction, replay rebuilt from mutable GitHub truth.
- Consequence: one Planner publication could accept two RoadmapPlan revisions,
  or silently supersede a concurrent human/scheduler roadmap change.
- Remediation: bind the predecessor and publication-specific snapshot source in
  intended effects, acknowledge an exact already-published source, and
  permanently refuse a changed current predecessor.
- Verification: the lost-ack seed retains the exact first RoadmapPlan after the
  backlog changes; the successor-conflict seed refuses and remains refused.
- Residual risk: external state ordering remains FND-005.

### FND-012 — Persisted Git errors could retain credential-shaped text

- Severity: `HIGH`
- Status: `resolved`
- Classification: `case-level`
- Affected claims/components: `CLM-PUBLICATION-SAFETY`, `CLM-OBSERVABILITY`, `COMP-PUB`
- Observation: Git stderr was persisted and rendered verbatim as publication
  error evidence.
- Consequence: an authenticated remote URL or vendor message could copy a
  credential into durable state, status, and narrative output.
- Remediation: scrub every persisted publication error with the canonical
  runtime redactor while retaining the typed code and recovery identity.
- Verification: a seeded permanent-refusal error contains the canonical named
  redaction and no credential bytes.
- Residual risk: canonical pattern coverage is finite and governed by
  CF-INV-011.

### FND-013 — Registered repository was not checked against worktree origin

- Severity: `HIGH`
- Status: `resolved`
- Classification: `case-level`
- Affected claims/components: `CLM-ISO`, `CLM-PUBLICATION-SAFETY`, `COMP-GIT`, `COMP-PUB`
- Observation: the transaction persisted `app.repo`, but default Git effects
  used the worktree's `origin` without proving both names resolved to the same
  repository.
- Consequence: a stale or tampered managed clone could publish the exact
  Planner commit to a different repository while evidence named the intended
  one.
- Remediation: capture the worktree origin during local preparation, normalize
  supported GitHub URL/slug forms, and persist a permanent pre-push refusal on
  mismatch without rendering the unexpected remote value.
- Verification: the real local Git fixture seeds a different registered
  repository, retains the prepared commit, and records the typed refusal.
- Residual risk: equivalence for non-GitHub exotic transports is intentionally
  exact-string after `.git`/slash normalization and therefore fails closed.

### FND-014 — App-owned ratified protocol paths were absent from refusal

- Severity: `HIGH`
- Status: `resolved`
- Classification: `case-level`
- Affected claims/components: `CLM-PUBLICATION-SAFETY`, `COMP-PUB`
- Observation: the initial path check covered repository-root ratified files
  and `prompts/**`, but not app-owned `.cormidia/AUTHORITY.md`,
  `.cormidia/TASTE.md`, `.cormidia/policy.yaml`, `.cormidia/config.yaml`,
  nested protocol filenames, or `taste/**` addenda already classified as
  protected by the runtime gate/bootstrap contract.
- Consequence: an untrusted Planner could commit an app charter/authority or
  another protected protocol surface even though root equivalents refused.
- Remediation: align the pre-push path family with repository and app protocol
  filenames/directories, case-insensitively, while preserving the exact local
  artifact for human review.
- Verification: the real local Git fixture seeds
  `.cormidia/AUTHORITY.md` and records a permanent pre-push refusal.
- Residual risk: new protected filename families must continue to update this
  boundary and its detector alongside the runtime gate.

### FND-006 — Audit independence is I1

- Severity: `NOTE`
- Status: `open`
- Classification: `case-level`
- Affected claims/components: all deterministic claims, `COMP-HARNESS`
- Observation: the same agent implemented and audited the change; no separate
  reviewer agent was authorized.
- Consequence: common-mode misunderstanding may survive otherwise sensitive
  tests.
- Required remediation: use an independent reviewer before broad live
  qualification or release-readiness claims.
- Owner/acceptance authority: repository owner.
