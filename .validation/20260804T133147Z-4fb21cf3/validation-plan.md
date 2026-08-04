# Validation plan

1. Bind the assessment to base commit
   `86f0727326d17063e23878d0c846b52154c8f3dd` and implementation tree
   `4fb21cf3f4a542deba70c77c84167a732d52275a`.
2. Exercise the exact CF-REG-251 trailing-hyphen input and its unsafe raw-path
   negative control.
3. Walk the accepted deterministic catalog and require a catalog row, case row,
   executable test, and seeded marker for every family.
4. Exercise contention and soak-collector violations at hermetic layer L2.
5. Build one mixed Roadmap fixture and require byte-equivalent structured
   explanation content across Status, Report, and Observe; corrupt authoritative
   artifacts as negative controls.
6. Run the full populated offline suite repeatedly, then strict typecheck, build,
   and `git diff --check`.
7. Require GitHub CI before ordinary squash merge. Do not execute live, eval,
   soak, provider-backed, publication, deployment, or release actions.
