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
`agent-skills/cormidia/` skill is the separate org-operation guide, and
`agent-skills/cormidia-job/` the separate ad-hoc-job guide.

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
| `src/jobs/` · `docs/jobs/` | Ad-hoc dependency-ordered job graphs (`cormidia-job`, a SECOND binary) — non-product org work, deliberately outside the governed build loop: no review, verdict, ticket, or GitHub authority |
| `agent-skills/cormidia/` | Packaged `$cormidia` Agent Skill (org operation, not development) |
| `agent-skills/cormidia-job/` | Packaged `$cormidia-job` Agent Skill (ad-hoc job graphs; its description routes product work back to `$cormidia`) |
| `validation-design/` | Ratified harness design (2026-07-31): `validation-policy.yaml` is the contract, `harness-backlog.md` the build plan — see "Validation harness" section below |
| `tests/` | Implemented replacement validation harness plus explicitly authorized L3/L4/L5 campaign runners (per `validation-design/`); `tests/campaign/acceptance/` is the L-ACC outcome-acceptance lane — run 1 stopped at its plan gate on 2026-08-08, and it gates nothing (F-PT-029) |
| `archive-do-not-read/` | Frozen pre-rebuild validation corpus (old `test/`, `eval/`, `docs/testing/`, eval/CI scripts) — **never read, cite, run, or take design cues from it** |
| `research/` | Dated decision records (adapter facts, caching economics, live evidence) |
| `scripts/` | Link/smoke/packaging scripts |
| `scripts/self-hosted-runner/` · `docs/ci/` | Pinned ephemeral Mac-backed GitHub Actions runner appliance and operator runbook |

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
- Local product install: `pnpm link:local` (source-backed `cormidia` and
 `cormidia-job` bins + both skill links; later source edits need no relink).
 It never exercises `dist/`; `pnpm install:packaged` stages npm's real global
 layout in a disposable prefix, then transactionally promotes only ownership-
 proven package/bin/skill artifacts. Source conversion requires
 `--replace-source-links`; foreign collisions fail before target mutation.
 `scripts/lib/link-artifacts.mjs` is the single install table — a new binary
 or skill is added there, not in each installer (pinned by
 `tests/unit/cf-reg-359/`).
- CLI: `pnpm dev <cmd>` in source mode; the full catalog with flags and
 caveats is README → Commands (substitute `pnpm dev` for `cormidia`), plus
 `cormidia <cmd> --help`.
- Packaging checks: `pnpm smoke:onboarding` · `npm pack --dry-run` ·
 `pnpm smoke:package -- <absolute-tarball>` (runs two real npm-global installs
 in a disposable prefix, every declared `bin`, and all temporary skill links).
- CI runner: `pnpm ci:runner -- build|doctor|once|serve|status|service-install` —
  GitHub orchestrates; internal PR/main Core Checks use the disposable Mac-backed
  Linux ARM64 appliance; fork PRs and explicit SHA-guarded fallback stay hosted;
  release/publication is always GitHub-hosted. See `docs/ci/self-hosted-runner.md`.
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
- Jobs (ad-hoc graphs, `cormidia-job`): `docs/jobs/design.md` — §3 is the
 non-inherited-guarantee list; it is NOT the build loop and must not be reached
 for when the work belongs to a product
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
set moves with the harness into `tests/`). **Path convention, whole file**: bare *design-artifact* filenames resolve relative to
`validation-design/` — the closed rule is: **every artifact the policy
`artifacts:` block lists with a `./` prefix** (`case-catalog.md`,
`boundary-map.md`, `risk-allocation.md`, `contracts/…`, `llm-eval-plan.md`,
`system-map.md`, `harness-backlog.md`, and the rest — the list here is
illustrative, the `./`-prefix rule is exhaustive); paths that are plainly repo-root — `acceptance/**`,
`docs/**`, and the protocol surfaces (`TASTE.md`, `roles.yaml`, `pipelines.yaml`,
`prompts/**`, `PURPOSE.md`) — resolve from the repository root. **Scope of the
machine-readable resolver, precisely**: `validation-policy.yaml → artifacts:`'s `./` vs `../`
prefixes machine-resolve **only the artifacts that block actually lists**
(corpus files plus `../acceptance/**` and two `../docs/**` design contracts);
the five protocol surfaces are NOT registry entries — their repo-root
resolution is stated HERE, in prose, and they are governed by the
ratification rules above, not by the registry. This file lands in the repo-root AGENTS.md,
so keep both anchors in mind. **Two similarly-named state files exist —
never confuse them**: `harness-design-state.md` (human-readable design/gate history;
the finding MIRROR this file tells you to update) vs `harness-state.yaml`
(machine-written run state; NEVER hand-edited — a grep for "harness state"
hits both). The policy file is the contract:
layer lanes, gates, spend bounds, verdict semantics, and open findings. **The policy
is tighten-only** — narrow a requirement if you must, never loosen one; gates and
golden sets are never weakened to make a change pass.

**Feature changes** — step zero, if your ticket does not already name the
affected structures: the honest lookup is —
identify the module your change touches from `scope-and-module-map.md` §2's
descriptions (descriptive, not an exhaustive path index), then
**reverse-read `system-map.md` §3** (which journeys exercise that module) to
get module→journey, then resolve journey→boundary/contract through
`contracts/journey-acceptance.md`'s criteria and alias table. **If that chain
does not resolve your change to a named structure, that unresolved mapping is
itself a corpus gap — open a finding and escalate; never substitute
intuition.** Worked example of the chain, **with
the substrate branch the chain needs — and the branches are ADDITIVE, not
mutually exclusive**: (a) **shared seam/substrate code with
no module owner** (e.g. the GitHub transport itself — scope-map §2 calls
GitHub substrate) resolves **directly to its boundary** (GitHub retry/backoff
→ **B-01**), then read the boundary's own journey list in `boundary-map.md`
(B-01 lists nine) and narrow by your changed call sites and the ticket's
scope — **J-04 applies only when the ticket/path specifically scopes the
delivery loop**, not by default; (b) **module-owned code interacting with that
seam** (the module map assigns clock/FS/process-adjacent code to M6, M9, M10
and others) ALSO follows the module→journey chain (scope-map §2 descriptions →
reverse-read system-map §3 → journey-acceptance.md); and (c) **the affected
set is the UNION of what both branches yield** — run every branch your change
triggers. **If the reverse-read resolves over-broadly** (a busy module appears
in many journeys' Components-crossed cells): narrow the same way the substrate branch does —
by your changed call sites and the ticket's scope; journeys your change cannot
actually reach drop out. If after narrowing the set is still ambiguous
(you cannot tell which journeys the change reaches), that ambiguity is the
escape hatch's territory: open a finding, never guess a subset. Either way, B-01's retry-budget
clause is the same worked example standing rule 1 uses for layer choice. Then
start from the affected journey's acceptance criteria
(`contracts/journey-acceptance.md`) and the affected boundary's contract
(`contracts/B-*.md`, `contracts/OP-*.md`, canonical `CORMIDIA-C-*` IDs — and note
that resolving by canonical ID matters: `contracts/provider-adapter-core.md`
(`CORMIDIA-C-CORE-001`) sits **outside** the `B-*`/`OP-*` filename shapes, and
B-02/B-03/B-04 reference it and never restate its clauses, so a literal glob
misses the shared provider core). Derive the
change's cases with the derivation grammar rows (journey / state machine / invariant /
boundary / contract / interface / LLM site / ops — where "ops" means the §8
operational-obligation matrix, contention/soak/rotation/growth/abuse; it is NOT the
`contracts/OP-*.md` operation contracts, which feed the *contract* row, catalog §5
; the rows are the eight §1–§8
matrices of `case-catalog.md`, in that order; **the
one lane outside this grammar is L-ACC (§8b): a change touching the
outcome-acceptance lane starts from the rev-2026-08-10 addendum's convention 8
plus `validation-policy.yaml → l_acc_lane` — triggered-only, no per-commit
gate, thresholds owner-ratified — instead of assembling that routing from three
scattered mentions**), land each
at the cheapest layer that can falsify it (layer definitions:
`validation-policy.yaml` → `layers:` for L1–L5; **L-ACC's lane is the separate
top-level `l_acc_lane:` block**, not nested under `layers:`), and
update `case-catalog.md` traceability **and regenerate `case-catalog.yaml`** in the
same change (same generator command as the Bug-fixes paragraph below — note
`harness-backlog.md` is always one of its two inputs, even when your change never
touches the backlog). A new family in a **triggered lane** (L3/L4/L-ACC) does not owe a
`case-catalog.md` §9.1 ledger bullet at derivation time — §9.1 is a curated
evidence ledger, updated when triggered-lane machinery or evidence actually lands
or fails, **and that update is owed in the SAME change that lands the machinery
or deposits the run's evidence record** (the implementing PR, or the campaign
record's deposit — never a later sweep),
and §9's closure counts are untouched by §10 rows and by ledger entries
alike. 
**Row tagging, with the "layer" collision flagged**: the **Layer column is the L1–L5/L-ACC execution layer**
(vocabulary: `validation-policy.yaml → layers:` / `l_acc_lane:`); **Risk tags
come from `risk-allocation.md` (E-1/E-2/E-3/STD/THIN/FLOOR/L4Q —
plus `REG`, reserved for §10.3 defect-register rows and defined in both
risk-allocation.md and the catalog legend)
and `system-map.md` §5.2 (T-1…T-12 control points — **which appear as
parenthetical annotations INSIDE the Risk column**, e.g. `E1 (T-10)`, never as
a field of their own); the THIRD required row
field — **Oracle kind** — has its vocabulary in `case-catalog.md`'s
front-matter "Row/oracle/layer keys" legend: **seven atoms**
(`state`/`evid`/`refusal`/`diff`/`det`/`stat`/`live`) **plus the composition
grammar** — `+` combines atoms, `contract` is the §5 clause-complete macro,
`stat-envelope` the deterministic wrapper around a statistical lane, `mixed`
the CF-OPS-ABUSE placeholder, and parenthetical annotations like
`(non-gating)` qualify an atom ** — read those two files before
tagging a new catalog row, **read the affected boundary's failure-mode list in
`boundary-map.md` before deriving any boundary-row case** (the section label
varies by boundary — `Failure modes:`, `Failure modes to script:`, or split
forms like B-15's `Filesystem failure modes:`/`Git failure modes:` and B-27's
`Preflight failure modes:`/`Run/report failure modes:`; grep the boundary's
section for `ailure modes` rather than assuming one canonical heading)**, **and the
remaining derivation rows have read-first sources too**:
interface-adapter rows (catalog §6) derive from `system-map.md` §1.4's
adapters-not-behaviors table; LLM-site rows (catalog §7) derive generally from
`llm-eval-plan.md`'s per-site tables (§2) — the golden-case pointer above
covers only the bad-output channel, **and feature-derived S-* quality cases
land as golden-set entries under the SAME emitting-call-site directory rule
the Bug fixes paragraph states** (target directory = the site's scaffold per
llm-eval-plan §1–2/§7); ops rows (catalog §8) derive from
`risk-allocation.md` §6 (the §8 rows cite it directly, e.g. CF-OPS-SOAK/ABUSE);
journey, state-machine, and contract rows read their own §-named sources
(`system-map.md` §1.3; for state-machine rows, **the inventory IS
`case-catalog.md` §2's own row keys** — the machines were enumerated at
derivation time and live nowhere else in-corpus, so the pointer is
deliberately self-referential; read each machine's durable-state owner in
`system-map.md` §2.2 before deriving; contract rows read the contract file itself), and read the invariant's
entry in `invariants.md` before deriving any invariant-row case — its ratified
adversarial seeds and falsifying-test shape are the row's starting material**
 .

**Bug fixes** deposit their detector (a failing-then-passing test at layer 1 or 2 —
and if an injected-fake L2 rig genuinely cannot reproduce the defect (the rare
real-dependency-only race), that inability is itself finding-worthy: open a
finding, deposit the closest achievable L2 approximation with the gap named in
its spec, and add the real reproduction to the **EXISTING relevant L3 obligation
in `validation-policy.yaml`'s block (as a trigger/case note) — no new family, no
new ticket: the §10.3 row stays the single traceability row, its Layer column
recording the L2 approximation with the L3 pointer noted** —
**never skip the deposit silently**) in
the same change, **and record the defect's traceability row in `case-catalog.md`
§10.3 — the defect register, not the §10.1/§10.2 ratified-revision tables —
regenerating `case-catalog.yaml` (command: `awk -f
validation-design/case-catalog-generator.awk validation-design/case-catalog.md
validation-design/harness-backlog.md` — the YAML's header states the regeneration
obligation; the exact command lives here and in the Adoption notes below
) in that same
change** — a defect whose cases
would need a new journey, boundary, invariant, **or LLM call site** 
is structural and re-enters
`harness-revision` instead of being force-fit into a row — and the **same
skill-unavailable rule as the structural-additions section applies on this path
too: stop and escalate to the human, never improvise the structural change
mid-fix** . **May the CODE fix land before the
revision resolves?** The mid-change
disposition's split rule applies here explicitly: the code fix may land first
**only if it stands alone without encoding the missing structure**, and its
detector deposit — being structure-dependent — is **parked in the change
description as pending-the-revision, citing the revision entry**; that parked
deposit is the one sanctioned exception to "never skip the deposit silently"
besides the L2-irreproducible race. A fix whose code itself encodes the new
structural truth cannot land before the revision at all. Worked example of the
fork: a fix that corrects a provider-timeout calculation AND renames
the emitted terminal status `timed_out`→`interrupted` splits exactly here —
the timeout-calculation part stands alone under existing structure (land it,
deposit its detector), while the rename **encodes one side of F-PT-017's
contested enum** (it cannot land; park it and its detector
pending-the-finding/revision).
**A defect inside a `BLOCKED:<finding>`/PARKED area**: if the defect lies in territory whose cases are
finding-parked, the fix and its detector may cover **only the un-contested
deterministic part** and must not encode either side of the parked question;
if the defect IS the contested behavior, do not fix it at machine speed — the
observation is **ratification evidence**: record it on the finding (the
F-PT-006 preserve-evidence pattern) and escalate. The deposit obligation
applies to what you may lawfully fix; it never licenses resolving a parked
question. 
**Tagging a §10.3 row is simpler than tagging a feature row**: Risk is always `REG`, Layer is where the
detector lands (L1/L2 per the deposit obligation), and the feature-path
read-first obligations (boundary failure-mode list, invariant seeds) apply only
insofar as the fix touches those rows — a §10.3 deposit inherits its context
from the defect, not from a fresh derivation.
**Write-back obligation for the read-first sources**: when a §10.3
deposit — or a deterministic defect surfaced by an L3/L4 run — reveals a
failure mode absent from the affected boundary's `Failure modes:` list, or an
adversarial shape absent from the invariant's `Adversarial seeds`, the **same
change appends it to that artifact** with a dated changelog comment. This is
additive enrichment of ratified text with observed reality — tighten-only, NOT
a structural event and NOT a finding. If instead the observation *contradicts*
the recorded text or shape, that is the clause-vs-shape routing above, not an
append. Leaving the read-first source silently out of date is a corpus bug;
these two files have no generator, so the append IS the regeneration
discipline.
**Ticket citation for an unplanned fix**:
the fix's spec cites its new `CF-REG-<issue>` family and **HB-139** — the
standing regression-deposit record ticket — as its owner, and the same change
appends the family to HB-139's list in `harness-backlog.md` (regenerating
`case-catalog.yaml`, which recomputes HB-139's families). No fresh ticket is
minted for an already-landed fix; that is the HB-137…139 retrospective-record
pattern.
**Minting a NEW `HB-…` ticket** (owed when traceability convention 3 leaves a
non-pruned, non-blocked family without a citing spec — e.g. a feature change
deriving a family it will not implement in the same change): take the next unused sequential id — scan
`harness-backlog.md` and `case-catalog.yaml`'s tickets list, never trust memory;
place the ticket in the backlog section matching its provenance (an existing
revision section if it fits, else a new dated section — never inside a LANDED
wave's history); give it the standard Acceptance/Defends/Layer/Executor fields;
regenerate `case-catalog.yaml` and the owner-backlog companion in the same
change. **The ordinary same-PR feature case — the third ticket-acquisition
path, previously unstated**: **every citing/implementing SPEC needs an owning-ticket header
citation, no exceptions — while a PENDING family (no spec yet, by design)
instead requires its non-LANDED owning ticket to exist and declare it** . For a family derived and implemented in
the same PR, **mint the
HB ticket in that same PR** (same next-id scan procedure), cite it in the spec
header, and let its status reflect reality on merge; convention 3's
"owns ≥1 citing spec" describes what the trace CLI verifies, never a
substitute for the citation. **Sequencing default:** derivation-first is fine —
an HB ticket need not pre-exist derivation; convention 6's
ticket-→-enumeration workflow applies when a ticket already exists (backlog
work), while fresh feature work mints its ticket in-change. Related pointers
:
"pruned" is the `PRUNE-*` vocabulary defined in `case-catalog.md`'s front
matter; a "wave" is a `harness-backlog.md` section-heading token (the
generator derives ticket wave from the section a ticket sits in). And a wholly
new **module** is not a fifth trigger: it is the SHAPE sense of the existing
structural triggers (a new state owner/failure domain); the
unresolved-mapping escape hatch is for when you cannot tell — if the answer
turns out to be "genuinely new structure," the two mechanisms converge on the
same structural path. Scope note — the **detector/catalog-row
deposit obligation above** has its single source of truth at
`validation-policy.yaml` → `case_sourcing:` (this section and
`harness-backlog.md` merely reference it); the **HB-139 citation rule and the
HB-id minting procedure are canonical only HERE**, in this routing doc — other
artifacts (the ratification package's disposition records, the state file's
summaries) may record or summarize them, and this routing document wins on
disagreement . Bad LLM outputs observed in production become golden cases —
**target directory = the emitting call site's scaffold** per `llm-eval-plan.md` §1–2
(directory enumeration and authoring priority: its §7 "Golden-set scaffolds"
)
and the per-directory READMEs under `golden-sets/` (e.g. Reviewer → `reviewer/`).
A golden-case deposit needs **no new `case-catalog.md` row**: catalog traceability
is at family granularity and the per-site quality families (CF-S*-qual) in
**`case-catalog.md` §7 — the LLM call-site matrix, a DIFFERENT §7 from
`llm-eval-plan.md` §7 "Golden-set scaffolds" cited above** — already
exist — adding a case grows the set, not the matrix. Only a bad output that exposes
a NEW call site or a deterministic envelope defect touches the catalog — **and
these two branches have DIFFERENT autonomy**: the envelope defect is the
autonomous path (a §10.3 detector row in the same change), but a genuinely NEW
call site is a **structural change** — it mints a new S-id, so it routes
through `harness-revision` (or stop-and-escalate if that skill is unavailable)
exactly per the structural-additions section, and the catalog-§7 family change
lands as part of THAT revision, never as an in-change edit — and when the
revision mints the new S-id, the same never-trust-memory discipline as its HB/CF
siblings applies: **scan for the next unused id first**
(`grep -oE 'S-[0-9]+' llm-eval-plan.md | sort -u` plus the catalog §7 rows and
`golden-sets/` directory names) . 

**Deterministic defects found by live (L3) or eval (L4) runs** also deposit L1/L2
detectors in the same change — a green live run proves that run, nothing more.

**Quality thresholds:** every number marked PROPOSED or owned by an open finding
(F-PT-009/010/011) is a budgeting hypothesis — **the numbers themselves live in
`validation-policy.yaml → proposed_register` (canonical) and are restated in
`llm-eval-plan.md` §8, governed by its §9 decision-status rule** . Threshold-dependent verdicts are
`inconclusive` until the finding ratifies — never report them as pass/fail, never as
release evidence.

**Spend:** live campaigns obey `validation-policy.yaml` spend bounds (≤2 turns/$5
pre-merge changed-adapter; ≤24 turns/$100 release — amended at ratification
2026-07-31; retries/repeat turns must not abort a campaign, and the ceiling is a hard
bound raisable only by a human policy edit). Ceiling exhaustion ⇒
completeness=incomplete, never green. Never forge human approval decisions; unattended
runs use only the ratified sandbox test-mode profile.

**Blocked work — this list is NOT exhaustive**: HB-P3 and HB-P5 (blocked on F-PT-006 and F-PT-008) and B-17's
live cell are the oldest examples, but blocked/parked work also includes HB-P6/
HB-P7, HB-073 (hash-bound gate refuses until HB-072's human-authored threat model
exists), HB-055, and every F-PT-011-gated quality verdict. **Before picking up any
ticket, scan the WHOLE of `harness-backlog.md` for `BLOCKED`/`PARKED`/`Gate:`
markers and `case-catalog.md` for `BLOCKED:<finding>` cells** — no single section
is the complete set: the backlog's "Parked" section is complete only for the
**finding-parked P-tickets** (HB-P3/P5/P6/P7), while other blocked items (HB-055,
HB-073) live inside their own wave sections, and the catalog's §9 blocked-cell
roll-up covers cells, not tickets. The scan is the guarantee; no list here is.
Mechanize it rather than reading the whole file:
`grep -niE 'blocked|parked|gate:' harness-backlog.md` and
`grep -n 'BLOCKED:' case-catalog.md` (the second catches both
`BLOCKED:F-PT-nnn` and non-finding tokens like `BLOCKED:B-17-L3`; catalog block
tokens are uppercase by grammar) from
`validation-design/`
surface every marker; read each hit's surrounding lines before treating a
ticket as pickable (the grep finds the markers — judging whether one blocks
YOUR ticket is still a read).

Do not implement blocked items, and do not
encode any finding's "expected" behavior as truth before a human ratifies it.
(HB-P1/HB-P2/HB-P4 were unparked at ratification 2026-07-31 — their findings are
resolved and their contracts ratified.)

**Opening a new finding.** If your change surfaces a fresh product-truth or
architecture ambiguity — "the docs don't say," **or the ratified text says
something observed reality contradicts** (the dominant precedent: F-PT-012, -013,
-015, -016, -017 are all ratified-contract-vs-code conflicts; the contract is
never silently rewritten from implementation behavior, and the code is never
silently "fixed" to a contested clause): (1) add it to
`validation-policy.yaml` → `open_findings:` with the next `F-PT-nnn` id — **found
by scanning the registry (`grep -o 'id: F-PT-[0-9]*' validation-policy.yaml |
sort -u | tail -1`), never from memory, and a historically REFUSED use of an id
does not reserve the number** (F-PT-033's precedent: refused for one subject
2026-08-10, correctly minted for another the same day) — a one-line
subject, and status `open` — **the policy list is the single source of truth**;
**minting a NEW `CF-*` family id** (the third id space; its procedure was
implicit while its siblings' were spelled out): CF ids are **semantically derived, never
sequential** — `CF-<source-row-key>-<discriminator>` where the source key is
the owning matrix row's key (journey `J04`, boundary `B01`, invariant, site
`S2`, ops, interface, or `REG-<issue>` for §10.3 deposits; observe the
precedent forms `CF-J04-S`, `CF-B01-L3`, `CF-S2-traj`, `CF-OPS-SOAK`,
`CF-IF-CLI`, `CF-REG-291`); before minting, **scan both catalog surfaces for
the proposed id** (`grep -n '<proposed-id>' case-catalog.md case-catalog.yaml`)
— a hit means collision or an existing family to extend instead; retired
families keep their ids forever, so never reuse one;
(2) mirror the one-liner into `harness-design-state.md`'s findings section; (3) park
any dependent cases as `BLOCKED:<finding>` in `case-catalog.md`; (4) never encode
your guess as behavior. A new finding is a question for the human, not a decision.

**Structural additions are not autonomous.** A change that needs a **new** journey,
boundary, or invariant — or a **new LLM call site** (the S-1…S-11 inventory in
`llm-eval-plan.md` §1 is registered structure; a new site mints a new S-id and owes
its golden-set scaffold per §1–2, same as the bug-fix channel's golden-case rule
) — not just
new cases against existing ones — is a structural
change to the design, exactly like a structural *mismatch* (the boundary map,
`system-map.md` §5.2's control points, or `risk-allocation.md`'s tiers contradict
the architecture; a lane mis-placed; invariants that no longer describe the system
).
Routing rule for **contract** contradictions specifically: a contradiction confined
to a single contract *clause* opens a finding and parks that clause's cases
`BLOCKED:<finding>` (the F-PT-017 pattern); one that invalidates the boundary's
*shape* — its ownership, failure domain, or existence — is a structural mismatch
and re-enters `harness-revision`. **The same split applies to invariants**: a conflict confined to a single invariant
*clause* (its text vs observed enforcement reality) is an ordinary finding — the
in-corpus precedent is **F-PT-014**, INV-003's never-scopeable clause with no
gate-rule mapping, opened as a finding rather than a redesign; an invariant that
no longer describes the *system* (its subject vanished, its ownership moved) is
the structural case from the trigger list above. **Worked precedent for the
SHAPE branch**: the 2026-08-07 jobs addition — a new
state owner and failure domain (M18, B-30, J-22/J-23) — correctly re-entered
`harness-revision` as a recorded revision rather than being force-fit as new
clauses on existing boundaries; when your contradiction is about WHO owns state
or WHERE a failure domain lies (not what a clause says), that is the shape you
are looking at.
Both require re-entering the `validation-harness-design` skill in `harness-revision`
mode with the existing artifacts as baseline. **What that mode produces (so this
trail does not go cold at the directory edge)**:
a harness-revision is a diff-scoped re-derivation that emits **surgical updates
to the named structural artifacts** (system-map/boundary-map/invariants →
case-catalog + regenerated YAML → backlog tickets → a ratification-package
section recording seat decisions and open findings), with inline changelogs and
reader/stakeholder gates — the recorded 2026-08-01/03/07/08/10 revisions in
`harness-design-state.md` are the worked precedents of exactly this shape.
**Availability test:** it is an invocable skill in your agent environment; if
you cannot invoke it by the name **`validation-harness-design`**, it is
unavailable — stop and escalate, never
approximate the revision by hand. **Escalation mechanics**: this is a
solo-operator install (system-map §0), so escalate = **halt the structural
work, record the blocker in the change description (PR body / commit message)
and — if it is product-truth-shaped — in a new or existing `F-PT` finding**;
there is no other person or channel to find, and the human reads exactly those
two surfaces.
**Mid-change disposition when you discover a structural mismatch**: never merge code or tests that encode
either side of the contradiction. Split the change — parts that stand alone under
the *existing* ratified structure may land normally; **structure-dependent cases
and specs are parked in the change description as pending-the-revision**
(mirroring the `BLOCKED:<finding>` discipline), and the branch holding them
waits for the revision's outcome rather than guessing it .
Definitions used above: the change description is **the PR body, or the commit
message for direct commits**,
and "the same change" means the same unit — **one PR (all its commits
together), or the one commit in a direct-commit workflow** . Separately, the
general rule for mixed work: a PR that is BOTH a bug fix and a feature addition
runs BOTH procedures — a §10.3 row for the defect and §§1–8 rows for the
feature; the two paths are per-work-item, not mutually exclusive per-change
. **If that skill is not available in
your environment, stop and escalate to the human — do not improvise a redesign or
pile cases onto a wrong shape.** Case-level additions against existing structure are
the only autonomous path.

**Standing rules digest** (self-contained for the method rules themselves — you
never need the design skill's text to follow them; borderline LAYER calls still
consult `case-catalog.md`'s precedent rows, an in-corpus pointer, not skill
text). Three embedded rules from
the prose above, re-stated as actual bullets because they were easy to
skim past mid-sentence:

- **`REG` is reserved for §10.3 rows only** — never valid on a §§1–8 matrix
 row, and tier tags never valid on §10.3 rows.
- **The deposit obligation has exactly TWO exceptions**: the L2-irreproducible
 race (→ finding + closest L2 approximation + note on the existing L3
 obligation) and the structure-parked defect (→ detector parked in the change
 description pending-the-revision).
- **A defect in `BLOCKED:<finding>`/PARKED territory splits**: the un-contested
 deterministic part may be fixed and detected; the contested behavior is never
 fixed at machine speed — it becomes ratification evidence on the finding and
 escalates.

Separately: **the eight-row derivation grammar is closed** — a risk class that
maps to none of the eight rows is by definition a new derivation dimension,
i.e. a structural mismatch that re-enters `harness-revision` . Jump targets for
the two unanchored decision points: `grep -n 'May the CODE fix land' agents-md-contribution.md`
(land-before-revision rule) and `grep -n 'Routing rule for' agents-md-contribution.md`
(clause-vs-shape split); further anchors:
`grep -niE '^\*\*minting a NEW.*(HB|CF)' agents-md-contribution.md` (reaches
BOTH minting procedures — the CF heading is lowercase, so the earlier
case-sensitive pattern hit only HB; the same-PR feature rule sits beside the HB one), `grep -n 'Write-back obligation'
agents-md-contribution.md` (boundary-map/invariants enrichment), and
`grep -n 'SAME change that lands' agents-md-contribution.md` (§9.1 ledger
timing); `grep -n 'Feature changes' agents-md-contribution.md` (the
derivation-grammar entry point itself); and two sub-obligation anchors:
`grep -n 'Ticket citation for an unplanned fix' agents-md-contribution.md`,
`grep -n 'Tagging a §10.3 row' agents-md-contribution.md`, and
`grep -n 'Escalation mechanics' agents-md-contribution.md` . **A change that derives NO cases and
touches NO structural artifact — a pure refactor, tooling/CI change, or
dependency bump — owes nothing under this section**: confirm by checking that no derivation-grammar trigger applies
(no new or changed behavior at any of the eight rows, no boundary/invariant
text touched); that confirmation is the whole obligation. **Working-directory convention for
every self-referential grep in this file**: they assume your CWD is
`validation-design/`; from the repo root, prefix the path
(`validation-design/agents-md-contribution.md`). The backlog/catalog scans
that explicitly say "from `validation-design/`" already state this.

1. *Cheapest falsifying layer:* before placing a check at an expensive layer, ask
 whether a cheaper one could falsify it. Hermetic composition (L2) is where most
 risk dies; live runs are for seams no honest fake can prove. Worked example
: the B-01
 retry-budget claim (3 attempts, jittered backoff) is fully falsifiable against
 the scripted GitHub double with an injected clock — L2, every commit; only what
 the double cannot honestly prove (the real auth handshake, real merge
 semantics) earns the spend-bounded L3 smoke. Borderline calls: imitate the
 layer-choice reasoning in `case-catalog.md`'s precedent rows — §10.3 is headed
 "Defect register," but using its rows as layer-placement precedent for feature
 cases is intended (they carry the densest worked layer/oracle reasoning in the
 corpus); the §§1–8 matrix rows serve the same way . Remember the two bounds on a
 wrong call — every family needs its negative control, and no green by absence.
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

**Never read, cite, run, or take design cues from `archive-do-not-read/**`**
(path note: it
resolves from the **repo root**; either way the instruction is don't-touch, so
resolution never changes the obligation).

---

## Proposed 2026-08-03 routing addendum — design accepted; exact edit approval pending

The text below is the proposed standing-rule addition for the
roadmap/validation/delivery/batching harness revision. The design was accepted on
2026-08-03, but the owner's acceptance expressly retained separate approval for
protocol-surface changes. It is **not yet part of the ratified verbatim section above**
and must not be represented as landed policy until its exact diff is approved.

> **Roadmap, validation and execution-batch changes** start at J-03/J-20,
> C-OP-PLAN/C-OP-VALIDATION/C-OP-BATCH, B-20/B-21/B-22 and INV-016. Code work is
> always RoadmapPlan-accounted and delivered as one independently reviewed PR per
> delivery unit, even when complete structured input makes the roadmap or
> EpisodePlanner provider turn unnecessary. Complete non-code operational work may
> omit RoadmapPlan only through the direct `ExecutionUnit` contract; it still requires
> EpisodeIntent/EpisodePlan, validation/evidence policy, and separately exact approval
> plus acknowledgement for every external payload/effect.
>
> Labels and trailers—including `op:ready`, `op:tier-*` and any
> `planning:preplanned` projection—are discoverability/state projections, never plan,
> validation, routing or effect authority. Their referenced persisted artifact and hash
> must validate independently. Batch admission is deterministic and token-free;
> EpisodePlans are created lazily per admitted unit. Affinity/cache/session reuse may
> reorder compatible same-app units, but never changes membership, priority, routing,
> validation, one-PR atomicity, per-unit budget/evidence, effect grants, or Builder/
> Reviewer independence. Cache benefit is reported only from adapter evidence and has
> no correctness effect.
>
> Changes needing a new journey, boundary, invariant, or LLM call site — the
> exhaustive structural trigger list, one rule with the structural-additions
> section above — re-enter
> `validation-harness-design` in `harness-revision` mode. Changes to TASTE.md,
> roles.yaml, pipelines.yaml, prompts/** or PURPOSE.md remain proposal-only until a
> human explicitly ratifies the exact diff. **The MECHANIC when an ordinary
> ticket needs such an edit**: mirror the mid-change
> disposition — **draft the exact protocol-surface diff and park it in the
> change description as proposal-pending-ratification (never merge it); land
> the parts of the ticket that stand alone without it; escalate through the
> same solo-operator channel** (change description + F-PT finding if
> product-truth-shaped); the ratified diff lands in its own change once the
> human ratifies it verbatim.

---

## Proposed 2026-08-07 routing addendum — outcome acceptance (L-ACC) + jobs

AGENTS.md is a human-ratified surface, so this is a **proposal with rationale**, not a
landed edit. It is deliberately short: the ratified section above already carries the
standing rules, and this only routes an agent to the two things that are new.

> **Jobs (M18).** Work on `src/jobs/` or the `cormidia-job` binary starts at J-22/J-23,
> `CORMIDIA-C-B30-001…003` and `CORMIDIA-C-OPJOB-001`. `docs/jobs/design.md` §3 is the
> non-inherited-guarantee list and is never softened: a job has no reviewer, no typed
> verdicts, no ticket machine and no GitHub. "Completed" for a job step means the
> provider returned **and** every declared output check passed; a step with no declared
> outputs is `completed (unverified)`, never bare `completed`. The journal is the sole
> completion authority — never infer completion from an output file's presence. A config
> that changed under a live journal refuses; it never resumes. INV-016 is
> **delivery-scoped** and does not reach a job step (F-PT-031); that is the invariant's
> domain being written down, not an exemption, and it is not a licence to skip the
> declared checks.
>
> **The outcome-acceptance lane (L-ACC).** It is **built and has run once**: HB-120…132
> implemented the guardrails, runner and execution layer, and run 1 reached a terminal
> stop at the unchanged rubric §6 plan gate on 2026-08-08 with an entirely
> ungraded/inconclusive distribution (`acceptance/run-1-result.md`). Do not cite it as
> a gate or as release evidence — F-PT-029 (resolved 2026-08-07) keeps it permanently
> outside RQ-1 — and never start a new campaign without an exact per-campaign human
> authorization; F-PT-030 (resolved 2026-08-07) permits unattended plan-gate
> resolution only through a config's declared `plan_gate` policy under the unchanged
> criteria, and an undeclared policy refuses.
> 
> `acceptance/rubric.md` is human-ratified and **tighten-only**: you may narrow an axis or
> a rule, never loosen one, and **you may not introduce a threshold anywhere** — every
> threshold stays unratified until a campaign produces a **graded** distribution the
> owner can ratify against. (Run 1 terminated at the plan gate entirely ungraded, so
> that condition remains unmet: the trigger is the first graded run, not "run 1" by
> number.) If a change
> seems to require loosening the rubric, stop and escalate rather than editing it.
>
> Two rules carry the whole lane and are easy to get wrong. **All campaign work runs
> through the PACKAGED `cormidia` and `cormidia-job` binaries** (`pnpm install:packaged
> --replace-source-links`; assert its exit status, never reimplement its checks) — a
> `link:local` binary is source-backed and measures the working tree, not the product.
> **And the supervisor never does the work**: an agent that runs `git`/`gh` itself, edits
> a scenario repo, or calls a provider SDK is simulating the org, and every score then
> measures the supervisor. Both are `CORMIDIA-INV-ACC-7a/7b`.
>
> Campaign invariants live in their own fenced registry (`CORMIDIA-INV-ACC-*`,
> `validation-policy.yaml` → `campaign_invariants`). They constrain the harness, never
> the product — never cite one as a product promise. All eight are mechanical guardrails
> at L1/L2 with negative controls; only the rubric's scored axes are lane work.
> `ungraded` is policy, not runner discretion (`verdict_semantics.axis_score`): it is
> never coerced to `0` and never enters an aggregate as a number.

**Rationale for landing it.** Without this addendum a coding agent reaching `src/jobs/`
has no route to B-30, and an agent reading `acceptance/` could reasonably conclude the
lane exists. Both are exactly the failure the routing deliverable exists to prevent.

---

## Proposed rev-2026-08-10 addendum — traceability conventions and machine catalog

AGENTS.md is a human-ratified surface, so this is a **proposal with rationale**.
**Provenance of this addendum**: it comes from the rev-2026-08-10 harness revision, whose
product-owner seat was an **AI stakeholder agent** — its record is
`ratification-package.md` §12, which is DRAFT pending real-human ratification.
The "must land unedited" constraint below binds the block's *wording* if adopted;
whether to adopt it at all is the human's call, like every §12 item. Two
things are new: `case-catalog.yaml` (the machine-readable companion the
`validation-trace` CLI consumes) and the normative conventions below, which the
product repo's CI will enforce via that CLI. The block is included verbatim as
required and must land unedited.

**Traceability conventions** (normative — the `validation-trace` CLI enforces their mechanical closure subset in CI):

1. **Test directories are named by case-family ID.** Specs for `CF-INV-001` live under a directory whose name contains `cf-inv-001` (case-insensitive); likewise for every other family. Helpers and fixtures that are not family-scoped may sit beside them.
2. **Spec file headers cite the family and the owning backlog ticket.** The first comment block of every `*.test.*` / `*.spec.*` file names the `CF-…` family it exercises and the `HB-…` ticket that owns it (plus the contract/invariant section it binds to). A citation the catalog does not know is an orphan — the trace CLI turns red.
3. **Every implementable family owns ≥1 citing spec, or is declared pending with its wave.** Non-pruned, non-blocked families without a citing spec must appear on a backlog ticket whose status is not LANDED. A LANDED ticket whose families lack specs is a status-honesty failure.
4. **Traceability updates in the same change as the tests.** Adding, moving, or deleting a citing spec updates `case-catalog.yaml` (and the markdown catalog it must agree with) and the backlog's status annotations in the same change — never a follow-up.
5. **The machine-readable catalog is authoritative for tools.** `case-catalog.yaml` is the companion of `case-catalog.md`; disagreement between them is a corpus bug. The markdown catalog remains the human artifact.
6. **Implement tickets via the `implement-harness-ticket` skill.** That skill is the standard path from an HB ticket to landed specs: ticket → family → ratified enumeration → red-then-green tests, with the conventions above so `validation-trace` stays green. Do not invent a parallel workflow.
7. **Regenerate `owner-backlog.md` when the backlog changes.** The companion is non-normative and living; a backlog edit that leaves the companion's ticket-ID set stale is a corpus bug.
8. **Resolve outcome-acceptance families from `acceptance/`.** An `L-ACC` family binds realistic scenario briefs and human-ratified rubric axes. Mechanical campaign guardrails (sealed answers, producer↔grader independence, preflight, spend cutoff, intermediate-gate persistence) remain layer-1/2 detectors with negative controls; do not recast a scored axis as binary merely to make it easy to implement.
9. **Outcome campaigns require fresh human authorization.** Implementing their fixtures and mechanical preflights is ordinary ticket work; running a live layer-6 campaign is not. It names its target, scenario set, spend/time ceiling, and permitted effects, and incomplete inputs or missing grader calibration produce `inconclusive`, never green.


> **Gloss (landing):** In this corpus, the design skill's "layer-6" name for the
> outcome-acceptance lane is `L-ACC`, configured at `validation-policy.yaml` →
> `l_acc_lane:` (a separate top-level block — there is no `L6` key under `layers:`).

**Adoption notes (proposal, not part of the verbatim block).**
Convention 9's phrase "a live **layer-6** campaign" uses the design skill's
six-layer taxonomy name for the outcome-acceptance lane: in THIS corpus that lane
is `L-ACC`, configured at `validation-policy.yaml` → `l_acc_lane:` (a separate
top-level block — there is no `L6` key under `layers:`). The verbatim block cannot
be edited, so this gloss lives here — **and the landing edit must carry it**: when
the conventions block lands in the real AGENTS.md, land this one-line gloss as an
adjacent line *outside* the frozen block in the same change, so the "layer-6"
phrase never appears without its resolution. 
`owner-backlog.md` (convention 7) has **no generator script by design** — it is a
consequence-language prose companion, regenerated by the editing human/agent
rewriting the affected entries from `harness-backlog.md`; the mechanical check
that you did it is the ticket-ID **set-equality** diff:
`grep -oE 'HB-[0-9P]+[0-9]*' <file> | sort -u` over both files must produce an
empty `comm -3` difference — both directions, so a stale owner-only ID fails too,
not just a missing one. 
`case-catalog.yaml` is DERIVED: regenerate it with
`awk -f validation-design/case-catalog-generator.awk validation-design/case-catalog.md validation-design/harness-backlog.md`
whenever either markdown changes — hand-editing the YAML is a corpus bug (its
header says so; HB-140 owes the CI check that enforces byte-identical
regeneration). **Fallback for convention 6 (added 2026-08-10, coding-agent
finding 3):** if the `implement-harness-ticket` skill is not available in your
environment, implement the ticket by hand following conventions 1–5 and the
red-then-green rule, and say so in the change description — the prohibition is on
inventing a *different* workflow, not on working without the skill; stop and
escalate only if the ticket's enumeration is ambiguous. **Do not confuse this
permissive fallback with the structural one**: for
`implement-harness-ticket` (THIS rule) hand-implementation is permitted; for
`validation-harness-design`/`harness-revision` (the structural-additions
section above) hand-approximation is FORBIDDEN — stop and escalate. Ticket
work may proceed by hand; structural revision never may. Existing spec
directories already follow convention 1; convention 2's header citations are owed
incrementally — add them on touch, never in a bulk rewrite that would blur authorship.
Convention 3's current pending set is recorded in `case-catalog.yaml` (notably
CF-REVIEW-PROVIDER→HB-133, the F-PT-019 leg→HB-135, CF-J21-I→HB-136, and the
comparative-execution families→HB-090…094). A structural mismatch still re-enters
`validation-harness-design` in `harness-revision` mode, exactly as the ratified
section above requires.

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
