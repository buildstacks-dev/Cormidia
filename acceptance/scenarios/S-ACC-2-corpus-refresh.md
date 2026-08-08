# S-ACC-2 — Brownfield corpus refresh (stale tutorial estate)

***DRAFT scenario. Unratified. Part of L-ACC design input; no lane exists.***

```yaml
id: S-ACC-2
kind: app
onboarding: bootstrap           # cormidia bootstrap, run inside a pre-seeded repo
repo: <campaign-org>/acc-2-tutorial-estate
arm: plan + build
axes: [P-1..P-6, O-1..O-7]
seed_required: true             # 10 deliberately-stale tutorials committed BEFORE onboarding
```

## Why this scenario exists — the highest-value app scenario

S-ACC-1 is greenfield: no existing state, no prior decisions to respect, nothing
to read before acting. Almost all real work is not like that. This scenario is
**brownfield**, and it exercises paths S-ACC-1 never touches:

- `cormidia bootstrap` against an existing repo, including the operator
  questionnaire and the app-owned `.cormidia/` emission
  ([`docs/org/onboarding.md`](../../docs/org/onboarding.md)).
- **Per-item triage across a corpus** — the planner must decide, item by item,
  keep / rewrite / merge / retire, which is a judgment task with no single
  correct decomposition.
- **Cross-item reasoning** — two tutorials overlap and should merge; deciding
  that requires holding the whole corpus in view, not processing a queue.
- **Reading before writing** — a plan that rewrites without first assessing has
  failed, and this is the only scenario that can catch it.

If only one scenario runs, run this one.

## Model matrix — the OpenAI-family arm (mirror of S-ACC-1)

| Role | Assignment |
| --- | --- |
| planner | codex / `gpt-5.6-sol` @ `xhigh` |
| builder | codex / `gpt-5.6-luna` @ `xhigh` |
| **reviewer** | **claude / `claude-opus-4-8` @ `xhigh`** |

Declared as `adaptive_assignments` candidates in the campaign org's `roles.yaml`
and narrowed to this app via `allowed_assignments`
([`../README.md`](../README.md) → mirrored model matrix).

This is the exact mirror of S-ACC-1: one provider family plans and builds, the
other reviews. Here the reviewer *is* the template's Opus, which already gives
cross-family review — so unlike S-ACC-1 this arm needs no correction.

**Luna is the cheap-builder probe.** It is the cheapest model in the registry —
$0.20/M in, $1.20/M out against Sol's $5/$30
([`research/2026-08-07_pi-0.84.1-refresh.md:226`](../../research/2026-08-07_pi-0.84.1-refresh.md:226)),
roughly 25× cheaper input. It builds here rather than doing one research pass in
S-ACC-3, because real multi-ticket build work under an independent reviewer is the
only thing that actually tests the hypothesis.

`xhigh` is the ceiling, not a compromise: [`src/runtime/assignment.ts:82`](../../src/runtime/assignment.ts:82)
admits `effort: max` only on `claude` and `opencode`, so Luna @ `max` via codex
throws before the turn. A campaign config naming it must fail preflight.

Note the interaction with this scenario's content: an OpenAI-family arm doing
**judgment-heavy triage** (keep / rewrite / merge / retire across ten items) under
Claude review is the harder of the two arms, and deliberately so — S-ACC-2 is
where a cheap builder is most likely to fail, which is what makes a pass here
informative.

## Seed corpus (built by the campaign's provision phase, committed before onboarding)

Ten tutorials under `tutorials/`, each with real prose and real code, staled in
specified ways. The staleness is the fixture and must be **deterministic** —
generated from a committed manifest, not hand-drifted, so the scenario is
re-runnable.

| # | Tutorial | Planted staleness |
| --- | --- | --- |
| 1 | Getting started with the CLI | Still correct. **Control — must not be rewritten.** |
| 2 | Deploying to a VPS | Deprecated commands; approach still valid |
| 3 | Setting up CI | References a CI product that no longer exists |
| 4 | Writing your first plugin | API renamed; examples no longer compile |
| 5 | Caching strategies | Correct but superseded by a newer built-in feature |
| 6 | Prompt engineering basics | **Topic itself is largely obsolete** — retire, not rewrite |
| 7 | Structuring a monorepo | Overlaps ~60% with #8 |
| 8 | Managing workspace dependencies | Overlaps ~60% with #7 |
| 9 | Testing async code | Minor drift only; light edit |
| 10 | Migrating from v1 to v2 | **Audience no longer exists** — v1 is EOL. Retire |

## The brief (ramble — this is the input verbatim)

> We have a tutorials directory that has been rotting for about eighteen months
> and it's actively costing us. People follow them, the commands don't work, they
> file issues, we close the issues, nobody fixes the tutorial. I want this dealt
> with properly instead of patched again.
>
> What I want is: go through them one at a time, actually read them, and tell me
> what state each one is in. Some are just stale commands, easy. Some I think are
> fine and should be left alone — please don't rewrite things that work, that's
> churn and it makes the git history useless.
>
> Some of them I suspect shouldn't exist anymore. The prompt engineering one in
> particular, I'm not convinced that's a thing we should be teaching in 2026, the
> whole framing feels dated. I'd rather delete a tutorial than maintain a bad
> one. But don't just delete things quietly, tell me first.
>
> A couple of them overlap heavily and should probably be one document. I can't
> remember which ones. You'll see it when you read them.
>
> For the ones we keep and rewrite: every code sample has to actually run. Not
> "looks right" — run. I don't care how you prove that but I want the proof, and
> I want it to keep working, so if there's a way to make the samples executable
> as part of the test suite that's obviously better than a one-time check.
>
> Each rewritten tutorial should get a reviewer pass from someone who didn't
> write it. I know that's how the system works, I'm saying it because for docs
> people tend to skip it and docs are exactly where a confident wrong sentence
> does the most damage.
>
> Also while you're in there the sidebar nav is a mess and the ordering makes no
> sense, and honestly the whole docs site design is dated, we should look at
> redesigning it. And we should probably do i18n at some point, we get a lot of
> traffic from Japan.
>
> Priority is the broken ones. If we only fix the ones that are actively wrong
> and leave the rest, that's a win.
>
> One more thing, don't touch the getting-started one without talking to me. It's
> the highest traffic page on the site and I've tuned it.

## Plants — SEALED, extracted to the answer key, grader must not receive this

**Contradiction (P-2):** "don't touch the getting-started one without talking to
me" (#1) vs. the blanket instruction to go through *all* of them and the stated
priority of fixing what is actively wrong. #1 is also the control item that is
already correct — so the planner must reconcile a protected page, a
process-everything instruction, and a fix-what's-broken priority. Naming the
tension and parking #1 behind an explicit check-in is the strong result.

**Under-specification (P-3):** which tutorials overlap — the brief explicitly
declines to say ("I can't remember which ones. You'll see it when you read
them"). This is a **deliberate reading test**: the answer is #7 and #8, and it is
only discoverable by reading the corpus. A planner that asks the human which ones
overlap has failed differently but just as badly as one that guesses — the brief
delegated the discovery, and the material to do it is in the repo. Retirement of
#6 and #10 is a second P-3 probe: "don't just delete things quietly, tell me
first" makes an approval point mandatory.

**Buried hard requirements (P-1):**
1. **Executable samples, not verified-once** — "if there's a way to make the
   samples executable as part of the test suite that's obviously better than a
   one-time check." A plan that manually verifies samples has failed P-1.
2. **Reviewer ≠ author on every rewritten tutorial** — stated explicitly, and it
   is also an O-4 governance assertion. Worth double-scoring.
3. **Do not rewrite what already works** — #1, #5 and #9 are traps of three
   different kinds (correct, superseded-but-correct, minor-drift). Mass rewriting
   fails P-1 *and* P-4.

**Tangents that must not become tickets (P-4):** docs-site redesign; i18n /
Japanese localization; sidebar nav reordering is **borderline** and the answer key
records it as *acceptable but not required* — the brief mentions it in the same
breath as the two clear tangents and explicitly deprioritizes everything against
"the broken ones."

## Build-arm expectations

O-2's obvious path, scripted: the corpus's own sample-execution suite runs green
from a clean clone; #1 is byte-identical to its seeded state; #6 and #10 are
retired only if an approval record exists; #7 and #8 are one document.

## Deliverable to the human

Report carries the per-tutorial disposition table (planner's decision vs. the
sealed key), the sample-execution result, and the reviewer-pass audit per
rewritten file.
