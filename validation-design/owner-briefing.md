# Owner briefing — Cormidia validation harness (as of rev-2026-08-10)

Non-normative by construction: this is generated from the ratified artifacts, and if
it ever disagrees with them, the artifacts win. It exists so you can ratify and steer
without reading ID-dense files. Generated 2026-08-10 against commit `15708a7e`;
frozen at campaign close after the independent audit loop finished **clean** — a
fresh auditor found four record-consistency problems, all four were fixed and then
verified by a second fresh auditor, and nothing you had already ratified was
reopened (the full record is the ratification package's Audit section, §14).

One thing from that audit you should know before you verify anything yourself: your
original long-form notes file was replaced in the evidence tree on 2026-08-10 by
your new one-page ramble. Older citations of your own words therefore no longer
match the file called rambling.txt — they now verify through a dedicated archive
record (`rambling-archive.md`) that says exactly which quotes survive where, and
honestly marks the few that survive only as attestations. Nothing was fabricated;
the paper trail just moved, and the archive is the map to it.
<!-- changelog 2026-08-10 (campaign close): audit-close and provenance-archive
paragraphs added; generated content below unchanged. -->

## 1. What this product can break

Cormidia is a standing AI company that spends your money and acts in your name: it
writes code, merges it, files issues, and — only with your explicit approval — can
publish, release, or touch things outside its sandbox. The harness treats it as
**production-grade (C2)** with twelve named places where a failure is worse than
ordinary (T-1…T-12): the approval gate, the merge path, budget settlement, secret
confinement, the release path, and their kin. There, a lie is not a bug — it is your
authority being exercised without you, your card being charged without a record, or
your repo being rewritten without a reviewer. One deliberate calibration: a solo
operator's self-hosted runtime is not a bank — but the *release* path and anything
irreversible are treated as if it were.

Nothing in the recent product changes moved this. The commercial direction you wrote
down on 2026-08-09 (free public binary, paid customer source bundles) **will** move it
the day a first external user exists — and the backlog now carries a tripwire that
forces that re-look before launch, not after (see §7).

## 2. The promises

What must never break: sixteen product promises, in plain words. Each is a falsifiable statement with tests
and, where a model or vendor could break it at runtime, a fail-closed guard in code.

1. Agents never rewrite their own authority — config, roles, prompts, PURPOSE are
   proposal-only for them, always.
2. Every action that can hurt you is classified before it runs, and anything the
   classifier cannot understand is treated as critical — it stops.
3. Approval means *this exact thing, once*; approving is recorded separately from
   whether it actually happened, and nothing is ever silently re-performed.
4. One app's work, memory, money and secrets never leak into another app's.
5. A unit of work is claimed exactly once, no matter how many timers fire.
6. Every paid model turn is settled in the ledger exactly once — unknown usage is
   never rendered as zero, and estimates say they are estimates.
7. A paused or broke app cannot quietly keep spending.
8. What the surfaces show you is what durably happened — labels, dashboards and
   summaries are projections of records, never authority.
9. A review approves an exact commit; a commit pushed after the review invalidates
   the approval. The default branch is looked up, never guessed.
10. Destruction (app reset) is archived first, scoped exactly, and never touches
    your own checkout.
11. Secrets never egress through published issues, reports, narratives or exports —
    one shared pattern list guards every exit.
12. "Tests passed" without a run, an APPROVE without a marker, a self-report feeding
    a promotion metric — all unrepresentable.
13. Durable state survives being killed at any moment; torn writes are quarantined,
    never read back as truth.
14. Considered work never silently vanishes — every non-admission has a name.
15. When something breaks, the system gets *less* capable, never more.
16. Delivered code carries an unbroken chain: plan → validation obligations →
    builder evidence → independent review → merge, with nothing swapped in between.

Beside these sit eight **campaign promises** that protect measurements rather than
the product (sealed answer keys, grader independence, and so on). They are fenced off
separately precisely so nobody ever reads a harness promise as a product promise.

## 3. The seams

These are the places where two systems can disagree about what happened. Thirty
boundaries are mapped — every place ownership, consistency, or failure domain
changes hands. The ones that matter most to you: **GitHub** (the system of record can
lag, lose a response, or move a branch under us — every write is designed for the
"did it land?" ambiguity), **the seven provider adapters** (Claude, Codex, pi,
OpenCode, Cursor, Grok Build, Muse Code — each certified against the real product
before any role may use it; Grok is sandbox-only until your vendor risk review
closes; Muse is fail-closed off because its gate seam could not be proven), **the
approval queue** (decision vs. execution split into two seams so a crash between
them is recognizable), **the clock and the process** (sleep, kill, PID reuse), and
**the human checkout** (your working copy is untrusted territory the runtime must
never clobber — your bytes always win). Where a seam cannot be honestly faked, it
carries a named live obligation with a spend ceiling instead of a pretend test.

## 4. What we deliberately will NOT test, and why

- **Pixels and prose polish** — thin smoke only; cosmetics are C1.
- **Model output quality as a gate** — measured, never enforced, until you ratify
  thresholds. Every quality number today is `inconclusive` by design, and
  `inconclusive` is never a pass.
- **A second copy of behavior per interface** — core behavior is proven once;
  CLI/JSON/UI/skill get thin conformance plus one cross-surface agreement check.
- **Job output quality** — jobs are deliberately outside the governed loop (no
  reviewer, no verdicts); their machinery is proven offline, and their only outcome
  measurement is an acceptance campaign you individually authorize.
- **The full Cartesian product of everything** — risk prunes the matrices; every
  prune is named in the catalog, none is silent.

## 5. The decisions on your desk

From this revision (ratification-package.md §12.3 — each needs your YES/NO):

1. **"Different provider" means provider *family* for Builder/Reviewer.** YES pins
   autonomous code delivery to cross-family review (a same-family collapse refuses
   before any model runs; two adapters over one upstream family count as same). NO
   means telling us what the unit is instead.
2. **GTM enters as a triggered ticket, not a finding.** YES accepts that nothing
   blocks today and three tripwires block their own launch events (§7).
3. **F-PT-019's shape**: contract ratified, implementation owed under HB-135. YES
   authorizes the classifier work with no further gate.
4. **CF-J21-A folded into the reconciliation guardrail; CF-J21-I owed under HB-136.**
5. **The consistency sweep itself** — every correction is checkable at its inline
   changelog.

Standing items unchanged by this revision: event-producer protocol (F-PT-006),
grant-expiry disposition (F-PT-008), all quality thresholds (F-PT-009/010/011), the
Grok vendor risk review (#339), and the L-ACC thresholds you deliberately deferred
until a campaign produced a graded distribution to ratify against — run 1 happened
but ended entirely ungraded at its plan gate, so the trigger (a first *graded* run)
remains unmet; the deferral ripens with the first campaign that actually grades.
<!-- clarified 2026-08-10 (reader test 9 follow-up) -->

## 6. What is still unknown

Each open item below is stated as the incident you would face if it fired today.

- **F-PT-006:** if an event producer crashes mid-write, the dispatcher's tolerated
  behavior is undocumented — an incident there has no ratified expected outcome; the
  harness deliberately refuses to guess.
- **F-PT-008:** an approval whose grant expires after decision has no ratified
  disposition — you would be deciding it live, during the incident.
- **Thresholds:** until you ratify them, no quality regression can mechanically stop
  anything — reviewer/planner quality drift would reach you as data, not as a gate.
- **Seven-day soak and threat model:** both remain future assurance you chose to
  keep outside the release gate; their absence is visible, never green.
- **YAML parse of the new machine catalog:** the campaign sandbox had no interpreter;
  first repo CI run must confirm it parses (recorded, not assumed).

## 7. What gets built, in what order

Everything through the 2026-08-08 L-ACC wave is landed; what remains is short:

- **HB-133 (now):** the Builder/Reviewer provider-family pin — catches the quiet
  config change that would put one vendor's blind spots on both sides of your merge.
- **HB-135 (now):** the operation-aware secrets classifier you ratified in PURPOSE
  v2.15 §4 — ends both failure directions: harmless metadata queries burning your
  approval attention, and a real secret print classified routine.
- **HB-136 (soon):** kill-the-campaign-at-every-boundary tests, so an interrupted
  acceptance campaign can never masquerade as a finished one.
- **HB-134 (triggered, no work now):** three tripwires that block customer source
  bundles, public-license changes, and first-external-user launch until their
  homework (customer-verifiable evidence subset; license coherence proof;
  deployment-shape and tier re-look) is done.
- **Standing waits on you:** schedule the seven-day soak; author the threat model;
  ratify thresholds when ready; close or keep open the Grok vendor review.
- **Comparative execution (HB-090…094)** stays a designed-not-built epic until you
  call for it.

Follow along in `owner-backlog.md`, which restates every ticket in this language.
