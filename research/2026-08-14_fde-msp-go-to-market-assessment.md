# Forward Deployed Engineers and MSPs as a Cormidia go-to-market — realistic assessment

*Dated research record. 2026-08-14. Non-normative.*

> **Status.** Market research and strategic assessment. This is **not** an
> amendment to `docs/PURPOSE.md`, not a pricing or licensing commitment, and
> not a product decision. It is input to `docs/gtm-wip.md`, whose §9 already
> lists "MSP and embedding policy" as an open decision. Where this document
> disagrees with a Standing entry in `docs/PURPOSE.md`, PURPOSE wins and this
> document is the thing that is wrong.
>
> **Question asked.** Is positioning Cormidia for *forward deployed engineers
> in MSPs* a lucrative go-to-market strategy, and will those people actually
> benefit from deploying Cormidia in customer scenarios?
>
> **Short answer.** The persona is real and valuable. The channel is mostly
> the wrong one. The two do not currently overlap, and the thesis as stated
> would collapse on contact with three specific things: the license, the
> one-live-app posture, and the human approval queue. There is a narrower,
> better-supported version of the same instinct that is worth pursuing, and
> it is described in Part E.

---

## 0. Method and evidence quality

Research conducted 2026-08-14 via web search plus a read of this repository
(`README.md`, `docs/PURPOSE.md`, `AGENTS.md`, `docs/gtm-wip.md`).

Sources are graded, because a large fraction of what is published about
"forward deployed engineers" in 2026 is SEO content marketing produced by
recruiting firms, cohort courses, and interview-prep vendors that have a
commercial interest in the role sounding inevitable. Treating that as market
data is exactly how a GTM thesis dies on contact.

| Grade | Meaning | Examples used here |
| --- | --- | --- |
| **A** | First-party or primary | Anthropic/Palantir/Deloitte job postings; Accenture and ServiceNow newsrooms; Kaseya's 2026 State of the MSP Report; this repository |
| **B** | Reputable secondary or named analyst | a16z; Canalys partner counts; CompTIA; Forrester; trade press (Channel Insider, ChannelPro, Channel Dive) |
| **C** | Vendor/SEO content marketing | `fde.academy`, `getperspective.ai`, MSP-services blogs, agency pricing guides |

Grade-C figures appear below **only** where they are directionally
corroborated, and are labelled. Several high-signal sources
(Pragmatic Engineer, a16z's `services-led-growth`, LeadDev, Wikipedia,
Deloitte, ChannelPro, Channel Insider) were unreachable from this
environment's egress proxy; their content is represented here through search
summaries, which is weaker. **Anything below marked "unverified" should be
confirmed before it enters a customer-facing deck.**

**Not established by this research** (stated plainly rather than glossed):
the true number of MSPs with an in-house software engineering practice; the
actual attach rate of custom-application work in MSP revenue mix; whether any
MSP anywhere employs someone titled "forward deployed engineer." Searches for
the last one returned nothing. That absence is itself a finding, but it is an
absence, not a measurement.

---

## 1. Executive summary

**On the role.** The forward deployed engineer is a real, well-capitalised,
fast-growing function. It is not a synonym for solutions engineer, and the
difference is economically load-bearing: a solutions engineer is a
*pre-sales* cost that closes a deal; an FDE is a *post-sales delivery* cost
that makes a deployment survive month two. "Applied AI engineer" is, at most
companies in 2026, the same job with the emphasis moved from integration
plumbing toward prompts, evals, and agent design. Part A gives the taxonomy.

**On the channel.** The FDE function today lives in three places: AI product
vendors (Anthropic, OpenAI, Palantir, Scale, Harvey), global systems
integrators building branded FDE practices (Accenture with Microsoft and with
ServiceNow, Deloitte, both announced in the last nine months), and a thin
layer of AI-native agencies. It does **not** live in MSPs. A managed service
provider is a per-seat recurring IT operations business staffed by L1/L2/L3
technicians; the median firm has fewer than 50 people and does not employ
software engineers at all.

**On the overlap.** The instinct behind the question is nonetheless partly
right, and the evidence for it is Pax8's Managed Intelligence Provider
program (announced at Beyond 2026, GA July 2026), which gives MSPs a
white-label framework for selling and delivering AI transformation
engagements. The channel is *trying* to grow an FDE-shaped function. But it
is doing so by outsourcing the delivery capability to a distributor's
white-label bench, precisely because the MSPs themselves cannot staff it.
That is a signal about MSP capability, and it cuts against, not for, the
thesis.

**On Cormidia's fit.** Cormidia is not an AI-transformation platform. It is a
governed factory for *building and operating software products* through
GitHub. Against a traditional MSP's actual job — endpoints, identity, backup,
security, help desk — the fit is close to zero. Against a firm that ships and
then maintains custom software for third parties, the fit is genuine and the
differentiator (independent cross-provider review, mechanical gates, per-app
cost ledger, durable audit trail) is exactly the evidence a services firm
needs to show a client. That is a much smaller population than "MSPs."

**On the verdict.** Do not build a GTM motion around "FDEs at MSPs." Build it
around a three-condition ICP (Part D.3), lead with a wedge that has no
licensing or multi-tenancy problem at all (Part E, W1), and treat the broader
channel as a **later** phase gated on four product capabilities Cormidia does
not have yet (Part G).

---

# Part A — What a forward deployed engineer actually is

## A.1 Origin and definition

The role originated at Palantir in the early 2010s, internally codenamed
"Delta," and was built on a simple observation: the product could not be sold
as a product, because the customer's data, workflow, and politics were the
actual problem. So Palantir embedded engineers inside the customer.

The canonical framing from Palantir's own recruiting material is that an
FDSE's responsibilities "look similar to those of a startup CTO": small
teams, end-to-end ownership of high-stakes projects, working side by side
with customers to architect and build solutions on business-critical data.
[A: Palantir job postings]

The one structural distinction that separates an FDE from a consultant:
**the FDE also contributes back to the product their company sells.** The
engagement is a discovery mechanism for the product roadmap, not just
billable delivery. This is the whole economic point of the role, and it is
the part most imitators drop.

## A.2 The taxonomy the question asked for

The four titles are genuinely confused in the market. Here is the distinction
that holds up:

| | **Solutions Engineer / Sales Engineer** | **Solutions Architect** | **Forward Deployed Engineer** | **Applied AI Engineer** |
| --- | --- | --- | --- | --- |
| **Phase** | Pre-sales | Pre- and early post-sales | Post-sales delivery | Post-sales delivery |
| **Question answered** | "Can your product solve our problem?" | "How should this be designed to fit?" | "Make it actually work here, end to end" | "Make the AI capability actually work here" |
| **Primary output** | Demos, POCs, RFP responses, technical win | Reference architecture, design docs | Production code inside the customer's environment | Prompts, evals, agents, MCP servers, production AI workflows |
| **Writes production code in the customer's repo?** | Rarely | Rarely | **Yes** | **Yes** |
| **Reports to** | Sales | Sales or delivery | Delivery, or product/engineering | Product/engineering, or a dedicated Applied AI org |
| **Compensated as** | Sales-adjacent (base + variable) | Sales-adjacent or delivery | Engineering | Engineering |
| **Feeds the product roadmap** | Indirectly | Sometimes | **Structurally — it's the point** | **Structurally** |

**FDE vs Applied AI Engineer.** In practice these are converging, and several
companies use both titles for one job. Anthropic's own posting is literally
titled *"Forward Deployed Engineer, Applied AI"* [A]. The useful distinction
is emphasis, not kind: an FDE writes more integration, auth, and IAM code; an
applied AI engineer writes more agent scaffolding and eval suites. If a
company has both, the FDE owns the deployment and the applied AI engineer
owns the intelligence inside it.

**FDE vs Solutions Engineer** is the important one, and it is a *budget line*
distinction. SE cost is charged against sales efficiency and is expected to
be a small multiple of quota. FDE cost is charged against delivery, gross
margin, or R&D, and is expected to produce a reusable product asset. Firms
that rename their SEs "FDE" without moving the budget line have changed
nothing. Grade-C sources report SE postings down ~14% while FDE and applied
AI postings grew ~380% YoY across 30+ tracked SaaS companies — the direction
is corroborated by the SI announcements below, but **the specific percentages
are unverified and should not be quoted externally.**

## A.3 Responsibility scope in 2026

Synthesising Anthropic's posting [A], Palantir's postings [A], and Accenture
/ Deloitte practice descriptions [A/B], the current scope is:

1. **Discovery inside the customer's real environment** — not a workshop.
   Understanding the workflow, the data, the legacy APIs nobody documented,
   and the political owner of each system.
2. **Build production applications in the customer's systems**, to that
   customer's safety, compliance, and reliability bar — not to demo quality.
3. **Ship named technical artifacts.** Anthropic's posting is unusually
   concrete here: *MCP servers, sub-agents, and agent skills* used in
   production workflows [A].
4. **Design prompts and evals**, and own the accuracy/regression story. The
   consistent failure mode reported across sources is skipping evals to ship
   faster, after which the deployment degrades silently.
5. **Integration and identity plumbing** — REST, webhooks, SSO/OAuth, service
   accounts, undocumented legacy APIs.
6. **Post-launch iteration** — the phase the FDE role exists to survive.
7. **Codify repeatable deployment patterns and feed them back to product.**
8. **Own the customer relationship technically** and find the next
   deployment. Anthropic's posting specifies 25–50% travel [A].

Grade-C time allocation, offered only as a shape: ~60% customer-facing, ~30%
deployment-specific code, ~10% internal. The direction — that this is
majority *not* heads-down coding — matches every A-grade description.

## A.4 Why the role exists — the economics

a16z's framing, "trading margin for moat," is the clearest statement of the
bet: forward deployment sacrifices near-term gross margin to accelerate time
to value and embed the vendor in mission-critical workflows. The essential
qualifier — and it is the sentence that matters most for Cormidia — is that
**the model only scales when fieldwork becomes product.** [B, via search
summary; primary unreachable]

This is directly relevant to the question being asked. An FDE team that never
converts its engagements into reusable product is a consultancy with a
software company's cost structure. Which is why FDEs are structurally
receptive to tooling that makes their fieldwork *reusable* — and that is a
genuine Cormidia opening, discussed in D.1.

## A.5 Where the model breaks

The criticism is well-documented and should be respected rather than argued
around:

- **It looks like a services business wearing a software business's
  valuation.** Every customer needing expensive engineers is the definition
  of a non-scaling GTM.
- **The people are scarce and the job burns them out** — rare skill mix,
  heavy travel, permanent context-switching.
- **The self-undermining critique**, quoted in trade coverage: teams building
  automation to remove human dependencies are "adding expensive, hard-to-find
  humans to replace humans."
- **The customer cannot afford the whole stack.** "Most companies do not have
  the margin to pay for AI tokens, an SI partner, an FDE team, and a new AI
  platform all at once." This is a direct constraint on any GTM that adds a
  fifth line item.
- **Dilution.** As the title spreads to SIs and staffing firms, it stops
  denoting the Palantir-grade operator and starts denoting a re-badged
  consultant.

## A.6 Where FDEs actually work today

| Tier | Evidence | Grade |
| --- | --- | --- |
| **AI product vendors** | Anthropic "Forward Deployed Engineer, Applied AI"; Palantir FDSE/FDAE; OpenAI, Scale, Harvey, Mistral referenced across sources | A |
| **Global SIs** | Accenture + Microsoft FDE practice (March 2026, "thousands of AI-skilled engineers"); ServiceNow + Accenture FDE program (May 2026); Deloitte Forward Deployed Engineering practice (announced 2025-12-01, client-embedded "pods") | A |
| **AI-native agencies / studios** | YC's 2026 request-for-startups explicitly names AI-native service companies that "don't sell software—they sell the service" | B |
| **MSPs** | **No evidence found.** Direct searches for MSP job postings using the title returned nothing. | — |

The bottom row is the crux of the question.

---

# Part B — The MSP channel, realistically

## B.1 Shape of the market

- **~341,000 firms** deliver managed services worldwide (Canalys partner
  count, 2025) [B].
- **87.8% have fewer than 50 employees; only 1.7% exceed 250** [B]. This is a
  cottage industry with a long tail, not an enterprise buyer set.
- Market size estimates for 2026 cluster around **$420–430B** across Mordor,
  ResearchNester, and Business Research Insights [B/C] — but this number
  includes telecom, infrastructure, and enterprise managed services, and
  bears almost no relationship to the addressable slice for a software
  development runtime.
- **88% of SMBs and 92% of 1,000+ employee enterprises use at least one MSP**
  [C] — the channel genuinely has reach.

## B.2 Economics

| Metric | Benchmark | Grade |
| --- | --- | --- |
| Managed services gross margin | 50–60% | C, widely corroborated |
| Project services gross margin | 45–60%, scoping-dependent | C |
| Hardware/product resale margin | 5–15% | C |
| Revenue per technician | $142k average; $150–200k healthy; >$200k top decile | C |
| Fully burdened tech cost | A $90k tech costs $130–145k loaded | C |
| Service delivery labour | ~48% of total opex | C |
| Per-user pricing | $100–250/user/month typical; $200–400 in regulated verticals | C |
| Endpoints per technician | 156, up from 118 in 2022 | C |

The structural read: **labour is the entire P&L, and the industry's only
proven lever is automation that raises endpoints-per-tech.** An MSP owner
evaluates every tool against "does this let me serve more seats with the same
people." That is the frame Cormidia would be judged in, and Cormidia does not
answer that question — it answers a different one.

## B.3 The AI moment, and the gap inside it

Kaseya's 2026 State of the MSP Report (>1,000 MSPs surveyed) is the highest
quality data point available [A, via press release]:

- **71%** say acquiring new customers is their top challenge.
- **48%** rank AI and automation as the **number one client need**.
- **13%** say AI is a **meaningful revenue stream**.
- Share of MSPs whose typical customer spends **>$25k/year fell to 41%, from
  75%** the prior year.
- Difficulty hiring skilled technicians **rose from 9% to 16% YoY**.
- 71% reported YoY revenue growth in cybersecurity — the highest category.

Read those five lines together and the picture is unambiguous: **there is
enormous stated demand for AI, almost no monetisation of it, shrinking deal
sizes, and a worsening ability to hire the people who could close the gap.**

That is simultaneously the strongest argument for the user's instinct (the
gap is real, someone will fill it, and it is worth money) and the strongest
argument against it (a channel with shrinking deal sizes and a hiring crisis
is not about to staff a Palantir-grade delivery function).

**Pax8's answer to that gap is the most important competitive fact in this
document.** At Beyond 2026, Pax8 announced [B, trade press]:

- the **Managed Intelligence Provider (MIP)** program — a structured
  framework for MSPs to sell AI transformation engagements;
- **Managed Intelligence Services (MIS)** — a **white-label delivery**
  portfolio, i.e. Pax8's bench does the work the MSP cannot staff;
- an **AI Agent Store** of validated, SMB-ready agents;
- an **Agent Gateway** for **multi-tenant AI governance**;
- **token tracking so MSPs can bill for AI consumption.**

GA was slated for July 2026. Note what Pax8 concluded the channel needs:
white-label delivery (because MSPs lack the skills), multi-tenant governance
(because per-client isolation is mandatory), and consumption billing (because
variable token cost breaks fixed-fee contracts). Cormidia has none of the
three. Pax8 built all three because they are the actual requirements.

## B.4 Do MSPs build software?

Honest answer: **a minority do, mostly by partnering out, and it is not their
economic engine.**

- CompTIA finds **63% of MSPs are "hybrid"** rather than pure-play recurring
  revenue [B, 2022] — the non-recurring portion is projects, resale, and
  professional services, only a sliver of which is application development.
- Firms selling "MSP software development" exist in volume — but read who is
  advertising: they are **development shops selling *to* MSPs** as a
  subcontracted capability ("Software & AI Development Partner for MSPs"),
  which confirms the capability is bought, not held.
- Where MSPs do build, the artifact is usually an **automation or
  integration**, not an application: Power Automate, n8n, Make, Zapier,
  PSA/RMM scripting. n8n's positioning explicitly targets "SMBs with one
  technical person or working with an integration partner."

This matters enormously for the fit assessment. **Cormidia's unit of work is
a GitHub repository with tickets, PRs, reviews, gates, and releases.** The
MSP's unit of work is a workflow in a low-code tool with no repo, no tests,
and no release process. These are not the same artifact, and Cormidia's
entire value — governance, independent review, evidence — is unrecoverable
when there is no repo to govern.

## B.5 How MSPs buy

This is where a GTM thesis meets procurement reality, and the mismatch is
severe [B]:

| MSP expectation | Cormidia today (`docs/gtm-wip.md`, `README.md`) |
| --- | --- |
| Transact through Pax8 / Ingram Micro alongside existing SKUs | Direct npm + annual license; no distributor listing |
| **Free, no-strings NFR licenses** to live in the product | Free tier is **one natural person's own work**, explicitly not organisational or client work |
| **Monthly billing, no annual commitment** | Every paid offer is **annual** |
| **Multi-tenant admin console** across the whole client base | Loopback-only, single-org, no multi-user auth, no RBAC |
| Per-client provisioning, reporting, and billing export | Per-app ledger exists; no client-billing projection |
| Predictable per-seat cost | BYO provider tokens, variable spend, $1,000/month per-app default cap |

The NFR and monthly-billing rows alone would stall most channel
conversations. The multi-tenant row is not a pricing objection; it is an
architecture objection.

## B.6 Is there an FDE inside an MSP?

No evidence found. Searches for MSP job postings using the title returned
L1/L2/L3 support engineer, system engineer, desktop engineer, and
onsite support roles at $98k–157k. The closest adjacent role in the channel
is the **vCIO** — a business-alignment and roadmap advisory role, not an
engineering one.

The FDE-shaped function the channel is growing is being grown **at the
distributor** (Pax8 MIS white-label bench) and **at the SI tier** (Accenture,
Deloitte), not inside the 341,000 MSPs.

**Conclusion for Part B:** "forward deployed engineers in MSPs" describes a
population that does not currently exist in measurable numbers. A GTM
targeting it would be targeting an aspiration.

---

# Part C — What Cormidia actually is, stated plainly

Grounded in `docs/PURPOSE.md`, `README.md`, and `AGENTS.md` as of this date.
This section exists because the fit assessment is only as honest as its
description of the product.

## C.1 What it does

A governed **org runtime**: a standing team of role agents (Planner, Builder,
Reviewer, SRE, Support, Marketing, Distiller, Learning Reviewer) that
develops and operates software products through private GitHub repos, with a
human approver gating critical operations only. Installed as an npm package
exposing two binaries (`cormidia`, `cormidia-job`). Self-hosted,
customer-controlled, bring-your-own provider credentials.

## C.2 The properties that are genuinely differentiated

These are real, unusual, and hard to copy — and every one of them is worth
more to a firm delivering to a **third party** than to a firm building for
itself, because a third party demands evidence:

1. **Independent cross-provider review.** Builder ≠ Reviewer, deliberately
   different providers, encoded in `roles.yaml` as uncorrelated blind spots.
   No mainstream coding agent does this.
2. **Mechanical gates and typed artifacts.** "Nothing durable is ever
   triggered by parsing an agent's free-text output."
3. **A critical-operations gate on every tool action**, with a human approval
   queue, single-use content-bound grants, and a persisted audit trail.
4. **Per-turn cost settlement into a ledger**, enforced monthly budget caps
   per app, and a reporting surface (`cormidia report`, `/reports`) that
   separates provider-reported from estimated cost.
5. **Durable, resumable episodes.** Crash and approval-pause recovery without
   blind retry; claims survive interruption.
6. **One runtime, many apps** — the architecture is explicitly a fleet
   architecture, with per-app memory, per-app budgets, and hard app
   boundaries per turn.
7. **A governed learning loop** where lessons activate only through human
   review, paired offline replay, and a human-started canary.
8. **`cormidia-job`** — a second binary for non-product work (analysis,
   synthesis, migrations) as dependency-ordered resumable step graphs, with
   an explicitly weaker verification promise.

Items 1–4 and 7 constitute a coherent story that no autonomous coding agent
in the market tells: **not "the agent writes code faster," but "here is
provable evidence of what the agent did, what it cost, who approved it, and
who reviewed it."** For regulated or contractual delivery, that is the
product.

## C.3 The constraints that a channel thesis must survive

Stated as facts from the repo, not as objections to be handled:

| # | Constraint | Source |
| --- | --- | --- |
| C1 | **License prohibits "operating a shared or multi-tenant Cormidia service for unrelated customers"** absent a separate agreement | `gtm-wip.md` §4 |
| C2 | **The org runs one live app** until scorecards and human load say otherwise; multi-app is "designed in but operated sequentially" | `PURPOSE.md` Standing |
| C3 | `max_concurrent_turns: 2` org default | `PURPOSE.md` Standing |
| C4 | **GitHub-only system of record.** No GitLab, Azure DevOps, or Bitbucket | `PURPOSE.md` |
| C5 | Approvals are a **CLI queue the human reviews one by one** | `PURPOSE.md` Standing |
| C6 | Live UI is **loopback-only; no remote bind, TLS, multi-user auth, or cloud ingestion** | `README.md` Known limitations |
| C7 | **Provider binaries must be preinstalled**; Cormidia never installs a provider | `AGENTS.md` (#224) |
| C8 | Node ≥ 26 | `AGENTS.md` |
| C9 | **Autonomous roadmap delivery is not enabled yet** (HB-103…111 outstanding) | `README.md` Known limitations |
| C10 | **RQ-1 active; no candidate qualifies by absence.** Threat model, abuse cases, 7-day soak, and rotation are future L5 assurance | `README.md`, `PURPOSE.md` |
| C11 | Default budget **$1,000/month per app** | `PURPOSE.md` Standing |
| C12 | Co-planning is "the irreducibly per-app human cost, and why onboarding is sequential" | `PURPOSE.md` Standing |

C1, C2, and C5 are the three that break the MSP thesis specifically, and they
break it for a principled reason rather than an incidental one: **Cormidia's
stated purpose is "one human should be able to direct a small portfolio of
software products."** An MSP fleet motion is not a small portfolio directed
by one human. It is many portfolios directed by many low-context operators.
Those are opposed designs, and the tension is not a bug to be patched — it is
a strategic choice that would have to be consciously revisited.

---

# Part D — The fit assessment

## D.1 Where the fit is genuine

Setting the channel question aside and asking only "would an FDE benefit from
Cormidia," there are four jobs where the answer is a defensible yes:

**1. The maintenance tail — the strongest case by a wide margin.**
Every source on FDE failure describes the same death: the demo works, month
two arrives, and nobody owns the thing anymore. Post-launch iteration is
listed as core FDE scope precisely because it is where deployments die. A
services firm cannot profitably staff a human against thirty small delivered
systems. Cormidia's one-runtime-many-apps architecture with per-app budgets,
per-app memory, and an SRE/Support role set is *structurally* a maintenance
fleet. This is the clearest place where Cormidia does something no
alternative does — Devin, Cursor, Copilot, and Claude Code are all
build-time tools with no operate-time model, no budget ledger, and no
standing role that watches a delivered system.

**2. Evidence the FDE can hand to the client.** When a third party's code is
being changed by an agent, "trust me" is not an acceptable answer.
Cormidia's audit trail, independent cross-provider review, mechanical gates,
and per-turn cost ledger produce exactly the artifact a delivery contract
needs. In a regulated vertical this shifts from a nice-to-have to the
purchase reason.

**3. Cost defensibility on fixed-fee work.** Agentic delivery against a
fixed-price contract is a margin landmine — variable token spend, no ceiling.
Cormidia enforces monthly caps per app and refuses to claim work when a cap
is exhausted. Pax8 built token tracking because the channel discovered this
problem the hard way; Cormidia already has the accounting primitive, though
not the client-billing projection.

**4. Non-product FDE work via `cormidia-job`.** Discovery synthesis, API
inventory, migration analysis, cross-system audits — real FDE work that is
not a product. Jobs are dependency-ordered, resumable, gated, and settle into
the same ledger. The honest caveat is in `docs/jobs/design.md` §3: jobs carry
**no verification authority**, no independent review, no merit verdict. That
must be said out loud in any pitch, because a services firm that mistakes a
completed job step for a correct answer will damage the brand.

## D.2 Where the thesis breaks — the blocker register

Ranked by how quickly it would kill a deal. "Fix" is an estimate of the shape
of work required, not a commitment.

| # | Blocker | Severity | What would have to change |
| --- | --- | --- | --- |
| **B1** | **The license forbids the motion.** Operating Cormidia on behalf of unrelated customers as a shared service is prohibited (C1). "Deploying it in customer scenarios" is that motion, described exactly. | **Fatal until resolved** | A drafted, counsel-reviewed MSP/delivery-partner grant. `gtm-wip.md` §9 already lists this as undecided. Nothing else in this document matters until it is. |
| **B2** | **One live app, two concurrent turns** (C2, C3). A firm with 20 client systems needs 20 concurrent apps. The sequential posture is a deliberate Standing decision tied to human approval load, not a config default. | **Fatal for fleet** | A ratified multi-app operating posture with per-app schedulers, WIP accounting, and — critically — an approval model that does not scale linearly with app count. This is a PURPOSE-level decision, not a feature. |
| **B3** | **The approval queue is the bottleneck** (C5). One human, one-by-one, per critical op. At one app this is the product's central promise. At twenty client apps it is a full-time clerk, and the value proposition inverts. | **Fatal for fleet** | Scoped standing grants already exist (rule+path, TTL, use-count). Fleet operation would need per-client policy profiles and an approval surface that is not a single serial CLI queue — without weakening the never-scopeable set (self-merge, production deploy, protocol writes, outside-worktree). |
| **B4** | **No tenant isolation story.** Loopback-only UI, no RBAC, no multi-user auth (C6). An MSP must prove client A's code, secrets, and telemetry cannot reach client B. Cormidia has hard per-turn app boundaries — a real technical foundation — but no *demonstrable, auditable tenancy claim* a client security review would accept. | **High** | Documented tenancy model, per-client credential isolation, per-client reporting scope, and ideally third-party attestation. Pax8 is shipping an "Agent Gateway for multi-tenant AI governance" — this is table stakes, not differentiation. |
| **B5** | **GitHub-only** (C4). SMB clients are frequently on Azure DevOps, GitLab, or have no version control at all. | **High** | Either additional forge adapters (large, and it touches the ticket state machine, not just an API client) or an explicit ICP filter: GitHub-only shops. The second is cheaper and more honest. |
| **B6** | **MSP technicians are not software engineers.** Cormidia's operator must read a Reviewer verdict, ratify TASTE, judge acceptance criteria, and decide approvals. Kaseya reports hiring difficulty rising 9%→16% [A]. Pax8 responded to this gap with a white-label bench, which is the market's verdict on MSP capability. | **High** | Nothing product-side fixes this. It is an ICP filter: sell to firms that already employ engineers. |
| **B7** | **Procurement shape mismatch** (B.5). No distributor listing, no NFR, annual-only billing, no per-seat SKU. | **Medium-High** | Distributor listing, a real NFR/partner-demo license, and monthly terms for partners. `gtm-wip.md` §6 already flags "demo or not-for-resale licenses where genuinely needed." |
| **B8** | **Liability is unallocated.** When an agent merges a defect into a client's production system, standard MSP E&O was not written for autonomous agent error; affirmative AI E&O products (HSB/Munich Re, Armilla, Counterpart) exist but are new and not standard. Vendor indemnities typically cover IP and breach, rarely wrong-decision loss. | **Medium-High** | Contract templates, a documented human-approval boundary partners can point at (Cormidia's approval gate is genuinely a good answer here), and guidance on E&O endorsements. Underrated as a *selling* point, not just a risk. |
| **B9** | **Cormidia's own assurance posture** (C9, C10). Autonomous roadmap delivery not enabled; RQ-1 has no qualified candidate; no soak, no completed threat model. | **Medium** | Time and campaigns. But note the asymmetry: this repo's culture of refusing to claim green-by-absence is a *liability in a channel deck and an asset in a security review*. Do not resolve that tension by softening the claims. |
| **B10** | **Variable spend against fixed-fee contracts.** BYO tokens, $1,000/month default per app (C11). A 20-client fleet is a real, unpredictable COGS line an MSP must price into a per-seat contract. | **Medium** | Per-client ledger projection and a billing export. The accounting exists; the client-facing projection does not. |
| **B11** | **Onboarding is irreducibly sequential** (C12). Co-planning per app is stated as unavoidable human cost. | **Medium** | Accept it and price it as billable services — this is actually consistent with how services firms work, and `gtm-wip.md` §6 already argues attachable service work is what keeps partners engaged. |

## D.3 Segment scoring

The question "will they benefit" has a different answer per segment. The
three conditions that predict fit:

> **(a)** the firm ships *custom software* to clients, in repos;
> **(b)** the firm is contractually on the hook to *keep it alive*;
> **(c)** the firm has at least one person with real engineering judgment who
> can act as approver.

| Segment | (a) ships software | (b) owns maintenance | (c) has an approver | Verdict |
| --- | --- | --- | --- | --- |
| **Traditional SMB MSP** (<50 staff, help desk + security + M365) | No | N/A | No | **No fit.** Do not pursue. |
| **MSP with an automation practice** (n8n/Power Automate/scripting) | Partially — not in repos | Yes | Sometimes | **Weak.** No repo means no governance surface. Possible later via W1. |
| **"MSP+" with a real app-dev practice** | Yes | Yes | Yes | **Genuine fit.** Small population, no reliable sizing found. |
| **AI-native agency / dev shop** | Yes | Often — and it's their pain | Yes | **Strongest channel fit.** |
| **SI FDE practice** (Accenture, Deloitte) | Yes | Yes | Yes | Fits technically; **wrong buyer** — they build internal platforms and have alliance economics. Multi-year cycle. |
| **Vendor FDE team** (Anthropic, Palantir-class) | Yes | Yes | Emphatically yes | **Highest technical fit, best free-tier landing motion, no channel leverage.** |
| **An MSP's own internal engineering** | Yes | Yes | Yes | **Best first deal.** See W1. |

Note the shape of that table: fit correlates almost perfectly with "does this
firm write code in repos," and not at all with "is this firm an MSP."

---

# Part E — The reframed thesis: three wedges, ranked

The instinct — that firms deploying AI on behalf of others are a lucrative
channel — is sound. The targeting is wrong. Three wedges, ordered by
probability of a first closed deal.

## W1 — The MSP's (or agency's) *own* internal software

**The move.** Do not sell Cormidia as something the MSP deploys *at clients*.
Sell it as the thing that builds and maintains the MSP's **own** internal
software: PSA/RMM glue, client portals, billing reconciliation, reporting,
onboarding automation, the integrations between the six tools in their stack.

**Why this is first:**
- **No licensing problem.** Single legal entity operating for itself. This is
  exactly the $1,999 Business tier as already drafted. B1 disappears.
- **No tenancy problem.** One org, own repos, own data. B4 disappears.
- **No client liability problem.** B8 disappears.
- **The backlog is real and unserved.** Every MSP has a list of internal
  tools it will never build because the techs are billable and the owner
  won't hire a developer.
- **It is a reference deployment.** `gtm-wip.md` §6 says the partner program
  needs "a demonstrable reference deployment." The partner's own installation
  *is* that reference, and they sold themselves.
- **It matches Cormidia's actual posture.** One or two live apps, one
  approver, small portfolio. The product does not have to change.

**Why it matters strategically.** A firm that has run Cormidia on its own
systems for six months is the only firm that can credibly deploy it at a
client — and by then the license conversation is a renewal expansion, not a
cold ask.

**Risk.** It does not test the fleet thesis at all. It is a good first deal
and a poor proof of the channel. Say so internally rather than letting one
happy internal customer be read as channel validation.

## W2 — The maintenance annuity for custom-software fleets

**The move.** Target firms with an existing portfolio of delivered custom
applications they are contractually obliged to maintain and currently
maintain badly. Sell the **operate** half, not the build half. The pitch is
not "ship faster"; it is *"you have 30 delivered systems and 2 people; here
is a governed way to keep all 30 patched, dependency-current, and responsive
to small change requests, with a per-app budget cap and an audit trail you
can hand the client."*

**Who:** AI-native agencies, product studios, MSP+ firms with app-dev
practices, vertical SIs. Not "MSPs."

**Why it is second, not first:** it needs B1 (license), B2/B3 (fleet posture
and approval scaling), and B10 (per-client billing export). It is the
**largest** opportunity in this document and the one worth building toward.

**Why it is defensible:** every competitor is a build-time tool. Devin,
Cursor, Copilot, Factory, and Claude Code all optimise the moment of writing
code. None has a budget ledger, a standing SRE role, per-app memory, an
approval boundary, or an operate-time model. The maintenance fleet is
genuinely open ground.

## W3 — Individual FDEs as a land motion

**The move.** The free-individual tier is already the right instrument.
Target FDEs and applied AI engineers *as individuals*, on their own work.
They are, by A.3, exactly the population that already lives in Claude Code,
Codex, MCP servers, evals, and agent skills — Cormidia requires no new
mental model from them, only preinstalled provider binaries they already
have (C7).

**Why:** highest technical fit; zero sales cost; and per `gtm-wip.md` §1,
free individuals *are* the future customer and partner pool. An FDE who uses
Cormidia on personal projects is the person who later proposes it inside
Accenture's Microsoft FDE practice.

**The catch, stated honestly:** the free grant covers "one natural person's
own work" and explicitly does not extend to work for an employer or client.
An FDE's job is, by definition, client work. So the free tier lands the
*person*, not the *job* — and the conversion event is organisational. That
boundary needs to be crisp in the licence and cheerful in the messaging, or
the most enthusiastic users will be the ones out of compliance. This is
`gtm-wip.md` §9's first open decision and it is more urgent than the price
points.

## Wedges to decline

- **"Cormidia deploys AI transformation at SMB clients."** Cormidia does not
  do AI transformation. It builds and operates software products. Claiming
  otherwise puts it in a fight with Pax8's MIP program, a distributor's
  white-label bench, and an Agent Store — on their channel, with their
  billing rails.
- **Selling into the 87.8% of MSPs with <50 staff.** No repo, no engineer,
  no fit.
- **Per-seat or per-endpoint pricing to look like channel software.**
  `gtm-wip.md` §1 is right that per-app or per-user charging taxes adoption
  and contradicts the one-runtime-many-apps contract. Do not distort the
  pricing model to fit a channel that is the wrong channel anyway.

---

# Part F — What would have to be true

Falsifiable tests, cheapest first. Each is designed so a negative result
kills the corresponding wedge rather than being explained away.

| # | Claim under test | Cheap test | Kills what if false |
| --- | --- | --- | --- |
| F1 | Firms exist that maintain ≥10 delivered client apps in GitHub and feel the maintenance pain | 15 structured interviews with agencies/MSP+ firms; ask for the actual app count and who patches them | W2 |
| F2 | An FDE-shaped operator can go from install to first merged PR on a real repo unaided | Watch 5 do it; measure time-to-first-merge and every place they stall | All three wedges |
| F3 | MSPs have a real internal-tooling backlog they'd pay $1,999/yr to attack | Ask 20 MSP owners for their internal wishlist and what it's worth | W1 |
| F4 | The audit trail is a *purchase reason*, not a nice-to-have | Show the report/approval surface to 10 buyers; see if any leads with it unprompted | The whole differentiation story |
| F5 | Someone will pay for maintenance-as-a-service on delivered apps | Price a pilot: N apps, monthly cap, monthly report | W2 |
| F6 | A client will grant a partner's autonomous agent write access to their private repo | Ask 5 end clients directly. This is the single most likely hard no. | W2, and any "deploy at customer" motion |
| F7 | Multi-app fleet operation is achievable without weakening the approval boundary | Design spike against B2/B3 before any channel commitment | W2 |
| F8 | The FDE hiring growth figures are real | Verify the grade-C 380%/-14% numbers against LinkedIn/Indeed primary data | Nothing structural — but it must be verified before it appears in a deck |

**F6 deserves emphasis.** Every other blocker is Cormidia's to fix. F6 is the
end client's decision, it is outside anyone's control, and a widespread "no"
invalidates the entire deploy-at-customer thesis regardless of how good the
product gets. Test it before building for it.

---

# Part G — Product gaps ranked by GTM impact

If the channel thesis is pursued, this is the order the gaps bind. Every item
is a decision, not a task — several touch Standing.

1. **MSP / delivery-partner licence grant** (B1). Blocks everything. Already
   an open item in `gtm-wip.md` §9. Costs legal time, not engineering time,
   which makes it the highest-leverage thing on this list.
2. **Multi-app fleet posture** (B2, B3). A PURPOSE-level decision about
   whether Cormidia serves "one human, a small portfolio" or "one operator, a
   client fleet." These are different products. Decide deliberately.
3. **Approval scaling without weakening the gate** (B3). Per-client policy
   profiles over the existing scoped-grant machinery. The never-scopeable set
   must survive intact — this is the one place where a channel-driven
   compromise would do real damage.
4. **Tenancy claim** (B4). Not new isolation — the per-turn app boundary is
   already hard — but a *documented, demonstrable* tenancy model a client
   security review can accept.
5. **Per-client cost projection and billing export** (B10). Smallest
   engineering effort with the most direct revenue effect: the ledger already
   holds the data.
6. **Partner NFR / demo licence and monthly partner terms** (B7).
7. **Non-GitHub forges** (B5). Large, and probably wrong to do — prefer the
   ICP filter until F1/F6 say otherwise.

---

# Part H — Positioning language that survives contact

What to say:

> Cormidia is a governed factory for the software you build for clients — and
> for keeping it alive afterwards. Every change is planned, independently
> reviewed by a different model than wrote it, gated, budget-capped, and
> logged as evidence you can hand the client.

Why each clause earns its place: *governed* and *evidence* are the
differentiators; *for clients* names the third-party relationship that makes
governance a purchase reason; *keeping it alive afterwards* is the wedge no
competitor addresses; *a different model than wrote it* is a concrete,
verifiable claim that lands with technical buyers in one sentence.

What not to say:

- "AI-native transformation." Not what the product does; also crowded.
- "Replaces your developers." Contradicts the approval boundary that is the
  actual product, and invites the A.5 critique.
- "Autonomous." True in a bounded sense and false in the sense a buyer will
  hear. `README.md` states autonomous roadmap delivery is not enabled.
- Any claim of qualification, soak, or threat-model completion. RQ-1 is
  explicit that absence is never a pass, and a channel deck is exactly where
  that discipline erodes first.

---

# Part I — Recommendation

1. **Reject** "forward deployed engineers in MSPs" as the GTM frame. The two
   populations do not overlap; the channel's own distributor concluded MSPs
   cannot staff the function and built a white-label bench instead.
2. **Keep** the underlying instinct: firms that deliver software on behalf of
   others are the right buyer, and the governance/evidence story is worth
   more to them than to anyone else.
3. **Retarget** on the three-condition ICP (D.3): ships software in repos,
   owns the maintenance, has an approver.
4. **Sequence** W1 (their own internal software) → W3 (individual FDEs via
   the free tier) → W2 (the maintenance annuity), and gate W2 on the licence
   grant plus a deliberate fleet-posture decision.
5. **Run F1, F3, and F6 first.** They are conversations, not code, and F6 can
   invalidate the expensive path before any of it is built.
6. **Resolve the free-tier boundary** (`gtm-wip.md` §9, first bullet) before
   promoting to an FDE audience, or the best users will be non-compliant by
   the nature of their job.

## Open questions for the owner

- Is Cormidia willing to become a fleet product? B2/B3 are not features; they
  are a revision of "one human should be able to direct a small portfolio."
  If the answer is no — which is a legitimate answer — then W2 is off the
  table and W1 plus W3 are the whole strategy.
- Is a distributor route (Pax8, Ingram) desirable at all, given it imports
  NFR, monthly billing, multi-tenant console, and per-seat expectations
  wholesale?
- Should the maintenance-fleet story become the *primary* product narrative
  rather than a channel play? It is the most defensible ground identified
  here, and it is currently underweighted relative to the build loop.

---

## Sources

**Grade A — primary**
- [Anthropic — Forward Deployed Engineer, Applied AI (job posting)](https://jobs.generalcatalyst.com/companies/anthropic/jobs/70192292-forward-deployed-engineer-applied-ai)
- [Palantir — Forward Deployed Software Engineer](https://jobs.lever.co/palantir/dab396d4-2f14-4796-aac0-0d82883dccf0) · [Forward Deployed AI Engineer](https://jobs.lever.co/palantir/636fc05c-d348-4a06-be51-597cb9e07488)
- [Deloitte — Forward Deployed Engineer (AI/Agentic Engineer) job posting](https://apply.deloitte.com/en_US/careers/JobDetail/Forward-Deployed-Engineer-AI-Agentic-Engineer/325824) · [Announcing Deloitte Forward Deployed Engineering](https://www.deloitte.com/us/en/services/consulting/articles/announcing-forward-deployed-engineering.html)
- [Accenture — Microsoft Forward Deployed Engineering practice (March 2026)](https://newsroom.accenture.com/news/2026/accenture-launches-microsoft-forward-deployed-engineering-practice-to-help-organizations-scale-ai-across-the-enterprise)
- [ServiceNow + Accenture Forward Deployed Engineering program (May 2026)](https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-and-Accenture-launch-forward-deployed-engineering-program-to-scale-agentic-AI-across-the-enterprise/default.aspx)
- [Kaseya — 2026 State of the MSP Report (press release)](https://www.kaseya.com/press-release/ai-emerges-as-the-key-to-scaling-msp-operations-as-growth-gets-harder/) · [report PDF](https://pages.thechannelco.com/rs/329-KEI-124/images/Asset-1-Kaseya-2026-State-of-the-MSP-Report-2026.pdf?version=0)
- This repository: `docs/PURPOSE.md`, `README.md`, `AGENTS.md`, `docs/gtm-wip.md`

**Grade B — reputable secondary**
- [a16z — Trading Margin for Moat: Why the Forward Deployed Engineer Is the Hottest Job in Startups](https://a16z.com/services-led-growth/) *(unreachable from this environment; represented via search summary)*
- [Pragmatic Engineer — What are Forward Deployed Engineers, and why are they so in demand?](https://newsletter.pragmaticengineer.com/p/forward-deployed-engineers) *(unreachable)*
- [LeadDev — The rise of the forward-deployed engineer](https://leaddev.com/career-development/the-rise-of-the-forward-deployed-engineer-fde) *(unreachable)*
- [Pax8 Managed Intelligence Provider program — ChannelPro](https://www.channelpronetwork.com/2026/06/09/pax8-managed-ai-services-take-center-stage-at-msp-conference/) · [Channel Insider](https://www.channelinsider.com/channel-business/channel-analysis/pax8-marketplace-mip-program-ai-services/) · [Channel Dive on token billing](https://www.channeldive.com/news/pax8-msp-marketplace-platform-ai-billing/822801/) *(all unreachable; represented via search summaries)*
- [CompTIA — Trends in Managed Services](https://connect.comptia.org/content/research/trends-in-managed-services-2022) · [What is an MSP](https://connect.comptia.org/content/articles/what-is-msp)
- [Forrester — The Future Of AI Consulting Services Is Disruptively Bright](https://www.forrester.com/blogs/the-future-of-ai-consulting-services-is-disruptively-bright)
- [Emergence Capital — The AI-Native Services Playbook](https://www.emcap.com/thoughts/the-ai-native-services-playbook)
- [Fortune — Sequoia on services as the new software](https://fortune.com/2026/04/21/services-are-the-new-software-sequoia-venture-capital-julien-bek-ai-native-eye-on-ai/)
- [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [CT Acquisitions — Private Equity MSP 2026: 169 deals, 69% PE](https://ctacquisitions.com/guides/private-equity-msp-2026/) · [M&A Signal — 2026 MSP M&A Report](https://masignal.com/msp/report-full.html)

**Grade C — vendor / SEO content, used directionally only**
- [FDE Academy — FDE vs Applied AI Engineer](https://fde.academy/blog/forward-deployed-engineer-vs-applied-ai-engineer) · [FDE vs Professional Services](https://fde.academy/blog/forward-deployed-engineer-vs-professional-services-enterprise-guide)
- [Perspective AI — 2026 FDE hiring trends](https://getperspective.ai/blog/2026-fde-hiring-trends-what-1000-job-posts-reveal) · [FDE vs ML Engineer vs Solutions Architect](https://getperspective.ai/blog/forward-deployed-engineer-vs-ml-engineer-vs-solutions-architect-2026) · [Solutions engineering reinventing as FDE](https://getperspective.ai/blog/solutions-engineering-reinventing-as-forward-deployed-ai-engineering-2026)
- [Seattle Data Guy — Forward Deployed Engineering Is About To Get Diluted](https://seattledataguy.substack.com/p/forward-deployed-engineering-is-about)
- [VC Cafe — The $9 Billion Bet on Forward Deployed Engineers](https://www.vccafe.com/the-9-billion-bet-on-forward-deployed-engineers/)
- [Glocomms — What Is a Forward Deployed Engineer?](https://www.glocomms.com/en-us/industry-insights/hiring-advice/what-is-a-forward-deployed-engineer)
- MSP benchmarks: [LTVplus — revenue per technician](https://www.ltvplus.com/msp/msp-revenue-per-technician/) · [Kaseya report takeaways](https://www.ltvplus.com/msp/kaseya-2026-msp-report-findings/) · [Bennett Financials — 60-15-15 operating model](https://bennettfinancials.com/60-15-15-msp/) · [Flamingo — MSP pricing models 2026](https://www.flamingo.run/blog/msp-pricing-models) · [Medha Cloud — 55 managed services statistics](https://medhacloud.com/blog/managed-services-market-statistics-2026) · [CloudSecureTech — MSP statistics](https://www.cloudsecuretech.com/insights/msp-statistics/)
- MSP + custom development: [Sovereign Systems](https://www.sovereignsystems.biz/blog/how-msps-can-expand-their-service-offerings-with-custom-software-development) · [RSI — software & AI development partner for MSPs](https://myrsi.com/who-we-serve/msps-seeking-a-software-partner/)
- MSP channel mechanics: [Channel Futures — How to be an MSP's partner, not merely a vendor](https://channelfutures.com/best-practices/how-to-be-an-msps-partner-not-just-a-vendor) · [Blumira — NFR licenses for MSPs](https://www.blumira.com/blog/top-nfr-licenses)
- AI agent liability: [Insurance and indemnification clauses every AI agent contract needs](https://www.tfsfventures.com/blog/insurance-and-indemnification-clauses-every-ai-agent-contract-needs) · [Who pays when an AI agent makes a costly mistake](https://insureyouragent.com/articles/who-pays-ai-agent-mistake-vendor-or-operator-sme)
- Agentic coding landscape: [MarkTechPost — top AI coding agents and platforms 2026](https://www.marktechpost.com/2026/06/10/ai-coding-agents-development-platforms-2026/) · [Digital Applied — AI coding tool pricing June 2026](https://www.digitalapplied.com/blog/ai-coding-tool-pricing-june-2026-seat-economics-guide)
- Outsourcing/agency economics: [Codebridge — outsourcing rates 2026](https://www.codebridge.tech/articles/software-development-outsourcing-rates-costs-and-trends) · [Haus Advisors — software development agency statistics](https://www.hausadvisors.com/blog/software-development-agency-statistics)
