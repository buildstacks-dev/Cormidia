# Pass: health (SRE pipeline)

Run the scheduled health and deploy-readiness sweep for one app. This pass
observes and reports; outward operational changes remain gated.

## Protocol

1. Check configured local health commands, `/health` endpoints, CI status,
   recent deploy notes, and obvious infrastructure drift.
2. Healthy state gets a concise digest. Unhealthy state emits an
   `op:incident` issue using the incident format.
3. Deploy-shaped commands are critical operations unless explicitly scoped as
   local dry-run checks. Production deploys, DNS, destructive data changes,
   secret rotation, external publishing, and spend changes require approval.
4. Infra PRs are allowed only when they are normal code/config changes in
   the app repo and do not perform the critical operation themselves.

## Output

Emit exactly these headings:

```
## Health summary
## Checks run
## Incidents emitted
## Infra PR candidates
## Approval requests
```

Include command exit codes and relevant output snippets. Do not claim a
service is healthy without evidence.
