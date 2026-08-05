# Validation Plan and Execution

Assessment: `20260805T040848Z-4bbb360974f4`

## Executed offline

1. Reviewed the complete ratified proposal, protected/binding diffs, source, tests,
   workflow and package surfaces.
2. Re-derived subject versus producer identity and added an actual prior-producer
   disposition path.
3. Hardened attestation so reports cannot stand alone: all lane results are re-derived
   from the packet's exact deterministic, L4 and campaign evidence.
4. Exercised seeded negatives for unknown schema fields, stale inputs, missing checks,
   unlisted skips, unvalidated references, uncalibrated judge scores, false grade
   reuse, forged completeness, ineligible debt, path escape, package/packet/tag tamper,
   absent verifier and modified B-17 attestation.
5. Ran the complete offline suite, typecheck, build, YAML parsing, diff check, dry-run
   pack, actual pack and disposable installed-command smoke.
6. Audited attribution and left the human threat-model fields blank/blocking.

## Required before activation

- Human author plus distinct reviewer complete TM-01…TM-10.
- Implement the human-derived HB-073 abuse cases with negative controls.
- Resolve F-PT-021 without an agent-invented approval-authenticity mechanism.
- Complete an I2 semantic review of the final C3 implementation.
- Later exact human authorization collects the required L3/L4/L5 evidence, including
  seven elapsed days and natural credential rotation.
- Resolve or retain an exact human disposition for F-PT-018 and B-17's live gap.

## Excluded

No live/eval/soak/provider campaign, tag, publish, deployment, scheduler installation,
release or protected merge was run.
