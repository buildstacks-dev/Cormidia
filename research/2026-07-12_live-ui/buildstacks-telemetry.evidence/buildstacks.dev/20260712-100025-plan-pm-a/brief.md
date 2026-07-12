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
This is selected pass pm-a; consume the prior selected outputs below and do not assume skipped passes ran.

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

[authority]
profile: conservative
version: legacy-conservative/v1
sha256: 87c49a0f4621bf7b878a09a371b908c2e4c1854640ac40ec518279418df42733
sources: builtin:legacy-conservative/v1
The full effective charter is injected through the runtime's native instruction channel.
App policy and this task may narrow it; neither can broaden it or bypass a critical-operation gate.
