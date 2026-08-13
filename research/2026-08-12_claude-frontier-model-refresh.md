# Claude frontier-model refresh — 2026-08-12

Issue #387. Successor to `research/2026-07-15_model-assignment-refresh.md`,
which this record amends on exactly one axis: the Claude Opus tier.

## Decision and scope

The Claude frontier assignment in the **packaged `roles.yaml` seed** moves from
`claude-opus-4-8` to `claude-opus-5` for the three roles that hold that tier:

| Role | Runtime | Before | After |
| --- | --- | --- | --- |
| `planner` | claude | `claude-opus-4-8` @ xhigh | `claude-opus-5` @ xhigh |
| `reviewer` | claude | `claude-opus-4-8` @ xhigh | `claude-opus-5` @ xhigh |
| `operator` | claude | `claude-opus-4-8` @ high | `claude-opus-5` @ high |

This changes model-configuration bytes only. It does not change any role's
runtime, effort, budget cap, delegation policy, trigger set, or outputs; it
does not change a grader, threshold, route, denominator, safety rule,
provider-turn cap, or equivalent-cost ceiling. Like the 2026-07-15 refresh, it
is a config swap, not an architecture change.

**Explicitly unchanged, and deliberately so:**

- `builder` stays Codex `gpt-5.6-sol`. The builder ≠ reviewer cross-provider
  pairing (AGENTS.md → Working rules; roles.yaml's own comment calls it "the
  single most important pairing decision in this file") encodes uncorrelated
  review blind spots. Refreshing the Claude side of the pair preserves that
  property; it never collapses toward one provider.
- `support`, `marketing`, and `distiller` stay `claude-sonnet-5`. They are the
  cheap-tier assignment on purpose; this refresh is scoped to the frontier tier.
- `support`/`marketing` `adaptive_assignments` are untouched. Their
  `qualification_ref` values bind campaign
  `candidate-qualification-v1-20260718-eb658f6309c9`; a qualification reference
  is evidence of a *specific measured tuple*, and rewriting the tuple under a
  retained reference would be a false qualification claim.
- `src/runtime/harness-metadata.json` and the Cursor pricing prefix table keep
  their `claude-opus-4-8` entries. Historical manifests and alternate
  assignments must keep resolving; deleting the older id would break evidence,
  not tidy it.

## Why now

A production org (`bikram-production-org`) had already been moved to
`claude-opus-5` on the `claude` harness for planner, reviewer, and operator via
live role assignment, while the packaged seed still shipped `claude-opus-4-8`.
Every `cormidia org init` and every packaged install therefore landed a new org
one generation behind the assignment the operator had already chosen in
practice. The shipped default should be the current frontier, not the frontier
as of the previous refresh.

## No pricing or metadata work is owed

Unlike the 2026-07-15 Codex refresh, this one asserts no price table. The
Claude harness records `"pricing": null` with the note that "the Claude Agent
SDK reports real spend on the turn result, so Cormidia asserts no price table
for this harness and never estimates one"
(`src/runtime/harness-metadata.json`), and it carries `"roster": null` because
the Claude catalog is only readable by launching the CLI transport with a
working credential (`src/runtime/model-catalog.ts`). There is consequently no
offline roster to admit the id against and no rate to update: `model` is a
free-form string the adapter forwards, and settlement uses reported spend.

The corollary is that this refresh carries **no offline availability proof**.
That is the same posture as every other Claude model id in this file and is not
a regression, but it is worth stating plainly: the first real Claude turn after
this change is what proves `claude-opus-5` is servable by the account. There is
no `gpt-5.6-sol`-style adapter-calibration gate here because there is no
offline catalog to calibrate against.

## Existing orgs are not migrated

`cormidia org upgrade` is additive-only: `ADDITIVE_FILES` in
`src/org/org-upgrade.ts` adds a packaged surface **only when it is missing**,
and a ratified surface that appears between preview and execute makes the plan
stale rather than being overwritten. An org that already holds a `roles.yaml`
keeps its bytes, including an org still pinned to `claude-opus-4-8`. Operators
change live assignments deliberately, through `cormidia roles set` or a
ratified `roles.yaml` edit — never as a silent side effect of upgrading.

Both halves of that claim are now offline detectors under
`tests/hermetic/cf-j01-a-cf-j01-i-cf-j01-r-cf-j01-rc-cf-j01-s/cf-j01-s.test.ts`
(family CF-J01-S): a fresh init seeds `claude-opus-5` for the three roles, and
an org pinned to `claude-opus-4-8` survives an upgrade byte-identical.

## Derivation (routing.md → "Feature changes")

- **Module** (`scope-and-module-map.md` §2): M10 (org/app lifecycle — init
  seeds the packaged surfaces, upgrade is additive) with M11 (governed
  configuration — role assignments in `roles.yaml`) as the governing overlay.
- **Reverse-read** (`system-map.md` §3): M10 appears in J-01, J-02, J-14, J-21.
  Narrowed by changed call sites and ticket scope, only **J-01** (org
  create/upgrade/use) is reachable — a model-id byte in the seed is not
  crossed by app onboarding, app reset, or the acceptance campaign.
- **Journey → contract** (`contracts/journey-acceptance.md` J-01): C-OP-LIFE
  §1 (init lands a complete org home from the packaged template) and §3
  ("ratified surfaces unreplaced" on upgrade), B-10, INV-013.
- **Grammar row**: journey. Both cases land at **L2** — the cheapest layer that
  can falsify them, since each needs a real temp org home built by the real
  init/upgrade transaction.
- **Families**: CF-J01-S (existing; HB-015). No new family and therefore no new
  `case-catalog.md` row or HB ticket — catalog traceability is at family
  granularity, and these cases grow an existing family's set. `case-catalog.md`
  §10.1/§10.2/§10.3 are untouched: this is a feature change, not a defect fix.

## Human ratification

`roles.yaml` is a human-ratified surface (AGENTS.md → Working rules). This
change is proposed, not self-approved: the diff and this record land together
in one PR and the human merges.
