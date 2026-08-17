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
<!-- changelog 2026-08-12 (F-PT-006 owner ruling): the §OPEN block below is
RESOLVED and its read-first blockquote (added 2026-08-10, reader test 23,
new-engineer finding 5) is retired with it. The two undecided semantics became
the "Event identity" and "Producer visibility" clauses in this section.
Tighten-only: an undecided pair of readings became one exact rule, and the rule
DEDUPLICATES where the code previously fired twice. -->
- **Event identity is content-derived**: an inbox event's dedup identity is
  `sha256` over the canonical (sorted-key) serialization of the raw validated
  producer payload after removing only the top-level transport `filename` and
  top-level producer `id`. Every other validated field is identity-bearing,
  including nested `id` and unknown fields. Deliveries that differ only in
  top-level `filename` and/or `id` are one event; any other field difference is
  a different event. Exactly one firing occurs per event identity: duplicate
  deliveries collapse to one, and the collapse is reported, never silent.
  Two genuinely separate occurrences with identical identity-bearing content
  are deliberately indistinguishable and therefore collapse. Top-level `id`
  remains schema-required and is delivered as provenance; exclusion from
  identity does not remove it. For a duplicate group, the first filename in
  stable sort order supplies the delivered payload and observed `id`.
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

## 6. Producer visibility (ratified 2026-08-12 — F-PT-006)
<!-- changelog 2026-08-12: replaces the §OPEN block. F-PT-006 is
resolved-ratified; the owner's decision is recorded in
../harness-design-state.md and the affected checked-model facts, and its
attributable source is the 2026-08-12 owner instruction
cited in the landing PR body. -->
- **Producers owe no atomicity.** Temp-file+rename is not required: a partial
  file fails JSON parse, is retained loudly as `malformed_company_event` for
  repair (§1), and fires exactly once under its clarified content identity when
  the complete bytes land. The dispatcher tolerates the partial file and
  retries; content identity is what makes that retry safe, rather than an
  obligation on producers Cormidia cannot enforce.
- **Identity conflicts are defined, not guessed.** A changed top-level `id`
  alone is a retry of the same event. A change in any other field is a
  different event, even if the top-level `id` is reused; no first/last-wins
  payload rule is owed.
- **Migration:** three prior durable shapes remain suppressive: a legacy
  filename entry, a pre-clarification ID-inclusive bare content key, and a
  pre-clarification per-role content mark. A bare mark on any delivery in the
  clarified identity group suppresses the whole group; per-role marks are
  unioned into the clarified identity before admission. Durable scheduler
  spawn evidence under any of those aliases also reconciles to the clarified
  per-role mark. File order cannot change that result. No event consumed or
  durably spawned before clarification may re-fire; suppression only widens —
  tighten-only. Compatibility aliases are admission/recovery-only and never
  replace the clarified identity for new writes.

## 7. Resolved-identity detector mirror

Owner clarification 2026-08-16 (owner). Deliveries that differ only in
`filename` and/or `id` are one event. The pre-clarification id-inclusive bare
content key and pre-clarification per-role content mark remain suppressive;
durable scheduler spawn evidence under any of those aliases reconciles without
refiring.
