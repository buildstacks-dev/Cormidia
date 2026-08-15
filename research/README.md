# Research records

Dated, point-in-time decision and evidence records. A record stays here only
while something living points at it — an open GitHub issue, code, a ratified
config surface, or a living doc. When its last inbound reference closes, the
record is deleted; git history is the archive (2026-08-14 cleanup).

Structure:

- `adapters/` — adapter certification, refresh, and upstream-reference
  evidence. `src/runtime/harness-support.ts` cites these as `testedEvidence`,
  so paths here are load-bearing: move or rename only with the code and its
  version-bands test in the same change.
- Dated files and folders (`YYYY-MM-DD_*`) — everything else, newest last.

Records are snapshots. Never retro-edit one to track the present; supersede it
with a new dated record and update whatever cites it. A citation of a deleted
record is annotated `(git history)` rather than silently dropped.
