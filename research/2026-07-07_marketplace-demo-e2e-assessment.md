# Marketplace Demo E2E Assessment

Date: 2026-07-07

## Objective

Validate Operon end to end by creating and operating a private GitHub-backed
local ecommerce demo: catalog, customer registration, vendor registration,
agent-driven build/review/merge, local publication, and Support/Marketing/SRE
role evidence.

## Demo Product

- Private repo: `https://github.com/bikramgupta/operon-marketplace-demo`
- Local clone: `/Users/bikram/Build/operon-marketplace-demo`
- Local URL: `http://localhost:4173`
- Repo visibility verified: `PRIVATE`
- Main head after validation artifacts: `47743f5 Record agent ops validation artifacts`
- Product merge commit: `ff2dcf8 Build marketplace registration and persistence workflows (#1)`

The app is framework-free TypeScript. It renders six dummy products across
multiple vendors, validates customer and vendor registration forms, persists
both flows to localStorage, and renders the saved records.

## Build Loop Result

- Issue #1 was created for marketplace registration and persistence.
- Operon Builder produced the implementation branch and PR #2.
- Gates ran `setup`, `npm test`, `npm run lint`, completeness, and review
  freshness.
- Reviewer ran after the Claude reset window and posted an HMAC self-approval
  fallback review.
- The loop squash-merged PR #2 and closed issue #1 at
  `2026-07-07T05:27:33Z`.
- Builder memory was committed in the product PR.

## Human-Style Browser QA

Using `agent-browser` against `http://localhost:4173`:

- Verified all six products render.
- Filtered catalog by `Pivot`.
- Registered customer `Ada Buyer <ada@example.com>` with interest `wellness`.
- Registered vendor `Acme Goods <vendor@example.com>` with category
  `Home goods`.
- Reloaded the page and verified both records persisted.

Browser screenshot capture hung twice; functional DOM text checks were used
instead.

## Role Evidence

Marketing:
- `ci-sweep` ran from the adoption-signal event and produced an internal
  adoption digest. It correctly refused outbound publishing and protocol/memory
  self-editing without approval.
- `marketing-release` ran from the launch-calendar event. Its durable output
  was terse, but it created memory
  `.operon/memory/marketing/release-evidence-sourcing.okf.md`.

SRE:
- `sre-incident` ran from the health-alert event.
- It wrote `.operon/incidents/20260707T053353Z-health-alert.md`.
- It ran `npm test`, `npm run lint`, and attempted a local start on `PORT=4174`;
  the alternate-port bind failed with `EPERM` in the agent environment and was
  recorded as environment evidence, not a product failure.

Planner:
- `groom` ran from support-feedback.
- It created issue #3, `Add support-feedback intake flow (validate, persist,
  render)`, labeled `op:ready`, `op:tier-standard`, `p2`, `enhancement`.
- This is a valid self-improvement result: the agents identified README/product
  drift and queued the next iteration instead of fabricating support data.

Support:
- Dispatch fan-out consumed the support-feedback event before Support could run
  naturally, so a support event journal was created manually for validation.
- `support-digest` completed and wrote
  `.operon/incidents/20260707T054000Z-support-digest.md`.
- Support correctly refused to invent a user reply because no real feedback
  payload reached the product yet.

The role artifacts were committed and pushed in
`47743f5 Record agent ops validation artifacts`.

## Validation Commands

Operon:
- `corepack pnpm test` -> 573 tests passed.
- `corepack pnpm typecheck` -> passed.
- `corepack pnpm dev apps` -> passed, 7 apps.
- `OPERON_CODEX_LIVE=1 corepack pnpm exec vitest run --config vitest.live.config.ts test/runtime/codex-app-server.live.test.ts` -> 1 live Codex smoke passed.

Demo app:
- `npm test` -> 8 tests passed.
- `npm run lint` -> passed.
- Browser QA passed against merged `main`.

GitHub:
- PR #2 merged.
- Issue #1 closed.
- Issue #3 opened and ready for the next iteration.

## Issues Found

1. Codex App Server emitted `mcpServer/elicitation/request`; Operon did not
   support it and live loop turns failed. Fixed in
   `src/runtime/adapters/codex.ts` by declining elicitation requests, with a
   unit test and a live Codex smoke.

2. File-drop event routing ignored the payload `app` field, so marketplace
   events initially routed to `operon-sandbox-alpha`. Fixed in
   `src/org/events.ts` with regression coverage and docs update.

3. Dispatch event fan-out is lossy under WIP limits. One `support-feedback`
   event matched Planner and Support, but the event was marked consumed after
   Planner spawned, before Support got a turn. Support had to be exercised with
   a manual event journal. This should be fixed before relying on multi-role
   event fan-out.

4. Dispatched role briefs do not include the original file-drop event payload.
   Marketing, SRE, Planner, and Support all had to infer from repo state and
   trigger metadata. This limits support/marketing usefulness and should be
   addressed.

5. Browser rendering bug escaped Node-only gates: `src/main.ts` imported
   `./domain` in built browser JS, causing the catalog not to render in the
   browser. Fixed in the app PR by using `./domain.js` and adding a regression
   test that inspects the built browser entry.

6. Completeness gate treated unchecked GitHub task-list acceptance criteria as
   incomplete even when the implementation was done. I manually checked the
   issue boxes and requeued. This is strict but operationally rough.

7. A Claude session limit interrupted the first reviewer turn and left a
   `running` runlog envelope. Retrying after the reset merged successfully, but
   stale runlog status remains an observability gap.

8. The single-account GitHub flow needs `OPERON_SELF_APPROVAL_SECRET` to merge
   via the HMAC fallback when GitHub rejects self-approval. The successful merge
   used an ephemeral process-only secret.

9. Protocol/self-edit gating is broad. Planner and Marketing both hit
   `protocol-self-edit` gates while trying to write memory/spec artifacts. This
   may be desired, but it makes routine spec/memory work noisy.

10. Screenshot capture with `agent-browser screenshot` hung in this session.
    Text-based browser assertions were sufficient for this validation.

## Assessment

Operon can create, build, review, gate, merge, locally publish, and operate a
new private-repo product through its agents. The core build loop succeeded
end-to-end after two runtime/routing fixes and one quota retry. Marketing, SRE,
Planner, and Support all ran and produced durable artifacts or tickets, but
company-event handling needs another iteration before it is trustworthy for
real multi-role operations.

