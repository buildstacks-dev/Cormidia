# System Map

Assessment: `20260804T164335Z-abe087e950dc`
Candidate: `origin/main@abe087e950dc + working-tree a44d5084da0146f41ca5999c86e3c29e95efb1d4`

## Intended use

The assessed path lets a scheduled Planner read the complete bounded open
backlog, perform one governed provider turn in an org-managed isolated
worktree, and publish every declared deterministic effect before the workflow
reports completion. It serves registered private app repositories. It does not
authorize releases, deployment, public publication, live qualification, or
protected-surface changes.

## Architecture and data flow

1. `dispatchTick` resolves the registered app and exact remote-default base,
   then `createPlannerTurnWorktree` creates or resumes a deterministic detached
   worktree under the state home.
2. `preparePlannerIssueIntake` reads up to 10,001 open issues, refuses the
   completeness boundary, and projects at most 100/64 KiB into provider input.
3. The governed groom pipeline runs once. The deterministic collector parses
   content-bound readiness decisions and locally commits changed worktree bytes.
4. `preparePlannerPublication` writes one transaction before remote mutation.
   Its identity binds app, turn, repository, branch, and commit.
5. `resumePlannerPublication`, serialized by a per-publication lock, reconciles
   remote commit, readiness labels, complete BacklogSnapshot/RoadmapPlan,
   routine ValidationContracts, and DeliveryUnitReadiness. Only the final
   atomic state write changes `publication_pending` to `published`.
6. Every later scheduler tick reconciles pending publications before computing
   paid Planner admissions. Pending/refused apps cannot start competing Planner
   work. Existing roadmap runtime then admits bounded batches and independently
   rechecks `routing:human-only` and `manual-review`.
7. `publication list|resume`, `status`, and narrative expose the exact state,
   error, branch/commit, and recovery command.

## Component inventory

| ID | Component | Responsibility | State/effect | Criticality | Evidence |
|---|---|---|---|---:|---|
| COMP-GIT | `managed-checkout.ts`, Planner worktree helpers | Exact base and checkout isolation | managed clone/worktree, branch commit/push | C3 | CF-REG-232 real local Git test |
| COMP-PUB | `planner-publication.ts` | Durable exactly-once transaction | `planning/publications/<hash>/*.json` plus GitHub/Git effects | C3 | CF-REG-232 fault matrix |
| COMP-SCHED | `planner-intake.ts`, `dispatch.ts`, roadmap/delivery runtime | Intake, recovery-before-admission, validation/batching/routing | GitHub labels and accepted authorities | C3 | CF-REG-230 plus production-wiring detector |
| COMP-OBS | CLI status/publication and narrative | Token-free operator recovery view | reads state; narrative-only local writes | C2 | production-wiring detector and source review |
| COMP-HARNESS | replacement tests and case catalog | Detector sensitivity and traceability | offline evidence | C3 | seeded controls, full gates |

## Trust and authorization boundaries

- Operator checkout bytes are outside the managed-clone/worktree boundary and
  are never used as the scheduled mutation target.
- Provider output is untrusted. Closed readiness parsing, routine guards,
  protected-path detection, canonical credential scanning, and accepted
  validation schemas mediate every effect.
- GitHub/ref state is mutable external truth. Each push is preceded and
  followed by exact ref reads; a different commit permanently refuses.
- Transaction files are untrusted persistent input on recovery. The reader
  checks schema, content/recovery identities, evidence hashes, and terminal
  state consistency before use.
- Routing labels are re-read at readiness and again at batch/Builder admission.

## Failure containment

Failures preserve the exact worktree/commit and a `publication_pending` or
`refused` record. A lost acknowledgement converges by observation. Concurrent
resumes serialize. Read-only grooming creates no branch. Credential/protected
changes do not reach the remote. A permanent refusal cannot be automatically
re-performed; resume only advances it after observing that a human has made
the exact intended commit durable.

## Runtime boundary and unavailable evidence

The assessment ran on a macOS host with Node 26 and local real Git repositories.
No provider, external GitHub mutation campaign, sandbox org, scheduler install,
eval, soak, release, or deployment ran. The exact future procedure is
`docs/qualification/planner-publication-qualification.md`.

## Open questions

- Whether the disposable real-GitHub and one-turn sandbox-org campaign passes.
- Whether a separate independent reviewer finds a disagreement with this I1 audit.
