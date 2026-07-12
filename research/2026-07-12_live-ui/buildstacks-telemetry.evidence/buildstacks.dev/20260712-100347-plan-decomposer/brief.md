# bootstrap plan request: buildstacks.dev

## Product goal
Triage returned ticket #30 without marking it complete. Publish exactly one dependency-free quick ticket that fixes the demonstrated pipeline defect: a network-enabled Codex build creates a project-local .pnpm-store inside the writable worktree, but format:check scans it. The fix must ignore .pnpm-store in the formatting and git surfaces, then prove the full clean frozen-install/check/format/build/test sequence green. Merge-only; no deployment, infrastructure, product content, or app-status change.

## Adaptive planning route (decided before model execution)
Policy: planning-depth/v1
Selected depth: deep
Risk tier: low
Ambiguity: low
Coupling: low
Reversibility: reversible
External consequence: none
Expected tickets: 1-2
Sensitive domains: infrastructure/dns, release/deploy
Decision factors: sensitive domain: infrastructure/dns, release/deploy; human quick request could not lower the deep safety floor
Selected passes: visionary -> pm-a -> pm-b -> arbitrator -> decomposer
Skipped passes: none
Estimated planning cost: $3.4370
Planning cost upper bound: $25.00 (role caps; not expected cost)
Estimate basis: visionary: median of 1 comparable turn(s); pm-a: median of 1 comparable turn(s); pm-b: median of 3 comparable turn(s); arbitrator: median of 3 comparable turn(s); decomposer: median of 1 comparable turn(s); role caps are an upper bound, not expected cost

## Repository snapshot
Source checkout: /Users/bikram/Build/buildstacks.dev
Source branch: build/buildstacks-v1
Source HEAD: 14f7fbb624335406a9c7044f32a24e932287c7e8
Planning worktree: /Users/bikram/.operon/Bikram-Org/worktrees/buildstacks.dev/plan-buildstacks.dev-1783850371002
Top-level entries: .github, .gitignore, .npmrc, .operon, .prettierignore, .prettierrc.json, CONTENT.md, astro.config.mjs, docs, package.json, pnpm-lock.yaml, public, scripts, src, tsconfig.json
Docs present: docs
Recent commits:
14f7fbb fix: align CI pnpm version with package metadata
12ce510 test: verify internal static route targets
bb0bb12 feat: build static Astro v1
b5c3c6c chore: onboard buildstacks with Operon
ca67151 chore: reset stale app while retaining design inputs

## Org history for this app
Month-to-date spend $10.07 of $1000.00 (ok).

Plan the smallest shippable milestone per the pass protocol.
The final selected pass must emit exactly one TicketPlan JSON object with stage "bootstrap" matching the provided schema; the orchestrator alone publishes it.

## Pass-routing instruction
This is selected pass decomposer; consume the prior selected outputs below and do not assume skipped passes ran.

## Prior selected-pass outputs
### visionary

I have the grounding I need. The pipeline is `pnpm install --frozen-lockfile → check → format:check → build → test` (both in `package.json` scripts and `.github/workflows/content-check.yml`), and neither `.prettierignore` nor `.gitignore` currently lists `.pnpm-store`.

## Product thesis

The product outcome is a **trustworthy green pipeline**: the buildstacks.dev verification sequence (`frozen-install → check → format:check → build → test`) must pass deterministically regardless of where the package manager materializes its store. Today a network-enabled Codex build writes a project-local `.pnpm-store/` into the writable worktree; because `.prettierignore` does not exclude it, `format:check` (`prettier --check .`) descends into vendored store contents and fails — a false negative that has nothing to do with the site's source. The same directory is untracked by git, so it also pollutes the git surface and risks accidental commit. The milestone value is narrow and real: remove this environment-dependent failure so the pipeline reflects the health of the actual source, not the build sandbox's storage layout. No user-facing site behavior changes; the beneficiary is the maintainer and every future automated build.

## Constraints

- **Merge-only scope.** No deployment, infrastructure/DNS, app-status transition, or product content change. Sensitive domains (infrastructure/dns, release/deploy) are explicitly out and gate-protected.
- **Dependency-free, single ticket.** Exactly one quick ticket with no dependency on other work; expected 1–2 tickets total but the fix itself must stand alone.
- **Do not close #30.** Ticket #30 is *returned/triaged*, not completed — its status must not be advanced by this milestone.
- **Ignore-surface parity.** The fix must cover both surfaces the defect touches: the formatting surface (`.prettierignore`, which `format` and `format:check` both consume via `--ignore-path`) and the git surface (`.gitignore`). Fixing only one leaves the defect half-live.
- **Evidence gate.** "Done" requires pasted, in-order output of the full clean sequence `pnpm install --frozen-lockfile && pnpm check && pnpm format:check && pnpm build && pnpm test` passing — not a claim. This mirrors CI exactly.
- **Minimal diff / simplicity-first.** Add the ignore entries and nothing else; no reformatting sweep, no lockfile churn, no config refactor. The frozen lockfile must remain unchanged.
- **Planner does not implement.** This pass and the plan route buildable work to the Builder; no app code is written from planning turns.

## Candidate milestone bets

- **Bet A — Ignore `.pnpm-store` on both the format and git surfaces.** Add `.pnpm-store/` to `.prettierignore` and `.gitignore`. Independently testable: with a `.pnpm-store/` present in the worktree, `pnpm format:check` passes and `git status` shows the directory as ignored (not untracked). This is the core fix and the smallest thing that resolves the demonstrated defect.
- **Bet B (fold-in, not separate) — Prove the full sequence green as the acceptance artifact.** Run the exact CI sequence locally against a worktree that contains a project-local store and paste the ordered output. Testable by construction: every stage exits 0. This is the verification half of Bet A and should ship in the same ticket, not as a dependency.

Recommend the decomposer emit **one** ticket carrying Bet A as the change and Bet B as its binary acceptance criterion.

## Non-goals

- Changing the store location itself (e.g., pinning `store-dir` in `.npmrc` or forcing a global store) — that alters build topology and exceeds a quick, reversible fix; the ignore approach is store-location-agnostic.
- Broadening ignore rules beyond `.pnpm-store` (no speculative catch-alls for other tools).
- Adding or upgrading dependencies, touching `pnpm-lock.yaml`, or bumping the pinned `pnpm@10.15.1`.
- Reformatting existing source, refactoring CI, or altering the script pipeline shape.
- Marking #30 complete, transitioning app status, or any deploy/DNS/publish action.

## Unknowns

- **Exact store path/pattern.** Confirm whether the network-enabled Codex build writes `.pnpm-store/` at repo root (most likely, given a project-local store) versus a nested or differently named path; the ignore entry must match what actually appears. Low risk — a repo-root `.pnpm-store/` glob is the safe default and Prettier/git patterns match nested occurrences too.
- **Ticket #30's system of record.** `gh issue view 30` returned nothing in this worktree, so #30 appears to live in the Operon planning/ticket layer rather than GitHub Issues. The decomposer/orchestrator should target the correct tracker and ensure "do not complete #30" is honored there; this does not change the code fix.
- **CI store behavior.** GitHub CI uses `cache: pnpm` with the default store location, so `.pnpm-store/` likely does not appear there — meaning the defect is environment-specific (Codex sandbox) and the fix is defensive for CI. Worth a one-line confirmation that adding the ignore entry does not perturb the cached-store CI path (it will not; it only excludes a path CI doesn't produce).

### pm-a

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

### pm-b

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

### arbitrator

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

[authority]
profile: conservative
version: legacy-conservative/v1
sha256: 87c49a0f4621bf7b878a09a371b908c2e4c1854640ac40ec518279418df42733
sources: builtin:legacy-conservative/v1
The full effective charter is injected through the runtime's native instruction channel.
App policy and this task may narrow it; neither can broaden it or bypass a critical-operation gate.
