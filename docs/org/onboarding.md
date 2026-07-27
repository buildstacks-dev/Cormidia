# App onboarding: greenfield, bootstrap, and lifecycle

*How an app enters and leaves readiness states: `operon new-app` (greenfield),
`operon bootstrap` (existing repo), and the token-free `app reset`/`verify`/
`promote` lifecycle commands. Registry and budget are [`apps.md`](apps.md);
the evidence-ladder claim vocabulary is
[`../episodes/contract.md`](../episodes/contract.md); the system map is
[`../architecture.md`](../architecture.md) §9.*

## Greenfield and bootstrap

Greenfield (`operon new-app`) and existing-app (`operon bootstrap`) both require
a complete active org (`operon org init`). Readiness claims follow the evidence
ladder in `docs/episodes/contract.md` (generated → registered → runtime-ready →
live → autonomously scheduled); registry states remain `onboarding | live |
paused`.

`new-app` is deterministic and local: target skeleton, starter product truth
(`docs/VISION.md`, `docs/REQUIREMENTS.md`), `.operon/` contract, optional
template (`typescript-node` or `bare`), then the same register path as
bootstrap. It does not create a GitHub repo, push, or run the Planner —
follow-ups live in `.operon/bootstrap/next-commands.md`. After push,
`operon app verify` synthesizes the lifecycle record; `operon app promote
--to live --execute` flips status without a manual `apps.yaml` edit.

`bootstrap` (run inside the product repo) scans manifests/docs without agents,
runs the operator questionnaire, emits app-owned `.operon/` artifacts plus
marked AGENTS.md/CLAUDE.md blocks, and registers the app as `onboarding`. It
inventories setup signals; it does not infer authoritative product truth from
source. Recovered bootstrap writes only to an Operon-managed clone and leaves
the human checkout untouched.

## App reset, verify, and promote

`operon app reset`, `operon app verify`, and `operon app promote` are the
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
