# Implementation prompt — Operon Reporting V1

Copy the prompt below into a fresh Codex session after reviewing the proposed
design. Sending it is the explicit owner-ratification step referenced by the
design.

---

Implement Operon Reporting V1 end to end in this repository.

By sending this prompt, I explicitly approve and ratify
`docs/reporting/design.md` version 0.1 as the implementation contract. Add a
concise high-level reporting decision to the Decided section of
`docs/PURPOSE.md`, but keep detailed behavior in the reporting design. Do not
silently change any other human-ratified surface (`TASTE.md`, `roles.yaml`,
`pipelines.yaml`, or `prompts/**`). If the implementation reveals a genuine
contradiction with an existing ratified decision, stop and show me the exact
conflict; otherwise make reasonable implementation choices and finish the
work autonomously.

Read, in this order, before editing:

1. `AGENTS.md`
2. `docs/PURPOSE.md`
3. all of `docs/reporting/design.md`
4. the relevant contracts in `docs/live-ui/design.md`, especially §§3, 5–11
5. `src/runtime/telemetry.ts`
6. `src/runtime/runlog/status.ts`
7. `src/cli/telemetry.ts`
8. `src/org/budget.ts`
9. `src/observe/types.ts`, `project.ts`, `file-index.ts`, `live-source.ts`,
   `server.ts`, `assets.ts`, and `src/cli/observe.ts`
10. the corresponding telemetry, budget, Observe server/project/browser, CLI,
    packaging, and fixture tests

First inspect the environment and current git status. This is often a host
machine and the worktree may contain user changes; preserve unrelated work and
never reset or overwrite it.

## Outcome

Deliver a deterministic, token-free reporting surface that lets an org owner
answer, for the active org or one registered app and a selected period:

- how many known input/output/total tokens were consumed;
- how much provider-reported versus Operon-estimated equivalent cost was
  recorded;
- where usage went by app, role, runtime/model, pipeline/pass, trigger, status,
  and quality;
- how usage changed over time;
- how many sessions and provider turns ran and what their outcomes/integrity
  were;
- the exhaustive list of sessions and the turns/mechanical passes in each;
- which totals are complete, partial, estimated, unavailable, unmeasured,
  legacy, corrupt, duplicate, unsettled, or missing detail because of
  retention;
- how current-month app spend compares with current monthly budget without
  comparing a multi-month total directly to one monthly cap.

## Public contract to implement

Add:

```text
operon report [--app <name>]
              [--period 7d|30d|90d|1y|all]
              [--since YYYY-MM-DD] [--until YYYY-MM-DD]
              [--bucket auto|day|week|month]
              [--json] [--html <path>] [--open]
              [--summary-only]
              [--org-home <path>] [--state-home <path>]
```

Required semantics:

- omitted `--app` means active-org scope;
- default is trailing 90 UTC calendar days including today;
- presets/custom bounds and auto buckets exactly follow the reporting design;
- authoritative period membership and accounting totals come from
  `telemetry/<date>.jsonl` using `TurnRecord.at`;
- do not add cache-read/cache-creation tokens to `tokensIn + tokensOut`;
- keep provider-reported, estimated, partial, and unknown cost visible;
- never treat unmeasured/unavailable zero placeholders as free or known zero;
- report, but do not silently deduplicate, repeated `(app, runId)` ledger rows;
- never reconcile or mutate Operon state during report generation;
- group presentation sessions parent task first, trace second, orphan run
  last; keep legacy uncorrelated ledger rows in Unattributed;
- provider-native session IDs are evidence, never grouping keys;
- include mechanical pass envelopes in session detail without calling them
  provider turns or adding fake zero-token turns;
- terminal output is concise; JSON and full HTML are exhaustive unless
  `--summary-only` is explicit;
- portable HTML is one self-contained, responsive, accessible, print-friendly
  file with no external requests and no L3 prompts/briefs/outputs/activity
  logs; use CSP hashes or an equivalently strict generated policy for inline
  executable assets rather than broad `script-src 'unsafe-inline'`;
- `--open` requires `--html` and opens only after an atomic successful export.

Keep `operon telemetry` fully backward compatible. It remains the envelope-
first forensic trace/evidence report. `operon report` is the ledger-first
management/usage report.

## Browser/server contract

Use one server and two clearly labeled modes:

- existing `/` remains the backward-compatible Live UI;
- add `/reports` for Reports;
- add Live/Reports primary navigation;
- use the same loopback listener, capability token/cookie, headers, and GET/
  HEAD-only safety boundary;
- construct reporting lazily—`operon observe` startup must not scan historical
  ranges;
- Reports are explicit as-of snapshots with Refresh, not SSE-updating live
  totals;
- preserve `operon observe --app` as an immutable server-side scope: that
  observer may report only the selected app, while an unscoped observer may
  report the org or any registered app;
- add authenticated summary, paged session list, session detail, HTML export,
  and JSON export GET endpoints as designed;
- use bounded in-memory caching and source fingerprints; persist no report
  database/index/session store;
- do not add `operon report --serve`, another listener, a daemon registry, or
  running-observer discovery;
- report failures must not break Live, and observer/report shutdown must not
  affect a running Operon turn.

The report UI must contain:

- org/app/range/bucket controls in URL state;
- first-position data-quality panel;
- headline token/cost/turn/session/budget metrics;
- token and cost trends with accessible equivalent tables;
- allocation breakdowns;
- evidence-backed operating-health distributions, never a synthetic score;
- org portfolio table or app-focused report;
- sortable/filterable/paged session index;
- exhaustive per-session activity detail;
- safe served HTML/JSON downloads for the current query;
- keyboard, focus, reduced-motion, 360 px, desktop, print, malicious-string,
  and no-external-request behavior.

Do not add a runtime UI/charting dependency. Use the existing framework-free
approach, semantic HTML, CSS, small JavaScript, and inline SVG/table fallbacks.
Keep TypeScript strict and dependencies minimal.

## Implementation order

Work in vertical phases and keep tests green:

1. **Pure contract and facts**
   - Add versioned report/range/session/quality types.
   - Add strict UTC range normalization and statistics helpers.
   - Add a daily ledger range reader that returns rows plus torn/corrupt/
     unreadable/concurrent-write diagnostics.
   - Add direct envelope/task/event enrichment and a bounded unsettled-envelope
     scan.
   - Add deterministic session grouping and pure report projection.
   - Pin all accounting, quality, identity, ordering, retention, legacy, and
     corruption semantics with fixture/fake-clock tests.

2. **CLI and portable export**
   - Add `src/cli/report.ts`, registry/help/capabilities wiring.
   - Add concise terminal, stable snake_case JSON, and exhaustive portable
     HTML renderers.
   - Use atomic output replacement and safe browser-open handling.
   - Test escaping, CSP, no network, no L3, accessibility semantics, print,
     every selected turn exactly once, and summary-only behavior.

3. **Integrated Reports mode**
   - Add a lazy report service and mount it into the existing observer server.
   - Preserve existing `/`, Live snapshot/SSE, artifact routes, and all current
     behavior.
   - Add report routes/assets/UI, paging, fingerprints/resync, bounded caching,
     explicit refresh, and exports.
   - Add cross-links between served report sessions/passes and Live historical
     views without assuming a stable observer URL in portable HTML.

4. **Convergence and docs**
   - Add the concise ratified decision to `docs/PURPOSE.md`.
   - Update README commands, reporting versus Observe/telemetry/budget
     explanation, observability inventory, and project map/nearest AGENTS
     guidance if the final architecture or test workflow changed.
   - Preserve existing telemetry stable output; if sharing helpers, prove it
     with existing and added compatibility tests.
   - Extend installed/onboarding smoke coverage so report CLI and browser
     assets work from a neutral cwd and packed install.

## Required tests and difficult cases

Use the existing `makeOrgHome` and fake-clock fixtures rather than ad-hoc real
homes. At minimum cover every case listed in §17 of the design, including:

- leap/month/year/date boundaries and 45/46, 180/181 bucket edges;
- org/app/cross-app parent-task scope;
- parent task, standalone trace, orphan run, and unattributed legacy row;
- complete/estimated/partial/unavailable/unmeasured usage;
- cache fields without token double counting;
- duplicate settlement key without hidden dedupe;
- mechanical envelope without ledger row and terminal unsettled usage;
- settled row whose envelope/events were pruned;
- task completion with interrupted retry history;
- current-month agreement with `rollupBudgets` at a fixed clock;
- corrupt mid-file line, torn tail, unreadable day, concurrent append, invalid
  and future timestamps;
- source change while paging;
- invalid capability/route/app/range/session/cursor;
- report service lazy startup and bounded cache/DOM/response behavior;
- malicious objective, model, refs, and preview text;
- no report endpoint or CLI action mutates state or affects a running pass.

## Verification

Run all required repository checks after implementation:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm test:observe-browser
pnpm smoke:onboarding
npm pack --dry-run
```

Also generate fixture reports for org 7d/90d/1y and one app, inspect the HTML
at 360 px and desktop with reduced motion, and verify print behavior and zero
external requests. Do not run token-spending live adapter tests. Do not touch a
real org state home or GitHub during automated tests.

If an owner-selected real state home is available and clearly authorized for
read-only acceptance, generate reports without modifying it and manually
reconcile:

- current-month app totals against `operon budget` semantics;
- sampled sessions/turns against `operon telemetry --json`;
- legacy/pruned/unmeasured disclosures.

That acceptance does not authorize `--reconcile`, provider turns, GitHub
mutations, approval decisions, merges, deploys, or external uploads.

## Completion and handoff

Do not stop after scaffolding or a visual demo. Finish the deterministic data
contract, CLI, portable HTML, integrated browser mode, tests, docs, packaging,
and verification. In the final response lead with the completed outcome, list
the important files, report exact commands/results, call out any measured
performance/data-quality limitations, and distinguish unrun read-only real-
state acceptance from completed offline proof.
