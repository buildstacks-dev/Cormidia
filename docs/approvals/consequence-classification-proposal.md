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
| `grantable` | Requires authorization; a standing objective grant can cover it in advance | One decision per objective, up front |
| `human-only` | Requires a human decision per instance **by default** — but see §4.1 | Every time, unless explicitly granted |
| `un-grantable` | No grant of any kind can cover it, ever | Every time, without exception |

`human-only` and `un-grantable` together replace today's
`NEVER_SCOPEABLE_RULES` (`src/org/approvals.ts:205`), whose membership is
currently inherited from rule name rather than derived from consequence.

### 4.1 An explicit human grant may cover `human-only`

**In plain language:** if the owner, in full knowledge of what it means, says
"you may publish this package when qualification passes," the agent should
publish. Not stop and ask again. The owner has a reason for saying it — usually
that they do not want to sit at a keyboard waiting to press a button — and the
system should not second-guess a decision the owner is entitled to make. The
job of the gate is to make sure the owner knew exactly what they were granting,
not to withhold the option.

So `human-only` means *"a human must decide this"* — **not** *"a human must
decide this again every time."* A pre-authorization is a human decision. It is
made earlier, with more deliberation, and with a written scope, which makes it
a **better** decision than the fortieth tap of a long session.

An objective grant may therefore name `human-only` classes, subject to
ceremony proportional to the stakes:

| Requirement | Reason |
| --- | --- |
| Named explicitly, one class per line — never a wildcard | The owner must be able to read what they granted |
| Bounded scope per class (package name, version pattern, repo, host, target) | "Publish `cormidia@0.1.x`" is a decision; "publish anything" is a blank cheque |
| Optional precondition expression (e.g. RQ-1 evidence complete) | Lets the grant encode *when*, not just *whether* |
| Use cap and TTL, both shorter than the `grantable` defaults | Stakes scale the blast radius of a mistake |
| A distinct CLI verb — never a flag on the ordinary path | Granting a critical class must not be reachable by muscle memory |
| Per-use audit row, and the verdict names the covering grant | The owner can always reconstruct what their grant actually authorized |
| Revocable immediately, same as any grant | |

### 4.2 The `un-grantable` set, and why it is exactly this small

**In plain language:** there is one category that cannot be delegated, and it
is not the dangerous stuff. It is the machinery that *records and enforces
delegation itself*. If an agent can forge a grant, rewrite the rules that
interpret grants, or fabricate the evidence a grant depends on, then every
other grant becomes meaningless — because the agent can manufacture your
consent for anything. A lock whose key can be copied by the thing it locks out
is not a lock.

This is not a safety preference. It is a logical requirement, and it is the
only thing in this document that is not the owner's to override.

| Rule | Why it is structurally un-grantable |
| --- | --- |
| `approval-store-tamper` | Writes the grant files. Could forge a grant, or extend its own. |
| `protocol-self-edit` | Rewrites roles, prompts, and charter — i.e. what a grant *means*. |
| `scorecard-tamper` | Fabricates the evidence a conditional grant is predicated on. |
| `learning-surface-tamper` | Persistently rewrites the agent's own future behavior across episodes. |

Everything else — `production-deploy`, `package-publish`, `dns-or-domain`,
`secret-mutate`, `destructive-remote-data`, `self-merge-or-approve` — is
`human-only` by default and **grantable under §4.1**, because a competent owner
can understand and bound each of them. This shrinks the permanently locked set
from six rules to four, and moves the shipping decision you actually care about
into the delegable category.

---

## 5. The classification table

**In plain language:** this is the whole proposal in one table. Six rules do not
change at all — they are the genuine boundaries and they stay locked. Four
rules split, because they currently bundle a routine action with a dangerous
one under a single name. Two relax, with a compensating check that is tighter
than what it replaces.

Legend: **UG** = un-grantable, **HO** = human-only (grantable under §4.1),
**G** = grantable, **B** = budgeted, **R** = routine.

| # | Rule | Today | Proposed | Change |
| --- | --- | --- | --- | --- |
| B1 | `production-deploy` | HO | **HO** | now grantable under §4.1 |
| B2 | `destructive-or-irreversible` | G | **split** | see 5.1 |
| B3 | `dns-or-domain` | G | **HO** | **tighten** — cheap and permanent, currently grantable |
| B4 | `secrets-or-auth` | G | **split** | see 5.2 |
| B5 | `external-publishing` | HO | **split** | see 5.3 — the headline |
| B6 | `provider-global-memory` | G | **G** | none |
| B7 | `outbound-network` | G | **G + host allowlist** | see 5.4 |
| B8 | `self-merge-or-approve` | HO | **HO** | now grantable under §4.1 |
| B9 | `protocol-self-edit` | HO | **UG** | **tighten** — structurally un-grantable (§4.2) |
| B10 | `scorecard-tamper` | HO | **UG** | **tighten** — structurally un-grantable (§4.2) |
| B11 | `learning-surface-tamper` | G | **UG** | **tighten** — structurally un-grantable (§4.2) |
| B12 | `approval-store-tamper` | HO | **UG** | **tighten** — structurally un-grantable (§4.2) |

Net: **four rules tighten** (B3, B9–B12 — three of which move from grantable or
tappable to permanently un-grantable), four split, one gains a scoping
mechanism, and two (B1, B8) become delegable in advance under §4.1 while
remaining human decisions.

The permanently locked set is now exactly the machinery of consent itself, and
nothing else.

### 5.1 B2 `destructive-or-irreversible` → split by target

This rule was already calibrated once: `rm -rf` on a *relative* path inside the
sandbox worktree became routine, after an episode escalated deleting a temp
folder in its own checkout. The same logic applies one level up.

| New class | Matches | Consequence | Tier |
| --- | --- | --- | --- |
| `destructive-remote-data` | `drop table`, `truncate`, `delete database\|bucket\|droplet` | irreversible / outside-world | **HO** |
| `history-rewrite-owned` | force-push where the target ref is inside the orchestrator-owned ticket branch namespace (`op/<issue>-…`) | recoverable / app-repo | **B** |
| `history-rewrite-foreign` | force-push to any other ref, including the resolved default branch | recoverable / app-repo | **HO** |
| `destructive-local` | `rm -rf` absolute, `~`, `$HOME`, or `..` escape | irreversible / worktree+ | **G** |
| `gh-api-unrecognized` | mutating `gh api` no tighter rule recognizes; all `gh api graphql` | unknown / unknown | **HO** (fail closed, unchanged) |

Branch resolution must use `resolveRemoteDefaultBranch()` per AGENTS.md — never
a hardcoded name, and re-resolved per claim, not cached.

**Why `history-rewrite-owned` is budgeted rather than human-only.** The
question "is force-push expected workflow or an outlier?" is answered by the
code. `src/loop/loop.ts:2574` pushes plainly first and force-pushes **only** on
a non-fast-forward failure, and its comment states the boundary exactly:

> *"The orchestrator owns the `op/<issue>-…` branch namespace and rebuilds the
> branch from `origin/main` on every attempt. A prior interrupted attempt … can
> leave a stale, divergent remote branch that makes a plain push fail
> non-fast-forward and permanently wedge the ticket. The freshly rebuilt branch
> is authoritative, so force-update this one ref (**never any other**; the
> branch name is always the ticket's)."*

So it is expected — routinely reachable whenever a turn is interrupted at its
budget cap — but confined to a namespace the orchestrator owns and to refs it
built itself. That scope is already enforced in code; the classification should
mirror it rather than invent a looser one. Budgeted rather than routine so that
a loop force-pushing repeatedly shows up as spend instead of as silence.

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
| `repo-collaboration` | `gh issue create/comment`, `gh pr create/comment`, `cormidia.github.issue.*` — **only when the target repo is the app's own configured repository** | reversible / app-repo | **B** |
| `repo-collaboration-foreign` | the same verbs against any other repository | reversible / outside-world | **HO** |
| `package-publish` | `npm publish` | irreversible / outside-world | **HO** |
| `release-artifact` | `gh release create`, tag creation | irreversible / outside-world | **HO** |
| `outbound-message` | `sendmail`, `mail`, `tweet`, `CORMIDIA_VERB.publish` | irreversible / outside-world | **HO** |

`repo-collaboration` is **budgeted, not routine** (owner decision, 2026-08-05).
It is in scope for the org's own agents working on the org's own app in the
org's own repository, but "in scope" is not "unbounded": routine gives an agent
in a loop no ceiling and produces no signal, while budgeted makes runaway
PR-opening visible as spend. Free until it isn't, which is the principle.

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

**The ceiling is configured, never hardcoded** (owner decision, 2026-08-05).
This already holds for the monthly budget: `src/org/bootstrap.ts:532` sets
`budgetUsdMonth = 1000` as a **default**, overridable at onboarding and stored
per-org as `budget_usd_month` in `config.yaml`. `Cormidia/.cormidia/config.yaml:34`
reads 1000 because that value was chosen at onboarding, not because it is
baked in. The objective ceiling inherits the same treatment: same default,
same per-org override, same precedence. There is no separate rule for
Cormidia-as-an-app versus any other customer's org — Cormidia is onboarded as
an app like any other, and that is the point.

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

- The review boundary. B8 stays a human decision, including
  `gh pr review --comment` (finding A-001: it is the self-approval marker's
  publish channel). It becomes delegable in advance under §4.1, which is a
  human decision made earlier — not a removal of the boundary.
- Protocol surfaces. TASTE.md, roles.yaml, pipelines.yaml, prompts/**,
  PURPOSE.md remain human-ratified and human-merged, and B9 moves from
  human-only to permanently un-grantable.
- The roots of trust. B10 and B12 tighten from human-only to un-grantable.
- Production deploy. B1's classification and its A4 release executor are
  untouched; only its delegability changes, under §4.1's ceremony.
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

## 11. Owner decisions (resolved 2026-08-05)

1. **`repo-collaboration` is `budgeted`, not `routine`.** In scope, but not
   unbounded. Applied in §5.3.
2. **The spend ceiling is configured, never hardcoded**, with the same default
   and override path as `budget_usd_month`, and no special case for Cormidia
   as its own customer. Applied in §7.
3. **Force-push follows the namespace the orchestrator already owns.**
   `op/<issue>-…` is budgeted; every other ref is human-only. This mirrors the
   scope already enforced at `src/loop/loop.ts:2574`. Applied in §5.1.
4. **An explicit human grant may cover `human-only`.** A pre-authorization is a
   human decision, made earlier and with a written scope. Only the machinery of
   consent itself is permanently un-grantable. Added as §4.1 and §4.2.
5. **Migration: in-flight grants cancel at landing.** Plain language: an
   approval is stored as a fingerprint of the exact thing approved, and this
   change alters how that fingerprint is computed, so old approvals stop
   matching. Two options existed — cancel everything outstanding, or support
   both fingerprint schemes in parallel. Cancelling is chosen: grants carry a
   24-hour TTL, there are no external users, and running two schemes at once is
   exactly the kind of overlap that produces a security hole. The observable
   effect is that a turn mid-flight at landing raises one fresh approval. This
   is the same choice made on 2026-07-17 for the same reason.

### Still open

6. **Structural-change classification.** See §13.

---

## 12. Rollout

1. **Finish 0.1.1 under the currently ratified rules.** See §14 — this is a
   hard sequencing constraint, not a preference.
2. Land the consequence model and `decideDisposition` with **no tier changes** —
   pure refactor, every current disposition preserved, full suite green. This
   step is not structural (§13) and needs no harness revision.
3. `validation-harness-design` in `harness-revision` mode, existing artifacts as
   baseline, before any tier moves (§13).
4. Land tier changes **one rule per PR**, each with its seeded negative control,
   tightening first: B9–B12 to `un-grantable`, then B3.
5. Land `ObjectiveGrant`, the budget ledger, and §4.1's grant ceremony.
6. Land B5 last — the largest behavioral change, with the most calibration
   value once the mechanism underneath is proven.

---

## 13. Is this a structural change?

**In plain language:** the underlying question is when you build a test
framework. You want the framework in place early, so that as you build features
you are adding cases to something that already exists. You only rebuild the
framework itself when the architecture moves under it. That model is correct,
and it is exactly what the two modes of the `validation-harness-design` skill
encode: adding cases against existing structure is ordinary work, while
changing the structure the cases hang from is a redesign.

Applied here, the answer splits, and the split is useful:

**Step 2 is not structural.** Introducing `decideDisposition` while preserving
every current disposition adds no journey, boundary, or invariant. Every
existing case must still pass unchanged — that is the definition of the step.
It is a refactor with a strong oracle, and it can proceed immediately.

**Steps 4–6 are structural.** They do not add cases to the invariant "critical
operations require human approval." They *replace* that invariant with
"operations require the disposition their consequence class specifies," and
introduce a new authority object with a lifetime the boundary map does not
currently describe. Per AGENTS.md, that is a redesign, not a case-level
addition, and improvising it would pile cases onto a shape that no longer fits.

So the recommendation is to **split the work at the behavior boundary** rather
than block all of it on the redesign. Build the mechanism now under the existing
harness; revise the harness before the policy moves. This also front-loads the
riskiest refactor into the phase where the old tests are still a valid oracle —
which is the strongest safety net this change will ever have.

A finding should be opened in `validation-policy.yaml` → `open_findings:` with
the next `F-PT-nnn` id at the point step 3 begins, mirrored into
`harness-design-state.md`, with dependent catalog cells parked as
`BLOCKED:<finding>`.

---

## 14. Sequencing constraint: do not touch these files before 0.1.1 ships

**In plain language:** the release currently in flight has evidence bound to an
exact commit and an exact policy. Editing the policy, the charter, or the
candidate invalidates that evidence and forces a fresh paid campaign. This
proposal touches precisely those files. So it waits.

Raised by the release-candidate session operating `0.1.1`, and correct.

Blocked until `0.1.1` completes: any non-evidence change to `docs/PURPOSE.md`,
authority policy, `validation-design/validation-policy.yaml`, the release
assessor, or the candidate commit.

Not blocked: this document, which is a proposal in `docs/approvals/` and binds
nothing until ratified.

The cost of getting this wrong is concrete and already measured — session
`019fd272` spent $81.90 re-establishing authorization four times because the
candidate moved underneath it. Landing an autonomy redesign mid-qualification
would reproduce that at a larger scale.

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
