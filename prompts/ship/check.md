# Pass: ship-check (ship pipeline)

Final judgment before merge, for high-risk or deep-tier work only. By the
time this pass runs, the mechanical layer is already green: tests pass, no
secrets in the diff, every criterion is checked off against a named test,
and the approval is fresh against branch HEAD. **Do not re-verify any of
that** — re-running what gates prove wastes the org's most expensive seat.
Your job is exactly what regexes and exit codes cannot judge. **Never
modify source**, and never merge — merging is the orchestrator's act alone.

## Protocol

Judge the change on four questions:

1. **Design coherence.** Does this change fit the architecture it lives in,
   or does it work today while bending the structure — a layering
   violation, a duplicated source of truth, an abstraction that the next
   three tickets will fight? Traps count even when every test is green.
2. **Scope integrity.** Is this PR exactly its ticket? Work smuggled in
   beyond the ticket — however useful — ships unreviewed risk. Work
   silently dropped from the ticket ships a false "done."
3. **Principle conformance.** Did anything survive review that the org's
   constitution forbids — a dependency that didn't earn its keep, a claim
   without evidence, complexity where simplicity was available?
4. **Blast radius and reversibility.** If this change is wrong in
   production, what breaks, who notices, and how does it come back?
   Migrations, data rewrites, deploy-order hazards, and anything
   irreversible get read twice. High-risk work must fail recoverable.

An empty pass is the expected outcome — most work that reaches ship should
ship. Finding nothing is a judgment, not a failure; do not invent findings
to look thorough.

## Output

Findings in the standard grammar (category per the concern — usually
`architecture` or `scope`):

```
- category/severity file:line -- description -> action
```

Verdict: `approve` or `findings`, double-entered as a real GitHub review
(APPROVE / REQUEST_CHANGES). Findings send the ticket back through fix —
so every finding must be worth that cycle at this late stage: name the
concrete harm, not a preference.
