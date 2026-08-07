# AGENTS.md

## Scope
Applies to the whole repo. Nested AGENTS.md files specialize local rules in
`src/runtime/`, `src/observe/`, `src/report/`, and `src/narrative/` —
read the nearest one when working there. `docs/PURPOSE.md` is the decision log; on conflict its
Decided section wins and this file is stale — fix this file.

This file governs **building and maintaining the Cormidia platform**, including
when the standing Cormidia org operates this repository as an app. Read
`docs/DEVELOPMENT.md` before development campaigns. Self-hosting is ratified
(PURPOSE.md → Decided, 2026-08-02): the standing org may register, onboard, and
operate both `cormidia-web` (the public front door) and this repository. Every
release-shaped action for every app — including npm publish, version tags,
release handoff, deployment, and external publication — requires explicit
human approval; after approval, Cormidia may execute only the exact approved
action through its durable release path. Repository instructions and linked
developer policy remain app-scoped development context. Development grants,
raw eval state, and outer-session instructions must never be copied into the
org home, org-global prompts, learning, or approvals. The packaged
`agent-skills/cormidia/` skill is the separate org-operation guide.

## What this repo is
An installable **org runtime**: a standing team of AI agents (Planner, Builder,
Reviewer, SRE, Support, Marketing) that develops and operates a software
product through a private GitHub repo, with a human gating critical ops only.
Build-complete and proven live end-to-end — README → Status / Known
limitations are the product view; README → Observability is the authoritative
state-home inventory (`~/.cormidia/<org>/`). Open work lives in the GitHub issue
tracker (`gh issue list`).

## Repository map
| Path | What it is |
| --- | --- |
| `docs/PURPOSE.md` | Decision log — **read first** |
| `docs/DEVELOPMENT.md` | Canonical platform-development lifecycle, standing grants, shipping |
| `TASTE.md` · `roles.yaml` · `pipelines.yaml` · `prompts/` | Human-ratified org templates and protocol surfaces (see Working rules) |
| `src/runtime/` | Runtime contract + adapters — `src/runtime/AGENTS.md` |
| `src/loop/` | Build loop: passes, briefs, quality gates, verdicts, ticket state machine (`docs/loop/design.md`) |
| `src/org/` | Standing-org layer: lifecycle, bootstrap, scheduler, approvals, budget, learning (`src/org/learning/`); `src/org/home.ts` is the package/org/state boundary and owns the one-time default-state-root migration |
| `src/observe/` · `src/report/` · `src/narrative/` | Presentation-only leaves — local AGENTS.md ×3 |
| `src/cli/` | One module per subcommand; `src/cli.ts` is a thin dispatch table — new subcommand = new file + one registry line |
| `agent-skills/cormidia/` | Packaged `$cormidia` Agent Skill (org operation, not development) |
| `validation-design/` | Ratified harness design (2026-07-31): `validation-policy.yaml` is the contract, `harness-backlog.md` the build plan — see "Validation harness" section below |
| `tests/` | Implemented replacement validation harness plus explicitly authorized L3/L4/L5 campaign runners (per `validation-design/`) |
| `archive-do-not-read/` | Frozen pre-rebuild validation corpus (old `test/`, `eval/`, `docs/testing/`, eval/CI scripts) — **never read, cite, run, or take design cues from it** |
| `research/` | Dated decision records (adapter facts, caching economics, live evidence) |
| `scripts/` | Link/smoke/packaging scripts |

## Common commands
Verified against `package.json` scripts 2026-07-31 (validation-rebuild
rewrite; legacy test/eval scripts removed with the archive move).
- Node >= 26 (`.nvmrc`; `nvm use`). Node >= 25 has no bundled corepack:
  `npm install -g corepack && corepack enable` once per Node install.
- Install: `pnpm install` — pnpm pinned via `packageManager`. Deliberately NOT
  a workspace; `pnpm-workspace.yaml` is per-repo pnpm config only.
- Check: `pnpm check` (Biome warnings-as-errors, typecheck, exact dependency
  pins, and source import direction).
- Test: `pnpm test` (offline L1/L2 vitest over `tests/`; passWithNoTests
  disabled) · typecheck: `pnpm typecheck` · build: `pnpm build`
- Triggered validation (human authorization + reviewed absolute config required):
  `pnpm test:live` · `pnpm test:eval` · `pnpm test:soak -- <start|checkpoint|finish>`;
  see `docs/qualification/design.md` and never run these casually.
  (tsc → `dist/`).
- Local product install: `pnpm link:local` (source-backed `cormidia` bin + skill
  links; later source edits need no relink).
- CLI: `pnpm dev <cmd>` in source mode; the full catalog with flags and
  caveats is README → Commands (substitute `pnpm dev` for `cormidia`), plus
  `cormidia <cmd> --help`.
- Packaging checks: `pnpm smoke:onboarding` · `npm pack --dry-run`.
- Worktrees: `pnpm worktree -- reconcile` is read-only; use `create`, `remove`, or dry-run `clean --merged|--gone`, with `--apply` required for deletion.
- Token-spending — never run casually: live `dispatch`/`loop`/`plan` against
  a real org spend provider tokens and can open PRs/approvals.
- Development lifecycle and grants: `docs/DEVELOPMENT.md`.

## Working rules
- **Import direction is one-way:** `src/org` → `src/loop` → `src/runtime`;
  runtime imports nothing above it. `scripts/check-import-direction.mjs`
  enforces the rule through `pnpm check`.
- **Never hardcode a default branch.** Resolve with
  `resolveRemoteDefaultBranch()` from `src/loop/default-branch.ts` and thread
  the resulting `BaseRevision` through; the option types make it required.
  A guessed base silently diffs against the wrong tree (#101). Nor may a
  resolved base be *cached* across claims: `runLoopOnce` re-resolves per
  ticket, because a `--follow` run merges into the default branch while it
  runs and a stale base has exactly the same effect as a guessed one (#203).
  Re-guarded by `tests/unit/cf-inv-009/` (source literals — all of
  `src/`, every reserved branch name, git-argument positions) and
  `tests/hermetic/cf-reg-203/` (per-claim freshness).
- **Human-ratified surfaces:** `TASTE.md`, `roles.yaml`, `docs/PURPOSE.md`,
  `pipelines.yaml`, `prompts/**`. Propose changes with rationale; never
  silently rewrite.
- **Never weaken a gate or test to make something pass.** Extend cases, never
  soften one. The builder ≠ reviewer cross-provider pairing in roles.yaml
  encodes uncorrelated review blind spots — do not collapse it to one provider.
- **Every defect fix deposits its detector.** Fix and offline test that
  reproduces the defect land in the same change (in `tests/` once the
  harness exists); if the failure is not offline-reproducible, guard the
  nearest deterministic seam (provision/preflight) and say so in the PR. A fix
  without a guard is incomplete — a live run is not a regression test.
- **Dependencies minimal and boring** (TASTE.md §3): `yaml` plus the four
  provider SDKs (`@anthropic-ai/claude-agent-sdk`, `@openai/codex`,
  `@earendil-works/pi-coding-agent`, `@opencode-ai/sdk` — the last added by
  #337 for the OpenCode harness; it is the generated client for the operator's
  own `opencode serve`, and Cormidia never installs the opencode binary itself,
  #224). Adding one is a decision, not a convenience. Cursor, Grok Build and
  Muse Code add no dependency at all — each is a *required preinstalled binary*
  (#224: Cormidia never installs a provider).
- **Grok Build is sandbox-only.** The adapter (`src/runtime/adapters/grok*.ts`)
  is implemented and certified, but #339's human risk review of the vendor is
  OPEN. Certification proves the adapter, never the vendor. Never point a grok
  turn at a real repository and never assign a role to it in `roles.yaml` until
  that review is recorded
  (`research/2026-08-07_grok-build-adapter-certification.md`).
- **Agent-authored engineering standard:**
  `research/2026-08-05_pi-forensic-analysis/pi-engineering-standards-skill.md`
  is binding for agent-authored code. The single module budget is public-symbol
  count as the gate; physical line count is the smoke alarm.
- **Model IDs** in roles.yaml were human-ratified 2026-07-15
  (`research/2026-07-15_model-assignment-refresh.md`); `gpt-5.6-sol`
  availability is proved by adapter calibration before a candidate campaign.

## Testing expectations
**Replacement validation harness implemented; external evidence pending (decided
2026-07-31, docs/PURPOSE.md → Decided v2.9/v2.10).** The legacy suite and old
eval/qualification machinery remain
`docs/testing/` are frozen under `archive-do-not-read/` — never read, cite,
run, or take design cues from that directory; the rebuild is deliberately
unanchored from the incumbent suite. The replacement design was **ratified
2026-07-31**: `validation-design/validation-policy.yaml` is the contract
(tighten-only), `validation-design/harness-backlog.md` the build plan, and the
"Validation harness" section at the end of this file the standing rules; the
implementation lands under `tests/` by backlog wave.

The minimum for any change is `pnpm test && pnpm typecheck`; this is a populated
offline gate, not green-by-absence. Release qualification is active under RQ-1:
the exact candidate requires a current aggregate attestation and a separate exact
human release approval. Missing, stale, corrupt, ceiling-stopped, uncalibrated, or
undispositioned required evidence is never a pass. L3/L4 campaigns remain explicit
human-authorized, per-candidate work and must never be invoked casually. The threat
model, HB-073 abuse lane, seven-day soak, and natural rotation remain disclosed
future L5 assurance outside RQ-1 and may not be claimed as completed evidence.

## Navigation
- Product status: README → Status / Known limitations · decisions: `docs/PURPOSE.md` · operator outcome: `docs/VISION.md` · platform development: `docs/DEVELOPMENT.md`
- `docs/architecture.md` is the thin system map (stable §numbering); depth lives in topic folders — one per subsystem, `design.md` as the folder's contract
- Build loop: `docs/loop/` (design · turns · github-conventions) · dispatch/scheduler: `docs/scheduler/` (design · event-schemas) · approvals/release: `docs/approvals/design.md`
- Episode operating contract: `docs/episodes/contract.md` · qualification/release gating: `docs/qualification/` (design · benchmark-runbook) · learning loop: `docs/learning-loop/`
- Adapters: `docs/harness/` (capability-matrix · adding-updating · qualification-evidence) · `research/2026-07-03_runtime-layer.md` · `research/2026-07-04_prompt-caching.md`
- Org layer: `docs/org/` (context · memory · apps · onboarding)
- Live UI / Reports / Narrative contracts: `docs/live-ui/design.md` · `docs/reporting/design.md` · `docs/narrative/design.md`
- Predecessor orchestrator (read-only prior art; "the predecessor" in docs): `scratchpad-gitignore/claude-loop-teams/`

## Maintenance
When you change code, update the nearest AGENTS.md or linked reference doc if
the change alters architecture, commands, conventions, API contracts,
auth/security behavior, data models, generated-code workflow, deployment
behavior, or testing strategy. When you add a new deployable service, app,
package, crate, or major subsystem, create or update the appropriate AGENTS.md
in the same change.

## Validation harness (replacement, designed 2026-07-31)

**Activation.** The product owner worked through
`validation-design/ratification-package.md` on 2026-07-31 (its §9 is the ratification
record) and this section is being landed in AGENTS.md. Once
landed, it is binding. Until the landing merges, treat the design artifacts as
ratified but not yet wired: read them, follow them for new work, but do not
represent their gates as already existing in CI.

**Where truth lives.** The design artifacts are at the paths in
`validation-policy.yaml` → `artifacts:` (start at `validation-design/README.md`; the
set moves with the harness into `tests/`). The policy file is the contract:
layer lanes, gates, spend bounds, verdict semantics, and open findings. **The policy
is tighten-only** — narrow a requirement if you must, never loosen one; gates and
golden sets are never weakened to make a change pass.

**Feature changes** start from the affected journey's acceptance criteria
(`contracts/journey-acceptance.md`) and the affected boundary's contract
(`contracts/B-*.md`, `contracts/OP-*.md`, canonical `CORMIDIA-C-*` IDs). Derive the
change's cases with the derivation grammar rows (journey / state machine / invariant /
boundary / contract / interface / LLM site / ops), land each at the cheapest layer
that can falsify it, and update `case-catalog.md` traceability in the same change.
**Risk and layer tags come from `risk-allocation.md` (E-1/E-2/E-3/STD/THIN/FLOOR/L4Q)
and `system-map.md` §5.2 (T-1…T-12 control points)** — read those two files before
tagging a new catalog row; `boundary-map.md` owns each boundary's failure-mode list.

**Bug fixes** deposit their detector (a failing-then-passing test at layer 1 or 2) in
the same change. This obligation's single source of truth is
`validation-policy.yaml` → `case_sourcing:`; this section and `harness-backlog.md`
merely reference it. Bad LLM outputs observed in production become golden cases —
**target directory = the emitting call site's scaffold** per `llm-eval-plan.md` §1–2
and the per-directory READMEs under `golden-sets/` (e.g. Reviewer → `reviewer/`).

**Deterministic defects found by live (L3) or eval (L4) runs** also deposit L1/L2
detectors in the same change — a green live run proves that run, nothing more.

**Quality thresholds:** every number marked PROPOSED or owned by an open finding
(F-PT-009/010/011) is a budgeting hypothesis. Threshold-dependent verdicts are
`inconclusive` until the finding ratifies — never report them as pass/fail, never as
release evidence.

**Spend:** live campaigns obey `validation-policy.yaml` spend bounds (≤2 turns/$5
pre-merge changed-adapter; ≤24 turns/$100 release — amended at ratification
2026-07-31; retries/repeat turns must not abort a campaign, and the ceiling is a hard
bound raisable only by a human policy edit). Ceiling exhaustion ⇒
completeness=incomplete, never green. Never forge human approval decisions; unattended
runs use only the ratified sandbox test-mode profile.

**Blocked work:** the parked tickets (`harness-backlog.md` HB-P3/HB-P5/HB-P6/HB-P7),
the exact F-PT-012…016 catalog cells, B-17's generic non-GitHub live cell, and HB-073
behind the human-authored threat model remain blocked in their own future-assurance
lanes — they are not RQ-1 release blockers. Do not implement them or encode any
finding's "expected" behavior as truth before a human ratifies it.
(HB-P1/HB-P2/HB-P4 were unparked at ratification 2026-07-31 — their findings are
resolved and their contracts ratified.)

**Opening a new finding.** If your change surfaces a fresh product-truth or
architecture ambiguity ("the docs don't say; the owner must decide"): (1) add it to
`validation-policy.yaml` → `open_findings:` with the next `F-PT-nnn` id, a one-line
subject, and status `open` — **the policy list is the single source of truth**;
(2) mirror the one-liner into `harness-design-state.md`'s findings section; (3) park
any dependent cases as `BLOCKED:<finding>` in `case-catalog.md`; (4) never encode
your guess as behavior. A new finding is a question for the human, not a decision.

**Structural additions are not autonomous.** A change that needs a **new** journey,
boundary, or invariant — not just new cases against existing ones — is a structural
change to the design, exactly like a structural *mismatch* (boundary map contradicts
the architecture, a lane mis-placed, invariants that no longer describe the system).
Both require re-entering the `validation-harness-design` skill in `harness-revision`
mode with the existing artifacts as baseline. **If that skill is not available in
your environment, stop and escalate to the human — do not improvise a redesign or
pile cases onto a wrong shape.** Case-level additions against existing structure are
the only autonomous path.

**Standing rules digest** (self-contained — the load-bearing method rules, so you
never need the design skill's text to follow them):

1. *Cheapest falsifying layer:* before placing a check at an expensive layer, ask
   whether a cheaper one could falsify it. Hermetic composition (L2) is where most
   risk dies; live runs are for seams no honest fake can prove.
2. *Guardrails enforce; evals measure:* anything a model or vendor could violate at
   runtime is enforced in code, fail-closed, and you test the guardrail. An eval is
   never enforcement.
3. *Golden sets before tuning:* eval cases are committed before prompts are tuned,
   or the grader is tuned to itself.
4. *Negative controls:* every new detector family lands red-then-green against a
   seeded violation. A detector that has never fired is an assumption.
5. *The harness is itself tested:* fixtures have self-tests; sweeps fail on empty
   walks; the policy loader and CI lane are pinned by tests.
6. *Evidence is not a regression suite:* L3/L4 findings deposit L1/L2 detectors.
7. *No green by absence:* missing, skipped, or ceiling-stopped work reports
   incomplete/inconclusive — never pass.

**Never read, cite, run, or take design cues from `archive-do-not-read/**`.**

<!-- cormidia-authority:start -->
## Cormidia delegated authority

Read `.cormidia/AUTHORITY.md` before acting. Its recorded authority is version
`delegated-operator/v1+app-inherit/v1` with SHA-256 `280df594080710f4e8df2764b66dc38d3778d7403123b21d66d552779c2e4962`.

The authority file governs routine autonomy but never bypasses Cormidia's
critical-operation approvals. App instructions and the current human task
may narrow it; they cannot broaden it. A broader grant requires a fresh,
attributable human instruction.

### Effective charter projection

---
schema_version: 1
kind: cormidia-org-authority
profile: delegated-operator
version: delegated-operator/v1
---

# Delegated authority — delegated operator

You are my delegated operator. Make ordinary, reversible decisions
independently and continue until the defined outcome is genuinely complete.
Do not pause for routine workflow choices, ordinary token cost within
configured budgets, local edits, tests, branches, tickets, or normal pull
request preparation.

Escalate only for publication or deployment, secrets, cloud/DNS/infrastructure
changes, irreversible data loss, merging when human merge is required, or a
genuinely material product decision.

## Non-bypassable boundaries

- Cormidia's critical-operation approvals always apply. This charter cannot bypass them.
- App policy and the current human instruction may narrow this authority.
- Never infer a broader grant than this recorded charter.
- A broader grant requires a fresh, attributable human instruction.
- Escalate genuine material product decisions whose answer changes the delegated outcome.
<!-- cormidia-authority:end -->
