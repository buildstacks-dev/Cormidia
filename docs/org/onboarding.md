# App onboarding: greenfield, bootstrap, and lifecycle

*How an app enters and leaves readiness states: `cormidia new-app` (greenfield),
`cormidia bootstrap` (existing repo), and the token-free `app reset`/`verify`/
`promote` lifecycle commands. This is the design contract; the operator
walk-through (install, org init, first bootstrap) is README → Install
locally. Registry and budget are [`apps.md`](apps.md); the evidence-ladder
claim vocabulary is
[`../episodes/contract.md`](../episodes/contract.md); the system map is
[`../architecture.md`](../architecture.md) §9.*

## Greenfield and bootstrap

Greenfield (`cormidia new-app`) and existing-app (`cormidia bootstrap`) both require
a complete active org (`cormidia org init`). Readiness claims follow the evidence
ladder in `docs/episodes/contract.md` (generated → registered → runtime-ready →
live → autonomously scheduled); registry states remain `onboarding | live |
paused`.

## Repository identity

An identity used as an external-action target must be concrete, deliberately
chosen, and placeholder-free. `src/runtime/repo-identity.ts` is the single place
that decides this; no surface re-derives the rule. It parses rather than casts:
callers receive a validated identity or a typed rejection naming the offending
component (`placeholder-owner`, `placeholder-repository`, `invalid-owner`,
`invalid-repository`, `malformed-slug`, `empty`, `not-a-string`). Detection is
token-based and deliberately precise — a component is a placeholder only when
every one of its tokens is documentation vocabulary — so `github/docs` and
`acme/app-repository-scanner` remain ordinary names while `OWNER/<app>` and
`<owner>/YOUR_APP_REPOSITORY` do not.

The rule is enforced as defense in depth, because each surface can be reached
without the others: `new-app` preview and execution (typed
`kind: new-app-refusal`, before any app/org/state write), bootstrap
registration, `renderNextCommandsGuide`, `app verify` (before lifecycle-record
synthesis, which would otherwise clone a remote derived from the slug),
automated planning (before a provider is constructed), every dispatched turn
(before the turn lock), and the `GhCliOps` constructor, which is the last seam
before a `gh` command runs.

An existing-app bootstrap with no resolvable remote still registers, recording
the one marked non-actionable literal `OWNER/<app>`. That is a deliberate,
refused-by-construction state, not a target: the emitted `.cormidia/config.yaml`
says so and names the correction path. Correcting an app already registered with
a placeholder is `cormidia app reset <app> --execute --confirm <app>` followed by
re-onboarding with the real slug. Reset stays available for exactly this case: it
builds no GitHub work surface from a non-actionable identity. Remediation is
never a hand-edit of `apps.yaml`, `.cormidia/config.yaml`, or the generated
guide — they are written together, so editing one leaves the others bound to the
wrong repository.

The human onboarding walk-through, whose identity preflight is fail-closed, is
[`manual-e2e-runbook.md`](manual-e2e-runbook.md).

## Target classification

`new-app` never equates greenfield with an empty directory. One deterministic,
content-aware preflight runs for both preview and execution — and it runs before
the dry-run result is produced, so what a preview reports is what execution
reaches — classifying the target as:

| Class | What it looks like | Outcome |
| --- | --- | --- |
| `absent` / `empty` | nothing there | scaffold |
| `additive-greenfield` | design documents, briefs, research, assets, prototypes, incidental metadata such as `.DS_Store` | scaffold additively; every existing byte is preserved and reported under `preserved` |
| `existing-checkout` | `.git`, a top-level `src/`, or a language manifest | refuse; remediation is `cormidia bootstrap <dir>` |
| `onboarded-app` | `.cormidia/config.yaml` or `.cormidia/TASTE.md` | refuse; remediation is `cormidia app verify <app>`, or `cormidia app reset` to start over |
| `conflicting` | a path `new-app` would create already exists, or the target is a symlink, a non-directory, or unwritable | refuse before any write, naming the exact path |

Refusals are typed (`kind: new-app-refusal`) and carry a supported command, not
just "not empty". The classification is re-read immediately before the first
write, so a write that lands between validation and execution fails closed
instead of being overwritten; separate preview and execution invocations share
no durable plan, which is exactly why execution re-classifies independently.

`new-app` is deterministic and local: target skeleton, starter product truth
(`docs/VISION.md`, `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`), `.cormidia/`
contract, template, then the same register path as bootstrap. **`bare` is the
default**: omitting `--template` resolves to it in both preview and execution,
because the template controls the repository's initial scaffold and whether
executable quality gates exist — it is not the application architecture, and the
absence of a choice must not make one. A bare app's required test and lint gates
stay explicitly pending and fail closed, and automated planning orders the
stack-and-gates unit before dependent feature work. `--template typescript-node`
remains an explicit accelerator whose output is unchanged. It records the exact generated product-document hashes with no
initial disposition and emits an app-specific, checkpointed repository-to-operation
guide at `.cormidia/bootstrap/next-commands.md`. It does not create a GitHub repo,
push, run the Planner, or publish an issue. After push,
`cormidia app verify` synthesizes the lifecycle record; `cormidia app promote
--to live --execute` flips status without a manual `apps.yaml` edit.

Before automated planning, the operator previews and records exactly one disposition
with `cormidia app product-docs <app> --workdir <checkout> --disposition
keep|reconcile|remove`. Classification is byte-exact against the generated hashes:
untouched placeholders, user replacements, and absent documents are distinct. `keep`
requires all three reviewed documents and creates no disposition-only work. `remove`
uses a recoverable staging transaction, deletes exact placeholders only, refuses or
preserves replacements that arrive after preview, and never records a mixed partial
result. Planning then keeps the optional documents absent. `reconcile` requires an authoritative `--source` DECLARED outside
the scaffold documents (a declared scope, not a proven read — whether the turn
actually opened it is INV-017's separate question); planning creates one Builder/Reviewer documentation unit and
orders all implementation after it. Bare templates additionally order that unit after
the single stack-and-gates unit. Missing or drifted disposition refuses before a
provider is constructed or an implementation issue is published.

Checkouts created before the scaffold manifest existed are not exempt. The command
recognizes their exact generated planning seed, reconstructs the template-specific
document hashes, reports the pending migration in preview, and writes the v1 manifest
only with the confirmed disposition. A changed, missing, or symlinked legacy seed with
remaining legacy bootstrap evidence refuses as unresolved instead of treating the app
as unscaffolded.

`bootstrap` (run inside the product repo) scans manifests/docs without agents,
runs the operator questionnaire, emits app-owned `.cormidia/` artifacts plus
marked AGENTS.md/CLAUDE.md blocks, and registers the app as `onboarding`. It
inventories setup signals; it does not infer authoritative product truth from
source. Recovered bootstrap writes only to a Cormidia-managed clone and leaves
the human checkout untouched.

Repositories onboarded before the product rename must move the retired
app-artifact directory to `.cormidia/` in one reviewed repository commit,
including updates to its instruction links. Bootstrap refuses before mutation
when the retired directory still exists, preventing split app policy.

## Committed org configuration is not durable until it reaches the remote

The org home holds **committed** organization configuration. Every command that
mutates it — `new-app`/`bootstrap` registration, `app promote`, `app reset`,
`roles set`, `org upgrade`, and the governed learning publisher — writes the
operator's working tree first, which is one checkout, not org truth. Registration
is therefore reported with a durability state, never a terminal claim:

| State | Meaning |
| --- | --- |
| `local_only` | the org home has no configured remote; Cormidia claims nothing beyond this working tree |
| `recorded_locally` | written in the working tree; no publication attempted |
| `pending_publication` | a publication transaction exists but has not reached the remote |
| `pending_merge` | on the remote as a branch (and a draft pull request when the remote is GitHub), awaiting human merge |
| `reachable_at_remote` | reachable from the resolved remote default branch — the only durable state |

`cormidia org publish [--surface <id>] [--execute]` is the governed route and the
supported recovery for an org home whose local configuration never reached its
remote. It previews by default; execution stages **only** the named surface's owned
paths in a throwaway worktree, cuts a dedicated branch from the resolved remote
default branch (never a hardcoded `main`), pushes it, and opens a draft pull
request. Unrelated staged, unstaged, and untracked content is never staged and
never committed; unrelated *staged* content makes the scope ambiguous and refuses.
Retries adopt an existing branch or pull request rather than duplicating one, and a
publish branch whose remote content differs is refused, never overwritten. Cormidia
does not merge these. `cormidia context` reports whether this checkout's committed
configuration is recoverable from its remote, and reports `unknown` — never
agreement — when no remote ref has been fetched.

The surfaces and their owned paths are declared in `src/org/committed-org-surfaces.ts`;
an org-home writer whose destination is not classified there fails an architectural
guard in CI rather than becoming a third silent category.

## App reset, verify, and promote

`cormidia app reset`, `cormidia app verify`, and `cormidia app promote` are the
token-free lifecycle commands for repeatable onboarding and readiness. Reset
archives managed state outside the state home before any destructive change
and never deletes a GitHub repository. Verify proves refs, managed clone,
authority/config hashes, app checks, locks/approvals, and adapters without
constructing a provider turn; it also synthesizes or repairs the lifecycle
record. Promote to `live` is plan-by-default and executes only from passing
verification. Readiness claims follow the generated → registered →
runtime-ready → live → autonomously scheduled ladder in `docs/episodes/contract.md`;
none of those states is implied by an earlier one. Promote and reset both change
the committed registry, so both report the org-home durability state above; a
promotion whose app-side commit landed is still not org truth while the org
registry change sits unpublished. CLI details and remediation
live with the commands themselves and README → Commands.
