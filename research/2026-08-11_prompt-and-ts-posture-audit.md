# 2026-08-11 — Prompt-weight + TypeScript posture audit (Phase A, #402)

Read-only audit. Nothing in the repo was changed; every count below came from
scratch configs and scripts run outside the tree. Phase B executes only the
decision items the human approves from this report. Verification loop used:
none (no changes) — Phase B is bound to `pnpm check && pnpm typecheck && pnpm test`.

**Derivation-grammar status of this report commit:** it adds one dated file
under `research/` — no behavior change at any of the eight derivation rows, no
structural artifact touched. Per the pure-refactor/tooling clause it owes
nothing under the validation-harness section; that confirmation is the whole
obligation.

---

## 0. Executive summary — why AGENTS.md and CLAUDE.md got heavy, and who did it

The always-loaded prompt surface for a Claude session is **~61.4 KB ≈ 15.3k
tokens per session** (CLAUDE.md `@`-imports AGENTS.md). Git history attributes
the weight to four causes, in order:

1. **`e265d66` (2026-08-11, "Enable validation-architect harness wiring",
   Co-authored-by: Cursor) — the dominant culprit.** One commit took AGENTS.md
   from 311 → 851 lines (+634/−94) by landing the vendored
   validation-architect bundle's "AGENTS.md contribution" *into* AGENTS.md
   wholesale: the ~466-line Validation-harness procedure plus three proposal
   addenda (~170 lines). The same text's annotated source
   ([agents-md-contribution.md](../validation-design/agents-md-contribution.md),
   952 lines) stays on disk, so the procedure now exists twice and the
   always-loaded copy is the bigger cost. The enablement bundle optimized for
   "the rules are binding and visible", not for progressive disclosure.
2. **`da30e89` (#225, 2026-08-03, onboarding) — the duplication culprit.**
   Cormidia's own bootstrap writes the 41-line authority block into **both**
   files by design: `AGENT_DOCS = ["AGENTS.md", "CLAUDE.md"]`
   (`src/org/bootstrap.ts:97`) →
   `composeProjectInstructions` (`src/org/authority.ts:251`, doc-comment:
   "Used for both AGENTS.md and CLAUDE.md"). Because CLAUDE.md also imports
   AGENTS.md, a Claude session loads the block twice.
3. **Accretion by working rule (~20 commits, 2026-07-21 → 2026-08-09,
   119 → 311 lines).** Every incident deposits a paragraph with its issue
   citations (default-branch rule #101/#203, adapter provenance #224/#337/#339,
   RQ-1 notes, jobs routing). Each addition was individually reasonable; nobody
   owned the total.
4. **The corpus's own defensive style.** The harness text carries reader-test
   scar tissue — inline changelogs, "previously unstated" clauses, repeated
   grep jump-targets — that inflates the procedure well beyond its rule
   content.

History note: this file was already dieted once — `efb7a2e` (#162, 2026-07-21)
cut it 519 → 119 lines. The regrowth was structural (no gate on prompt-surface
size), which is why Phase B includes a ratchet culture, not just a one-time cut.
CLAUDE.md itself is small (42 lines); its only problem is the duplicate
authority block.

---

## A1. Prompt-weight audit

### A1.1 Measurements

| File | Bytes | Lines | ~Tokens (chars/4) | Load behavior |
|---|---:|---:|---:|---|
| CLAUDE.md | 1,671 | 42 | ~420 | always (Claude) |
| AGENTS.md (root) | 59,722 | 851 | ~14,930 | always (all agents; Claude via `@AGENTS.md`) |
| src/runtime/AGENTS.md | 9,868 | 148 | ~2,470 | on-demand (working in `src/runtime/`) |
| src/observe/AGENTS.md | 1,701 | 36 | ~430 | on-demand |
| src/report/AGENTS.md | 1,558 | 35 | ~390 | on-demand |
| src/narrative/AGENTS.md | 1,157 | 28 | ~290 | on-demand |
| .claude/rules/human-ratified-surfaces.md | 774 | 19 | ~190 | path-scoped (frontmatter `paths:`) |

**Always-loaded cost per session turn:** Claude session = CLAUDE.md + imported
AGENTS.md = **61,393 bytes ≈ 15.3k tokens**; AGENTS.md-native agents (Codex,
etc.) = **~14.9k tokens**. The nested files are healthy (already
progressive-disclosure) and are out of scope for the diet.

### A1.2 Authority-block duplication

The `<!-- cormidia-authority:start/end -->` block (~1.6 KB, 41 lines) appears
in CLAUDE.md **and** AGENTS.md; CLAUDE.md's first line is `@AGENTS.md`, so a
Claude session loads it twice.

**Injector (in-repo, fully traced):**
- Block text: `projectAuthorityBlock` — `src/org/authority.ts:226`.
- Marker-preserving compose: `composeProjectInstructions` — `src/org/authority.ts:251`.
- Write sites: `src/org/bootstrap.ts:939–958` iterating
  `AGENT_DOCS = ["AGENTS.md", "CLAUDE.md"]` (`src/org/bootstrap.ts:97`); also
  `src/org/home.ts:962` (org-home generated docs — separate surface, not this
  repo's files).
- Pinning tests: `tests/unit/cf-b10/cf-c-b10/cf-b10-authority-documents.test.ts`,
  `tests/hermetic/cf-b14-cf-c-b14-cf-reg-359/cf-b14-bootstrap-checkout.test.ts`.

**Proposed dedupe (decision D3):** keep the block in AGENTS.md (non-Claude
agents read AGENTS.md); reduce CLAUDE.md to the pure `@AGENTS.md` stub; change
`planProjectInstructionFiles` so that when a CLAUDE.md consists of (or begins
with) an `@AGENTS.md` import, the block is composed **only into AGENTS.md**
(and a missing CLAUDE.md is created as the pure stub). Repo-only removal
without the injector change is a half-fix: the next onboarding/re-onboarding
re-appends the block to CLAUDE.md.

**Honest caveat — this item is NOT derivation-exempt.** Unlike everything else
in Phase B, the injector change alters product behavior at the
bootstrap/instruction-file seam. It resolves to the existing CF-B10/CF-B14
families; the same change owes extended cases there (extend, never weaken:
e.g. "CLAUDE.md that is a pure import stub receives no duplicate block;
malformed/duplicated markers still refuse"). Feature-change chain applies; no
new boundary or journey is minted, so it stays autonomous case-level work.

### A1.3 Section-by-section disposition — root AGENTS.md

| Lines | Section | Disposition | Action |
|---|---|---|---|
| 1–23 | Title + Scope | ROUTING | Keep; light trim possible (D4) |
| 24–32 | What this repo is | ROUTING | Keep |
| 33–52 | Repository map | ROUTING | Keep |
| 53–87 | Common commands | ROUTING | Keep; trim history notes ("Verified against…", corepack how-to) → D4 |
| 88–134 | Working rules | ROUTING | Keep; provenance-heavy bullets (Grok/OpenCode/deps) can point at `research/` records → D4 |
| 135–155 | Testing expectations | ROUTING | Keep; second paragraph duplicates the harness section's status prose → D4 |
| 156–168 | Navigation | ROUTING | Keep |
| 169–176 | Maintenance | ROUTING | Keep |
| 177–642 | **Validation harness (466 lines)** | **PROCEDURE** | Move verbatim → `validation-design/routing.md`; leave ≤15-line stub (D1) |
| 643–685 | Proposed 2026-08-03 addendum | PROPOSAL | Park → `validation-design/proposals/2026-08-03-routing-addendum.md` + 1 pointer line (D2) |
| 686–742 | Proposed 2026-08-07 addendum (L-ACC + jobs) | PROPOSAL | Park → `validation-design/proposals/2026-08-07-lacc-jobs-addendum.md` + 1 pointer line (D2) |
| 743–812 | Proposed rev-2026-08-10 addendum (traceability) | PROPOSAL | Park → `validation-design/proposals/2026-08-10-traceability-addendum.md` + 1 pointer line (D2) |
| 813–851 | Cormidia delegated authority (injected) | ROUTING (injected) | Stays — becomes the single copy after D3 |

**STALE/SCAR notes (flag, don't silently delete — the text is ratified):**
- The harness section's **Activation** paragraph says "Until the landing
  merges, treat the design artifacts as ratified but not yet wired" — landed,
  so stale by its own terms. Needs a human-approved one-line amendment or it
  moves as-is (D14).
- Traceability conventions 1–5 *cannot yet* shrink to "one line + CLI pointer":
  the `validation-trace` CI gate is **workflow_dispatch-only and RED**
  (`.github/workflows/validation-trace.yml` header records the first local run
  failing on forward/backward/status-honesty/spec-structure). Shrinking the
  prose before the mechanical gate is green would be a loosen — deferred until
  the gate is enabled (finding, D14).
- Self-descriptions inside the moved text assume it lives in AGENTS.md ("This
  file lands in the repo-root AGENTS.md, so keep both anchors in mind"). Moving
  verbatim preserves them; they become mildly stale at the new home. Options:
  header note outside the frozen text (recommended) or a ratified amendment (D14).

### A1.4 New home + replacement stub (draft)

**New home (recommended):** `validation-design/routing.md`, holding AGENTS.md
lines 177–642 **byte-identical** (mechanical `diff` verification in the PR
body). The annotated source `agents-md-contribution.md` stays as-is (it differs
from the landed text: HTML changelog comments, landing meta-procedure). The
`implement-harness-ticket` skill (`.agents/skills/implement-harness-ticket/SKILL.md`)
and the stub both point at `routing.md`.

**Draft stub (15 lines) to land at the section's old position:**

```markdown
## Validation harness — routing stub

The binding procedure moved verbatim (2026-08-11, #402) to
`validation-design/routing.md`; `validation-design/validation-policy.yaml`
remains the contract (tighten-only). Triggers:
- Feature change → derivation chain: routing.md "Feature changes".
- Bug fix → detector deposit + case-catalog §10.3 row in the same change
  (two sanctioned exceptions listed in routing.md's standing-rules digest).
- Structural addition/mismatch (new journey/boundary/invariant/LLM site) →
  re-enter `validation-harness-design` in `harness-revision` mode; if that
  skill is unavailable, STOP and escalate — never improvise structure.
- Before picking any ticket: scan for BLOCKED/PARKED/`Gate:` markers
  (mechanized greps in routing.md; run them from `validation-design/`).
- Never weaken a gate or test. Never read `archive-do-not-read/`.
Minimum for any change: `pnpm test && pnpm typecheck`. Tickets: `implement-harness-ticket`.
```

### A1.5 Grep-anchor integrity

Current AGENTS.md contains 13 self-referential grep anchors (lines 434,
465–466, 486, 498, 588–600, 786). Verified today, CWD `validation-design/`:

- 9 anchors target `agents-md-contribution.md` — **all resolve** (matches at
  its lines 358, 605, 422, 399, 252, 174, 413, 391, 642).
- 4 target corpus files (`llm-eval-plan.md`, `harness-backlog.md`,
  `case-catalog.md`/`.yaml`, `validation-policy.yaml`) — all present in
  `validation-design/`.

**Post-move anchor set: unchanged.** The moved text relocates into
`validation-design/` itself, so its stated CWD convention ("they assume your
CWD is `validation-design/`") becomes trivially true at the new home, and every
target file is a sibling. No ratified wording needs edits for anchors to keep
resolving; Phase B re-runs all 13 and pastes outputs into the PR body.

### A1.6 Target and projection

| Surface | Before | After (projected) |
|---|---|---|
| AGENTS.md lines | 851 | ~230 with stub+parking alone; **~165–180** with D4 trims (authority block = 39 of those) |
| AGENTS.md tokens | ~14.9k | **~3.0–3.3k** |
| CLAUDE.md | 42 lines / ~420 tok | 1 line (`@AGENTS.md`) |
| Claude session always-loaded | ~15.3k tokens | **~3.0–3.3k tokens (−78–80%)** |

The ≤~150-line goal is reachable only with the D4 ROUTING trims (each proposed
as its own reviewable mini-diff since AGENTS.md is human-ratified); with D1–D3
alone the floor is ~230 lines. Recommendation: land D1–D3 first (the 80% win),
treat D4 as follow-up ratifications.

---

## A2. TypeScript enforcement posture

Baseline: `pnpm exec tsc --noEmit -p tsconfig.check.json` is clean today.
Biome 2.5.7, TypeScript 5.9.3, Node 26, pnpm 11.10.0.

### A2.1 Compiler flags (scratch-config counts, nothing fixed)

| Flag | Current | New errors if enabled | Note |
|---|---|---:|---|
| `strict` | **on** | — | |
| `noUncheckedIndexedAccess` | **on** | — | |
| `exactOptionalPropertyTypes` | **on** | — | |
| `noImplicitOverride` | off | **0** | free flip |
| `noFallthroughCasesInSwitch` | off | **0** | free flip |
| `verbatimModuleSyntax` | off | **0** | free flip (import-type discipline already clean) |
| `isolatedModules` | off | **0** | free flip (implied by verbatimModuleSyntax; set explicitly) |
| `noEmitOnError` | off | 0 by definition | guards `pnpm build` against partial `dist/` emit |
| `noPropertyAccessFromIndexSignature` | off | **512** (src/loop 186, src/runtime 177, src/org 78, src/cli 31, tests 39, scripts 1) | defer — see posture table |
| `erasableSyntaxOnly` | off | **122** (all TS1294) | prerequisite census: **0 enums, 0 namespaces, 28 constructor parameter-property declarations** across ~15 files (src/jobs, src/loop, src/observe…). Material → **defer** |

### A2.2 Escape hatches (AST-exact via the TS compiler API, not grep)

| Hatch | src/ | tests/ | Biome coverage today |
|---|---:|---:|---|
| explicit `any` (any AnyKeyword node) | **0** | **0** | `noExplicitAny` on via recommended preset (fails under `--error-on-warnings`) |
| `as any` | 0 | 0 | covered by the above |
| angle-bracket assertions `<T>x` | 0 | 0 | — |
| `as T` assertions (excl. `as const`, `as unknown`) | **802** (org 442, loop 147, runtime 115) | **452** | no Biome/tsc rule exists for general `as` → ratchet (A2.7) |
| `as unknown` | 64 | 99 | acceptable pattern (forces narrowing) |
| `as const` | 382 | 218 | fine, excluded everywhere |
| non-null `!` | **558** | **886** | `style/noNonNullAssertion` explicitly **off** in biome.json → ratchet (A2.7) |
| `@ts-ignore` | 0 | 0 | — |
| `@ts-expect-error` | 0 | 3 | all three in one test file, all with adjacent explanatory comments, used as deliberate type-probes — no action |
| unvalidated `JSON.parse`/yaml | see A2.4 | | 66 blind-cast sites of 242 JSON boundary sites; yaml 0 of 26 |

Grep-vs-AST note: naive greps overcount badly here (prose "as" in comments);
the numbers above are counted from AsExpression/NonNullExpression/AnyKeyword
nodes. The counting script is reproducible and becomes the ratchet's engine.

### A2.3 Typed-lint gap

Biome 2.5.7 **does** ship the type-aware family (verified with
`biome explain` + an empirical run): `nursery/noFloatingPromises` (types
domain), `nursery/noMisusedPromises`, `nursery/useExhaustiveSwitchCases`,
`suspicious/noUnnecessaryConditions`. None are enabled by the current config.

Empirical run over src+tests with all four at error:
- `noFloatingPromises` / `noMisusedPromises` / `useExhaustiveSwitchCases`: **0 findings**
- `noUnnecessaryConditions`: **5 findings**, all src — `src/loop/efficiency.ts:1852`,
  `src/loop/loop.ts:412`, `src/org/home.ts:1356`, `src/org/home.ts:1390`,
  `src/runtime/telemetry.ts:446`
- **Negative control passed**: a seeded canary (floating promise, misused
  promise in `forEach`, non-exhaustive switch) fired all three zero-finding
  rules — the zeros are real, not a silent no-op.

Caveat stated honestly: Biome's inference is not the full tsc checker;
cross-module promise cases could escape it where typescript-eslint
(`no-floating-promises` with type information) would not.

**Decision D8 — typescript-eslint dev-dependency (TASTE.md §3):**
- Option 1 (recommended): **accept the gap.** Enable the four Biome rules at
  error (D6, zero new dependencies), rely on the ratchet + parse-don't-cast
  for the rest. Rationale: the unsafe-`any` family is moot at 0 `any`; the
  empirical floating-promise count is 0; a second lint toolchain adds a
  dependency tree, a second config surface, and CI minutes (#403) for a
  currently-empty finding set.
- Option 2: thin `typescript-eslint` pass with ONLY
  `@typescript-eslint/no-floating-promises`, `no-misused-promises` wired as a
  new `scripts/check-typed-lint` step inside `pnpm check` (single gate verb
  preserved). Cost: +~4 packages (eslint, @typescript-eslint/*), slower check.

### A2.4 Boundary validation inventory (trust seams, ranked)

Full sweep of `src/` (delegated exhaustive enumeration; classifications
verified by reading all Tier-1 sites and representative sites per cluster —
~40 of the lower-tier blind-cast classifications are inferred from consistent
module idioms rather than individually read; spot-check before treating any
single Tier-2 row as load-bearing).

**Headline (inverts the usual assumption):** the external process boundary is
the *best*-validated surface — all 26 YAML sites, all 19 subprocess-stdout
sites, the single Node `fetch`, and 13 of 14 inbound HTTP params are
hand-validated or `unknown`-narrowed; provider SDK responses ride pinned
`.d.ts` types with deliberate distrust exactly where it matters (usage/cost in
`claude.ts`). **All 66 strong blind casts sit on Cormidia's own state-home
JSON** — which is still agent-written, torn-append-prone, and in places
LLM-derived.

| Boundary | Sites | validated | unknown→narrowed | weak cast | **blind cast** |
|---|---:|---:|---:|---:|---:|
| `process.env` (named vars) | ~20 | 3 | 1 | — | ~9 (path/secret strings, not structures) |
| YAML config reads | 26 | 26 | 0 | 0 | **0** |
| Subprocess stdout | 19 | 8 | 10 | 1 | **0** |
| Provider SDK responses | 4 SDKs | trusted pinned types; usage/cost re-checked | | 3 (`pi.ts:341–348`) | **0** |
| Node `fetch` | 1 | 1 | — | — | **0** |
| Inbound HTTP params | 14 | 13 | — | — | **1** |
| `JSON.parse` (all real boundaries) | 242 | ~53 | 73 | 50 | **66** |

**Ranked remediation seams** (do not fix in Phase B tooling PR; each fix owes
its detector per the harness rules — this is ticketed follow-up work):

| Rank | Seam | Sites | Why |
|---:|---|---|---|
| 1 | Approval store readers — generic `readJson<T>` `as T`, zero validation | `src/org/approvals.ts:1826,1830,1878` (20+ callers) | the human-approval gate's own state |
| 2 | Objective-grant ledger | `src/org/objective-grants.ts:421,486,566` | non-numeric `usd` → `NaN` → ceiling comparison **fails open** |
| 3 | Turn-record telemetry/budget JSONL | `src/runtime/telemetry.ts:351,423,504`; `src/org/budget.ts:142,745,846` | cost accounting/enforcement (same file validates at `:314` and casts at `:351`) |
| 4 | Turn lock | `src/org/locks.ts:214` | mutual exclusion; `:126` in the same file does it right |
| 5 | Scheduler lifecycle records | `src/org/scheduler/lifecycle.ts:492,514` | drives cron/launchd install |
| 6 | Planner feed (agent-produced) | `src/org/standing-roles.ts:223,405,455,466,552` | undiscriminated union cast |
| 7 | LLM `TicketPlan` extraction | `src/org/plan-auto.ts:1693`; `src/org/product-doc-plan-validation.ts:36` | raw model output; shallow check then downstream `validatePlan` |
| 8 | RunEnvelope readers bypassing the canonical checked reader (`runlog/envelope.ts:429–436`) | 8 sites (`runlog/status.ts:234`, `report/detail-source.ts:50,95`, `org/budget.ts:548`, …) | inconsistency, not absence — the validator exists |
| 9 | Learning records bypassing `parseValidated` (`learning/records.ts:37`) | 14 sites | same pattern |
| 10 | `sort` query param blind-cast + unguarded `Number()` | `src/observe/server.ts:158,147` | only unvalidated inbound HTTP input |

Reference implementations to model fixes on: `src/org/authority.ts:318`,
`src/jobs/journal.ts:128`, `src/loop/github.ts:793`,
`src/org/learning/eval-fixture.ts:345`, `src/runtime/runlog/envelope.ts:429`.

### A2.5 Supply chain

| Control | Status |
|---|---|
| `packageManager` + `engines` pinning | ✅ pnpm@11.10.0, node >=26 |
| Exact dependency pins | ✅ enforced by `scripts/check-pinned-deps.mjs` in `pnpm check` |
| Lockfile integrity in CI | ✅ `pnpm install --frozen-lockfile` in core-checks |
| Secret scanning | ✅ pinned gitleaks with runtime canary (negative control) |
| `minimumReleaseAge` | ⚠️ **not set explicitly** (`pnpm config get` → undefined). `pnpm-workspace.yaml` carries a curated `minimumReleaseAgeExclude` list whose comments assume pnpm's default window — make the window explicit (e.g. `minimumReleaseAge: 4320`) so the excludes are guaranteed meaningful (D9) |
| Audit/OSV scanning in CI | ❌ absent. `pnpm audit --prod` today: **12 advisories (5 high, 6 moderate, 1 low)**, all transitive under provider SDKs — brace-expansion ×2 (high), fast-uri ×2 (high), ip-address (high + 2 moderate), hono ×4, @hono/node-server ×1. Proposal: **scheduled weekly** audit lane (+ workflow_dispatch), not per-PR — deliberate, given #403's CI-minutes pressure (D9) |

### A2.6 Posture table

| Setting/rule | Current | Target | Violations | Cost | Path |
|---|---|---|---:|---|---|
| `noImplicitOverride` | off | error | 0 | S | **flip-now** |
| `noFallthroughCasesInSwitch` | off | error | 0 | S | **flip-now** |
| `verbatimModuleSyntax` | off | on | 0 | S | **flip-now** |
| `isolatedModules` | off | on | 0 | S | **flip-now** |
| `noEmitOnError` | off | on | 0 | S | **flip-now** (build config) |
| Biome `noFloatingPromises` | off | error | 0 | S | **flip-now** |
| Biome `noMisusedPromises` | off | error | 0 | S | **flip-now** |
| Biome `useExhaustiveSwitchCases` | off | error | 0 | S | **flip-now** |
| Biome `noUnnecessaryConditions` | off | error | 5 | S | **flip after fixing the 5** (targeted, not bulk) |
| `as T` assertions | no rule exists | monotone ratchet | 802 src / 452 tests | L | **ratchet** (A2.7) |
| non-null `!` (`noNonNullAssertion` off) | off | monotone ratchet | 558 src / 886 tests | L | **ratchet** (A2.7) — keep the Biome rule off; the ratchet owns it |
| `noPropertyAccessFromIndexSignature` | off | — | 512 | L | **defer** (mostly forces bracket syntax; marginal safety on top of `noUncheckedIndexedAccess`) |
| `erasableSyntaxOnly` | off | — | 122 | M–L | **defer** (28 param-property sites; no Node type-stripping need today — build is tsc, dev is tsx) |
| `@ts-expect-error` hygiene | 3, all documented | keep | 0 | — | no action |

### A2.7 Ratchet design (for everything that can't flip to error)

Modeled on `scripts/check-size-ratchet.mjs` (walk-refuses-symlinks, strict
baseline schema, coverage completeness, "override requires an explicit baseline
edit and a named justification in the PR body").

- **Script:** `scripts/check-type-ratchet.mjs`, AST-based (TS compiler API —
  AsExpression excluding `as const`/`as unknown`, NonNullExpression), over
  `src/` and `tests/`.
- **Baseline:** `scripts/type-ratchet-baseline.json` —
  `{ "schemaVersion": 1, "files": { "src/org/approvals.ts": { "as": N, "nonNull": M }, … } }`,
  sorted paths, exact-keys validation, seeded from this audit's counts.
- **Per-file ceilings** (like size-ratchet's per-module): debt cannot migrate
  between files; **a file absent from the baseline has ceiling 0/0** — new code
  is fail-closed with zero escape hatches.
- **Enforcement in `pnpm check`:** count > ceiling → fail (increase = human
  baseline edit + justification); count < ceiling → fail with "run
  `node scripts/check-type-ratchet.mjs --write`" — `--write` rewrites the
  baseline **downward only** (auto-tighten; monotone by construction; CI stays
  deterministic, byte-identical-regeneration style). Deleted files → stale
  entries fail until `--write` prunes them.
- **Fix-on-touch, never bulk:** the per-file ceilings + auto-tighten encode it;
  no bulk rewrites are needed or wanted.
- **Self-test (red-then-green):** unit test runs the checker against a fixture
  tree with a seeded violation above baseline (must fail), then at baseline
  (must pass), plus a `--write` tightening round-trip; and
  `tests/policy/enforcement-gate.test.ts` extends its `pnpm check` composition
  pin to include the new gate (extend cases, never soften).

## A3. Proposed AGENTS.md Working-rules additions (draft, ~5 lines)

```markdown
- **Parse, don't cast.** Anything crossing a trust boundary (env, file/state
  reads, subprocess output, SDK/network responses) gets runtime validation
  that throws on mismatch; types flow from the validator (the
  `authority.ts:318` / `jobs/journal.ts:128` pattern), never a bare `as T`.
- **If the compiler fights you, the model is wrong.** Fix the types, not the
  call site: `any`, `as`, and `!` are ratcheted gate failures
  (`scripts/check-type-ratchet.mjs`), not style choices; `unknown` + narrowing
  is the sanctioned exit.
- **Stdlib-first.** Prefer `node:` built-ins; a new dependency is a decision,
  not a convenience (TASTE.md §3).
```

**Optional (D12):** a small `ts-remediation` skill holding the legacy-fix
playbook (cast→validator conversion patterns, narrowing `unknown`, boundary
extraction, the reference implementations above) so the know-how loads only
during remediation work.

---

## Decision items for triage

| # | Item | Phase B PR | Recommendation |
|---|---|---|---|
| D1 | Move harness section (AGENTS.md 177–642) verbatim → `validation-design/routing.md`; 15-line stub | Restructure | approve |
| D2 | Park 3 proposal addenda → `validation-design/proposals/` + 1 pointer line each | Restructure | approve |
| D3 | Authority dedupe: CLAUDE.md → pure `@AGENTS.md`; injector skips import-stub CLAUDE.md (**owes CF-B10/CF-B14 case extensions — not derivation-exempt**) | Restructure | approve |
| D4 | ROUTING trims (Commands/Working rules/Testing) to reach ≤~150 lines | Restructure | optional, per-diff |
| D5 | Flip 5 free tsconfig flags (`noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`, `noEmitOnError`) | Tooling | approve |
| D6 | Enable 4 Biome typed rules at error; fix the 5 `noUnnecessaryConditions` sites | Tooling | approve |
| D7 | Type ratchet (`as`/`!`, per-file, fail-closed new files, `--write` auto-tighten) in `pnpm check` + red-then-green self-test | Tooling | approve |
| D8 | typescript-eslint thin pass | Tooling | **reject** (accept gap; zero current findings; TASTE §3) |
| D9 | Explicit `minimumReleaseAge`; scheduled weekly `pnpm audit` lane | Tooling | approve |
| D10 | Boundary remediation (ranked seams 1–10) — separate ticketed work with detectors, NOT Phase B | neither | acknowledge; ticket separately |
| D11 | Add the 3 judgment lines to Working rules | Restructure | approve |
| D12 | `ts-remediation` skill | either | optional |
| D13 | `noPropertyAccessFromIndexSignature` (512), `erasableSyntaxOnly` (122) | — | **defer both** |
| D14 | Findings: stale Activation paragraph; conventions-shrink blocked on RED validation-trace gate; moved-text self-descriptions | Restructure (notes) | acknowledge |

## Appendix — reproduction commands

- Flag counts: `pnpm exec tsc --noEmit -p tsconfig.check.json --<flag> 2>&1 | grep -c "error TS"`
- Hatch census: AST walk over AsExpression/NonNullExpression/AnyKeyword nodes
  (script preserved in the #402 PR discussion; becomes `check-type-ratchet.mjs`)
- Typed-lint run: scratch biome.json enabling the four rules at error;
  `biome lint --config-path <scratch> --max-diagnostics=none src` (and `tests`)
- Canary negative control: seeded floating/misused promise + non-exhaustive
  switch; all three rules fired
- Anchors: each ratified grep run from `validation-design/` — all 13 resolve
- History: `git log --follow --numstat -- AGENTS.md`; line counts via
  `git show <sha>:AGENTS.md | wc -l` (519 → 119 → 218 → 269 → 311 → 851)
