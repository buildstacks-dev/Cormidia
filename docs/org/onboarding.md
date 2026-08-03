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

`new-app` is deterministic and local: target skeleton, starter product truth
(`docs/VISION.md`, `docs/REQUIREMENTS.md`), `.cormidia/` contract, optional
template (`typescript-node` or `bare`), then the same register path as
bootstrap. It does not create a GitHub repo, push, or run the Planner —
follow-ups live in `.cormidia/bootstrap/next-commands.md`. After push,
`cormidia app verify` synthesizes the lifecycle record; `cormidia app promote
--to live --execute` flips status without a manual `apps.yaml` edit.

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
