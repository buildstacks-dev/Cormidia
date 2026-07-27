# Test Quality Rubric

Use this rubric for tests that support critical claims. The goal is not to reward test quantity. The goal is to determine whether a test is credible evidence that a specific defect or failure would be detected.

## 1. Required test record

For each critical test or test family, record:

- Test identifier and location.
- Claim or risk addressed.
- Criticality of the behavior.
- Level: unit, component, contract, integration, end-to-end, system, hardware, or operational.
- Inputs and environment.
- Oracle and its source.
- Defects the test is expected to detect.
- Known blind spots.
- CI or release-gate status.
- Sensitivity evidence.

A test without a named claim is supporting activity, not traceable assurance evidence.

## 2. Scoring dimensions

Score each dimension from 0 to 3. Do not collapse the result into one project-wide percentage. Use the dimensions to expose weakness.

### A. Claim relevance

- `0`: No clear requirement, risk, or behavior is tied to the test.
- `1`: Tests implementation detail or incidental behavior.
- `2`: Tests a meaningful behavior but not the complete claim.
- `3`: Directly tests a critical claim, invariant, or failure mode.

### B. Oracle strength

- `0`: No meaningful assertion, or only “did not throw.”
- `1`: Assertion mirrors implementation or checks a weak proxy.
- `2`: Expected result comes from a plausible independent source.
- `3`: Oracle is authoritative, independently derived, or cross-checked by a trusted model/reference.

### C. Defect sensitivity

- `0`: A realistic defect can pass easily; no sensitivity evidence.
- `1`: Some defects fail, but key mutations or regressions survive.
- `2`: Pre-fix failure, targeted fault seeding, or mutation evidence exists for important paths.
- `3`: Strong evidence that realistic defects in the claimed behavior are detected, including high-risk branches.

### D. Boundary realism

- `0`: The relevant boundary is absent or fully mocked.
- `1`: Most behavior is simulated; important integration assumptions are untested.
- `2`: Exercises the real component boundary in a representative environment.
- `3`: Exercises the actual system or production-equivalent boundary appropriate to the claim.

### E. Scenario coverage

- `0`: Only a happy-path example.
- `1`: Limited examples with obvious edge cases missing.
- `2`: Positive, negative, boundary, and selected failure cases.
- `3`: Systematic partitioning, properties, generated cases, or risk-derived scenarios including degraded behavior.

### F. Isolation and contamination control

- `0`: Results depend on uncontrolled state, order, or shared environment.
- `1`: Frequent hidden coupling or leakage.
- `2`: State is controlled and cleanup is generally reliable.
- `3`: Isolation matches the test level, contamination is checked, and parallel execution is safe where claimed.

Isolation does not mean mocking every boundary. It means controlling state without removing the behavior under validation.

### G. Determinism and reproducibility

- `0`: Flaky or cannot be reproduced.
- `1`: Requires retries, timing luck, or one developer environment.
- `2`: Reproducible in CI with documented prerequisites.
- `3`: Deterministic or statistically characterized, repeatable from a clean environment, and retains seeds/artifacts for failures.

### H. Failure diagnosis

- `0`: Failure gives no useful location or evidence.
- `1`: Broad failure with difficult triage.
- `2`: Clear assertions and useful logs/artifacts.
- `3`: Failure identifies the violated claim, relevant inputs/state, and reproduction path without exposing secrets.

### I. Enforcement

- `0`: Not run automatically and not required.
- `1`: Run occasionally or advisory only.
- `2`: Runs in CI but may be bypassed or is not release blocking.
- `3`: Required in the appropriate gate with controlled bypass and documented risk acceptance.

### J. Maintainability and semantic stability

- `0`: Brittle, opaque, or routinely ignored.
- `1`: Closely coupled to implementation; frequent meaningless updates.
- `2`: Readable and reasonably stable around public behavior.
- `3`: Claim-focused, reusable, reviewed, and resistant to superficial implementation changes.

## 3. Interpretation

Do not use a simple total as a release rule. Instead:

- A zero in claim relevance, oracle strength, or defect sensitivity means the test is weak evidence for a critical claim.
- A zero in boundary realism means the test cannot support claims about that boundary.
- A zero in determinism or enforcement means the evidence is not dependable as a release gate.
- High criticality requires stronger dimensions and additional independent evidence.

Suggested expectations:

- C0: adequate claim relevance and basic oracle strength may be enough.
- C1: avoid zeros in relevant dimensions; real integration for destructive or stateful behavior.
- C2: critical claims should generally score strongly in relevance, oracle, sensitivity, boundary realism, reproducibility, and enforcement.
- C3/C4: tests are only part of the evidence; require independent, system-level, operational, or formal evidence as appropriate.

## 4. Common weak-test patterns

### “No exception” tests

A test that only asserts successful execution says little about output, side effects, or invariants.

Strengthen by asserting:

- Returned value.
- Persistent state.
- External effect.
- Absence of forbidden effect.
- Audit or observability signal.
- Error contract.

### Implementation-mirroring tests

A test that repeats the same algorithm may reproduce the same defect.

Strengthen with:

- Independent mathematical property.
- Trusted reference implementation.
- Hand-derived examples.
- Metamorphic relationships.
- Cross-version or differential comparison.

### Over-mocked tests

A test may pass while the real database, filesystem, network, policy engine, or serializer fails.

Strengthen with a layered portfolio:

- Focused unit tests for local logic.
- Contract tests at boundaries.
- Real integration tests for critical interfaces.
- End-to-end tests for selected journeys.

### Snapshot-only tests

Large snapshots often detect change without indicating correctness. Reviewers may approve updates mechanically.

Strengthen with:

- Semantic assertions for critical fields and invariants.
- Small targeted snapshots.
- Explicit review of intentional changes.
- Accessibility or structural checks for UI snapshots.

### Happy-path concentration

Strengthen with:

- Invalid inputs.
- Boundary values.
- Empty, maximum, duplicate, and malformed cases.
- Permission denial.
- Timeouts and partial failures.
- Retries and concurrency.
- Interruption and recovery.

### Flaky tests hidden by retry

Retries may conceal nondeterminism. Treat retries as diagnostic, not resolution.

Record:

- Failure rate.
- Seed and timing.
- Suspected cause.
- Quarantine owner and deadline.
- Whether the affected claim remains verified by other evidence.

A flaky release-blocking critical test is a validation defect.

### Tests that assert mocks were called

Call-count assertions can be useful for a narrow collaboration contract, but they do not prove the externally visible result.

Add outcome assertions at the appropriate boundary.

### Generated tests with weak semantics

AI-generated tests may maximize line execution while missing intent.

Require:

- Claim mapping.
- Independent oracle.
- Negative cases.
- Sensitivity evidence.
- Review for overfitting to implementation.

## 5. Sensitivity evidence hierarchy

From stronger to weaker, depending on context:

1. The test fails against the actual pre-fix defect and passes after the fix.
2. The test fails against a realistic independently created fault.
3. Mutation testing shows relevant mutations are killed.
4. Differential or reference-model disagreement is detected.
5. Manual inspection indicates the assertion would detect the targeted defect.
6. The test merely executes the line or branch.

Do not mistake code coverage for sensitivity.

## 6. Mocking decision test

Before mocking a dependency, ask:

- Is the claim about local decision logic or about the real interaction?
- Does the mock encode the same assumption that may be wrong in production?
- Are protocol details, transactions, retries, serialization, permissions, or timing material?
- Is there another test that exercises the real boundary?
- Can a lightweight real dependency or contract harness be used instead?

For authorization, data integrity, migration, and recovery claims, prefer real policy/database/system behavior in at least one evidence layer.

## 7. Flake policy by criticality

### C0

Document and fix when convenient if the test is not used for consequential decisions.

### C1

Quarantine only with visible tracking and alternate evidence for important behavior.

### C2

Critical-path flaky tests should block or be replaced by reliable evidence. A quarantine requires owner, rationale, expiry, and residual-risk statement.

### C3/C4

Unexplained nondeterminism in critical validation is itself a serious finding. Do not issue a favorable verdict on the affected claim without dependable alternate evidence and explicit acceptance.

## 8. Test-suite portfolio review

Evaluate whether the suite has a rational distribution rather than a fashionable shape.

Ask:

- Are pure rules tested cheaply and thoroughly?
- Are real boundaries exercised where integration risk exists?
- Are critical journeys tested end to end?
- Are operational and recovery claims tested outside normal unit suites?
- Are high-risk properties checked by more than one evidence type?
- Are slow tests focused enough to remain enforceable?
- Are duplicated tests creating maintenance cost without additional detection power?
- Are there important claims with no oracle?

## 9. Required conclusion language

For each critical claim, write one of:

- `verified`: evidence is sufficient for the stated scope.
- `partially_verified`: some dimensions or environments remain unverified.
- `not_verified`: evidence is absent or inadequate.
- `blocked`: validation could not be completed.
- `unknown`: intended behavior or oracle is unresolved.

Do not write “covered” when only a line, branch, or mock interaction was exercised.
