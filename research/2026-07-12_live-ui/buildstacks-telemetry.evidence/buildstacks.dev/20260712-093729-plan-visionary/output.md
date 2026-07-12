I have enough to ground the strategic direction. One decisive finding shapes everything: the scaffold at HEAD (`bb0bb12 feat: build static Astro v1`) already implements the foundation and home page to spec — centralized tokens, `@fontsource` latin subsets at exactly the spec's weight table, shared `BaseHead`/`Header`/`Footer`, `TrustLadder`, content-driven home sections, dark-mode tokens, and a `verify-build.mjs` test. So this milestone is not greenfield; the value is proving it green and prototype-faithful, not rebuilding it.

## Product thesis

The user outcome: a visitor (human or agent crawler) lands on `buildstacks.dev/` and, in one near-instant, zero-JS paint, reads the founder's thesis as *design* — an "engineered-calm" home page whose monospace-utility voice, single pine-green accent, and trust-ladder signature match `buildstacks-prototype.html`, and which degrades cleanly to 360px, honors keyboard focus and reduced-motion, and flips to dark mode by system preference. The internal outcome that makes the rest of the roadmap possible: a **green, reproducible verification contract** (`pnpm install --frozen-lockfile && check && format:check && build && test` from a clean checkout) so that every later agent-authored content PR is provably safe — the read-only rung of the founder's own trust ladder, applied to the site's own supply chain.

The strategic point of the bootstrap milestone is to *lock the design system and the guardrail*, not to accumulate features. Everything downstream (blog typography, projects, the §8b dynamic services) inherits the tokens, the head contract, and the CI gate established here.

## Constraints

- **Design authority is fixed and external.** `docs/design/buildstacks-design-spec.md` + `buildstacks-prototype.html` are the sole product authority (app charter). Fidelity means matching the *spec's* weight table (Space Grotesk 600; IBM Plex Sans 400/500; IBM Plex Mono 400/500) — **not** the prototype's Google-Fonts CDN link, which loads extra weights only for preview. No net-new visual invention.
- **Static + near-zero JS + self-hosted fonts.** Content pages ship no framework runtime; no Google Fonts `<link>` may appear in `dist/`. Fonts are self-hosted subsets (already via `@fontsource/*` latin CSS). This is checkable against build output.
- **Org constitution.** Simplicity first (no abstraction beyond the ticket); TypeScript strict, no unexplained `any`; boring/few deps; work is "done" only when checks pass with pasted evidence; small single-concern PRs.
- **Role + authority boundaries.** Planner does not write application code — buildable work routes to the Builder; genuine product choices route to the human. Conservative authority: no edits, branches, or billable runs from this turn without a fresh grant; investigation and this plan are in-scope.
- **Existing committed code is the baseline.** The scaffold already exists at HEAD; the milestone must reconcile against it (verify/harden/close gaps) rather than re-scaffold, to avoid a diff that rewrites working code.
- **Budget.** App month-to-date $0 of $1000; planning capped at $15 upper bound. No pressure, but no reason to over-decompose.

## Candidate milestone bets

Each is independently valuable and has a binary test.

1. **Green foundation contract.** From a clean checkout, `pnpm install --frozen-lockfile`, `astro check`, `prettier --check`, `astro build`, and `node scripts/verify-build.mjs` all pass. *Test:* the five commands exit 0 with pasted output. This is the guardrail everything else depends on; it may already hold (commit `14f7fbb` aligned the pnpm/CI version) and simply needs verification, or reveal a real gap.

2. **Prototype-faithful home.** The rendered `/` matches the prototype's structure and aesthetic — hero eyebrow/h1/lede/two CTAs, the trust-ladder signature with its staggered one-time reveal, latest-writing rows, featured project cards, about teaser, sticky blurred header, mono footer — sourced from real content collections. *Test:* visual diff against `buildstacks-prototype.html` + confirmation the three seeded posts and two projects drive the lists.

3. **Quality-floor proof.** The home page satisfies the spec's quality floor on evidence, not assertion: usable at 360px, visible `:focus-visible` on all interactive elements, the ladder animation suppressed under `prefers-reduced-motion`, correct dark-mode token flip, one semantic `h1`, alt/aria on the logo mark, and no Google Fonts request in `dist/`. *Test:* a short verification checklist run against the built output.

## Non-goals

- **Deployment** — `deploy.yml`, nginx, Cloudflare, first ship (spec §9). Explicitly excluded by the brief.
- **§8b dynamic services** — post audio/TTS, the agent-ops JSON page, the live-demo service. Later, higher-leverage, separate repos.
- **Deep interior-route polish** — Shiki prose typography, prev/next, pagination, projects/about detail refinement. The routes may exist in the tree, but bringing them to "top-5% content" quality is out of *this* milestone; only their linkage from the home page matters here.
- **CMS, subdomains, per-post OG images** — spec open decisions deferred; Markdown-in-repo and a single `og-default` stand.
- **Reworking already-passing scaffold code** for style. If it's green and faithful, it ships as-is.

## Unknowns

- **Build-vs-verify framing (highest-impact).** The brief reads as greenfield ("establish the foundation"), but the foundation is already committed and appears spec-complete. Is the milestone's deliverable a *verification-and-fidelity-hardening* pass over existing code, or is there a known deficiency that motivated a fresh bootstrap? This changes ticket count from ~1 (verify + fix gaps) to more. **Recommend the PM pass treat it as verify-and-close-gaps** unless the human flags otherwise.
- **Does it actually go green on a clean install?** Not run here (`node_modules` absent in the planning worktree; running install is a billable/edit-adjacent action beyond this pass). The one fact that would collapse or confirm bet #1 — the decomposer/builder should establish it first.
- **Fidelity gaps hiding in the port.** The home was ported prototype→components; unverified whether the staggered ladder reveal, hover underline animations, and 560px→360px grid collapse survived the port intact. Likely fine; needs a real visual check.
- **`og-default.png` provenance.** A binary OG image is committed — is it a final asset or a placeholder to be replaced? Affects whether metadata is "done."
- **Content authority.** `CONTENT.md` forbids inventing founder/project claims, yet three posts and two projects are seeded. Assumed owner-approved (they mirror the prototype copy); worth a one-line human confirmation before treating them as shippable rather than fixtures.