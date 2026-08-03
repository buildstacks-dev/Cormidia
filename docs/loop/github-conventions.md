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


Transitions follow the artifact-before-label rule ([`turns.md`](turns.md)); ticket close comes from
the squash-merge's `Closes #N`, never a manual state.

### Ticket format (what the Planner emits)

Fixed headings, parseable by heading, human-first:

```markdown
Title: imperative, one concern (one ticket = one PR, TASTE §5)

## Goal            — what exists after this ships, one paragraph
## Context         — why now; links to feedback/digests/prior art
## Acceptance criteria   — checklist; each item mechanically checkable
## Out of scope    — the temptation fence
## Notes for the builder (optional) — pointers, not prescriptions
```



### Branches, PRs, reviews

- Branch: `op/<issue>-<slug>` from main; one branch per ticket; worktree ↔
branch 1:1 ([`turns.md`](turns.md)).
- PR: title `<type>: <summary> (#<issue>)` — in v1 the builder loop always
emits the literal `build:` type (`prTitle` in `src/loop/loop.ts` is hardcoded;
a variable type is a later change); body = What / Why, **Evidence**
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
