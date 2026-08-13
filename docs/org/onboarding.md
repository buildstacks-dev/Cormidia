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
push, run the Planner, or publish an issue: those remain explicit follow-up
steps (`docs/PURPOSE.md` -> Decided, 2026-07-07). Repository creation is now a
governed follow-up rather than a hand-typed one -- see *Repository
provisioning* below. After push,
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

The decision is an **app-repository** transaction, not a local file edit (#389).
Live planning reads Cormidia's managed checkout, synchronized from the app
remote — it never consumes arbitrary human working-tree state, and that
isolation is deliberate. `--execute` therefore records the decision *and*
publishes it through the same primitive the org home uses: only the manifest
(plus, for `remove`, the byte-exact placeholders it deletes, bound into the same
commit) on a dedicated branch cut from the resolved remote default branch, with
a draft pull request a human merges. It reports the same durability vocabulary,
and `--publish --execute --confirm <app>:publish` resumes a publication that did
not finish without re-recording the decision.

Planning distinguishes five states and names the transition that is actually
missing:

| State | What planning says |
| --- | --- |
| no decision reachable, none in flight | record one (the disposition command) |
| recorded in a local checkout, never published | finish the publication — never "record it again" |
| published, awaiting human merge | merge the named branch or pull request |
| merged but the bound document bytes changed | re-record for the named path and hashes |
| current and reachable | planning proceeds |

The "recorded locally" and "awaiting merge" states come from Cormidia's own
publication journal in the state home, not from reading the operator's
checkout.

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
source. The emitted `.cormidia/TASTE.md` is a comment-only placeholder;
context assembly skips it until the operator writes visible craft. Recovered
bootstrap writes only to a Cormidia-managed clone and leaves the human
checkout untouched.

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

## Repository provisioning

`cormidia app provision-repo <app> --source-dir <checkout>` and `cormidia org
provision-repo --repo <owner/repo>` create the private GitHub repository an app
or an org home lives in (#382). They exist because *requiring human approval*
and *requiring the human to type `gh repo create` themselves* are different
things, and onboarding had collapsed them into one. The operator still decides;
the deciding is done against a preview and the executing is done by a
reconciling transaction.

Four steps, in order:

1. **Preview, with no GitHub mutation.** The repository owner/name, visibility
   (always private), local source path, the exact owned commit scope with a byte
   bound per file and in total, the remote name, the push target, and the
   canonical label set. An unresolved or placeholder identity is refused *before
   the first network call* -- `src/runtime/repo-identity.ts` is the one decision
   (#385), and provisioning a repository literally named `YOUR_APP_REPOSITORY`
   is the one identity bug a retry cannot undo.
2. **Exact confirmation.** `--execute` plus `--confirm <app>` / `--confirm
   <org>`. The reviewed content id is bound, so a target or a byte that moved
   between preview and execution refuses rather than provisioning something
   nobody looked at.
3. **Execute.** Create the private repository, commit and push ONLY the declared
   owned paths, install the canonical labels (`CANONICAL_LABELS`, the same set
   `app verify` checks). The owned set is DECLARED, never discovered: unrelated
   files sitting in the target directory are never swept in. For the org scope
   the declaration IS the committed-surface inventory and every expanded path is
   re-checked through `classifyOrgHomeWrite`, so the **state home can never enter
   a provisioning commit**.
4. **Verify before advancing any readiness claim.** Visibility, remote identity,
   default-branch ancestry (resolved through `resolveRemoteDefaultBranch`, never
   hardcoded and never cached), the expected bootstrap commit, and the canonical
   labels are re-read from the remote. `ready` is the conjunction of all five; a
   facet that could not be *checked* never counts as passing.

Durability and reconciliation use the same journal discipline as `org publish`,
keyed by content identity under `<state-home>/provision/<scope>/`. Every partial
outcome reconciles **forward**: a repository that already exists, a remote
already configured, a commit already present, a push already landed, some labels
already installed, and a lost response mid-create. It never creates a duplicate
repository, never repeats an ambiguous write, and never force-pushes. A
repository that already holds commits this provisioning did not create is
refused, not overwritten; one that is not private is refused, and provisioning
never changes an existing repository's visibility.

The bootstrap commit descends from the checkout's existing HEAD when there is
one, so an org home's history is never orphaned, and files outside the
declaration are never recorded as deleted. The commit is built against a
temporary index, so the operator's own index is untouched -- except on a genesis
commit, where the index is synced to it so `git status` does not report every
provisioned file as deleted.

The manual `gh repo create` / `git push` / `gh label create` sequence is retained
as a documented fallback in the generated `next-commands.md`. It is no longer the
supported path, and `gh repo create|delete|edit|archive|rename` now classify
`repo-provisioning` (human-only, never-scopeable) at the critical-ops gate, so an
agent cannot run them without an explicit human approval.

Provisioning is not attempted for a local-only org: an org home with no
configured remote reports the explicit `local_only` contract, exactly as
publication does.

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
