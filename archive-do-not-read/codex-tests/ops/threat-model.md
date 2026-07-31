# Operon validation threat model

Status: **First-pass agent analysis with two blocking defects; owner review and
human residual-risk acceptance are absent**

Method: structured STRIDE review over `boundary-map.md`, refined by the C3
consequence model in `validation-policy.yaml`.

Review owner required by policy: `operon_platform_security_maintainer`

Review date: 2026-07-30

This record is attributable to the validation campaign, not to the required
owner. It cannot become a completed threat review until that owner reviews the
entries, all critical detectors are green or explicitly remediated, and any
residual acceptance names the human decision.

## Review record required for each boundary

| Field | Required content |
| --- | --- |
| Boundary | Stable `OPERON-BND-*` identifier |
| Assets and state owner | Authority, identity, secrets, durable truth, spend, artifacts, or effects at risk |
| Trust direction | Caller, callee, and untrusted inputs |
| STRIDE class | Spoofing, tampering, repudiation, information disclosure, denial of service, or elevation of privilege |
| Abuse/failure path | Concrete stimulus and state transition |
| Consequence | Product impact and affected org/app/effect scope |
| Existing control | Runtime guardrail, contract, or independent evidence |
| Detector | Cheapest falsifiable validation case and layer |
| Residual unknown | Product-truth or architecture finding |
| Disposition | Open, mitigated with evidence, accepted by named human, or blocking |

## First-pass register

| ID | Boundary/assets | STRIDE | Concrete path and consequence | Existing control | Detector/evidence | Residual unknown | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TM-001 | BND-008 intake → BND-007 tool execution; tool authority and secrets | E, I, T | A GitHub issue or external payload instructs a model to exfiltrate secrets or invoke a consequential command; org/app authority can be exceeded | Untrusted prose is data; effect-bearing tool actions cross the production critical-op gate | `security-boundaries.test.ts`: outbound command denied while prose-only documentation remains routine | Native adapter/subagent gate conformance remains a live obligation | Mitigated in local production composition; live proof absent |
| TM-002 | BND-002/BND-007 worktree context; authority-bearing context bytes | E, I, T | A repository-controlled `.pi` symlink redirects `.pi/APPEND_SYSTEM.md` outside the admitted worktree before the provider turn | Lexical relative-path check only | `OPERON-CASE-DET-001`; [issue #198](https://github.com/buildstacks-dev/Operon/issues/198) | None needed to determine expected outcome: INV-002 requires refusal | **Blocking defect: detector red; Pi retained** |
| TM-003 | BND-007 host/filesystem effects; local and shared data | T, D, E | Injected destructive command uses an absolute, home, or parent-escape target | Production critical-op gate distinguishes escaped destructive targets from bounded worktree cleanup | `security-boundaries.test.ts`: parent escape denied, local temp cleanup routine | Adapter-native sandbox behavior retained for Layer 3 | Mitigated in local production composition; live proof absent |
| TM-004 | BND-002/BND-003 org/app identity and homes | S, T, I, E | Active-org rebinding or crafted path causes one org/app to read or mutate another's state, approvals, budget, or artifacts | Immutable admitted identity and path validation contracts | Controlled-world isolation and recovery cases; comprehensive concurrent multi-org matrix pending AF-001 | Multi-org concurrency and schema skew (AF-001) | Open; critical expansion required |
| TM-005 | BND-010 GitHub identities/secrets and BND-011 outward effects | S, R, E | Builder acts as reviewer, self-approves, or secrets grant broader repository authority than recorded | Production gate denies `gh pr merge/review`; typed GhOps separates review/effect lifecycle | Gate production contract plus stateful GitHub simulator | Principal-separation topology PTF-017/AF-015; named live target AF-010 | Blocking-absent on product truth/live topology |
| TM-006 | BND-001/BND-015 package and platform release supply chain | S, T, R | Malicious/incorrect npm package, skill link, dependency, or update rewires installed code or persistent state without compatible rollback | Pinned independent harness dependencies; product packaging/release contracts | Packaging/supply-chain cases not yet implemented | npm update/rollback PTF-005 and schema compatibility AF-004 | Blocking-absent |
| TM-007 | BND-006 approval queue and decision packets | S, R, D, E | Repeated, misleading, or duplicated requests produce rubber-stamp behavior or mint authority beyond the reviewed action | Exact action binding and single-use grants; independent work should progress | Effect-reconciliation detector covers binding/idempotency; queue-load detector absent | Packet clarity/backpressure thresholds PTF-009–010/AF-011 | Blocking-absent |
| TM-008 | BND-011 consequential external effects | T, R | Timeout/lost acknowledgement after remote success triggers blind retry and duplicate publication/issue/effect | Stable operation identity, marker reconciliation, authoritative lifecycle | `effect-reconciliation.test.ts`: crash and timeout after possible write reconcile without a duplicate | Real service semantics require AF-010 target and Layer 3 | Mitigated locally; live proof absent |
| TM-009 | BND-012 learning candidates → active context | T, E, R | Injected observation or agent write poisons bundle/policy/quarantine and changes future behavior | Candidates carry no authority; governed surfaces are critical writes | `security-boundaries.test.ts`: learning bundle write denied | Full provenance/activation/replay adversarial matrix not implemented | Partially mitigated; expansion required |
| TM-010 | BND-015/BND-016 platform control plane vs operated org | I, T, E | Developer grants, eval state, release authority, or platform prompts leak into an org and become operational authority | One-way platform/org separation contract and protected roots | `platform-learning-isolation.test.ts`: package allowlist and runtime-context authority-marker detector | Exact release evidence/rollback promise PTF-014; packed-artifact live proof absent | Partially mitigated; release claim blocking-absent |
| TM-011 | BND-006 human decision contention; grant and decision authority | T, R, E | Concurrent approve and deny delivery for one pending item both cross precondition checks; the losing caller can still append a decision or mint a grant, leaving caller result, log, grant, and authoritative item contradictory | Contract requires one decision identity and one authoritative result; execution transitions already use per-item locks | `OPERON-CASE-DET-004` in `approval-contention.test.ts`; [issue #199](https://github.com/buildstacks-dev/Operon/issues/199) | No product-truth gap: INV-006/007 and BND-006 require one content-bound authoritative decision | **Blocking defect: detector red** |

## Required follow-through

- Production must refuse TM-002 and serialize TM-011 before the controlled
  foundation can be green. This campaign does not authorize either production
  fix.
- TM-004, TM-006–007, TM-009–010 require their listed deterministic
  expansions; unknown expected outcomes remain findings.
- TM-001, TM-003, TM-005, and TM-008 retain exact Layer-3 live obligations.
- The named policy owner must review this register and its triggers.
- No residual critical risk has been accepted by the human. An acceptance
  without an attributable decision, scope, expiry/review trigger, and evidence
  is invalid.
