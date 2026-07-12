Evidence confirms the decisive disagreement. I can now arbitrate.

## Agreed points

All three passes converge on the same milestone shape, and the evidence backs it:

- **One dependency-free, merge-only ticket.** The change (add ignore entries) and its proof (paste the green sequence) are two halves of one atomic outcome; splitting them yields a config edit with no evidence plus a proof-only ticket. Confirmed: the verification harness already exists (`check`/`build`/`test` scripts, package.json:13–19), so nothing must precede this.
- **Add `.pnpm-store/` to both `.prettierignore` and `.gitignore`** — verified both files lack it today (`.prettierignore` has 6 entries ending `public/*.png`; `.gitignore` ends at `!.env.example`).
- **Minimal diff.** No reformat sweep, no lockfile churn, no `store-dir`/`.npmrc` change (confirmed `.npmrc` pins only `engine-strict`/`auto-install-peers`), `pnpm@10.15.1` untouched (package.json:6).
- **Evidence gate = pasted, in-order output** of `pnpm install --frozen-lockfile && pnpm check && pnpm format:check && pnpm build && pnpm test`, mirroring content-check.yml:22–26 exactly.
- **#30 stays returned/triaged.** Not GitHub-tracked here; the Operon planning layer owns its state and this ticket must not advance it.
- **Store relocation is a non-goal** — pinning `store-dir` alters build topology and is less reversible than two ignore lines.

## Disputed points

**1. Are the two ignore surfaces symmetric? (Decides how acceptance criteria are written.)** pm-a framed "ignore-surface parity" — both `.prettierignore` and `.gitignore` as co-equal halves of the fix. pm-b refuted this: `format:check` runs `prettier --ignore-path .prettierignore` (package.json:16), and in Prettier 3 an explicit `--ignore-path` **replaces** the default ignore set (`.gitignore` + `.prettierignore`) rather than adding to it.

**Resolved for pm-b, on the evidence.** With the explicit `--ignore-path .prettierignore`, `format:check` consults **only** `.prettierignore`. Therefore:
- `.prettierignore` entry is **load-bearing** — it alone fixes the red pipeline.
- `.gitignore` entry is **git hygiene** — it keeps an untracked store out of `git status` and off an accidental commit, but fixes nothing in the pipeline.

This is not a cosmetic distinction: a builder who treats the surfaces as symmetric could add only the `.gitignore` line and report a still-red `format:check`. The acceptance criteria must name which line does the work.

**2. Reproduce-first vs. fix-and-verify.** pm-b adds a pre-fix repro step: `pnpm install --frozen-lockfile --store-dir .pnpm-store` forces a project-local store at repo root deterministically on any machine, proving (a) the defect is real, (b) the pattern matches what actually lands, and (c) it's fixed with the store still present. **Adopted** — it converts the brief's stated "exact store path" unknown into evidence at negligible cost and makes the fix reproducible off the Codex sandbox. pm-a's plainer fix-then-verify is a strict subset.

## Gaps

- **CI will not run on this PR — local evidence is the sole gate.** content-check.yml triggers only on `paths: src/content/**, public/images/**, CONTENT.md` (lines 5–8). A diff limited to `.prettierignore` + `.gitignore` matches none of these, so the workflow **will not fire**. Both PM plans listed "CI content check stays green on the PR" as a verification signal; that signal will be *absent*, not green. Correct the acceptance to rest on the **locally pasted** sequence as the authoritative artifact, and have the named reviewer replay it — do not wait on or expect a CI check.
- **Pattern anchoring.** Use the unanchored glob `.pnpm-store/` (matches at any depth), not root-anchored `/.pnpm-store/`. Costs nothing, defends against a nested store path. pm-b flagged this; make it explicit for the builder.

## Chosen milestone shape

**One ticket, one PR, no dependencies: "Ignore `.pnpm-store` on the format and git surfaces; prove the full CI sequence green with a project-local store present."**

Adopt pm-b's structure (reproduce-first, name the load-bearing surface, bundle git hygiene), fold in the CI-won't-fire correction from Gaps. Change = two lines across two ignore files; evidence = the ordered green sequence run against a worktree that *contains* a project-local store.

## Decomposition instructions

Emit **exactly one** TicketPlan, stage `bootstrap`, single ticket, zero dependencies. The decomposer must encode:

**Title:** Ignore `.pnpm-store` on format and git surfaces; prove full pipeline green with a project-local store present.

**File scope (diff must be limited to these two):**
- `.prettierignore` — append `.pnpm-store/` (load-bearing: the only surface `format:check` reads, per `--ignore-path .prettierignore`).
- `.gitignore` — append `.pnpm-store/` (git hygiene: keeps the untracked store off `git status` / out of an accidental commit).
- Use the unanchored glob `.pnpm-store/`, not `/.pnpm-store/`.

**Binary acceptance criteria (all must hold; output pasted in order):**
1. **Repro (pre-fix):** `pnpm install --frozen-lockfile --store-dir .pnpm-store` then `pnpm format:check` exits **non-zero**.
2. **Fix:** with `.pnpm-store/` still on disk, `pnpm format:check` exits **0**.
3. **Git surface:** `git status --porcelain` shows no `.pnpm-store`; `git check-ignore .pnpm-store` prints the path.
4. **Full pipeline parity:** `pnpm install --frozen-lockfile && pnpm check && pnpm format:check && pnpm build && pnpm test` — every stage exits 0, in order, pasted.
5. **Lockfile unchanged:** `git diff --exit-code pnpm-lock.yaml` is clean; `pnpm@10.15.1` untouched; no `.npmrc`/`store-dir` change.
6. **Scope:** `git diff --name-only` lists only `.prettierignore` and `.gitignore`; no source reformatting.
7. **#30 not completed:** #30 remains returned/triaged in the Operon planning layer; the PR may reference it but must not transition it.

**Verification:** named reviewer replays the pasted sequence locally. Do **not** cite CI `content check` as a gate — its path filter (`src/content/**`, `public/images/**`, `CONTENT.md`) excludes an ignore-file-only diff, so the workflow will not run on this PR; the local paste is the authoritative artifact.

**Evidence sources to cite:** package.json:16 (explicit `--ignore-path`); package.json:6 (`pnpm@10.15.1`); content-check.yml:5–8 (path filter → no CI trigger) and :22–26 (exact sequence); current `.prettierignore` / `.gitignore` (no `.pnpm-store`); `.npmrc` (no `store-dir`).

**Non-goals to carry forward:** pinning `store-dir`; broader ignore catch-alls; any deploy/DNS/app-status/product-content change; advancing #30.

**Builder note (not a separate ticket):** the `.gitignore` line is hygiene, not the pipeline fix — criterion 1→2 forces the fix through `.prettierignore` so a git-only edit cannot pass.