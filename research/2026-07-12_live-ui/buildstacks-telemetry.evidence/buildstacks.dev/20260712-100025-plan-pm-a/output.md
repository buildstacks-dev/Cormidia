The file write to `.operon/planning/pm-a.md` was denied by a critical-op guard (`production-deploy`) — the `.operon/` subtree appears gate-protected on this turn. I won't attempt to bypass a gated op. Since the pass's file output is conditional ("if you write a file…"), I'll deliver the PM-A roadmap as my pass output text for the orchestrator to consume, exactly as the visionary's output was passed forward.

---

## Recommended milestone

**Store-agnostic green pipeline.** Make the verification sequence (`frozen-install → check → format:check → build → test`) pass deterministically even when a network-enabled build materializes a project-local `.pnpm-store/` in the writable worktree. Ship as **one** dependency-free quick ticket: add `.pnpm-store/` to both ignore surfaces and prove the full clean sequence green as the acceptance artifact.

Single ticket, not a split: the change (Bet A) and its proof (Bet B) are two halves of one atomic outcome. Splitting them would yield a config edit with no evidence plus a proof-only ticket — neither independently valuable, and the pair invents the dependency the brief wants avoided. Simplicity-first favors one self-contained, self-proving change.

## Ticket sequence

1. **Ignore `.pnpm-store` on the format and git surfaces, and prove the full sequence green.**
   - Goal: add `.pnpm-store/` to `.prettierignore` and `.gitignore`, then run the exact CI sequence locally against a worktree containing a project-local store and paste the ordered, all-green output.
   - Evidence source: `package.json` scripts (`format`/`format:check` both invoke `prettier --ignore-path .prettierignore`); `.github/workflows/content-check.yml` runs `pnpm install --frozen-lockfile && pnpm check && pnpm format:check && pnpm build && pnpm test`; current `.prettierignore` (six entries: `docs/design/`, `.operon/`, `.astro/`, `dist/`, `node_modules/`, `public/*.png` — no `.pnpm-store`) and `.gitignore` (no `.pnpm-store`) confirmed in-repo.
   - Binary acceptance: (a) `.pnpm-store/` present in both ignore files; (b) with a `.pnpm-store/` directory present, the full sequence exits 0 at every stage, pasted in order; (c) `git status --ignored` shows `.pnpm-store/` as ignored, not untracked; (d) diff limited to the two ignore files — `pnpm-lock.yaml` unchanged, no source reformatting, `pnpm@10.15.1` untouched.
   - Verification: named reviewer replays the pasted sequence; CI `content check` stays green on the PR.
   - Tracker note: must **not** advance ticket #30 to complete; #30 remains returned/triaged. `gh issue view 30` returns nothing here, so #30 lives in the Operon planning layer — orchestrator targets that tracker and preserves #30's status.

## Dependencies

None. The ticket is self-contained: it edits only ignore files and runs the existing pipeline. No test/observability work precedes it because the verification harness already exists (`check`/`build`/`test` scripts + CI workflow) — this ticket consumes that harness rather than building it.

## Risks

- **Store path mismatch (low).** If the build writes the store at a nested or differently named path rather than repo-root `.pnpm-store/`, the entry could miss it. Repo-root `.pnpm-store/` is pnpm's project-local default; Prettier and git match the pattern at nested occurrences too. Changing evidence: an observed build writing the store elsewhere → broaden the entry to the actual pattern (still one ticket).
- **CI is store-clean (accepted, defensive).** CI uses `cache: pnpm` with the default global store, so `.pnpm-store/` likely never appears there; the fix is defensive for the Codex sandbox, inert on the CI path.
- **Wrong tracker mutation (low, high-consequence).** Accidentally closing/transitioning #30. Mitigated by the explicit "#30 stays returned" acceptance criterion; tracker state is owned by the orchestrator, not this ticket.

## Deferred work

- **Pinning the store location** (`store-dir` in `.npmrc` / forcing a global store) — alters build topology, exceeds a reversible quick fix; the ignore approach is store-location-agnostic and preferred.
- **Broader ignore catch-alls** for other tools' scratch dirs — no evidence of need; speculative.
- **Any deploy, DNS, app-status, or product-content change** — out of scope, gate-protected, excluded by the merge-only brief.

---

**Note for the orchestrator:** my attempt to persist this to `.operon/planning/pm-a.md` was blocked by a `critical op (production-deploy) requires human approval` guard covering the `.operon/` subtree. If the pipeline requires the file on disk (rather than consuming this pass text), a human approval or a relaxed write path for `.operon/planning/` is needed. The roadmap content above is complete and ready to hand to pm-b / arbitrator regardless.