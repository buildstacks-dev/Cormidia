# Cormidia validation threat model — human authoring template

Status: **AWAITING HUMAN AUTHOR AND REVIEW**. This scaffold is not a threat model,
does not resolve HB-072, and cannot reactivate release gating or the abuse lane.

The product owner ratified the scope and timing in `risk-allocation.md` §6. A human
author must identify assets, actors, trust boundaries, STRIDE threats, existing
controls, residual risks, abuse cases, and accepted/required mitigations. A human
reviewer must then validate the result and update `threat-model-status.yaml` with
the exact artifact digest. Do not fill gaps from current code behavior.

## Review metadata

| Field | Human entry |
| --- | --- |
| Author / date | |
| Reviewer / date | |
| Commit and deployment shape | |
| Boundary-map version/digest | |
| Accepted residual-risk owner | |

## STRIDE worksheet (all ten ratified surfaces are mandatory)

| ID | Ratified trust-boundary surface | Assets / actors / data flow | S | T | R | I | D | E | Existing controls + evidence | Residual risk | Abuse case IDs | Human disposition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TM-01 | Authority, gates, grants, approvals, and critical-effect execution | | | | | | | | | | | |
| TM-02 | Secrets and credentials | | | | | | | | | | | |
| TM-03 | Cross-org/app identity and isolation | | | | | | | | | | | |
| TM-04 | Untrusted GitHub, event, repository, and model content; prompt injection and evidence forgery | | | | | | | | | | | |
| TM-05 | Provider tool calls, gate bridges, and app-owned subprocess/toolchain execution | | | | | | | | | | | |
| TM-06 | Managed workspace, filesystem, symlink, and checkout boundaries | | | | | | | | | | | |
| TM-07 | Merge authorization and false-evidence attacks | | | | | | | | | | | |
| TM-08 | Learning capture and promotion injection | | | | | | | | | | | |
| TM-09 | Observer capability and confidentiality | | | | | | | | | | | |
| TM-10 | Replay, confused-deputy, resource-exhaustion, and denial paths | | | | | | | | | | | |

## Required human conclusions

- Enumerate abuse cases and map each to a boundary/control point and detector.
- Mark every residual risk accepted, mitigated, transferred, or blocking, with owner.
- Identify any new product-truth finding; add it to `validation-policy.yaml` before
  encoding expected behavior.
- Confirm whether the result is sufficient for each pending trigger separately:
  release-gating reactivation, droplet migration, and first non-sandbox onboarding.
