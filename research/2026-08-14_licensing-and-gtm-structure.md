# Licensing and go-to-market structure — FSL adoption

*2026-08-14. Owner decisions taken this date on base license, contributor
agreements, trademark, and the enterprise motion, with the precedent survey and
the license-text reading that produced them. Not legal advice; the customer and
contributor agreements still require counsel review. Supersedes the licensing
and enterprise direction in `docs/gtm-wip.md` as it stood before this date; the
revised sections of that document are the working surface, this record is the
reasoning.*

## 1. Decisions taken

| # | Decision | Detail |
| --- | --- | --- |
| D1 | Base license is **FSL-1.1-MIT** | Applies to the Cormidia repository, to the separately packaged `validation-architect`, and to the learning-loop package when it gets its own repository. Each released version converts to MIT on its second anniversary. |
| D2 | **No open core** | One binary, one core product behavior. Learning loop, comparative execution, and Validation Architect are not feature-gated. See §5. |
| D3 | **CLA required** before the first external contribution | License-grant form (Apache ICLA shape), not copyright assignment. Bot-gated on pull requests. |
| D4 | **Trademark filed by the owner online**, budget $700 | USPTO direct filing, two classes, pre-approved identification wording. No attorney engaged at this stage. |
| D5 | Paid entitlement is **an artifact behind authentication**, not a license clause | Enforcement is delivery and trademark, not litigation. |
| D6 | **The Enterprise tier is removed.** The offer is Free, Individual, Business, and MSP | Individual and Business are self-service. Everything Enterprise previously promised — procurement, security review, SLA, indemnity, air-gap assistance, on-site work — is delivered by managed-service partners. See §6. |
| D7 | Built to be **operable by one person now**, with a deliberate team-and-CEO path on traction | The single-operator constraint governs how the product is built today. It is not a permanent ceiling: if Cormidia gains traction, a team and a CEO are recruited to carry the heavy lifting. D1 is what makes that handoff cheap. |
| D8 | **Cloud marketplaces are a distribution channel; a published standing offer covers managed service** | List on AWS, Azure and GCP marketplaces, and publish open terms under which any provider — hyperscaler or otherwise — may operate a managed Cormidia service. No per-deal negotiation. Guardrails in §6.8 are not optional. |
| D9 | **Forward-deployed / applied-AI engineers are the sharpest wedge for the MSP tier** — one segment, not a repositioning | Individual and Business keep their current positioning. FDE leverage is the argument aimed at MSP-shaped buyers. The claim is a **hypothesis under test**, evidenced today only by Cormidia's own self-build record. See §6.9. |
| D10 | **Repositories stay private until GA / first announcement** | Applies to Cormidia and `buildstacks-dev/validation-architect` (both already private). Not a secrecy measure — see §6.10. The open trigger is CLA + `LICENSE.md` + licensor name, not a date. External testers from the week of 2026-08-17 make the licence work the critical path. Tracked in cormidia/Cormidia#457 and buildstacks-dev/validation-architect#29. |

Cormidia is not represented as OSI open source while under FSL. It is
represented as **fair source**: published, readable, modifiable, self-hostable,
and permissively licensed on a two-year delay.

## 2. What FSL actually grants — the finding that shaped this

The operative clauses of `FSL-1.1-MIT`, read 2026-08-14:

> A Permitted Purpose is any purpose other than a Competing Use.

> A Competing Use means making the Software available to others in a commercial
> product or service that: (1) substitutes for the Software; (2) substitutes for
> any other product or service we offer using the Software that exists as of the
> date we make the Software available; or (3) offers the same or substantially
> similar functionality as the Software.

> We hereby irrevocably grant you an additional license to use the Software
> under the MIT license that is effective on the second anniversary of the date
> we make the Software available.

Two consequences follow, and the second one was not anticipated when the tier
structure was drafted on 2026-08-09.

**First, the competing-use bar is real and it is what we are buying.** No one
may stand up a hosted or resold Cormidia substitute for two years per version.
That is the protection an MIT-from-day-one license could not have provided at
any price.

**Second, internal use is free for everyone, including for-profit
organizations.** A Competing Use requires making the Software available *to
others*. A company running Cormidia on its own repositories, at any headcount,
is inside the Permitted Purpose and owes nothing under the license.

The prior draft treated the personal-to-organizational transition as a license
boundary. Under FSL it is not one, and no honest reading makes it one. The
boundary that survives is between **using the published source** and
**receiving the certified, attested, supported release** — which is a delivery
and contract boundary, and the one D5 makes load-bearing.

Modifying FSL's Permitted Purpose to restore an organizational meter was
considered and rejected: a deviated license forfeits the Fair Source brand, the
recognizability that makes the terms cheap for a partner to explain, and the
clean "becomes MIT" promise, in exchange for a meter this business does not
need.

## 3. What each tier sells after this change

Nothing about the price points changes. What changes is what the customer is
buying, and it must be described accurately in every public surface.

| Tier | Was (pre-2026-08-14) | Is now |
| --- | --- | --- |
| Free Individual | Permission for one natural person | Unchanged in practice; the grant now flows from the public license rather than a personal-use exception |
| Individual Source & Support, $199 | Source access + bounded support | **Source hook is gone.** Bounded support, signed release channel, and per-release qualification evidence. Repricing is an open decision — see §8 |
| Business, $1,999 | Organizational right to use | Certified signed builds, per-candidate qualification attestation, standard support, governance assistance. Self-service, any organization size |
| Enterprise, from ~$10,000 | Larger organizational scope, sold direct | **Removed** (D6). No direct enterprise motion exists |
| MSP | Was one channel role among four | **The replacement for Enterprise.** An explicit competing-use exemption plus certified builds, attestation, and a bounded escalation path. The MSP carries procurement, security review, SLA, indemnity and on-site work for its own end customers |

This is the Red Hat, Chef, Chainguard and Nextcloud shape: the source is free,
the *trusted build of it* is the product. It is consistent with `gtm-wip.md` §2
— "code is not the factory" — which already argued the durable asset is the
continuing ability to produce trusted releases, not the bytes of any one
release.

## 4. Precedent survey

Fetched and verified 2026-08-14.

| Precedent | Structure | What it establishes |
| --- | --- | --- |
| **Sentry** (2023–) | Authored FSL; source-available, converts to MIT/Apache-2.0 at two years | The exact license and conversion mechanism adopted here |
| **Fair Source** (2024–) | Category brand; Sentry, GitButler, Keygen and others | FSL is an identifiable category, not a bespoke license, which matters for partner and buyer explanation |
| **Chef** (2019) | 100% Apache-2.0 source, commercial distribution under trademark | Free source + paid certified binaries is a stated, operated model |
| **Chainguard** | Free upstream OSS builds; sells signed, attested, SBOM'd builds | The attestation is the product — the closest analogue to Cormidia's qualification evidence |
| **Nextcloud** | AGPLv3, all features free, explicitly no open core | Tiers convert with zero feature-gating and zero license lever — direct support for D2 |
| **Red Hat** | GPL source, paid subscription | The canonical certified-distribution business |
| **GitLab** | MIT core, proprietary `ee/` | The open-core alternative that D2 declines |
| **Sidekiq** | LGPLv3 core, Pro $995/yr, Enterprise from $229/mo | Individual/business/enterprise annual tiers on freely forkable source, essentially unforked for a decade |

**Counter-evidence considered.** Redis (BSD → SSPL 2024 → AGPLv3 2025), Elastic
(→ SSPL 2021, AGPL added 2024) and HashiCorp (MPL → BSL 2023, acquired by IBM)
show that license tightening produced no demonstrated revenue improvement and,
in Redis's case, a Linux Foundation fork (Valkey) backed by AWS, Google, Oracle
and Alibaba within weeks. The lesson taken: **permissive grants are one-way.**
Anything released under FSL will convert to MIT on schedule and cannot be
recalled. That is accepted deliberately, not overlooked.

**Acquisition.** The concern that free source suppresses acquisition value is
not supported. Red Hat sold to IBM for $34B at a 60%+ premium; HashiCorp for
~$6.4B at a 41.7% premium while MPL-licensed through its growth; MySQL to Sun
for $1B while GPL dual-licensed; and Chef to Progress for $220M in September
2020 at roughly 3× its $70M ARR — seventeen months after going 100% Apache-2.0.
Acquirers price ARR, customers, brand, team and legible distribution. D3 is the
decision that most affects diligence, not D1.

## 5. Why no open core (D2)

Gating the learning loop, comparative execution, or Validation Architect was
evaluated and declined.

- **Open core is the lever you reach for when the license cannot stop
  competition.** FSL already stops it for two years per version, which exceeds
  any release's commercial life under the §2 argument. Adding a second lever is
  redundant.
- **It costs the product's stated shape.** `gtm-wip.md` §1 names "one
  installable binary and one core product behavior" as the offer. A gate
  contradicts it.
- **It costs validation surface.** A gated boundary is a second build
  configuration and a second test matrix; the case catalog effectively doubles
  at the gate, and the ungated path is the one that rots silently.
- **It is what makes a fork attractive.** Permissive core plus a desirable
  gated feature is the standard setup for a competitor to reimplement the gate
  and fork around it.

Per-subsystem findings:

- **Comparative execution** — `docs/comparative-execution/design.md` designs
  `cormidia compare` as a standalone local-repository workflow with no org,
  scheduler, or GitHub dependency, expressly so non-Cormidia users can evaluate
  the harness. It is the acquisition on-ramp; gating it removes the thing it
  was built to be.
- **Learning loop** — the only one that would have passed an honest test
  (*is the feature withheld from individuals, or meaningless to them?* — it
  needs episode volume a solo user does not generate). Declined anyway under
  the reasoning above. It remains the correct first candidate if the base
  license is ever moved to unrestricted MIT or Apache-2.0.
- **Validation Architect** — being extracted to its own `validation-architect`
  package and repository with its own published API contract, consumed by
  Cormidia through an adapter. It is a separate product, licensed FSL-1.1-MIT
  in its own right per D1. This yields a second revenue surface without
  altering Cormidia's shape.

## 6. Operating model: solo now, team on traction

D7 has two halves and both matter.

**Today, the business is built to be run by one person.** No hiring and no
travel are assumed for anything currently shipping. This is a design input, not
a complaint: it forces automated onboarding, near-zero support volume, and a
standing evidence pack, all of which are better products regardless of
headcount.

**If Cormidia gains traction, a team and a CEO are recruited to carry the heavy
lifting.** That path is deliberate and held open, not hypothetical. The design
constraint keeps the product honest while the company is one person; it is not
a ceiling on what the company becomes.

D1 is what makes that handoff cheap, and this is a second reason FSL is the
right base licence. With the source published, CI visible, and the validation
harness inspectable, an incoming team ramps without a knowledge bottleneck
running through one founder, and an incoming CEO inherits a company whose
technical claims can be verified rather than taken on trust. A closed codebase
would make the same hire slower, riskier, and more dependent on the person
being replaced.

### 6.1 What in the Enterprise tier actually required a team

| Obligation | Why it needs people |
| --- | --- |
| Response-time SLA | On-call coverage; a single operator cannot promise a short clock without guaranteeing a breach |
| Warranty and indemnity | Errors-and-omissions insurance and counsel on retainer — fixed cost rather than headcount |
| Procurement and security review | Questionnaires, redlines, vendor onboarding; weeks of calendar per deal |
| On-site presence and QBRs | Travel |

Only the last is travel. The prior draft treated these as one undifferentiated
"enterprise" burden; they separate cleanly, and the SLA — not the travel — is
the binding one.

### 6.2 What Cormidia's architecture already removes

The constraint is far less costly here than it would be for a typical vendor:

- **Self-hosted and customer-controlled** — no uptime SLA, no data residency
  obligation, no data-processing agreement burden, no multi-tenancy diligence.
  This is the single largest source of enterprise review effort and it does not
  apply.
- **Bring-your-own provider** — no subprocessor chain to defend and no
  model-vendor liability passthrough.
- **Machine-produced evidence** — qualification attestations, the threat model,
  SBOM and provenance are generated by the release path, not assembled by a
  human per deal. A standing, published evidence pack answers most of a security
  review without a meeting.

That last point is `gtm-wip.md` §2 doing commercial work: because the factory
produces the assurance artifact, the assurance does not require a person.

### 6.3 The offer becomes four tiers, and Enterprise is not one of them

| Tier | Motion |
| --- | --- |
| Free | Public licence; no transaction |
| Individual | Self-service |
| Business | Self-service, any organization size |
| MSP | Negotiated partner agreement — the only tier requiring a conversation |

Everything Enterprise used to promise is now the MSP's product, sold by the MSP
to its own end customers under its own terms. Cormidia's obligation runs to the
MSP — business hours, one timezone, escalation clock rather than incident clock
— and **no response-time SLA is ever signed directly with an end customer.**

### 6.4 Why FSL is what makes the MSP tier saleable

This is the part that would not work under a permissive licence, and it is worth
stating plainly because it inverts the usual objection to restrictive terms.

FSL's competing-use bar prohibits making Cormidia available to others in a
commercial product or service. **Operating Cormidia on behalf of end customers
is exactly that.** An MSP therefore cannot run a Cormidia practice at all
without a written exemption — which is the thing Cormidia sells them.

Under MIT or Apache-2.0 there would be nothing to sell: any MSP could operate
Cormidia for paying customers, indefinitely, for free. The competing-use clause
is not merely defensive here; it is the mechanism that makes the highest-value
tier monetizable, and it arrived as a side effect of a licence chosen for other
reasons.

The two-year conversion does put a clock on it. Each release's exemption value
expires when that release converts to MIT, so the MSP tier sells continuing
access to *current* releases plus attestation and escalation — the same renewal
logic as every other tier, and consistent with §2.

### 6.5 Product obligations that follow

Single-operator design is an engineering constraint, not only a commercial one.
It promotes `gtm-wip.md` §8's "hidden variable costs" from a risk to watch into
a hard design rule:

- Onboarding must complete without a human; no implementation call may be
  required to reach first value at Business tier.
- Diagnostics must drive support volume toward zero — self-resolving error
  messages, `doctor`-shaped commands, and failure output that tells the
  operator what to do rather than what went wrong.
- The evidence pack must be **standing and published**, regenerated by the
  release path, never assembled per deal.
- Billing, entitlement, certified-build download, and renewal must be fully
  automated. A manual step in that chain is a permanent tax on one person.
- Any proposed feature that creates an unbounded human obligation is out of
  scope regardless of its revenue case.

Cormidia developing and operating itself is what makes this viable, and the
dogfooding commitment is therefore load-bearing rather than a demonstration.

### 6.6 Continuity, and why D1 answers the objection

A single-operator vendor will face the succession question from every serious
buyer: what happens to us if you stop? Under D1 the answer is structural and
unusually strong — **the source is published, and every release converts to MIT
within two years.** No customer can be stranded, no escrow arrangement is
needed, and a question that would otherwise require a contractual remedy is
answered by the licence.

The same property serves the D7 growth path. Published source, visible CI and
an inspectable validation harness are what let an incoming team and CEO take
over without the founder as a bottleneck. One licence decision answers both the
customer's continuity question and the company's own succession question.

### 6.7 The problems this does not solve

**MSP bootstrapping order.** MSPs invest where customers already are, and under
D6 the larger customers are supposed to arrive through MSPs. The first such
deal will likely be sourced directly and then handed to an MSP to deliver — an
exception that should be planned for rather than discovered.

**Nothing captures large-customer value directly.** With Enterprise removed, a
five-thousand-engineer company and a ten-person shop both pay $1,999. That is
consistent with the standing refusal to meter users or apps, and it buys a
price list explainable without a calculator, but it is a deliberate decision to
forgo revenue rather than an oversight. The value is captured instead by the
MSP, and Cormidia takes a share — which is the correct trade under D7, since
the alternative is an operating burden that cannot currently be staffed.

**Volume is now required.** Sidekiq reached roughly $7M ARR under closely
comparable constraints — solo, no enterprise sales motion, "Enterprise" as a
self-service price tier rather than a process — but over roughly a decade and
on top of an ecosystem-wide install base. If traction arrives faster than that,
D7's team-and-CEO path is the intended response.

### 6.8 Cloud marketplaces and the hyperscaler question (D8)

"Partner with clouds" covers three arrangements with very different risk, and
they must not be conflated.

| Arrangement | What it is | Verdict |
| --- | --- | --- |
| **Marketplace listing** | Cormidia's own subscription sold through the provider's storefront; the provider handles billing and procurement, Cormidia still delivers | **Unambiguous yes.** Highest value, lowest risk |
| **Provider as MSP** | The provider operates Cormidia for its customers under a competing-use exemption, paying Cormidia | **Yes, on published terms.** Same shape as any other MSP, at larger scale |
| **First-party managed service** | The provider builds and brands its own Cormidia-derived service | **Extreme caution.** This is the Elasticsearch story |

**Why marketplace listing fits D7 unusually well.** Marketplace fees now run
roughly 3–5% — Google cut from 20% to 3% in 2021 and AWS and Azure followed —
and, more importantly, marketplace purchases draw down committed cloud spend
under AWS EDP, Azure MACC and Google's commitment obligations. An enterprise
buying through a marketplace is spending budget it has already committed, which
collapses the procurement cycle that the removed Enterprise tier existed to
service. **The marketplace is what restores an enterprise motion without
restoring the headcount that motion required.**

**The vulnerability that must be understood before signing anything.** Every FSL
release converts to MIT at twenty-four months. A hyperscaler's product planning
horizon comfortably exceeds that, so for a provider that wants Cormidia badly,
the rational move is to wait rather than pay. This is not hypothetical: AWS
forked Elasticsearch into OpenSearch, and Redis's SSPL change produced Valkey
under the Linux Foundation, backed by AWS, Google, Oracle and Alibaba.

**Why Cormidia is unusually protected from that clock.** A two-year-old Redis is
still a perfectly good Redis. A two-year-old Cormidia points at retired model
IDs, deprecated provider SDKs, and stale harness versions. The product's value
perishes faster than the conversion period, which is §2's "code is not the
factory" argument made concrete against the one threat that could otherwise
break the model. Perishability is the defence, and it is a stronger one here
than almost any other category of software would enjoy.

**The trademark is what survives conversion, and there is direct precedent.**
Elastic lost the licensing war — AWS forked regardless — but won the trademark
fight: AWS was required to strip "Elasticsearch" from its service and product
names, renaming to Amazon OpenSearch Service in September 2021. The code
converts; the name never does. This materially raises the importance of D4: the
$700 filing stops being housekeeping and becomes the load-bearing asset in any
cloud relationship.

**Terms the published offer must carry.** These are guardrails, not negotiating
positions:

- **Non-exclusive, always.** No provider ever receives exclusivity, and no
  most-favoured-nation clause.
- **The trademark is never licensed for a provider-branded service.** "Cormidia
  on AWS" is acceptable; "Amazon Cormidia" is not, in any form.
- **The exemption is a lapsing subscription, never perpetual**, and never
  survives non-payment or termination.
- **Attestation stays with Cormidia.** A provider may distribute the certified
  build; it may not issue qualification evidence, and may not represent its own
  builds as qualified.
- **Publish the terms rather than negotiate them.** A standing open offer is
  the only form of this that is compatible with D7 — per-deal negotiation with
  a hyperscaler's legal team is precisely the unbounded human obligation §6.5
  rules out.

### 6.9 The FDE wedge (D9)

Forward-deployed engineers — Palantir's original model, now copied by most
applied-AI vendors — exist because enterprise AI deployments fail at the last
mile. The customer has the model and the data and lacks anyone who can sit
inside their workflow and build the thing. FDEs are expensive, scarce, and
fundamentally unscalable: one engineer is embedded in one place at a time.

The claim Cormidia can make to that audience is a headcount multiplier rather
than a feature list — a governed agent org doing build work under one
engineer's supervision lets that engineer carry more than one engagement. It is
**one segment among several, not a repositioning.** Individual and Business keep
their current shape; this is the argument aimed at MSP-shaped buyers.

**Why it fits what is already decided.**

- It attacks the MSP bootstrapping problem in §6.7 from the other side. FDE
  firms and in-house AI platform teams already have the customers and are
  already margin-constrained by headcount. They do not need Cormidia's install
  base; they need leverage on their own, which reverses the order problem.
- An FDE firm operating Cormidia across client engagements **is** a
  managed-service provider under FSL's competing-use bar. It needs the
  exemption. Positioning and licence point at the same buyer.
- Published source is close to a requirement for this audience. An engineer
  embedded in a client's repository, accountable for what ships, cannot adopt a
  black box; they must read it, patch it in the field, and answer for its
  behaviour. FSL's grant — read, modify, self-host, use commercially on client
  work — matches that exactly, and the one thing it withholds without payment
  is operating it as a service for others, which is precisely what an FDE firm
  wants to do.
- Qualification attestations, threat model and provenance are liability cover
  for the hardest part of an FDE's job: defending agent-produced work to a
  client's security and audit function.

**The evidence position, stated honestly.** The only proof today is Cormidia's
own self-build record. A buyer will discount that, correctly: one codebase, one
supervisor who is also the author, a friendly repository, and no transfer
demonstrated to a client engagement. It is evidence of the mechanism, not of
the multiplier.

**But the mechanism is already instrumented, which is better than it appears.**
`docs/episodes/contract.md` §Measurements already defines, with explicit
numerators, denominators and `invalid_measurement` semantics rather than
zero-filling, the exact quantities this claim needs:

| Claim component | Existing measurement |
| --- | --- |
| Supervision ratio | **Human decisions** — authority/state-changing operator actions; passive observation explicitly excluded |
| Agent productivity | **Productive-pass ratio** — productive passes over all provider turns, with adapter-start failures kept in the denominator |
| Rework | **Repeated-work cost** — cost of a pass whose valid fingerprint already existed, including downstream repetition |
| Time to value | **Active wall time** — human wait excluded and reported separately; **elapsed time** reported alongside |
| Unit economics | **Equivalent cost**, quality-graded, where unknown is never rendered as $0 |

No new instrumentation is required to begin evidencing this. What is required
is publishing the episode measurements already collected from Cormidia
operating on Cormidia, over a meaningful window, with the self-build caveat
stated rather than buried. That is a stronger opening position than a case
study, because the denominators are defined in advance and the contract already
refuses to represent a missing input as a pass.

**Where the claim does not land.** A headcount multiplier is an argument
against the revenue model of any firm billing by the hour. It lands with
fixed-price and outcome-priced shops, and with in-house AI platform teams
carried as cost centres. It does not land with a body shop, and that should
determine who is approached first.

### 6.10 Private until GA, and why not for secrecy (D10)

Repositories stay private until GA or first announcement. The reasoning matters,
because the intuitive justification does not survive inspection.

**Publishing the package would publish the source.** `pnpm build` is plain
`tsc` — no bundler, no minifier — so `dist/**/*.js` is readable JavaScript with
original identifiers, structure and control flow; only types are stripped. The
`files` array additionally ships `prompts/`, `TASTE.md`, `roles.yaml`,
`pipelines.yaml` and `taste/` **verbatim as plain text**. Those are the
human-ratified surfaces and the most distinctive material in the product.
Sparse documentation is no defence, because `prompts/` and `roles.yaml` *are*
the description of how the system works.

Obtaining real secrecy would require bundling and minifying and no longer
shipping `prompts/`, which is functionally impossible. So "private repo, public
npm" yields approximately no confidentiality for this package shape.

**This is consistent rather than alarming.** `gtm-wip.md` §2 already holds that
the commercial model does not depend on source secrecy, and D1 makes FSL the
protection whether or not the repository is public. Obscurity adds nothing on
top of the licence, and relying on it would contradict the strategy already
adopted.

**The reasons that do hold:**

- A public repository carries issues, pull requests, questions and drive-by
  contributions — precisely the unbounded human obligation §6.5 forbids under
  single-operator design.
- The CLA (D3) is not yet in place. Private means no external contributions, so
  it is not currently blocking, but it must land before the repository opens.
- There is no `LICENSE.md` and no legal entity for the copyright line.
- Public surfaces do not yet describe consistent rights (risk 8).

**The open trigger is therefore a condition, not a date:** CLA, `LICENSE.md`,
and entity name all in place. A two-month working estimate is reasonable but
should not be the gate.

**Why embedding the ratified surfaces into the bundle would not help.** The
question was raised whether `prompts/`, `roles.yaml` and the other ratified
surfaces could be compiled into the binary rather than shipped as loose text.
They could, and it buys nothing:

- `src/org/home.ts` resolves them from `PACKAGE_ROOT`, and `src/org/org-upgrade.ts`
  **copies them into `~/.cormidia/<org>/`** so each org owns, diffs and upgrades
  its own copy. The plain text lands on the user's disk by design. Embedding
  only changes whether that copy is written from a file or from a string
  constant.
- Minification renames identifiers; it does not obscure string literals. `grep`
  or `strings` over a bundle recovers prompt text immediately.
- It would fight the customization model the human-ratified-surface design
  depends on.

Engineering cost, no confidentiality gain, and it works against the product's
own architecture. FSL is the protection; secrecy is not available and is not
needed.

**npm posture — revised 2026-08-14 for an external tester cohort.**
`cormidia@0.0.1` is published as a 2 KB name-reservation stub marked
`UNLICENSED` (2026-08-03), so the name is secured and no real code is exposed.
`validation-architect` and `cormidia-job` are unclaimed.

External testers are expected from the week of 2026-08-17, which reverses the
earlier recommendation to withhold publication. Distribution to third parties
now happens before GA, and that makes the licence work the critical path rather
than a pre-GA tidy-up: **no build may reach a tester before `LICENSE.md` and the
`package.json` licence field are correct.** Bytes shipped under `UNLICENSED`
convey no rights to the recipient and impose no terms on them.

Distribution options for a small cohort, in increasing order of exposure:

| Option | Access control | FSL clock | Notes |
| --- | --- | --- | --- |
| Direct tarball | Full — you choose recipients | Starts on the version handed over | Zero infrastructure; `pnpm smoke:package -- <absolute-tarball>` already exercises this path |
| Private scoped package (`--access restricted`) | npm-account level | Starts on publish | Requires a paid npm plan; real access control |
| Public publish | None | Starts on publish | Frictionless `npm i -g cormidia`; appropriate at GA |

For a handful of named testers next week, a tarball or a restricted scoped
package is the better fit — it keeps the surface controlled without slowing
anyone down. Public publication remains the GA step.

**The entity is not actually a blocker.** Copyright vests in the author on
creation, and a natural person may be the FSL licensor and the USPTO trademark
applicant. `${licensor name}` can be the owner's own name today; incorporating
later and assigning the copyright and mark to the company is routine. Nothing in
the licence or trademark path needs to wait on forming an entity.

## 7. Adoption checklist

### 7.1 License

Current state, verified 2026-08-14: **the repository has no `LICENSE` file and
`package.json` declares no `license` field, while `"private": false`.** The
package is publishable today with no declared license, which npm resolves as
unspecified. This is a live gap and the first thing to close.

- [ ] Add `LICENSE.md` with the `FSL-1.1-MIT` template, `${year}` = 2026 and
      `${licensor name}` set to the filing entity.
- [ ] Set `"license": "LicenseRef-FSL-1.1-MIT"` in `package.json` — FSL has no
      registered SPDX identifier, so the `LicenseRef-` form is the correct
      expression, with `"licenseFile": "LICENSE.md"` alongside it.
- [ ] Confirm `files` in `package.json` ships `LICENSE.md`.
- [ ] Add the plain-English summary to README and homepage: free to read, use,
      modify and self-host, including commercial internal use; may not be
      offered as a competing product or service; becomes MIT two years after
      each release.
- [ ] Add the CLI notice.
- [ ] Third-party notices file for the runtime dependency set (`yaml` plus the
      four provider SDKs).
- [ ] Never describe Cormidia as open source while under FSL. "Fair source" is
      the accurate term; "becomes MIT after two years" is the accurate promise.

### 7.2 CLA (D3)

A Contributor License Agreement is a grant from the contributor to the project
of rights beyond what the repository license conveys — specifically the right
to sublicense and relicense their contribution. The lighter alternative, a DCO
`Signed-off-by` attestation, conveys **no relicensing rights** and is what left
several companies in the 2024 relicensing wave unable to move without tracing
every past contributor.

- [ ] Adopt the Apache ICLA text, adapted; individual and corporate variants.
- [ ] Install CLA Assistant (or equivalent) to gate pull requests
      automatically.
- [ ] Land it **before** the repository accepts its first external
      contribution. It is cheap now and cannot be applied retroactively.
- [ ] Retain signature records as an acquisition-diligence artifact.

The realistic external contribution surface is provider adapters, where the
four existing certification records serve as the template. Core contributions
face the detector-deposit rule, the type ratchet, and the human-ratified
surface list, and should be expected to be rare.

### 7.3 Trademark (D4)

Owner filing directly online, $700 budget:

| Item | Amount |
| --- | --- |
| USPTO base filing, Class 9 (downloadable software) | $350 |
| USPTO base filing, Class 42 (SaaS / software services) | $350 |
| **Total** | **$700** |

To hold that number, the application must be "clean." Two surcharges are what
break the budget:

- **+$200 per class** if the goods/services description uses custom wording.
  Avoid by selecting entries verbatim from the USPTO ID Manual — do not
  hand-write the description.
- **+$100 per class** for insufficient information.

"Cormidia" is a coined term, which is the strongest and most cheaply cleared
mark category; a knockout search should come back clean. Maintenance filings
fall due between years 5–6 and again at year 10.

The trademark is not decorative here — under D5 it is half the enforcement
mechanism. Anyone may rebuild from published source; no one else may call the
result Cormidia or present its attestations.

## 8. Open decisions

- **MSP pricing shape — now the highest-value open decision**, since MSP is the
  only tier replacing Enterprise revenue. The candidate shapes are (a) each end
  customer holds a Business subscription that the MSP transacts at a margin,
  plus a flat annual competing-use exemption fee; (b) a flat unlimited-end-
  customer MSP licence; or (c) revenue share. Shape (a) keeps the public price
  list at two numbers, makes MSP growth accrue to Cormidia, and is the
  recommendation; (b) is simplest for the MSP and worst for Cormidia if the MSP
  scales. Also open: who holds the end-customer contract, and who carries the
  SLA obligation in writing.
- **Individual $199 repricing.** The tier lost its source differentiator.
  Options: reprice downward toward a support-and-attestation subscription; fold
  it into Free and start paid tiers at Business; or hold $199 and make the
  signed release channel plus per-release qualification evidence the stated
  value. Unresolved.
- Whether Business is described as a subscription or as a licence in
  customer-facing copy — the substance is now a subscription and the copy must
  not overstate a licence right that FSL already grants.
- The trigger and shape of the D7 team-and-CEO path: what traction level
  justifies it, and which obligations are taken back in-house from MSPs first.
- Entity name for the copyright line and trademark applicant.
- Whether `validation-architect` publishes on the same conversion cadence.
- Counsel review of the customer agreement, the CLA, and the CLI notice.
- Purchasing-power bands, unchanged from the prior draft and still open.

## 9. Sources

FSL license text and identifiers — <https://fsl.software/> and
`getsentry/fsl.software` · Fair Source — <https://fair.io/> ·
Chef/Progress — <https://techcrunch.com/2020/09/08/progress-snags-software-automation-platform-chef-for-220m/> ·
Red Hat/IBM — <https://www.redhat.com/en/ibm> ·
IBM/HashiCorp — <https://www.techtarget.com/searchitoperations/news/366582095/Experts-IBM-buy-could-change-HashiCorp-open-source-equation> ·
Redis AGPLv3 — <https://redis.io/blog/agplv3/> ·
relicensing analysis — <https://dirkriehle.com/2025/05/03/re-relicensing-to-open-source-explained/> ·
Chainguard — <https://edu.chainguard.dev/get-started/what-is-chainguard/> ·
Nextcloud — <https://nextcloud.com/pricing/> ·
Sidekiq — <https://sidekiq.org/products/enterprise/> ·
USPTO fee restructure — <https://www.anchorfilings.com/blog/uspto-trademark-fees-2025-restructure.html> ·
cloud marketplace fees and commit drawdown — <https://www.partner1.io/partner-blog/cloud-marketplace-fees-compared> and
<https://www.automatum.io/blog-posts/aws-vs-azure-vs-gcp-marketplace-comparison> ·
Elastic/AWS trademark settlement and the OpenSearch rename — <https://www.elastic.co/blog/elastic-and-amazon-reach-agreement-on-trademark-infringement-lawsuit> and
<https://www.computerweekly.com/news/252513588/Amazon-drops-Elasticsearch-name-from-cloud-portfolio-after-trademark-infringement-suit-concludes>
