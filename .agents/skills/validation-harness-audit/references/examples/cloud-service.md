# Example: Multi-Tenant Cloud Service

## Scenario

A public SaaS service stores persistent customer data, exposes an API and web application, runs background jobs, and deploys through infrastructure-as-code.

## Criticality profile

- System level: `C2 Production`.
- Higher-criticality components:
  - Authentication and tenant authorization: `C3` because failure can expose customer data broadly.
  - Billing and credits: `C3` if balances or charges are material.
  - Database migrations and backup/restore: `C3` where data loss is difficult to reverse.
  - Marketing pages: `C0` or `C1`.
- Change criticality:
  - CSS spacing: `L0`.
  - New API field: `L1` or `L2` depending on compatibility.
  - Authorization policy, schema migration, or retry semantics: `L3`.

## Assurance target

> Sufficient evidence for multi-tenant production operation with persistent customer data in the documented cloud environment, under the specified identity, deployment, monitoring, backup, and recovery controls.

## Important claims

- A tenant cannot read or mutate another tenant’s data through any interface or background path.
- Authentication, session, and credential lifecycle behave as documented.
- Retried requests and redelivered jobs do not duplicate consequential effects.
- Supported clients remain compatible through rolling deployment.
- Schema migrations preserve data and support the documented rollback or roll-forward plan.
- Backups can be restored within the stated recovery objectives.
- Dependency failure produces bounded degradation rather than cascading failure.
- Deployment health checks, canary controls, and rollback operate correctly.
- Material failures generate actionable, non-sensitive telemetry and alerts.
- Rate, resource, and abuse controls constrain blast radius.

## Proportionate validation plan

- Build, type, static analysis, dependency, and secret checks.
- Unit/property tests for rules and invariants.
- API and event contract tests.
- Real database integration tests with row-level and transaction behavior.
- Explicit authorization matrix with negative cross-tenant cases.
- End-to-end tests for selected critical journeys.
- Concurrency, retry, idempotency, and message-redelivery tests.
- Migration tests from supported prior versions under representative data volume.
- Backup creation and isolated restore exercise.
- Load, stress, resource, and dependency-failure tests.
- Infrastructure and IAM policy validation.
- Staged deployment and rollback exercise.
- Alert-routing and runbook validation.
- Independent adversarial review of authorization, data integrity, and recovery evidence.

## Insufficient evidence patterns

- High line coverage but no cross-tenant negative tests.
- A backup job that has never been restored.
- Migration tests only against an empty database.
- Authorization mocked in application tests.
- Deployment configuration excluded from the review.
- Alerts defined but never triggered.

## Verdict example

> Evidence is insufficient for the stated production target because tenant isolation for background export jobs and recovery from the latest schema migration remain unverified. The application-level functional suite is otherwise adequate for the inspected revision.
