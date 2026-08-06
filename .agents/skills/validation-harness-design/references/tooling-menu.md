# Tooling Menu

Read during Phase 7. Present options per layer with the tradeoffs that actually differ — not a feature matrix. The human selects; record rejected options and reasons in the policy file, because the reasons are what make a future revisit cheap.

**Module scope:** the parent product's existing stack is the default. Divergence must be justified — a second runner or a second eval framework doubles the CI surface a future audit has to reason about, and halves the chance anyone maintains either.

Layer numbering follows the taxonomy in SKILL.md — invariant/contract, hermetic system, live sandbox, eval/qualification, ops hardening — plus a cross-layer CI section.

## Layer 1 — Invariant / contract runner

| Option | Fits when | Cost |
|---|---|---|
| `pytest` | Python codebase; rich fixture and parametrization needs | Fixture magic gets opaque at scale |
| `vitest` / `jest` | TS/JS codebase; vitest for ESM-native and speed | Ecosystem churn |
| `go test` / `cargo test` | Language-native, no dependency | Fewer batteries for property testing |

Add a **property-based** layer (Hypothesis, fast-check) wherever invariants are numeric, ordering-based, or conservation-based — property tests are the natural expression of an invariant, and one property test replaces dozens of examples.

## Layer 2 — Hermetic system: composition and fixtures

The seal is against the *outside world* and *nondeterminism*, not against real software you control locally — a containerized database is inside the seal; a vendor's API never is. Clock, randomness, and network get test doubles (a fake clock is the difference between a scheduler suite that runs in seconds and one that sleeps).

- **Real dependencies in containers** (Testcontainers or equivalent): highest fidelity, catches version skew and real timeout behavior. Default for C2+ where a boundary is a real database, queue, or service. Still hermetic: locally controlled, no external contact.
- **In-process fakes** you own: fast and deterministic, but they encode your assumptions — they cannot catch a contract mismatch, only a regression against your belief about the contract.
- **Recorded interactions** (VCR-style cassettes) for external vendors: good for shape, silently stale when the vendor changes. Pair with a low-frequency layer-3 live smoke or the staleness is invisible.
- **Contract tests** (Pact-style) where two teams or two services evolve independently — overkill for a solo-maintained module, valuable across an org boundary.
- **Journey tests default to this layer**: full lifecycles at the API level with all boundaries faked. Playwright browser journeys against a local build are hermetic too. Keep the count small and behavior-level.

Rule of thumb: mock **across** boundaries, never **inside** them. Mocking inside a boundary tests your mocks.

## Layer 3 — Live system (sandbox)

Reserved for the seams the honest-fake test (Phase 3) rejected — vendor auth handshakes, CI, OS schedulers, vendor behavior no fake would reproduce. Everything here is real; the tooling question is containment, not framework:

- **A named disposable target per seam** — sandbox account, throwaway repo, vendor test mode. No disposable target → architecture finding, not a smaller test.
- **A spend bound per run**, enforced (budget cap, quota), not aspirational.
- **The suite stays minimal**: one smoke per unfakeable seam plus the walking-skeleton journey. Anything provable at layer 2 is moved there — live suites rot in proportion to their size.

## Layer 4 — Eval / qualification

| Option | Fits when | Cost |
|---|---|---|
| Hand-rolled runner over a golden-set directory + CI job | Small number of call sites; full control of format; no vendor lock | You build reporting and trend tracking yourself |
| `promptfoo` | Config-driven eval matrices, quick model comparison, local-first | Opinionated config; less flexible for trajectory scoring |
| Hosted eval platforms (Braintrust, LangSmith, Langfuse) | Teams needing shared dashboards, trend history, dataset curation UI | Data leaves the box; recurring cost; another auth surface |

Whatever is chosen, the **golden set is plain files in Git**, not locked inside a vendor's dataset store. The set is the model-swap regression suite and must outlive any tool choice.

For **trajectory evals**, start with deterministic assertions over run telemetry (tool calls legal, budget respected, no loops, escalation fired) in the Layer 1 runner. Reach for a tracing platform (OTel GenAI conventions, Langfuse, Phoenix) only when span-level debugging is the actual bottleneck.

## Layer 5 — Ops hardening

Obligations are fixed in Phase 6 (tier- and shape-gated); tooling is mostly discipline, not purchases:

- **Threat model:** a lightweight structured pass (STRIDE-style) over the boundary map — the boundary map *is* the attack-surface inventory. A document with an owner and a review trigger, not a tool.
- **Scale at the contention point:** one load tool (k6, Locust, or a bespoke script) aimed at the specific hot resource the deployment shape implies — never uniform-throughput theater.
- **Soak:** a long-running instance on the layer-3 sandbox target with assertions over its telemetry (state growth, missed-tick recovery, cost integrity under retries). Use the fake clock to accelerate what can be accelerated; some failure modes only exist in real elapsed time.
- **Secret hygiene:** a scanner in CI (gitleaks or equivalent) — cheap, boring, non-negotiable at C2+.

## Cross-layer — CI host and cost tiering

Whatever the repo already uses. What matters is not the host but that the tiering from Phase 5 is encoded there and in the policy file:

- **Per commit:** layers 1–2 (invariant/contract, hermetic system, LLM contract tests). Must be fast enough that nobody skips it — set the wall-clock budget explicitly.
- **On prompt/model change + nightly:** LLM quality evals (layer 4).
- **On judge change:** judge meta-evals.
- **Pre-merge / pre-release:** layer-3 sandbox smokes; scale test at the contention point.
- **Pre-GA, then recurring:** layer-5 obligations on their declared schedule.

Encode the trigger conditions in the policy file, not only in CI config — otherwise "saving CI minutes" silently removes a gate and nothing records that it happened.

## Selection heuristics

1. **Boring and already installed beats better and new.** A harness only pays off if it's still running in six months.
2. **One runner per language, one eval framework per product.** Consolidate before optimizing.
3. **Optimize the per-commit tier for speed, everything else for fidelity.** These are different goals and want different tools.
4. **Anything that can't run locally will eventually only be run by CI, and then only by whoever is on call.** Weight local ergonomics heavily.
