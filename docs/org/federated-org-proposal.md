# Federated org — one definition, many operators — proposal

**Status:** proposal, not ratified. Nothing here is binding until the product
owner accepts it. `docs/PURPOSE.md` remains the decision log and
`docs/architecture.md` the system map; on ratification the accepted parts land
there and this file becomes `docs/org/federated-org/design.md`.

**Origin:** a design conversation on 2026-08-14 that began as an evaluation of
the ACP bridge for adapter integration
(`research/2026-08-14_acp-bridge-adapter-integration-review.md`) and ended
somewhere else entirely. The adapter question was answered and closed. What
survived it is this: **Cormidia's deployment model assumes one operator on one
machine, and that assumption — not any adapter — is what stands between the
product and its customers.** This document starts from the problem, not the
solution, deliberately.

---

## 1. The problem statement

### 1.1 The shape customers are actually in

Enterprises have already adopted coding harnesses. Cursor, Claude Code, Codex —
seats bought, credentials provisioned, security reviews passed, engineers
trained. That decision is made and Cormidia does not get to re-open it.

What they have not solved is the layer above: a *standing organization* that
plans, builds, reviews, and operates through those harnesses with governance
and evidence. That is what Cormidia is for.

But Cormidia today installs as **one operator's org on one operator's machine**.
Ask what happens when a ten-person team wants it:

- Does each engineer create their own org? Then there are ten `roles.yaml`,
  ten `TASTE.md`, ten memories, ten backlogs, and ten agents racing for the
  same ticket. The organization is the product, and ten copies of it is not an
  organization.
- Does one engineer host it for everyone? Then that machine holds ten people's
  credentials, and every action in the audit trail is attributed to whoever
  installed it.

Neither is shippable. This is not a scaling problem that appears at a hundred
employees; it appears at **two**.

### 1.2 The same problem at N = 1

A single operator with a laptop, a desktop, and a CI box has the identical
problem in miniature. They want one source of truth for `roles.yaml`,
`TASTE.md`, `apps.yaml`, and — critically — one accumulated memory, not three
divergent ones.

This matters more than it looks. **The solo-operator-with-several-machines case
exercises the same machinery as the enterprise case and is the honest
acceptance test for it.** If the design only works at ten people, it is a
feature. If it works at one person with three machines, it is the architecture.

### 1.3 What the problem is *not*

Two framings were considered and rejected during the conversation that produced
this document, and recording why is part of the proposal:

- **Not a multi-tenant control plane.** "Install Cormidia in the cloud, give
  every employee an account, add role-based access control" was the first
  instinct. It requires Cormidia to hold every employee's provider credentials
  and GitHub identity, invent a permissions model, meter and charge back
  provider spend, route approvals, and solve distributed coordination — and it
  creates a confused-deputy problem where a read-only user's request is
  executed by an agent holding org-wide credentials. It is a large, generic,
  and largely unnecessary product.
- **Not an adapter-protocol problem.** Adopting a bridge protocol for adapter
  integration was the entry point to this conversation and is answered
  separately: transport is ~13% of an adapter's code and the enforcement seam
  is ~51%, so no protocol makes harness support cheap. The deployment model,
  not the transport, is the constraint.

### 1.4 The problem, stated once

> **An organization's definition must be shared and governed, while its
> execution, credentials, identity, and cost stay with the individual operator
> — and the judgment those executions produce must flow back to the shared
> definition without carrying the operator's private context, credentials, or
> surveillance with it.**

Everything below follows from that sentence.

## 2. Why the current design cannot serve it

Not opinion — these are structural facts in the tree today.

| Assumption | Where it lives | Why it blocks |
| --- | --- | --- |
| One active org per machine | `~/.cormidia/config` pointer resolved by `findExistingOrg()` | Org selection is a pointer swap, not a concurrent identity |
| One operator, singular | `docs/PURPOSE.md` — "**the** operator", "**the** human reviews one by one" | The approval queue is tuned for one person's attention |
| Attribution is a constant | `ApprovalDecider` defaults to the literal `{ kind: "human", identity: "human/operator" }` | Every durable record names the same principal |
| Coordination is a file lock | `durable-claim.ts`, `file-lock.ts` — `O_EXCL` + PID/process-start/nonce | Same-host by construction; two machines cannot share a claim |
| Roles pin exact harnesses | `roles.yaml`: `planner → claude/claude-opus-5`, `builder → codex/gpt-5.6-sol` | An operator who owns Cursor cannot run that org at all |
| Memory scope has no operator axis | `memory.ts`: `org \| roles/<role> \| apps/<app> \| apps/<app>/roles/<role>` | No way to say "this is mine, not the org's — yet" |
| Enforcement is inside the harness | four per-vendor gate bridges over per-turn Unix sockets | The boundary is same-host and vendor-cooperative |

Note what is *already right*: `committed-org-surfaces.ts` separates committed
org configuration from high-churn state and gives the former a `reviewed-branch`
publication policy; `AUTHORITY.md` is content-bound by SHA-256;
`auth-mode.ts` binds credentials to the *connection*, not the model. The
foundations of this proposal are mostly present. What is missing is the
deployment shape that uses them.

## 3. The proposed model

**The org is a git repository. An operator is a human plus a machine. Many
operators instantiate one org definition; each executes locally with their own
harness, their own credentials, and their own GitHub identity.**

```
        org definition (git)              ← roles, TASTE, apps, pipelines,
        signed · versioned · reviewed       prompts, curated memory
                  │
      ┌───────────┼───────────┐            pull, pinned; never auto-applied
      ▼           ▼           ▼
   Alice       Bob         Alice/laptop-2  ← operator instances
   Cursor      Claude      Codex           ← their own seat, their own auth
   her GH ID   his GH ID   her GH ID       ← their own identity on every PR
   local state local state local state     ← claims, logs, candidate memory
      │           │           │
      └───────────┴───────────┘
                  │  promotion: a governed turn opens a PR
                  ▼
        org definition (git)
```

Two properties carry the design:

1. **Cormidia never holds a credential it did not already have.** The harness
   spends the operator's subscription. Git and GitHub act under the operator's
   identity. Cormidia orchestrates, gates, and records.
2. **The only thing that flows back is reviewed judgment.** Not transcripts,
   not credentials, not telemetry-by-default.

A pleasing consequence: the vocabulary problem dissolves. Earlier framings
needed a *tenant* above *org* because a shared control plane had to separate
customers. Here an org simply **is** a git repository — finance, HR and
engineering are three repos, an operator may join several, and no new noun is
required.

## 4. What this dissolves

Stated plainly, because the value of this framing is how much of the hard
problem it deletes rather than solves:

| Problem in the multi-tenant framing | Fate here |
| --- | --- |
| Per-user credential isolation | **Gone.** Each operator already has their own. |
| Chargeback and metering | **Gone.** Procurement already bought the seats. |
| Access control / RBAC | **Gone as a Cormidia feature.** GitHub has repo permissions, CODEOWNERS, branch protection, environments and required reviewers. Cormidia's obligation is to *not undermine* them. |
| Approval routing for code | **Gone.** Pull-request review is the approval. |
| Approval routing for deploys | **Mostly gone.** GitHub Environments carry required reviewers. |
| Independent GitHub identities (#193) | **Largely gone** for authoring — the PR is genuinely the operator's. |
| Distributed state service | **Gone.** State is local; the shared substrate is git. |
| Confused deputy on credentials | **Gone.** The agent holds Alice's authority, so Alice cannot exceed Alice. |

The pattern: **every shared-state problem is pushed onto GitHub, where GitHub
already solves it.** What GitHub cannot carry is the residue in §5.

## 5. What remains — five problems

These are the whole proposal. Each is stated as a problem, not a design.

### P1 — Config distribution without a fleet-wide instruction channel

`roles.yaml`, `TASTE.md`, `pipelines.yaml` and `prompts/**` are human-ratified
surfaces. Centralize them and **whoever can merge to that repository controls
every operator's autonomous agents, each running with a different human's
credentials.** `prompts/**` is literally the agents' instructions; a prompt
change is a fleet-wide behaviour change reviewed by nobody it affects.

That repository becomes the highest-privilege artifact in the system — a more
valuable target than any application repo.

*The problem:* how does an operator obtain, verify, pin and deliberately
upgrade an org definition, such that "Cormidia picks it up automatically" is
never true of a change nobody accepted? The precedent exists —
`AUTHORITY.md` is already content-bound by SHA-256 and
`committed-org-surfaces.ts` already classifies these paths.

### P2 — Roles as requirements, not harness assignments

Today `roles.yaml` names an exact harness and model per role, and the
builder ≠ reviewer cross-provider pairing is a ratified rule encoding
uncorrelated review blind spots. Alice owns Cursor; Bob owns Claude Code.
Neither can run that file, and the pairing rule cannot simply be collapsed.

*The problem:* how does an org express what a role *needs* — capability tier,
effort, provider independence, cost ceiling — so that each operator resolves it
against the harnesses they actually have, and **refuses legibly** when they
cannot? `RuntimeCapabilityProfile` already carries evidence-certified tiers;
this is where that investment pays off. Changing `roles.yaml`'s meaning is a
change to a human-ratified surface and is a decision, not a refactor.

### P3 — Coordination without a shared filesystem

If every operator's Cormidia polls the same issue tracker for ready tickets,
two agents claim the same ticket. `durable-claim.ts` is an `O_EXCL` file lock:
correct, well-built, and same-host by construction.

*The problem:* what is the shared claim substrate? GitHub is the only shared
state that exists in this model — issue assignment with conditional update
gives approximately compare-and-swap semantics — but it is not a lock service,
and the race and recovery semantics need to be worked out rather than assumed.
This item was absent from the first framing of the residue and is easy to miss
because it looks like state rather than coordination.

### P4 — Memory promotion as governed judgment

This is the core, and it is an editorial problem wearing a synchronization
problem's clothes. Alice's org learns "payments flakes on retry." Bob's learns
the opposite. There is no merge algorithm for that; there is a judgment.

Four constraints:

- **Curation is a role, not a protocol.** Cormidia already has roles, verdicts
  and review. Promotion should be a *governed turn* that opens a pull request
  against the org definition, not a sync daemon.
- **Central memory is a poisoning vector.** Anything that corrupts one
  operator's local memory — a prompt injection in a repository they touched —
  propagates to every operator. Promotion must be reviewed, and every promoted
  claim must carry the evidence that produced it. The existing rule
  (*capability follows evidence, never documentation*) is the right one here.
- **Scope must default narrow.** Memory scopes today are
  `org | roles/<role> | apps/<app> | apps/<app>/roles/<role>`. `org` is global,
  and there is no "mine, not yet the org's" tier. An operator working on
  `finance` must not prime another operator's agent with finance context. This
  is the one genuine access-control problem that survives, and it is scoping on
  a memory store — far smaller than a permissions model.
- **Most of it should not be promoted at all.** What compounds: verdicts and
  their outcomes, repeated failure modes, cost and latency per
  (harness × model × route), denial lessons. What does not: raw transcripts,
  tool-call streams, prompt bodies, session logs. The principle is
  **centralize judgments and outcomes, not transcripts** — a judgment is small,
  reviewable, attributable and low-confidentiality; a transcript is the
  opposite on all four axes.

### P5 — Process evidence without surveillance

GitHub sees "Alice opened PR #412." It does not see which role produced it,
which model at which effort, which ticket, which memory documents were in
context, that the reviewer bounced it twice, or what it cost. That process
record is what Cormidia uniquely has — and it sits on Alice's laptop.

Two constraints pull against each other:

- The organization needs enough evidence to learn, tune assignments, and answer
  "what did our agents do."
- **Telemetry leaving an employee's machine is employee monitoring.** Alice's
  turns run on her hardware, in her checkouts, on her subscription. In several
  jurisdictions this is a works-council conversation before it is a feature.

*The problem:* what is the smallest declared, employee-inspectable evidence
contract that still lets an org learn? Conveniently, P4's answer — judgments
not transcripts — is also the answer that survives a privacy review.

A related obligation: if Cormidia commits under Alice's credential, git history
says **Alice** wrote it, when an agent under her supervision did. That
distinction matters to auditors and increasingly to regulators, and commit
trailers are the natural carrier.

## 6. Why containment and egress became load-bearing

This deserves its own section because it is counter-intuitive: distributing the
work to each operator's own machine, with their own credentials, sounds
*safer* than centralizing it. For the credentials themselves it is. For
everything else it is not, and the reason is precise.

**Today's design is safe because three roles are the same person.** The
operator who authored the policy, the operator who audits the outcome, and the
operator who bears the loss are all one human who set the system up, understands
it, and is watching. That collapse is what makes an in-harness gate an
acceptable boundary.

**The federated model splits those three roles across different people, and
withdraws the trust argument.**

1. **The operator is no longer the author.** Alice did not write `roles.yaml`
   or `prompts/**`. She is running someone else's autonomous agents on her
   machine with her credentials, and she has no practical way to evaluate
   whether that configuration is safe.
2. **The credential is a human's standing access, not a scoped bot's.** A
   service account gets one narrow grant. Alice's laptop has her GitHub token,
   her cloud SSO session, her npm token, her kubeconfig, her `~/.ssh`, her
   password-manager CLI — and the filesystem they all live on. The blast radius
   went *up* when the credentials became personal, not down.
3. **Nobody is watching.** Standing roles fire on schedules. The turn runs at
   07:00 while Alice is asleep.
4. **Scale converts a rare event into a certainty.** A one-in-a-thousand bad
   turn is an anecdote for one operator and a weekly incident across two
   hundred operators on daily triggers.
5. **Two fleet-wide instruction channels now exist** (P1's config, P4's
   memory). One bad merge is two hundred agents misbehaving simultaneously,
   each with a different person's credentials.

The known bypasses stop being acceptable residual risk at that point.
`git show HEAD:.env` reading a secret and classifying routine (#218) is one
person's secret today and a company's credentials in this model. Codex's
trusted read-only auto-run never reaching the gate (#20) is the same. Five of
seven adapters have **no** OS-level filesystem confinement at all — for those,
"the turn only writes inside its worktree" is a property of the harness
behaving, not a property anything enforces.

**Security review is where this becomes concrete.** An enterprise will ask:
*what stops this from reading my engineers' credentials?* Today's honest answer
is "a classifier, on five of seven harnesses, if the vendor's hooks fire." That
answer does not survive the meeting. The answer that does is "the operating
system, always, regardless of which harness is inside" — which is exactly
#366, with #367 as its network half.

So containment is **not a tax on the first-hour experience — it is a
precondition for it.** "It runs confined and can only touch this worktree" is
the sentence that lets an engineer install it and their security team approve
it. Without it there is no first hour, because there is no approval to install.

## 7. The acceptance test: the first hour

The design is only as good as this:

```
npm i -g cormidia
cormidia join <org-repo-url>
cormidia doctor
```

and one of two things is true:

- it works with the harness the operator **already has**, or
- it says exactly which requirement they cannot satisfy, and what to do.

Everything in §5 is subordinate to that. Specifically: P2 is what makes the
first branch possible, P1 is what makes it trustworthy, and #366 is what makes
their security team allow it. If the first hour is not clean, none of the rest
is reachable.

A second acceptance test, cheaper and equally revealing: **one human, three
machines, one org.** Same config, same memory, no divergence, no duplicated
work. If that does not work, the ten-person case will not either.

## 8. Sequencing

Ordering is a claim this proposal makes, not a detail:

1. **Attribution first**, and independently of everything else. Generalize
   `ApprovalDecider` into a principal carried on ticket → episode → turn → run
   envelope → telemetry. It blocks nothing, it is valuable at N = 1 (real audit
   trail, cost attribution, learning provenance), and **every record written
   without it is an audit gap that cannot be backfilled.** Attribution without
   access control is still useful; access control without attribution is
   unenforceable.
2. **#366 containment floor**, then **#367 brokered egress** — §6.
3. **#458 placement boundary** — `container` first; a confined turn is what
   makes an operator's own machine a safe host for someone else's policy.
4. **P2 (roles as requirements)** and **P1 (signed pinned config)** — together
   these are the first hour.
5. **P3 (coordination)** — needed the moment two operators share a backlog.
6. **P4 (memory promotion)** and **P5 (evidence contract)** — the compounding
   asset, and the last thing to get right.

## 9. Open questions

Recorded as open, not answered:

- Does an operator instance need an identity distinct from the human — one
  human, three machines, three instances, one principal? Attribution needs the
  human; coordination and claims may need the machine.
- Does GitHub's API give sufficient compare-and-swap semantics for ticket
  claims, or does P3 force a coordination service after all — the one thing
  this model otherwise avoids?
- Is an org definition a repository, or a directory within a repository?
  Monorepo shops will ask.
- What is the upgrade story when the org definition changes shape while
  operators are pinned to older versions?
- Should promoted memory be reviewable by a human, always? P4 argues yes;
  that may not scale, and the alternative is a governed reviewer turn — which
  is a fleet-wide instruction channel authored by an agent.
- Does the containment floor change what #339's grok vendor risk review has to
  carry, and does it let #358's muse refusal become a contained turn instead?

## 10. What would falsify this

Stated so the proposal is refutable rather than merely persuasive:

- If operators in practice want to run *the same* harness the org specifies —
  because enterprises standardize on one — then P2 is unnecessary and the
  simpler design is to keep harness pinning.
- If the judgment worth promoting turns out to be inseparable from the
  transcripts that produced it, P4 and P5 collapse into a telemetry service and
  the privacy constraint becomes the binding one.
- If containment cannot be established on the operating systems customers
  actually use, §6's argument stands but its remedy does not, and the model has
  to fall back to trusted-operator deployments only.

## 11. Non-goals

- Any implementation, adapter change, schema change, or edit to a
  human-ratified surface before ratification.
- A hosted or multi-tenant Cormidia service.
- A Cormidia permissions model. GitHub's is the one that governs.
- Adopting a bridge protocol for adapter integration — reviewed and declined in
  `research/2026-08-14_acp-bridge-adapter-integration-review.md`.
- Replacing the approval gate. Federation changes *who* is present, never
  whether critical operations are gated.

## 12. References

- `research/2026-08-14_acp-bridge-adapter-integration-review.md` — the review
  this came out of; §7 is the placement finding
- `docs/PURPOSE.md` (the operator, singular) · `docs/architecture.md` ·
  `docs/org/memory.md` · `docs/org/onboarding.md` · `docs/harness/capability-matrix.md`
- `src/org/home.ts` · `src/org/apps.ts` · `src/org/approvals.ts` ·
  `src/org/memory.ts` · `src/org/committed-org-surfaces.ts` ·
  `src/runtime/durable-claim.ts` · `src/runtime/capabilities.ts` · `roles.yaml`
- Issues: #366 (containment floor) · #367 (brokered egress) · #458 (execution
  placement) · #193 (independent GitHub identities) · #218, #20 (known gate
  bypasses) · #257 (state/config naming collision) · #339, #358 (adapters whose
  posture a containment floor would change) · #238 (org/app policy
  configuration epic)
