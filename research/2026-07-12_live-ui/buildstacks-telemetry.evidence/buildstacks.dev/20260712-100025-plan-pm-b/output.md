The write to `.operon/planning/pm-b.md` was denied — the harness classifies writes under `.operon/` as a gated critical op (secrets-or-auth) requiring human approval, and my conservative authority can't bypass that gate. The protocol's file-write is conditional ("if you write a file"), so I'll deliver the PM-B roadmap as my pass output directly for the arbitrator to consume, and flag the blocked write.

One grounding correction drives this pass: `format:check` runs `prettier --ignore-path .prettierignore` (package.json:15–16), which in Prettier 3 **overrides** the default set — so `format:check` reads only `.prettierignore`, never `.gitignore`. The two surfaces are therefore not symmetric, which changes how the ticket must be written and verified.

---

## Alternative milestone

**Reproduce-first, fix the load-bearing surface, bundle git hygiene — one merge-only ticket.**

Same green-pipeline outcome as the visionary, different load-bearing analysis on two points:

1. **The surfaces are not symmetric — correct the "parity" premise.** Because `format:check` uses an explicit `--ignore-path .prettierignore`, adding `.pnpm-store/` to `.prettierignore` *alone* fully fixes the pipeline; adding it to `.gitignore` *alone* fixes nothing in the pipeline. The `.gitignore` entry still ships in the same ticket — but as git hygiene (stop an untracked multi-hundred-MB store polluting `git status` / risking an accidental commit), not as a co-equal half of the fix. Naming which line does the work stops a builder from "fixing" only the git surface and reporting a still-red pipeline.

2. **Reproduce before fix — turn the store path from assumption into evidence.** The store is Codex-sandbox-specific and its exact path is the brief's stated unknown. Force it deterministically with `pnpm install --frozen-lockfile --store-dir .pnpm-store`, which materializes a project-local `.pnpm-store/` at repo root on any machine. This reproduces the red `format:check` on the unfixed tree (proving the defect and that the pattern matches what lands), then proves it green post-fix with the store still present.

## Ticket sequence

Single ticket, single PR, no dependencies.

- **BS-#30a — Ignore `.pnpm-store` on the format and git surfaces; prove the full CI sequence green with a project-local store present.**
  - *Goal:* eliminate the environment-dependent `format:check` false negative caused by a project-local pnpm store.
  - *Change:* add `.pnpm-store/` to `.prettierignore` (pipeline-blocking surface) and `.gitignore` (hygiene). Nothing else — no reformat sweep, no lockfile change, no `.npmrc`/`store-dir` change, `pnpm@10.15.1` untouched.
  - *Binary acceptance (all hold; output pasted in order):*
    1. **Repro:** pre-fix, `pnpm install --frozen-lockfile --store-dir .pnpm-store` then `pnpm format:check` **exits non-zero**.
    2. **Fix:** with `.pnpm-store/` still on disk, `pnpm format:check` **exits 0**.
    3. **git surface:** `git status --porcelain` shows no `.pnpm-store`; `git check-ignore .pnpm-store` prints the path.
    4. **Full CI parity:** `pnpm install --frozen-lockfile && pnpm check && pnpm format:check && pnpm build && pnpm test` all exit 0, in order.
    5. **Lockfile unchanged:** `git diff --exit-code pnpm-lock.yaml` clean.
    6. **#30 not completed:** #30 stays returned/triaged; PR references it without transitioning it.
  - *Evidence source:* package.json:15–16 (explicit `--ignore-path`); `.prettierignore`/`.gitignore` (no `.pnpm-store` today); content-check.yml:22–26 (exact CI sequence); `.npmrc` (no `store-dir`).
  - *Builder note (not a separate ticket):* prefer the unanchored `.pnpm-store/` glob over root-anchored `/.pnpm-store/` so it matches at any depth; costs nothing and is still minimal.

## Dependencies

None. Self-contained: edits two ignore files, runs existing scripts. Not blocked by and does not block other work. Independent of the Codex sandbox — the `--store-dir .pnpm-store` repro makes the failure reproducible on any machine, including CI runners.

## Risks

- **Wrong-surface fix (primary).** A builder treating the surfaces as symmetric may add only the `.gitignore` line and report a still-red `format:check`. Mitigation: acceptance 1→2 forces the fix through `.prettierignore`.
- **Pattern misses the real path.** If the store lands elsewhere than repo-root `.pnpm-store/`, an anchored pattern would miss it. Mitigation: `--store-dir .pnpm-store` repro plus unanchored glob default.
- **CI perturbation (low).** CI uses `cache: pnpm` (default store); `.pnpm-store/` never appears there, so the entry only excludes a path CI doesn't produce. Acceptance 4 confirms; no `store-dir` change keeps CI store resolution untouched.
- **Scope creep into store relocation.** Pinning `store-dir` in `.npmrc` is rejected — alters build topology, couples to CI cache resolution, less reversible than two ignore lines.
- **Accidental #30 completion.** Merge-only; acceptance 6 guards it.

## Deferred work

- **Pin `store-dir` to relocate the store** (root-cause alternative) — deferred; exceeds a reversible quick fix, couples to CI cache. Revisit only if ignore proves insufficient.
- **Broader ignore hardening** for other tool artifacts — deferred; no evidence any exist; speculative catch-alls violate simplicity-first.
- **CI guard rejecting a committed store dir** — deferred; `.gitignore` already prevents staging.
- **#30 disposition beyond this fix** — this milestone clears only the demonstrated defect; remaining triage stays with the human.

---

**Blocked-op note for the orchestrator:** I could not persist `.operon/planning/pm-b.md` — the write returned `critical op (secrets-or-auth) requires human approval`, and conservative authority cannot bypass that gate. The roadmap above is my complete pass output for the arbitrator to consume. If a persisted artifact is required, a human grant (or a non-gated write path) is needed. I did not emit a TicketPlan JSON — that remains the final selected pass's job.