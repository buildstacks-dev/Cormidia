# Evidence Report

Assessment: `20260804T164335Z-abe087e950dc`
Base revision: `abe087e950dcb0721a753c56432f116be01483a8`
Candidate working-tree digest (excluding this evidence directory):
`a44d5084da0146f41ca5999c86e3c29e95efb1d4`

## Scope and provenance

Full criticality-calibrated audit of #232 and remaining deterministic #230:
managed Planner checkout, durable publication/recovery, GitHub readiness,
RoadmapPlan/validation/batching/routing production integration, operator
evidence, and replacement-harness conformance. Host: Darwin 25.5.0 arm64,
Node 26.4.0, pnpm 11.10.0, Python 3.14.3. Dependencies were installed with the
frozen lockfile in the isolated candidate worktree. The human checkout was
read-only and retained its pre-existing untracked `.agents/` state.

Independence is I1: implementation and audit were performed by the same agent.
Repository CI is a later separate execution environment; no independent
semantic reviewer participated. No live/provider/external campaign ran.

## Evidence summary

| Claim | Status | Evidence | Environment | Limitation |
|---|---|---|---|---|
| CLM-ISO | verified offline | real local bare/seed/operator/managed Git test | host local Git | real GitHub unrun |
| CLM-EXACTLY-ONCE | verified offline | crash, push/Roadmap lost ack, sequential/concurrent duplicate, remote/roadmap conflict, refusal, exact-human-recovery cases | L2 fake GitHub/Git plus local Git | changing remote unrun |
| CLM-INTAKE | verified offline | eight CF-REG-230 cases including 10,001 seed | L2 fake GitHub | disposable repo unrun |
| CLM-LIFECYCLE | verified offline | accepted roadmap/validation/readiness, parked-unit migration, production seam detector | L2 and source sweep | live org unrun |
| CLM-PUBLICATION-SAFETY | verified offline | registered-origin and repository/app protocol-path refusal, real Git credential seed, canonical policy suite | local Git/L1/L2 | finite pattern families |
| CLM-OBSERVABILITY | verified offline | status JSON and narrative Markdown behavior plus production seam detector | offline | I1 usability review |
| CLM-EXTERNAL | not verified | bounded plan only | unavailable by instruction | FND-005 |

## Commands and procedures

The final command log is `commands.md`. Mandatory final commands are:

- focused four-file Vitest gate (22 cases);
- full `pnpm test` populated offline suite;
- `pnpm typecheck`;
- `pnpm build`;
- `git diff --check`;
- protected-surface and operator-checkout status/diff checks;
- audit artifact checker.

Exact outputs/exit codes are recorded after final execution. Required PR CI is
linked after publication and is a condition of the ordinary merge verdict.
The final bound candidate produced 22/22 focused cases and a populated full
gate of 161/161 files, 1,044 passes, and one established unrelated skip;
typecheck, build, diff, scope, and artifact checks all exited zero.

## Sensitivity evidence

- completed workflow with `publication_pending` throws;
- push succeeds then acknowledgement fault leaves pending, and replay performs
  no second push;
- simultaneous resumes serialize to one push/label/provider evidence set;
- foreign remote commit refuses without push;
- a worktree origin that differs from the registered repository refuses before
  remote publication;
- an acknowledged-late RoadmapPlan remains the exact first authority after
  backlog change, while a competing successor refuses permanently;
- permanent denial preserves the artifact; observing the exact human-published
  commit resumes without repeating the refused push;
- edited planning intent or recovery command fails closed at transaction parse;
- ready-only intake and a 10,001-item source both refuse;
- removing scheduler recovery from production source makes the wiring detector
  fail;
- seeded credential content and Git error text are redacted/refused;
- partial multi-member roadmap closure refuses instead of normalizing authority.

## Failed, skipped, blocked, and unavailable checks

No scoped focused check is permitted to fail or skip. The full repository suite
contains one established unrelated skip; it is reported, not counted as
evidence for these claims. `CLM-EXTERNAL` is unavailable/incomplete by explicit
session instruction. I2 semantic review is unavailable. Neither is represented
as a pass.

## Operational/system evidence

No deployment, release, scheduler installation, provider, real GitHub mutation,
eval, or soak evidence exists. The exact bounded future procedure and stop/
cleanup conditions are committed at
`docs/qualification/planner-publication-qualification.md`.

## Invalidation triggers

Re-audit after any publication-schema/state transition, Git push protocol,
managed-checkout/base-resolution, issue intake, RoadmapPlan/validation schema,
scheduler ordering, routing exclusion, or canonical credential-pattern change.
