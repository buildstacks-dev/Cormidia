# Contract — B-16 Gate/command-runner ↔ app toolchain
Canonical ID: **OPERON-C-B16-001 (alias: B-16)**

Status: DRAFT (Phase 4). Defends INV-008/012, T-9. Journey J-04 (mechanical gates).

## 1. Valid inputs
- Gate commands come from `.operon/config.yaml` top-level gate keys (never under
  `apps.<name>`) `[doc]`; risk-tiering per `.operon/policy.yaml`.
- Commands run in the turn's worktree with the non-interactive environment overlay;
  dependency builds denied by default (`PNPM_CONFIG_IGNORE_SCRIPTS`); a ticket opts in
  via `setup_command` `[doc]`.
- Bare-template apps: required test/lint gates are explicitly pending and **fail
  closed** until the first implementation configures real commands `[doc]` — pending
  never reads as pass.

## 2. Output guarantees
- Per gate: recorded exit code, captured output (bounded), duration, and the exact
  command+worktree identity — machine-checkable evidence tied to the candidate
  (INV-008/012; no prose ever drives a side effect).
- Output bounds are **ratified, three distinct surfaces** `[doc]`: local gate capture —
  newest **256 KiB and 50 lines**; PR rendering — **8,000 characters per gate**;
  exportable envelope — **2,000-character output tail**. (No invented 1 MiB cap.)

## 3. Error behavior
- Exit ≠ 0 → gate failed; timeout → killed process group, gate failed (never pass,
  never hang forever). **Contract: every gate has an explicit bounded timeout,
  surfaced in its evidence**; governed app configuration may set its own bound.
  **Human-ratified defaults at HB-007 review 2026-07-31:** setup/tests 5 min, lint
  2 min, e2e 10 min. The GitHub Actions core-job ceiling is 15 min and is not a
  per-gate default.
- Required tool unavailable → typed environment failure, distinguished from a genuine
  red gate.
- Runaway children/output flood: process-group kill + truncation marker (B-07 grouping).

## 4. Idempotency
- Gates are re-runnable; ship-time gates run twice (after build passes and at ship)
  `[doc]`; a re-run's evidence supersedes by candidate identity, never by overwrite of
  the prior record.
- **Candidate mutation by a gate command:** gates are not entitled to mutate the
  candidate. Detection binds to **candidate HEAD plus tracked/decision-relevant diff
  and explicitly governed generated paths** — mutation there is a named failure
  (fails the run, surfaces the diff); ignored tool residue (caches, dependency dirs)
  is NOT automatically candidate corruption. This mechanism/scope was
  **human-ratified at HB-007 review 2026-07-31**. `[elicited]`

## 5. Timing
- Gates run between passes and twice at ship `[doc]`; freshness: gate evidence binds to
  the exact candidate SHA it ran against (INV-009 adjacency).
