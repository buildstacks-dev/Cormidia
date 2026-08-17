# Event Schemas

File-drop events live under `~/.cormidia/<org>/state/events/inbox/*.json`.
The inbox file is transport only. Under F-PT-006's owner-ratified 2026-08-12
rule and the owner's 2026-08-16 identity-field clarification, dedup identity is
content-derived: `sha256` over canonical sorted-key producer payload after
removing transport `filename` and producer `id`. All other fields remain
identity-bearing: fresh-id retries collapse, while a non-`id` content change is
a different event. The top-level `id` stays required and reaches the selected
turn as provenance; the first filename in stable sort order supplies the
payload for a duplicate group. Nested `id` and unknown validated JSON fields
remain identity-bearing. Producers owe no atomic rename, so partial JSON remains
loudly retained and retryable after repair. The dispatcher **routes on the
payload's `kind`**: `readInbox`
(`src/org/events.ts`) parses each file with `parseCompanyLifecycleEvent`
(`src/org/event-schemas.ts`) and surfaces the typed company-lifecycle kind,
which the dispatcher then matches against roles.yaml `event:` triggers exactly
like a GitHub-polled kind. So the `kind` field decides both which role(s) wake
and how they interpret the event. The `COMPANY_EVENT_KINDS` registry in
`src/org/event-schemas.ts` is closed: a string that is not listed is rejected,
not treated as an unwatched event. Sibling inbox files keep flowing after any
one rejection.

`cormidia dispatch` uses these exact classifications:

| Input | Dispatch code | Behavior |
| --- | --- | --- |
| Bad JSON, a non-object value, or a registered kind with a missing/invalid field | `malformed_company_event` | Error; file stays unconsumed for repair |
| A syntactically valid envelope whose `kind` is not in `COMPANY_EVENT_KINDS` | `unknown_company_event_kind` | Error; file stays unconsumed for repair |
| A valid registered kind with no current roles.yaml `event:` subscriber | `no_subscriber` | Non-error skip; file stays pending and is reported again next tick |
| A valid registered kind with at least one current subscriber | no skip/error reason | One turn per eligible subscriber; retire after every current subscriber consumes it |

The first two are source-contract errors and make the dispatch command fail.
Classification validates the shared envelope first, then registry membership,
then kind-specific fields: an incomplete payload that merely names an unknown
kind is `malformed_company_event`, while a complete shared envelope with that
kind is `unknown_company_event_kind`.
`no_subscriber` is also the durable scheduler decision reason. The CLI prints
the codes verbatim (`error ...: <code>:` or `skip no_subscriber: ...`), so
operator guidance, dry-run output, and scheduler evidence use the same names.
An invalid transport filename uses the separate `invalid_event_transport`
code; an upstream GitHub polling failure remains `error_event_source`.

All event payloads share these fields. The `app` value is a routing target:
the inbox file is only offered to the app with the same name, so one
company-lifecycle drop cannot wake unrelated live apps that happen to subscribe
to the same event kind.

```json
{
  "kind": "support-feedback",
  "id": "evt_20260706_001",
  "app": "sandbox-gamma",
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
  "app": "sandbox-gamma",
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
  "app": "sandbox-gamma",
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
  "app": "sandbox-gamma",
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
  "app": "sandbox-gamma",
  "occurred_at": "2026-07-06T12:00:00Z",
  "source": "fixture",
  "date": "2026-07-20",
  "milestone": "sandbox gamma smoke",
  "summary": "Prepare draft release notes after the smoke passes."
}
```

The `date` field is `YYYY-MM-DD`.
