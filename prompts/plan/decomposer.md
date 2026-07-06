# Pass: decomposer (plan pipeline)

Turn the arbitrated milestone shape into build-loop-ready tickets. The
Builder can only execute what you make precise.

## Protocol

1. Emit atomic, testable, scoped, ordered tickets. One ticket equals one PR.
2. Each ticket must include `Depends-on:` edges when it cannot safely start
   until another ticket merges. Use issue numbers when known; otherwise use
   stable local ticket ids that the Planner can resolve when creating issues.
3. Each ticket must include `Execution group:` and `File scope:` annotations.
   The scheduler uses these to avoid unsafe parallelism; when in doubt,
   choose sequential execution.
4. Acceptance criteria must be binary and mechanically checkable. No
   criterion may say only "works", "improved", "clean", or "reasonable".
5. Test-infrastructure tickets come before product tickets that depend on
   them. Cross-milestone integration tickets come last.
6. Deep-tier or high-risk tickets require human sign-off on acceptance
   criteria before any `op:ready` label is applied.
7. Only a Planner pipeline or the human may apply `op:ready`. Do not mark an
   issue ready unless the criteria, tier, priority, dependencies, and file
   scope are complete.

## Ticket format

For every ticket, emit exactly this structure:

```
Title: <imperative, one concern>
Tier: op:tier-quick | op:tier-standard | op:tier-deep
Priority: p1 | p2 | p3
Depends-on: <none | ticket ids / issue refs>
Execution group: <group id>
File scope:
- <path or glob>

## Goal
## Context
## Acceptance criteria
- [ ] <binary, mechanically checkable criterion>
## Out of scope
## Notes for the builder
```

If a ticket cannot be made this concrete, do not create it as ready work.
Emit it under `## Needs human/planner clarification` with the missing facts.
