# Findings

## Resolved in this change

- `CF-REG-181`: provider permission behavior was adapter-local and not an
  app-resolved observable policy. Safe provider modes now resolve before paid
  work; unsupported and bypass modes fail at app load/normalization.
- `CF-REG-154`: remaining per-turn, generic/ticket, and static-route bounds were
  split between role values and source constants. One app policy now resolves
  them independently and persists the values actually used.
- `AUD-ROUTING-001`: four issues that change their decisive verification
  mechanism lacked `routing:human-only`; the exact label was added.
- `AUD-ROUTING-002`: two `manual-feelview` issues explicitly require product or
  architecture ratification but lacked the scheduling exclusion; each was read
  and given exact `manual-review` without a wildcard rule.
- `AUD-COMMENTS-001`: five GitHub comments described the pre-PR-249 state; each
  now records the current merged implementation boundary without erasing history.

## Residual conditions

- HB-111 protected prompt/pipeline changes are proposed, not applied. Exact
  separate human approval and a human-merged protected PR remain required.
- The HB-111 ordinary operation binding described in the proposal is not yet
  implemented and must be coordinated with any approved protected activation.
- Four issues remain intentionally ambiguous for human/Planner disposition:
  #145, #151, #186, and #257.
- Local evidence is I1 same-agent. GitHub CI is required before ordinary merge.
- No new product-truth ambiguity in #181/#154 required an `F-PT-*` finding.
