# Validation Architect host policy — ratified Cormidia decisions

Date: 2026-08-15
Status: **ratified**
Human ratifier: `bikramgupta`
Ratification source: direct human instruction in the Cormidia implementation
session on 2026-08-15

This record closes the host decisions requested by VA-HOST-002 through
VA-HOST-005 ([#447](https://github.com/cormidia/Cormidia/issues/447),
[#448](https://github.com/cormidia/Cormidia/issues/448),
[#449](https://github.com/cormidia/Cormidia/issues/449), and
[#450](https://github.com/cormidia/Cormidia/issues/450)). It also records the
temporary self-host treatment allowed by [#381](https://github.com/cormidia/Cormidia/issues/381)
and the chosen architectural disposition for the later, separately
approval-gated [#456](https://github.com/cormidia/Cormidia/issues/456) proposal.

The decision consumes, and does not redefine:

- `research/2026-08-13_validation-architect-redesign/cormidia-validation-architect-adapter.md`;
- `research/2026-08-13_validation-architect-redesign/validation-architect-api-contract.md`;
- `research/2026-08-13_validation-architect-redesign/validation-architect-core-improvements.md`;
- `research/2026-08-14_licensing-and-gtm-structure.md`; and
- the implemented `validation-architect` 0.3.0 public contract at upstream
  revision `8572c474d53b2e74e89d374a16384276944d9efd`.

The later licensing record and implemented package supersede the earlier API
holding document's MIT assumption for licensing only. Cormidia consumes the
core package under `LicenseRef-FSL-1.1-MIT`. The package name is
`validation-architect`; the public result schema is
`validation-architect/result/v1`; `validation-trace` remains a deprecated CLI
alias through 0.x. Those are upstream facts, not host choices.

No code, provider turn, corpus publication, protected-surface change, package
publication, release, deployment, or live qualification is authorized by this
record. Every future effect remains subject to its owning ticket and Cormidia's
ordinary authority gates.

## 1. Foreign-authority containment during migration

The generic Cormidia validation catalog and `routineValidationContract()` are
not authority for a managed application. An app with no accepted app-owned
corpus receives one parsed, provenance-bearing host result:
`validation_authority_absent`. It is non-green, names the app and repository
identity examined, carries the exact failed authority lookup, and gives the
next action. It contains no upstream public-result fields and is not a second
spelling of `validation-architect/result/v1`.

During migration only, the existing local Cormidia corpus may remain available
to the self-host app when all of these conditions hold:

1. the normalized registered repository identity is exactly
   `cormidia/Cormidia`;
2. the source is a freshly synchronized managed checkout at its freshly
   resolved remote default branch;
3. the local corpus bytes match a recorded accepted revision and SHA-256;
4. every read reproduces that repository/revision/hash provenance; and
5. corrupt, stale, missing, mismatched, alias, lookalike, or arbitrary working
   tree input refuses instead of falling back.

The bridge is explicitly legacy and non-package-derived. It does not decide
the general no-corpus policy, cannot be selected by app name, and sunsets when
#456 makes the package-owned method the only active Validation Architect
authority. Historical authority/evidence is preserved.

## 2. EpisodePlan representation and campaign admission

### 2.1 Chosen representation

Cormidia will extend EpisodePlan with a bounded conditional campaign envelope.
Before the first provider runtime can be constructed, the accepted plan must
contain:

- the exact package and method version;
- repository identity, resolved default branch, source revision, and input
  hash;
- profile, states, permitted transitions, terminal states, and all upstream
  limits;
- one provider-turn capacity slot for each permitted transition occurrence,
  keyed by the upstream transition identity and occurrence ordinal;
- for each slot, one exact logical seat, atomic harness/model/effort
  assignment, maximum turn budget, stable run-envelope identity, stable
  upstream idempotency key derivation, and stable Cormidia settlement identity;
- required provider/model/session independence and persistent-versus-fresh
  session semantics;
- the aggregate episode budget and app-ledger reservation; and
- terminal coverage for success, refusal, package failure, host denial,
  interruption, limit exhaustion, and typed higher-criticality escalation.

The representation admits capacity, not fabricated execution. Each capacity
slot has a separate selection value:

- `selected`: the upstream engine requested that exact permitted transition;
- `unused`: the campaign reached a terminal through another permitted edge or
  stopped before this capacity was needed.

`unused` is non-executed evidence. It constructs no Runtime, consumes no
provider budget, has no usage settlement, and is never reported as a provider
turn. A selected slot may execute at most once. No provider slot, assignment,
budget, idempotency key, or settlement identity may be invented after plan
admission.

This is a compact unrolling by transition and bounded occurrence, not an
exponential enumeration of complete paths. The admitted transition table still
determines which selected slot may follow which settled result.

### 2.2 Rejected representations

| Alternative | Rejection |
| --- | --- |
| One opaque provider step around `design`/`resume` | Hides multiple paid turns, assignments, sessions, and settlements. |
| Append a provider step when `TurnPort` receives a request | Creates authority after spend admission and permits an unbudgeted transition. |
| Treat the whole campaign as a mechanical step | False: every requested turn is a provider effect. |
| Enumerate every complete branch as a separate plan | Exponential duplication is unnecessary; bounded transition occurrences preserve the same finite authority. |
| Force the campaign into Quick/Standard/Deep | Current Deep's 8-turn/90-minute ceiling cannot truthfully contain the upstream C3/C4 104-turn/300-minute envelope. |
| Let EpisodePlanner redesign the package envelope | Forks the upstream state machine and adds an unrequested provider turn. |

### 2.3 Exact upstream envelope

The upstream envelope is a complete, deterministic creator scope. Cormidia
validates and admits it without an EpisodePlanner boot turn, so the following
counts remain exact.

| Profile | Shape and turns | Wall limit | Other locked limits |
| --- | --- | ---: | --- |
| C0 | Designer; exactly 1 turn | 30 minutes | 32,768 tokens/turn; audit is `not_required_by_profile`, never clean |
| C1 | Designer, fresh Auditor 1; exactly 2 turns | 60 minutes | 32,768 tokens/turn; at most 1 audit |
| C2 | Designer, Stakeholder, Designer resume, fresh Auditor 1; exactly 4 turns | 120 minutes | 32,768 tokens/turn; at most 1 audit |
| C3/C4 | Exact bounded relay graph; at most 104 turns | 300 minutes | 32,768 tokens/turn; at most 60 relay exchanges, 9 reader turns, 2 audit iterations, and 12 Stakeholder exchanges per audit window |

C3/C4 admit the package's exact states:

`start`, `relay:designer`, `relay:stakeholder`, `readers:1`, `readers:2`,
`readers:3`, `reader:designer`, `reader:stakeholder`, `reader:residue`,
`reader:residue-confirm`, `audit:1`, `dispositions`, `feedback`, `audit:2`,
`audit-record`, and terminal `done`.

They admit the exact transitions:

| From | To | Seat |
| --- | --- | --- |
| `start` | `relay:designer` | Designer |
| `relay:designer` | `relay:stakeholder` | Stakeholder |
| `relay:stakeholder` | `relay:designer` | Designer |
| `relay:designer` | `readers:1` | Reader/operator |
| `readers:1` | `readers:2` | Reader/new-engineer |
| `readers:2` | `readers:3` | Reader/coding-agent |
| `readers:3` | `reader:designer` | Designer |
| `readers:3` | `reader:residue` | Designer |
| `reader:designer` | `reader:stakeholder` | Stakeholder |
| `reader:stakeholder` | `readers:1` | Reader/operator |
| `reader:residue` | `reader:residue-confirm` | Stakeholder |
| `reader:residue-confirm` | `readers:1` | Reader/operator |
| `reader:residue-confirm` | `audit:1` | Auditor 1 |
| `audit:1` | `audit-record` | Designer |
| `audit:1` | `dispositions` | Designer |
| `dispositions` | `feedback` | Stakeholder |
| `feedback` | `dispositions` | Designer |
| `feedback` | `audit:2` | Auditor 2 |
| `audit:2` | `audit-record` | Designer |
| `audit-record` | `done` | Stakeholder |

The host does not reinterpret reader-residue convergence, frozen audited-core
behavior, the strict second-audit scope, no-third-audit rule, or the package's
final owner-facing review. They remain package behavior under the admitted
limits; that simulated Stakeholder review is still distinct from the real
human corpus ratification in §4.

Because Quick/Standard/Deep cannot contain this contract, the episode budget
registry will add an explicit **Validation Architect campaign case**. Its turn,
token, and wall bounds are the table above. Dollar authority is not inferred:
every app must declare positive per-seat turn ceilings and an aggregate
campaign ceiling, and the admitted aggregate must also fit remaining app
monthly budget. Missing or contradictory budget input refuses before spend.

### 2.4 Seat-policy authority

Seat policy belongs to the app entry shared by org-home `apps.yaml` and the
app's `.cormidia/config.yaml` mirror. Both parsed representations must normalize
identically. A mismatch is `validation_policy_conflict` and admits no campaign.
The future schema is:

```yaml
validation:
  owner_github_login: <exact-login>
  criticality: <ratified-criticality-record>
  product_truth:
    paths: [<safe-repository-relative-path>]
  seats:
    designer: { harness: claude, model: claude-opus-5, effort: xhigh }
    stakeholder: { harness: codex, model: gpt-5.6-sol, effort: high }
    reader: { harness: codex, model: gpt-5.6-sol, effort: high }
    auditor: { harness: claude, model: claude-opus-5, effort: xhigh }
  budget:
    designer_turn_usd: <positive-number>
    stakeholder_turn_usd: <positive-number>
    reader_turn_usd: <positive-number>
    auditor_turn_usd: <positive-number>
    campaign_usd: <positive-number>
```

The canonical provenance is the normalized app entry plus its content hash,
repository/app identity, schema version, and accepted config revision. The
runtime never resolves validation seats by analogy to Planner, Builder, or
Reviewer. Existing apps have no migrated standing-role assumption: they must
receive an explicit validation block before admission.

The fixed initial tuples are:

| Logical seat | Atomic assignment | Session/independence |
| --- | --- | --- |
| Designer | `claude / claude-opus-5 / xhigh` | Persistent; different provider, model, and session from Stakeholder |
| Stakeholder | `codex / gpt-5.6-sol / high` | Persistent; different provider, model, and session from Designer |
| Reader/operator | `codex / gpt-5.6-sol / high` | Fresh; session-independent from Designer and prior fresh readers |
| Reader/new-engineer | `codex / gpt-5.6-sol / high` | Fresh; session-independent from Designer and prior fresh readers |
| Reader/coding-agent | `codex / gpt-5.6-sol / high` | Fresh; session-independent from Designer and prior fresh readers |
| Auditor 1 | `claude / claude-opus-5 / xhigh` | Fresh; session-independent from Designer and all readers |
| Auditor 2 | `claude / claude-opus-5 / xhigh` | Fresh; session-independent from Designer, all readers, and Auditor 1 |

An Auditor may share the Designer's provider/model. No false cross-provider or
cross-model Auditor restriction is added. Every independence dimension the
package requests is verified against actual returned identity, not requested
identity.

### 2.5 Admission, execution, recovery, and settlement

| State | Authority/effect | Legal next state |
| --- | --- | --- |
| Previewed | Token-free envelope, assignments, budgets, provenance, and blockers; no plan authority | refused or admitted |
| Refused | Typed reason and next action; zero provider construction | fresh preview/admission only |
| Admitted | Immutable EpisodePlan and package envelope persisted; complete budget authority reserved | request pending or terminal package outcome |
| Request pending | Package checkpoint containing the next request and stable key is CAS-saved before spend; matching selected plan slot exists | executing or exact recovery |
| Executing | TurnPort constructs only the admitted Runtime/session and records the stable settlement join | settled or typed interrupted/ambiguous recovery |
| Settled | Actual identity, usage, result, run envelope, telemetry, and settlement are durably joined exactly once | package selects a permitted next transition or terminal |
| Interrupted | Original plan/checkpoint/session/key remain; no blind retry | exact resume or explicit fresh admission when compatibility fails |
| Terminal | Outcome and every selected/unused slot are projected truthfully | no new turn; a later run needs a new admission |

Recovery of Designer or Stakeholder resumes only the exact persisted native
session. A reader or Auditor request always starts with no prior native session
or carried context. A pending or ambiguously acknowledged request reuses the
same upstream key and Cormidia settlement identity; settled evidence is
returned without another Runtime call. Package, source, envelope, bounds,
assignment, or session drift refuses before spend. A discovered higher tier
produces typed escalation and a fresh-admission next action; it never deepens
or blesses the shallower run.

## 3. App criticality, product truth, and corpus posture

### 3.1 Every app has a tier

Every managed application must have a ratified C0-C4 tier before a campaign.
There is no first-class no-corpus mode, no origin-based default, and no default
based on whether an app is new or existing. Missing or ambiguous input is
`owner_input_required`, not C0.

Before classification, the owner must record:

- primary users and operators;
- permitted and explicitly excluded uses;
- deployment environments;
- data handled and lifetime;
- affected people, systems, assets, and physical processes;
- advisory, human-approved, or autonomous action;
- scale and exposure;
- uptime and recovery requirements; and
- update, rollback, and emergency-stop behavior.

The owner must inventory the system boundary—application, runtime,
infrastructure, identity, data systems, third parties, release/rollback,
monitoring, humans/runbooks, hardware/communications, and AI
providers/prompts/tools—and classify each as `in_scope_inspected`,
`in_scope_unavailable`, `external_assumed`, or `out_of_scope`.

### 3.2 Exact owner questions and mapping

For each question below, the owner chooses the highest consequence band that
is credibly applicable to the recorded intended use:

| Band | Deterministic tier |
| --- | --- |
| Negligible: disposable/synthetic, no consequential user, no meaningful privilege or irreversible effect, obvious failure, cheap recovery | C0 |
| Limited: bounded internal/local population, contained privilege, reversible operations, recoverable data, inconvenience or bounded loss | C1 |
| Production: external users or material operations, persistent business/customer data, multi-user/tenant behavior, material security/reliability/compatibility/financial consequence | C2 |
| High consequence: serious financial/privacy/health/legal/regulatory/infrastructure/broad operational harm, high-value privilege or blast radius, delayed detection or difficult recovery | C3 |
| Safety/mission critical: credible injury/loss of life/environmental harm/catastrophic physical damage/loss of mission, inaccessible or hard-to-repair deployment | C4 |

The exact questions are:

1. **Safety and physical consequence:** What is the worst credible injury,
   unsafe decision, equipment/infrastructure/environment damage, or physical
   actuation consequence?
2. **Mission or operational consequence:** What critical operation, mission,
   or irrecoverable opportunity could be lost, and can the deployed system be
   repaired in time?
3. **Financial and legal consequence:** What unauthorized transfer, incorrect
   balance, penalty, contractual/regulatory/reporting violation, or material
   loss could occur and at what multiplicity?
4. **Security and privacy consequence:** What privileges and sensitive data
   exist, and could failure disclose/corrupt/destroy data, cross tenants,
   enable lateral movement, issue credentials, execute code, or change
   infrastructure?
5. **Data integrity and reversibility:** Is affected data disposable,
   reproducible, backed up, or irreplaceable; can every effect and partial
   operation be completely and demonstrably reversed?
6. **Availability and continuity:** Is outage merely inconvenient, materially
   costly, operationally dangerous, or mission-ending, and what recovery time
   and recovery point are required?
7. **Exposure and blast radius:** How many users, tenants, accounts,
   transactions, devices, regions, or physical assets can one failure affect,
   and what containment exists?
8. **Detectability:** Would a plausible wrong result be detected immediately,
   eventually, or possibly never, and are detection/reconciliation channels
   independent?
9. **Recoverability:** Can operators stop, roll back, fail over, reconcile, and
   restore safely without unavailable specialists or undocumented knowledge?
10. **Privilege and autonomy:** Can the system execute code, delete data,
    modify infrastructure, approve transactions, communicate externally, or
    recursively invoke tools, and where is human approval required?
11. **Novelty and uncertainty:** How well understood and stable are the
    architecture, requirements, dependencies, hardware, models, and operating
    conditions, and what historical failure evidence exists?
12. **Patchability and lifetime:** How quickly and safely can the deployed
    version be updated, how long must it operate without intervention, and can
    an update itself create harm?

The app tier is the maximum mapped tier across all twelve answers; ratings are
never averaged. `unknown`, missing evidence, a boundary gap, or conflicting
answers refuses admission. A component may carry a higher tier than the app;
package discovery of that fact is typed escalation and requires fresh host
admission.

### 3.3 Authority, changes, and migration

The configured validation owner may propose or raise a tier. Cormidia and the
package may require a raise from evidence but cannot silently alter the stored
ratified tier. Lowering requires an explicit decision by the configured owner,
the changed intended-use/boundary evidence, a preview of lost assurance, time
and identity provenance, and a fresh campaign admission. A lower tier cannot
override an upstream-discovered minimum unless system facts changed and the
new design resolves it.

New and existing apps follow the same rule. Missing validation configuration
keeps the app visibly `owner_input_required`; registration, dry-run, verify,
planning, and status show the exact missing fields. Conflicting normalized
`apps.yaml` and `.cormidia/config.yaml` values are
`validation_policy_conflict`. The temporary exact self-host bridge in §1 is
the only migration exception and does not supply criticality to another app.

The future policy projects through the shared app config/registry parser,
interactive and non-interactive onboarding answers, `new-app --dry-run`,
`bootstrap --dry-run`, `plan --dry-run`, `loop --dry-run`, `app verify`, app
reset/archive, status, report, and observe. Dry-run and presentation surfaces
remain read-only; reset/archive use the lifecycle rules in §3.5 and cannot
ratify, migrate, or delete authority.

### 3.4 Product truth

Product truth consists only of safe repository-relative paths explicitly
selected by the configured owner and read from the freshly synchronized remote
default revision. Those reviewed sources must establish intended use and the
facts needed by the criticality intake. Cormidia may deterministically list,
hash, package, and quote those bytes. It may not ask a model to invent or
silently reconcile product facts.

Missing product truth is `product_truth_required`. A simulated Stakeholder is
a package method seat, not the real product owner. A pure-simulation bundle may
be inspected but cannot enter `pending_owner_review`, be merged as ratified
authority, or become `accepted` without the missing real product truth and
owner decision.

### 3.5 Closed corpus postures

| Posture | Authority and entry | Allowed behavior | Exit/next action |
| --- | --- | --- | --- |
| `absent` | No accepted pointer; no authoritative corpus bytes | Ordinary tests/review/app gates continue; behavioral delivery is not ready | Supply owner input/product truth and preview design |
| `design_in_progress` | Admitted package/source/envelope and live checkpoint; no corpus authority | Resume exact run only | Complete, recover, or reach typed incomplete outcome |
| `design_incomplete` | Refusal, turn error, host denial, timeout, limit/budget exhaustion, or invalid bundle; no new authority | Preserve evidence; no partial bundle use | Correct named cause, then exact resume or fresh admission as directed |
| `escalation_required` | Package found a higher minimum; shallow result is not sufficient | No acceptance or silent deepening | Owner resolves tier and starts fresh admission |
| `pending_owner_review` | Valid unwritten bundle has been content-bound into publication preview/PR intent | Read-only review; not planning authority | Exact owner approval or rejection |
| `review_rejected` | Exact owner rejected/closed corpus proposal | Existing accepted corpus, if still valid, remains; draft is not authority | Revise through a fresh governed proposal or abandon |
| `pending_publication` | Approved content-bound transaction has not completed branch/push/PR effects | Resume one journal; no acceptance | Reconcile publication effects |
| `pending_merge` | Correct PR and owner approval exist; remote default does not yet contain bytes | No acceptance; observe/reconcile only | Human-gated merge, then fresh default readback |
| `accepted` | Merged `validation-design/` was freshly read from resolved remote default and exact revision/hash recorded | Package-derived planning/check authority | Remain, or enter revision pending/invalidated |
| `revision_pending` | A revision trigger exists and a replacement is not accepted | Prior corpus governs only when trigger is non-invalidating | Complete/reject revision or expose no-current-authority for affected scope |
| `superseded` | A later corpus is validly accepted | Historical read/provenance only | No in-place reactivation or reinterpretation |

Unreadable or schema-invalid state is never rewritten into one of these stored
values. Readers project `corrupt` with the failed path/record identity and an
exact recovery action. Status/report/observe are read-only projections and do
not own transitions.

Package outcome reasons such as refused turns, limit exhaustion, turn errors,
invalid artifacts, identity mismatch, and higher-tier escalation remain exact
package data. Cormidia adds only host-posture reasons for its own budget,
approval, repository, publication, and owner-input boundaries.

Reset and archive preserve campaign and accepted-pointer evidence under the
existing app lifecycle rules. Reset never converts a draft to authority;
archive never deletes accepted history. Retry uses the exact compatible
checkpoint. Package/source/envelope/session incompatibility requires a fresh
admission, not a guessed resume.

## 4. Corpus review, acceptance, revision, and supersession

### 4.1 Human authority and review separation

Each app's exact `validation.owner_github_login` is its real corpus ratifier.
Authentication is GitHub's author identity on an `APPROVED` review for the
exact repository, PR number, and current PR HEAD. The review must be recorded
after the final corpus bytes and owner packet; a later corpus change makes it
stale.

Corpus review is separate from RoadmapPlan review. Corpus authority changes
infrequently and determines validation meaning; RoadmapPlan review selects and
sequences delivery work. Either may block independently. One UI may present
both, but it must capture two distinct decisions and evidence records.

The corpus review packet contains:

- app/repository identity and configured validation owner;
- resolved base branch and base revision;
- source/product-truth paths and hashes;
- criticality answers, tier, and tier provenance;
- exact package/method/schema versions;
- campaign run/checkpoint/outcome identity and actual seat/session evidence;
- bundle manifest with every normalized `validation-design/` path and hash;
- compile/check findings and public audit verdict without a fidelity claim;
- machine backlog summary and dependencies;
- open assumptions, blocked causes, exceptions, and residual risks;
- exact PR/review/merge intent and the statement that only post-merge fresh
  readback creates authority.

The configured owner must approve the packet/HEAD. Merge is a separately
human-gated repository effect by a human with merge authority. Cormidia may
observe and recover the transaction but does not infer approval from merge or
merge from approval.

### 4.2 Acceptance transition

Only this sequence creates `accepted`:

1. validate the unwritten bundle and content-bound preview;
2. journal before each branch, push, and PR effect;
3. observe the exact configured owner's current APPROVED review;
4. observe the human-gated merged PR;
5. freshly resolve the remote default branch;
6. fetch/synchronize the managed checkout;
7. read and validate `validation-design/` from that exact remote-default
   revision;
8. reproduce the approved bundle hash and package compile/check provenance;
9. atomically write the accepted pointer/hash/provenance in state home.

Branch creation, push, PR creation, review, or merge without fresh readback is
not enough. State home stores journals, evidence references, and the accepted
pointer/hash, never corpus bytes. The publication transaction follows the
crash/lost-acknowledgment precedents in #232 and #389: every external effect is
identified before execution, reconciled on resume, and never duplicated.
Concurrent attempts join the same content-bound transaction under its existing
publication lock/CAS identity or fail without changing journal or remote state;
they never create a second branch, PR, review decision, or acceptance pointer.

### 4.3 Revision matrix

| Trigger | Detection/owner | Review and spend | Prior authority while pending |
| --- | --- | --- | --- |
| Selected product-truth bytes/hash changed | Deterministic repository comparison; validation owner disposes | Token-free plan/compile preview; provider redesign within existing app/EpisodePlan budgets needs no extra approval | No current authority for behavior affected by changed truth; history remains |
| Intended use, system boundary, or ratified tier changed | Parsed app policy and owner provenance | Fresh owner tier decision and new admission; existing budgets suffice unless raised | Invalid for affected scope/tier |
| Package discovers higher criticality | Exact package outcome | Owner resolves tier; fresh admission; no silent deepening | Shallow corpus/result cannot satisfy higher tier |
| Package/method/schema becomes incompatible | Exact compatibility check | Token-free `migrate` preview or redesign; explicit migration writes new result | No reinterpretation; compatible old authority may remain, incompatible authority is non-current |
| Package compile/check closure fails | Exact deterministic result | Token-free diagnosis; redesign or implementation repair under normal budgets | Non-green and non-current for failed scope |
| Structural journey/boundary/invariant/state-owner finding | Binding #432 clause-versus-shape test | Enter `validation-harness-design` revision; ordinary configured spend policy | Non-current for affected structure; independent scope may proceed |
| Clause-only finding | Deterministic finding owner | Park exact cases as `BLOCKED:<finding>`; no provider spend required merely to park | Unaffected authority remains; affected claim is visibly blocked |
| Fidelity/audit judgment finds weakness | Package evidence plus validation owner | Owner chooses revision; provider redesign uses normal configured budgets | Prior corpus remains until owner marks it invalid or replacement is accepted |
| Explicit owner request | Configured validation owner | Token-free preview first; redesign uses normal configured budgets | Prior corpus remains unless owner records invalidation |

Configured app and EpisodePlan budgets are sufficient authority for an
otherwise admitted redesign. There is no extra “Validation Architect spend”
approval. A missing budget, budget increase, critical operation, or other
ordinary Cormidia approval condition remains governed by its existing policy.

Failed, rejected, interrupted, or escalated replacement work never substitutes
draft bytes. A later accepted corpus atomically supersedes the previous
pointer; the old revision/hash and every related result remain historical
evidence. Ordinary read/resume never migrates. Pre-1.0 migration calls the
package `migrate` API and writes a separately identified result with old/new
provenance.

## 5. Delivery obligations, checks, and escape hatches

### 5.1 Work classes and empty-set reasons

Roadmap delivery units have exactly these applicability classes:

| Work class | Obligation policy |
| --- | --- |
| `product_behavior` | Requires an accepted corpus and a nonempty set returned by package `plan`; ambiguity is behavioral. |
| `validation_implementation` | Requires accepted authority and nonempty package-derived family/control obligations. |
| `nonbehavioral_change` | May carry an empty set only with one closed reason below and evidence that no runtime contract/test policy meaning changes. |

The only empty-set reasons are:

- `non_authoritative_prose_only`;
- `generated_view_regeneration_only`; and
- `metadata_only_no_runtime_contract_or_test_policy_effect`.

Dependency, build, tooling, CI, configuration, schema, migration, test-policy,
security, and release changes are not nonbehavioral merely because they do not
edit product source. Unknown classification fails closed as
`product_behavior` until resolved. Direct human/operator operations outside
RoadmapPlan are not delivery units; they retain EpisodePlan, evidence, tool,
budget, and critical-operation gates without claiming corpus coverage.

### 5.2 Admission matrix

| Corpus posture / impact | Obligations and checks | Readiness/review outcome |
| --- | --- | --- |
| Accepted; known affected paths | Bind exact corpus/package/source to package `plan`; translate only returned obligations; run package `check`; full required CI once | Ready only when all required evidence is current and check is green |
| Accepted; package reports unknown or structural impact | Select full applicable suite and run full required CI once; route #432 | Non-green until structural revision/parking is correctly resolved |
| Accepted; clause-only blocked cause | Preserve upstream `blocked_by`, park exact cases behind the finding | Affected obligation is incomplete/inconclusive, never green |
| Accepted but stale/corrupt/incompatible | No trusted plan/check translation | Non-green with exact repair/migrate/redesign action |
| No accepted corpus; product behavior or validation implementation | No fabricated obligations and no corpus-check claim | Cannot become ready, execute, review-pass, batch, or merge |
| No accepted corpus; corpus establishment/recovery | Candidate bundle must compile/check at the publication seam | May proceed only toward human corpus acceptance |
| No accepted corpus; proven nonbehavioral change | Empty set with one closed reason; ordinary tests/review/app gates still run | May proceed without claiming corpus coverage |

The exact accepted app/repository, corpus revision/hash, package/method/schema,
RoadmapPlan revision, unit membership, ValidationContract version, Builder
evidence, independent Reviewer verdict, EpisodePlan, and PR HEAD form one
content-bound lineage. A stale or mismatched join is non-green.

### 5.3 Application check placement

For every application PR governed by an accepted corpus, Cormidia calls the
public package `check()` through the admitted read-only RepositoryPort at the
exact PR HEAD/source context and parses `validation-architect/result/v1`.
Only `isGreenValidationResult(result)`—applicable + complete + pass—is green.
The host does not use the CLI's exit code as the verdict because the upstream
CLI deliberately exits zero for a structurally closed but evidence-incomplete
inconclusive result.

Missing input, compile failure, fail, incomplete, inconclusive, required
skip/not-run, product failure, and malformed result are non-green. A real
product failure remains failure even when other evidence is incomplete.
Unknown/structural mapping expands to the full applicable suite; the normal
full CI command executes exactly once and is neither replaced nor duplicated
by the package plan.

Package identities, cases, evidence, `blocked_by`, reason, and next action are
preserved. Cormidia may translate them into its existing delivery authority but
does not invent another result vocabulary, infer causal groups from prose or
stack similarity, or claim that closure proves model-judgment fidelity.
#431 remains the distinct token-free platform closure gate for Cormidia's own
repository.

### 5.4 Waivers

There is no generic host-authored validation escape hatch. A delivery
obligation is waiver-eligible only when the accepted upstream corpus declares
an exact, unexpired `kind: waiver` exception for that target. Cormidia then
requires a separate durable human approval by the configured validation owner,
bound to one obligation, app, unit, ValidationContract version, corpus
revision/hash, package/method, PR HEAD, reason, decision time, and expiration.
The host approval cannot outlive the package exception. Expiry, revocation,
scope drift, or stale HEAD fails closed.

These conditions are never waivable:

- missing, corrupt, stale, or incompatible corpus authority;
- missing product truth or criticality input;
- unknown or structural impact and higher-tier escalation;
- broken corpus/package/unit/contract/evidence/PR lineage;
- package `check` non-green or malformed output;
- a real product failure;
- authentication, authorization, security, privacy, payments, user-data,
  migration/data-loss, critical-invariant, or control-point floors;
- required negative controls or independent Reviewer evidence;
- full required CI; and
- a required case that did not run or produced incomplete evidence.

## 6. Structural routing and protected surfaces

This decision applies [#432](https://github.com/cormidia/Cormidia/issues/432)
and `validation-design/routing.md` exactly.

The conditional EpisodePlan envelope, campaign checkpoint state owner,
criticality/onboarding boundary, corpus posture/publication lifecycle, and
accepted-corpus delivery join introduce or change journeys, boundaries,
ownership, and failure domains. Their implementation therefore requires
`validation-harness-design` in `harness-revision` mode before dependent
structural cases/specs are written. Clause-only findings use the ordinary
finding plus `BLOCKED:<finding>` path. If the skill is unavailable, independent
work may land, but structural cases/specs remain parked in the PR description;
the structure is never approximated by hand.

The package-owned skill may be installed in the user's provider skill home. It
must not be copied into Cormidia's org-home `skills/` root, and
`skills/.gitkeep` remains.

No protected bytes are approved here. The chosen architectural disposition for
#456 is to **retire S-10**: Cormidia invokes package `design`/`resume` through
its three ports and does not retain a local method prompt or a one-step wrapper
around a multi-turn campaign. #456 must still produce a Phase A exact unified
diff, migration matrix, proposal hash, rollback, and scope detector while
making zero protected edits. The named human must approve that exact proposal
before Phase B. Any differing protected byte requires renewed approval.

`roles.yaml`, `pipelines.yaml`, `prompts/**`, `TASTE.md`, and
`docs/PURPOSE.md` are unchanged by this decision. Seat assignments live in the
future app validation policy, not by rewriting standing-role authority.

## 7. Deterministic validation plan

All implementation tests use upstream conformance fakes or Cormidia fake
Runtime/Git/GitHub seams. They construct zero live providers and perform no
live campaign, registry action, publication, or repository-publicity change.

### 7.1 EpisodePlan and seats

- enumerate every upstream state/transition and terminal;
- pin C0/C1/C2 to exactly 1/2/4 calls and exact order;
- enumerate every C3/C4 permitted branch and all 104/60/9/2/12/300/32,768
  bounds;
- prove unused capacity is non-executed and unsettled;
- seed controls for opaque-step hiding, post-admission append, wrong edge,
  missing terminal, hidden EpisodePlanner boot, and bound expansion;
- verify exact Designer/Stakeholder provider/model/session independence;
- prove persistent-session resume and fresh reader/Auditor isolation;
- permit Auditor/Designer model equality and reject a false cross-model rule;
- refuse missing seat/budget policy, config-mirror drift, and actual identity
  mismatch before provider construction.

### 7.2 Criticality and posture

- table-test all twelve questions across C0-C4 and prove max selection;
- seed unknown, missing, conflicting, under-classified, and higher-component
  inputs;
- prove new/existing apps receive no age/origin default;
- reject missing/unreviewed/out-of-root/stale product truth and pure simulation;
- exhaust every posture transition, reason, retry/resume/fresh-admission path,
  reset/archive behavior, and corrupt read projection;
- prove ordinary tests/review/configured gates remain while corpus authority is
  absent.

### 7.3 Corpus publication and revision

- bind preview/execution to exact repo/base/source/package/method/run/bundle and
  owner packet;
- reject absolute, traversal, symlink, unrelated, duplicate, and conflicting
  bundle paths;
- simulate lost acknowledgment before/after branch, push, PR, review, merge,
  and fresh-default readback without duplicate effects;
- reject wrong/stale owner, review, HEAD, repo, merge, default branch, and hash;
- prove branch/push/PR/review/merge-before-readback cannot set accepted;
- preserve old accepted authority through non-invalidating pending/failed/
  rejected work and remove current affected authority for invalidating triggers;
- prove state home never stores corpus bytes and history is never deleted or
  reinterpreted.

### 7.4 Obligations, checks, and waivers

- cover every work-class/posture/impact cell and empty-set reason;
- seed ambiguous docs/tooling/dependency changes that attempt nonbehavioral
  classification;
- bind plan/check/evidence/verdict to exact corpus/package/unit/contract/PR;
- prove only applicable + complete + pass is green, including an inconclusive
  result whose CLI-equivalent exit would be zero;
- preserve exact upstream cases, causes, evidence, and next actions;
- prove unknown/structural impact expands to the full suite while full CI runs
  once;
- reject fabricated obligations, local graph/causal reducers, and generic
  no-corpus fallbacks;
- exhaust missing/expired/revoked/mismatched/broadened waivers and every
  unwaivable class;
- seed a control that re-enables `routineValidationContract()` as generic
  authority.

Each defect implementation deposits its detector and required
case-catalog §10.3 row. No gate or test may be weakened. The minimum repository
gate is `pnpm test && pnpm typecheck`; affected PRs also run `pnpm check`,
focused suites, package conformance, and all applicable ratchets.

## 8. Implementation ownership and sequencing

The decision tickets authorize no code. Their approved policy is implemented
only by the owning follow-ons:

| Policy | Implementation owner |
| --- | --- |
| EpisodePlan capacity and seat binding | #453 TurnPort and #454 campaign admission |
| Criticality, product truth, and postures | #454 campaign admission/onboarding |
| Corpus review, acceptance, and revision | #455 publication/acceptance |
| Obligations, checks, and waivers | #234 delivery adapter |
| Foreign authority bridge/removal | #381, then final sunset under #456 |
| S-10 retirement and legacy migration | #456 two-phase exact protected proposal |

#381 precedes adapter rollout. Package-dependent work waits for the exact core
source authorized by the package-adoption plan. #431 Parts A/B remain
independent; its vendored-to-registry Part C waits for an actual separately
approved 0.3.0 publication. No ticket is closed by a PR description until all
of its binary acceptance criteria are met.
