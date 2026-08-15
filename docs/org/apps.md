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
  sandbox-alpha:
    repo: bikramgupta/sandbox-alpha       # GitHub slug = identity
    status: live                # live | paused | onboarding
    budget_usd_month: 1000
    execution:
      assignment_mode: fixed    # fixed | adaptive; omission is fixed
      allowed_assignments: {}   # adaptive app narrowing by role/candidate id
      permission_modes:
        codex: on-request       # safe modes only; no approval/sandbox bypass
        claude: auto            # bypassPermissions is not representable
      limits:
        per_turn:
          equivalent_cost_usd: null  # null inherits the role ceiling
          active_time_ms: null       # null inherits the pass/episode allowance
          tool_calls: null
          model_turns: null
        generic_episode:
          equivalent_cost_usd: null  # null uses current app-ledger headroom
        ticket_episode:
          equivalent_cost_usd: null
        route_execution: {}          # optional quick/standard/deep overrides
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

`permission_modes` is resolved per app before a paid turn. Omission uses the
shipped Codex `on-request` and Claude `auto` modes; `cormidia apps --json`
prints the complete effective policy, including inherited defaults. Only
provider-supported, non-bypass modes are accepted. Auto/ask behavior is a
harness convenience layer: it never removes Cormidia's tool gate, critical-
operation approvals, workspace-write sandbox, network default-deny, or role
tool shaping. The Codex linked-worktree writable-root calculation remains an
independent boundary; a permission mode does not make an invalid worktree
contract valid.

`limits` resolves three independent authorities. `per_turn` is the soft ring:
an app value narrows the role/pass allowance for that one turn. The generic and
ticket episode sections are hard ceilings over the derived EpisodeIntent; cost
`null` preserves the current ledger remainder as authority. `route_execution`
may override the existing quick/standard/deep environment-retry, tool-call,
claim, repair, and review-cycle defaults. Load rejects unknown fields,
non-positive values, a per-turn value above an explicit episode ceiling, or
any wider route whose execution bound is below a narrower route. Run envelopes
persist the actual per-turn cost/time/tool/model values and permission mode;
EpisodeIntent/route records persist the hard ceiling and static execution
bounds that actually applied.

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

### Harness auth modes — `harnesses:` (org home, #333)

Auth binds to the **(harness × provider-family) connection**, never to the
model. The same Opus is reachable on the operator's Claude subscription through
`claude` and on an Anthropic API key through `opencode`, in one org, at the same
time — a model-keyed declaration could not express that.

```yaml
harnesses:
  claude:
    auth: subscription            # Claude Code on the operator's own plan
  codex:
    auth: subscription
  opencode:                       # multi-provider backbone: per family
    providers:
      anthropic: api_key
      openai: api_key
  pi:
    auth: api_key                 # covers families `providers:` omits
    providers:
      anthropic: subscription
  muse:
    auth: api_key                 # the only mode muse has
```

- `auth:` covers the whole harness; `providers:` narrows per provider family
  and is accepted **only** on the multi-provider backbones (`pi`, `opencode`).
- The block is org-level and optional. An undeclared harness is not verified
  and its turns are not labeled — exactly the behaviour before #333.
- Declaring a mode a harness cannot serve fails at load: `muse` exposes no
  subscription login, so `muse: {auth: subscription}` is invalid by
  construction, not a runtime mismatch.
- `cormidia doctor` and `cormidia app verify` **verify** the declaration against
  the real credential state with the same token-free probes readiness already
  runs; a mismatch is a typed readiness failure
  (`error_auth_mode_mismatch`) in both directions, and an indeterminate
  credential state is `error_auth_mode_unverifiable` rather than a pass. Per
  harness, the verification method is in
  [`../harness/capability-matrix.md`](../harness/capability-matrix.md).
- Cormidia never falls back silently: subscription→API is surprise billing,
  API→subscription is quota the operator did not approve.
- `cormidia apps` prints the declared connections; `cormidia doctor` prints the
  observed ones.

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

**Subscription turns are volume, not dollars (#333).** A turn on a connection
declared `subscription` settles with `billing: "subscription"` and an
*authoritative* `costUsd: 0` — no marginal charge exists, so summing an
equivalent-cost figure into the month would invent an invoice. `BudgetRow`
therefore reports metered `spentUsd` and `subscriptionTurns` as two numbers,
and the monthly cap (a spend cap) is unmoved by plan work; the episode
contract's provider-turn and active-time ceilings are what bound its volume.
The zero is never silent: a row labeled `subscription` that carries real
dollars is incoherent and marks the app's month `unknown`, which blocks exactly
like `exceeded` (INV-006, A-004).

The overlay (`state/budget-overlay.json`) is recomputed on **every dispatch
tick** — `enforceBudgetOverlay` runs before due-turn computation, and
`computeDueTurns` skips any app the overlay marks paused, so an app past its
cap stops spending within one tick rather than at the next human touch. The
rollup is per calendar month, so the overlay clears itself at month rollover
(a new month starts at $0). This is enforcement in code, not just a digest
line.
