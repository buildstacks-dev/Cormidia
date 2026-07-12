# Prioritized implementation plan

Each slice is independently reviewable and ends with tests plus a coherent
commit. Later slices depend on the contracts established earlier.

## Slice 0 — Forensic baseline and failing tests

Dependencies: none.

- Land this dossier and immutable hash/trace map.
- Add focused tests for auto dry-run/workdir flags, supplied-checkout
  preservation, SIGTERM/timeout finalization, stale analysis, partial usage,
  report usage quality, adapter readiness, and learning projection crash order.
- Keep production behavior unchanged until those tests demonstrate the defect.

Exit: every confirmed defect has a red test or a documented reason it requires
an end-to-end harness.

## Slice 1 — Owned execution and containment

Dependencies: slice 0.

- Add `AbortSignal` to turn/pipeline contracts.
- Install scoped SIGINT/SIGTERM handling at live CLI boundaries.
- Make adapters own and cancel provider sessions/process groups.
- Replace watchdog abandonment with abort → bounded grace → forced close.
- Add cancelled/timed-out envelope statuses and exactly-once finalization.
- Distinguish managed clones from supplied checkouts; never checkout/reset a
  supplied repo. Create isolated worktrees from an explicitly captured commit.
- Give concurrent planning traces disjoint worktrees.

Exit: descendants stop, later stages never start, terminal reason persists,
and operator branch/HEAD/index/worktree remain unchanged.

## Slice 2 — Usage durability and stale recovery

Dependencies: slice 1 cancellation contract.

- Add adapter progress events for session identity and cumulative usage.
- Atomically checkpoint usage during execution.
- Set usage quality on envelopes/ledger.
- Reconcile partial checkpoints exactly once.
- Add stale heartbeat/finalization/orphan/tool-without-usage anomaly flags.
- Add an explicit stale-run recovery command only if automatic finalization
  cannot prove ownership; diagnostics themselves remain read-only.

Exit: interrupted spend is partial/unavailable, never exact zero, and analyze
flags all four historical shapes in fixtures.

## Slice 3 — Provenance and completion integrity

Dependencies: slices 1–2 lifecycle/usage vocabulary.

- Add parent-task and trace records.
- Persist workdir/branch/HEAD, runtime/model/effort, authority metadata, native
  session IDs, transcript availability, cancellation reason, and artifact refs.
- Build adjacent evidence bundles and clickable relative links.
- Add GitHub relationship ingestion and completion-integrity evaluation.
- Rename `(no ticket)` to pre-ticket planning.
- Model manual fallback and distinguish product outcome from Operon integrity.

Exit: the July fixture renders all requested provenance and says Operon
end-to-end incomplete because review/manual fallback evidence is missing.

## Slice 4 — Adaptive planning

Dependencies: trace provenance from slice 3.

- Implement the versioned factor classifier in adaptive-planning.md.
- Support quick/standard/deep pass selection without requiring an ad-hoc
  protocol-file edit for legacy orgs.
- Persist routing record, skipped-pass reasons, and cost estimate before model
  construction.
- Make auto dry-run render that record with zero writes/provider calls.
- Finalize traces as completed only after plan-of-record validation/publication.

Exit: table-driven routing and short-security/long-clear counterexamples pass.

## Slice 5 — Delegated authority onboarding

Dependencies: envelope provenance from slice 3.

- Add canonical charter templates/profiles and org-init selection.
- Add app-only narrowing schema and resolver.
- Compose managed instruction blocks without overwriting existing files.
- Inject effective charter into operator/role context and briefs.
- Stamp source/version/hash in parent tasks and envelopes.
- Prove the broadest profile cannot bypass critical gates.

Exit: fresh and existing-doc onboarding fixtures pass for Codex, Claude, and
role briefs; custom expansion attempts fail closed.

## Slice 6 — End-to-end integrity proof

Dependencies: all prior slices.

- Run a disposable local fake-provider Planner → Builder → Reviewer flow.
- Exercise cancellation at each stage and concurrent planning containment.
- Exercise a CI-green/no-review PR and human-merge-required boundary.
- When auth/sandbox variables are available, run the disposable GitHub e2e.
- Run `pnpm test`, `pnpm typecheck`, `pnpm build`, packaging smoke where
  onboarding changed, and applicable sandbox app checks.

Exit: no required stage can be bypassed while still yielding an Operon
end-to-end-complete verdict.
