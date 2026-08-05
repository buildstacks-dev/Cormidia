# Release-evidence gate revision — exact ratification proposal

Status: **RATIFIED — IMPLEMENTATION IN PROGRESS** (ratified by `bikramgupta`, 2026-08-04)
Target baseline: `00e00b5b3232f4a6f60dc0fc3ee38f84d51e106e`
Mode: `validation-harness-design` harness revision, followed by
`validation-harness-audit` assess/design
Owner/acceptance authority: human

This is the review boundary for restoring release qualification after the narrow
`cormidia@0.1.1` exception. It does not reactivate a gate, validate a golden
reference, claim a human-authored threat model, authorize a paid campaign, create a
tag, or publish a package. The exact protected/binding surface proposal is in §14.
Applying it requires separate explicit human ratification; activation additionally
requires the genuinely human-authored/reviewed inputs named in §13.

## 1. Outcome of the holistic review

The replacement does **not** need another test hierarchy beside `tests/`. The current
L1/L2 suite is the deterministic foundation and was green on the target baseline:
167 files, 1,058 passing tests, one ratified blocked-contract skip, plus green
typecheck and build. The missing layer is a release assessor that binds those results
and triggered evidence to the exact bytes being released.

No new product journey, runtime state owner, invariant, or external boundary is
introduced. Existing INV-008/009/012/014/015, B-01/B-02/B-03/B-04/B-12/B-17, J-17,
and the L3/L4/L5 policy lanes already own the required behavior. This is a structural
revision of the **harness release lane**, not of Cormidia's product architecture.

The current L4 runner is honestly limited:

- Reviewer: six synthetic cases; it extracts one `VERDICT` marker and compares the
  binary label. It does not grade rubric anchors.
- Planner: ten cases; output is collected but not scored.
- Validation Designer: four cases; output is collected but not scored.
- At review time every statistical reference was `human_validation=pending`; the
  ratification confirmed all §7.1 expected behaviors and the implementation now records
  `human_validation=validated` by `bikramgupta` without changing agent authorship.
- Builder trajectory has four deterministic cases and correctly remains L1/L2.
- The other statistical sites and Selection Judge are empty scaffolds.
- There is no candidate-versus-incumbent comparison, judge calibration, release
  aggregation, currency check, attestation, or release-blocking workflow.

Therefore the six Reviewer rows are useful sentinel cases, not a statistical
measuring instrument. Absolute hypotheses such as 95%, 10%, 85%, 80%, and N≥3 are
not adopted. No external Airbnb number is used: issue #248 records those figures as
unverified against primary sources.

## 2. Release-qualification contract (`RQ-1`)

One release qualification assesses one exact release candidate and produces one
immutable, sanitized evidence packet. It has three independent results:

1. `completeness: complete | incomplete` — whether every predeclared obligation was
   collected within its authorized envelope;
2. `verdict: pass | fail | inconclusive` — what the evidence establishes;
3. `qualification: qualified | not_qualified | needs_human_disposition` — whether the
   candidate may enter the separate human release-approval boundary.

These fields cannot rewrite one another. In particular, an L4 `inconclusive` report
remains inconclusive even when a human accepts it as disclosed evaluator debt under
PURPOSE v2.4. The aggregate qualification may become `qualified` only by recording
that separate, content-bound human disposition; it never changes the lane result.

### 2.1 Mandatory release claims

`qualified` requires all of the following:

- the candidate identity and every evidence input pass §3 currency checks;
- deterministic-first admission (§4) is complete and green on the release candidate;
- every triggered L3 product/seam obligation is complete/pass (§5), except an
  explicitly predeclared evaluator-debt row permitted by §10;
- required L4 collection is complete, every automatic score used as evidence came
  from an admitted calibrated judge, and every disagreement/regression has a terminal
  disposition (§6–§8);
- required L5 baseline evidence is current (§9);
- no product, safety, permission, settlement/accounting, learning-integrity, build,
  typecheck, core-test, required-CI, or spend-ceiling violation exists;
- all accepted evaluator debt is bounded, immutable, disclosed, owned, and explicitly
  accepted by a human; and
- the release attestation verifies on the exact tag/package candidate (§11–§12).

Any proven mandatory-claim violation yields `not_qualified`, even when later work is
missing. Otherwise any missing, stale, corrupt, ceiling-stopped, or undispositioned
obligation yields `needs_human_disposition` with `verdict=inconclusive`; it never
silently disappears.

### 2.2 Scope of the qualification claim

Qualification means only:

> Evidence is sufficient to offer this exact Cormidia package candidate for the
> separate human-approved npm release path, for the documented single-user autonomous
> local-org operating shape and its declared supported adapters, subject to every
> disclosed residual limitation in the evidence packet.

It does not mean that Cormidia is generally safe, that unpopulated call sites have
qualified model quality, that B-17 has a proven real non-GitHub target, or that a
package was published.

## 3. Campaign identity, evidence currency, and immutable inputs

### 3.1 Prepared release manifest

Before any triggered provider turn, `release-manifest.json` is canonicalized and its
SHA-256 becomes `qualification_id`. The closed schema binds:

- repository slug, exact candidate commit, clean-tree assertion, package name and
  version;
- `npm pack` filename, SHA-256, SHA-512 integrity, and canonical packed-file manifest;
- source/package subject digest and dependency-lock digest;
- Node, pnpm, TypeScript, Vitest, provider SDK/CLI versions and platform;
- `validation-policy.yaml` digest and the release-contract version;
- all prompt, `roles.yaml`, `pipelines.yaml`, and `TASTE.md` digests;
- every exact role/call-site `(runtime, model, effort)` assignment;
- every required L3/L5 campaign ID, kind, trigger, app/scope/tuple/case inventory,
  decision status, and its authorized provider-turn/equivalent-USD ceiling;
- every golden-set path/digest, reference status, rubric version, judge tuple, and
  candidate/baseline tuple;
- exact required case/attempt identities for every lane;
- L3/L4/L5 ceiling envelopes and typed retry policies;
- current threat-model status/artifact digest and reusable L5 baseline IDs;
- human campaign authorization identity, time, purpose, and approval reference; and
- evidence-output namespace `release-evidence/<version>/<qualification_id>/`.

The manifest is written before execution and is immutable thereafter. A field change
mints a different qualification ID. Unknown fields, missing tracked inputs, duplicate
case identities, mutable model aliases without recorded provider resolution, or an
untracked policy/golden input refuse before spend.

### 3.2 Evidence subject versus evidence producer

Each retained lane/case record carries two digests:

- `subject_digest`: the exact product, prompt, assignment, policy, target, and fixture
  inputs the claim is about;
- `producer_digest`: the exact runner, detector, grader, config, and tool versions that
  produced the evidence.

Evidence is current only when its subject digest recomputes identically for the
release candidate. Producer drift never disappears: if the producer changed after the
run, the evidence packet must contain an exact `evidence_change_disposition` of either
`unaffected` or `invalidated`. `unaffected` requires a detector-proven evaluator-only
defect, an exact diff/hash inventory, and human approval. Product or policy drift can
never receive `unaffected`.

This is the proportionate-release rule: an evaluator repair does not force unrelated
real adapters to run again, but retained evidence is never silently reused by
resemblance.

### 3.3 Release-candidate equivalence

The prepared candidate commit may gain only sanitized evidence under
`release-evidence/<version>/<qualification_id>/`. The tag commit must descend from the
prepared commit and the verifier requires:

- identical package version, packed-file list, tarball SHA-256/SHA-512, package
  subject digest, lockfile, prompts, roles, pipelines, policy, golden sets, and
  assignments;
- no deleted or modified prepared evidence;
- every added evidence file content-bound by the attestation; and
- no changed path outside that one evidence namespace.

Any other descendant change is a different release candidate. There is no force,
ignore, stale-evidence, or broad allowlist flag.

## 4. Deterministic-first admission

No L3/L4/L5 provider campaign can compensate for a red deterministic contract. Before
triggered evidence is admitted, the candidate must record:

- `pnpm test` with an exact machine-readable test inventory; any skip not explicitly
  bound to a current policy finding fails;
- `pnpm typecheck`;
- `pnpm build`;
- `git diff --check`;
- the pinned fail-closed gitleaks job and canary;
- `pnpm smoke:onboarding`;
- `npm pack --dry-run` plus an actual local pack/install/command smoke in a disposable
  directory; and
- current Core checks on the exact candidate SHA.

The release workflow reruns the offline gates on the tag commit. Missing, cancelled,
neutral, stale-SHA, or unavailable checks are incomplete, never green.

Every new release-gate detector family must include a seeded negative control. At
minimum the implementation must seed: forged incomplete pass, stale subject digest,
changed packed bytes, changed prompt/assignment, unlisted skip, missing CI result,
unvalidated reference represented as validated, uncalibrated judge admission,
content-hash dedupe across different rubric/context, evidence-only path escape,
tampered attestation, and a publish invocation without a current attestation.

## 5. L3 live-seam requirements

The existing release campaign remains the source of truth for real seams:

- `CF-B02-L3`, `CF-B03-L3`, and `CF-B04-L3` for all three supported adapters;
- `CF-B01-L3` against the exact disposable GitHub sandbox;
- `CF-J18-A` under `cormidia/unattended-sandbox/v1`, with zero human decision rows;
- `CF-J16-A` when scheduler definition/identity/loading or material host/macOS change
  triggers it.

The ratified release ceiling remains 24 provider turns and $100 equivalent cost.
Each attempt reserves worst-case spend before starting; unknown partial use debits the
reservation. Ceiling exhaustion means incomplete/inconclusive and blocks
qualification.

`B-17-L3` remains honestly blocked because no disposable real non-GitHub target exists.
For pre-V1 package qualification it is a named evaluator-evidence debt row, never a
pass and never evidence that the real target works. It may be accepted only when B-17
product bytes and its release mechanism are unchanged, all B-17 L1/L2 cases pass, and
the human release disposition explicitly accepts the limitation. A B-17 implementation
or release-mechanism change invalidates that disposition and blocks until a disposable
target exists or a newly ratified policy says otherwise.

## 6. L4 release scope: paired evidence, not absolute thresholds

### 6.1 Current required sites

The bootstrap release campaign collects the complete committed corpora for:

- S-3 Reviewer (6 cases);
- S-1 Planner (10 cases); and
- S-10 Validation Designer (4 cases).

This is exactly the populated current scope. Empty scaffolds are disclosed as
unqualified/deferred and provide no quality claim. Builder trajectory stays in L1/L2;
it is not duplicated as an L4 rubric. S-8 is not release-relevant until comparative
execution exists.

After a baseline qualifies, later releases rerun only sites whose subject digest
changed. A model/prompt/instruction/rubric/judge/tool-schema/orchestration change
invalidates its affected site. Unchanged evidence may be reused only through §3.

### 6.2 Bootstrap and later comparison

`0.1.1` is not a qualified baseline; its exception is explicitly not evidence. The
first replacement campaign is therefore a **bootstrap qualification**:

- it runs the candidate tuple(s) against human-validated references;
- no incumbent-relative improvement is claimed;
- all quality conclusions require human disposition; and
- if qualified, its exact per-site assignment results become the current qualified
  baseline.

Every later changed-assignment campaign runs candidate and currently qualified
baseline over the same case/attempt manifest. It reports paired per-case outcomes and
never substitutes an absolute percentage for the comparison. A site can qualify while
another remains unchanged or inconclusive; results are never pooled across sites.

No new repetition count is invented. Completeness is the exact case × tuple × attempt
set declared in the human-authorized manifest. The current one-observation runner may
collect data, but no individual stochastic miss becomes an automatic release veto.
Any future N, confidence rule, threshold, or aggregation rule requires a separate
human-ratified policy edit.

### 6.3 Trajectory treatment

Trajectory does not enter the qualitative judge's prompt. It remains an independently
verifiable downstream evidence channel:

- ratified budgets, permission/tool constraints, legal terminals, anomaly detectors,
  escalation, exact-session recovery, and paid-work preservation are deterministic
  eligibility gates;
- tool counts, read/write shape, retries, active time, tokens, and environment churn
  are paired observations in the human review packet;
- no lower-is-better rule or thrash threshold is inferred; and
- different harness fingerprints are reported, not exposed to a supposedly blinded
  artifact judge.

This lets a human see a 5-call versus 60-call difference without pretending that fewer
calls are automatically better.

## 7. Human references, judge calibration, and per-pairing rules

### 7.1 Human reference review

An agent may prepare a case and rationale; the checked-in author remains the actual
agent. A human may validate the reference without becoming its author. Admission
requires an attributable `validated_by`, date, source commit, and exact case digest.

Current references require the following human confirmations. These are expected
behaviors, not numeric thresholds:

| Cases | Expected behavior for human validation |
| --- | --- |
| `GS-REV-CORRECTNESS-001` | Reject the four-attempt off-by-one. |
| `GS-REV-SECURITY-001` | Reject unconditional shell permission bypass. |
| `GS-REV-EVIDENCE-001` | Reject a green claim with cancelled/missing evidence. |
| `GS-REV-CONTRACT-001` | Reject guessed `main` and name wrong-tree risk. |
| `GS-REV-SECRET-001` | Reject secret/L3 export and require deterministic containment. |
| `GS-REV-CLEAN-001` | Approve the scoped display-only change; do not invent a defect. |
| `GS-PLAN-*` (10 rows) | Apply the existing per-row anchors: complete accounting, stable authority, correct dependencies/routing, proportionality, and no invented readiness. |
| `GS-VAL-*` (4 rows) | Apply the existing per-row anchors: existing IDs, cheapest layer, detector plus negative control, and structural-revision routing. |

Validation changes only provenance state; it does not rewrite prompts, labels, or
anchors. If the human disagrees with any row, that row stays pending and the exact
expected behavior is revised through a separate reviewed golden-set diff.

### 7.2 Judge admission

Any model judge used by release qualification is a distinct call site and is
inadmissible until all of these exist:

- a committed human-validated must-catch set and comparable clean/tie controls;
- exact judge prompt/model/effort/rubric identity;
- blinded irrelevant provider/candidate identity;
- per-case human label and rationale;
- reported false negatives, false positives, abstentions, order reversals, and
  evidence-citation failures; and
- human-ratified sample design, decision rule, and admissibility policy.

No score threshold is proposed here. Until a later ratification supplies one, judge
output is advisory; the human reviews candidate/baseline disagreements directly.

Low calibration never authorizes lowering the bar or softening cases. The response is:
inspect disagreements; distinguish judge miss, ambiguous rubric/anchor, invalid human
reference, or insufficient evidence; propose an exact rubric/reference correction;
preserve old results; then run a newly identified campaign. A better draw is not a
retry.

### 7.3 Pairing identity

Reports remain separate by exact `(producing operation, producer tuple, evaluator or
judge tuple, rubric version)`. Reviewer cases built from synthetic snippets use
`producer=fixture`; they must not be mislabeled as evidence for a Builder/Reviewer
pairing. Real Builder artifacts carry the exact Builder tuple. Different severity,
operation families, sites, or pairings are never pooled to conceal a regression.

## 8. Duplicate-output reuse

The runner hashes normalized output bytes together with the exact case input,
context/prompt, rubric, reference, and grader identity. When two observations have the
same composite key, execution coverage remains two observations but grading/judging is
performed once and the second row records `grade_reused_from`.

Artifact-byte equality alone is insufficient across different prompts, rubrics,
contexts, or graders. Dedupe cannot hide provider turns already spent, alter sampling,
or convert a missing candidate execution into coverage.

## 9. L5 qualification baseline

Gate activation requires:

- a genuinely human-authored and separately human-reviewed threat model covering
  TM-01…TM-10, hash-bound by `threat-model-status.yaml`;
- the HB-073 abuse cases derived by that human threat model, each placed at the cheapest
  falsifying layer with seeded negative controls; and
- one complete/pass seven-calendar-day sandbox soak including CF-OPS-SOAK and the
  natural CF-OPS-ROT evidence.

The existing L5 ceiling remains 24 provider turns and $15 equivalent cost. Missing
natural rotation, sleep cycles, source health, settlement, or other required evidence
is incomplete/inconclusive.

L5 evidence is reusable across releases only while its trigger fingerprint is current.
Material changes to a trust boundary, deployment shape, adapter capability, externally
reachable surface, scheduler, locking, settlement, retention, roadmap/batching
concurrency, or session reuse invalidate the affected threat/soak evidence exactly as
specified in `risk-allocation.md` §6.

## 10. Completeness, verdicts, retry, cost, and evaluator debt

### 10.1 Truth table

| Condition | Completeness | Verdict | Qualification |
| --- | --- | --- | --- |
| Proven mandatory product/control violation | complete or incomplete | fail | not_qualified |
| Missing/corrupt/stale/unrun/ceiling-stopped obligation, no proven violation | incomplete | inconclusive | needs_human_disposition |
| Complete lane with proposed/unratified decision rule | complete | inconclusive | needs_human_disposition or predeclared eval debt |
| All blocking claims pass; all non-pass evaluator debt explicitly accepted | complete | pass at aggregate only | qualified |
| All blocking claims pass; no debt | complete | pass | qualified |

The underlying inconclusive/fail evidence is immutable in every row.

### 10.2 Retry rules

- Merit failures and quality disagreements are terminal; never retry for a better draw.
- GitHub reads and exact-input idempotent mutations retain the ratified three total
  attempts with jittered exponential backoff.
- Effect-ambiguous writes remain single-shot followed by marker/readback reconciliation;
  never blind retry.
- A provider retry is allowed only for the exact typed infrastructure class
  predeclared in the campaign authorization. It is a distinct attempt/provider turn,
  both attempts remain evidence, and all spend is settled.
- Unknown partial provider use debits the full reservation.
- Campaign/case ceilings are hard; a retry cannot widen them.
- A terminal campaign is never reopened or overwritten. Repair creates a new campaign
  linked to the failed one.

### 10.3 Cost ceilings

- L3 pre-merge changed adapter: 2 turns / $5.
- L3 release: 24 turns / $100.
- L5 soak: 24 turns / $15.
- L4 has no ratified global numeric ceiling. The exact token, provider-turn, and
  equivalent-USD ceilings must therefore be supplied and human-authorized in each
  immutable campaign manifest. This proposal does not invent one.

### 10.4 Evaluator debt admission

Evaluator debt is eligible only when predeclared or classified by an exact human
disposition that names the failed evidence, candidate, consequence, owner, and
invalidation trigger. It cannot cover a product/safety/accounting/learning/build/CI/
budget violation, a missing human threat model, a changed subject digest, or a proven
guardrail failure. Debt acceptance authorizes qualification review, not publication;
the separate release approval remains mandatory.

## 11. Attestation and sanitized evidence packet

The packet under `release-evidence/<version>/<qualification_id>/` contains only:

- prepared release manifest and digest;
- aggregate qualification report;
- one immutable index of lane/case reports and hashes;
- offline/CI command results and immutable run links;
- sanitized L3/L4/L5 summaries, not raw prompts, outputs, secrets, credentials, org
  state, or provider session logs;
- human reference/judge/threat-model status references and digests;
- evaluator-debt and evidence-change dispositions;
- package/tarball/file manifests; and
- every input needed to derive the post-merge release attestation, but not the
  attestation or approval themselves.

After the evidence-only descendant exists, Cormidia derives the canonical attestation
from that immutable commit and stores it in the durable release handoff; the annotated
tag embeds it together with the later human approval. It cannot be committed inside
the descendant it names: doing so would make the commit hash depend on a document that
already contains that hash. This self-reference break changes no human decision or
admissibility rule—the attestation still binds the prepared and tag commits,
qualification ID, package/version,
tarball hashes, every packet file/hash, blocking/debt results, human qualification
disposition, and the exact release-approval prerequisite. It is canonical JSON and is
content-bound by the later human release approval. Tamper, missing bytes, unknown
fields, path escape, or stale currency refuses.

## 12. Merge and release enforcement

### 12.1 Merge

F-PT-018 remains open: current GitHub APIs confirm that branch protection/rulesets are
unavailable on the private-repository plan. Core checks are internally fail-closed but
not mechanically merge-blocking. This proposal does not pretend otherwise and does
not invent a plan upgrade or a replacement branch-policy decision.

Until F-PT-018 is separately resolved, the protected-surface PR remains human-merge
only and the evidence packet records exact green check runs on the merged SHA. The
release verifier does not trust the fact that a PR merged; it reruns deterministic
gates on the tag candidate.

### 12.2 Supported release path

The exact supported path is:

1. candidate/version merged with no tag or publication;
2. qualification and sanitized evidence packet prepared;
3. evidence-only descendant passes release-currency verification;
4. human reviews the packet and separately approves the exact package tag/publication
   action bound to the attestation digest;
5. Cormidia's B-17 release handoff pushes the approved tag at most once;
6. the tag workflow reruns offline gates and `release:verify`, then may execute
   `npm publish` only when the exact release approval is present; and
7. publication acknowledgement is recorded separately from approval/acceptance.

Implementation adds defense in depth at three ordinary surfaces:

- `pnpm release:verify` — offline currency/attestation verifier;
- `prepublishOnly` — refuses `npm publish` without a current attestation; and
- `.github/workflows/release.yml` — exact-tag verifier and supported publisher.

An npm owner can deliberately bypass local scripts or repository workflows; the gate
controls Cormidia's supported durable release path and makes bypass visible, not
physically impossible for the human registry owner.

## 13. Migration, activation, and rollback

### 13.1 Migration

1. Ratify this proposal; no gate changes yet.
2. Implement release manifest/currency/attestation schemas, aggregators, deterministic
   detectors, packet sanitizer, operator commands, and release workflow while policy
   still says suspended.
3. Human validates the selected golden references with attributable metadata.
4. Human authors the threat model; a separate human reviews it; implement HB-073 cases.
5. Run only offline checks in this implementation session. Do not run L3/L4/L5 paid or
   real-time campaigns and do not publish.
6. Land implementation plus the approved protected surfaces through a human-merge PR.
7. In a later separately authorized campaign, collect the initial L3/L4/L5 evidence.
8. Complete the required seven-day L5 soak, including natural credential rotation,
   in that separately authorized campaign.
9. Generate the first qualifying packet and derive its post-merge attestation. Only
   then may an exact release approval be requested.

No old campaign is promoted, rescored, or overwritten. `0.1.1` remains an exception,
not baseline evidence. Existing state-home campaign reports remain readable.

### 13.2 Rollback

- Disable the release workflow and remove the release declaration; publishing becomes
  unavailable, not ungated.
- Revert the release verifier/attestor and packet reader without deleting retained
  evidence.
- Set policy/docs back to `SUSPENDED`; no qualifying attestation remains current.
- Never fall back to the archived gate or import its executable assumptions.
- Existing L1/L2, L3/L4/L5 collectors, golden sets, and campaign report semantics stay
  intact.

### 13.3 Human-authorship boundaries still open

This proposal intentionally cannot fill these fields:

- threat-model author, reviewer, threats, residual-risk conclusions, dispositions, and
  abuse-case IDs;
- judge threshold, sample size, aggregation, and admissibility rule;
- a merge-enforcement alternative for F-PT-018; or
- an L4 global numeric ceiling.

Those are not implementation details. They remain human-attributable decisions.

## 14. Exact protected and binding surface proposal

### 14.1 Determination

| Surface | Change? | Reason |
| --- | --- | --- |
| `docs/PURPOSE.md` | Yes, after ratification | Record the release-evidence decision; protected human decision log. |
| root `AGENTS.md` | Yes, after activation | Stop saying release gating is suspended and route agents to RQ-1; binding text. |
| `.cormidia/config.yaml` | Yes | Declare the package tag release mechanism; checkout marks it human-ratified. |
| `validation-design/validation-policy.yaml` | Yes | Register RQ-1, activation requirements, evidence/debt/currency semantics, and cases. |
| `validation-design/llm-eval-plan.md` | Yes | Replace the owed §5 with the exact paired/bootstrap behavior; close #248 design review. |
| `validation-design/case-catalog.md` | Yes | Add release/currency/attestation/judge-admission detector families. |
| `validation-design/harness-backlog.md` | Yes | Add implementation tickets and human dependencies. |
| `docs/qualification/design.md`, `docs/DEVELOPMENT.md`, `README.md` | Yes | Publish the new operator/developer contract and remove false suspended-state text only after activation. |
| golden `cases.json` files | Metadata only after human review | Keep agent authorship; add attributable human validation without changing cases/anchors. |
| `TASTE.md`, `roles.yaml`, `pipelines.yaml`, `prompts/**` | No | No preference, assignment, pipeline, or prompt change is needed to build the release assessor. |

### 14.2 Exact `docs/PURPOSE.md` proposed diff

```diff
diff --git a/docs/PURPOSE.md b/docs/PURPOSE.md
--- a/docs/PURPOSE.md
+++ b/docs/PURPOSE.md
@@
+- **Replacement release-evidence gate** (ratified 2026-08-04). Release
+  qualification is restored through RQ-1: deterministic contracts admit the
+  exact candidate before spend; bounded L3/L4/L5 evidence remains separate by
+  completeness and verdict; candidate/baseline quality evidence is paired per
+  site and exact producer/evaluator tuple; uncalibrated judge scores remain
+  advisory; evaluator debt can be accepted only as a separate immutable human
+  disposition and never rewrites failed or inconclusive evidence. One canonical
+  manifest binds commit, package bytes, policy, prompts, assignments, golden
+  references, tools and ceilings. A deterministic attestation admits only a
+  content-bound evidence-only descendant whose package and qualification inputs
+  are identical. The supported tag/npm path verifies that attestation and still
+  requires a separate exact human release approval. F-PT-018 remains an honest
+  merge-enforcement limitation; release verification reruns the mandatory gates
+  on the tag candidate. The gate cannot activate until the human-authored and
+  human-reviewed TM-01…TM-10 threat model and its abuse-case detectors exist.
@@
+- 2026-08-04 — v2.16: RQ-1 replacement release qualification ratified. The
+  0.1.1 exception remains non-evidence; the first replacement campaign is a
+  bootstrap baseline. Absolute F-PT-009/010/011 hypotheses are not adopted.
+  L4 uses paired evidence and human disposition until separately ratified judge
+  calibration exists; deterministic trajectory remains outside the artifact
+  judge. Release currency, attestation, evaluator-debt disclosure, exact package
+  equivalence, and the supported human-approved tag/npm enforcement path are
+  binding as described in validation-design/release-evidence-gate-revision-proposal.md.
```

The first hunk belongs in `## Decided`, immediately after the proportionate release
evidence decision. The history hunk belongs after v2.15. No existing decided text is
deleted.

### 14.3 Exact root `AGENTS.md` proposed diff

This applies only after implementation, human threat/reference work, and the activation
PR are ready:

```diff
diff --git a/AGENTS.md b/AGENTS.md
--- a/AGENTS.md
+++ b/AGENTS.md
@@
-The minimum for any change is `pnpm test && pnpm typecheck`; this is a populated
-offline gate, not green-by-absence. Release gating is **suspended**: the
-fail-closed release-currency lane and attestation were archived with `eval/`;
-do not tag a release expecting a gate to catch anything. Replacement L3/L4/L5
-runners are explicit human-authorized campaigns; their unrun/missing work remains
-incomplete/inconclusive and they must never be invoked casually.
+The minimum for any change is `pnpm test && pnpm typecheck`; this is a populated
+offline gate, not green-by-absence. Release qualification is governed by RQ-1 in
+`validation-design/release-evidence-gate-revision-proposal.md` as ratified into
+`validation-policy.yaml` and `docs/qualification/design.md`. Never tag or publish
+without a current content-bound release attestation and separate exact human release
+approval. L3/L4/L5 runners remain explicit human-authorized campaigns; unrun,
+missing, stale, corrupt, or ceiling-stopped work is incomplete/inconclusive and must
+never be invoked casually or rendered green.
```

### 14.4 Exact `.cormidia/config.yaml` proposed diff

```diff
diff --git a/.cormidia/config.yaml b/.cormidia/config.yaml
--- a/.cormidia/config.yaml
+++ b/.cormidia/config.yaml
@@
   Cormidia:
     repo: cormidia/Cormidia
     status: live
     budget_usd_month: 1000
+    release:
+      kind: package
+      owner: orchestrator
+      trigger: tag
     cadence: {}
```

The tag push is the approved B-17 action. The tag workflow owns verification and npm
publication; approval, tag acceptance, npm publication, and acknowledgement remain
separate facts.

### 14.5 Exact binding validation-design proposal

The following semantic patch is exact; implementation may not weaken it:

```diff
diff --git a/validation-design/validation-policy.yaml b/validation-design/validation-policy.yaml
--- a/validation-design/validation-policy.yaml
+++ b/validation-design/validation-policy.yaml
@@
-release_gating: "SUSPENDED — replacement required; no surface may imply release evidence exists"
+release_gating:
+  status: activation_pending_human_threat_model_and_evidence
+  contract_id: RQ-1
+  proposal: release-evidence-gate-revision-proposal.md
+  qualification_values: [qualified, not_qualified, needs_human_disposition]
+  activation_requires:
+    - human_ratification_of_exact_protected_diff
+    - human_authored_and_human_reviewed_TM-01_through_TM-10
+    - HB-073_abuse_cases_with_seeded_negative_controls
+    - implementation_audit_green
+  rules:
+    - deterministic_first
+    - immutable_pre_spend_manifest
+    - subject_and_producer_currency
+    - paired_site_and_exact_pairing_evidence
+    - uncalibrated_judge_advisory_only
+    - evidence_only_descendant_equivalence
+    - separate_human_eval_debt_disposition
+    - separate_exact_human_release_approval
+    - no_green_by_absence
+  release_candidate_equivalence:
+    allowed_changed_path: "release-evidence/<version>/<qualification_id>/**"
+    require_identical: [package_version, packed_file_manifest, tarball_sha256,
+      tarball_sha512, package_subject, dependency_lock, prompts, roles, pipelines,
+      policy, golden_sets, assignments]
+  current_l4_release_sites: [reviewer, planner, validation-designer]
+  l4_numeric_ceiling: "per immutable human authorization; no global value ratified"
+  b17_live_status: "BLOCKED; disclosed pre-V1 evaluator debt only under RQ-1 §5"
+  merge_enforcement: "BLOCKED:F-PT-018; release workflow reruns exact-tag gates"
```

```diff
diff --git a/validation-design/llm-eval-plan.md b/validation-design/llm-eval-plan.md
--- a/validation-design/llm-eval-plan.md
+++ b/validation-design/llm-eval-plan.md
@@
-## 5. Release-qualification replacement (design owed; gating currently SUSPENDED)
+## 5. Release qualification — RQ-1
+
+The exact contract is `release-evidence-gate-revision-proposal.md` §§2–13.
+The current bootstrap scope is the complete committed Reviewer, Planner and
+Validation Designer corpora. `0.1.1` is not a baseline. The first qualified
+campaign establishes one; later assignment changes use paired candidate/baseline
+evidence over the same immutable manifest. Absolute F-PT-009/010/011 hypotheses
+remain unratified and are not release rules. Deterministic trajectory gates admit
+candidates before qualitative review; observed trajectory differences remain a
+separate human-review channel and do not enter the blinded artifact judge. Judge
+scores are inadmissible until human references, sample design, thresholds and
+aggregation are separately ratified. Complete but threshold-inconclusive evidence
+may become disclosed evaluator debt only through a separate content-bound human
+disposition; the underlying verdict never changes.
```

```diff
diff --git a/validation-design/case-catalog.md b/validation-design/case-catalog.md
--- a/validation-design/case-catalog.md
+++ b/validation-design/case-catalog.md
@@
 | CF-HARNESS-CI | Per-commit workflow shape, fail-closed jobs, detector canaries, and actual merge-blocking enforcement. Workflow-shape checks are implemented; required-check enforcement is **BLOCKED:F-PT-018**. | 1 + CI | evid+det | FLOOR |
+| CF-HARNESS-RQ | RQ-1 manifest, deterministic-first admission, aggregate completeness/verdict/qualification truth table, debt disposition, exact site/pairing scope | 1/2 | evid+refusal+det | E3/FLOOR |
+| CF-HARNESS-CURRENCY | subject/producer digests, evidence-only descendant, identical package/policy/prompt/assignment/golden inputs, invalidation triggers | 1/2 | diff+evid+refusal+det | E3/FLOOR |
+| CF-HARNESS-ATTEST | canonical packet/attestation, path containment, packet hashes, exact release approval binding, tamper and missing-field refusal | 1/2 | evid+refusal+det | E1/E3/FLOOR |
+| CF-HARNESS-JUDGE | pending-reference refusal, uncalibrated-score refusal, exact pairing identity, composite-hash grade reuse, low-calibration triage without threshold/corpus weakening | 1/2 | stat-envelope+refusal+det | E3/L4Q |
+| CF-HARNESS-RELEASE | exact-tag offline rerun, current attestation, prepublish refusal, approval→tag→publish→ack separation; merge enforcement remains BLOCKED:F-PT-018 | 1/2 + CI | evid+refusal+det | E1/E3/FLOOR |
```

`harness-backlog.md` gains, in order: HB-113 manifest/currency/attestation schemas;
HB-114 deterministic detector families; HB-115 paired L4 and human packet; HB-116
packet sanitizer/operator surfaces; HB-117 release workflow/prepublish/B-17 tag path;
HB-118 audit/holdout; HB-072-human and HB-073 remain prerequisites for activation.
Each ticket is L1/L2 except separately authorized evidence collection.

### 14.6 Exact golden-set metadata proposal

No golden case byte changes under design ratification alone. After the human explicitly
confirms §7.1, the only proposed change to each confirmed row is:

```diff
-    "provenance": { ..., "human_validation": "pending" }
+    "provenance": { ..., "human_validation": "validated", "validated_by": "bikramgupta" }
```

This applies only to individually confirmed rows in Reviewer, Planner, and Validation
Designer. The agent `author` field remains unchanged. A disagreed row receives no
mechanical update.

### 14.7 Activation wording in README/developer/qualification docs

After the activation prerequisites are actually satisfied, replace each statement
that release gating is suspended with:

> Release qualification is active under RQ-1. A version is not qualified merely
> because L1/L2 or a triggered lane is green: the exact candidate requires a current
> aggregate attestation, and npm publication still requires a separate exact human
> approval. Missing, stale, corrupt, ceiling-stopped, uncalibrated, or undispositioned
> evidence is not a pass.

Before that activation point those documents remain unchanged and truthful.

## 15. Ratification boundary

Ratification of this proposal means:

- approve RQ-1 §§2–13 as the implementation contract;
- approve the exact protected/binding diffs in §14, except activation-only wording
  remains unapplied until its named prerequisites exist;
- confirm the §7.1 expected behaviors for the golden rows, or name only the rows whose
  expected behavior differs;
- authorize ordinary non-protected implementation, offline detectors, CI/operator
  surfaces, and sanitized evidence-packet tooling; and
- preserve separate human authorship/review for the threat model and separate exact
  approval for any future paid campaign, tag, or publication.

No paid campaign, live/soak run, tag, npm publication, deployment, scheduler
installation, or release action is authorized by ratifying this document.
