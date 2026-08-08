# Outcome acceptance (L-ACC) — ratified lane and run record

***Status: rubric RATIFIED 2026-08-07. Guardrails, runner and execution layer
BUILT (HB-120…HB-131), real-path conformance repaired 2026-08-07 (HB-132).
Run 1 reached a terminal plan-gate stop on 2026-08-08; its official distribution
is entirely ungraded/inconclusive and all scenarios are incomplete.***

*The measurement rubric ([`rubric.md`](rubric.md) §8) is ratified and tighten-only
— its thresholds deliberately are not. Everything else here was design input to a
`validation-harness-design` **harness-revision** pass (AGENTS.md → Validation
harness → "Structural additions are not autonomous").*

***That revision landed 2026-08-07*** *and is registered in the ratified corpus:
journey J-21, boundaries B-27/B-28/B-29, campaign invariants*
`CORMIDIA-INV-ACC-1…7b`*, LLM site S-11, and the* `l_acc_lane` *policy block —
plus J-22/J-23, M18 and B-30 clearing the jobs debt. Read*
[`../validation-design/harness-design-state.md`](../validation-design/harness-design-state.md)
*for the record and* [`../validation-design/ratification-package.md`](../validation-design/ratification-package.md)
*§11 for what the owner still has to decide (F-PT-029, F-PT-030, F-PT-031).*

***The lane has run once.*** *The durable evidence index is
[`run-1-result.md`](run-1-result.md). Run 1 stopped at the unchanged rubric §6
plan gate, emitted no release signal, and was not rerun to improve the result.*

*Run 1 satisfied its exact authorization and operating preconditions. That does
not make L-ACC a release gate: per F-PT-029, the resulting incomplete,
inconclusive evidence remains outside RQ-1 and must not be cited in a release
claim.*

*Rehearse first:* `pnpm test:acceptance -- --config <path> --dry-run` *runs every
config/authorization/identity preflight, provisions nothing, and spawns no binary.
The runtime-only install/world proof is repeated by `runCampaign` before the first
scenario mutation; the bare entry point cannot invent those dependencies (HB-132,
`run-1-todo.md` LACC-R1-H06).*

## What problem this addresses

Cormidia's live lane ([`tests/live/campaign-live.test.ts`](../tests/live/campaign-live.test.ts))
proves **boundary conformance** with real tokens: adapters normalize usage,
GitHub clauses hold, launchd installs, the unattended profile refuses what it
must. It never asks whether the software the org produced is any good.

Two places already name that gap, unbuilt:

- [`docs/jobs/design.md`](../docs/jobs/design.md) §14 — **L-JOB-LIVE (not run)**:
  real apps, real tokens, outcome measurement per job shape, blocked on "a
  human-authored measurement rubric before it means anything."
- [`docs/qualification/benchmark-runbook.md`](../docs/qualification/benchmark-runbook.md)
  — the buildstacks-class bootstrap replay, the nearest ancestor for the app
  half, now historical with archived entrypoints.

L-ACC is the lane that would close both.

## Why it is a separate lane and not more L3 cases

L3's verdict semantics are deterministic pass/fail against boundary clauses.
L-ACC's are scored, multi-axis, and `inconclusive` by default until thresholds
ratify from observed data. Different failure modes, different verdict algebra,
different cadence. Folding it into L3 would mean either weakening L3's pass
semantics or misreporting a score as a clause — both forbidden.

## Contents

| File | What it is | Who ratifies |
| --- | --- | --- |
| [`rubric.md`](rubric.md) | The measurement rubric: axes, scoring procedure, grader independence rules, fabrication audit | **RATIFIED 2026-08-07** — tighten-only; thresholds still unratified |
| [`scenarios/S-ACC-1-greenfield-web.md`](scenarios/S-ACC-1-greenfield-web.md) | Greenfield multi-ticket web app | Human (brief content) |
| [`scenarios/S-ACC-2-corpus-refresh.md`](scenarios/S-ACC-2-corpus-refresh.md) | Brownfield stale-tutorial refresh | Human (brief content) |
| [`scenarios/S-ACC-3-research-viz-job.md`](scenarios/S-ACC-3-research-viz-job.md) | `cormidia-job` research → synthesize → visualize | Human (brief content) |
| [`revision-input.md`](revision-input.md) | New journeys, boundaries, invariants and risk tags the revision pass must resolve | Consumed by the revision pass |

## Hard boundaries this lane inherits and must not cross

1. **No deployment.** Deployment is a critical op. A campaign ends with each app
   *buildable* plus a preview command in the report. Hosting is a separate human
   approval after the report is read. The campaign never holds a deploy grant.
2. **Never Cormidia itself as a sandbox app.** `assertCampaignRepositoryBinding`
   pins checked-out HEAD and the tracked policy blob to the authorized commit;
   an app that edits this repo mid-campaign voids the campaign's identity.
   Cormidia feature work is the campaign's **output** (filed issues → a normal
   dev cycle), never a step inside it.
3. **No green by absence.** Ceiling exhaustion, a skipped scenario, a missing
   grader run, or an unratified threshold reports `incomplete` / `inconclusive`.
   Never a pass. (Standing rule 7.)
4. **Grader ≠ builder.** Enforced in code, not by convention — the same
   uncorrelated-blind-spot reason `roles.yaml` pairs builder and reviewer across
   providers.
5. **Real human approvals only.** Unattended execution uses exactly the ratified
   sandbox test-mode profile ([`src/org/validation-test-mode.ts`](../src/org/validation-test-mode.ts)).
   No forged approval decisions, ever.
6. **All work goes through the `cormidia` and `cormidia-job` binaries, installed
   the way a real user installs them.** This is the whole point and the easiest
   thing to get wrong, in two distinct ways:
   - A supervising agent that runs `git`/`gh` directly, edits a sandbox repo
     itself, or calls a provider SDK is *simulating* the org, not exercising it.
   - A `cormidia` on PATH from `pnpm link:local` is **source-backed** — symlinked
     into `src/`, run through tsx ([`scripts/install-packaged.mjs:6`](../scripts/install-packaged.mjs:6)).
     It executes TypeScript that `npm install -g cormidia` never ships. Testing
     against it is not testing what a user gets.

   Both are enforced as `INV-ACC-7` ([`revision-input.md`](revision-input.md) §4).

## Installing the way a user does (mandatory campaign preflight)

```bash
pnpm install:packaged --replace-source-links
```

Landed in #360 ([`scripts/install-packaged.mjs`](../scripts/install-packaged.mjs)).
It takes the packaged path end to end — build → `npm pack` → global install of the
tarball → link every declared skill **from the installed root** — and then does the
thing that makes it usable as a campaign gate: **it resolves each declared binary
and fails if it still resolves inside this checkout.** That is `INV-ACC-7`'s
install half, already implemented; the campaign asserts its exit status rather
than reimplementing the check.

**What that exit status actually proves**, reconciled 2026-08-07 against the script
as it now stands on `main` (#360 plus the two follow-ups that made the plan
complete-before-mutation and made skill linking per-target):

1. **Nothing earlier on `PATH` shadows the npm-global entry** for either binary —
   a shadowing link is classified as interfering in the plan phase and the run
   refuses. The plan block
   ([`install-packaged.mjs:56`](../scripts/install-packaged.mjs:56)) mutates
   nothing, so every refusal below is pre-mutation.
2. **Each binary's npm-global entry realpaths outside this checkout**
   ([`install-packaged.mjs:208`](../scripts/install-packaged.mjs:208)).
3. **Every declared skill target points into the installed package root**
   ([`install-packaged.mjs:215`](../scripts/install-packaged.mjs:215)). A
   partially linked skill set is a failed preflight, not a warning: `link-skills`
   exits non-zero when it refuses any target, and the verification step then
   refuses any target that is not `current`.
4. **Both binaries execute from the installed root** — `cormidia --version` and
   `cormidia-job --help`.

Four operational notes for the campaign:

- **Rehearse with `--dry-run --replace-source-links`, not `--dry-run` alone.**
  Every interfering path is classified before anything is mutated, so a dry run
  is a complete preflight — but the refusals fire *inside* the plan phase, ahead
  of the dry-run exit. On a machine with `link:local` active, bare `--dry-run`
  therefore exits non-zero with "N source-backed link(s) would block the packaged
  install" ([`install-packaged.mjs:150`](../scripts/install-packaged.mjs:150)).
  That is the script working correctly; pass both flags for the "would do" report.
- **It refuses what this checkout does not own, and names it precisely.** A link
  owned by another checkout, or a Cormidia install under a *different npm
  prefix*, aborts the plan phase with both prefixes named. Neither is something a
  campaign may clear on its own — the operator resolves it before the campaign
  starts, and the refusal is exactly the INV-ACC-7b evidence the report wants.
- **It displaces the dev loop.** `--replace-source-links` removes the
  `link:local` symlinks. Reversible — `pnpm link:local` restores them
  ([`install-packaged.mjs:152`](../scripts/install-packaged.mjs:152)) — but on a
  host machine this changes what `cormidia` means globally for the duration of
  the campaign. Say so in the report.
- **Record what was tested.** The report carries the installed version and the
  tarball identity alongside the commit pin. "Which bytes did this campaign
  actually exercise" must be answerable from the report alone.

## The mirrored model matrix (campaign dimension, run 1)

`roles.yaml` is resolved from **org home** ([`src/org/app-lifecycle.ts:255`](../src/org/app-lifecycle.ts:255)),
so the repo copy is only the shipped default. The campaign org declares every
tuple any scenario needs as `adaptive_assignments` candidates; each app's
`allowed_assignments` then **narrows** to its own IDs
([`docs/org/apps.md:110`](../docs/org/apps.md:110) — app config can only narrow
the org catalog, never widen it). One org, three matrices.

| Scenario | Plan | Build | Review |
| --- | --- | --- | --- |
| **S-ACC-1** | claude `claude-opus-4-8` @xhigh | claude `claude-sonnet-5` @xhigh | codex `gpt-5.6-sol` @xhigh |
| **S-ACC-2** | codex `gpt-5.6-sol` @xhigh | codex `gpt-5.6-luna` @xhigh | claude `claude-opus-4-8` @xhigh |
| **S-ACC-3** (job) | *n/a — jobs have no Planner* | sonnet / opus / terra fan-out, all @xhigh | *n/a — jobs have no Reviewer* |

The two app arms are deliberate **mirrors**: each tests a cheaper builder at
`xhigh` within one provider family, reviewed cross-family. A non-mirrored arm
(Claude planning, Claude building **and** Claude reviewing) would collapse the
builder ≠ reviewer cross-provider pairing that [`roles.yaml:52`](../roles.yaml:52)
calls "the single most important pairing in this file" — AGENTS.md forbids that
collapse, so S-ACC-1's reviewer is `gpt-5.6-sol`, not the default Opus.

**`effort: max` is not available here.** [`src/runtime/assignment.ts:82`](../src/runtime/assignment.ts:82)
admits `max` only on `claude` and `opencode`; every OpenAI-family tuple above
therefore tops out at `xhigh`. A config naming `max` on `codex` or `pi` must fail
**preflight**, not at the first turn.

**Per-candidate preflight debt.** Each `adaptive_assignments` candidate carries
`provider_family`, `capability_ref`, `qualification_ref` and a
`conservative_estimate`. `qualification_ref` is a human-ratified provenance
string that configuration loading validates as a *type* without dereferencing
([`docs/org/apps.md:104`](../docs/org/apps.md:104)). Every tuple above that lacks
a real reference must be disclosed as uncertified in the campaign report rather
than given a plausible-looking one.
