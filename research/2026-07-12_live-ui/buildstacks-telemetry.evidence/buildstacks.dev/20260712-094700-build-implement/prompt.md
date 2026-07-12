[ticket]
#30 Prove the green foundation contract from a clean checkout

Execution group: pipeline-contract
Release-kind: merge-only

## Goal
Establish that the committed scaffold's full verification pipeline passes reproducibly from a clean checkout, and fix any pipeline-level (install/config/lockfile/CI) breakage that prevents it — nothing more.

## Context
This is the read-only rung of the site's own trust ladder: the guardrail every later agent-authored content PR inherits. The scaffold at HEAD already defines all five pipeline stages as package.json scripts (check=astro check, format:check=prettier --check, build=astro build, test=node scripts/verify-build.mjs) and commit 14f7fbb aligned the pnpm/CI version. Whether it actually goes green on a clean install (no node_modules) was NOT run during planning — that is the single fact this ticket establishes first. If it is already green, this ticket's deliverable is pasted evidence plus (if trivially needed) a lockfile/config touch-up; if red, the fix is scoped strictly to the pipeline surface, not to product code or styles.

## Acceptance criteria
- [ ] From a checkout with no node_modules, `pnpm install --frozen-lockfile` exits 0 (pasted terminal output included in the PR).
- [ ] `pnpm check` exits 0 reporting 0 errors and 0 warnings from astro check (pasted output).
- [ ] `pnpm format:check` exits 0 with no files listed as needing formatting (pasted output).
- [ ] `pnpm build` exits 0 and produces dist/ (pasted output).
- [ ] `pnpm test` exits 0 and prints the verify-build.mjs success line reporting the verified static artifacts and zero-JavaScript pages (pasted output).
- [ ] Any change made is confined to the declared file scope (package.json, pnpm-lock.yaml, astro.config.mjs, tsconfig.json, .github/workflows/**, scripts/verify-build.mjs); git diff shows no edits outside it.

## Scope
- package.json
- pnpm-lock.yaml
- astro.config.mjs
- tsconfig.json
- .github/workflows/**
- scripts/verify-build.mjs

## Out of scope
Any change to src/** application code, components, styles, or content. Deployment workflow (deploy.yml), hosting, DNS, or CDN. Adding new dependencies or new verify-build.mjs assertions beyond what is needed to make an existing stage pass. Prototype-fidelity or quality-floor checks (that is T2).

## Notes for the builder
Run the five commands in the exact order above; if all pass, the PR is an evidence/verification PR (may carry a zero-line or lockfile-only diff, which is acceptable under 'work is done when checks pass with pasted evidence'). Do NOT 'improve' or reformat passing code. If a stage fails, fix only the pipeline cause (e.g. a stale lockfile, a config/tsconfig error, a CI pnpm version mismatch) and re-run the whole sequence from clean to prove reproducibility. Cross-check the CI workflow in .github/workflows/** runs the same five stages so local-green equals CI-green.

[spec]
--- package.json ---
{
  "name": "buildstacks.dev",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.15.1",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "astro dev",
    "start": "astro dev",
    "check": "astro check",
    "lint": "astro check",
    "format": "prettier --ignore-path .prettierignore --write .",
    "format:check": "prettier --ignore-path .prettierignore --check .",
    "build": "astro build",
    "preview": "astro preview",
    "test": "node scripts/verify-build.mjs"
  },
  "dependencies": {
    "@astrojs/mdx": "^4.3.0",
    "@astrojs/rss": "^4.0.12",
    "@astrojs/sitemap": "^3.4.1",
    "@fontsource/ibm-plex-mono": "^5.2.6",
    "@fontsource/ibm-plex-sans": "^5.2.6",
    "@fontsource/space-grotesk": "^5.2.6",
    "astro": "^5.13.0"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.9",
    "prettier": "^3.6.2",
    "prettier-plugin-astro": "^0.14.1",
    "typescript": "^5.9.3"
  }
}

--- scripts/verify-build.mjs ---
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const expected = [
  "index.html",
  "404.html",
  "about/index.html",
  "blog/index.html",
  "blog/trust-ladder/index.html",
  "projects/index.html",
  "projects/operon/index.html",
  "rss.xml",
  "sitemap-index.xml"
];

for (const file of expected) {
  if (!existsSync(resolve("dist", file)))
    throw new Error(`Missing built artifact: ${file}`);
}

function htmlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? htmlFiles(path)
      : entry.name.endsWith(".html")
        ? [relative("dist", path)]
        : [];
  });
}

function localTarget(href) {
  const target = href.replace(/[?#].*$/, "");
  if (target === "/") return resolve("dist", "index.html");
  if (target.startsWith("/_astro/") || /\.[a-z0-9]+$/i.test(target))
    return resolve("dist", `.${target}`);
  return resolve("dist", `.${target}`, "index.html");
}

for (const file of htmlFiles("dist")) {
  const html = readFileSync(resolve("dist", file), "utf8");
  const headingCount = (html.match(/<h1[\s>]/g) ?? []).length;
  if (headingCount !== 1)
    throw new Error(
      `${file} must contain exactly one h1; found ${headingCount}`
    );
  const headings = [...html.matchAll(/<h([1-6])[\s>]/g)].map((match) =>
    Number(match[1])
  );
  for (let index = 1; index < headings.length; index += 1) {
    if (headings[index] > headings[index - 1] + 1)
      throw new Error(`${file} skips a heading level`);
  }
  if (
    html.includes("fonts.googleapis.com") ||
    html.includes("fonts.gstatic.com")
  )
    throw new Error(`${file} references an external font CDN`);
  if (html.includes('<script type="module"'))
    throw new Error(`${file} ships client JavaScript`);

  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const reference = match[1];
    if (!reference.startsWith("/") || reference.startsWith("//")) continue;
    if (!existsSync(localTarget(reference)))
      throw new Error(`${file} references missing local target: ${reference}`);
  }
}

console.log(
  `Verified ${expected.length} static artifacts and ${htmlFiles("dist").length} semantic, zero-JavaScript HTML pages.`
);

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
Worktree: /Users/bikram/.operon/Bikram-Org/worktrees/buildstacks.dev/op-30-prove-the-green-foundation-contract-from-a-clean
Branch: op/30-prove-the-green-foundation-contract-from-a-clean
PR: (not opened yet)
Ticket tier: quick
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

# Pass: implement (build pipeline)

Implement the ticket in the brief above, honoring the implementation
contract when one is present. Mechanical gates re-run everything after this
pass; an unverified claim of success only wastes a remediation cycle.

## Protocol

1. **Read before write.** Read every file you will modify — in full — before
   editing it. Patterns you did not read are patterns you will break.
2. **Baseline before changes.** Run the app's full test suite before
   touching anything. If the baseline is red, **stop**: report blocked with
   the failing output verbatim. A broken base is an incident for the SRE,
   never something to build on and never yours to quietly fix.
3. **Minimal diff.** The smallest change that satisfies every acceptance
   criterion. Stay within the contract's files list. No drive-by refactors,
   no speculative generality, no fixing what the ticket did not ask about.
4. **Verify with the full suite.** Run the complete test suite and require
   exit code 0. This is NOT optional and NOT limited to task-specific
   tests — the criteria say what you built; the full suite says what you
   broke.
5. **Plan-adherence self-check** before declaring done:
   - every acceptance criterion is addressed, each by the test named in the
     contract's mapping;
   - only in-scope files are touched — revert strays now, whatever they
     cost you;
   - the change conforms to the architecture it lives in (imports, layering,
     conventions of the surrounding code), and any deviation from the
     contract's approach is declared in your verdict, not discovered later.
6. **Atomic commits**, message format `#<issue>: description`. Each commit
   is one coherent step that leaves the tree building. Never commit a
   red tree as "WIP".

## Bounded attempts — never thrash

Mechanical failures (a failing test, lint error, type error with a clear
fix) get **at most 3 fix attempts** in this pass. Design failures — a
criterion that cannot be implemented as written, criteria that contradict
each other or the code, an approach that proves wrong — get **zero**:
escalate immediately as blocked. Repetition is evidence you are past the
mechanical case.

## Output

Report exactly one verdict: `done` or `blocked`.

- `done` only when the full suite exits 0 and the self-check passes —
  with the test output to show for it.
- `blocked` carries a blocked entry with exactly these four parts:

```
**Error:** <the failing output, verbatim — never a paraphrase>
**Attempted:** <what you tried, concretely>
**Result:** <what happened when you tried it>
**Assessment:** <why this is blocked and what would unblock it>
```

A precise blocked entry is a successful outcome: it is what lets the
Planner rework the ticket instead of re-running the same failure.
