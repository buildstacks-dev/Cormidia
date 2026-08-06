# Evidence, Traceability, and Verdicts

This reference defines how to turn validation activity into a defensible assurance conclusion.

## 1. Evidence principles

### Evidence must support a claim

Every retained result should answer:

- What claim or risk does this address?
- What revision and environment was tested?
- What exactly was executed or inspected?
- What was the oracle?
- What passed, failed, or remained unavailable?
- What limitations remain?

A large collection of logs without traceability is not an assurance case.

### Evidence must be attributable

Record:

- Repository and revision.
- Dirty-tree status.
- Date and time.
- Tool and version.
- Command or procedure.
- Environment identifier.
- Input data or seed.
- Exit code and relevant output.
- Artifact location or immutable CI link.
- Reviewer or agent role.

### Evidence must be reproducible or explicitly non-reproducible

Another reviewer should be able to repeat the result. When exact reproduction is impossible, explain why and preserve enough provenance to assess the result.

### Evidence freshness is contextual

A static-analysis result, dependency scan, penetration test, recovery drill, or hardware campaign has a validity window. State what changes would invalidate it.

### Evidence independence matters

Record whether the evidence was:

- Produced by the implementer.
- Produced by a role-separated pass of the same agent.
- Produced by a separate agent with fresh context.
- Produced by a separate human or team.
- Produced by an external qualified party.

Do not describe role separation as organizational independence.

## 2. Evidence classes

Use one or more of these labels:

- `requirement`: approved statement of intended behavior.
- `analysis`: static, formal, architectural, threat, hazard, or resource analysis.
- `test`: executable functional or nonfunctional check.
- `inspection`: source, configuration, artifact, or procedure review.
- `simulation`: model or simulated-environment evidence.
- `operational_exercise`: deployment, rollback, restore, failover, or incident exercise.
- `production_observation`: monitored real-world behavior, used carefully because absence of observed failure is not proof of correctness.
- `process_control`: CI gate, approval, configuration management, or release control.
- `external_assurance`: specialist or independent assessment.

High-criticality claims usually require more than one evidence class.

## 3. Claim status

### `verified`

Use only when:

- The claim is clear.
- Evidence is directly relevant.
- The oracle is sufficiently independent.
- The environment and scope match the assurance target.
- Known limitations do not undermine the claim.
- Required independence is satisfied.

### `partially_verified`

Use when evidence supports only part of the claim, such as:

- One platform but not all supported platforms.
- Unit behavior but not the real integration.
- Normal conditions but not failure recovery.
- Current schema but not supported upgrades.
- Code behavior but not deployment configuration.

State the verified and unverified portions separately.

### `not_verified`

Use when:

- No evidence exists.
- Existing evidence is too weak.
- A test does not exercise the relevant boundary.
- The required environment was not available.
- A mandatory gate failed.

### `blocked`

Use when validation could not proceed because of missing access, unsafe execution, contradictory requirements, unavailable hardware, missing credentials, or another external blocker.

A blocked claim is not a passing claim.

### `unknown`

Use when the intended behavior, oracle, system boundary, or consequence is unresolved.

### `not_applicable`

Use only with rationale showing why the claim or technique does not apply to the stated target.

## 4. Traceability structure

Maintain this chain:

```text
Intended use / hazard / requirement
  -> assurance claim
    -> risk or failure mode
      -> validation method
        -> concrete check or analysis
          -> execution evidence
            -> result and limitation
              -> residual risk and disposition
```

Each critical claim should have stable identifiers, for example:

- `CLM-AUTHZ-001`
- `CLM-DATA-004`
- `CLM-RECOVERY-002`

Each finding and test should reference the relevant claim IDs.

## 5. Findings severity

Use consequence and assurance impact, not code aesthetics alone.

### `BLOCKER`

A critical claim required for the stated target is false, failed, unknown, or unverified, and no adequate compensating control exists.

Examples:

- Cross-tenant data access is possible.
- Destructive migration lacks a recoverable path.
- A C4 safety requirement has no system-level evidence.
- Required build or validation cannot be reproduced.

### `HIGH`

A serious failure mode is credible, or evidence for a critical claim is substantially inadequate.

### `MEDIUM`

Material defect or validation weakness with bounded consequence or effective containment.

### `LOW`

Limited impact, defense-in-depth improvement, maintainability issue, or noncritical evidence weakness.

### `NOTE`

Context, assumption, improvement opportunity, or observation not currently treated as a defect.

Do not derive severity from scanner labels without mapping to the actual system context.

## 6. Overall verdicts

### `SUFFICIENT_FOR_STATED_TARGET`

Use when:

- The assurance target is explicit.
- All mandatory claims are verified at the required strength.
- Required gates pass on the target revision.
- Required independence is satisfied.
- Residual risks are within the defined acceptance envelope.
- No unresolved blocker contradicts the target.

This is not a claim of absolute correctness.

### `CONDITIONALLY_SUFFICIENT_FOR_STATED_TARGET`

Use only when:

- The remaining conditions are explicit, bounded, and enforceable.
- Each condition has an owner and completion or expiry criterion.
- The target use is restricted until conditions are met.
- No condition conceals an unaccepted catastrophic risk.

Examples:

- Limited rollout to one internal tenant while restore testing completes.
- Read-only operation until a write-path authorization check is verified.

### `INSUFFICIENT_FOR_STATED_TARGET`

Use when:

- A mandatory claim is not verified.
- A release-blocking gate fails.
- The system boundary omits material operational evidence.
- The criticality level requires stronger independence or system evidence than available.
- Residual risk exceeds the target.

This verdict can coexist with useful progress and a detailed remediation plan.

### `BLOCKED_FROM_ASSESSMENT`

Use when the reviewer cannot determine sufficiency because core prerequisites are missing, unsafe, contradictory, or inaccessible.

State what can still be concluded at a narrower level.

## 7. Prohibited conclusion patterns

Do not write:

- “All tests passed, therefore the system is correct.”
- “Coverage is 95%, therefore validation is strong.”
- “No vulnerabilities were found, therefore the system is secure.”
- “The code looks clean, therefore it is production ready.”
- “The backup job succeeded, therefore recovery is verified.”
- “The simulation passed, therefore the hardware system is safe.”
- “The agent reviewed its own changes, therefore verification is independent.”

Replace them with scoped statements tied to evidence and limitations.

## 8. Required release-assessment structure

### Header

- Verdict.
- Target revision.
- Intended use.
- Environment.
- System/component/change criticality.
- Review mode.
- Reviewer and independence level.

### Assurance target

Quote the exact scoped target.

### Basis for verdict

List the most important verified claims and evidence classes.

### Blocking or conditional items

For each item:

- Claim ID.
- Finding ID.
- Consequence.
- Required action.
- Owner.
- Verification required.
- Deadline or release condition.

### Residual risk

List:

- Risk.
- Control.
- Evidence for the control.
- Remaining uncertainty.
- Acceptance authority.

### Scope limitations

Name unavailable systems, environments, data, hardware, procedures, or external services.

### Plain-language restatements

For the verdict, each blocking or conditional item, and each residual risk, add a one- or two-sentence restatement free of assurance jargon, addressed to the acceptance authority: what it means, what could happen, and what they are being asked to accept or decide. Acceptance is only meaningful when the accepter understands what they are accepting; a verdict that requires a glossary to ratify has not discharged this section.

### Reproduction

Provide commands and artifact locations sufficient to repeat the assessment.

## 9. Assurance case pattern

For C2 and above, organize high-level reasoning as:

```text
Top claim:
  The system is suitable for the stated use under defined controls.

Subclaims:
  Critical functional behavior is correct.
  Security and isolation properties hold.
  Data integrity and recovery are adequate.
  Deployment and operational controls are effective.
  Known hazards and failure modes are controlled.

Arguments:
  Explain why the selected evidence is appropriate and sufficient.

Evidence:
  Tests, analyses, inspections, exercises, simulations, and independent reviews.

Defeaters:
  Conditions that would invalidate the argument.

Residual uncertainty:
  Known limits and accepted risks.
```

Actively search for defeaters rather than writing only supporting arguments.

## 10. Evidence retention

Retain enough information to support audit and reproduction without retaining secrets or sensitive customer data.

Recommended retained items:

- Exact revision and artifact hashes.
- Sanitized command logs.
- Test reports.
- Seeds and minimized failures.
- Tool versions and configurations.
- CI run identifiers.
- Environment descriptions.
- Approved exceptions and risk decisions.
- Final traceability and release assessment.

Redact or avoid:

- Credentials.
- Private keys.
- Access tokens.
- Raw customer data.
- Sensitive production logs not required for the claim.

## 11. Change invalidation rules

State what requires revalidation, such as:

- Changes to critical code or configuration.
- Dependency or model-version changes.
- Schema or infrastructure changes.
- New deployment environment.
- New user population or exposure.
- Increased privileges or autonomy.
- Changed operating assumptions.
- Expired external assessment.
- Incident revealing a new failure mode.

A favorable verdict applies only while its assumptions remain true.
