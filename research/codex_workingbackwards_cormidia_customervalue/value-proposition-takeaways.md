# Value proposition takeaways

*Working-backwards research draft — 2026-08-17. Exploratory only: this record
does not amend `docs/PURPOSE.md` or any other human-ratified product surface.
It was developed fresh from the current SaaS and customer-value discussion,
without inheriting prior documented GTM conclusions.*

## Problem statement

AI coding tools increase the amount of technical work that one person can
initiate, but they do not by themselves make an organization effective. As
execution becomes cheaper and more parallel, management and coordination can
become the limiting system: translating intent, establishing ownership,
sequencing work, preserving context, obtaining review, enforcing policy,
resolving disagreement, reconstructing status, and escalating the few
decisions that genuinely require a human.

This work is commonly performed by middle managers through meetings, messages,
documents, reminders, status reports, and repeated follow-up. The actual
analysis or implementation may take hours while the organizational elapsed
time takes days. Work is lost or delayed at handoffs, activity is mistaken for
progress, and leaders cannot easily determine what happened, what evidence
supports the outcome, what it cost, or why it stopped.

Cormidia needs a value proposition that captures this organizational problem
without presenting itself as another coding agent, another task manager, or a
scheme to eliminate middle management.

## Options considered

### 1. Position Cormidia as a coding agent

Lead with code generation, model quality, repository editing, or autonomous PR
creation.

**Why not:** this places Cormidia in direct comparison with model and harness
vendors whose primary product is technical execution. It understates
Cormidia's governance, independent review, durable coordination, authority,
recovery, and organizational scope. It also makes the product's perceived
quality rise and fall with whichever model is currently strongest.

### 2. Position Cormidia as an agent orchestrator

Lead with multi-agent routing and selecting the right harness, model, and
effort for each task.

**Why not:** orchestration is a meaningful capability but a weak customer
outcome. It describes internal machinery rather than why an executive,
manager, or founder should buy the product. Generic orchestration is also easy
to confuse with workflow graphs or model routers.

### 3. Position Cormidia as a task or project-management platform

Lead with tickets, workflows, status, assignments, dashboards, and portfolio
views.

**Why not:** task managers record and communicate what people intend to do.
Cormidia is intended to cause governed work to progress, test it, review it,
retain evidence, and reach a truthful terminal outcome. Project-management
language risks making the product sound like another system that humans must
continually update.

### 4. Lead with replacing or reducing middle management

Promise fewer managers or direct automation of management roles.

**Why not:** this is politically threatening, narrows access to internal
champions, and misstates what software can safely replace. Human managers own
judgment, prioritization, accountability, coaching, conflict, trust, customer
context, and organizational trade-offs. The message may appeal superficially
to cost reduction while destroying adoption among the people who understand
and operate the process.

### 5. Position Cormidia as the organizational execution control plane

Lead with converting management intent into continuously progressing,
governed, inspectable, and verified organizational execution across people,
agents, repositories, and enterprise systems.

**Why it fits:** this describes the layer above coding agents and task systems.
It connects the product's mechanics to management capacity, execution
reliability, and economic outcomes without claiming to replace human judgment.

## Recommendation

Adopt option 5 as the working value proposition.

### Category

> **Cormidia is the organizational execution control plane for software
> teams.**

### Core value proposition

> **Cormidia turns management intent into governed, verified execution across
> people, agents, and systems.**

### Customer-facing promise

> Connect your repositories, define your operating policy, and give Cormidia a
> goal. It coordinates the agents, carries the work through review and
> verification, and brings you only the decisions that require you.

### Economic thesis

> **Cormidia expands management capacity without proportionally increasing
> management overhead.**

"Make middle management efficient" captures the internal thesis but should not
be the leading external phrase. The positive promise is greater management
capacity, faster and more reliable organizational execution, and more human
attention available for judgment and people.

### The customer problem in operational terms

Cormidia should be designed around recurring coordination failure modes:

- Executive intent degrades as it moves through layers.
- Ownership and the definition of completion remain ambiguous.
- Work waits at dependencies, reviews, approvals, and handoffs.
- Managers repeatedly ask for and reconstruct status.
- Decisions and their rationale disappear into meetings and messages.
- Reviews arrive late, conflict, or do not map to acceptance criteria.
- Failures, retries, and abandoned work are not represented truthfully.
- Cost is measured by tools and people rather than accepted outcomes.
- A person must remain the scheduler, reminder system, and exception router.

The product should turn that pattern into a durable operating loop:

```text
Management intent
  -> structured objective and policy
  -> executable plan and ownership
  -> agent or human work
  -> mechanical evidence
  -> independent review
  -> verified outcome or precise exception
  -> concise narrative and human decision queue
```

### What Cormidia handles and what remains human

| Cormidia handles | Human leaders and managers retain |
| --- | --- |
| Decomposition and routing | Strategic intent |
| Scheduling and dependency tracking | Prioritization and trade-offs |
| Routine follow-up | Judgment under ambiguity |
| Gate and policy enforcement | Accountability for material decisions |
| Evidence and status assembly | People leadership and coaching |
| Review coordination | Conflict resolution and organizational context |
| Cost and execution accounting | Customer relationships and trust |
| Exception detection and routing | Culture and organizational design |

The message is not that management disappears. It is that managers stop acting
as human message buses and spend more time on the work that requires human
judgment.

### Buyer-specific value

| Audience | Primary value |
| --- | --- |
| CEO/founder | Priorities progress reliably without constant personal follow-up |
| CFO | More accepted output per dollar, visible spend, and lower coordination overhead |
| CPO/product leader | Traceability from product intent through evidence to shipped outcome |
| CTO/CIO | Provider-neutral execution with enforceable quality, security, and authority |
| Engineering leader | Greater management span without losing visibility or control |
| Middle manager | Fewer status meetings, reminders, handoffs, and reconstruction exercises |

### The signature experience

One emotionally resonant question should organize the product:

> **What happened while I was away?**

Cormidia should answer with a concise, evidence-backed narrative:

- What outcome was requested?
- How was it interpreted and planned?
- What work was completed, by whom, and through which provider assignments?
- What tests, reviews, and other evidence support the result?
- What changed in the customer's systems?
- What did it cost?
- What failed or remains uncertain?
- Which exact decision, if any, now requires the human?

Producing that answer without another status meeting is not a reporting add-on;
it is proof that Cormidia maintained a coherent organizational process.

### Differentiation

| Category | Primary unit | What it does not provide by itself |
| --- | --- | --- |
| Coding agent | A technical session or task | Organization-wide authority, independent review, durable management loop |
| Model router | A model request | Ownership, evidence, workflow, or outcome accountability |
| Task manager | A recorded commitment | Autonomous progress and verified completion |
| Workflow engine | A predefined sequence | Adaptive judgment within governed policy |
| Cormidia | A governed organizational outcome | Human strategy, relationships, and material judgment |

Cormidia should integrate with coding agents, GitHub/GitLab, Jira or other
demand systems, communication channels, CI/CD, model gateways, and enterprise
identity rather than requiring customers to replace them. Its role is to make
those systems behave like one coherent organization.

### Claims to avoid

- "Replace your engineering managers."
- "Eliminate middle management."
- "Fully autonomous company."
- "No human involvement."
- "One AI employee that does everything."
- "Guaranteed productivity" without an outcome definition and evidence.

Prefer language about increasing management capacity, reducing coordination
latency, preserving intent, enforcing governance, and escalating genuine
decisions.

### Proof metrics

The value proposition becomes credible when Cormidia can measure:

- Human coordination minutes per verified outcome.
- Elapsed time waiting at handoffs versus active work.
- Time from stated goal to an accepted executable plan.
- Review and rework cycles per accepted outcome.
- Percentage of work reaching a truthful terminal state.
- Cost per accepted outcome, not merely tokens or agent sessions.
- Number, latency, and materiality of human escalations.
- Time required to answer what happened, why, and what comes next.
- Applications and concurrent work safely supported per human manager.

### Land-and-expand path

The broad category should not become a broad initial product claim. Prove the
value in a narrow, repeated software-management loop:

1. One bounded goal becomes a tested, independently reviewed PR.
2. The same app adopts multiple recurring delivery and operational workflows.
3. One organization operates multiple apps under shared authority and budget.
4. An enterprise operates multiple organizations with central policy and local
   responsibility boundaries.

The long-term vision is an enterprise management process that remains active,
inspectable, and coherent across devices, departments, repositories, tools,
and execution providers. The first sale is a single loop that works well enough
that a manager no longer wants to coordinate it manually.
