# Operon boundary contract registry

Status: **Phase 4 ratified — 2026-07-29**

Last updated: 2026-07-29

These files define the product-level promise across every ratified boundary.
Each contract contains:

1. valid and invalid input behavior;
2. output guarantees;
3. typed error and recovery behavior;
4. idempotency and retry semantics; and
5. timing, ordering, and freshness guarantees.

Unknown expected behavior is marked `OPEN`; it is not silently supplied.
`[stated]`, `[doc]`, and `[PROPOSED]` retain their meanings from the system and
boundary maps.

| Contract | Boundary | Maturity |
| --- | --- | --- |
| [OPERON-BND-001](./operon-bnd-001-installed-schema.md) | Installed implementation ↔ persisted schema estate | current + planned npm evolution |
| [OPERON-BND-002](./operon-bnd-002-org-isolation.md) | Shared installation/selector ↔ isolated org scope | current |
| [OPERON-BND-003](./operon-bnd-003-org-app.md) | Org governance/configuration ↔ app-owned product state | current |
| [OPERON-BND-004](./operon-bnd-004-durable-state.md) | Orchestrator process ↔ local durable state/worktrees/sessions | current + open recovery semantics |
| [OPERON-BND-005](./operon-bnd-005-scheduler.md) | Host clock/scheduler/process manager ↔ dispatcher | current |
| [OPERON-BND-006](./operon-bnd-006-human-approval.md) | Autonomous work ↔ human decision availability | current + open backlog policy |
| [OPERON-BND-007](./operon-bnd-007-provider-runtime.md) | Runtime envelope ↔ harness/model/auth/quota | current + planned failover/auth evolution |
| [OPERON-BND-008](./operon-bnd-008-host-tools.md) | Runtime envelope ↔ host tools/subprocess effects | current |
| [OPERON-BND-009](./operon-bnd-009-github.md) | Local orchestration state ↔ GitHub | current |
| [OPERON-BND-010](./operon-bnd-010-verification.md) | Artifact workflow ↔ CI/lab/verification systems | mixed by product profile |
| [OPERON-BND-011](./operon-bnd-011-external-effects.md) | Effect executor ↔ deployment/publication target | mixed by effect type |
| [OPERON-BND-012](./operon-bnd-012-learning-activation.md) | Learning governance/publisher ↔ active resolver | current |
| [OPERON-BND-013](./operon-bnd-013-observability.md) | Workflow state owners ↔ read-only projections | current |
| [OPERON-BND-014](./operon-bnd-014-intake.md) | External demand collectors ↔ Operon intake | file-drop current; connectors planned |
| [OPERON-BND-015](./operon-bnd-015-package-registry.md) | Package registry/distribution ↔ installed package | planned |
| [OPERON-BND-016](./operon-bnd-016-release-org-isolation.md) | Platform release control plane ↔ operated organization | current separation |

Companion Phase-4 artifacts:

- [Journey acceptance criteria](./journey-acceptance.md)
- [Interface conformance obligations](./interface-conformance.md)

Layer 1 checks one side honoring its contract. Layer 2 composes the real Operon
side with the controlled seam defined here and in `../boundary-map.md`.
Retained Layer-3 obligations remain separately authorized and bounded.
