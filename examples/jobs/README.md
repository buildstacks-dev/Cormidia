# examples/jobs — runnable job graphs

Four shapes worth knowing, in rising order of how much they lean on deterministic
gates. Each is a complete config: `cormidia-job explain <file>` validates it and
prints its plan without spending anything.

| Example | Shape | Why it is here |
| --- | --- | --- |
| `board-strategy-cascade.yaml` | fan-out to three teams, human checkpoint, synthesis | The org-work case: real work belonging to no product. Nobody would create an app for a board exercise. |
| `competitive-research.yaml` | fan-out / fan-in, schema-gated join | Three passes on three different harnesses, so no single provider's blind spot shapes all three. Disagreement between them is a finding. |
| `dependency-audit.yaml` | app-scoped, recurring | Evidence lands under the app. Schema gate plus command gate on the same artifact. |
| `weekly-repo-hygiene.yaml` | command-gated change | Every gate is a command (`pnpm typecheck`, `pnpm test`), because the question is "does the tree still build", not "did the model write something". |

## App names are placeholders

`billing-api` and `docs-site` are illustrative. Replace them with a name from your
own `cormidia apps` output, or delete the `app:` line to run the job unscoped in
the active org. An app-scoped job naming an unregistered app is **refused** — it
never silently falls back to unscoped, because that would file the evidence
somewhere you would not think to look.

## What these examples do not demonstrate

Outcome quality. Every check here proves a *structural* property — the file
exists, it parses, the tree still builds. Nothing here measures whether the board
brief was any good, and jobs deliberately carry no statistical quality lane
(`validation-design/jobs-harness-revision-proposal.md` Phase 5): the prompt is
yours, so Cormidia cannot own a golden set for it.

Real-token validation against real apps, with outcome measurement, is a separate
authorized campaign and is **not** covered by these examples or by the offline
detector families. See `docs/jobs/design.md` §14.
