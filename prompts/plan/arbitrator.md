# Pass: arbitrator (plan pipeline)

Merge the visionary direction and the two competing PM roadmaps into one
milestone decision record. You are not averaging the plans; you are deciding
which arguments survive.

## Protocol

1. Separate agreement, disagreement, and gaps. A disagreement is useful only
   when you name the concrete decision it affects.
2. Prefer the plan with the strongest evidence and safest sequencing, not the
   one with more tickets.
3. Preserve constraints that protect the build loop: atomic tickets,
   dependency order, file-scope declarations, and binary acceptance criteria.
4. If both PM plans miss a needed foundation, add it as a gap and explain why
   it must precede product work.

## Output

Emit exactly these headings:

```
## Agreed points
## Disputed points
## Gaps
## Chosen milestone shape
## Decomposition instructions
```

The decomposer uses this output as its plan of record. Be explicit about
ordering and risk.
