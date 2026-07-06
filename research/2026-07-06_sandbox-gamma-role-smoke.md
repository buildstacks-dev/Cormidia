# operon-sandbox-gamma role smoke

Date: 2026-07-06

Purpose: complete TODO M8.5 by creating the third sandbox app and exercising
SRE, Support, and Marketing against a running-service target and realistic
input material.

## Repo

- Private repo: `https://github.com/bikramgupta/operon-sandbox-gamma`
- Local checkout: `~/Build/operon-sandbox-gamma`
- Initial commit: `7daca53 Create gamma sandbox service`
- Release tag: `v0.1.0`
- Operon registration: `apps.yaml` entry `operon-sandbox-gamma`, status
  `onboarding`

## App shape

Gamma is a tiny Node HTTP service:

- `GET /health` returns `200` in healthy mode and `500` in down mode.
- `Dockerfile` provides a container deploy hint.
- `scripts/deploy-local.sh` is intentionally deploy-shaped but dry-run only.
- `fixtures/events/` seeds support-feedback, adoption-signal, health-alert,
  and launch-calendar payloads.
- `.operon/**` was emitted by `operon bootstrap` and committed in the gamma
  repo.

## Verification

Gamma commands:

- `npm test` passed: 3 service tests.
- `npm run lint` passed.
- `GH_REPO=bikramgupta/operon-sandbox-gamma npm run smoke:sre` passed.
- `npm run smoke:support` passed.
- `npm run smoke:marketing` passed.

Operon checks:

- `GH_SANDBOX_REPO=bikramgupta/operon-sandbox-gamma pnpm e2e:sandbox:setup`
  passed and created/verified the standard labels.
- `pnpm exec tsx -e "...defaultGate({ command: 'npm run deploy:local' })..."`
  returned `allow:false`, reason `critical op (production-deploy) requires
  human approval`, `escalate:true`.

## Role smoke evidence

SRE:

- Healthy check returned 200.
- Down-mode check returned 500.
- Artifact: `~/Build/operon-sandbox-gamma/artifacts/sre/incident-health-down.md`.
- Real private GitHub issue:
  `https://github.com/bikramgupta/operon-sandbox-gamma/issues/1`
  labeled `op:incident` and `p3`.

Support:

- Artifact:
  `~/Build/operon-sandbox-gamma/artifacts/support/digest.md`.
- The artifact includes a feedback digest, Planner feed, and reply draft.
- No external reply was sent.

Marketing:

- Artifact:
  `~/Build/operon-sandbox-gamma/artifacts/marketing/release-draft.md`.
- The artifact drafts release/changelog copy from the real `v0.1.0` sandbox
  tag and adoption-signal fixture.
- No external publishing happened.

## Result

M8.5 passed: the non-build standing roles now have real functional coverage
against a running service and realistic synthetic input before production
onboarding.
