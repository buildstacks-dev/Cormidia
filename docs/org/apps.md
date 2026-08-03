# Multi-app structure and budget enforcement

*The `apps.yaml` registry, assignment modes and org-approved candidates,
the one-turn-one-app invariant, and per-app monthly budget enforcement.
Onboarding an app is [`onboarding.md`](onboarding.md); the system map is
[`../architecture.md`](../architecture.md) §7.*

### App registry — `apps.yaml` (org home)

```yaml
org:
  name: cormidia
  max_concurrent_turns: 2

defaults:
  budget_usd_month: 1000        # decided 2026-07-04, configurable per app

apps:
  operon-sandbox-alpha:
    repo: bikramgupta/operon-sandbox-alpha       # GitHub slug = identity
    status: live                # live | paused | onboarding
    budget_usd_month: 1000
    execution:
      assignment_mode: fixed    # fixed | adaptive; omission is fixed
      allowed_assignments: {}   # adaptive app narrowing by role/candidate id
    cadence: {}                 # optional per-role trigger overrides, e.g.
                                #   support: []          (disable role here)
                                #   planner: [{schedule: "daily 08:00"}]
  cormidia-sandbox-beta:
    repo: bikramgupta/cormidia-sandbox-beta
    status: onboarding
```

`assignment_mode` changes assignment resolution only; it cannot disable
EpisodePlanner. In `fixed`, each planned role turn resolves the role's existing
configured tuple. In `adaptive`, role-local org-approved candidates are
required, and `allowed_assignments` may narrow their IDs per app but cannot
invent or widen a tuple. The Planner boot turn remains its configured fixed
tuple in both modes. The committed org-home entry and `.cormidia/config.yaml`'s
`apps.<name>` mirror use the same app-entry schema and must normalize
identically. Checkout gate commands are `.cormidia/config.yaml` top-level
extensions, not app-entry fields.

An org-approved role candidate keeps the harness and exact model inseparable,
lists every supported effort explicitly, and binds the operational evidence
used for capability, qualification, and price validation:

```yaml
roles:
  builder:
    runtime: codex
    model: gpt-5.6-sol
    effort: high
    adaptive_assignments:
      - id: codex-gpt-5.6-sol-qualified
        harness: codex
        model: gpt-5.6-sol
        efforts: [medium, high, xhigh]
        provider_family: openai
        capability_ref: codex/v1
        qualification_ref: campaign:codex-gpt-5.6-sol-v1
        conservative_estimate:
          max_turn_cost_usd: 5
          source: https://developers.openai.com/api/docs/pricing
```

Candidate IDs are stable and role-local; `configured` is reserved for the
role's fixed tuple and is always present. Each adaptive candidate currently
supplies a bounded `conservative_estimate`; `price_ref` is rejected until the
product packages an operational model-and-token estimator instead of silently
using the role-wide cap as a catalog estimate. `qualification_ref` is the
human-ratified provenance reference for the exact tuple. Configuration loading
validates its typed form but does not claim to rerun or dereference an external
campaign. App
`allowed_assignments` values are candidate-ID lists keyed by role. Unknown
roles or IDs fail configuration loading before execution, so app configuration
can only narrow the org catalog.

- **One-turn-one-app is structural:** `TurnRequest` has a single `workdir`;
multi-app exists only in the dispatcher (which iterates apps) and human
surfaces (the app-tagged approval queue, per-app budget rollups). No turn
ever sees two apps.
- "One live app at a time" is **operational policy** expressed as `status:`,
not code — the WIP limit is what code enforces.
- Per-app cadence overrides replace (not merge with) that role's roles.yaml
triggers when present; an empty list disables the role for that app.



### Budget enforcement

Telemetry already records cost per turn; the dispatcher rolls up the current
month per app (telemetry records gain an `app` field — small addition to
`TurnRecord`):

- ≥ 80% of `budget_usd_month` → warning line in the Planner's daily digest.
- ≥ 100% → app auto-set to `paused` (state overlay, not a YAML edit) + a
`budget-exceeded` item in the approval queue (`../approvals/design.md`); human approval resumes the
app (optionally raising the budget in apps.yaml themselves).

The overlay (`state/budget-overlay.json`) is recomputed on **every dispatch
tick** — `enforceBudgetOverlay` runs before due-turn computation, and
`computeDueTurns` skips any app the overlay marks paused, so an app past its
cap stops spending within one tick rather than at the next human touch. The
rollup is per calendar month, so the overlay clears itself at month rollover
(a new month starts at $0). This is enforcement in code, not just a digest
line.
