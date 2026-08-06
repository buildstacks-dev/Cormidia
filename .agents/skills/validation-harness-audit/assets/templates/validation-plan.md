# Validation Plan

Assessment: `{{ASSESSMENT_ID}}`  
Revision: `{{TARGET_REVISION}}`

## Assurance target

Quote the scoped assurance target.

## Prioritization rationale

Explain how system, component, and change criticality determine the order and depth of validation.

## Environments and test data

Define clean environment, dependencies, synthetic/representative data, credentials, hardware, and external-system controls.

## Mandatory release-blocking gates

| Gate ID | Claim / risk | Technique | Environment | Oracle | Independence | Entry criteria | Pass criteria | Evidence retained |
|---|---|---|---|---|---|---|---|---|
| GATE-001 |  |  |  |  |  |  |  |  |

## Conditional gates

List checks triggered by selected components, changes, platforms, deployment modes, or failure risks.

## Advisory checks

List useful checks that do not determine the current assurance target.

## Holdout and adversarial validation

Define protected scenarios, ownership, access, and how results will be reported without contaminating the holdout.

## Hardening work

For each planned change, classify as validation-only, testability refactor, defect correction, or behavioral change.

## Flake, skip, and exception policy

Define handling, owners, expiry, alternate evidence, and release impact.

## Stop and escalation criteria

Define unsafe actions, missing evidence, failed gates, contradictory requirements, and authority decisions that stop or narrow the assessment.

## Completion criteria

List the exact conditions for issuing each possible verdict.
