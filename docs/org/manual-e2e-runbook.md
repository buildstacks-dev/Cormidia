# Manual end-to-end onboarding runbook

*The tracked, executable walk a human follows to take one real product from
`cormidia new-app` through push, planning, delivery, verification, and
promotion. It is a **manual** runbook: every outward step is performed by a
human at a terminal, and every critical operation still goes through Cormidia's
own approval path. The design contract behind these commands is
[`onboarding.md`](onboarding.md); the command catalog is README → Commands.*

This file exists because #385: the runbook's identity setup was previously
untracked prose that used conspicuous sentinel strings with no assertion that
they had been replaced. In a production run the owner was substituted and the
repository component was not, so an unresolved template value was registered
into `apps.yaml` and `.cormidia/config.yaml` and emitted into executable `gh`
commands. Section 1 is now a fail-closed preflight rather than an instruction to
"choose real values", and this document deliberately contains no sentinel string
an operator could paste by accident.

## 0. Prerequisites

- A complete active org (`cormidia org init`) — check with `cormidia context --json`.
- `gh` authenticated against the account that will own the app repository.
- The repository **must not already exist**; checkpoint 3 creates it.

## 1. Identity preflight (fail-closed)

Run this whole block in one shell. `set -euo pipefail` plus `${VAR:?…}` means an
unset or empty identity aborts the runbook instead of composing a slug from a
placeholder. Do not paste example values here — export your own, then run the
block:

```bash
set -euo pipefail
: "${E2E_GITHUB_OWNER:?export the exact GitHub owner or organization that will own the repo}"
: "${E2E_APP_REPOSITORY:?export the exact repository name to create under that owner}"
: "${E2E_APP_NAME:?export the Cormidia app key}"
: "${E2E_APP_DIR:?export the absolute local path for the app checkout}"
: "${E2E_APP_GOAL:?export the one-sentence product mandate}"
E2E_APP_REPO="${E2E_GITHUB_OWNER}/${E2E_APP_REPOSITORY}"
export E2E_APP_REPO
printf 'repository target: %s\n' "$E2E_APP_REPO"
```

Now prove the target is concrete. This is the assertion, not the printout above:
the preview runs Cormidia's single repository-identity rule
(`src/runtime/repo-identity.ts`) and exits non-zero with a typed
`kind: new-app-refusal` when the identity is unresolved, malformed, or a
placeholder in either component. It writes no app, org, or state artifact.

```bash
cormidia new-app "$E2E_APP_NAME" --target-dir "$E2E_APP_DIR" --repo "$E2E_APP_REPO" --goal "$E2E_APP_GOAL" --dry-run --json
```

**Expected result:** exit status 0 and a JSON plan whose `repoSlug` is exactly
your intended repository. Under `set -e` a refusal stops the runbook here.

If it refuses, fix the exported value and re-run the block. Never edit the
generated guide, `.cormidia/config.yaml`, or `apps.yaml` to repair an identity:
those sources are written together, so a hand-edit corrects one and leaves the
others bound to the wrong repository. The supported correction for an app that
was already registered with a bad identity is a reset and re-onboard:

```bash
cormidia app reset "$E2E_APP_NAME" --execute --confirm "$E2E_APP_NAME"
```

## 2. Create the app

```bash
cormidia new-app "$E2E_APP_NAME" --target-dir "$E2E_APP_DIR" --repo "$E2E_APP_REPO" --goal "$E2E_APP_GOAL" --json
```

If `$E2E_APP_DIR` already holds design documents, a brief, or assets, that is a
supported greenfield input: the preview reports them under `preserved` and the
scaffold lands beside them. If it holds an application checkout or an onboarded
app, the refusal names the command to use instead (`cormidia bootstrap` or
`cormidia app verify`); switch to that command rather than emptying the
directory.

**Expected result:** the scaffold, `.cormidia/` contract, org registration, and
`.cormidia/bootstrap/next-commands.md` — an app-specific, checkpointed guide
whose commands already carry the exact resolved identities. There is no
find-and-replace step in that guide.

## 3. Follow the generated guide

From here the generated guide is authoritative for this app:

```bash
sed -n '1,400p' "$E2E_APP_DIR/.cormidia/bootstrap/next-commands.md"
```

It is checkpointed: stop when an expected result is missing rather than letting
a later checkpoint paper over an earlier one. Its checkpoints cover the four
homes, the product-document disposition, the local readiness gates, repository
creation and push, canonical labels, plan preview then publication, Builder and
Reviewer delivery, approvals and human merge, verification and promotion, and
ongoing operation.

## 4. Record the run

Capture the outcome of each checkpoint (command, expected result, what actually
happened) with the exact repository identity, so a failed run can be diagnosed
without re-deriving what was targeted.

## Scope

This runbook covers manual onboarding only. It is not a validation-harness lane:
it gates nothing, produces no attestation, and is never release evidence. Defects
it surfaces are ordinary defects — they deposit offline detectors and a
`case-catalog.md` §10.3 row like any other.
