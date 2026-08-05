# Consequence classification for the approval gate — proposal

**Status:** proposal, not ratified. Nothing here is binding until the product
owner accepts it. `docs/approvals/design.md` remains the contract.

**Origin:** Codex session `019fd272` (2026-08-05). Four hours, $81.90 of
orchestration, four invalidated approvals, one abandoned session, to authorize
$0.67 of actual campaign spend. The full census is in the tracking issue that
links this document.

---

## 1. Why this exists

Read the header comment on the rule table in `src/runtime/gate.ts:282`:

> *"v0 heuristics. Deliberately over-broad: false positives cost a human tap,
> false negatives cost an incident. Tighten with calibration data."*

That was the right call at v0. A gate that stops too much is recoverable; a
gate that misses an incident is not. But "tighten with calibration data" was a
promise, and it has been kept exactly three times — each time after an episode
that hurt. One of those calibration comments records an episode that *"burned
24 escalations and its final $30 pass on a repo `.npmrc` containing only
`engine-strict=true`."*

The pattern is always the same. A rule matches on a **verb** — `npm`, `curl`,
`gh` — and then treats every action that verb can express as if it carried the
verb's worst consequence. `gh issue comment` is stopped as hard as
`npm publish`, because both are "publishing." One is a reversible note on your
own ticket. The other is permanent and public.

**The gate classifies by verb family. Consequence does not follow verb family.**
That is the whole defect, and everything below follows from fixing it.

There is a second, less obvious cost to over-broad rules, and it matters more
than the wasted taps: a gate that stops everything trains the human to approve
everything. Today a tired operator waving through the fortieth `gh issue
comment` of the day is also waving through a comment on *any* repository,
because the gate never checked which one. Over-broad and under-specific are the
same failure. Narrowing by consequence makes the routine case free **and the
dangerous case harder** — it is not a loosening in aggregate.

---

## 2. The core principle

> **Classify the consequence of the specific action, not the family of the verb
> that expressed it. Let disposition follow consequence.**

Today a rule carries its own disposition: `external-publishing` is critical and
un-grantable, permanently, for every action it matches. Under this proposal a
rule only *identifies* an action; a separate consequence classifier decides
what happens.

```
today:      action ──▶ rule ──▶ (critical? human-only?) ──▶ approval
proposed:   action ──▶ rule ──▶ consequence class ──▶ disposition ──▶ ...
```

The rules stay. The regexes stay. What changes is that matching a rule is no
longer the end of the decision.

---

## 3. The consequence model

**In plain language:** before asking a human, the system should be able to
answer three questions — *can this be undone, who can see it, and what does it
cost?* Right now it cannot answer any of them. Nothing in the decision path
carries reversibility, blast radius, or a dollar figure. Two of the twelve
rules are about actions costing fractions of a cent; the gate cannot tell them
from the one that publishes to npm.

Every classified action carries three axes.

### 3.1 Reversibility

| Value | Meaning | Examples |
| --- | --- | --- |
| `reversible` | Undoable by the same actor, no coordination | edit a comment, close an issue, delete a branch |
| `recoverable` | Undoable with effort or another party | force-push a topic branch, revert a merge |
| `irreversible` | Cannot be undone at any cost | `npm publish`, DNS change, `drop table`, sending mail |

### 3.2 Blast radius

| Value | Meaning |
| --- | --- |
| `worktree` | Confined to the agent's own sandbox checkout |
| `app-repo` | Affects the app's own repository, visible to its collaborators |
| `org-state` | Affects `~/.cormidia/<org>/` — approvals, scorecards, learning, memory |
| `outside-world` | Visible or consequential beyond the org: registries, DNS, email, third parties |

### 3.3 Cost

`known(usd)` when the action's spend is estimable before execution, `unknown`
otherwise. `unknown` is not a failure state — it routes to the conservative
branch.

### 3.4 The rule that makes the shield honest

> **Dollars OR irreversibility, whichever trips first.**

A pure spend shield has a hole, and it is exactly the set of actions that
matter most: a DNS change, a secret rotation, an `npm publish`, a merge. All
cost under one dollar. None can be undone. A budget ceiling alone would let
every one of them through.

Formally: an action is human-only if
`irreversible AND blast_radius == outside-world`, **regardless of cost.**

---

## 4. Disposition tiers

**In plain language:** there are only four useful answers to "does this need a
human?" — *no*, *not until the money runs out*, *only once for the whole
objective*, and *every single time*. Today the system effectively has two, and
the second one is used far too often.

| Tier | Behavior | Human involvement |
| --- | --- | --- |
| `routine` | Proceed. Record in the turn log. | None |
| `budgeted` | Proceed while cumulative objective spend is under ceiling. Escalate **once**, at the ceiling. | One decision per objective, at the boundary |
| `grantable` | Requires authorization, but a standing objective grant can cover it in advance | One decision per objective, up front |
| `human-only` | Every instance. Never grantable, never scopeable, never agent-decidable. | Every time |

`human-only` is `NEVER_SCOPEABLE_RULES` (`src/org/approvals.ts:205`) with its
membership recomputed from consequence rather than inherited from rule name.

---

## 5. The classification table

**In plain language:** this is the whole proposal in one table. Six rules do not
change at all — they are the genuine boundaries and they stay locked. Four
rules split, because they currently bundle a routine action with a dangerous
one under a single name. Two relax, with a compensating check that is tighter
than what it replaces.

Legend: **HO** = human-only, **G** = grantable, **B** = budgeted,
**R** = routine.

| # | Rule | Today | Proposed | Change |
| --- | --- | --- | --- | --- |
| B1 | `production-deploy` | HO | **HO** | none |
| B2 | `destructive-or-irreversible` | G | **split** | see 5.1 |
| B3 | `dns-or-domain` | G | **HO** | **tighten** — cheap and permanent, currently grantable |
| B4 | `secrets-or-auth` | G | **split** | see 5.2 |
| B5 | `external-publishing` | HO | **split** | see 5.3 — the headline |
| B6 | `provider-global-memory` | G | **G** | none |
| B7 | `outbound-network` | G | **G + host allowlist** | see 5.4 |
| B8 | `self-merge-or-approve` | HO | **HO** | none |
| B9 | `protocol-self-edit` | HO | **HO** | none |
| B10 | `scorecard-tamper` | HO | **HO** | none |
| B11 | `learning-surface-tamper` | G | **G** | none |
| B12 | `approval-store-tamper` | HO | **HO** | none |

Net: **one rule tightens** (B3), four split, one gains a scoping mechanism,
six are untouched. The review boundary (B8), the protocol surfaces (B9), the
roots of trust (B10, B12), and production deploy (B1) are not negotiable and
are not touched.

### 5.1 B2 `destructive-or-irreversible` → split by target

This rule was already calibrated once: `rm -rf` on a *relative* path inside the
sandbox worktree became routine, after an episode escalated deleting a temp
folder in its own checkout. The same logic applies one level up.

| New class | Matches | Consequence | Tier |
| --- | --- | --- | --- |
| `destructive-remote-data` | `drop table`, `truncate`, `delete database\|bucket\|droplet` | irreversible / outside-world | **HO** |
| `history-rewrite-protected` | force-push where target branch is the resolved default branch or matches a protected pattern | recoverable / app-repo | **HO** |
| `history-rewrite-topic` | force-push to a topic branch the agent created this episode | recoverable / app-repo | **G** |
| `destructive-local` | `rm -rf` absolute, `~`, `$HOME`, or `..` escape | irreversible / worktree+ | **G** |
| `gh-api-unrecognized` | mutating `gh api` no tighter rule recognizes; all `gh api graphql` | unknown / unknown | **HO** (fail closed, unchanged) |

Branch resolution must use `resolveRemoteDefaultBranch()` per AGENTS.md — never
a hardcoded name, and re-resolved per claim, not cached.

### 5.2 B4 `secrets-or-auth` → split read from mutate

Reading a credential and changing one are different acts. Exfiltration — the
thing this rule exists to stop — is closed independently by B7
`outbound-network`, which the current rule's own comment already acknowledges.

| New class | Matches | Consequence | Tier |
| --- | --- | --- | --- |
| `secret-mutate` | `gh auth login/logout/refresh`, `gh secret set/delete`, `npm login/token`, `docker/gcloud/aws/kubectl` credential commands, rotate key | irreversible / outside-world | **HO** |
| `secret-read` | `printenv`, reading `.env`, `*.pem`, `id_rsa`, `~/.npmrc` | reversible / worktree | **G** |

The repo-local `.npmrc`/`.netrc` scrub calibrated at Stage 6 is retained
verbatim.

### 5.3 B5 `external-publishing` → the headline split

**In plain language:** this is the rule that will annoy every future customer,
on every ticket, forever. It is human-only and un-grantable, and it matches
`gh issue comment`. Cormidia's Builder cannot comment on its own ticket without
a human tap that no grant can ever cover — while the same rule, and the same
tap, also covers publishing a package to npm permanently.

| New class | Matches | Consequence | Tier |
| --- | --- | --- | --- |
| `repo-collaboration` | `gh issue create/comment`, `gh pr create/comment`, `cormidia.github.issue.*` — **only when the target repo is the app's own configured repository** | reversible / app-repo | **R** |
| `repo-collaboration-foreign` | the same verbs against any other repository | reversible / outside-world | **HO** |
| `package-publish` | `npm publish` | irreversible / outside-world | **HO** |
| `release-artifact` | `gh release create`, tag creation | irreversible / outside-world | **HO** |
| `outbound-message` | `sendmail`, `mail`, `tweet`, `CORMIDIA_VERB.publish` | irreversible / outside-world | **HO** |

Note the compensating control. Today, a human approving a `gh issue comment`
is approving a comment on **any repository** — the gate never checks which.
Under this split, the routine tier is available *only* after verifying the
target is the app's own repo; anything else escalates to human-only and cannot
be granted away. The dangerous case gets strictly harder while the routine case
gets free. This is the argument for every split in this document, and no split
should land without one.

### 5.4 B7 `outbound-network` → destination allowlist

Currently any `curl` is critical. Scope by destination instead of verb:
requests to hosts on the app's configured allowlist (default:
`registry.npmjs.org`, `api.github.com`, `github.com`) are `budgeted`; every
other host stays `grantable`; a request whose destination cannot be statically
determined (piped, variable-interpolated, shell-substituted) is **human-only**,
fail closed.

---

## 6. Objective grants — authority with a lifetime longer than one commit

**In plain language:** `docs/DEVELOPMENT.md` already promises this. It says
that when the candidate commit changes, *"the evidence tied to the old commit
expires — the objective's authority does not."* That is exactly right. But
there is no object in the system that can hold surviving authority, so
authority dies with the commit anyway. In session `019fd272` that cost four
approvals for one piece of work: fix a defect, commit changes, authorization
evaporates, ask again.

An `ObjectiveGrant` is a durable authority object, human-created only.

```
ObjectiveGrant {
  grantId, objective, createdBy, createdAt, expiresAt
  spendCeilingUsd          // the budget shield
  tiers: ["routine", "budgeted", "grantable"]   // never "human-only"
  repoNamespace            // e.g. "cormidia/Cormidia"
  outwardEffects: false    // invariant, not a setting
  revokedAt?
}
```

Properties that matter:

- **Survives a commit change.** Bound to an objective, not a candidate hash.
  This is the only new authority object; everything else already exists.
- **Cannot cover `human-only`.** The tier list is validated to exclude it. A
  grant that could would be a charter broadening, which
  `src/org/authority.ts:376` already forbids in the prose layer.
- **Cannot be created by an agent.** Written only by the human-facing CLI, same
  as A1 grants today (`docs/approvals/design.md` §"Grant scope").
- **The spend ceiling is the backstop.** Everything under it is autonomous;
  crossing it escalates once.
- **Revocable immediately**, same mechanism as `approvals revoke`.

The campaign manifest stays exactly as it is — content-bound, single-use,
commit-bound. It is the right object for *what will be executed*. The objective
grant answers a different question: *whether this line of work is authorized at
all*. Both, not either.

---

## 7. The budget shield

**In plain language:** the only two things in the entire system that know what
anything costs are the budget escalations, and they are bolted on the side. In
your policy they become the organizing principle: keep going until you would
cross the ceiling, then ask once.

- One cumulative ledger per objective grant, in the org state home.
- Every `budgeted` action debits it before execution.
- At the ceiling: escalate **once** as a single `objective-budget-exceeded`
  item carrying spend to date, the action that would cross, and a resume-cost
  estimate — reusing the existing `turn-budget-exceeded` shape.
- Ceiling exhaustion is never a pass. Per AGENTS.md, work stops
  `incomplete`, never green.
- The ceiling is a hard bound raisable only by a human editing the grant.

---

## 8. One decision point

**In plain language:** seven different mechanisms currently answer "does this
need a human?" and none of them can see the others' answers. That is why no one
was counting when session `019fd272` accumulated four approvals — nothing in
the system was counting on anyone's behalf.

All classification routes through one function:

```ts
decideDisposition(action, context) → {
  rule, consequence: {reversibility, blastRadius, cost},
  tier, reason, grantId?
}
```

Every caller — `turn-runner`, `runRole`, `plan-auto`, `release`, the campaign
path, the CLI — uses it. The seven mechanisms become seven *inputs* to one
decision, and the decision is logged with its consequence classification so
calibration stops being archaeology.

**Scope note.** `src/runtime/gate.ts` governs Cormidia's own managed agents. It
never sees the outer coding agent driving this repository — that population is
governed by prose (AGENTS.md, AUTHORITY.md, the session prompt). This proposal
addresses the code path. The prose path is a separate problem and should not be
conflated with it again.

---

## 9. What does not change

Stated explicitly so no reviewer has to infer it:

- The review boundary. B8 stays human-only, including `gh pr review --comment`
  (finding A-001: it is the self-approval marker's publish channel).
- Protocol surfaces. TASTE.md, roles.yaml, pipelines.yaml, prompts/**,
  PURPOSE.md remain human-ratified and human-merged.
- The roots of trust. B10 and B12 stay human-only.
- Production deploy. B1 unchanged, and its A4 release executor is untouched.
- Content-bound grant identity (A-002), `ACTION_IDENTITY_VERSION`, and the
  format-bump-cancels-grants migration behavior.
- Fail-closed defaults everywhere, including `legacyConservativeAuthority()`,
  which is a fail-closed floor rather than backward compatibility despite its
  name (see #294).
- RQ-1 release gating and every rule in the validation policy, which is
  tighten-only.

---

## 10. Risks, and what must land with the change

**In plain language:** four of these changes make the gate allow more than it
does today. That is a security-relevant loosening, and this project's own rules
say a gate is never weakened to make something pass. Each one therefore has to
earn its place individually, with a test that proves the dangerous case still
stops.

| Risk | Mitigation | Detector |
| --- | --- | --- |
| `repo-collaboration` routine tier used against a foreign repo | Target-repo verification against app config before the routine tier is reachable | Seeded negative control: comment on a non-app repo must escalate `human-only` |
| Branch classification tricked into treating the default branch as a topic branch | `resolveRemoteDefaultBranch()`, re-resolved per claim (#101, #203) | Extend `tests/hermetic/cf-reg-203/` to force-push classification |
| Host allowlist bypassed via interpolation or pipe | Undeterminable destination ⇒ human-only, fail closed | Seeded case per evasion form |
| Objective grant used to cover a `human-only` tier | Tier list validated at creation; rejected, not filtered | Red-then-green on a grant naming `human-only` |
| Budget ledger race under concurrent turns | Debit before execution, atomic write, same serialization as approval decisions | Concurrent-debit hermetic test |
| Consequence classifier itself becomes the single point of failure | It is pure and total; unknown ⇒ conservative branch | Property test: no input yields a tier looser than today's without an explicit new class |

Per AGENTS.md: every defect fix deposits its detector, every detector family
lands red-then-green against a seeded violation, and no golden set is weakened.
These are not optional and are part of the same change.

---

## 11. Open questions for the product owner

Answers change the implementation; none should be guessed.

1. **Is `repo-collaboration` genuinely routine, or should it be `budgeted`?**
   Routine means the Builder opens PRs and comments with no ceiling at all. The
   proposal says routine. A conservative first cut is `budgeted`.
2. **What is the default objective spend ceiling?** You said $1,000. Confirm,
   and confirm whether it is per objective or per calendar month.
3. **Does `history-rewrite-topic` stay grantable, or is any force-push
   human-only?** The proposal grants it; a stricter reading locks all of it.
4. **Should this open a finding?** It changes what a boundary means, which per
   AGENTS.md may be a *structural* change requiring re-entry into the
   `validation-harness-design` skill in `harness-revision` mode rather than
   case-level additions. My reading is that it is structural. If you agree, that
   skill runs before implementation, not after.
5. **Migration.** Reclassification changes action identity semantics. Do
   in-flight grants cancel at landing, as A-002 did on 2026-07-17?

---

## 12. Rollout

1. Owner reviews this proposal and answers §11.
2. If §11.4 is structural: `validation-harness-design` in `harness-revision`
   mode, existing artifacts as baseline.
3. Land the consequence model and `decideDisposition` with **no tier changes** —
   pure refactor, every current disposition preserved, full suite green. This
   isolates the mechanism from the policy.
4. Land tier changes **one rule per PR**, each with its seeded negative control,
   starting with B3 (`dns-or-domain`), the one that tightens.
5. Land `ObjectiveGrant` and the budget ledger.
6. Land B5 last — the largest behavioral change, with the most calibration
   value once the mechanism underneath is proven.

---

## Appendix — evidence

- Session `019fd272`: 7 turns, 956 tool calls, 4h 24m, $81.90 orchestration,
  4 invalidated manifests (`a145ca21`, `5e84a002`, `b192d41a`, `e738d1f9`),
  authorizing an L3 campaign that consumed 6 provider turns and $0.673449.
- Candidates `f73f3acf` and `bcce930` share package SHA-256 `68cd5461…`. The
  commit moved; the artifact under qualification did not. A manifest bound to
  the package rather than the commit would have survived.
- Prior calibrations already in `src/runtime/gate.ts`: repo-local `.npmrc`
  (24 escalations, one $30 pass), relative `rm -rf` (temp folder inside the
  agent's own worktree), `provider-global-memory` (denied by hand eight times
  before becoming a named class). Every one split a rule by consequence rather
  than by verb. This proposal is that same move, applied deliberately instead of
  one painful episode at a time.
