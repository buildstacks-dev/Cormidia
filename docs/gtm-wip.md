# Cormidia go-to-market — working notes

> **Status:** WIP, non-normative, and not legal advice. This document records
> the owner's current commercial direction and the questions still to resolve.
> It is not a customer license, pricing commitment, release authorization, or
> amendment to `docs/PURPOSE.md`.
>
> **Owner alignment:** The free-binary, annual paid-license, source-bundle, and
> tier direction below was aligned in discussion on 2026-08-09. Prices remain
> launch hypotheses until separately adopted for external use.

## 1. Current direction

Cormidia will be proprietary commercial software with one complete public npm
binary. Legitimate individual use, including a natural person's own solo
commercial projects, will be free. Paid offerings will fund source access,
continuing assurance, organizational rights, support, and partner economics
rather than unlocking an intentionally crippled runtime. Cormidia will not be
represented as open source.

The offer should be simple:

- one installable binary and one core product behavior;
- legitimate free individual use, not merely tolerated noncompliance;
- an optional paid Individual Source & Support offer;
- annual fixed-price Business and Enterprise licenses, with no per-user or
  per-app charge;
- unlimited users and apps within each paid organizational scope;
- customer-controlled, self-hosted operation;
- customer-paid model/provider usage, separate from the Cormidia license; and
- authenticated source release bundles for paid customers, without GitHub
  access.

This pricing direction matches the product contract: one Cormidia runtime can
operate many apps. Charging for each app or person would tax adoption and make
the product harder for customers and partners to explain. Free individuals are
primarily distribution, learning, feedback, and the future customer and partner
pool; the model does not require every individual user to produce revenue.

## 2. Code is not the factory

Cormidia should behave as though a released source snapshot may eventually
leak. The commercial model must not depend on source secrecy.

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

## 3. Source delivery is not GitHub access

The public npm package is the free runtime delivery path. It will necessarily
be downloadable and inspectable by anyone, but it is not the complete customer
source product. Source inclusion for a paid customer does **not** require
membership in Cormidia's GitHub organization or access to its development
repository.

The intended customer delivery is an authenticated, versioned release bundle.
Its exact contents remain to be specified, but the honest baseline is:

- complete source needed to build and operate the licensed release;
- dependency and build manifests;
- applicable copyright and third-party license notices;
- build and deployment instructions;
- the customer-facing deterministic tests needed to verify shipped behavior;
- release checksums or signatures; and
- the qualification attestation and disclosures promised for that release.

Customer source delivery does not imply access to:

- Git history, branches, pull requests, or issue trackers;
- unreleased code, roadmaps, or internal planning;
- internal research and development records;
- private live-campaign infrastructure, credentials, or raw evidence containing
  protected information;
- other customers' information; or
- internal sales, support, and partner operations.

The release bundle must not be deliberately crippled and still be marketed as
complete source. The precise boundary between customer-verifiable release
evidence and private development operations must be documented before launch.

## 4. Licensing shape

The free grant should intentionally permit one natural person to use the public
binary for their own work, including their own solo commercial projects. It
should not silently extend to operation by or on behalf of an employer, client,
team, or other organization. That personal-to-organizational transition is a
license boundary, not a per-seat meter; once an organization is licensed, its
users and apps remain unlimited within the purchased scope.

The customer agreement should be drafted and reviewed by qualified counsel. At
a product-policy level, it should aim to grant paid customers the right to:

- use the licensed release for their own internal operations;
- run unlimited users and apps inside the purchased customer scope;
- inspect, compile, and internally modify the source;
- make internal backup and archival copies; and
- permit employees and authorized contractors to work with the source on the
  customer's behalf under appropriate confidentiality obligations.

It should normally prohibit, unless a separate agreement expressly permits it:

- public redistribution or publication of the source;
- sublicensing or selling Cormidia itself;
- using the source to offer a competing Cormidia product;
- operating a shared or multi-tenant Cormidia service for unrelated customers;
- removing license and attribution notices; and
- transferring source access outside the licensed customer scope.

The agreement also needs explicit answers for modified installations, support
eligibility, subsidiaries and affiliates, acquisitions, termination, security
fixes, contributions or patches returned to Cormidia, and continued use of an
already-paid release.

Public distribution needs a custom license file in the package, matching npm
license metadata, a plain-English summary in the README and homepage, and a
conspicuous CLI notice designed with counsel. Paid organizations should accept
an explicit customer agreement or order form. Cormidia does not need invasive
DRM, routine phone-home checks, or an enforcement strategy aimed at individuals.

## 5. Pricing architecture

Tiers should reflect the commercial relationship and Cormidia's support or
contractual burden—not adoption meters or an artificially incomplete core
product. Every paid offer is annual. The customer should retain a perpetual
right to use the last fully paid release; renewal buys new releases, provider
compatibility, security work, current qualification evidence, and continuing
support.

The following numbers are launch hypotheses to test, not public commitments:

| Tier | Annual price hypothesis | Intended shape and natural differentiators |
| --- | ---: | --- |
| Free Individual | $0 | One natural person's own work; full binary, bring-your-own providers, current releases, documentation, and community support |
| Individual Source & Support | $199 standard | Optional source release bundle, updates, qualification evidence, and bounded best-effort support; no response-time promise |
| Business | $1,999 | One operating legal entity; unlimited users/apps, source, standard support, governance assistance, and partner implementation rights |
| Enterprise | Starting around $10,000 | Larger or affiliated organizational scope, procurement and security review, SLA, air-gap assistance, priority support, and negotiated terms |

The Individual hypothesis should start at $199 rather than $499 while the free
binary is the alternative. $299 is a plausible later test after demand and the
value of the source-and-assurance bundle are demonstrated. Individual support
must remain explicitly bounded so a low annual price does not imply unlimited
human service.

Affordability requires purchasing-power pricing, not merely currency
conversion. A simple initial Individual hypothesis is:

- **Standard:** $199/year;
- **Regional:** approximately $119/year; and
- **Access:** approximately $69/year.

Country membership, local currencies, taxes, and abuse handling remain to be
designed. Regionalization should begin with Individual; Business adjustments
should be narrower, while Enterprise remains quote-based. Some arbitrage is an
acceptable cost of a low-enforcement, globally accessible strategy.

Business and Enterprise are materially separated rather than only slightly
higher than Individual. Businesses buy organizational rights and operational
confidence. Enterprises additionally buy contractual assurance, risk-bearing
support, and human commitments. The price gap must also leave room for partner
margin and implementation economics.

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

| Role | Contribution | Likely economics | Source access |
| --- | --- | --- | --- |
| Affiliate / referral partner | Introduces a qualified prospect; Cormidia transacts and supports | Referral commission | None merely for affiliate status |
| Implementation partner | Installs, configures, integrates, trains, or customizes for a licensed customer | Customer-paid services and possibly a referral fee | Only as the customer's authorized contractor, or under a narrow partner agreement |
| Reseller | Sources and helps close or transact the license | Resale margin and potential renewal economics | Not required to sell; governed access only when needed for delivery |
| Managed-service partner | Operates Cormidia for licensed customers | Recurring managed-service revenue plus governed license economics | Separate MSP rights; no unlicensed shared service |

Partners are most likely to stay engaged when Cormidia creates attachable,
repeatable service work: onboarding, integration, governance design, training,
customization, and ongoing operations. Commission alone is not a partner value
proposition.

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
- Free Individual to paid Individual and organizational conversion, without
  assuming either will be high;
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

1. **Source leakage.** Treat the license as a legal boundary, not a technical
   secrecy mechanism. Authenticated delivery and access records are reasonable;
   obfuscation, invasive DRM, and mandatory phone-home checks would undermine
   the product's sovereignty promise.
2. **Unsupported forks.** Define a clean support boundary for modified source
   while preserving a customer's right to modify it.
3. **Channel damage.** Poor implementations or exaggerated sales claims can
   harm the Cormidia brand faster than they create distribution. Training,
   reference architectures, and transparent certification matter.
4. **Hidden variable costs.** Unlimited users and apps must not accidentally
   include unlimited human support, bespoke implementation, or provider spend.
5. **License ambiguity.** The Free Individual, customer, contractor, partner,
   reseller, and MSP grants must compose cleanly. A homepage and license file
   provide notice but do not replace counsel-reviewed terms and explicit paid
   customer acceptance.
6. **Public-package drift.** The free public binary is intentional, but package
   metadata, included license text, README, homepage, and CLI notice must all
   describe the same rights. Public binary access must never be confused with
   authenticated delivery of the paid source release bundle.
7. **Regional arbitrage.** Purchasing-power bands will be imperfect. Keep the
   rules simple and use billing-country evidence without invasive enforcement;
   measure abuse before adding friction.

## 9. Decisions still required

- Exact Free Individual, Business, and Enterprise eligibility boundaries,
  especially solo companies, employers, consultants, and client work.
- Validation of the $199 / $1,999 / $10,000 launch price hypotheses.
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
- Public npm license metadata, package license, README summary, homepage terms,
  CLI notice, and paid-customer acceptance flow.
- Counsel-reviewed customer and partner agreements.

Until these are decided, this document is a strategic working surface rather
than an external promise.
