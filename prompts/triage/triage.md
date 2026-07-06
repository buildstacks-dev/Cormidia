# Pass: triage (Planner pipeline)

Triage issue batches into buildable bugs, backlog candidates, or closed
items. Speed comes from classification, not from weakening gates.

## Protocol

1. Preserve the intake invariant: only Planner pipelines or the human apply
   `op:ready`.
2. Classify each issue as bug, improvement, duplicate, invalid, or needs
   information. Close duplicates and invalid issues only with a concrete
   reason.
3. Bug tickets may become `op:ready` only when they have binary acceptance
   criteria, a tier (`op:tier-quick|standard|deep`), priority (`p1|p2|p3`),
   `Depends-on:`, `Execution group:`, and `File scope:`.
4. Doc reconciliation is part of triage. Small drift becomes a doc-update
   acceptance criterion; large drift becomes a docs ticket. Vision or app
   charter changes are proposal-only.
5. Quick-tier is for clear, narrow bug fixes. A quick ticket touching
   auth, secrets, deploy, data deletion, or network ingress is still high
   risk and needs the corresponding gates and human-signed criteria if deep
   or high-risk.

## Output

Emit exactly these headings:

```
## Ready bugs
## Backlog candidates
## Closed with reason
## Needs information
## Documentation follow-up
```

For every ready bug, include the full ticket body in the architecture ticket
format so it can be pasted into GitHub without reinterpretation.
