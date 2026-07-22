# Run-3 approval capture (ISSUE-020)

Verbatim copies of the four decided approvals, their grants, and the append-only
log from `~/.operon/Buildstacks/approvals/` after run 3, so
`test/approval-command.test.ts` is hermetic and offline. `~/.operon` itself is
read-only evidence and is never touched by the suite.

All four record the defect the fix addresses:

```
"status": "approved"
"execution": { "state": "approved", "executor": "actor-retry",
               "attempts": 0, "nextAction": "actor_retry" }
```

`execution-locks/` was empty in the capture — no execution was ever claimed,
which is the same fact `attempts: 0` records from the other side. That is why
the fixture has no locks directory: there was nothing to copy.

`20260721T100740Z-95ev` is the representative record quoted in the finding: a
`/bin/zsh -lc 'gh pr create --base master --head op/10-… --fill'` the human
approved, whose grant no actor could ever spend.
