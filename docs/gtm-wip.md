# Cormidia go-to-market — working notes

> **Status:** WIP, non-normative, and not legal advice. This document records
> the owner's current commercial direction and the questions still to resolve.
> It is not a customer license, pricing commitment, release authorization, or
> amendment to `docs/PURPOSE.md`.
>
> **Owner alignment:** The free-binary, annual paid-offer, and tier direction
> below was aligned in discussion on 2026-08-09. On 2026-08-14 the owner adopted
> **FSL-1.1-MIT** as the base license for Cormidia and `validation-architect`,
> declined open core, required a CLA, budgeted a direct $700 trademark filing,
> fixed the business as single-operator for now with a team-and-CEO path on
> traction, replaced the Enterprise tier with MSP, adopted cloud-marketplace
> listing plus a published open offer for managed service, and took the
> forward-deployed-engineer wedge as one segment for MSP; §§1–9 are revised
> accordingly. The reasoning, the precedent survey, and the license-text
> reading behind those changes are in
> `research/2026-08-14_licensing-and-gtm-structure.md`. Prices remain launch
> hypotheses until separately adopted for external use.

## 1. Current direction

Cormidia will be **fair source** software under `FSL-1.1-MIT`, with complete
published source and one complete public npm binary. Anyone may read, use,
modify and self-host it, including commercially and internally at any scale.
The one restriction is competing use: offering Cormidia, or a substantially
similar substitute, to others as a commercial product or service. Each released
version converts to the MIT license on its second anniversary.

Paid offerings fund continuing assurance, certified builds, support, and
partner economics. They do not unlock an intentionally crippled runtime, and
they are not permission to use software the license already permits.

Cormidia is never described as open source while under FSL. The accurate terms
are "fair source" and "becomes MIT two years after each release."

The offer should be simple:

- one installable binary and one core product behavior, with no gated features;
- complete public source, free to use and modify, converting to MIT on a
  two-year delay;
- annual fixed-price Individual and Business subscriptions, self-service, with
  no per-user or per-app charge, and a negotiated MSP tier above them;
- unlimited users and apps within each paid customer scope;
- customer-controlled, self-hosted operation;
- customer-paid model/provider usage, separate from the Cormidia subscription;
  and
- authenticated, signed, attested release builds for paid customers.

This pricing direction matches the product contract: one Cormidia runtime can
operate many apps. Charging for each app or person would tax adoption and make
the product harder for customers and partners to explain. Free individuals are
primarily distribution, learning, feedback, and the future customer and partner
pool; the model does not require every individual user to produce revenue.

## 2. Code is not the factory

The source is published. The commercial model does not depend on source
secrecy, and under FSL it never could — this section was written as a
precaution and is now simply the operating reality.

The code for one release is an artifact. The durable factory is the continuing
ability to produce trusted releases:

- validation and qualification discipline;
- ongoing compatibility work across models, providers, harnesses, and external
  services;
- signed, tested releases and truthful retained evidence;
- product judgment, operational knowledge, documentation, and support;
- onboarding and implementation playbooks;
- brand and customer trust; and
- a capable partner network.

A copied release is a depreciating snapshot. Customers renew because current
Cormidia releases remain compatible, supported, secure, and credibly proven—not
because the previous version was impossible to inspect.

## 3. Published source is not the certified release

Under FSL the source is public, so source access is no longer a paid
deliverable and no longer a commercial boundary. The boundary that remains is
between **the source anyone may build** and **the release Cormidia certifies**.

The paid artifact is an authenticated, versioned, signed release bundle:

- the exact built release, signed, with checksums;
- the qualification attestation and disclosures for that exact candidate;
- dependency and build manifests;
- applicable copyright and third-party license notices;
- build, deployment, and verification instructions; and
- the customer-facing deterministic tests needed to verify shipped behavior.

Anyone may compile equivalent bytes from the public repository. No one else can
issue the attestation, and no one else may present the result as Cormidia. That
is the entire enforcement model — delivery and trademark, not a clause about
who is allowed to run the software.

Paid delivery still does not imply access to:

- Git history beyond what is public, unreleased code, roadmaps, or internal
  planning;
- private live-campaign infrastructure, credentials, or raw evidence containing
  protected information;
- other customers' information; or
- internal sales, support, and partner operations.

Entitlement must be gated at the download, before launch. If the certified
channel is reachable without authentication, there is no paid product.

## 4. Licensing shape

FSL grants everyone — individuals and organizations alike, commercially and at
any headcount — the right to use, copy, modify, create derivative works from,
and redistribute Cormidia for any purpose other than a competing use. Internal
organizational use is inside that grant. **There is no personal-to-organizational
license boundary**, and public copy must never imply one.

What FSL prohibits, for two years per released version, is making Cormidia
available to others in a commercial product or service that substitutes for it
or offers substantially similar functionality. That covers a hosted Cormidia,
a resold Cormidia, and a rebadged fork sold as a service. It is the whole of the
competitive protection, and it is sufficient.

The paid customer agreement is therefore a **subscription for assurance, not a
grant of permission**. It should be drafted and reviewed by qualified counsel,
and at a product-policy level it adds:

- access to the authenticated certified release channel;
- the qualification attestation for each exact candidate;
- a defined support scope, and for MSPs an escalation path rather than an
  end-customer incident SLA;
- warranty, indemnity, and security-response commitments the license disclaims;
- governance assistance and partner implementation rights; and
- trademark permissions where a customer or partner needs them.

The agreement still needs explicit answers for modified installations, support
eligibility for them, subsidiaries and affiliates, acquisitions, termination,
security fixes, and continued use of an already-paid release. It no longer
needs source-redistribution clauses, which FSL now governs directly.

**Contributions.** A Contributor License Agreement is required before the
repository accepts its first external contribution — license-grant form, not
copyright assignment, bot-gated on pull requests. A DCO sign-off is
insufficient: it conveys no relicensing rights, which is precisely what left
several vendors unable to move in the 2024 relicensing wave. The CLA is also a
standard acquisition-diligence artifact. It is cheap now and cannot be applied
retroactively.

**Launch posture.** Repositories stay private until GA or first announcement.
This is not a secrecy measure and must not be described as one:
`pnpm build` is plain `tsc` with no bundler or minifier, and the shipped `files`
list includes `prompts/`, `TASTE.md`, `roles.yaml` and `pipelines.yaml`
verbatim, so publishing the real package publishes the source in practice.
Consistent with §2, FSL — not confidentiality — is the protection. The repository
stays private because a public one carries issues, pull requests and drive-by
contributions that single-operator operation cannot absorb, and because the CLA
and `LICENSE.md` are not yet in place. **The trigger to go public is those
items, not a date.**

External testers are expected from the week of 2026-08-17, which puts
distribution to third parties ahead of GA and makes the licence work the
critical path: **no build may reach a tester before `LICENSE.md` and the
`package.json` licence field are correct**, since bytes shipped as `UNLICENSED`
convey no rights and impose no terms. A direct tarball or a restricted scoped
package suits a small named cohort; public npm publication remains the GA step.
Forming a company is not a prerequisite — copyright vests in the author, and a
natural person can be both the FSL licensor and the trademark applicant.
Tracked in cormidia/Cormidia#457 and buildstacks-dev/validation-architect#29.

**Packaging.** As of 2026-08-14 the repository has no `LICENSE` file and
`package.json` declares no `license` field while `"private": false` — the
package is publishable today with no declared license. Closing that is the
first task. Public distribution needs `LICENSE.md` carrying the FSL-1.1-MIT
text, `"license": "LicenseRef-FSL-1.1-MIT"` in `package.json` (FSL has no
registered SPDX identifier), `LICENSE.md` in the shipped `files` list, a
third-party notices file, a plain-English summary in README and homepage, and a
conspicuous CLI notice. Paid customers accept an explicit subscription
agreement or order form. Cormidia needs no invasive DRM, no routine phone-home
checks, and no enforcement strategy aimed at individuals — entitlement is
enforced at the download and by the trademark.

## 5. Pricing architecture

Tiers reflect Cormidia's support and contractual burden—not adoption meters, an
artificially incomplete core product, or permission the license already grants.
Every paid offer is annual. Because FSL grants perpetual use of every published
release to everyone, renewal does not buy the right to keep running Cormidia;
it buys **new certified releases, provider compatibility, security work,
current qualification evidence, and continuing support**.

The following numbers are launch hypotheses to test, not public commitments:

| Tier | Annual price hypothesis | Intended shape and natural differentiators |
| --- | ---: | --- |
| Free (everyone) | $0 | Full source and binary under FSL, unlimited internal use at any scale, bring-your-own providers, documentation, and community support |
| Individual Support | $199 standard | Signed release channel, per-release qualification evidence, and bounded best-effort support; no response-time promise. **Repricing open — see §9** |
| Business | $1,999 | One operating legal entity of any size; certified signed builds, attestations, standard support, governance assistance. Self-service |
| MSP | Negotiated | **Replaces Enterprise.** An explicit competing-use exemption, certified builds, attestation, and a bounded escalation path. The MSP carries procurement, security review, SLA, indemnity, air-gap and on-site work for its own end customers |

There is no Enterprise tier. Individual and Business are self-service — card
payment, no call required to buy — and MSP is the only tier requiring a
conversation. Cormidia is built to be operated by one person today, with no
travel assumed, and **no response-time SLA is ever signed directly with an end
customer.** Cormidia's obligation runs to the MSP, on business hours in one
timezone, on an escalation clock rather than an incident clock.

This forgoes direct capture of large-customer value: a five-thousand-engineer
company and a ten-person shop both pay $1,999. That is deliberate. It follows
the standing refusal to meter users or apps, keeps the price list explainable
without a calculator, and routes the value an Enterprise tier would have
captured through the MSP instead — where the operating burden can actually be
carried.

If Cormidia gains traction, a team and a CEO are recruited to take on the heavy
lifting, and obligations currently held by MSPs can be brought in-house. The
single-operator constraint governs how the product is built now; it is not a
ceiling on the company.

The Individual tier lost its source differentiator when the base license became
FSL, and its value proposition is now the weakest of the three. $199 should be
tested only on the strength of the signed channel and per-release evidence; if
that does not convert, the honest moves are to fold it into Free and start paid
at Business, or to reprice it as a low-cost support subscription. Individual
support must remain explicitly bounded so a low annual price does not imply
unlimited human service.

Affordability requires purchasing-power pricing, not merely currency
conversion. A simple initial Individual hypothesis is:

- **Standard:** $199/year;
- **Regional:** approximately $119/year; and
- **Access:** approximately $69/year.

Country membership, local currencies, taxes, and abuse handling remain to be
designed. Regionalization should begin with Individual; Business adjustments
should be narrower, while MSP terms remain negotiated. Some arbitrage is an
acceptable cost of a low-enforcement, globally accessible strategy.

Business sits materially above Individual rather than slightly above it.
Individuals buy a signed channel and evidence; organizations buy certified
builds, attestation, support, and operational confidence. The gap must also
leave room for MSP margin and implementation economics, since the MSP tier is
priced on top of it.

Provider inference and subscription costs should ordinarily stay between the
customer and its selected providers. If Cormidia later bundles provider spend,
that spend needs an explicit allowance or pass-through mechanism; it must not
be silently absorbed into an unlimited fixed-price promise.

## 6. Channel strategy

The GTM goal is to keep acquisition cost low, pass efficiency gains to
customers, and rely substantially on trusted channels. A partner should be
able to explain the license and price without a usage calculator, while earning
meaningful revenue from both the transaction and valuable customer work.

The public binary is part of the channel: individuals can learn and prove
Cormidia without requesting a demo, and prospective partners can understand the
product before seeking governed customer or partner rights. A customer's move
from personal experimentation to organizational operation creates the natural
commercial handoff.

Channel roles should remain distinct:

Source access is no longer a channel lever — every partner can read the source
under FSL, which lowers the cost of building an implementation practice. What
partners need granted are **trademark use, certified-build distribution, and
MSP rights**, since FSL's competing-use bar otherwise prohibits operating
Cormidia as a service for others.

| Role | Contribution | Likely economics | What must be granted |
| --- | --- | --- | --- |
| Affiliate / referral partner | Introduces a qualified prospect; Cormidia transacts and supports | Referral commission | Marketing and trademark use only |
| Implementation partner | Installs, configures, integrates, trains, or customizes for a licensed customer | Customer-paid services and possibly a referral fee | Nothing beyond FSL for the work itself; trademark use for positioning |
| Reseller | Sources and helps close or transact the subscription | Resale margin and potential renewal economics | Right to transact and to deliver certified builds |
| Managed-service partner | Operates Cormidia for licensed customers | Recurring managed-service revenue plus governed subscription economics | **Explicit competing-use exemption** — operating Cormidia for others is otherwise prohibited by FSL |

Partners are most likely to stay engaged when Cormidia creates attachable,
repeatable service work: onboarding, integration, governance design, training,
customization, and ongoing operations. Commission alone is not a partner value
proposition.

**The MSP role is not one channel option among four — it is the tier that
replaced Enterprise.** Managed-service partners carry procurement, security
review, on-site work, first-line support, and any SLA owed to the end customer.
This is a structural dependency, not a preference.

FSL is what makes that tier saleable, and the mechanism is worth stating
plainly. The competing-use bar prohibits making Cormidia available to others in
a commercial product or service, and **operating Cormidia on behalf of end
customers is exactly that.** An MSP cannot run a Cormidia practice without a
written exemption — which is the thing being sold. Under MIT or Apache-2.0 there
would be nothing to sell, because any MSP could operate Cormidia for paying
customers indefinitely for free. The clause chosen for competitive protection
turns out to be what makes the highest-value tier monetizable.

The two-year conversion puts a clock on it: each release's exemption value
expires when that release converts to MIT, so the MSP tier sells continuing
access to current releases, attestation, and escalation. That is the same
renewal logic as every other tier.

It has a bootstrapping order problem worth planning for rather than
discovering: MSPs invest where customers already are, and larger customers are
supposed to arrive through MSPs. The first such deal will most likely be
sourced directly and then handed to an MSP to deliver.

### The forward-deployed engineer wedge

The sharpest argument for the MSP tier is aimed at forward-deployed and applied
AI engineers — the firms and in-house platform teams whose delivery capacity is
capped by how many engagements one engineer can be embedded in at a time.
Cormidia's claim to them is a headcount multiplier: a governed agent org doing
build work under one engineer's supervision.

This is **one segment, not a repositioning.** Individual and Business keep their
current shape. Three things make it fit:

- FDE-shaped firms already have the customers and are already constrained by
  headcount, which attacks the MSP bootstrapping problem from the other side —
  they come for leverage on their own book, not for Cormidia's install base;
- a firm operating Cormidia across client engagements **is** an MSP under the
  competing-use bar, so the positioning and the licence point at the same
  buyer; and
- published source is close to a requirement for an engineer embedded in a
  client's repository and accountable for what ships, while the attestations
  and threat model are cover for defending agent-produced work to a client's
  audit function.

**The claim is a hypothesis under test, and must be written that way.** The only
evidence today is Cormidia's own self-build record — one codebase, one
supervisor who is also the author, no demonstrated transfer to a client
engagement. A serious buyer will discount it, correctly.

What makes that position defensible anyway is that the mechanism is already
instrumented. `docs/episodes/contract.md` §Measurements defines human decisions,
productive-pass ratio, repeated-work cost, active wall time and quality-graded
equivalent cost, each with explicit numerators and denominators and with
missing inputs yielding `invalid_measurement` rather than a zero. The supervision
ratio this claim rests on is already a measured quantity. Publishing that series
from Cormidia operating on Cormidia, with the self-build caveat stated plainly,
is the first evidence step and needs no new instrumentation.

The claim does not land everywhere. A headcount multiplier argues against the
revenue model of any firm billing by the hour; it lands with fixed-price and
outcome-priced shops and with in-house platform teams carried as cost centres.
That should determine who is approached first.

### Cloud marketplaces and managed-service providers

Cormidia lists on the AWS, Azure and Google Cloud marketplaces, and publishes a
**standing open offer** under which any provider may operate a managed Cormidia
service. Terms are published, not negotiated per deal — per-deal negotiation
with a hyperscaler's legal team is exactly the unbounded human obligation §8
rules out.

Marketplace listing is the highest-value, lowest-risk part of this. Fees run
roughly 3–5%, and marketplace purchases draw down committed cloud spend under
AWS EDP, Azure MACC and Google's commitment obligations — so an enterprise buys
with budget it has already committed. That collapses the procurement cycle the
removed Enterprise tier existed to service. **The marketplace restores an
enterprise motion without restoring the headcount it required.**

The risk to hold in view is the conversion clock. Every release becomes MIT at
twenty-four months, and a hyperscaler's planning horizon exceeds that, so a
provider that wants Cormidia badly can wait rather than pay. AWS forked
Elasticsearch into OpenSearch; Redis's licence change produced Valkey, backed
by AWS, Google, Oracle and Alibaba. What protects Cormidia is perishability: a
two-year-old release points at retired model IDs, deprecated provider SDKs and
stale harness versions, so the snapshot depreciates faster than the clock runs.

**The trademark is what survives conversion.** Elastic lost the licensing war
and won the trademark fight — AWS was required to strip "Elasticsearch" from
its service names and rebrand to OpenSearch. The code converts; the name never
does. Guardrails follow from that and are not negotiating positions:

- non-exclusive always, with no most-favoured-nation clause;
- the trademark is never licensed for a provider-branded service — "Cormidia on
  AWS" is acceptable, "Amazon Cormidia" is not;
- the competing-use exemption is a lapsing subscription, never perpetual, and
  never survives termination; and
- attestation stays with Cormidia — a provider may distribute the certified
  build but may not issue qualification evidence or call its own builds
  qualified.

Two things reduce how much the partner has to carry, and both should be built
before the program opens. Cormidia is self-hosted and bring-your-own-provider,
which removes uptime SLAs, data residency, processing agreements, and
multi-tenancy questions from diligence entirely. And the qualification
attestations, threat model, SBOM and provenance are produced by the release
path, so a **standing published evidence pack** can answer most of a security
review without a meeting.

The initial program should stay deliberately small. It needs:

- simple training and a demonstrable reference deployment;
- clear qualification for implementation and managed-service partners;
- direct-price parity and rules for partner-led discounts;
- lightweight deal registration to prevent channel conflict;
- attribution, refund, payout, renewal, and customer-ownership rules;
- demo or not-for-resale licenses where genuinely needed;
- permitted marketing claims and brand protections; and
- a feedback path from partners into product and documentation work.

The program should expand only after a small set of partners can repeatedly
qualify, deploy, and support good-fit customers.

## 7. Economics and measures

Channel acquisition is variable-cost acquisition, not free acquisition.
Commissions, partner recruitment, enablement, sales engineering, support,
discounts, and poor-fit referrals all count toward CAC.

At minimum, measure:

- public install-to-success and repeat-use signals without invasive telemetry;
- free-to-paid Individual and organizational conversion, without assuming
  either will be high, and recognizing that free use is now a licence right
  rather than a funnel stage that expires;
- partner applications, activation, and time to first qualified opportunity;
- partner-sourced pipeline, win rate, and sales-cycle length;
- commission plus enablement and support cost per acquired customer;
- implementation success and time to customer value;
- support hours and gross margin by tier and channel;
- renewal, expansion, and churn by partner; and
- customer satisfaction and incidents by implementation partner.

The channel is working when it lowers total acquisition cost without lowering
customer quality, implementation quality, trust, or renewal performance.

## 8. Risks to design around

1. **Permissive conversion is one-way.** Every FSL release becomes MIT on its
   second anniversary, irrevocably. Nothing published can be recalled, and the
   two-year clock cannot be extended retroactively. This is accepted
   deliberately; the 2024–2025 relicensing wave (Redis → SSPL → AGPL, Elastic,
   HashiCorp → BSL) shows what attempting a reversal costs, including the
   Valkey fork. Plan as though every release will be MIT on schedule.
2. **Free-riding at a low price point.** With public source and $199–$1,999
   pricing, compliance is largely voluntary. The mitigation is structural, not
   legal: the paid artifact must be behind authentication, so the certified
   channel is something a non-customer cannot reach rather than something they
   are asked not to use.
3. **Competing distribution after conversion.** A converted release may be
   rebuilt and resold by anyone. The durable defences are the trademark, the
   attestation, and the maintenance treadmill — six adapters chasing model and
   provider churn, the validation harness, and campaign infrastructure. Low
   pricing is itself a defence: there is no arbitrage in undercutting $1,999
   for unlimited users.
4. **Unsupported forks.** Define a clean support boundary for modified source
   while preserving everyone's right to modify it.
5. **Channel damage.** Poor implementations or exaggerated sales claims can
   harm the Cormidia brand faster than they create distribution. Training,
   reference architectures, and transparent certification matter.
6. **Unbounded human obligation.** Unlimited users and apps must not
   accidentally include unlimited human support, bespoke implementation, or
   provider spend. Under single-operator design this is a hard rule
   rather than a caution: onboarding must complete without a human, diagnostics
   must drive support volume toward zero, the evidence pack must be standing
   rather than assembled per deal, and billing, entitlement, download and
   renewal must be fully automated. A feature whose revenue case requires a
   person is out of scope.
7. **Overstating what is sold.** The largest new copy risk is describing
   Business or MSP as buying permission to use Cormidia. FSL already
   grants that. Every public surface must describe the paid offer as certified
   builds, attestation, support, and contractual assurance. Overstating it is
   both a trust problem and a refund argument.
8. **Public-surface drift.** Package metadata, `LICENSE.md`, README, homepage,
   and CLI notice must all describe the same rights, and none may call Cormidia
   open source while it is under FSL. Public source access must never be
   confused with authenticated delivery of the certified release.
9. **Contribution rights.** Without a CLA in place before the first external
   contribution, the licence cannot later be changed and acquisition diligence
   inherits the problem. Treat it as a launch blocker, not a formality.
10. **Regional arbitrage.** Purchasing-power bands will be imperfect. Keep the
    rules simple and use billing-country evidence without invasive enforcement;
    measure abuse before adding friction.
11. **MSP concentration.** With the Enterprise tier removed, all
    large-customer revenue depends on managed-service partners who do not exist
    yet. A single early MSP performing badly, or leaving, removes the tier
    outright. Qualify slowly and never let one MSP become the only route to a
    segment.
12. **Continuity — largely answered, and worth saying out loud.** A
    single-operator vendor will be asked what happens if the operator stops.
    Under FSL the answer is structural: the source is published and every
    release converts to MIT within two years, so no customer can be stranded
    and no escrow arrangement is needed. This should be stated directly in
    customer-facing material rather than left for a buyer to raise.

## 9. Decisions still required

**Decided 2026-08-14** (recorded in
`research/2026-08-14_licensing-and-gtm-structure.md`): base license
`FSL-1.1-MIT` for Cormidia and `validation-architect`; no open core; CLA
required before the first external contribution; trademark filed directly by
the owner online at a $700 budget across USPTO classes 9 and 42. The
personal-to-organizational eligibility question is closed — FSL grants internal
use to everyone, so there is no such boundary to draw. Also decided: **the
Enterprise tier is removed**, leaving Free, self-service Individual,
self-service Business, and a negotiated MSP tier that absorbs what Enterprise
promised; and **Cormidia is built for single-operator operation today**, with no
travel assumed and no response-time SLA ever signed directly with an end
customer, while a team-and-CEO path stays deliberately open should traction
justify it.

Still open:

- **MSP pricing shape — the highest-value open decision**, since MSP is the only
  tier replacing Enterprise revenue. Candidates: each end customer holds a
  Business subscription the MSP transacts at a margin plus a flat annual
  exemption fee (recommended — keeps the public price list at two numbers and
  makes MSP growth accrue to Cormidia); a flat unlimited-end-customer licence;
  or revenue share. Also open: who holds the end-customer contract, and who
  carries the SLA obligation in writing.
- **Individual $199 repricing**, now that source is not a differentiator: hold
  and test on signed channel plus evidence, fold into Free and start paid at
  Business, or reprice as a low-cost support subscription.
- Validation of the $1,999 launch price hypothesis.
- How the first large-customer deal is handled given the bootstrapping order
  problem: sourced directly and handed to an MSP, or declined until an MSP
  exists.
- Scope and publication cadence of the standing security-and-qualification
  evidence pack that substitutes for a human diligence motion.
- The trigger for the team-and-CEO path: what traction justifies it, and which
  obligations come back in-house from MSPs first.
- Which marketplace to list on first, and whether the listing is a SaaS,
  container or professional-services shape — each has different packaging and
  security-review effort, all of it borne by one person.
- The published open-offer terms for managed-service operation, including the
  exemption fee, the trademark-use rules, and the termination conditions.
- Which episode measurements are published from the self-build record, over
  what window, and how the self-build caveat is stated (§6, FDE wedge).
- Whether customer-facing copy describes Business as a subscription rather than
  a licence — the substance is now a subscription.
- Legal entity for the copyright line and the trademark applicant.
- Whether `validation-architect` publishes on the same two-year conversion
  cadence as Cormidia.
- Country membership for Standard, Regional, and Access Individual pricing;
  local currencies, taxes, refunds, and regional handling.
- Included update and support periods.
- Scope of customer-facing tests and qualification evidence in each release
  bundle.
- Modified-source support and security-update policy.
- Subsidiary, contractor, acquisition, and transfer rights.
- Referral commissions, reseller margins, renewal treatment, and deal
  registration rules.
- MSP and embedding policy.
- Customer download, entitlement, signing, and release-verification mechanics.
- README summary wording, homepage terms, CLI notice text, and the
  paid-customer acceptance flow. The package license metadata itself is decided
  above and is a build task, not a decision.
- Counsel-reviewed customer agreement, partner agreements, and CLA text.

Until these are decided, this document is a strategic working surface rather
than an external promise.
