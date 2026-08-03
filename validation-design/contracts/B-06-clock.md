# Contract — B-06 Clock & calendar time (sealed seam)
Canonical ID: **CORMIDIA-C-B06-001 (alias: B-06)**

Status: DRAFT (Phase 4). Defends INV-013/014/015 branches, T-5/T-9. All time-driven journeys.

## 1. Valid inputs
- All time reads flow through one injectable clock source (test double in L2). Direct
  wall-clock reads outside it are a harness-detectable defect (structural check).

## 2. Output guarantees
- UTC governs day/month windows (ledger days, budget months, retention sweeps);
  scheduling cadence uses host time `[doc]` — the two are never conflated in one
  computation.
- Missed windows: one reconciled firing keyed by **(app, role, trigger, window)** with
  the missed-window count — never one firing per missed window `[doc][walk]`.
- The schedule slot is normalized independently of the five-minute host cadence and
  binds one durable settlement identity. Repeated ticks in the same slot cannot create
  a second independent attempt; retry is explicit and bounded under that identity.
  <!-- changelog 2026-07-31 (audit AUD-101): rambling tag corrected to walk — the
  clause traces to the stakeholder's Phase 1 walk (elicitation-log), not rambling.txt. -->

## 3. Error behavior (anomaly semantics)
- Backward wall-clock jump / NTP forward jump / DST / timezone change — **anomaly
  response, owner-ratified (2026-07-31, `[simulated]` seat; human-ratified by
  adoption 2026-07-31):** uncertainty about freshness fails closed and is recorded durably; a
  clock jump must never manufacture permission to delete, force, expire, or admit spend
  (INV-015).

## 4. Idempotency
- Window-keyed operations (daily sweep, monthly rollover) are keyed by window identity,
  so a repeated firing within one window is a no-op with a durable reason (INV-014).

## 5. Timing numbers (ratified where cited)
- **Configured** tick cadence ~5 min (a setting, not guaranteed firing — B-05) `[doc]`; grant TTL 24 h `[doc]`; `--force` stale-heartbeat
  threshold 10 min `[doc]`; runs/ retention 30 days `[doc]`; episodes retention 180 days
  `[doc]`; report default window 90 UTC days `[doc]`.
- Active-turn heartbeat cadence: **30 s** `[doc]` (ratified, not proposed).
- Lock freshness: a lock under **2 min** old is fresh; older enters recovery `[doc]`.
  The **10-min** threshold belongs ONLY to the narrow destructive `--force` path — it is
  not the ordinary liveness threshold.
