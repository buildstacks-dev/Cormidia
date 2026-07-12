[ticket]
#32 Ignore .pnpm-store on the format and git surfaces; prove full pipeline green with a project-local store present

Execution group: eg-pnpm-store-ignore
Release-kind: merge-only

## Goal
Eliminate the environment-dependent `format:check` false negative caused by a network-enabled build materializing a project-local `.pnpm-store/` in the writable worktree. Add the unanchored glob `.pnpm-store/` to `.prettierignore` (the load-bearing surface — the only ignore file `format:check` reads) and to `.gitignore` (git hygiene), then prove the full clean pipeline green with a project-local store still on disk.

## Context
A network-enabled Codex build runs `pnpm install` into a project-local `.pnpm-store/` at repo root. `format:check` runs `prettier --ignore-path .prettierignore --check .` (package.json:16); in Prettier 3 an explicit `--ignore-path` REPLACES the default ignore set, so `format:check` consults ONLY `.prettierignore` — not `.gitignore`. Today `.prettierignore` (6 entries: docs/design/, .operon/, .astro/, dist/, node_modules/, public/*.png) and `.gitignore` (node_modules/, dist/, .astro/, .DS_Store, .env, .env.*, !.env.example) neither list `.pnpm-store`, so Prettier descends into the vendored store and the pipeline goes red on a defect unrelated to site source. The `.prettierignore` line is the pipeline fix; the `.gitignore` line is hygiene (keeps the untracked store off `git status` and out of an accidental commit) and fixes nothing in the pipeline. CI parity sequence is content-check.yml:22-26 (`pnpm install --frozen-lockfile && pnpm check && pnpm format:check && pnpm build && pnpm test`). NOTE: that workflow's path filter (content-check.yml:5-8: src/content/**, public/images/**, CONTENT.md) excludes an ignore-file-only diff, so the CI check will NOT fire on this PR — the locally pasted sequence is the authoritative evidence, replayed by a named reviewer.

## Acceptance criteria
- [ ] Repro (pre-fix): on the unfixed tree, `pnpm install --frozen-lockfile --store-dir .pnpm-store` then `pnpm format:check` exits NON-ZERO; the non-zero output is pasted.
- [ ] Fix: with `.pnpm-store/` still present on disk, `pnpm format:check` exits 0; output pasted.
- [ ] Git surface: `git status --porcelain` shows no `.pnpm-store` entry, and `git check-ignore .pnpm-store` prints the path; both outputs pasted.
- [ ] Full pipeline parity: `pnpm install --frozen-lockfile && pnpm check && pnpm format:check && pnpm build && pnpm test` — every stage exits 0, run in that order, with the ordered output pasted.
- [ ] Lockfile unchanged: `git diff --exit-code pnpm-lock.yaml` is clean (exit 0); `pnpm@10.15.1` in package.json is untouched; no `.npmrc`/`store-dir` change.
- [ ] Scope: `git diff --name-only` lists exactly `.prettierignore` and `.gitignore` and nothing else; no source reformatting.
- [ ] Both ignore files contain the unanchored glob `.pnpm-store/` (not the root-anchored `/.pnpm-store/`).
- [ ] Ticket #30 remains returned/triaged in the Operon planning layer; the PR may reference #30 but must not transition or complete it.

## Scope
- .prettierignore
- .gitignore

## Out of scope
Do not pin the store location (`store-dir` in `.npmrc` or forcing a global store) — that alters build topology and is less reversible than two ignore lines. Do not add broader ignore catch-alls for other tools' scratch dirs (no evidence of need; speculative). Do not add/upgrade dependencies, touch `pnpm-lock.yaml`, or bump `pnpm@10.15.1`. No source reformatting sweep, no CI/script-pipeline refactor. No deploy, DNS, infrastructure, app-status transition, or product-content change. Do not advance/close ticket #30.

## Notes for the builder
The `.gitignore` line is hygiene, NOT the pipeline fix — acceptance criteria 1→2 deliberately force the fix through `.prettierignore`, so a git-only edit cannot pass. Use the unanchored `.pnpm-store/` glob so it matches at any depth in case the store lands nested. Reproduce deterministically with `--store-dir .pnpm-store`, which materializes a project-local store at repo root on any machine (independent of the Codex sandbox); leave that store on disk when running the green pipeline so the check proves the ignore actually takes effect. Do NOT wait on or cite the `content check` CI workflow as a gate — its path filter excludes an ignore-file-only diff, so it will not run on this PR; paste the local sequence in order as the authoritative artifact for the named reviewer to replay. Keep the diff to two single-line appends.

[spec]
--- CONTENT.md ---
# Publishing content on buildstacks.dev

Content is Markdown in `src/content/`. A content-only pull request edits only
`src/content/blog/` or `src/content/projects/` and related image assets. It must
not edit `src/layouts/`, `src/components/`, `astro.config.mjs`, `package.json`,
or `.github/workflows/`.

## Filenames and slugs

The filename is the URL slug. Use lowercase kebab-case: `trust-ladder.md`
becomes `/blog/trust-ladder/`. Never rename a published filename without an
explicit redirect decision.

## Blog frontmatter

```yaml
title: A clear post title
description: The one-sentence dek used in lists and metadata.
pubDate: 2026-06-28
updatedDate: 2026-06-29 # optional
tags: [autonomy, trust]
draft: false
```

`title`, `description`, and `pubDate` are required. `updatedDate` is optional;
`tags` defaults to `[]`; `draft` defaults to `false`. Drafts never appear in
production lists, RSS, or the sitemap.

## Project frontmatter

```yaml
name: Project name
tagline: One clear sentence.
status: active # active | experimental | archived
tags: [multi-agent]
repo: https://github.com/owner/repository
featured: false
order: 0
draft: false
```

`name`, `tagline`, and an absolute `repo` URL are required. `status` defaults
to `experimental`; `tags` defaults to `[]`; `featured` defaults to `false`;
`order` defaults to `0`; and `draft` defaults to `false`.

## Images and review boundary

Store content-owned images in `public/images/` and reference them with a root
path such as `/images/example.png`. Give every meaningful image useful alt text
in Markdown. Do not use a remote image host without an explicit product change.

Do not invent, select, or publish a topic, post, founder claim, project claim,
or customer evidence. Content enters the repository only after the owner
supplies or approves the exact material. Before requesting review, run:

```sh
pnpm check
pnpm format:check
pnpm build
pnpm test
```

[contract]
## Implementation contract

**Files:**
- .prettierignore
- .gitignore

**Approach:**
Add the unanchored `.pnpm-store/` ignore entry to the Prettier ignore surface and Git ignore surface, but do not duplicate it if the implement pass starts from the current checked-out tree where both entries are already present. The Prettier entry is the pipeline fix because `format:check` uses `--ignore-path .prettierignore`; the Git entry is hygiene for a clean status surface.

**Tests:**
- AC1 -> repro-prefixed-format-fails: On an unfixed baseline, run `pnpm install --frozen-lockfile --store-dir .pnpm-store` then `pnpm format:check` and capture the non-zero Prettier output.
- AC2 -> format-check-with-store-passes: With `.pnpm-store/` still present after the ignore change, run `pnpm format:check` and capture exit 0 output.
- AC3 -> git-surface-clean: Run `git status --porcelain` and verify no `.pnpm-store` entry; run `git check-ignore .pnpm-store` and verify it prints `.pnpm-store`.
- AC4 -> full-local-pipeline-parity: Run, in order, `pnpm install --frozen-lockfile && pnpm check && pnpm format:check && pnpm build && pnpm test`, with `.pnpm-store/` still on disk, and capture all stages exiting 0.
- AC5 -> lockfile-and-package-manager-unchanged: Run `git diff --exit-code pnpm-lock.yaml`; verify `package.json` still has `packageManager: pnpm@10.15.1`; verify no `.npmrc` or `store-dir` diff exists.
- AC6 -> scope-diff-only-ignore-files: Run `git diff --name-only` and verify output is exactly `.gitignore` and `.prettierignore`.
- AC7 -> ignore-glob-unanchored: Inspect `.prettierignore` and `.gitignore` and verify both contain `.pnpm-store/`, not `/.pnpm-store/`.
- AC8 -> ticket-30-untouched: Verify no Operon planning/status command or file edit transitions ticket #30; any PR reference to #30 must not close, complete, or advance it.

**Risks:**
Local code disagrees with the ticket description: `.prettierignore` and `.gitignore` already contain unanchored `.pnpm-store/`, and `git diff` is currently clean, so an implement pass on this exact tree may be a no-op or may need Planner clarification to avoid duplicating lines while still satisfying the required two-file diff. The pre-fix repro is not mechanically available from the current fixed tree unless the implement pass uses an unfixed baseline or a reversible temporary removal that leaves no final trace. CI will not fire for this ignore-only diff because `.github/workflows/content-check.yml` path filters exclude these files, so local ordered pipeline output is the required evidence.

**Complexity:**
low


<!-- operon:contract body-sha256:645c811eb5d90ff79e24475f962bd82184e90beb84fd08d6a1aee20c828debb4 -->

[memory]
## Memory INDEX (builder)

# builder — buildstacks.dev domain memory (INDEX)

Per-(role, app) OKF bundle (docs/architecture.md §6): what the builder role
knows about this product. This INDEX is the always-included excerpt layer —
one line per document in the bundle. Seeded empty by `operon bootstrap`;
the role appends lessons at end of turn (deliberately agent-writable routine
op) and the weekly curation pass dedupes, prunes, and promotes.

(no documents yet)

[repo]
Target repo: buildstacks-dev/buildstacks.dev
Worktree: /Users/bikram/.operon/Bikram-Org/worktrees/buildstacks.dev/op-32-ignore-pnpm-store-on-the-format-and-git-surfaces
Branch: op/32-ignore-pnpm-store-on-the-format-and-git-surfaces
PR: #33
Ticket tier: standard
Risk tier: medium
Review dimensions: security
Test command: npm test
Lint command: npm run lint
Changed files:
- .github/workflows/content-check.yml
- .gitignore
- .npmrc
- .operon/TASTE.md
- .operon/config.yaml
- .operon/memory/marketing/INDEX.md
- .operon/memory/sre/INDEX.md
- .operon/memory/support/INDEX.md
- .operon/onboarding-report.md
- .operon/policy.yaml
- .prettierignore
- .prettierrc.json
- AGENTS.md
- CONTENT.md
- astro.config.mjs
- docs/architecture.md
- docs/product-overview.md
- docs/requirements.md
- docs/runbook.md
- docs/testing.md
- package.json
- pnpm-lock.yaml
- public/favicon.svg
- public/og-default.png
- public/og-default.svg
- scripts/verify-build.mjs
- src/components/BaseHead.astro
- src/components/Footer.astro
- src/components/Header.astro
- src/components/Mark.astro
- src/components/PostRow.astro
- src/components/ProjectCard.astro
- src/components/TrustLadder.astro
- src/consts.ts
- src/content/blog/agent-native-infra.md
- src/content/blog/closed-loops.md
- src/content/blog/trust-ladder.md
- src/content/config.ts
- src/content/projects/operon.md
- src/content/projects/responsible-citizen.md
- src/layouts/Base.astro
- src/lib/content.ts
- src/pages/404.astro
- src/pages/about.astro
- src/pages/blog/[slug].astro
- src/pages/blog/index.astro
- src/pages/index.astro
- src/pages/projects/[slug].astro
- src/pages/projects/index.astro
- src/pages/rss.xml.js
- src/styles/base.css
- src/styles/tokens.css
- tsconfig.json

[authority]
profile: conservative
version: legacy-conservative/v1
sha256: 87c49a0f4621bf7b878a09a371b908c2e4c1854640ac40ec518279418df42733
sources: builtin:legacy-conservative/v1
The full effective charter is injected through the runtime's native instruction channel.
App policy and this task may narrow it; neither can broaden it or bypass a critical-operation gate.


---

# Pass: verify (review pipeline)

Review the PR in the brief above against its ticket's acceptance criteria.
Your value is in what you catch: an approval is you staking your judgment
that this change is correct, complete, and safe to merge. **Never modify source** — you produce findings, not
fixes; a review pass that edits the tree has failed regardless of what it
found.

## Protocol

1. **Check every acceptance criterion against evidence.** Read the diff, the
   code around it, and the test results. A criterion is satisfied when its
   named test proves it — not when the diff looks like it should. Run the
   tests if the brief's results leave any doubt.
2. **Review the change in its context.** The diff is the claim; the
   surrounding code is the truth. Look for what the change breaks or
   bypasses in code it did not touch, and for scope creep — work smuggled in
   beyond the ticket is a `scope` finding, however good it looks.
3. **Apply the security lens to every PR** — cheap depth, always on:
   injection (SQL, command, template, path), authorization and
   authentication around changed endpoints or checks, unsafe
   deserialization of external input, and secret handling (nothing keyed,
   logged, or committed that shouldn't be). Anything deeper is the
   security-deep pass's job; anything obvious is yours.
4. **Walk the user journeys.** If the app is user-facing and the spec
   carries a verification strategy, exercise the affected journeys
   end-to-end. A change that passes its criteria but breaks a journey is a
   FAIL — connecting rooms is not done until the hallway connects.

## Output

Findings, one per line, in exactly this grammar:

```
- category/severity file:line -- description -> action
```

- **category:** `architecture` | `testing` | `security` | `style` | `scope`
- **severity:** `critical` | `major` | `minor`
- **description:** what is wrong, specifically — quote the code, not vibes
- **action:** what would resolve it — concrete enough that the fix pass can
  act without guessing

Verdict: `approve` (the list is empty) or `findings` (anything stands —
every finding, whatever its severity, must be resolved or rebutted before
merge; the completeness gate enforces exactly that).
Then double-enter it as a real GitHub review — APPROVE or REQUEST_CHANGES
with the findings in the review body. The GitHub review is the state the
orchestrator acts on; a verdict without it does not exist.

Do not pad the list. Three real findings beat ten stylistic ones — every
finding you emit, the builder must resolve or rebut.
