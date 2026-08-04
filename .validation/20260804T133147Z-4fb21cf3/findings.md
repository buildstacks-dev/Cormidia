# Findings

## Resolved during hardening

- `AUD-HB110-001`: batch completion was initially inferred from disposition-file
  existence. The implementation now verifies the complete schema, app/ref,
  exact unit inventory, outcomes, and per-unit journal hashes. A corrupt
  disposition seed proves the source degrades instead of projecting completion.
- `AUD-HB108-001`: the first closure list omitted `CF-IF-XSURF`. It is now in the
  runtime catalog, policy pin, case catalog, executable closure, and seeded sweep.
- `CF-REG-251`: the previously merged normalization lacked its exact deterministic
  regression. The detector injects an approval ID ending in `-`, proves the raw
  filename is unsafe, and proves the normalized journal round-trips. GitHub CI
  exposed a second raw test reader in CF-SM-LEARN-C; that family now injects the
  same edge shape deterministically, and all active publish-journal readers use
  the publisher sanitizer.

## Residual conditions

- Planner and Validation Designer corpus entries deliberately remain
  `human_validation: pending`; dependent results are inconclusive.
- The seven-day soak campaign is not started, so campaign completeness is
  incomplete even though collector machinery is validated.
- Local evidence is I1 same-agent. GitHub CI is required before merge.
- No new product-truth ambiguity or structural mismatch was found; no new
  `F-PT-*` finding was opened.
