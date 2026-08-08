# S-ACC-1 — Greenfield multi-ticket web app

***DRAFT scenario. Unratified. Part of L-ACC design input; no lane exists.***

```yaml
id: S-ACC-1
kind: app
onboarding: greenfield          # cormidia new-app --template typescript-node
repo: <campaign-org>/acc-1-clearing
arm: plan + build               # build only past the plan gate (rubric §6)
axes: [P-1..P-6, O-1..O-7]
deliverable_for_human: local preview command in the report; NO deployment
```

## Why this scenario exists

It is the ordinary path: greenfield repo, planner decomposes a messy brief,
builder/reviewer loop, PRs, merges. If Cormidia is broken anywhere in its main
line, this finds it. It is the **baseline**, and it is the only scenario where
O-1/O-2 produce something you can look at yourself.

## Model matrix — the Claude-family arm

| Role | Assignment |
| --- | --- |
| planner | claude / `claude-opus-4-8` @ `xhigh` |
| builder | claude / `claude-sonnet-5` @ `xhigh` |
| **reviewer** | **codex / `gpt-5.6-sol` @ `xhigh`** |

Declared as `adaptive_assignments` candidates in the campaign org's `roles.yaml`
and narrowed to this app via `allowed_assignments`
([`../README.md`](../README.md) → mirrored model matrix).

**The reviewer is deliberately not the template's Opus.** Opus planning + Sonnet
building + Opus reviewing would make the whole arm one provider family and
collapse the builder ≠ reviewer cross-provider pairing that
[`roles.yaml:52`](../../roles.yaml:52) calls "the single most important pairing in
this file." AGENTS.md → Working rules forbids that collapse outright. Sol reviews
here; S-ACC-2 is the exact mirror, with Claude reviewing an OpenAI-family arm.

The arm's hypothesis: **a cheaper builder at high effort, reviewed cross-family,
holds outcome quality at materially lower cost.** Graded on O-6 against S-ACC-2's
mirror.

## The brief (ramble — this is the input verbatim)

> ok so I've been going back and forth on this for weeks and I want to just get
> it built. The thing is called Clearing. It's for freelance consultants who
> bill hourly and hate invoicing — which is all of them, me included.
>
> Core idea: you log time as you go, minimal friction, and at the end of the
> month it produces the invoice. That's it. That's the whole product. I keep
> getting talked into adding project management and I don't want project
> management, I want the invoice to be correct and to go out on time.
>
> Time logging should be stupid simple. A start/stop timer, plus the ability to
> add an entry after the fact because everyone forgets. Entries belong to a
> client and optionally to a task label, free text, no taxonomy, I don't want a
> tagging system.
>
> The invoice side: pick a client, pick a date range, it sums the entries and
> renders something you can send. PDF eventually but honestly for v1 a clean
> printable page is fine, I'll ctrl-P it.
>
> Clients have a name, an hourly rate, and an email. Rates change over time
> though — I raised my rate in March and invoices for February work have to
> still use the old rate. This is the thing every tool gets wrong and it's the
> reason I'm building my own.
>
> Homepage should be good. Not a dashboard with twelve widgets, I mean a real
> landing page that explains the thing, because I want to put this in front of
> people. Hero, the problem, how it works in three steps, pricing, footer.
> Pricing is one tier, $12/month, no free tier, I'm tired of free tiers.
>
> Actually hold on — I do want a free tier. Two clients free, unlimited on paid.
> That's a better funnel.
>
> Auth: email and password is fine. I don't want to do OAuth in v1. Actually
> magic links would be nicer, fewer support emails about passwords. Whichever is
> less work, you decide.
>
> Multi-currency would be great, I have a client in the EU. Not sure how to
> handle the conversion honestly, whether you store in the original currency or
> convert at invoice time or what the right thing is there. I know there's a
> right answer and I don't know it.
>
> Oh and I've been reading about local-first and CRDTs and it seems like the
> right architecture for this long term, offline time logging etc. Something to
> think about.
>
> Don't build a mobile app. Web only. It should work on a phone browser but
> that's it.
>
> Timezone thing: I travel constantly and I've had tools log my hours against
> the wrong day. Entries need to be right regardless of where I am.
>
> That's it I think. Make it good.

## Plants — SEALED, extracted to the answer key, grader must not receive this

**Contradiction (P-2):** pricing is stated as "one tier, $12/month, no free
tier, I'm tired of free tiers" and then reversed to "two clients free, unlimited
on paid." A strong planner names the reversal and asks or parks it. Silently
picking either one scores 0 on P-2.

**Under-specification (P-3):** multi-currency — the brief explicitly says "I know
there's a right answer and I don't know it." The honest move is to park it with
the options laid out. Inventing a conversion policy and building it scores 0 on
P-3 no matter how sound the policy is. Auth (password vs. magic link, "whichever
is less work, you decide") is a **second, weaker** P-3 probe: here delegation
*was* granted, so choosing is correct — but choosing without recording the
rationale is not.

**Buried hard requirements (P-1):** two, each stated once and easy to skim past.
1. **Rate history** — "invoices for February work have to still use the old
   rate." This is a schema-level requirement (temporal rates, not a rate column
   on client) and it is the stated reason the product exists. A plan that models
   `client.hourly_rate` as a scalar has failed P-1 on the single most important
   requirement in the brief.
2. **Timezone correctness** — entries must resolve to the right day regardless of
   the user's current location. Also schema-level.

**Tangents that must not become tickets (P-4):** local-first / CRDTs
("something to think about"); PDF export (explicitly deferred — "printable page
is fine"); mobile app (explicitly excluded); project management (explicitly and
repeatedly refused). A ticket for any of these is a P-4 deduction. Note that
"works on a phone browser" **is** in scope and is not a tangent — a planner that
drops responsive layout has confused the two.

## Build-arm expectations

O-2's obvious path, scripted: create a client → log one timed entry → add one
backdated entry → generate an invoice for a range spanning a rate change → the
invoice totals use the historical rate. That last assertion is the scenario's
whole point and is worth more than the other four combined.

## Deliverable to the human

Report carries: clean-clone build result, start command, the scripted-walk
transcript, and the plan-vs-key coverage table. **No deployment** — see
[`../README.md`](../README.md) boundary 1.
