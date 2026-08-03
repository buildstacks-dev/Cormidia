# Sandbox Approval E2E — 2026-07-06

Purpose: exercise the M7 approval surface end to end with a sandbox app tag
without spending live model tokens or touching a sandbox repo's committed
configuration.

Runtime home: isolated temp dir
`/var/folders/dj/h7_rbnvs6cjd8hqbrx51gnvc0000gn/T/tmp.jmhvdoLwR9`.

Flow:

1. Composed the effective gate for `app=operon-sandbox-alpha`,
   `role=builder`, `turnId=approval-e2e`.
2. Attempted a benign critical-class action:
   `write { path: ".cormidia/config.yaml", content: "schema_version: 1\n" }`.
3. `defaultGate` denied it as `protocol-self-edit`, and `composeGate`
   persisted one pending approval item:
   `{"pending":1,"pendingId":"approval-e2e"}`.
4. Approved through the real CLI:
   `printf 'a\n' | pnpm dev approvals --home <tmp> review`.
5. Retried the exact same action through the composed gate. The single-use
   grant admitted it once, the simulated operation counter incremented once,
   and the grant was consumed.

Final audit evidence:

```json
{
  "executed": 1,
  "pending": 0,
  "grantUses": 0,
  "logTypes": ["raised", "decided", "grant-minted", "grant-consumed"]
}
```

This proves the approval contract at the gate/queue boundary: approval does
not execute anything by itself; it mints a single-use action-hashed grant that
only a later matching retry can consume.
