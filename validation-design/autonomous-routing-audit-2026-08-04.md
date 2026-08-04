# Backlog-wide autonomous-routing audit — 2026-08-04

Snapshot: all 55 open issues in `cormidia/Cormidia`, read from GitHub after
fetching `origin/main` at `cc491f6adbce464923af833bccac742dc082691c`.

This is a scheduling audit, not a claim that every otherwise eligible issue is
Builder-ready. “Eligible” means neither durable human exclusion applies and the
issue can remain in Planner's ordinary intake; Planner must still validate
scope, dependencies, acceptance, validation authority, and current label state
before publishing `op:ready`.

## Result

- **Eligible for ordinary Planner intake (33):** #124, #136, #143, #146, #148,
  #149, #150, #152, #153, #154, #156, #157, #168, #181, #184, #189, #190,
  #191, #192, #195, #198, #207, #208, #210, #212, #213, #227, #230, #232,
  #233, #234, #237, #238.
- **Human-held by exact `manual-review` (11):** #164, #165, #166, #185, #187,
  #188, #196, #197, #224, #248, #264.
- **Technically excluded by `routing:human-only` (7):** #20, #133, #134, #193,
  #218, #236, #243. These change a gate/approval/review-identity mechanism whose
  decisive verification routes through that mechanism, or are already recorded
  as such under `docs/DEVELOPMENT.md`'s self-judging rule.
- **Blocked (1):** #20 is additionally `blocked:upstream`; it remains technically
  excluded and cannot enter autonomous scheduling.
- **Ambiguous, left unlabelled for human/Planner disposition (4):** #145, #151,
  #186, #257. Each is a concept or owner question without a sufficiently fixed
  delegated outcome. The audit did not guess a product decision or turn an
  ambiguity into a routing label.

The category counts cover 55 unique issues; #20 is the one intentional overlap
between “technically excluded” and “blocked.”

## Issue-by-issue disposition

| Issue | Primary disposition | Evidence/basis |
|---:|---|---|
| #20 | blocked | Existing `blocked:upstream` and `routing:human-only`; real App Server read-bypass proof depends on upstream/live behavior. |
| #124 | eligible | Concrete test-support defect; deterministic fake-Git/default-branch detector. |
| #133 | technically excluded | Changes `protocol-self-edit` coverage and would otherwise use that same gate to judge itself. |
| #134 | technically excluded | Changes the gate that is supposed to prevent memory-context injection; same-mechanism verification. |
| #136 | eligible | Concrete narrative scheduling/projection work with offline seams. |
| #143 | eligible | Concrete org-init scaffold defect with filesystem assertions. |
| #145 | ambiguous | Governed taste compilation is a product direction without a fixed activation/authority decision. |
| #146 | eligible | Concrete duplicate learning-evidence projection defect. |
| #148 | eligible | Concrete disposable-clone durability defect. |
| #149 | eligible | Agreed learning-funnel umbrella; ordinary Planner decomposition remains possible. |
| #150 | eligible | Concrete missing promotion verb under #149. |
| #151 | ambiguous | Body explicitly records unresolved authorship/ownership as the decision. |
| #152 | eligible | Concrete candidate-vs-ticket dedupe defect under #149. |
| #153 | eligible | Agreed configuration-architecture umbrella. |
| #154 | eligible | Concrete app-resolved ceiling/bounds work; completed by the accompanying implementation. |
| #156 | eligible | Concrete configurable evidence-threshold work. |
| #157 | eligible | Concrete configurable retention-policy work. |
| #164 | human-held | Existing exact `manual-review` preserved. |
| #165 | human-held | Existing exact `manual-review` preserved. |
| #166 | human-held | Existing exact `manual-review` preserved. |
| #168 | eligible | Promotion/deploy-trigger separation can be falsified at deterministic command/workflow seams; no live deployment is required. |
| #181 | eligible | Concrete app permission-resolution work; completed by the accompanying implementation without live provider use. |
| #184 | eligible | Accepted architecture direction exists; remaining protected changes retain their separate human boundary. |
| #185 | human-held | Existing exact `manual-review` preserved. |
| #186 | ambiguous | Explorer concept has no accepted scope or completion contract. |
| #187 | human-held | Existing exact `manual-review` preserved. |
| #188 | human-held | Existing exact `manual-review` preserved. |
| #189 | eligible | Concrete child of the human-held capability-pack epic; ordinary design/implementation can be planned independently. |
| #190 | eligible | Concrete role tool-pack binding child. |
| #191 | eligible | Concrete secret-reference/injection child; approvals remain hard boundaries. |
| #192 | eligible | Concrete cross-adapter parity child, dependency-gated by pack schemas. |
| #193 | technically excluded | Changes Reviewer/merge identity authority and would otherwise rely on that review/merge mechanism to attest itself. |
| #195 | eligible | Concrete supported systemd user-timer backend outcome. |
| #196 | human-held | `manual-feelview` body explicitly asks for product-truth ratification; exact `manual-review` added. |
| #197 | human-held | `manual-feelview` body explicitly asks for product/architecture ratification; exact `manual-review` added. |
| #198 | eligible | Concrete Pi symlink-confinement defect with deterministic detector. |
| #207 | eligible | Concrete planner timeout/evidence defect. |
| #208 | eligible | Concrete claim diagnostic defect. |
| #210 | eligible | Concrete narrative terminal-outcome projection defect. |
| #212 | eligible | Concrete cross-surface cost-integrity disagreement. |
| #213 | eligible | Concrete token-free loop preview surface. |
| #218 | technically excluded | Existing `routing:human-only`; changes the secret-read gate false-negative it must verify. |
| #224 | human-held | Existing exact `manual-review` preserved. |
| #227 | eligible | Scheduler-hardening epic may stay in Planner intake; scheduler installation/live qualification remain separately human-authorized. |
| #230 | eligible | Deterministic Planner intake is merged; disposable real-GitHub qualification remains separately controlled. |
| #232 | eligible | Concrete atomic publication/recovery contract; GitHub effects remain gated. |
| #233 | eligible | Accepted roadmap design and deterministic machinery exist; outstanding evidence does not create autonomous external authorization. |
| #234 | eligible | Accepted validation lifecycle exists; protected prompt/pipeline and external evidence keep their separate boundaries. |
| #236 | technically excluded | Approval/safety-gate epic changes the critical classifier/approval lifecycle used to judge it. |
| #237 | eligible | Governed learning-funnel epic has an accepted outcome and decomposable children. |
| #238 | eligible | Org/app configuration epic has an accepted resolution principle and concrete children. |
| #243 | technically excluded | Existing `routing:human-only`; changes the gate's own enforcement-code coverage. |
| #248 | human-held | Existing exact `manual-review` preserved. |
| #257 | ambiguous | Body contains unresolved owner questions about config/state lifecycle and tracking. |
| #264 | human-held | Existing exact `manual-review` preserved; dependency design remains human-held until explicitly rerouted. |

## Label actions

No label was removed.

- Added `routing:human-only`: #133, #134, #193, #236.
- Added exact `manual-review`: #196, #197.
- Preserved every pre-existing `manual-review`: #164, #165, #166, #185, #187,
  #188, #224, #248, #264.
- Preserved `manual-feelview` on #196/#197. It was not treated as a wildcard or
  as scheduling authority; the two `manual-review` decisions were made from the
  individual issue bodies.

## Fail-closed verification

Planner and Builder both re-read current label state and fail closed when it is
unreadable:

- Planner: `src/org/planner-intake.ts` returns
  `routing_state_unreadable` and refuses/retracts `op:ready`.
- Builder: `src/loop/loop.ts` returns
  `autonomous_routing_state_unreadable`; `src/loop/driver.ts` maps fresh-read
  failures to `routing_label_unreadable` before claim/provider work.
- Deterministic proof:
  `tests/hermetic/cf-reg-239/cf-reg-239-routing-exclusion.test.ts` covers both
  roles, late label changes, exact `manual-review`, the non-wildcard
  `manual-feelview` control, and an eligible seeded negative control.

Focused command run on this branch:

```text
pnpm vitest run tests/hermetic/cf-reg-181-154/app-execution-policy.test.ts \
  tests/unit/cf-reg-181/provider-permission-arguments.test.ts \
  tests/hermetic/cf-reg-239/ tests/hermetic/cf-hb102/

4 files passed; 29 tests passed.
```

## Stale comment repair

Five comments that still stated the pre-PR-249 ratification/implementation state
were edited in place, retaining their historical PR #235 facts and appending the
current evidence:

- #184 comment `5164062344`
- #227 comment `5168559091`
- #233 comment `5168559078`
- #234 comments `5168559074` and `5170060892`

The updates name PR #249's accepted/merged harness revision and the later
HB-100…110 implementation, while preserving the remaining human corpus,
external-evidence, HB-111 protected-surface, live, and scheduler boundaries.
