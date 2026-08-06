# Validation Technique Selection

Select evidence to address explicit claims and credible failure modes. Do not run every technique indiscriminately. For each selected technique, state:

- Claim or risk addressed.
- Why this technique is suitable.
- Environment and data required.
- Pass/fail oracle.
- Independence required.
- Evidence retained.
- Limitations and blind spots.

## 1. Foundation checks

These establish basic build and analysis integrity but are not sufficient by themselves.

### Build and packaging

Use to verify:

- The repository builds from a clean environment.
- Generated artifacts are complete and reproducible enough for the stated target.
- Packages install, start, and expose expected entry points.
- Build configuration does not silently vary across developer and CI environments.

Relevant checks:

- Clean build.
- Locked dependency resolution.
- Package installation into an empty environment.
- Artifact content inspection.
- Reproducible or provenance-attested build where required.
- Upgrade and uninstall behavior.

### Type checking and static analysis

Use to detect:

- Type and nullability violations.
- Resource and lifetime errors.
- Unsafe patterns.
- Taint or injection paths.
- Concurrency defects where supported.
- Policy violations.

Record rule set, version, suppressions, baseline findings, and whether new findings block release.

### Formatting and linting

Useful for consistency and selected defect patterns. Do not present formatting success as correctness evidence.

### Dependency and supply-chain analysis

Consider:

- Locked versions and integrity metadata.
- Known vulnerability scanning.
- License and policy checks where relevant.
- Unmaintained or abandoned packages.
- Transitive dependency inventory.
- Build-script and install-hook behavior.
- Dependency confusion and registry controls.
- Artifact signatures, provenance, and software bill of materials for higher-criticality systems.

A scanner result is time-bound. Record scan time and database freshness.

## 2. Functional correctness techniques

### Example-based unit tests

Best for:

- Localized logic with clear inputs and outputs.
- Regression cases.
- Explicit boundaries and error behavior.

Require meaningful assertions. Avoid tests that only assert that execution does not throw.

### Property-based tests

Best for:

- Broad input spaces.
- Algebraic or structural invariants.
- Parsers, serializers, numerical transforms, schedulers, allocators, and state transitions.

Useful properties include:

- Round-trip behavior.
- Idempotency.
- Monotonicity.
- Conservation.
- Ordering.
- Symmetry or equivalence.
- Invariance under irrelevant transformations.
- No invalid state reachable.

Ensure generators cover important partitions and shrink failures into actionable cases.

### Model-based testing

Best for:

- Stateful systems.
- Protocols.
- Workflows.
- Resource lifecycles.
- Distributed or concurrent state transitions.

Build a simpler reference model with independently specified transitions. Compare system behavior to the model across generated sequences.

### Differential testing

Best for:

- Reimplementations.
- Compilers, parsers, codecs, protocols, and algorithms with a trusted reference.
- Migration between versions or providers.

Do not use a reference that shares the same defect source without acknowledging reduced independence.

### Metamorphic testing

Best when a complete expected output is difficult to specify but relationships between outputs are known.

Examples:

- Reordering irrelevant inputs does not change the result.
- Scaling inputs changes output according to a known relationship.
- Adding a neutral element has no effect.

### Fuzzing

Best for:

- Parsers and protocol handlers.
- Input validation.
- Serialization.
- Security boundaries.
- Native code and memory-safety exposure.

Retain seeds, crashes, minimized reproductions, coverage strategy, run duration, and sanitizers used.

### Mutation testing or fault seeding

Use to establish whether tests detect realistic defects.

Apply especially to:

- Critical business rules.
- Authorization.
- Financial or data invariants.
- Error and recovery paths.
- Newly added tests whose sensitivity is otherwise uncertain.

Do not optimize solely for a mutation score. Review surviving mutations in high-criticality logic.

## 3. Interface and compatibility techniques

### API contract tests

Validate:

- Request and response schemas.
- Error contracts.
- Authentication and authorization behavior.
- Versioning and deprecation.
- Pagination, ordering, idempotency, and rate limits.
- Unknown fields and backward/forward compatibility.

Use provider and consumer perspectives when multiple independently released systems exist.

### Schema compatibility tests

For events, databases, files, and messages, test:

- Additive and breaking changes.
- Default values.
- Unknown fields.
- Older readers and newer writers.
- Newer readers and older writers.
- Replay of retained messages or files.

### CLI contract tests

Validate:

- Exit codes.
- stdout versus stderr.
- Stable machine-readable output.
- Help text and invalid arguments.
- Signals and cancellation.
- Interactive and non-interactive behavior.
- Shell quoting, paths, and platform differences.

### UI and accessibility validation

Select as relevant:

- Critical journey end-to-end tests.
- Keyboard-only navigation.
- Screen-reader semantics.
- Contrast and focus behavior.
- Error recovery and validation messages.
- Browser, viewport, locale, and time-zone behavior.
- Visual regression for important layout contracts.

Visual snapshots require semantic review; a changed snapshot is not self-justifying.

## 4. Data integrity and persistence

### Database constraints

Validate important invariants at the strongest practical layer:

- Uniqueness.
- Referential integrity.
- Check constraints.
- Transaction boundaries.
- Isolation behavior.
- Row-level security or tenancy enforcement.

Application tests do not replace database-level guarantees when concurrent writers exist.

### Migration testing

Include as required:

- Upgrade from each supported prior version.
- Large and representative data volumes.
- Nulls, malformed legacy data, and edge cases.
- Online migration behavior under concurrent traffic.
- Forward and backward compatibility during rolling deployment.
- Interrupted migration and resume behavior.
- Rollback or roll-forward strategy.
- Data reconciliation before and after.
- Time, lock, disk, and resource budgets.

Never run destructive migration tests against production without explicit authority and controlled procedures.

### Backup and restore

Evidence should show:

- Backup creation.
- Integrity verification.
- Restore into an isolated environment.
- Application usability after restore.
- Recovery point and recovery time achieved.
- Key, secret, and external dependency restoration.
- Reconciliation after restore.

A backup that has not been restored is an unverified recovery mechanism.

### Crash consistency and interruption

Test power loss, process termination, network loss, and partial writes where relevant. Verify no invalid or ambiguous state remains.

## 5. Security and abuse resistance

### Threat modeling

Identify:

- Assets.
- Adversaries.
- Entry points.
- Trust boundaries.
- Privileged operations.
- Abuse cases.
- Detection and response.

Trace mitigations to evidence. A threat model without validation is a hypothesis.

### Authentication and session validation

Test:

- Credential lifecycle.
- Session creation, expiration, revocation, and rotation.
- Replay and fixation resistance.
- Multi-factor and recovery paths where applicable.
- Error behavior that avoids information leakage.

### Authorization matrix

Create explicit subjects × resources × actions × conditions. Test allowed and denied paths, including:

- Cross-tenant access.
- Object identifier substitution.
- Role downgrade and privilege changes.
- Stale sessions and cached permissions.
- Batch and indirect access paths.
- Administrative and support impersonation.
- Background jobs and service identities.

Authorization tests should target the real policy enforcement path, not a mock.

### Input, injection, and output handling

Select based on attack surface:

- SQL, command, template, path, header, log, and deserialization injection.
- Cross-site scripting and request forgery.
- Server-side request forgery.
- File upload and archive extraction.
- Unicode and normalization issues.
- Resource exhaustion.

### Secret and credential handling

Validate:

- No secrets committed or logged.
- Rotation and revocation.
- Least privilege.
- Environment separation.
- Safe local development defaults.
- Failure behavior when secrets are absent or invalid.

### Dynamic and adversarial testing

Use controlled environments for:

- DAST.
- Penetration testing.
- Abuse-case automation.
- Rate-limit and quota bypass attempts.
- Privilege escalation attempts.

For C3 and C4, agent-generated adversarial testing does not replace appropriately independent specialist review when required.

## 6. Reliability and distributed behavior

### Retry and idempotency validation

Test:

- Duplicate requests.
- Timeout after success but before acknowledgment.
- Message redelivery.
- Client retry storms.
- Idempotency-key collision, expiration, and scope.
- Partial downstream success.

Verify the externally visible effect, not merely internal function calls.

### Concurrency testing

Use:

- Race detectors.
- Stress tests.
- Deterministic schedulers where available.
- Model checking for selected algorithms.
- Repeated interleavings.
- Database isolation tests.

Target lost updates, double execution, stale reads, deadlocks, livelocks, and ordering violations.

### Failure injection

Inject:

- Dependency timeout and error.
- Slow responses.
- Partial availability.
- Network partition.
- Process termination.
- Queue duplication or reordering.
- Disk full and read-only filesystem.
- Clock skew and time jumps.
- Expired credentials.
- Resource exhaustion.

Verify bounded failure, safe degradation, recovery, and observability.

### Soak and endurance testing

Use when leaks, fragmentation, queue accumulation, clock behavior, or long-lived state matter. Record duration, workload, resource trends, and exit criteria.

## 7. Performance and resource assurance

Tie tests to budgets, not vague speed expectations.

Consider:

- Latency distribution, not only averages.
- Throughput.
- Tail behavior.
- CPU, memory, disk, network, file descriptors, threads, GPU, and power.
- Queue depth and backpressure.
- Cold start and warm state.
- Dependency degradation.
- Load, stress, spike, and capacity boundaries.
- Worst-case execution or memory for real-time and mission-critical paths.

A performance test without representative workload, environment, and acceptance threshold is weak evidence.

## 8. Deployment, configuration, and operations

### Infrastructure and policy validation

Inspect and test:

- IAM and network boundaries.
- Encryption and key configuration.
- Public exposure.
- Environment drift.
- Resource limits.
- Region and redundancy assumptions.
- Policy-as-code where applicable.

### Deployment validation

Include:

- Clean deployment.
- Rolling or blue/green behavior.
- Mixed-version compatibility.
- Health checks.
- Readiness versus liveness.
- Failed deployment containment.
- Canary analysis.
- Rollback and roll-forward.
- Feature flag defaults and kill switches.

### Observability validation

Verify that important failures create:

- Actionable logs without sensitive data.
- Metrics and traces tied to user impact.
- Alerts with tested routing.
- Sufficient identifiers for reconciliation.
- Clear operator action.

Trigger representative failures and confirm the signal. Merely defining an alert is not evidence that it works.

### Runbook and recovery exercises

For material systems, execute tabletop or live exercises for:

- Dependency outage.
- Data corruption.
- Credential compromise.
- Region loss.
- Failed migration.
- Capacity exhaustion.
- Security incident.

Record actual recovery results and gaps.

## 9. Local developer and automation tools

For local tools, emphasize the actual powers of the tool rather than assuming low risk.

Test as relevant:

- Empty, large, malformed, and partially initialized repositories.
- Dirty working trees and untracked files.
- Symlinks, path traversal, unusual filenames, long paths, and permissions.
- Read-only filesystems and disk full.
- Interrupted operations and signals.
- Repeated invocation and idempotency.
- Backup or preview before destructive action.
- `--dry-run` correspondence to real execution.
- Shell and platform differences.
- Credential isolation and network egress.
- Commands generated by an AI agent.

A tool with root privileges, production credentials, or broad deletion capability may require C2 or C3 controls even if single-user.

## 10. Safety and mission-critical systems

Repository tests are only one evidence source. Depending on the system, consider:

- Hazard analysis with software contributions identified.
- Safety requirements and negative requirements.
- Fault-tree and failure-mode analysis.
- Fault containment and independence assumptions.
- Formal specification and proof for selected properties.
- Static resource bounds.
- Worst-case timing.
- Model-based and scenario-based simulation.
- Hardware-in-the-loop.
- Sensor fault, actuator fault, communication loss, and environmental extremes.
- Redundancy management and common-mode failures.
- Safe state and degraded modes.
- Operator procedures and human factors.
- Tool qualification or confidence arguments.
- Configuration item control and exact binary provenance.
- Independent verification and acceptance authority.

Do not claim mission readiness when hardware, operational, or hazard-control evidence is absent.

## 11. Evidence selection by criticality

### C0

Usually sufficient when justified:

- Clean build or launch.
- Focused unit or smoke tests.
- Central behavior demonstrated.
- Experimental labeling and containment.

### C1

Add as relevant:

- Real integration with filesystem, process, packaging, or local services.
- Negative, boundary, interruption, and cleanup tests.
- Destructive-operation guardrails.
- Cross-platform validation for supported platforms.
- Reproducible setup and CI.

### C2

Add as relevant:

- End-to-end critical journeys.
- Authorization and tenancy.
- Contract and compatibility tests.
- Persistent state, migration, backup, and restore.
- Concurrency, retries, dependency failure, and load.
- Deployment, rollback, observability, and security checks.
- Independent review of high-risk claims.

### C3

Add as relevant:

- Explicit threat/risk/privacy analysis.
- Strong independent verification.
- Adversarial testing.
- Failure injection and disaster exercises.
- Reconciliation and audit evidence.
- Controlled releases, evidence retention, and residual-risk authority.
- Formal or model-based methods for selected critical invariants.

### C4

Add system-level evidence:

- Hazard controls and traceability.
- Independent V&V.
- Formal, simulation, timing/resource, fault-injection, hardware, and operational evidence as required.
- Controlled configuration and acceptance authority.

## 12. Technique rejection questions

Before adding a check, ask:

- Which claim or risk does this address?
- Would a meaningful defect cause it to fail?
- Is the oracle independent enough?
- Does it exercise the relevant boundary or only a mock?
- Is the environment representative enough for the claim?
- Will it run reliably and be enforced?
- Is a cheaper or stronger technique available?
- What blind spot remains after it passes?

If these cannot be answered, the check may be activity without assurance.
