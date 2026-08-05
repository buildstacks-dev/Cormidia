# Cormidia vs `pi` — Gap Analysis & Remediation Roadmap

Date: 2026-08-05. Method: forensic read of `pi` (`/Users/bikram/Build/pi`, 483 src
files / 109,459 lines) and `Cormidia` (`/Users/bikram/Build/Cormidia`, 246 src files /
123,217 lines). Companion documents: `pi-engineering-standards-skill.md` (the
extracted standards) and `pr-landing-plan.md` (the staged execution plan).

*Verification note:* every load-bearing Cormidia-side number below was
independently re-derived by a second method at `00e00b5` in a separate review
session (dead exports came out 993/2,545 = 39.0% vs the 980/2,532 = 38.7% quoted
here — same finding, method-boundary difference). pi's file-length distribution
(median 82 / p90 542 / max 6,353) was also independently confirmed.

## Headline comparison

| Metric | pi | Cormidia | Verdict |
|---|---|---|---|
| Median src file | **82 lines** (55% ≤100) | **268 lines** (37 files <100) | Gap |
| p90 src file | 542 | 1,309 | Gap |
| Files >1000 lines | 19/483 (3.9%) | 32/246 (13%) | Gap |
| Largest file | 6,353 | 5,551 (`roadmap-delivery.ts`) | Comparable tail; Cormidia's is worse per capita |
| Test:src line ratio | ~0.93 (101k/109k) | **0.38** (47k/123k) | Gap |
| Exported symbols | ~10 public per *package*-scale surface; 58% of functions unexported | 2,532 exports (~10/file); **38.7% never referenced outside their file** | Gap |
| Lint/format/check gate | Biome `--error-on-warnings` + 5 invariant scripts + pre-commit | **None** (no linter, no formatter, no hooks) | Gap |
| Dependency pinning | Exact, machine-enforced by script | Mixed (`^` ranges on 2 of 4 runtime deps, all devDeps) | Gap |
| `any` usage | 269 tokens (concentrated in erased generics) | **1** | Cormidia ahead |
| tsconfig strictness | `strict` + `erasableSyntaxOnly` | `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | Cormidia ahead (but missing `noUnusedLocals`/`noUnusedParameters`) |
| Test hermeticity design | Faux provider, `.inMemory()` managers | Transport doubles injected into *real* adapters + negative controls (284 uses) | Cormidia ahead in design; behind in volume |
| CI | 42-line build/check/test + audit + release automation | 96-line typecheck/build/test + gitleaks (with canary) | Comparable core; Cormidia has no check step and no release lane (suspended by decision) |

**What must NOT be "fixed":** Cormidia is already at or above pi standard on: near-zero
`any`, zero `@ts-ignore`, zero default exports, discriminated-union data modeling
(487 `kind:` literals), `as const`-derived string unions, flat class usage (only 20
non-error classes), no DI containers/factories, the CLI dispatch-table pattern, the
negative-control test discipline, self-tested fixtures, and the layered L1–L5 lane
design. Agents applying this roadmap must leave these alone.

---

## P0 — Critical Structural Gaps

### P0.1 No `check` gate: add formatter + linter + one command *(Impact: very high · Effort: low)*
Cormidia has no linter, no formatter, no `.editorconfig`, no pre-commit hook —
formatting is convention-only and nothing catches drift. pi's entire hygiene story is
one `npm run check` (Biome with warnings-as-errors + invariant scripts + `tsc`),
run by pre-commit and CI.
**Do:** add Biome (one dev dep — consistent with TASTE.md §3 "boring"), a
`pnpm check` script = `biome check --error-on-warnings` + `pnpm typecheck` +
invariant scripts (P0.3), a pre-commit hook that runs it, and a CI step. Accept one
large one-time formatting commit.
**Resolved linter stack** (supersedes an earlier ESLint-first proposal): Biome owns
format + non-type-aware lint; check scripts own repo invariants; tsconfig owns
unused-code flags. The only thing none of these can do is type-aware async linting
(`no-floating-promises` / `no-misused-promises` — a missed `await` on
`writeLoopFileAtomic` is invisible to every non-type-aware tool, and durable atomic
writes are this repo's core loop). A narrow typescript-eslint config (~3 rules, own
CI step, not pre-commit) is worth it — but it is a dependency decision for the
human, deferred; see `pr-landing-plan.md` → Open decisions.

### P0.2 Exact-pin dependencies, machine-enforced *(Impact: high · Effort: trivial)*
`@anthropic-ai/claude-agent-sdk ^0.3.201`, `yaml ^2.6.0`, and all 5 devDeps float;
`@openai/codex` and `@earendil-works/pi-coding-agent` are already exact. pi pins
everything exactly and enforces it with a ~60-line `check-pinned-deps.mjs` in the
gate. For a repo whose product *is* an autonomous org runtime, floating provider
SDKs are a reproducibility hazard.
**Do:** pin all 9, port the check script, wire into `pnpm check`.

### P0.3 Turn manual invariants into check scripts *(Impact: high · Effort: low)*
AGENTS.md says the `org → loop → runtime` import direction is "Not lint-enforced —
hold the line manually." pi's rule: if an invariant matters, a ~50-line script
enforces it (`check-ts-relative-imports.mjs` walks the AST). Cormidia already had
base-branch bugs (#101, #203) whose guards live in tests; the import direction has
no guard at all.
**Do:** write `scripts/check-import-direction.mjs` (reject `runtime→loop`,
`runtime→org`, `loop→org` imports) and add it to `pnpm check`. Candidates for the
same treatment: "no hardcoded default branch" source scan (currently a test —
fine, but the script form runs pre-commit).

### P0.4 Dead-export detection *(Impact: high · Effort: low config, medium cleanup)*
980 of 2,532 exported symbols (38.7%) are never referenced outside their declaring
file — including 452 of 854 exported interfaces (53%). pi keeps 58% of functions
*unexported*; its compiler and review culture make `export` a deliberate act.
Cormidia's tsconfig lacks `noUnusedLocals`/`noUnusedParameters` and nothing flags
dead exports.
**Do:** enable both flags; add `knip` (or a grep-based dead-export script to stay
dep-minimal) to `pnpm check`; run one mechanical de-export/deletion pass. This is
the single biggest line-count and API-surface reduction available (concrete
examples: `NotImplementedError` in `src/runtime/types.ts:321`, `VALIDATION_LAYERS`
in `src/org/roadmap-delivery.ts:53`).

### P0.5 Adopt the standards skill as an enforced agent surface *(Impact: very high · Effort: trivial)*
The bloat this analysis measures was produced by agents without density constraints.
**Do:** link `pi-engineering-standards-skill.md` from AGENTS.md (or install as a
`.claude` skill) so every future session loads the budgets (file ≤~300 lines new,
function ≤~50, export-minimal) and the never-do list.

---

## P1 — Architecture & Module Boundaries

### P1.1 Export discipline: public surface per module *(Impact: high · Effort: medium)*
`src/org/roadmap-delivery.ts` has **112 export statements** for 150 functions and 47
interfaces; `src/loop/episode-plan.ts` has 79 exports. pi's comparable core module
(`anthropic-messages.ts`, 1,351 lines) exports **2 values + 3 types** and keeps 20+
helpers file-private. Everything exported is coupling surface that tests and
siblings silently grow into.
**Do:** after P0.4's mechanical pass, hand-review the top-10 files: default every
symbol to unexported; re-export only what a *different directory* consumes. Rule
going forward: a new `export` needs an external consumer in the same change.

### P1.2 File-size budgets — split by public surface, not by line count *(Impact: high · Effort: high, incremental)*
Median 268 vs pi's 82; 32 files >1000 lines. pi proves big files are acceptable
*only* when cohesive with a tiny public surface (one wire protocol = one 445-line
file, 5 public symbols). Cormidia's giants are the opposite: many public symbols,
many concerns (P3.1).
**Do:** one budget, stated once (the skill spec §2 carries the same numbers —
earlier drafts had three competing thresholds; this is the surviving set):
**public-symbol count is the gate, line count is the smoke alarm.** New modules
≤10 exports and ≤300 lines, hard. Existing modules are frozen at a committed
baseline — may shrink or hold, never grow, on either metric; violations fail
`pnpm check` with a named PR-body justification as the only override. The ratchet
ships with a seeded-violation negative control, per the standing rule that a
detector which has never fired is an assumption. This converts "shrink
opportunistically" from an intention into a mechanism — without it, opportunistic
shrinking loses to schedule pressure every time. Do NOT mass-split existing files
in one refactor campaign.

### P1.3 Audit single-implementation interfaces — one is legitimate, two are suspect *(Impact: low-medium · Effort: low)*
*(Re-scoped after independent review and re-verification.)* `GhOps`
(`src/loop/github.ts:102`) is **not** decorative and must stay: it is a capability
contract taken as a parameter type across five `src/org` modules (`app-reset`,
`roadmap-loop-runtime`, `approval-delivery`, `turn-runner`,
`ticket-episode-runtime`) — structurally the same pattern as pi's
`FileSystem`/`Shell` interfaces. Nor does it need a test double: the harness
deliberately doubles one seam below it — the `gh` *process* boundary
(`tests/fixtures/github-double/install.ts`: "PRIMARY SEAM (one seam,
deliberately)") — so the real `GhCliOps` runs unmodified in tests, which is
exactly the transport-double pattern used for the adapters.
**Do:** leave `GhOps` alone. Examine `GitHubEventSource` (`src/org/events.ts:56`)
and `ObserveGitHubSource` (`src/observe/github-source.ts:9`) individually — each
has one implementation and no double; per interface, either delete it and export
the concrete class, or demonstrate the seam it buys. Counter-examples that are
*correct* and must stay: `Runtime` (8 implementations), `SchedulerManager` (4),
`CodexAppServerClient` (3).

### P1.4 Shared micro-helpers for the five duplicated blocks *(Impact: medium · Effort: low)*
Survey found verbatim repetition: the 5-key zero-usage literal
(`tokensIn/tokensOut/costUsd/subagentTurns/wallClockMs: 0`, 5×), an identical
`execFileSync("git", …, GIT_TERMINAL_PROMPT:"0")` block (5×), per-module
`errorMessage(error: unknown)` re-implementations, a repeated
`(root, app, id, version)` path-builder signature (5×), and the
`...(x !== undefined ? { k: x } : {})` conditional-spread tax everywhere
(`exactOptionalPropertyTypes` fallout).
**Do:** one narrow, named module each (pi style: `utils/abort.ts` = 50 focused
lines, never a `utils.ts` dumping ground): `ZERO_USAGE` const, `runGit()`,
`toErrorMessage()`, a `definedProps()`/`compact()` helper. Delete the copies.

---

## P2 — Test Infrastructure & Quality Standards

Cormidia's harness *design* (negative controls, transport doubles wrapping real
adapters, self-tested fixtures, no-green-by-absence) is ahead of pi. The gaps are
volume and hygiene, not architecture.

### P2.1 Coverage debt on the org layer *(Impact: high · Effort: high, incremental)*
Test:src ratio 0.38 vs pi's 0.93, and the largest, least-commented files
(`roadmap-delivery.ts` 5,551 lines / 0.7% comments) are exactly where an
uncorrelated-review runtime can least afford dark corners. Existing policy already
mandates detector-deposit per fix — the debt is the *stock*, not the flow.
**Do:** when P3.1 splits a giant file, land characterization tests for each
extracted seam in the same change (pi's harness pattern: script the double, assert
the event/journal sequence). Track the ratio in the wall-clock report step CI
already prints. No coverage *gate* (pi has none either; a gate invites gaming).

### P2.2 Remove dead test machinery *(Impact: low · Effort: trivial)*
`fast-check` is a devDependency imported by **zero** test files;
`src/runtime/testing/fakeRuntime.ts` (118 lines, ships in the production tree,
self-described as "exactly one scriptable double") is used by **zero** tests since
the transport doubles replaced it.
**Do:** drop `fast-check` (re-add the day a property test lands) and delete or
relocate `fakeRuntime.ts` into `tests/fixtures/` — after grepping for external
consumers, since the package publishes `dist/**/*.js`.

### P2.3 Port pi's env-isolated runner *(Impact: high · Effort: low — promoted into the gate PR)*
pi's `test.sh` runs the suite under `env -i` with a throwaway HOME, `TZ=UTC`, and
no API keys — a leaked `ANTHROPIC_API_KEY` in the developer's shell can never make
an "offline" test quietly go live. Cormidia's SessionStart hook auto-loads `.env`
into every session, so its L1/L2 lanes run with real keys present and only
convention prevents use.
**Do:** wrap `pnpm test` in an `env -i` script (or vitest `env` stripping) so the
offline lanes are *provably* credential-free. This directly strengthens the
CF-INV secret-egress posture. Independent review rated this higher than its
original P2 slot — it is a credential-egress posture issue with a ~5-line fix —
so it ships with PR 1 (see `pr-landing-plan.md`), not the P2 batch.

### P2.4 Consolidate vitest config *(Impact: low · Effort: trivial)*
`--maxWorkers=2` lives on the CLI while the config file owns everything else; no
reporters/setupFiles are configured. Move concurrency into `vitest.config.ts` so
`npx vitest run tests/unit/x` behaves identically to `pnpm test`.

---

## P3 — Code-Level Refactoring Targets

Ordered by expected line reduction × risk reduction.

### P3.1 `src/org/roadmap-delivery.ts` — 5,551 lines, 112 exports, 47 interfaces, a 35-member failure-code union, 0.7% comments
The repo's worst pi-delta in one file. It is not one subsystem; it is several
(authority acceptance, validation-catalog lifecycle, delivery state machine,
failure taxonomy) sharing a file.
**Do:** split along its export clusters into a `src/org/roadmap-delivery/`
directory (state machine / authority / catalog / codes), each module
export-minimal; expect the union to decompose per phase. Deposit
characterization tests per extracted module (P2.1). Method (refined by
independent review):
- **Run the dead-export purge (P0.4) first.** With ~39% of repo exports
  unreferenced outside their file, a large fraction of this file's 112 exports
  will disappear or go file-private — splitting before the purge designs module
  boundaries around a surface that is about to shrink.
- One export cluster per PR, **temporary barrel re-export at the original path**
  so the 18 importing files keep compiling with a zero-line diff (removal ticket
  filed; permanent aliases stay banned per the skill spec §7.9).
- **Leaf-first:** ~39% of the file (roughly lines 3,160–5,320) is pure shape
  assertions and canonicalization helpers — ~50 mostly-pure functions, nearly all
  plausible file-private after the purge. Highest value, lowest risk, extract
  first.
*Estimated outcome: same behavior, ~30–40% fewer lines after dead-export deletion
and duplication removal, with a public surface a reader can hold in their head.*

### P3.2 Redundant re-validation in the authority path *(medium impact, low effort — but decision-gated)*
`acceptValidationCatalog` asserts the shape of an argument already typed
`ValidationCatalog` (`roadmap-delivery.ts:1212`); `acceptValidationContract` runs
three assert passes on values already obtained through typed
`requireAuthority<T>` (`:1345-1372`). The disk-boundary validation is a deliberate
durable-authority posture and must stay; the *in-memory re-asserts* of
already-validated values are pure tax (pi: validate `unknown` once at the
boundary; trust types inward).
**Do:** keep exactly one assert at each JSON/disk read; delete asserts on typed
parameters. If the team judges the belt-and-suspenders posture intentional for
approvals, record that in `docs/` and exempt only the approval path.

### P3.3 564 hand-rolled `assertX`/`parseX` validators — flag, don't act *(high impact, but a ratified-surface decision)*
pi collapses validator + type + model-facing schema into one typebox definition
(`Static<typeof schema>`). Cormidia hand-rolls all validation to honor TASTE.md §3
(deps = `yaml` + 3 SDKs). Adopting typebox would delete thousands of lines but
**adding a dependency is a decision, not a convenience** — this needs a human call
(propose via the standing process; do not let an agent decide).
**Interim:** share the generic helpers (`assertString`, `assertRecord`,
`toErrorMessage`) that are currently re-derived per module.

### P3.4 `src/loop/episode-plan.ts` (3,133 / 79 exports) and `src/loop/loop.ts` (2,910)
Same treatment as P3.1, second priority. `loop.ts` at 11% comment density is
better-documented and likely more cohesive — audit export count first; splitting
may not pay there (pi tolerates large cohesive cores).

### P3.5 The conditional-spread tax *(low impact each, large aggregate)*
`...(x !== undefined ? { k: x } : {})` appears throughout src and tests as
`exactOptionalPropertyTypes` fallout. One 5-line `definedProps()` helper (P1.4)
turns each site into a single readable call. Keep the compiler flag — it is
stricter than pi and catches real bugs.

---

## Execution

The backlog above lands as **two well-scoped PRs plus one deferred follow-on
track** — staged in `pr-landing-plan.md` (which supersedes the week-by-week
sequence an earlier draft of this section carried). PR 1 is the gate
(P0.1–P0.3, P2.3, P2.4), PR 2 is the shrink-and-freeze (P0.4, P0.5, P1.2's
ratchet, P1.4, P2.2), and the decomposition track (P3.1, P3.4, P1.1, P2.1) runs
afterward, one export-cluster per PR, only if/when the human green-lights it.
P1.3's remaining audit, P3.2, and P3.3 are gated on human decisions listed in the
plan.

The enforcement principle underneath all of it, copied from pi: **a rule that
matters is a script in `pnpm check`, not a sentence in a doc.** Cormidia already
believes this for tests ("no green by absence"); this roadmap extends it to code
shape.
