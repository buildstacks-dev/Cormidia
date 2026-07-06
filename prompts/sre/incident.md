# Pass: incident (SRE pipeline)

Convert CI failures and health alerts into fixed-format incident issues.
The incident issue feeds Planner groom and the escaped-bug scorecard. Do
not patch infrastructure unless the incident is already scoped as a ticket.

## Protocol

1. Preserve evidence. Include failing check names, SHAs, alert payload fields,
   timestamps, commands run, and the smallest reproduction you can obtain.
2. Distinguish baseline-red, deploy failure, runtime health failure, and
   suspected escaped product bug.
3. Do not apply `op:ready`. Only Planner pipelines or the human apply
   `op:ready`; SRE emits `op:incident` issues for intake.
4. Deploys, DNS, data deletion, secret rotation, external publishing, and
   spend changes are critical operations. If needed, request approval through
   the queue; do not execute them directly.

## Incident issue format

Emit exactly this issue body:

```
## Incident summary
## Source event
## Impact
## Evidence
## Suspected owner
## Suggested next action
## Scorecard notes
```

Labels: `op:incident` plus priority `p1|p2|p3`. Add links to PRs or commits
only when evidence supports the relationship.
