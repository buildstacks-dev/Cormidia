# Contract — B-05 OS scheduler host (launchd today)
Canonical ID: **CORMIDIA-C-B05-001 (alias: B-05)**

Status: DRAFT (Phase 4). Defends INV-008/014, T-9. Journeys J-09/J-16/J-18.

## 1. Valid inputs
- `scheduler install|uninstall`: preview by default; execution requires `--execute
  --confirm <scheduler-id>` (reported identity or exact org name). Wrong/missing
  confirm → typed refusal, audit row only.
- Generated definition: absolute executable/package/org-home/state-home paths; **no
  credentials, no inherited environment dump** `[doc]`.

## 2. Output guarantees
- Install/uninstall preview lists the exact definition and identity; execution touches
  exactly the owned definition (INV-010 spirit: host mutation stays inside named scope).
- `status` = **joined evidence**: ownership/hash/cadence validation + loaded/active
  manager state + recent durable ticks + duplicate/orphan checks + provider settlement
  agreement. A definition file alone is never "healthy" (INV-008).

## 3. Error behavior
- Distinct, typed: definition present but not loaded; loaded under wrong identity;
  duplicate/orphan definitions; stale definition hash; no recent tick evidence. Each is
  a named unhealthy state, never collapsed into one "unhealthy" blob.

## 4. Idempotency
- Install re-run over an identical owned definition: idempotent. Over a foreign or
  drifted definition: refusal, not overwrite.
- Uninstall of an absent definition: typed no-op with reason.

## 5. Timing / ordering
- **Configured cadence** ~5 min (`StartInterval: 300`) — a setting, never a guaranteed
  firing cadence; tick evidence written per actual firing (exact-once invocation
  records); missed windows reconcile per B-06 contract.
- Tick environment (identity, env, PATH, cwd) is part of the definition contract —
  "works manually" with a divergent host environment is a named failure class
  `[elicited]`.

## L3 obligation (launchd only)
Uniquely identifiable test definition → prove loaded identity + attributable tick
evidence → remove exactly that definition. systemd gains its own proof when the droplet
shape is supported. `[elicited]`
