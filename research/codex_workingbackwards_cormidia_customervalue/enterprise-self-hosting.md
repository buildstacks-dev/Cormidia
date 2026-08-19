# Enterprise self-hosting

*Working-backwards research draft — 2026-08-17. Exploratory only: this record
does not amend `docs/PURPOSE.md` or any other human-ratified product surface.
It was developed fresh from the current SaaS and customer-value discussion,
without inheriting prior documented GTM conclusions.*

## Problem statement

An enterprise may want Cormidia's continuously available organizational
control plane while refusing to let source code, build artifacts, secrets,
model traffic, or privileged tool execution enter a shared vendor environment.
Different enterprises will draw that boundary in different places. A startup
may prefer a completely managed service; a regulated company may permit a
cloud control plane but require execution inside its network; a highly
sensitive customer may require a dedicated region, private tenant, or fully
disconnected operation.

"Self-hosted" is therefore too imprecise to be one product checkbox. It can
mean customer-hosted execution, a customer-owned cloud account, a dedicated
Cormidia-managed tenant, a privately deployed control plane, or an air-gapped
system. Each has different security, upgrade, support, and economic
consequences.

The product decision is how to offer credible enterprise control without
forking Cormidia into unrelated cloud and on-premise products or making the
least common denominator define the self-serve experience.

## Options considered

### 1. Multi-tenant Cormidia Cloud only

All customers use the same managed control plane and Cormidia-managed execution
environment, with logical tenant isolation.

**Advantages**

- Simplest product and operating model.
- Fast upgrades and consistent observability.
- Lowest support matrix.
- Best self-serve experience.

**Disadvantages**

- Excludes customers whose code, secrets, or execution cannot enter a shared
  environment.
- Makes Cormidia responsible for the complete code-execution attack surface.
- Regionality and private-network access become difficult.
- A broad "trust us" boundary conflicts with least-privilege enterprise
  procurement.

### 2. Dedicated Cormidia-managed tenant

Cormidia operates a single-tenant control plane and execution environment for
the customer, potentially in a dedicated region or VPC connected to the
customer network.

**Advantages**

- Stronger isolation without transferring operations to the customer.
- Supports private connectivity, contractual residency, and tenant-specific
  controls.
- Preserves managed upgrades and support visibility.

**Disadvantages**

- Higher infrastructure and operational cost.
- Cormidia still processes customer code and execution traffic.
- Tenant-specific drift can erode the one-product model.
- Not sufficient for customers that require execution entirely within their
  own boundary.

### 3. Managed control plane with customer-hosted execution

Cormidia Cloud coordinates work, but a signed runner executes inside the
customer's laptop, CI, VPC, Kubernetes cluster, or other governed environment.
The customer controls repository credentials, network reachability, model
endpoints, and execution isolation.

**Advantages**

- Keeps code execution and privileged access within the customer's existing
  security boundary.
- Preserves Cormidia's managed user experience, organizational view, and rapid
  control-plane upgrades.
- Uses the same runner protocol for local, CI, and enterprise deployments.
- Aligns with enterprises that already govern runners, containers, model
  gateways, secrets, and observability.

**Disadvantages**

- Requires a carefully versioned, fail-closed control-plane/runner protocol.
- The customer owns runner availability, capacity, patching, and some
  troubleshooting.
- Metadata and evidence sent to the control plane must be precisely documented
  and configurable.
- Offline operation is limited unless the control plane is also deployed
  privately.

### 4. Fully customer-hosted or air-gapped Cormidia

The customer operates the control plane, runners, persistence, model access,
and observability within its own environment.

**Advantages**

- Maximum data and network control.
- Can serve disconnected, classified, or highly regulated environments.
- No runtime dependency on Cormidia Cloud when genuinely air-gapped.

**Disadvantages**

- Creates a distribution, installation, migration, support, and security-patch
  product in addition to the SaaS.
- Version fragmentation weakens reliability and complicates incident response.
- Customer environments may make reproducibility and support materially
  harder.
- It is expensive to build before real customers prove the need and willingness
  to pay.
- Shipping the entire control plane increases reverse-engineering exposure,
  even if the software remains proprietary.

## Recommendation

Treat enterprise deployment as a **graduated boundary**, not a binary choice
between SaaS and self-hosting.

The recommended order is:

1. **Default SaaS:** multi-tenant managed control plane with managed or local
   execution for individuals and self-serve teams.
2. **Primary enterprise offer:** managed control plane with customer-hosted
   execution and customer-selected model gateways.
3. **Strategic enterprise offer:** dedicated Cormidia-managed control plane,
   dedicated execution, private networking, and regional placement.
4. **Demand-gated future offer:** fully customer-hosted or air-gapped control
   plane after a design partner supplies concrete requirements and an economic
   commitment.

This sequence keeps one logical product while allowing the data boundary to
move. The same typed plans, authority rules, action records, evidence formats,
and runner protocol should apply in every deployment.

### Recommended enterprise topology

| Component | Default enterprise location | Customer control |
| --- | --- | --- |
| Identity and enterprise policy | Cormidia Cloud or dedicated tenant | SSO/SCIM, role and policy administration |
| Org/app configuration | Managed control plane | Inspect, change under authority, export |
| Scheduling and coordination | Managed control plane | Budgets, concurrency, provider and approval policy |
| Source code and delivery artifacts | Customer GitHub/GitLab | Repository and branch permissions |
| Agent execution | Customer runner by default | Host, sandbox, network, capacity, lifecycle |
| Model traffic | Customer-approved provider or gateway | Credentials, allowlist, retention terms |
| Secrets | Customer vault where possible | Issuance, rotation, revocation, audit |
| Evidence and audit | Policy-selected cloud metadata and customer export | Retention, SIEM/OTEL destination, content controls |

No enterprise claim should use a vague phrase such as "your data stays in your
environment." Cormidia must publish an exact data-flow matrix covering source
files, prompts, tool results, model traffic, logs, artifacts, credentials,
identifiers, billing events, support access, backups, and retention for each
deployment pattern.

### Enterprise policy hierarchy

The long-term enterprise model should be hierarchical:

```text
Enterprise policy
  -> organization policy and budget
    -> application policy and integrations
      -> episode plan and turn assignment
        -> individual action grant
```

Children may tighten parent policy but may not silently broaden it. An
organization should represent a real authority, budget, data, or operational
boundary. Applications inherit that boundary while retaining repository-
specific knowledge and delivery rules.

This lets a large customer operate multiple Cormidia organizations and many
applications without losing central controls over allowed providers, spend,
identity, release authority, audit retention, and prohibited actions.

### Runner requirements

Customer-hosted execution is credible only if the runner is a product rather
than an installation script. It needs:

- Signed, versioned releases with a declared support window.
- Outbound-only connection where practical; no standing inbound port.
- Short-lived, least-privilege identity bound to an org, app, and execution.
- Content-bound plans and action grants that are revalidated at execution time.
- Idempotent event delivery and explicit handling of duplicates and reconnects.
- Fail-closed behavior under version mismatch, lost control-plane contact, or
  unprovable policy.
- Customer-controlled filesystem, network, secret, and model-gateway policy.
- Verifiable evidence upload with configurable content redaction.
- Export to the customer's observability and security systems.
- A diagnostic bundle that does not leak code or secrets to Cormidia support.

### Commercial implications

Enterprise pricing should reflect isolation and operational responsibility,
not merely seats:

- Platform commitment based on governed organizations, applications, or
  autonomous capacity.
- Additional charge for dedicated control-plane infrastructure and regions.
- Usage pricing for Cormidia-managed compute and model traffic.
- Support and upgrade obligations for customer-hosted runners.
- A separate, materially higher contract for fully private or air-gapped
  control-plane deployment.

Full self-hosting should not be offered merely to complete a pricing table. It
should follow proven demand from customers whose requirements cannot be met by
customer-hosted execution or a dedicated managed tenant.

### Questions to validate with enterprise design partners

- Which data categories are prohibited from leaving the customer boundary?
- Is cloud-hosted coordination acceptable if code and prompts remain inside?
- Must model traffic use a customer gateway or customer-owned provider account?
- Are customer-managed runners already an approved operational pattern?
- Which identity, audit, SIEM, secrets, and private-network integrations are
  mandatory for a pilot?
- What availability and support responsibility will the customer accept for
  its runners?
- Is a dedicated vendor-managed tenant acceptable, and at what price?
- Is full air-gap a real procurement requirement or a theoretical preference?
- What export and exit guarantees are required to avoid unacceptable lock-in?

## Point-in-time external references

Accessed 2026-08-17:

- [Devin enterprise deployment](https://docs.devin.ai/enterprise/deployment/overview)
- [Cursor self-hosted cloud agents](https://cursor.com/blog/self-hosted-cloud-agents)
- [Factory enterprise overview](https://docs.factory.ai/enterprise)
- [Factory deployment patterns](https://docs.factory.ai/enterprise/network-and-deployment)
- [Factory data flows and privacy](https://docs.factory.ai/enterprise/privacy-and-data-flows)
