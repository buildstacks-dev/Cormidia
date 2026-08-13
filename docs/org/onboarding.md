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

`new-app` is deterministic and local: target skeleton, starter product truth
(`docs/VISION.md`, `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`), `.cormidia/`
contract, optional template (`typescript-node` or `bare`), then the same register
path as bootstrap. It records the exact generated product-document hashes with no
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
result. Planning then keeps the optional documents absent. `reconcile` requires an authoritative `--source` outside
the scaffold documents; planning creates one Builder/Reviewer documentation unit and
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
none of those states is implied by an earlier one. CLI details and remediation
live with the commands themselves and README → Commands.
