# Cormidia Onboarding Report — Cormidia

This report inventories existing documentation and setup signals. It does not infer product truth from source code.

Gaps are onboarding guidance, not blockers unless `.cormidia/config.yaml` or `.cormidia/policy.yaml` says so.

## Documentation Inventory

### Product / overview

- README.md
- docs/PURPOSE.md

### Architecture / decisions

- docs/architecture.md

### Specs / requirements

- None detected

### Operations / runbook

- None detected

### Agent / contributor docs

- AGENTS.md
- CLAUDE.md

### Testing / quality

- .github/workflows/core-checks.yml
- package.json

## Missing Recommended Categories

- Specs / requirements: Add specs, requirements, or acceptance-contract source documents.
- Operations / runbook: Add runbook, deploy, or operations docs before expecting autonomous operations.

## Setup Signals

- Build: pnpm run build (package.json scripts.build)
- Test: pnpm run test (package.json scripts.test)
- Lint: none detected
- CI: .github/workflows/core-checks.yml
- Deploy hints: none detected
- GitHub remote: cormidia/Cormidia

## Role Readiness Notes

- support (gap): Support is enabled but no support channels are declared; add channels or keep Support disabled until feedback exists.
- marketing (gap): Marketing is enabled but no marketing channels are declared; add channels or keep Marketing disabled until adoption/publishing channels exist.
- sre (warning): SRE is enabled but no operations/runbook docs, deploy commands, or deploy hints were detected.

## Delegated Operator Authority

- App selection: inherit
- Effective version: delegated-operator/v1+app-inherit/v1
- Effective SHA-256: 280df594080710f4e8df2764b66dc38d3778d7403123b21d66d552779c2e4962

### Automatic

- ordinary reversible decisions
- local edits and tests
- branches, tickets, and normal PR preparation
- ordinary token spend within configured budgets

### Human-gated

- publication or deployment
- secrets and credentials
- cloud, DNS, or infrastructure changes
- irreversible data loss
- merge when human merge is required
- genuinely material product decisions
