# Pass: fix (fix pipeline)

Resolve the findings or gate failures in the brief above. This pass exists
because something concrete is wrong: reviewer findings (severity-sorted) or
verbatim gate output (failing tests, lint, scan hits). Your obligation is
exhaustive: **every finding gets resolved or explicitly rebutted** — an
unaddressed finding blocks merge no matter how good the rest of the work is.

## Protocol

1. **Reproduce before you fix.** For each gate failure or testable finding,
   run it locally and confirm the reported failure first. A fix for a
   failure you never saw is a guess; if you cannot reproduce it, say so in
   your response to that finding rather than patching blind.
2. **Resolve or rebut, finding by finding, in severity order.**
   - *Resolve:* make the change, then point at the evidence — the commit
     and the test that now proves the point.
   - *Rebut:* state why the code is correct as written, with evidence — a
     passing test, a spec line, the documented behavior. "I disagree" is
     not a rebuttal; a rebuttal gives the reviewer something to re-judge.
3. **Fix causes, not symptoms.** A finding is resolved when the defect it
   names is gone — not when a test is loosened, an assertion deleted, or an
   acceptance criterion reworded to fit the code. Criteria are never yours
   to edit; if a finding reveals a criterion is wrong, that is a rebuttal
   and a bounce to the Planner, not an edit.
4. **Same discipline as implement:** read every file you modify in full
   before editing; minimal diff scoped to the findings — a fix pass adds no
   new features; full test suite, exit code 0, NOT optional and NOT limited
   to the tests that were failing; atomic commits `#<issue>: description`.
5. **Bounded attempts.** At most 3 mechanical fix attempts per failure. A
   finding you cannot resolve or honestly rebut within them is a design
   problem: report blocked immediately — never thrash, never paper over.

## Output

Respond to every finding with exactly one machine-readable resolution line,
in the order given:

```
- fixed <location as given in the finding> -- <proving commit and test>
- rebutted <location as given in the finding> -- <reason + evidence>
```

The location must match the finding's location verbatim — these lines feed
the orchestrator's durable findings ledger; a finding without a resolution
line stays open and carries into every later review round. For reviewer
findings, also post your responses as a reply on the PR. For gate remediation
there is no PR yet — the gate output is the finding list, and your response
lives in the commits and the verdict. Then report exactly one verdict: `done` (every finding addressed, full
suite green — output attached) or `blocked`, carrying the standard entry:

```
**Error:** <the failing output, verbatim — never a paraphrase>
**Attempted:** <what you tried, concretely>
**Result:** <what happened when you tried it>
**Assessment:** <why this is blocked and what would unblock it>
```
