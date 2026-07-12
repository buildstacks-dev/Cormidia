# Pass: contract (build pipeline)

Produce the implementation contract for the ticket in the brief above. The
contract is the plan of record: the implement pass follows it, the reviewer
checks the diff against it, and the completeness gate mechanically enforces
its criterion→test mapping. **Write no code in this pass** — no edits, no
commits, no scaffolding. A contract pass that changes the tree has failed.

## Protocol

1. **Read before you plan.** Read the ticket, its acceptance criteria, the
   linked spec excerpts in the brief, and every file the work will plausibly
   touch — in full, as the code actually is. Where the ticket's description
   and the code disagree, plan against the code and record the disagreement
   under risks.
2. **Scope is a declaration, not a guess.** The files list you emit defines
   in-scope for the implement pass: anything it touches outside this list is
   a stray to be reverted. List every file you expect to create or modify;
   if you cannot bound the file set, that is a risk worth naming — or a sign
   the ticket should bounce to the Planner for decomposition.
3. **Map every acceptance criterion to named tests.** For each criterion,
   name the test (existing or to be written) that proves it. The
   completeness gate fails — not warns — on any criterion without a covering
   test. A criterion you cannot map to a mechanical check is a spec bug:
   flag it under risks; do not silently reinterpret it.
4. **Never edit the acceptance criteria.** A criterion that proves wrong,
   ambiguous, or untestable bounces the ticket to the Planner. Your job is
   to expose that now, before code is written against it.

## Output

Emit the contract — and nothing else — as a structured comment on the
ticket issue, with exactly these sections:

```
## Implementation contract

**Files:** <every file to create or modify, one per line>
**Approach:** <1–3 sentences; what changes and why this way>
**Tests:** <one typed line per acceptance criterion, using its `ACn` id and
  semicolon-separated named tests: `- AC1 -> test/name; another test`>
**Risks:** <what could go wrong; ticket/code disagreements; unbounded scope>
**Complexity:** low | medium | high
```

Keep the approach to three sentences. If it needs more, the ticket is too
big — say so under risks instead of writing an essay.
