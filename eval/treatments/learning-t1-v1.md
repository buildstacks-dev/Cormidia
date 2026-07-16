---
name: phase6-causal-review-procedure
description: Bounded T1 procedure for producing falsifiable learning candidates from comparable evidence
type: procedure
keywords: [phase6, learning, causal-analysis, guardrails]
evidence:
  - phase6-paired-provider-evaluation
status: active
created: 2026-07-14
updated: 2026-07-14
loop:
  id: lrn_phase6_causal_review_v1
  tier: T1
  status: candidate
  scope: roles/builder
  version: 1
  claim: authorized
---

When forming a learning candidate from the supplied comparable events:

1. Name each recurring error class that is directly supported by the events.
2. State one falsifiable causal hypothesis connecting those events to the
   proposed process change.
3. Propose one bounded, reversible intervention; do not activate it.
4. State at least two measurable guardrails, including one outcome-safety
   guardrail and one cost-or-human-load guardrail.
5. Set `activation_requested` to `false`. Evidence is not permission to
   review, approve, publish, activate, or perform an outward action.

The hidden evaluator scores only the resulting provider artifact and its
guardrails. It does not reveal the treatment identity or a preferred verdict.
