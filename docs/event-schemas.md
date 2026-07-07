# Event Schemas

File-drop events live under `~/.operon/<org>/state/events/inbox/*.json`.
The inbox file is the transport and dedup identity (deduplicated by filename),
but the dispatcher **routes on the payload's `kind`**: `readInbox`
(`src/org/events.ts`) parses each file with `parseCompanyLifecycleEvent`
(`src/org/event-schemas.ts`) and surfaces the typed company-lifecycle kind,
which the dispatcher then matches against roles.yaml `event:` triggers exactly
like a GitHub-polled kind. So the `kind` field decides both which role(s) wake
and how they interpret the event. A payload that fails the contract (bad JSON
or a missing/invalid field) is surfaced loudly as an `error_event_source` and
skipped — never silently dropped; sibling files keep flowing. A kind no role
subscribes to is recorded as unsubscribed, not an error.

All event payloads share these fields. The `app` value is a routing target:
the inbox file is only offered to the app with the same name, so one
company-lifecycle drop cannot wake unrelated live apps that happen to subscribe
to the same event kind.

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

The routed consumers below are the roles.yaml subscribers each kind wakes
(via `src/org/trigger-routing.ts`):

| Kind | Routed consumer | Purpose |
| --- | --- | --- |
| `support-feedback` | Support `support-digest` + Planner `groom` | User questions, complaints, bug reports, churn risk, praise |
| `adoption-signal` | Marketing `ci-sweep` + Planner `groom` | Usage, activation, churn, conversion, or engagement movement |
| `health-alert` | SRE `sre-incident` | Service health or CI/deploy alert material |
| `launch-calendar` | Marketing `marketing-release` | Planned launch, announcement, or campaign date |

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
