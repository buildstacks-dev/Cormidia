# Criticality Model

Use this model before designing validation. The purpose is not to assign a decorative label. It is to determine the claims, evidence strength, independence, environment, and release authority required for the intended use.

## 1. Define the intended use before assigning criticality

Record:

- Primary users and operators.
- Permitted use cases.
- Explicitly excluded uses.
- Deployment environment.
- Data handled and data lifetime.
- Systems, people, assets, or physical processes the software can affect.
- Whether actions are advisory, human-approved, or autonomous.
- Expected scale and exposure.
- Required uptime and recovery time.
- How updates, rollback, and emergency shutdown work.

Criticality is scoped to an intended use. The same repository can support multiple assurance targets.

Example:

- A migration utility used against disposable fixtures may be C1.
- The same utility used against the only production copy of customer data may be C3.

## 2. Establish the system boundary

Identify what must work together for the assurance claim to be true:

- Application code.
- Libraries and runtime.
- Infrastructure and identity configuration.
- Databases, queues, storage, and caches.
- External APIs and third-party services.
- Build, release, deployment, rollback, and update channels.
- Monitoring and alerting.
- Human operators, approvals, and runbooks.
- Hardware, sensors, actuators, communications, or ground systems.
- Model providers, prompts, tools, retrieval stores, and policy enforcement for AI systems.

Mark each element as:

- `in_scope_inspected`
- `in_scope_unavailable`
- `external_assumed`
- `out_of_scope`

An out-of-scope element can still be an assumption or residual risk. Exclusion from review does not eliminate its influence on system assurance.

## 3. Evaluate the criticality dimensions

Use qualitative ratings from `negligible`, `low`, `moderate`, `high`, to `catastrophic`. Do not mechanically average them.

### 3.1 Safety and physical consequence

Ask:

- Can failure injure or kill a person?
- Can it damage equipment, infrastructure, or the environment?
- Can it cause an unsafe human decision by presenting incorrect information as reliable?
- Can it actuate physical systems directly or indirectly?

### 3.2 Mission or operational consequence

Ask:

- Can failure cause loss of mission, irrecoverable opportunity, or inability to complete a critical operation?
- Is the environment inaccessible after deployment?
- Can the system be repaired or patched in time?
- Are there single points of failure?

### 3.3 Financial and legal consequence

Ask:

- Can failure create unauthorized transfers, incorrect balances, penalties, or material loss?
- Can it create contractual, regulatory, or reporting violations?
- Could one defect affect many transactions or customers before detection?

### 3.4 Security and privacy consequence

Ask:

- What privileges does the software hold?
- Can failure disclose, corrupt, or destroy sensitive data?
- Is the system multi-tenant?
- Can compromise become lateral movement into other systems?
- Can the system issue credentials, execute code, or change infrastructure?

### 3.5 Data integrity and reversibility

Ask:

- Is the data disposable, reproducible, backed up, or irreplaceable?
- Can every operation be undone completely?
- Are there irreversible external effects?
- Is rollback tested rather than merely documented?
- Can a partial operation leave ambiguous state?

### 3.6 Availability and continuity

Ask:

- What happens during outage or severe degradation?
- Is downtime inconvenient, financially material, operationally dangerous, or mission-ending?
- What recovery time and recovery point are required?
- Are degraded modes safe and useful?

### 3.7 Exposure and blast radius

Ask:

- How many users, tenants, devices, accounts, transactions, or physical assets can be affected?
- Can one event propagate across regions or customers?
- Are there rate limits, quotas, tenancy boundaries, and containment cells?
- Does the system have broad default access?

### 3.8 Detectability

Ask:

- Would failure be detected immediately, eventually, or possibly never?
- Are errors silent?
- Can incorrect outputs appear plausible?
- Are logs, metrics, reconciliation, and alerts independently checked?

Low detectability raises required assurance even when immediate impact appears moderate.

### 3.9 Recoverability

Ask:

- Can operators stop the system quickly?
- Is there a tested rollback or failover path?
- Can state be reconciled after partial failure?
- Can the system be restored without creating new harm?
- Is recovery dependent on unavailable specialists or undocumented knowledge?

### 3.10 Privilege and autonomy

Ask:

- Does the system run as root, administrator, or a highly privileged service account?
- Can it execute arbitrary code, delete data, modify infrastructure, approve transactions, or communicate externally?
- Does a human approve consequential actions?
- Are permissions scoped per action and per environment?
- Can an AI or automation chain invoke tools recursively?

High privilege or autonomy raises assurance needs even for local tools.

### 3.11 Novelty and uncertainty

Ask:

- Is the architecture well understood?
- Are algorithms, dependencies, hardware, or operating conditions novel?
- Are requirements stable and testable?
- Is historical failure data available?
- Does behavior depend on nondeterministic models or emergent interactions?

Novelty raises the amount of exploratory, adversarial, and system-level evidence required.

### 3.12 Patchability and lifetime

Ask:

- Can the system be updated continuously?
- Is deployment remote, intermittent, regulated, or inaccessible?
- How long must the version operate without intervention?
- Can a failed update itself create harm?

Low patchability raises pre-release assurance requirements.

## 4. Assign the system level

### C0 — Experimental

Typical characteristics:

- Disposable or synthetic data.
- No consequential users.
- No meaningful privilege or irreversible effects.
- Failure is obvious and cheaply recoverable.
- Explicitly not used for production decisions.

Minimum posture:

- Build or launch validation.
- Focused tests for the experiment’s central behavior.
- Basic smoke checks.
- Clear experimental labeling.
- Guardrails against accidental use on consequential systems.

### C1 — Limited

Typical characteristics:

- Local developer or bounded internal use.
- Limited user population.
- Reversible operations and recoverable data.
- Moderate privilege or destructive capability may exist but is contained.
- Downtime or defects cause inconvenience or bounded loss.

Minimum posture commonly includes:

- Deterministic build and test path.
- Real filesystem, process, network, or packaging integration where relevant.
- Input validation and negative cases.
- Safe cancellation, interruption, retry, and cleanup.
- Guardrails around destructive operations.
- Credential and secret handling.
- Platform compatibility for claimed environments.
- Reproducibility outside one developer machine.

### C2 — Production

Typical characteristics:

- External users or material internal operations.
- Persistent customer or business data.
- Multi-user or multi-tenant behavior.
- Material security, reliability, compatibility, or financial consequence.
- Continuous operations and controlled releases.

Minimum posture commonly includes:

- Authentication and authorization validation.
- Tenant and data isolation.
- API and compatibility contracts.
- Migration, rollback, backup, and restore evidence.
- Concurrency, retries, idempotency, and dependency failures.
- Load, stress, and resource behavior.
- Security analysis and supply-chain checks.
- Deployment, canary, rollback, and configuration validation.
- Observability and alert validation.
- Incident and recovery procedures.

### C3 — High-consequence

Typical characteristics:

- Serious financial, privacy, health, legal, regulatory, infrastructure, or broad operational harm.
- High-value privileges or large blast radius.
- Delayed detection or difficult recovery.
- Strong audit and accountability expectations.

Minimum posture commonly includes:

- Formal risk, threat, privacy, or hazard analysis appropriate to the domain.
- Explicit critical invariants and negative requirements.
- Stronger separation of duties and independent verification.
- Adversarial and abuse-case testing.
- Reconciliation and auditability.
- Disaster-recovery exercises and failure injection.
- Strict configuration, dependency, release, and evidence control.
- Compensating operational controls for unresolved software risk.
- Named authority for residual-risk acceptance.

### C4 — Safety/Mission-critical

Typical characteristics:

- Credible risk of injury, loss of life, environmental harm, catastrophic physical damage, or loss of mission.
- Inaccessible or hard-to-repair deployment.
- Real-time, resource, hardware, or fault-tolerance constraints.
- Failure prevention and containment are more important than ordinary rollback.

Repository evidence alone is insufficient. The assurance case may require:

- Hazard analysis and hazard-control traceability.
- Failure-mode and fault-tree analysis.
- Independent verification and validation.
- Formal specification or verification for selected critical properties.
- Model-based testing and simulation.
- Worst-case execution, timing, memory, power, and resource analysis.
- Fault injection and fault-containment evidence.
- Hardware-in-the-loop and environmental tests.
- Redundancy, fail-safe, degraded-mode, and recovery validation.
- Human-factors and operational procedure validation.
- Controlled tools, artifacts, configuration, provenance, and acceptance authority.

Do not issue a C4 system-readiness verdict from a code repository alone.

## 5. Classify components separately

For each component, record:

- Function.
- Trust boundary.
- Data and privileges.
- Failure propagation.
- Containment mechanisms.
- Worst credible consequence.
- Assigned level.
- Required evidence.

Examples:

- Marketing page: C0 or C1.
- Preference UI: C1.
- Authentication service: C2 or C3.
- Billing ledger: C3.
- Infrastructure controller: C3.
- Spacecraft attitude-control loop: C4.
- Ground documentation generator: C1.

A component may be assigned below the system level only when failure containment is credible and evidenced.

## 6. Classify the current change

Evaluate:

- Files and components touched.
- Interfaces or schemas changed.
- State or migration effects.
- Privilege or authorization effects.
- Concurrency or timing effects.
- Dependency changes.
- Deployment/configuration changes.
- Test and observability changes.
- Blast radius and rollback.

Change classes:

- `L0 Trivial`: text, comments, or presentation with no behavior or interface impact.
- `L1 Bounded`: localized behavior with strong containment and easy rollback.
- `L2 Material`: public behavior, persistent state, integrations, or operational behavior.
- `L3 Critical`: security boundaries, financial/data invariants, infrastructure control, safety functions, major architecture, or hard-to-reverse migrations.

The current validation plan must satisfy the system floor and add checks required by component and change criticality.

## 7. Rules that prevent under-classification

- Do not lower criticality because the team is small.
- Do not lower criticality because the system is “internal.”
- Do not lower criticality because few users exist when one failure can be catastrophic.
- Do not lower criticality because backups are documented; require restore evidence.
- Do not lower criticality because a human is nominally in the loop; validate that the human can understand, intervene, and stop the action.
- Do not lower criticality because the service is local; inspect privilege and destructive capability.
- Do not lower criticality because the software is open source or free.
- Do not lower criticality because a deadline exists.

## 8. Legitimate ways to reduce the assurance target

Risk may be reduced by changing the system, not by changing the label. Examples:

- Use synthetic or disposable data.
- Make operations read-only.
- Require explicit human approval.
- Limit privileges and network egress.
- Add sandboxing and resource quotas.
- Limit users, tenants, transaction value, or geographic scope.
- Add canaries, circuit breakers, rate limits, and kill switches.
- Make operations idempotent and reversible.
- Add redundancy, reconciliation, monitoring, and rollback.
- Isolate high-risk components.
- Remove physical actuation.

Record the control and evidence that it actually constrains the failure.

## 9. Assurance target template

Write the target as:

> For revision `<revision>`, in `<environment>`, the available evidence is intended to establish that `<system/component>` is suitable for `<permitted use>` at criticality `<level>`, subject to `<controls and assumptions>`, excluding `<explicit exclusions>`.

Then name the acceptance authority and residual-risk owner.
