# PR Landing Plan — closing the pi gaps in two PRs

Date: 2026-08-05. Companion to `cormidia-gap-analysis.md` (the backlog) and
`pi-engineering-standards-skill.md` (the standards). This plan consolidates an
earlier ten-PR staging (A–J, from a separate review session) into **two PRs done
well, plus one explicitly deferred follow-on track**. Constraint honored from that
review: the formatter must land before any size/export baseline is recorded,
otherwise the frozen baseline measures soon-to-be-stale numbers.

Each PR comes off a worktree branch; nothing lands directly on main. Both keep the
repo green at every commit (`pnpm test && pnpm typecheck`, plus `pnpm check` once
it exists).

**Staleness protocol — read this first if executing later than 2026-08-05.** Every
number in these documents (dead-export census, file sizes, duplication counts,
lockfile versions, importer counts) is *evidence captured at `00e00b5`*, not a work
order. More PRs will have merged by execution time. The executing agent must:
(1) re-derive every census and baseline from current HEAD before acting — the
dead-export list, the pin targets (pin to what the *current* lockfile resolves),
the ratchet baseline, and `roadmap-delivery.ts`'s export clusters and line
regions; (2) treat deltas as expected, not as errors; (3) if the *shape* of a gap
has changed — a linter already added, a giant file already split, a check script
already present — drop or re-scope that item rather than forcing the plan through.
The PR structure and ordering constraints (formatter before baseline, purge before
decomposition) remain valid regardless of drift.

---

## PR 1 — The gate

*Everything that makes rules mechanical. Tooling and config only — zero behavior
change to `src/` logic. Covers gap items P0.1, P0.2, P0.3, P2.3, P2.4.*

Commit sequence (reviewable independently; the formatting commit is isolated so
the substantive diffs stay readable):

1. **Add Biome + `pnpm check`.** One devDependency (exact-pinned). `biome.json`
   mirroring current conventions (2-space, double quotes, trailing commas) so the
   reformat diff is minimal. `"check": "biome check --error-on-warnings . &&
   pnpm typecheck && node scripts/check-pinned-deps.mjs &&
   node scripts/check-import-direction.mjs"` (scripts arrive in commits 3–4;
   wire them here so the script is its own single source of order).
2. **Formatting-only commit.** `biome check --write .` — no manual edits mixed in.
3. **Exact-pin all dependencies + `scripts/check-pinned-deps.mjs`.** Pin
   `@anthropic-ai/claude-agent-sdk`, `yaml`, and all five devDeps to the versions
   currently resolved in `pnpm-lock.yaml` (no upgrades in this PR). Port pi's
   ~60-line checker (exact-semver regex over every dependency section).
4. **`scripts/check-import-direction.mjs`.** Enforce `org → loop → runtime`
   one-way imports (reject `runtime→loop`, `runtime→org`, `loop→org`); replaces
   AGENTS.md's "hold the line manually."
5. **tsconfig: `noUnusedLocals` + `noUnusedParameters`** in the base config, plus
   the mechanical fallout fixes (deletions and `_`-prefixes only — anything
   non-obvious gets deferred to PR 2's purge rather than judged here).
6. **Hermetic test env.** Wrap `pnpm test` in an `env -i` runner (pi's `test.sh`
   pattern: throwaway HOME, `TZ=UTC`, no provider keys) so the offline L1/L2
   lanes are provably credential-free — promoted from the P2 batch because the
   SessionStart hook currently loads real keys into every session's env.
   Also move `--maxWorkers=2` from the CLI flag into `vitest.config.ts`.
7. **Pre-commit hook + CI step.** Hook (via `core.hooksPath` — no new dep needed)
   runs `pnpm check`; `core-checks.yml` gains a `pnpm check` step before build.
8. **Negative controls for the new detectors** (standing rule: a detector that has
   never fired is an assumption). A `tests/policy/` spec seeds a floating version
   and a reversed import into temp fixtures and asserts both scripts fail; also
   asserts `pnpm check`'s command list matches the pinned lane definition.

AGENTS.md updates in the same PR: "Common commands" gains `pnpm check`; the
import-direction bullet drops "hold the line manually."

**Acceptance:** CI green with the new step; both check scripts demonstrated
red-then-green; `git diff --stat` of commit 2 is 100% formatter output.
**Risk:** low. The only large diff is machine-generated formatting, quarantined in
its own commit.

---

## PR 2 — Shrink and freeze

*Remove what is dead, freeze what remains, make the standards binding. Covers
P0.4 (cleanup), P0.5, P1.2 (ratchet), P1.4, P2.2. Depends on PR 1 (formatter
before baseline; check harness before new checks).*

Commit sequence:

1. **Dead-export purge.** Mechanical pass over the ~980-symbol census
   (38.7–39.0% of exports unreferenced outside their declaring file, two
   independent measurements): de-`export` symbols with in-file uses; delete
   symbols with none. Judgment calls (symbols that look like deliberate public
   API surface, e.g. anything the packaged skill or `dist` consumers might load)
   are skipped and listed in the PR body, not guessed at.
2. **Shared micro-helpers for the five verbatim-duplicated blocks** (P1.4):
   `ZERO_USAGE` const, `runGit()`, `toErrorMessage()` (8 copies today), a
   `definedProps()` helper for the 431 conditional-spread sites — introduced
   narrow and named, pi-style; call sites converted mechanically. (If review
   volume gets uncomfortable, the `definedProps()` call-site conversion can trail
   in a follow-up — the helper itself still lands here.)
3. **Test-machinery hygiene** (P2.2): drop `fast-check` (zero importers);
   relocate `src/runtime/testing/fakeRuntime.ts` to `tests/fixtures/` after
   confirming no packaged consumer (it currently ships in `dist/**/*.js`).
4. **The ratchet** (P1.2): commit a per-module baseline of export count + line
   count; `scripts/check-size-ratchet.mjs` fails `pnpm check` when a new module
   exceeds **10 exports or 300 lines**, or an existing module grows past its
   baseline on either metric. Override = named justification in the PR body plus
   a baseline edit in the same diff (visible to review). Seeded-violation
   negative control in `tests/policy/`.
5. **Make the standards binding** (P0.5): AGENTS.md links
   `research/2026-08-05_pi-forensic-analysis/pi-engineering-standards-skill.md`
   as binding for agent-authored code and records the single budget
   (public-symbol count is the gate; line count is the smoke alarm).

**Acceptance:** export census delta reported in the PR body (target: >30%
reduction in exported symbols); ratchet demonstrated red-then-green; `pnpm test`
count does not drop (nothing green-by-absence).
**Risk:** medium volume, low depth — every change is deletion, de-export, or
mechanical substitution, all behind PR 1's gate.

---

## Deferred follow-on track (not part of the two)

**`roadmap-delivery.ts` decomposition** (P3.1, then P3.4). Runs only after PR 2's
purge has shrunk the file's real public surface, one export cluster per PR, with a
temporary barrel at the original path (18 importers keep compiling; removal ticket
filed) and characterization tests per extracted seam. First extraction: the
~2,100-line pure assertion/canonicalization region (~50 functions, mostly
file-private-eligible). This is deliberately open-ended, incremental work — it
should not gate "being done" with the standards adoption, and each PR in the track
is independently shippable.

## Open decisions for the human (gate nothing above; decide whenever)

1. **typescript-eslint, narrow scope** — ~3 type-aware async rules
   (`no-floating-promises`, `no-misused-promises`, `require-await`) as a separate
   CI step. The one bug class Biome + scripts cannot catch, in a repo whose core
   loop is durable atomic writes. Dependency decision under TASTE.md §3.
   Recommendation: yes, as a small follow-up after PR 1.
2. **typebox for validation** (P3.3) — would collapse 564 hand-rolled validators;
   plausibly the largest single line-count win in the repo, and squarely a
   TASTE.md §3 call. Not scheduled until decided.
3. **Re-validation posture on the approval path** (P3.2) — is the
   belt-and-suspenders re-assertion of already-typed authority values deliberate?
   It reads deliberate given the durable-authority model; whatever the answer,
   record it in `docs/` so agents stop re-litigating it.
4. **Where the skill spec ultimately lives** — AGENTS.md pointer lands in PR 2;
   promoting it into `.claude/skills/` or the org's prompt surfaces is a
   human-ratified-surface change: propose, don't push.
5. **Green-light for the decomposition track** — start/defer/skip.

---

*Provenance: consolidates the surviving content of a review document
(`landing-plan-and-deliverable-review.md`, now removed) — its verification table,
the GhOps re-scope (adjusted after re-verification: the interface stays AND needs
no new double, since the `gh` process-seam double already exercises the real
`GhCliOps`), the single-budget resolution, the Biome-first linter resolution, the
ratchet mechanism, and its A–J PR staging, compressed to the two PRs above.*
