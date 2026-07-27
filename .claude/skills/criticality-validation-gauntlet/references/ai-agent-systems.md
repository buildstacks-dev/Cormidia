# Validation of AI, LLM, and Agent Systems

Use this reference when a system includes model inference, prompts, retrieval, memory, tool use, code execution, autonomous workflows, or model-generated decisions.

AI behavior introduces additional uncertainty, but the assurance target must still be expressed as concrete system claims. Do not replace engineering evidence with subjective demonstrations or one aggregate benchmark.

## 1. Expand the system boundary

Include:

- Model provider, model identifier, version or alias, and update policy.
- System prompts, policies, tool descriptions, and routing logic.
- Retrieval sources, indexes, chunking, ranking, and freshness.
- Memory stores and retention.
- Tools, permissions, credentials, sandboxes, and network egress.
- Orchestrator, planner, executor, reviewer, and fallback paths.
- Human approval and override mechanisms.
- Evaluation datasets, judges, graders, and holdout controls.
- Observability, cost limits, rate limits, and kill switches.
- External content that may contain hostile instructions.

A model call is only one component. The agent’s effective behavior is produced by the entire control system.

## 2. Criticality drivers unique to agents

Increase assurance requirements when the system has:

- Autonomous consequential actions.
- Broad filesystem, shell, cloud, financial, communication, or identity permissions.
- Long-running loops.
- Recursive delegation.
- Access to secrets or private data.
- Untrusted web, email, document, issue, or code inputs.
- Persistent memory.
- Self-modification or ability to alter its own validation.
- Model/version changes outside the team’s direct control.
- Plausible outputs that are difficult to verify.
- High action volume or large blast radius.

A local coding agent with shell access and production credentials can be C3 even when it has one user.

## 3. Required claim categories

### Task correctness

Examples:

- The system completes supported tasks within defined acceptance criteria.
- It preserves required invariants while acting.
- It does not claim completion without evidence.

### Instruction and policy adherence

Examples:

- System and developer constraints override untrusted content.
- Tool calls remain within authorized scope.
- The agent refuses or escalates unsupported consequential actions.

### Permission containment

Examples:

- Each tool receives least privilege.
- A task cannot access unrelated repositories, accounts, or tenants.
- The agent cannot silently elevate permissions.
- Destructive actions require approved controls.

### Data protection

Examples:

- Secrets and private data are not leaked to prompts, logs, tools, other users, or model providers outside the approved boundary.
- Memory does not cross users, tenants, or projects.
- Retention and deletion requirements hold.

### Prompt-injection resistance

Examples:

- Instructions in retrieved documents, webpages, emails, code comments, tool output, or attachments are treated as data unless explicitly trusted.
- Hostile content cannot redirect tools, exfiltrate secrets, or bypass approval.

### Action safety

Examples:

- Consequential actions are previewed, scoped, authorized, idempotent, and reversible where possible.
- The system confirms the target before deletion, payment, deployment, permission change, or external communication.
- A kill switch and bounded execution path exist.

### Reliability and recovery

Examples:

- Retries do not duplicate external effects.
- Partial workflows can resume or reconcile safely.
- Model, tool, or network failure produces bounded behavior.
- Long-running loops have time, cost, and action limits.

### Model and configuration change control

Examples:

- Model, prompt, policy, tool, or retrieval changes trigger appropriate re-evaluation.
- Rollback to a known configuration is possible.
- Alias movement is detected and governed.

### Observability and auditability

Examples:

- Consequential decisions and tool calls are traceable.
- Logs are sufficient for investigation without exposing secrets.
- Human approvals and overrides are recorded.

## 4. Evaluation design

### Build from claims and failure modes

Create an evaluation set that covers:

- Representative successful tasks.
- Boundaries of supported behavior.
- Invalid or underspecified requests.
- Adversarial content.
- Tool and dependency failures.
- Long-horizon and multi-step workflows.
- Conflicting instructions.
- Permission and tenant boundaries.
- Recovery and interruption.
- Cost, latency, and action budgets.

### Use multiple evidence types

Combine as appropriate:

- Deterministic checks of final state.
- Schema and invariant validation.
- Exact tool-call and permission checks.
- Reference outputs for narrowly specified tasks.
- Property checks.
- Human expert review.
- Model-based grading with calibration.
- Adversarial red-team scenarios.
- Production shadowing or staged rollout under controls.

Do not use a model judge as the sole oracle for a high-consequence claim that can be checked deterministically.

### Separate development and holdout sets

Maintain:

- Development scenarios visible to implementers.
- Regression scenarios from real failures.
- Protected holdouts for independent verification.
- Adversarial sets refreshed as defenses become known.

Prevent contamination by controlling access and recording versions.

### Evaluate trajectories, not only final text

Inspect:

- Tool selection.
- Arguments.
- Permission use.
- Intermediate state.
- Retries.
- Escalations.
- Evidence gathering.
- Whether the agent verified completion.

A correct-looking final answer can hide unsafe actions or accidental success.

## 5. Prompt-injection and untrusted-content tests

Test hostile instructions embedded in:

- Web pages.
- Emails.
- Documents and PDFs.
- Issue descriptions.
- Source files and comments.
- Tool output.
- Retrieved memory.
- Image text or metadata.

Attempt to induce:

- Secret disclosure.
- Unauthorized tool calls.
- Permission escalation.
- Data deletion or corruption.
- External communication.
- Policy override.
- Hidden persistence.
- Manipulation of logs or validation artifacts.

Validate the control outside the model where possible:

- Tool authorization layer.
- Sandboxing.
- Egress controls.
- Data-loss prevention.
- Approval gate.
- Allowlisted actions.
- Resource and action limits.

Prompt wording alone is weak protection for a privileged agent.

## 6. Tool-use validation

For every tool, document:

- Purpose.
- Allowed callers.
- Permission scope.
- Input validation.
- Side effects.
- Idempotency.
- Confirmation requirements.
- Rate and cost limits.
- Audit events.
- Failure and retry behavior.
- Revocation and kill switch.

Test:

- Invalid, oversized, and adversarial arguments.
- Cross-tenant or cross-project target substitution.
- Tool-output injection.
- Partial success.
- Timeout after side effect.
- Duplicate invocation.
- Chained privilege amplification.
- Attempts to invoke unavailable or forbidden tools.

Use deterministic policy enforcement outside the model for permissions and consequential actions.

## 7. Coding-agent validation

For agents that modify code:

- Run in isolated worktrees or sandboxes.
- Restrict access to credentials and unrelated repositories.
- Require explicit test and acceptance criteria.
- Preserve user changes.
- Treat repository content as potentially hostile.
- Inspect build and test scripts before execution.
- Require evidence for completed work.
- Separate implementation from verification.
- Protect acceptance and holdout tests.
- Detect test weakening, broad skips, and changes that bypass validation.
- Limit generated shell commands and network egress according to project criticality.

Evaluate whether the coding agent:

- Understands the requirement rather than only satisfying visible tests.
- Chooses the correct scope.
- Avoids unnecessary architectural change.
- Adds meaningful tests with sensitivity evidence.
- Reports uncertainty and incomplete validation.
- Avoids claiming success when commands failed or were not run.

## 8. Nondeterminism and statistical evidence

Record:

- Model and configuration.
- Prompt and tool versions.
- Randomness settings where exposed.
- Number of trials.
- Success and failure definitions.
- Confidence intervals or uncertainty where useful.
- Worst-case and tail failures.
- Seed or trace when available.

Do not hide unstable behavior behind an average pass rate. For critical actions, design deterministic constraints that prevent unacceptable outcomes even when model behavior varies.

## 9. Model-judge validation

When using a model to grade outputs:

- Define a rubric tied to claims.
- Calibrate against human-labeled examples.
- Test inter-rater disagreement.
- Blind the judge to irrelevant implementation identity.
- Avoid having the same model generate and grade without additional checks.
- Use multiple judges or deterministic checks for important dimensions.
- Inspect false positives and false negatives.
- Version the judge prompt and model.

A judge score is supporting evidence, not an objective truth.

## 10. Retrieval and memory validation

Test:

- Source authorization.
- Tenant isolation.
- Freshness.
- Provenance and citation correctness.
- Missing, conflicting, poisoned, and stale documents.
- Retrieval of sensitive data.
- Prompt injection in source content.
- Memory write authorization.
- Memory correction and deletion.
- Cross-session and cross-user leakage.

Separate “the model answered plausibly” from “the system retrieved and used the correct authorized evidence.”

## 11. Human-in-the-loop validation

A nominal approval step is not automatically an effective control. Verify:

- The reviewer receives enough context.
- The consequence and target are clear.
- The action is not already executed.
- The reviewer can reject or modify it.
- Approval fatigue is controlled.
- High-volume actions are not rubber-stamped.
- Escalation works.
- Approval and execution match exactly.

For high-consequence actions, bind approval to an immutable action preview or hash so the executed action cannot differ silently.

## 12. Operational controls

Consider:

- Per-task and per-user budgets.
- Maximum tool calls and loop iterations.
- Rate limits and quotas.
- Sandboxing.
- Network egress restrictions.
- Tenant and environment isolation.
- Canary rollout.
- Shadow mode.
- Circuit breakers.
- Kill switches.
- Model fallback.
- Human escalation.
- Audit and anomaly detection.

Validate controls by triggering them, not only inspecting configuration.

## 13. Change invalidation

Re-run affected evaluations when changing:

- Model or model alias.
- System prompt or policy.
- Tool descriptions or schemas.
- Tool permissions.
- Orchestration logic.
- Retrieval source, index, or ranking.
- Memory behavior.
- Judge model or rubric.
- Runtime limits.
- External provider.
- Deployment environment.

Record which evaluation suites are required for each change category.

## 14. Verdict limits

A favorable AI-system verdict must state:

- Supported task and user population.
- Allowed tools and permissions.
- Environment and data boundary.
- Model/configuration versions.
- Evaluation-set version.
- Trial volume and observed failures.
- Operational controls.
- Known unsupported requests.
- Residual uncertainty due to nondeterminism and distribution shift.

Do not claim an agent is “safe” or “reliable” in general. State the exact conditions under which evidence is sufficient.
