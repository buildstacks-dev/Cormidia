# Independent Verification

Independent verification reduces the risk that the same assumptions, incentives, or implementation knowledge shape both the system and the evidence used to approve it.

## 1. Independence levels

Record the strongest level actually achieved.

### I0 — Self-check

The implementer runs tests and reviews the result.

Useful for rapid feedback. Not independent.

### I1 — Role-separated self-review

The same agent or person switches from implementation to review using a written contract and separate pass.

Better than no separation, but shared context and assumptions remain.

### I2 — Fresh-context agent review

A separate agent or clean session receives the repository, assurance target, and evidence artifacts without relying on the implementer’s narrative.

Provides some cognitive separation. It is not organizational independence.

### I3 — Separate human or team

A reviewer not responsible for implementation verifies the claims and evidence, with authority to reject the change.

Appropriate for many high-risk C2 and C3 claims.

### I4 — Independent specialist or organization

A qualified independent party performs verification under controlled procedures.

May be required for selected C3 and C4 contexts.

## 2. Minimum expectations by criticality

- C0: I0 may be sufficient.
- C1: I0 or I1 is often sufficient; use I2 for destructive or privileged paths.
- C2: I2 for material changes; I3 for critical security, data, migration, or recovery claims where feasible.
- C3: I3 is normally expected for critical claims; use I4 when domain, regulatory, or consequence demands it.
- C4: Independent verification and acceptance must be defined by the system assurance process. Agent-only review cannot satisfy the full independence requirement.

These are defaults, not substitutes for domain requirements.

## 3. Separation of responsibilities

Use distinct roles when the host supports multiple agents.

### Assurance Architect

Responsibilities:

- Define system boundary and intended use.
- Classify criticality.
- Reconstruct the validation contract.
- Identify claims, hazards, and evidence requirements.
- Design the gauntlet.

Restrictions:

- Should not implement production fixes during the design pass.
- Must record assumptions and unresolved requirements.

### Validation Engineer

Responsibilities:

- Implement tests, harnesses, fixtures, CI gates, and approved testability refactors.
- Produce sensitivity evidence.
- Repair defects when authorized.

Restrictions:

- Cannot unilaterally change the assurance target or weaken protected claims.
- Cannot approve its own residual-risk exceptions.

### Adversarial Verifier

Responsibilities:

- Challenge criticality, scope, claims, and evidence.
- Run a clean verification.
- Create holdout scenarios.
- Search for bypasses, weak oracles, and test gaming.
- Inspect behavior changes.

Restrictions:

- Should not repair findings during the verification pass.
- Must report failures before implementation feedback changes the test.

### Release Assessor

Responsibilities:

- Consolidate evidence.
- Determine whether the stated target is met.
- Issue a scoped verdict.
- Identify required acceptance authority.

Restrictions:

- Does not convert missing evidence into acceptance.
- Does not make code changes.

## 4. Fresh-context verification protocol

When a separate reviewer is available:

1. Pin the target revision.
2. Provide the assurance profile, validation contract, traceability matrix, and reproduction instructions.
3. Do not provide a persuasive implementation summary before the verifier forms an initial model.
4. Ask the verifier to inspect source evidence for critical claims.
5. Run mandatory gates from a clean checkout or worktree.
6. Verify the evidence artifacts correspond to the pinned revision.
7. Review changed tests before changed production code where practical; this helps expose whether tests were shaped around the implementation.
8. Create independent boundary and failure cases.
9. Test at least one plausible bypass for each high-risk negative requirement.
10. Record disagreements and their resolution.

## 5. Holdout validation

For high-risk claims, reserve scenarios that the implementation pass does not see.

Good holdouts are derived from:

- Requirements and threat or hazard analysis.
- Historical defects.
- Boundary partitions.
- Abuse cases.
- Failure combinations.
- Independent reference models.

A holdout must not depend on secret requirements that make the task impossible. It should test known obligations without exposing the exact example.

Protect holdouts by:

- Keeping them in a separate verifier workspace or CI job.
- Restricting write access.
- Recording hashes and versioning.
- Separating failure reporting from the raw test when necessary.

## 6. Adversarial review questions

Challenge:

### Scope

- What important runtime, infrastructure, hardware, or operator behavior is outside the repository?
- Does the stated environment match the tested environment?
- Is the user population or blast radius understated?

### Criticality

- Was a high-consequence dimension averaged away?
- Does a claimed containment control have evidence?
- Does the system have hidden privilege, autonomy, or irreversible effects?

### Requirements

- Did the implementer treat current behavior as intended behavior?
- Are conflicting requirements unresolved?
- Are negative requirements explicit?

### Tests

- Would a realistic defect fail the test?
- Is the oracle independent?
- Was the real boundary mocked?
- Did thresholds, snapshots, fixtures, or retries change to get green?
- Are there skipped or quarantined critical checks?

### Operations

- Has restore, rollback, failover, or alerting actually been exercised?
- Does the evidence show only configuration existence or effective behavior?
- Are manual steps feasible under incident pressure?

### Evidence

- Is every result tied to the target revision?
- Are logs complete and sanitized?
- Are failed or unavailable checks visible?
- Is stale evidence being reused after invalidating changes?

## 7. Same-agent fallback

When only one agent is available:

1. Finish the implementation pass and persist artifacts.
2. Clear or minimize implementation narrative.
3. Re-open from the assurance profile and source requirements.
4. Review tests and artifacts before reading the implementer’s conclusions.
5. Generate new adversarial cases.
6. Mark independence as I1, not I2 or I3.
7. For C3/C4 critical claims, treat missing stronger independence as a limitation or blocker according to the assurance target.

## 8. Disagreement handling

When implementer and verifier disagree:

- Tie each position to a claim, source, and evidence.
- Prefer authoritative requirements and independent observable behavior.
- Do not resolve by majority vote among agents.
- Escalate ambiguous intent to the appropriate product, safety, security, or operational authority.
- Preserve the disagreement in the evidence package.

## 9. Verification report

The verifier should report:

- Independence level.
- Target revision and environment.
- Claims independently confirmed.
- Mandatory checks rerun.
- Holdout and adversarial scenarios.
- Evidence mismatches.
- Behavior changes hidden within validation work.
- Unresolved disagreements.
- Findings and severity.
- Scope limitations.
- Recommended verdict.

## 10. Independence limitations for AI reviewers

AI agents can provide useful separation through fresh contexts, diverse models, protected tests, and role-specific prompts. They may still share:

- Similar training patterns.
- Common tool limitations.
- The same incomplete repository evidence.
- Susceptibility to plausible but incorrect documentation.
- Incentives to complete the task and produce a favorable narrative.

For high-consequence systems, combine agent verification with appropriate human domain expertise, operational evidence, and formal acceptance authority.
