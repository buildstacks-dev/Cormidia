# Scenario seed corpora — committed instrumentation

These manifests are the deterministic source for the repository state a scenario
starts from. S-ACC-2 is explicit about why they are committed data rather than
hand-authored files:

> The staleness is the fixture and must be **deterministic** — generated from a
> committed manifest, not hand-drifted, so the scenario is re-runnable.

A hand-drifted corpus makes run 2 incomparable to run 1, and the whole point of
a distribution is comparing runs.

| File | Scenario | What it seeds |
| --- | --- | --- |
| `s-acc-2-tutorials.json` | S-ACC-2 | Ten tutorials under `tutorials/`, each staled exactly as that scenario's table specifies |
| `s-acc-3-notes.json` | S-ACC-3 | Three research input notes under `inputs/`, carrying the planted single-source tool and the conflicting pair |

## What the human may want to own

The **briefs** are ratified human content (`../scenarios/`). These manifests are
**instrumentation** — they exist to make a planted defect reproducible, not to
be good writing. They were authored by the implementation agent to satisfy each
scenario's stated table, and the prose is deliberately plain.

If you want the corpus to read more like a real estate — longer tutorials, more
idiomatic code, more convincing drift — enrich the `body` arrays here. Nothing
downstream depends on the prose itself except S-ACC-2's overlap plant (#7/#8),
which is discoverable only by reading, so keep those two genuinely overlapping.

## The plants live in the scenario file, not here

A manifest never states which item is the trap. `#7 overlaps #8` is recorded in
S-ACC-2's sealed `## Plants` section and extracted into the answer key; the
manifest just produces two tutorials that genuinely overlap. Keeping the claim
and the material apart is what stops the corpus from leaking the key
(`CORMIDIA-C-B28-001` §2) — a grader reading `tutorials/` must be able to reach
the overlap only by noticing it.
