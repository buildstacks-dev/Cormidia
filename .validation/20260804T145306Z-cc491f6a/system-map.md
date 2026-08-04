# System map

The assessed implementation preserves the established import direction
`src/org` → `src/loop` → `src/runtime`. Runtime owns provider-safe permission
types and adapter application; org owns app-policy parsing and resolution; loop
consumes only ephemeral resolved limits.

| Component | Responsibility | Assessed boundary |
| --- | --- | --- |
| `src/org/apps.ts` and `app-execution-policy.ts` | Parse, default, validate, serialize, and resolve per-app policy | B-10 configuration boundary before paid work |
| Codex and Claude adapters | Apply one resolved non-bypass permission mode | B-02/B-03 provider construction and Cormidia gate independence |
| Pipeline budget envelope | Narrow turn cost/time/tool/model allowances and persist actual values | T-5 turn admission, hard enforcement, durable evidence |
| Generic and ticket episode entry points | Resolve independently configured hard ceilings | EpisodeIntent authority, ledger remainder, and restart safety |
| Static route admission | Resolve quick/standard/deep execution bounds monotonically | Non-planning route record and in-loop enforcement |
| GitHub routing audit | Classify every open issue and preserve exact exclusions | Current-label fail-closed Planner/Builder scheduling |
| HB-111 proposal | Record exact protected diff, migration, rollback, and golden impact | Human approval and human-merge boundary; no protected edit applied |

No new journey, boundary, invariant, or product-truth finding was introduced.
The affected existing contracts are B-02, B-03, B-10, C-CORE, and the accepted
validation-lifecycle authority used by HB-111.
