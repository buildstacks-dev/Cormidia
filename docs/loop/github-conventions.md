# GitHub substrate conventions

*The GitHub surface the loop drives: state labels, the ticket format the
Planner emits, and branch/PR/review/merge conventions. States derive from
these artifacts, never from labels alone ([`turns.md`](turns.md)); the ticket
state machine that consumes them is [`design.md`](design.md) §7.*




### Labels — the ticket state machine


| Label              | Meaning                                      | Set by                                              |
| ------------------ | -------------------------------------------- | --------------------------------------------------- |
| `op:ready`         | ticket is buildable as specified             | Planner (or human)                                  |
| `op:building`      | claimed; branch/PR in progress               | Builder turn (claim = atomic `ready→building` swap) |
| `op:in-review`     | PR open, review cycle running                | loop, after PR exists                               |
| `op:returned`      | bounced to Planner (max cycles / infeasible) | loop                                                |
| `op:blocked`       | waiting on approval-queue decision           | loop, on `blocked_on_gate`                          |
| `op:incident`      | SRE incident note                            | SRE                                                 |
| `p1` / `p2` / `p3` | priority (dispatch order within events)      | Planner                                             |
| `routing:human-only` | excluded from autonomous readiness/claim   | Human, after the PR-level self-hosting routing call |
| `manual-review`      | human review hold; autonomous exclusion    | Human                                               |


Transitions follow the artifact-before-label rule ([`turns.md`](turns.md)); member
closures come from the squash-merge's complete `Closes #N` set, never a manual state.
`routing:human-only` is not a state label: it survives every transition, blocks
both Planner readiness and Builder claim, and only a human re-routing the whole
PR scope removes it.
`manual-review` independently blocks Planner readiness and Builder claim for the
entire delivery unit. Cormidia preserves it across every transition and never removes
it; only a human may do so. The match is exact, not a wildcard over `manual-*` labels.

### Ticket format (what the Planner emits)

Fixed headings, parseable by heading, human-first:

```markdown
Title: imperative, one concern (one ticket may be one complete delivery unit)

## Goal            — what exists after this ships, one paragraph
## Context         — why now; links to feedback/digests/prior art
## Acceptance criteria   — checklist; each item mechanically checkable
## Out of scope    — the temptation fence
## Notes for the builder (optional) — pointers, not prescriptions
```



### Branches, PRs, reviews

- Branch: `op/<issue>-<slug>` from main for a single-ticket delivery unit;
  `op/unit-<unit>-<membership-hash>` for a multi-ticket unit. One branch and
  worktree belong to the complete delivery unit ([`turns.md`](turns.md)).
- PR: exactly one per delivery unit. Its body carries `Closes #N` for every
  member, and every member's state projection moves only after the shared
  branch/PR/gate/review/merge artifact exists.
- PR: a single-ticket title is `<type>: <summary> (#<issue>)`; a multi-ticket
unit is `build: <unit> (<count> tickets)`. In v1 the builder loop always emits
the literal `build:` type (`prTitle` in `src/loop/loop.ts` is hardcoded; a
variable type is a later change); body = What / Why, **Evidence**
(pasted test output — TASTE §6), `Closes #<issue>`. Draft on first push;
ready when the Builder declares done.
- Review: verdict as a real GitHub review (APPROVE / REQUEST_CHANGES) plus a
structured findings comment — numbered findings, each must be resolved or
explicitly rebutted before merge (TASTE §8). Findings ride to the fix turn
as context. Single-account pilot caveat: GitHub forbids approving your own
PR, so a same-account approval lands as a marked COMMENTED review — trusted
only when its `cormidia:self-approval-fallback` marker carries a verifying
HMAC — signed with an orchestrator-only secret over the PR number **and the
reviewed commit**, so a marker copied onto a later push no longer verifies
(A-001) — plus an author-independence check, a structured `Verdict: approve`,
and commit freshness. No secret (or an unresolved reviewed commit) = fail
closed; a bare marker is never trusted ([`design.md`](design.md) §6).
- Merge: squash-merge only, performed by the loop after APPROVE; branch
deleted; PR description survives as the commit body (state-in-markdown, a
predecessor pattern).
