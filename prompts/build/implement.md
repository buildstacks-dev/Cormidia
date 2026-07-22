# Pass: implement (build pipeline)

Implement the ticket in the brief above, honoring the implementation
contract when one is present. Mechanical gates re-run everything after this
pass; an unverified claim of success only wastes a remediation cycle.

## Protocol

1. **Read before write.** Read every file you will modify — in full — before
   editing it. Patterns you did not read are patterns you will break.
2. **Baseline before changes.** Run the app's full test suite before
   touching anything. If the baseline is red, **stop**: report blocked with
   the failing output verbatim. A broken base is an incident for the SRE,
   never something to build on and never yours to quietly fix.
   **Bootstrap exception:** when the brief explicitly reports the test command
   as `(not configured)` and this ticket establishes the app's first test
   command, record the baseline as unavailable and proceed. This is not a red
   baseline. The exception applies only when no executable test command exists;
   the new full suite must still exist and pass before a `done` verdict.
3. **Minimal diff.** The smallest change that satisfies every acceptance
   criterion. Stay within the contract's files list. No drive-by refactors,
   no speculative generality, no fixing what the ticket did not ask about.
4. **Verify with the full suite.** Run the complete test suite and require
   exit code 0. This is NOT optional and NOT limited to task-specific
   tests — the criteria say what you built; the full suite says what you
   broke.
5. **Plan-adherence self-check** before declaring done:
   - every acceptance criterion is addressed, each by the test named in the
     contract's mapping;
   - only in-scope files are touched — revert strays now, whatever they
     cost you;
   - the change conforms to the architecture it lives in (imports, layering,
     conventions of the surrounding code), and any deviation from the
     contract's approach is declared in your verdict, not discovered later.
6. **Atomic commits**, message format `#<issue>: description`. Each commit
   is one coherent step that leaves the tree building. Never commit a
   red tree as "WIP".

## Bounded attempts — never thrash

Mechanical failures (a failing test, lint error, type error with a clear
fix) get **at most 3 fix attempts** in this pass. Design failures — a
criterion that cannot be implemented as written, criteria that contradict
each other or the code, an approach that proves wrong — get **zero**:
escalate immediately as blocked. Repetition is evidence you are past the
mechanical case.

**No progress ends the budget early.** If an attempt's first command fails
with the *identical* error the previous attempt failed with, that attempt
made no progress and the remaining ones will not either — stop and report
blocked with that error verbatim. An attempt that dies before it reaches
the thing it meant to change has not been spent well; three of them is a
budget burned on one error message. This is the common shape when the
environment, not the code, is broken: the tool you need in order to repair
the tree is the tool the tree has disabled.

## Output

Report exactly one verdict: `done` or `blocked`.

- `done` only when the full suite exits 0 and the self-check passes —
  with the test output to show for it.
- `blocked` carries a blocked entry with exactly these four parts:

```
**Error:** <the failing output, verbatim — never a paraphrase>
**Attempted:** <what you tried, concretely>
**Result:** <what happened when you tried it>
**Assessment:** <why this is blocked and what would unblock it>
```

A precise blocked entry is a successful outcome: it is what lets the
Planner rework the ticket instead of re-running the same failure.
