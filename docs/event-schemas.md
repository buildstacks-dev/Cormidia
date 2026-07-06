# Event Schemas

File-drop events live under `~/.operon/<org>/state/events/inbox/*.json`.
The dispatcher transports them as `alert-webhook` events and deduplicates by
filename. The payload's `kind` field tells the routed role how to interpret
the company-lifecycle event.

All event payloads share these fields:

```json
{
  "kind": "support-feedback",
  "id": "evt_20260706_001",
  "app": "operon-sandbox-gamma",
  "occurred_at": "2026-07-06T12:00:00Z",
  "source": "fixture"
}
```

Supported `kind` values are:

| Kind | Routed consumer | Purpose |
| --- | --- | --- |
| `support-feedback` | Support digest, then Planner groom | User questions, complaints, bug reports, churn risk, praise |
| `adoption-signal` | Marketing `ci-sweep`, then Planner groom | Usage, activation, churn, conversion, or engagement movement |
| `health-alert` | SRE incident pipeline | Service health or CI/deploy alert material |
| `launch-calendar` | Marketing release/weekly sweep | Planned launch, announcement, or campaign date |

## `support-feedback`

```json
{
  "kind": "support-feedback",
  "id": "feedback-001",
  "app": "operon-sandbox-gamma",
  "occurred_at": "2026-07-06T12:00:00Z",
  "source": "fixture",
  "severity": "medium",
  "channel": "email",
  "summary": "User cannot tell whether /health failure is transient.",
  "excerpt": "Is this expected during deploy?",
  "user_ref": "user-123"
}
```

`severity` is `low`, `medium`, or `high`.

## `adoption-signal`

```json
{
  "kind": "adoption-signal",
  "id": "adoption-001",
  "app": "operon-sandbox-gamma",
  "occurred_at": "2026-07-06T12:00:00Z",
  "source": "fixture",
  "metric": "weekly_active_checks",
  "direction": "up",
  "value": 42,
  "summary": "Health endpoint checks doubled after the last release."
}
```

`direction` is `up`, `down`, or `flat`.

## `health-alert`

```json
{
  "kind": "health-alert",
  "id": "health-001",
  "app": "operon-sandbox-gamma",
  "occurred_at": "2026-07-06T12:00:00Z",
  "source": "fixture",
  "severity": "critical",
  "service": "web",
  "status": "down",
  "summary": "/health returned 500 for three consecutive checks."
}
```

`severity` is `low`, `medium`, `high`, or `critical`; `status` is
`healthy`, `degraded`, or `down`.

## `launch-calendar`

```json
{
  "kind": "launch-calendar",
  "id": "launch-001",
  "app": "operon-sandbox-gamma",
  "occurred_at": "2026-07-06T12:00:00Z",
  "source": "fixture",
  "date": "2026-07-20",
  "milestone": "sandbox gamma smoke",
  "summary": "Prepare draft release notes after the smoke passes."
}
```

The `date` field is `YYYY-MM-DD`.
