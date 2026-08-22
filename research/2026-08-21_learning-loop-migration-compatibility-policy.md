# Learning-loop migration — phase A: compatibility policy and dependency identity

**Date:** 2026-08-21
**Status:** recorded decision for Cormidia #467 (extraction stream 4, phase A), mirrored by
governed-learning-loop#14. Authorized by the owner's phase-A campaign instruction (2026-08-21);
the 2026-08-16 extraction session recorded that no Cormidia code changes were authorized under
it — this campaign is the separate, explicit authorization.
**Scope of this record:** which existing learning artifacts are preserved byte-exact, which are
read through a compatibility reader, where the kernel's own records live, and the semantic
deltas phase B's parity audit must close. The adapter contract itself is
`validation-design/contracts/B-32-learning-kernel-ports.md`.

## 1. Dependency identity

| Fact | Value |
| --- | --- |
| Package | `@cormidia/learning-loop` `0.1.0` (`github.com/cormidia/governed-learning-loop`) |
| Mechanism | exact vendored tarball, `dependencies["@cormidia/learning-loop"] = "file:vendor/cormidia-learning-loop-0.1.0.tgz"` (governed-learning-loop Decision 0029 R7; the `validation-architect` precedent) |
| Source tree | `13258c2757b30501b7c82c76bc8f1b091f4d5d0e` — governed-learning-loop PR #63 (`b766b3257178b190e18f3231022a5b3fe7c9aaad`, the version bump over `11852d0`); a one-commit branch squashes to the identical tree, so the tarball packed at the `v0.1.0` squash commit is byte-identical |
| Tarball | 654,851 bytes, 529 entries; SHA-256 `b782fd293146199813fa21ce6679948b5e4f7d0678fd92e3757bbb38d8231927`; npm integrity `sha512-HZiQE8AdffHh7fB2/827II7zRafPr3FfQNv1o9/rZuhN21kC8Zd68knsBqrNYZ1cegnoHYBuXkQ7SJ6ElGbIqg==` |
| Reproduction | two clean detached checkouts of the same commit, `pnpm install --frozen-lockfile --offline`, `rm -rf dist`, `pnpm pack` (prepack builds) — byte-identical |
| Tag / release | `v0.1.0` and its release asset are the maintainer's hand-cut actions (Decision 0029 R6/R8); pending at the time of this record |
| Packaged install | **Not installable through `npm install -g <cormidia tarball>` while the kernel is unpublished** (F-PT-042): npm resolves a `file:vendor/*.tgz` runtime dependency before the parent tarball is extracted (ENOENT), and `bundleDependencies` — which makes a local `npm install` of the tarball complete — reifies a damaged partial tree under `npm install -g` (npm 11.19). Development (`pnpm install --frozen-lockfile`), Core Checks, and the offline suite are unaffected; the release lane's `smoke:package` is red until the kernel is on a registry (governed-learning-loop #62) or the owner rules another mechanism. Moving to the registry is a one-line specifier change |

## 2. Where things live after phase A

```text
<org home>/learning/**              forked engine (unchanged) + OKF destination writes (bundle/**, manifest.yaml)
<app>/.cormidia/learning/**         same, per registered app
<state home>/learning/**            forked engine state (events, episodes, capsules, publish-journal, …) — read-only to the kernel path
<state home>/learning-loop/store/   kernel file store (createFileStore): candidates, reviews, plans, journal, interventions, resolutions, exposures
<state home>/learning-loop/receipts/<destination>/   destination idempotency receipts
<state home>/approvals/**           shared approvals store: forked `learning_publish` items AND kernel `learning_loop_publish` items
```

The adapter layer is `src/org/learning-loop/` (composition root `loop.ts`); the forked engine
`src/org/learning/` remains the only operator path (CLI, scheduler, context assembly) until
phase B. The kernel path is reachable in phase A only through `createCormidiaLearningLoop`.

## 3. Compatibility policy (the ruling this record makes)

### 3a. Active binding and publication artifacts — exact byte/state preservation

Covered: `learning_publish` approval items and grants, `<state>/learning/publish-journal/*`,
`learning/manifest.yaml` (both roots, including `history`, `canary`, `canary_meta`), activated
concepts under `learning/bundle/**`, `learning/interventions/int_*.json`,
`<state>/learning/resolved/<turn>.json`, `<state>/learning/canary/assignments/*`.

Rule: the kernel path never reads these to derive authority and never rewrites them. It adds
beside them, in shapes the forked readers already accept:

- a kernel publication is a new manifest history entry whose `approval_ref` is the kernel
  idempotency key (`sha256({planDigest, effectId})`) and whose concept file bytes are exactly
  what the forked publisher would write (`renderActivatedConcept` semantics); the forked resolver
  therefore serves kernel-published concepts unchanged (INV-013 manifest membership holds);
- a kernel authorization is a new approval item of the distinct tool kind
  `learning_loop_publish`; existing `learning_publish` items are untouched and stay valid for the
  forked publisher. In-flight forked approvals at cutover are **reauthorized** through the kernel
  (a new binding) rather than migrated — an approval binds bytes, and the kernel's binding covers
  a different closure (plan, lineage, policy digests) than the fork's (`candidate_hash`,
  `verdict_hash`, `final_diff_hash`, `base_manifest_version`). No compatibility reader will ever
  turn a `learning_publish` item into a kernel authorization.

### 3b. Broader history — compatibility reader, no migration

Covered: `<state>/learning/events/**`, `episodes/*`, `capsules/*`, `fingerprints/*`,
`metrics/*`, `candidates/*`, `reviews/*`, `rejections.jsonl`, `experiments/*`, `evals/**`,
`proposals/**`, efficiency evidence.

Rule: read through versioned, `unknown`-first adapters on the Cormidia side (the kernel
contract's own rule: "Cormidia compatibility readers remain in the Cormidia adapter"); never
rewritten, never re-digested in place. Phase A ships the episode reader
(`episode-evidence-record.ts` + `evidence-source.ts`); events, efficiency evidence, candidates,
reviews and experiments follow in phase B as further sources or as audit-only lineage. Forked
candidate/verdict/experiment records are never migrated into kernel Candidate/Review/Experiment
records — the kernel's versioning rule forbids exactly that ("schema-version-1 candidates have no
migration"); a kernel successor cites the forked record's content hash as lineage only.

### 3c. Kernel records — new, state-home only

Kernel records are new state under `<state home>/learning-loop/`; they are not in git. Whether
governed kernel records (interventions, plans, journal) need a committed org-home projection
for the "learning artifacts live in git" rule of spec §1 is a phase-B decision, taken with the
parity evidence.

## 4. Semantic deltas found in phase A (phase B parity audit input)

1. **Exact-scope evidence.** The kernel requires candidate evidence episodes to carry the
   candidate's exact scope. Cormidia episodes are app-scoped (`[org, app]`), so an org- or
   role-scoped candidate cannot cite app episodes under the kernel's rule. Phase B must decide:
   propose at app scope and promote, project per-role evidence, or ask the package for a
   policy-governed ancestor rule (its scope policy already models ancestry).
2. **Policy.** Only the kernel's `conservativePolicy()` carries rules today; Cormidia's
   `learning/policy.yaml` tiers (canary windows, budgets, distiller/reviewer schedules) are not
   mapped. Budgets, schedules and canary policy stay host-owned; the review/independence rules
   per tier need a kernel-side host policy constructor (package follow-up).
3. **Routine (T0) publishes** need an authority in the kernel; the fork publishes T0 without an
   approval item. Phase B decides whether a host-minted routine authorization is acceptable.
4. **Grant consumption.** The authority adapter never consumes the approval grant; the kernel
   journals consumption of its verified authorization. Phase B reconciles the two (consume on
   `published`, or treat the kernel journal as the consumption record).
5. **Destinations.** Only the OKF concept destination exists on the kernel path; `skill_draft`,
   `protocol_proposal`, `eval_or_gate_proposal`, `ticket`, and `reject` (rejection ledger) are
   phase B, with the GitHub seam.
6. **Replay.** The executor is a seam with a faithful attestation; the fork's worktree-isolated
   replay, capsules and eval fixtures bind in phase B. The fork has no attestation record today.
7. **Decider identity.** An approval decided without a recorded decider projects to the human
   operator principal; agent deciders keep their distinct kind.
8. **Projected-episode reads.** `readEpisodeRecord` in the fork is a bare cast; the adapter
   parses its own. Folding that validator back into the fork is #407's domain, not this
   migration's.
9. **Org identity in scope.** The kernel scope's isolation segment is the org name, supplied by
   the caller (`~/.cormidia/<org>`); the fork never names the org in a scope.

## 5. Coexistence rule for phase A

The kernel path is not wired to any operator surface, scheduler turn, or context assembly in
phase A, so a live org home is never written through both engines. Pointing
`createCormidiaLearningLoop` at a live org home before cutover is forbidden by this record;
F-PT-041 (`validation-design/harness-design-state.md`) asks the owner to ratify that rule for the
cutover window (one writer per destination root at any time) — no test encodes either answer.

## 6. Phase B checklist (Cormidia #467, governed-learning-loop#14)

- parity evidence per §3a against a captured org home: kernel-published concept bytes and
  manifest cuts byte-equal to the fork's for the same draft and approval; active bundle
  resolution and episode pinning unchanged;
- the remaining destinations and the replay runner binding; grant consumption; policy mapping;
- operator path cutover (CLI `learn *`, distiller/reviewer turns, `context.ts`), then the
  forked engine removal with the owner's explicit sign-off; "removing the package breaks
  compilation";
- close #467, #14, and #461.
