# Contract — B-13 Company-event inbox producers ↔ dispatcher
Canonical ID: **CORMIDIA-C-B13-001 (alias: B-13)**

Status: DRAFT (Phase 4). Defends INV-013/014, F-PT-005 (resolved). Journey J-10.

## 1. Valid inputs
- JSON files in `state/events/inbox/`, closed kind registry (`COMPANY_EVENT_KINDS`),
  schema-validated per kind `[doc: event-schemas]`.
- Invalid classes (all retain the file): bad JSON / non-object / missing field →
  `malformed_company_event` (error, kept for repair); unregistered kind →
  `unknown_company_event_kind` (error, kept for repair).

## 2. Output guarantees
> **Read §OPEN before authoring against this section** <!-- changelog 2026-08-10
> (reader test 23, new-engineer finding 5): the OPEN block sat below the main
> clauses and a fast reader could stop early -->: F-PT-006 leaves
> producer-atomicity/partial-file and duplicate-identity semantics undecided —
> §OPEN scopes what these guarantees may be tested against.
- Valid + ≥1 current subscriber: one turn per eligible subscriber; per-(event, role)
  marks; retirement only when every *current* subscriber holds a mark, marks pruned in
  the same atomic write `[doc]`.
- Valid + no subscriber: `no_subscriber` non-error skip, file stays pending, reported
  each tick.
- Subscriber-set change (F-PT-005, owner-ratified): added subscribers inherit pending
  events; removed subscribers cease blocking retirement.
- Channel-gated subscriber holds retirement open; event observably pending per tick.

## 3. Error behavior
- Reason codes printed verbatim (`error <code>:` / `skip no_subscriber:`) — machine-
  matchable, no prose parsing `[doc]`.

## 4. Idempotency
- (event, role) marks make redelivery/refire safe; a role never refires on a handled
  event.

## 5. Timing
- Eligibility is evaluated on **successful ticks for live apps** — no promised discovery
  latency (non-live apps deliberately leave inbox events unpolled); retention per
  scheduler design.

## OPEN (semantics undecided — F-PT-006)
- **Producer visibility protocol:** atomic temp-file+rename required of producers, vs
  dispatcher-tolerated partial file with later retry — unratified; this contract takes
  no position, and no case may encode either answer until a human ratifies.
- **Same event identity, two payloads:** resolution semantics likewise unspecified —
  folded into F-PT-006's ratification question.
