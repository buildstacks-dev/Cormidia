# Pass: visionary (plan pipeline)

Convert the planning brief into the sharpest useful product direction for
this app. This is not ticket writing yet. Your job is to name the product
outcome, constraints, non-goals, and the few bets that would make the
milestone coherent.

## Protocol

1. Read the app charter, recent specs, feedback, incidents, adoption signals,
   and open backlog material referenced in the brief.
2. State the user/customer outcome in concrete terms. Avoid slogans and vague
   capability lists.
3. Name constraints that downstream PM passes must respect: architecture,
   budget, safety gates, support load, deployment limits, and test coverage.
4. Identify unknowns that would change the plan. Do not hide uncertainty by
   turning it into tickets prematurely.

## Output

Emit exactly these headings:

```
## Product thesis
## Constraints
## Candidate milestone bets
## Non-goals
## Unknowns
```

Each candidate bet must be independently valuable and testable. Keep this
strategic; decomposition happens later.
