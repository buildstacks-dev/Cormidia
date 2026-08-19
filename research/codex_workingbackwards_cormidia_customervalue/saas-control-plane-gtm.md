# SaaS control plane — go-to-market

*Working-backwards research draft — 2026-08-17. Exploratory only: this record
does not amend `docs/PURPOSE.md` or any other human-ratified product surface.
It was developed fresh from the current SaaS and customer-value discussion,
without inheriting prior documented GTM conclusions.*

## Problem statement

Cormidia can remain an installable runtime that each customer operates, or it
can become a managed service that is available from any device and integrates
with the customer's existing development environment. The choice affects more
than packaging. It determines the product's onboarding experience, operating
model, security boundary, unit economics, and value proposition.

The installable-only model preserves customer control, but asks every customer
to provision and maintain an organizational runtime, understand its state
layout, connect GitHub, manage credentials, keep the runtime current, and leave
a machine running for continuous operation. Those obligations work against the
desired experience: connect the organization, state a goal, and let Cormidia
carry it to a truthful outcome.

A fully hosted monolith removes that friction, but creates a different set of
problems. Cormidia would have to host untrusted repositories, execution
environments, credentials, model traffic, and customer secrets. It would also
have to reconcile provider licensing and authentication with multi-tenant
cloud execution. Enterprise customers may specifically refuse that boundary.

The core question is therefore not simply whether Cormidia should be SaaS. It
is which responsibilities belong in a continuously available Cormidia control
plane, which remain in customer-owned systems of record, and where agent
execution should occur.

## Options considered

### 1. Installable and customer-operated only

Cormidia ships as a proprietary local runtime. Customers provision the host,
state, provider installations, credentials, scheduling, upgrades, and remote
access.

**Advantages**

- Strong customer control over code, credentials, and execution.
- Lowest Cormidia infrastructure and data-custody burden.
- Natural fit for local harnesses and customer-owned model subscriptions.
- No multi-tenant execution environment to secure.

**Disadvantages**

- High onboarding and support burden.
- The experience remains tied to a maintained host even if the CLI is usable
  from multiple devices.
- Continuous operation, collaboration, billing, and cross-app observability
  become customer responsibilities.
- Product upgrades fragment across installations.
- The product risks being perceived as a sophisticated tool rather than an
  always-on organizational service.

### 2. Fully hosted, vertically integrated SaaS

Cormidia owns the control plane, persistent state, model access, and execution
environments. Customers connect repositories and interact through web, mobile,
API, or a thin CLI.

**Advantages**

- The cleanest self-serve onboarding and device-independent experience.
- Cormidia can operate continuously without a customer host.
- One service version simplifies support and upgrades.
- Integrated usage accounting, observability, and collaboration are easier to
  deliver.

**Disadvantages**

- Cormidia becomes responsible for customer code, secrets, network access,
  sandboxing, regionality, and execution isolation.
- Provider CLIs or consumer subscriptions cannot be assumed to permit
  multi-tenant server execution; API and commercial terms must be validated.
- Hosted compute and model subsidy can make a free tier economically unsafe.
- The model is least attractive to security-sensitive enterprises.
- It couples the control-plane product decision to a much larger cloud-compute
  product.

### 3. Cloud dashboard with GitHub as the complete state backend

Cormidia provides identity and a UI, but stores nearly all organizational state
as files, issues, and other artifacts in GitHub.

**Advantages**

- Customer-visible, versioned, portable state.
- Less proprietary persistence infrastructure.
- Builds on a system engineering teams already trust.

**Disadvantages**

- Git and GitHub are poor canonical stores for sessions, scheduling leases,
  claims, billing, presence, short-lived credentials, and high-frequency
  operational events.
- Customers may still have to understand or provision a special state
  repository.
- A Cormidia-owned hidden repository creates ownership and exit concerns.
- Using two writable representations of the same fact creates reconciliation
  and split-brain risk.

### 4. Managed control plane with pluggable execution

Cormidia Cloud owns organizational coordination and operational state. Code and
delivery artifacts remain in customer-controlled GitHub or, later, GitLab.
Execution can occur on a Cormidia-managed worker, a local runner, CI, or
customer-controlled infrastructure.

**Advantages**

- Preserves the low-friction, always-on SaaS experience.
- Separates control-plane value from the location of code execution.
- Supports individuals, self-serve teams, and enterprises without separate
  product architectures.
- Lets Cormidia keep its implementation proprietary while making customer
  policy, actions, evidence, and costs inspectable.
- Creates a credible path to customer-hosted and dedicated enterprise
  deployments.

**Disadvantages**

- Requires a precise distributed protocol between control plane and runners.
- Offline runners, duplicated events, credential expiry, and version skew must
  fail closed and recover truthfully.
- Data ownership must be explained category by category rather than with the
  simpler but misleading claim that everything is either local or cloud.

## Recommendation

Adopt option 4 as the product direction to validate: **Cormidia Cloud should be
the managed organizational control plane, with execution location treated as a
customer-selectable policy.**

The product should separate five responsibilities:

| Layer | Canonical location | Representative responsibilities |
| --- | --- | --- |
| Client surfaces | Web, mobile, CLI, agent integrations | Submit goals, inspect state, make decisions |
| Cormidia control plane | Cormidia Cloud | Identity, org/app configuration, planning, scheduling, claims, approvals, budgets, audit, notifications, billing |
| Execution plane | Managed worker, local runner, CI, or customer infrastructure | Repository access, harness execution, tests, builds, bounded tools |
| Delivery record | Customer GitHub/GitLab | Code, issues, branches, PRs, reviews, releases, durable product decisions |
| Secret custody | Encrypted service or customer vault | Short-lived credentials, provider keys, integration tokens |

Each fact must have one canonical owner. Cloud state may be exported or
projected into GitHub for portability and audit, but an export must not become
a second writable master.

### Customer experience

The initial product promise should be demonstrable in one short journey:

1. Sign in with GitHub.
2. Connect one existing repository through a least-privilege GitHub App.
3. Choose a provider path: Cormidia-managed, bring-your-own API credentials, or
   a local/customer runner.
4. Accept or customize a small operating policy.
5. Submit one bounded goal.
6. Receive a tested, independently reviewed PR plus a concise record of work,
   evidence, cost, and any decision still requiring the human.

The customer should not have to create or understand a separate organizational
repository before receiving value.

### Initial market wedge

Start with a technical founder, lean CTO, or engineering manager who already
uses one or more coding agents, operates one to three repositories, and is
personally acting as planner, scheduler, reviewer, retry loop, and status
reconstructor.

The product is not positioned as another coding agent. The positioning thesis
is:

> Connect your repositories, define your operating policy, and give Cormidia a
> goal. Cormidia coordinates the agents, carries the work through review and
> verification, and brings you only the decisions that require you.

The first proof point should be one repeated software-delivery loop, not an
enterprise-wide transformation claim. Expansion proceeds from one workflow to
one app, multiple workflows, multiple apps, and finally multiple governed
organizations.

### Packaging and pricing hypothesis

Avoid a pure per-seat model. Cormidia is intended to let a small number of
humans operate more software, so human seats alone are a poor measure of value
or cost.

- **Personal/free:** one app, low concurrency, local execution or bring-your-own
  model credentials, strict usage ceilings, and no material model subsidy.
- **Team:** a base platform charge covering an org and included active
  operators, with metered model and managed-compute consumption.
- **Enterprise:** an annual commitment for policy hierarchy, dedicated or
  customer-hosted execution, identity integration, audit export, regionality,
  private networking, and support.

Managed execution should be available as a self-serve paid capability rather
than reserved for enterprises. Enterprise differentiation should center on
isolation, governance, deployment control, and contractual support.

### Evidence required before committing to the architecture

- Median time from signup to the first reviewed PR.
- Human coordination minutes per verified outcome.
- Completion, blocked, and failed rates with truthful terminal classification.
- Waiting time at handoffs versus active execution time.
- Review and rework cycles per accepted outcome.
- Model and compute cost per accepted outcome.
- Percentage of runs requiring human intervention and whether those
  interventions were genuinely material.
- Willingness to connect a repository and grant the required GitHub App
  permissions.
- Provider terms and technical paths for local, API-backed, and hosted harness
  execution.

The SaaS thesis should be accepted only if the control plane produces clear
organizational value independent of subsidized model access. Hosting the logic
keeps implementation proprietary; it does not by itself create the moat.

## Point-in-time external references

Accessed 2026-08-17:

- [Devin enterprise deployment](https://docs.devin.ai/enterprise/deployment/overview)
- [Cursor background agents](https://docs.cursor.com/background-agent)
- [Cursor self-hosted cloud agents](https://cursor.com/blog/self-hosted-cloud-agents)
- [Factory deployment patterns](https://docs.factory.ai/enterprise/network-and-deployment)
- [Factory managed and bring-your-own computers](https://docs.factory.ai/cli/features/droid-computers)
- [GitHub App permission model](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
