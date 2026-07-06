# M8 planning and standing-role protocol verification

Date: 2026-07-06

Purpose: record the implementation and verification evidence for M8.1-M8.4:
Planner plan/groom/triage pipelines, trigger-to-pipeline routing, v0 SRE /
Support / Marketing protocols, and file-drop company event schemas.

## What landed

- `pipelines.yaml` now validates 12 pipelines: build, review, fix, ship,
  plan, groom, triage, sre-incident, sre-health, support-digest,
  marketing-release, and ci-sweep.
- `prompts/plan/**`, `prompts/groom/groom.md`, `prompts/triage/triage.md`,
  `prompts/sre/**`, `prompts/support/digest.md`, and
  `prompts/marketing/**` encode the v0 standing-role protocols.
- `src/org/trigger-routing.ts` maps effective roles.yaml triggers to named
  protocols; dispatch uses it for loud skips.
- `src/org/turn-runner.ts` executes routed scheduled/event pipelines through
  the real pass executor and includes pending approval ages plus budget
  warnings in the routed brief.
- `docs/event-schemas.md` and `src/org/event-schemas.ts` define and validate
  support-feedback, adoption-signal, health-alert, and launch-calendar
  file-drop payloads.

## Verification

- `pnpm test` passed: 53 test files, 411 tests.
- `pnpm typecheck` passed.
- `pnpm build` passed.
- `pnpm dev roles` passed.
- `pnpm dev apps` passed: 3 apps registered.
- `pnpm dev pipelines` passed: 12 pipelines printed with the expected pass
  table.
- `pnpm dev doctor` passed.
- `pnpm dev dispatch --dry-run` passed and routed scheduled alpha turns:
  marketing weekly and planner daily.

## Sandbox functional checks

Alpha (`~/Build/operon-sandbox-alpha`):

- `npm test` passed: 5 tests.
- `npm run lint` passed.
- `pnpm dev loop --app operon-sandbox-alpha --once --dry-run` passed:
  no ready tickets.

Beta (`~/Build/operon-sandbox-beta`):

- `npm test` passed: 4 tests.
- `pnpm dev loop --app operon-sandbox-beta --once --dry-run` passed:
  no ready tickets.

Gamma:

- `~/Build/operon-sandbox-gamma` was not present locally, so M8.5 functional
  SRE/Support/Marketing role smokes were not run. The protocols, routing,
  and event schemas needed for that proof are now in place.

`pnpm test:live` was not run because M8.1-M8.4 did not change runtime adapter
behavior; the live conformance requirement remains tied to adapter changes.
