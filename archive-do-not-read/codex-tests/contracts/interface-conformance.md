# Operon interface and stimulus conformance

Status: **Phase 4 ratified — 2026-07-29**

Last updated: 2026-07-29

Interfaces and stimuli are entry or observation adapters around behavior. A
product journey is validated deeply once; each adapter then proves only that it
preserves identity, authority, input/output meaning, errors, and evidence.

## Shared adapter contract

Every admitted adapter:

1. resolves the same explicit org/app/work identity as the underlying behavior;
2. performs no operation outside the caller's authority;
3. validates syntax before invoking behavior and never invents missing product
   decisions;
4. maps the behavior's result and typed error without turning failure,
   ambiguity, degradation, or unsupported capability into success;
5. preserves correlation, causation, idempotency, and approval identities;
6. exposes schema/version identity for machine-readable output; and
7. adds no independent state owner or alternate source of product truth.

## CLI

- Human-readable and machine-readable forms invoke the same behavior.
- Exit status, typed error code, and remediation correspond to the behavior
  outcome; prose wording is not the only machine contract.
- Help and capability discovery distinguish supported, unavailable,
  misconfigured, degraded, and planned capabilities.
- Invalid flags or ambiguous scope fail before mutation.

## Agent Skill

- The Agent Skill guides an authorized assistant to the same CLI behavior and
  cannot bypass, broaden, or pre-answer human approvals.
- It preserves exact command scope and returns behavior evidence rather than
  treating assistant narration as completion.
- A stale or incompatible skill version is detected through BND-001/BND-015
  compatibility rather than silently improvising.

## Read-only UI and reports

- Views consume BND-013 projections and cannot become a workflow mutation path.
- Navigation, filtering, formatting, and refresh preserve source identity,
  freshness, degradation, redaction, and unknown states.
- A browser/rendering failure affects presentation only; it does not advance or
  stop the runtime.

## Timers, scheduler events, and external events

- Timer and event adapters normalize into the same dispatcher/intake behaviors
  with stable stimulus, org/app, subscriber, and due/event identities.
- Duplicate or late delivery follows the underlying idempotency contract.
- A collector or scheduler does not create an alternate admission, approval,
  or priority authority.

## Signals, restart, and later ticks

- Signals request bounded shutdown or interruption through the same recovery
  identities used by restart and later-tick reconciliation.
- A restart does not create a new logical episode, turn, approval, settlement,
  or external effect merely because the entry mechanism changed.
- Recovery uncertainty remains explicit and follows BND-004/BND-009/BND-011;
  an adapter cannot decide to repeat an ambiguous effect.

## Future API and MCP adapters

- API and MCP are not accepted current product surfaces merely because the
  architecture can accommodate them.
- If admitted, they must preserve the shared adapter contract and the same
  behavior/error semantics as CLI-initiated work.
- Authentication, authorization, transport retries, version negotiation,
  pagination/streaming, and compatibility windows are `OPEN` until those
  surfaces enter product scope.

## Focused conformance evidence

For each admitted adapter, the harness derives a small table covering:

- one valid invocation and identity-preservation example;
- invalid syntax and invalid scope;
- one representative typed behavior failure;
- duplicate/retry mapping;
- unsupported/degraded capability presentation; and
- proof that observation-only adapters cannot mutate.

This table is intentionally narrower than the journey suite. Re-running every
journey through every interface would multiply cost without increasing
confidence in the shared behavior.
